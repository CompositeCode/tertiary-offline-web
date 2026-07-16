//! Polite, bounded whole-site crawler (M1) with long-job UX + resume (M2).
//!
//! Wraps `scrape::capture_page` with a frontier + visited-set, scope/depth/
//! domain enforcement, safety caps (pages / bytes / time), robots.txt respect,
//! a per-host rate limiter with concurrency ceiling, and 429/403 backoff. It
//! emits `crawl://progress` Tauri events and produces a browsable local tree
//! whose seed page is the root `index.html`, with inter-page links rewritten to
//! local relative paths where the target was captured.
//!
//! Concurrency model: a fixed pool of worker threads share a mutex-guarded
//! frontier/state; a global token-bucket + per-host earliest-next-request clock
//! enforce politeness across all workers. Stop is cooperative (an atomic flag).
//!
//! M2 additions:
//!  - **Pause/Resume**: a cooperative `Paused` state — workers idle on a Condvar
//!    without dropping the frontier, and resume where they left off.
//!  - **Live rate**: `Controller::set_rate` retunes the shared limiter without
//!    restarting the job.
//!  - **On-disk job state** (`<out_dir>/.iloffline/job.json`): config, frontier,
//!    visited set, per-URL manifest, counters and status are persisted
//!    incrementally + atomically (temp-then-rename) so a job survives quit /
//!    crash / network loss and resumes WITHOUT re-fetching completed pages
//!    (NFR-RESUME-1, FR-PROG-3). Saved on a throttled cadence and on every
//!    pause / stop / terminal state.
//!  - **Network-drop auto-pause** (FR-PROG-6): a run of consecutive connection
//!    failures flips the job to `offline`; a background probe auto-resumes when
//!    connectivity returns.
//!  - **Disk-full auto-pause** (FR-PROG-7): a write failure pauses with a clear
//!    error, partials preserved.
//!  - **Session-expiry auto-pause** (FR-AUTH-5): an external signal flips the
//!    job to `session-expired` (paused, never failed); the frontend resumes it
//!    after re-auth.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use url::Url;

use crate::scrape::{
    self, build_client, capture_page, default_user_agent, expand_home, path_string,
};

// ----- Config (mirrors the TS `CrawlConfig`) -----------------------------

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CrawlConfig {
    pub url: String,
    /// `"page"` (this page only) or `"site"` (follow in-scope links).
    pub scope: String,
    /// Link-follow depth for `site` scope. Seed page is depth 0.
    #[serde(default = "default_depth")]
    pub depth: u32,
    /// `"same"` | `"subdomains"` | `"list"` | `"any"`.
    #[serde(default = "default_domain_scope")]
    pub domain_scope: String,
    /// Extra allowed hosts when `domain_scope == "list"` (or added to same/subdomain).
    #[serde(default)]
    pub allowed_domains: Vec<String>,
    /// Output root; `<host>/` is appended. `~` is expanded.
    #[serde(default = "default_out_root")]
    pub out_root: String,

    // Politeness ------------------------------------------------------------
    /// Requests/sec per host (default 1).
    #[serde(default = "default_rate")]
    pub rate_per_sec: f64,
    /// Worker concurrency (default 2).
    #[serde(default = "default_concurrency")]
    pub concurrency: u32,
    /// Respect robots.txt (default true). false = Advanced override.
    #[serde(default = "default_true")]
    pub respect_robots: bool,
    /// Truthful, configurable User-Agent.
    #[serde(default)]
    pub user_agent: Option<String>,

    // Safety caps -----------------------------------------------------------
    #[serde(default = "default_max_pages")]
    pub max_pages: u32,
    #[serde(default = "default_max_bytes")]
    pub max_bytes: u64,
    #[serde(default = "default_max_seconds")]
    pub max_seconds: u64,
}

fn default_depth() -> u32 { 2 }
fn default_domain_scope() -> String { "same".to_string() }
fn default_out_root() -> String { "~/InterlinedList Offline".to_string() }
fn default_rate() -> f64 { 1.0 }
fn default_concurrency() -> u32 { 2 }
fn default_true() -> bool { true }
fn default_max_pages() -> u32 { 500 }
fn default_max_bytes() -> u64 { 2 * 1024 * 1024 * 1024 } // 2 GB
fn default_max_seconds() -> u64 { 30 * 60 } // 30 min

/// Hard global ceiling: even in Advanced the effective rate cannot exceed this
/// (LG-RATE-1). ~5 req/s.
const HARD_RATE_CEILING: f64 = 5.0;
/// Sane upper bound on worker threads regardless of config.
const MAX_CONCURRENCY: u32 = 8;

// ----- Progress + result payloads ----------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CrawlProgress {
    /// Stable id (the output dir) so the frontend can correlate events to jobs.
    pub job_dir: String,
    /// `running` | `paused` | `offline` | `session-expired` | `disk-full` |
    /// `finishing` | `done` | `stopped` | `capped` | `error`.
    pub status: String,
    pub current_url: String,
    pub pages_done: u32,
    pub pages_discovered: u32,
    pub queue_depth: u32,
    pub bytes_downloaded: u64,
    pub errors: u32,
    /// Skip/error counts grouped by reason.
    pub reasons: HashMap<String, u32>,
    pub elapsed_secs: u64,
    /// When terminal (or paused with a reason), why — e.g. cap/offline message.
    pub stop_reason: String,
    /// The host / display name for this job (mirrors the Library row).
    pub host: String,
    /// The seed URL, so a paused/persisted job can be resumed from Library.
    pub url: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CapturedItem {
    pub url: String,
    /// `captured` | `partial` | `skipped` | `failed`.
    pub status: String,
    /// Local relative path (e.g. `index.html`, `docs/guide.html`) when captured.
    pub local_path: String,
    /// Skip/failure reason when not captured.
    pub reason: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CrawlResult {
    pub output_dir: String,
    pub index_path: String,
    pub page_count: u32,
    pub asset_count: u32,
    pub failed_asset_count: u32,
    pub total_bytes: u64,
    /// `done` | `stopped` | `capped` | `error`.
    pub status: String,
    pub stop_reason: String,
    pub reasons: HashMap<String, u32>,
    pub items: Vec<CapturedItem>,
}

// ----- Control state ------------------------------------------------------

/// Coarse control state driven by external commands + auto-pause triggers. Held
/// as an atomic so workers can cheaply poll it without taking the state lock.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Control {
    Running = 0,
    /// User pressed Pause.
    Paused = 1,
    /// Network dropped (auto): waiting to reconnect; auto-resumes.
    Offline = 2,
    /// IL session expired (auto): waiting for re-auth; frontend resumes.
    SessionExpired = 3,
    /// Disk full / write error (auto): partials preserved, needs user action.
    DiskFull = 4,
    /// User pressed Stop: finalize + keep partials (terminal).
    Stopped = 5,
}

impl Control {
    fn from_u8(v: u8) -> Control {
        match v {
            1 => Control::Paused,
            2 => Control::Offline,
            3 => Control::SessionExpired,
            4 => Control::DiskFull,
            5 => Control::Stopped,
            _ => Control::Running,
        }
    }
    /// Is the job in some paused-but-not-terminal state?
    fn is_paused(self) -> bool {
        matches!(
            self,
            Control::Paused | Control::Offline | Control::SessionExpired | Control::DiskFull
        )
    }
    /// Status string surfaced to the frontend for this control state.
    fn status_str(self) -> &'static str {
        match self {
            Control::Running => "running",
            Control::Paused => "paused",
            Control::Offline => "offline",
            Control::SessionExpired => "session-expired",
            Control::DiskFull => "disk-full",
            Control::Stopped => "stopped",
        }
    }
}

/// Externally-mutable handle to a running crawl. `start_crawl` registers one of
/// these in app state; `pause_crawl` / `resume_crawl` / `set_crawl_rate` /
/// `stop_crawl` and the session-expiry watcher act on it. Cloning shares the
/// same underlying flags (it's all `Arc`).
#[derive(Clone)]
pub struct Controller {
    /// Coarse control state (see `Control`).
    state: Arc<AtomicU8>,
    /// Wakes workers parked while paused, and the drain-wait loop.
    cvar: Arc<Condvar>,
    /// Trivial mutex the cvar pairs with (workers park on a short timeout too).
    park: Arc<Mutex<()>>,
    /// Live rate params (req/s + concurrency), retunable mid-job.
    rate: Arc<Mutex<RateParams>>,
    /// The job's output dir, i.e. its stable id.
    pub job_dir: Arc<PathBuf>,
    /// The seed URL, for the offline-watcher connectivity probe.
    url: Arc<String>,
}

#[derive(Clone, Copy)]
struct RateParams {
    rate_per_sec: f64,
    /// Concurrency hint. We spawn workers up front; lowering this parks the
    /// surplus workers cooperatively rather than killing threads.
    concurrency: u32,
}

impl Controller {
    pub fn new(job_dir: PathBuf, url: String, rate_per_sec: f64, concurrency: u32) -> Controller {
        Controller {
            state: Arc::new(AtomicU8::new(Control::Running as u8)),
            cvar: Arc::new(Condvar::new()),
            park: Arc::new(Mutex::new(())),
            rate: Arc::new(Mutex::new(RateParams { rate_per_sec, concurrency })),
            job_dir: Arc::new(job_dir),
            url: Arc::new(url),
        }
    }

    /// True while auto-paused waiting for the network to return.
    pub fn is_offline(&self) -> bool {
        self.get() == Control::Offline
    }

    /// The seed URL, for the offline-watcher connectivity probe.
    pub fn probe_url(&self) -> String {
        (*self.url).clone()
    }

    fn get(&self) -> Control {
        Control::from_u8(self.state.load(Ordering::Relaxed))
    }

    fn set(&self, c: Control) {
        self.state.store(c as u8, Ordering::Relaxed);
        // Wake any parked workers so they observe the change (e.g. resume/stop).
        self.cvar.notify_all();
    }

    /// User Pause: only meaningful while running (don't clobber an auto-pause
    /// reason or a terminal Stop).
    pub fn pause(&self) {
        if self.get() == Control::Running {
            self.set(Control::Paused);
        }
    }

    /// Resume from any paused state back to Running.
    pub fn resume(&self) {
        if self.get().is_paused() {
            self.set(Control::Running);
        }
    }

    /// Stop (terminal): finalize + keep partials.
    pub fn stop(&self) {
        self.set(Control::Stopped);
    }

    /// Auto-pause due to session expiry (FR-AUTH-5) — never overrides Stop.
    pub fn signal_session_expired(&self) {
        let c = self.get();
        if c != Control::Stopped {
            self.set(Control::SessionExpired);
        }
    }

    /// Retune the live limiter without restarting (FR-PROG-2). `concurrency`
    /// is optional; when omitted only the rate changes.
    pub fn set_rate(&self, rate_per_sec: f64, concurrency: Option<u32>) {
        let mut r = self.rate.lock().unwrap();
        r.rate_per_sec = rate_per_sec.clamp(0.01, HARD_RATE_CEILING);
        if let Some(c) = concurrency {
            r.concurrency = c.clamp(1, MAX_CONCURRENCY);
        }
        drop(r);
        // Nudge parked workers (a raised concurrency should un-park a worker).
        self.cvar.notify_all();
    }

    fn rate_params(&self) -> RateParams {
        *self.rate.lock().unwrap()
    }
}

// ----- On-disk job state (M2 persistence, NFR-RESUME-1) -------------------

/// The relative path of the persisted job file under the output dir.
const JOB_STATE_SUBDIR: &str = ".iloffline";
const JOB_STATE_FILE: &str = "job.json";

/// Everything needed to resume a job from a cold start (FR-PROG-3). Written
/// atomically to `<out_dir>/.iloffline/job.json`.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PersistedJob {
    /// Schema version for forward-compat.
    pub version: u32,
    pub config: CrawlConfig,
    /// `running` | `paused` | `offline` | `session-expired` | `disk-full` |
    /// `done` | `stopped` | `capped` | `error`. A job persisted mid-run is
    /// written as its live status; if the app died it will be read back as e.g.
    /// `running` and treated as resumable.
    pub status: String,
    pub stop_reason: String,
    /// Remaining frontier (URL + depth), in order.
    pub frontier: Vec<PersistItem>,
    /// Normalized-URL dedupe set (already-seen; never re-enqueued/re-fetched).
    pub visited: Vec<String>,
    /// Per-URL manifest: captured / skipped / failed, with local path + reason.
    pub items: Vec<CapturedItem>,
    /// normalized url -> local path for captured pages (link-rewrite + skip).
    pub captured: HashMap<String, String>,
    /// Allocated local paths (so resume keeps allocation stable/unique).
    pub used_paths: Vec<String>,
    // Counters.
    pub pages_done: u32,
    pub pages_discovered: u32,
    pub bytes_downloaded: u64,
    pub errors: u32,
    pub asset_count: u32,
    pub failed_asset_count: u32,
    pub reasons: HashMap<String, u32>,
    /// Seconds already elapsed in prior run segments (added to the live clock).
    pub elapsed_secs: u64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PersistItem {
    pub url: String,
    pub depth: u32,
}

/// A discovered job on disk, for the Library-survives-restart scan.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct JobSummary {
    pub job_dir: String,
    pub url: String,
    pub host: String,
    pub status: String,
    pub stop_reason: String,
    pub page_count: u32,
    pub total_bytes: u64,
    pub asset_count: u32,
    pub failed_asset_count: u32,
    pub reasons: HashMap<String, u32>,
    /// True when the job can be resumed (paused/partial/interrupted, not done).
    pub resumable: bool,
    /// Mtime (secs since epoch) of the state file, for sorting newest-first.
    pub updated_at: u64,
    /// The full captured/skipped manifest (so Library → Results needs no reload).
    pub items: Vec<CapturedItem>,
    pub index_path: String,
}

/// Path to a job's state file given its output dir.
fn state_path(out_dir: &std::path::Path) -> PathBuf {
    out_dir.join(JOB_STATE_SUBDIR).join(JOB_STATE_FILE)
}

/// Atomically write the persisted job: serialize to a temp file in the same
/// directory, fsync, then rename over the target. A crash mid-write leaves the
/// previous good file intact (never a torn/partial job.json) — R6 mitigation.
fn write_job_atomic(out_dir: &std::path::Path, job: &PersistedJob) -> std::io::Result<()> {
    let dir = out_dir.join(JOB_STATE_SUBDIR);
    std::fs::create_dir_all(&dir)?;
    let final_path = dir.join(JOB_STATE_FILE);
    let tmp_path = dir.join(format!("{JOB_STATE_FILE}.tmp"));
    let bytes = serde_json::to_vec_pretty(job)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    {
        use std::io::Write;
        let mut f = std::fs::File::create(&tmp_path)?;
        f.write_all(&bytes)?;
        f.flush()?;
        let _ = f.sync_all();
    }
    std::fs::rename(&tmp_path, &final_path)?;
    Ok(())
}

/// Load a persisted job from a job dir (the dir that contains `.iloffline/`).
pub fn load_persisted(job_dir: &str) -> Result<PersistedJob, String> {
    let path = state_path(std::path::Path::new(job_dir));
    let bytes = std::fs::read(&path)
        .map_err(|e| format!("Could not read job state: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("Corrupt job state: {e}"))
}

/// Build a Library `JobSummary` from a persisted job living at `job_dir`.
fn summary_from(job_dir: &std::path::Path, p: &PersistedJob, updated_at: u64) -> JobSummary {
    let host = Url::parse(&p.config.url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_string()))
        .unwrap_or_else(|| job_dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default());
    // A job is resumable if it isn't a clean finish and still has queued work
    // (or was interrupted mid-run — a persisted `running` means the app died).
    let resumable = matches!(
        p.status.as_str(),
        "paused" | "offline" | "session-expired" | "disk-full" | "running" | "stopped"
    ) && !p.frontier.is_empty();
    JobSummary {
        job_dir: path_string(job_dir),
        url: p.config.url.clone(),
        host,
        status: p.status.clone(),
        stop_reason: p.stop_reason.clone(),
        page_count: p.pages_done,
        total_bytes: p.bytes_downloaded,
        asset_count: p.asset_count,
        failed_asset_count: p.failed_asset_count,
        reasons: p.reasons.clone(),
        resumable,
        updated_at,
        items: p.items.clone(),
        index_path: path_string(&job_dir.join("index.html")),
    }
}

/// Scan the mirrors root for persisted jobs so the Library survives restart
/// (FR-PROG-3 / NFR-RESUME-1). Walks `<out_root>/<host>/.iloffline/job.json`
/// one level deep (v1 keeps one host dir per job). Returns newest-first.
pub fn list_jobs(out_root: &str) -> Vec<JobSummary> {
    let root = expand_home(out_root);
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(&root) else {
        return out;
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let state = state_path(&dir);
        let Ok(meta) = std::fs::metadata(&state) else {
            continue;
        };
        let updated_at = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        if let Ok(bytes) = std::fs::read(&state) {
            if let Ok(p) = serde_json::from_slice::<PersistedJob>(&bytes) {
                out.push(summary_from(&dir, &p, updated_at));
            }
        }
    }
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    out
}

/// Cheap connectivity probe used by the auto-resume watcher: a HEAD to the seed
/// host. Returns true if we got any HTTP response (i.e. the network is back).
pub fn is_online(url: &str) -> bool {
    let Ok(client) = build_client(&default_user_agent()) else {
        return false;
    };
    // Short timeout so the watcher stays responsive.
    match client.head(url).timeout(Duration::from_secs(8)).send() {
        Ok(_) => true,
        Err(e) => {
            // A status error still means we reached the server (online).
            e.is_status()
        }
    }
}

// ----- Skip reasons -------------------------------------------------------

const R_OFF_SCOPE: &str = "off-scope";
const R_ROBOTS: &str = "robots-blocked";
const R_TOO_LARGE: &str = "too-large";
const R_HTTP_ERROR: &str = "http-error";
const R_TIMEOUT: &str = "timeout";
const R_BLOCKED: &str = "rate-limited";
/// Connection-level failure (DNS / connect / reset) — candidate for a network
/// drop, drives the auto-offline streak.
const R_CONNECT: &str = "connection-failed";

// ----- Frontier item ------------------------------------------------------

#[derive(Clone)]
struct QueueItem {
    url: Url,
    depth: u32,
}

// ----- Shared crawl state -------------------------------------------------

struct Shared {
    cfg: CrawlConfig,
    seed: Url,
    seed_host: String,
    /// Normalized-URL visited set (dedupe; fetched at most once — FR-SCOPE-6).
    visited: HashSet<String>,
    /// Work queue.
    frontier: VecDeque<QueueItem>,
    /// Captured pages: normalized url -> local relative path (for link rewrite).
    captured: HashMap<String, String>,
    /// Ordered captured/skipped items for the results report.
    items: Vec<CapturedItem>,
    /// Written page files pending inter-page link rewrite: (abs_path, html, page_url).
    pending_rewrites: Vec<PendingPage>,
    /// robots matcher per host (None until fetched; Some(None) = no robots/allow-all).
    robots: HashMap<String, Option<RobotsInfo>>,
    /// Earliest instant a request may be made per host (rate + crawl-delay).
    next_ok: HashMap<String, Instant>,
    /// Global token bucket clock: earliest instant for the next global request.
    global_next: Instant,

    // Counters
    pages_done: u32,
    pages_discovered: u32,
    bytes_downloaded: u64,
    errors: u32,
    reasons: HashMap<String, u32>,
    asset_count: u32,
    failed_asset_count: u32,

    // Local path allocation dedupe
    used_paths: HashSet<String>,

    // Lifecycle
    finished: bool,
    stop_reason: String,
    status: String,
    /// Workers currently inside capture (to know when the crawl is truly idle).
    active_workers: u32,

    // ----- M2 persistence + auto-pause bookkeeping -----
    /// Output dir (job id + where `.iloffline/job.json` lives).
    out_dir: PathBuf,
    /// Seconds already elapsed in prior run segments (resume clock offset).
    base_elapsed: u64,
    /// Pages captured since the last state save (throttled-save trigger).
    pages_since_save: u32,
    /// Instant of the last state save (time-based save trigger).
    last_save: Instant,
    /// Consecutive network/connection failures across workers (auto-offline).
    net_fail_streak: u32,
}

/// Save every N captured pages …
const SAVE_EVERY_PAGES: u32 = 10;
/// … or at least every this often, whichever comes first (throttle so we don't
/// write on every single fetch — keeps long jobs performant, NFR-PERF-2).
const SAVE_EVERY: Duration = Duration::from_secs(10);
/// Consecutive connection failures that flip a job to `offline` (auto-pause).
const NET_FAIL_THRESHOLD: u32 = 5;

struct PendingPage {
    abs_path: std::path::PathBuf,
    html: String,
    page_url: Url,
}

struct RobotsInfo {
    /// Compiled robots rules text (we re-parse per check via texting_robots).
    body: String,
    crawl_delay: Option<f64>,
}

// ----- Entry point --------------------------------------------------------

/// Resolve the output dir for a config: `<out_root>/<host>/`.
pub fn output_dir_for(cfg: &CrawlConfig) -> Result<PathBuf, String> {
    let seed = Url::parse(cfg.url.trim()).map_err(|_| "Invalid URL.".to_string())?;
    let host = seed.host_str().ok_or_else(|| "URL has no host.".to_string())?;
    Ok(expand_home(&cfg.out_root).join(host))
}

/// Run a crawl to completion (or to a pause/stop) on the calling thread (the
/// command spawns this in a background thread). Emits progress via
/// `emit_progress`. The `Controller` drives pause/resume/stop/rate/session
/// externally. If `resume` is `Some`, the frontier/visited/manifest/counters are
/// seeded from it and completed pages are NOT re-fetched (NFR-RESUME-1).
///
/// Returns the final `CrawlResult`. When the job paused (rather than finished),
/// the result carries the paused status so the caller can leave it in Library.
pub fn run_crawl<F>(
    cfg: CrawlConfig,
    controller: Controller,
    resume: Option<PersistedJob>,
    emit_progress: F,
) -> Result<CrawlResult, String>
where
    F: Fn(CrawlProgress) + Send + Sync + 'static,
{
    let seed = Url::parse(cfg.url.trim()).map_err(|_| "Invalid URL.".to_string())?;
    if seed.scheme() != "http" && seed.scheme() != "https" {
        return Err("URL must use http or https.".to_string());
    }
    let seed_host = seed
        .host_str()
        .ok_or_else(|| "URL has no host.".to_string())?
        .to_string();

    let user_agent = cfg
        .user_agent
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(default_user_agent);
    let http = build_client(&user_agent)?;

    // Output dir: <out_root>/<host>/
    let out_dir = expand_home(&cfg.out_root).join(&seed_host);
    std::fs::create_dir_all(&out_dir)
        .map_err(|e| format!("Could not create output folder: {e}"))?;

    let started = Instant::now();
    // Spawn a generous pool (up to MAX_CONCURRENCY); the live-tunable
    // `concurrency` limit parks the surplus rather than killing threads, so
    // `set_crawl_rate` can raise concurrency later without a restart.
    let spawn_count = MAX_CONCURRENCY;

    // Seed frontier/visited/manifest either fresh or from a persisted job.
    let (
        frontier,
        visited,
        captured,
        items,
        used_paths,
        base_elapsed,
        pages_done,
        pages_discovered,
        bytes_downloaded,
        errors,
        reasons,
        asset_count,
        failed_asset_count,
    ) = match resume {
        Some(p) => {
            let mut frontier = VecDeque::new();
            for it in p.frontier {
                if let Ok(u) = Url::parse(&it.url) {
                    frontier.push_back(QueueItem { url: u, depth: it.depth });
                }
            }
            let visited: HashSet<String> = p.visited.into_iter().collect();
            let used_paths: HashSet<String> = p.used_paths.into_iter().collect();
            (
                frontier,
                visited,
                p.captured,
                p.items,
                used_paths,
                p.elapsed_secs,
                p.pages_done,
                p.pages_discovered,
                p.bytes_downloaded,
                p.errors,
                p.reasons,
                p.asset_count,
                p.failed_asset_count,
            )
        }
        None => {
            let mut frontier = VecDeque::new();
            let mut visited = HashSet::new();
            visited.insert(normalize(&seed));
            frontier.push_back(QueueItem { url: seed.clone(), depth: 0 });
            (
                frontier,
                visited,
                HashMap::new(),
                Vec::new(),
                HashSet::new(),
                0,
                0,
                1,
                0,
                0,
                HashMap::new(),
                0,
                0,
            )
        }
    };

    let shared = Arc::new((
        Mutex::new(Shared {
            cfg: cfg.clone(),
            seed: seed.clone(),
            seed_host: seed_host.clone(),
            visited,
            frontier,
            captured,
            items,
            pending_rewrites: Vec::new(),
            robots: HashMap::new(),
            next_ok: HashMap::new(),
            global_next: Instant::now(),
            pages_done,
            pages_discovered,
            bytes_downloaded,
            errors,
            reasons,
            asset_count,
            failed_asset_count,
            used_paths,
            finished: false,
            stop_reason: String::new(),
            status: "running".to_string(),
            active_workers: 0,
            out_dir: out_dir.clone(),
            base_elapsed,
            pages_since_save: 0,
            last_save: Instant::now(),
            net_fail_streak: 0,
        }),
        Condvar::new(),
    ));

    let emit = Arc::new(emit_progress);
    let out_dir = Arc::new(out_dir);

    // Persist an initial state snapshot so the job appears in Library scans
    // immediately (survives a very early crash / quit).
    {
        let g = shared.0.lock().unwrap();
        let _ = write_job_atomic(&g.out_dir, &build_persisted(&g, started, "running"));
    }

    // Emit an initial "running" event so the frontend has host/url/job_dir.
    {
        let g = shared.0.lock().unwrap();
        let prog = snapshot_progress(&g, "running", g.base_elapsed);
        drop(g);
        (emit)(prog);
    }

    // Spawn workers.
    let mut handles = Vec::new();
    for idx in 0..spawn_count {
        let shared = Arc::clone(&shared);
        let http = http.clone();
        let controller = controller.clone();
        let emit = Arc::clone(&emit);
        let out_dir = Arc::clone(&out_dir);
        handles.push(thread::spawn(move || {
            worker(idx, shared, http, controller, emit, out_dir, started);
        }));
    }
    for h in handles {
        let _ = h.join();
    }

    // Determine the final status from the control state / lifecycle.
    let mut guard = shared.0.lock().unwrap();
    let ctrl = controller.get();
    let paused = ctrl.is_paused();
    if paused {
        guard.status = ctrl.status_str().to_string();
    } else if ctrl == Control::Stopped {
        guard.status = "stopped".to_string();
        if guard.stop_reason.is_empty() {
            guard.stop_reason = "Stopped by you.".to_string();
        }
    } else if guard.status == "running" {
        guard.status = "done".to_string();
    }

    // Finalize inter-page links + write pages. On pause we still finalize what's
    // captured so the partial mirror is browsable; unfetched frontier persists.
    finalize(&mut guard);

    let elapsed = guard.base_elapsed + started.elapsed().as_secs();
    let final_status = guard.status.clone();

    // Persist the final/paused state (atomic) so resume + Library survive quit.
    let _ = write_job_atomic(&guard.out_dir, &build_persisted(&guard, started, &final_status));

    let result = CrawlResult {
        output_dir: path_string(&out_dir),
        index_path: path_string(&out_dir.join("index.html")),
        page_count: guard.pages_done,
        asset_count: guard.asset_count,
        failed_asset_count: guard.failed_asset_count,
        total_bytes: guard.bytes_downloaded,
        status: final_status.clone(),
        stop_reason: guard.stop_reason.clone(),
        reasons: guard.reasons.clone(),
        items: guard.items.clone(),
    };

    // Final progress event (terminal or paused).
    let prog = snapshot_progress(&guard, &final_status, elapsed);
    drop(guard);
    (emit)(prog);

    Ok(result)
}

/// Snapshot the current `Shared` into a `PersistedJob` for atomic save.
fn build_persisted(g: &Shared, started: Instant, status: &str) -> PersistedJob {
    PersistedJob {
        version: 1,
        config: g.cfg.clone(),
        status: status.to_string(),
        stop_reason: g.stop_reason.clone(),
        frontier: g
            .frontier
            .iter()
            .map(|q| PersistItem { url: q.url.as_str().to_string(), depth: q.depth })
            .collect(),
        visited: g.visited.iter().cloned().collect(),
        items: g.items.clone(),
        captured: g.captured.clone(),
        used_paths: g.used_paths.iter().cloned().collect(),
        pages_done: g.pages_done,
        pages_discovered: g.pages_discovered,
        bytes_downloaded: g.bytes_downloaded,
        errors: g.errors,
        asset_count: g.asset_count,
        failed_asset_count: g.failed_asset_count,
        reasons: g.reasons.clone(),
        elapsed_secs: g.base_elapsed + started.elapsed().as_secs(),
    }
}

/// Throttled state save: called from workers after a capture. Writes at most
/// every `SAVE_EVERY_PAGES` pages or `SAVE_EVERY` seconds (NFR-PERF-2). Holds
/// the state lock already (caller passes `&mut Shared`).
fn maybe_save(g: &mut Shared, started: Instant) {
    g.pages_since_save += 1;
    if g.pages_since_save >= SAVE_EVERY_PAGES || g.last_save.elapsed() >= SAVE_EVERY {
        let snap = build_persisted(g, started, &g.status);
        // Best-effort; a save failure shouldn't crash the crawl. A genuine
        // disk-full is caught at page-write time and auto-pauses there.
        let _ = write_job_atomic(&g.out_dir, &snap);
        g.pages_since_save = 0;
        g.last_save = Instant::now();
    }
}

// ----- Worker loop --------------------------------------------------------

fn worker<F>(
    idx: u32,
    shared: Arc<(Mutex<Shared>, Condvar)>,
    http: reqwest::blocking::Client,
    controller: Controller,
    emit: Arc<F>,
    out_dir: Arc<std::path::PathBuf>,
    started: Instant,
) where
    F: Fn(CrawlProgress) + Send + Sync + 'static,
{
    let (lock, cvar) = &*shared;
    loop {
        // ----- Cooperative pause gate -----
        // If paused (user Pause, offline, session-expired, disk-full), park on
        // the controller's cvar WITHOUT dropping the frontier, and update the
        // job status. Un-parks on resume/stop. We also park surplus workers
        // when the live concurrency limit is below our worker index.
        loop {
            let c = controller.get();
            if c == Control::Stopped {
                break;
            }
            let over_concurrency = idx >= controller.rate_params().concurrency;
            if c.is_paused() || over_concurrency {
                // Reflect the paused status once (only the first worker needs to,
                // but it's cheap and idempotent under the lock).
                {
                    let mut g = lock.lock().unwrap();
                    if c.is_paused() && g.status != c.status_str() {
                        g.status = c.status_str().to_string();
                        set_pause_reason(&mut g, c);
                        let st = g.status.clone();
                        // Persist immediately on entering a paused state.
                        let _ = write_job_atomic(&g.out_dir, &build_persisted(&g, started, &st));
                        emit_now(&g, &emit, started);
                    }
                }
                // Park briefly; re-check control on wake.
                let park = controller.park.lock().unwrap();
                let _ = controller
                    .cvar
                    .wait_timeout(park, Duration::from_millis(200))
                    .unwrap();
                continue;
            }
            // Running and within concurrency: clear a lingering paused status.
            {
                let mut g = lock.lock().unwrap();
                if g.status != "running" && !g.finished {
                    g.status = "running".to_string();
                    g.stop_reason.clear();
                    emit_now(&g, &emit, started);
                }
            }
            break;
        }

        // Acquire next work item (or exit).
        let item: Option<QueueItem>;
        {
            let mut g = lock.lock().unwrap();
            loop {
                if controller.get() == Control::Stopped {
                    if g.stop_reason.is_empty() {
                        g.stop_reason = "Stopped by you.".to_string();
                        g.status = "stopped".to_string();
                    }
                    cvar.notify_all();
                    return;
                }
                if g.finished {
                    cvar.notify_all();
                    return;
                }
                // Cap checks before dispensing more work.
                if let Some(reason) = check_caps(&g, started) {
                    g.finished = true;
                    g.stop_reason = reason;
                    g.status = "capped".to_string();
                    cvar.notify_all();
                    return;
                }
                if let Some(next) = g.frontier.pop_front() {
                    g.active_workers += 1;
                    item = Some(next);
                    break;
                }
                // No work available. If nobody is active, the crawl is drained.
                if g.active_workers == 0 {
                    g.finished = true;
                    cvar.notify_all();
                    return;
                }
                // Wait for either new work or the last active worker to finish.
                let (ng, _timeout) = cvar
                    .wait_timeout(g, Duration::from_millis(200))
                    .unwrap();
                g = ng;
            }
        }

        let Some(item) = item else { continue };
        let url = item.url.clone();

        // Politeness gate: wait until this host + the global bucket allow it.
        // Computed under lock, slept outside the lock. Rate comes from the LIVE
        // controller so `set_crawl_rate` retunes spacing without a restart.
        let live_rate = controller.rate_params().rate_per_sec;
        let wait = {
            let mut g = lock.lock().unwrap();
            let host = url.host_str().unwrap_or("").to_string();
            let now = Instant::now();
            let rate = live_rate.max(0.01).min(HARD_RATE_CEILING);
            let per_host_gap = Duration::from_secs_f64(1.0 / rate);
            // Global hard ceiling gap.
            let global_gap = Duration::from_secs_f64(1.0 / HARD_RATE_CEILING);

            let host_next = g.next_ok.get(&host).copied().unwrap_or(now);
            let global_next = g.global_next.max(now);
            let start_at = host_next.max(global_next).max(now);

            // Reserve the slots (advance clocks) so other workers space out.
            let crawl_delay = g
                .robots
                .get(&host)
                .and_then(|r| r.as_ref())
                .and_then(|r| r.crawl_delay);
            let effective_host_gap = match crawl_delay {
                Some(cd) => per_host_gap.max(Duration::from_secs_f64(cd)),
                None => per_host_gap,
            };
            g.next_ok.insert(host, start_at + effective_host_gap);
            g.global_next = start_at + global_gap;

            start_at.saturating_duration_since(now)
        };
        if !wait.is_zero() {
            // Poll stop/pause while sleeping so control is responsive.
            let deadline = Instant::now() + wait;
            while Instant::now() < deadline {
                let c = controller.get();
                if c == Control::Stopped || c.is_paused() {
                    break;
                }
                thread::sleep(Duration::from_millis(50).min(deadline - Instant::now()));
            }
        }
        {
            let c = controller.get();
            if c == Control::Stopped || c.is_paused() {
                // Re-queue this item (we popped it but didn't fetch) and loop
                // back to the pause gate so nothing is dropped.
                let mut g = lock.lock().unwrap();
                g.frontier.push_front(item);
                g.active_workers = g.active_workers.saturating_sub(1);
                cvar.notify_all();
                continue;
            }
        }

        // robots.txt check (fetches + caches per host on first use).
        let respect = {
            let g = lock.lock().unwrap();
            g.cfg.respect_robots
        };
        if respect {
            let allowed = robots_allows(&shared, &http, &url);
            if !allowed {
                let mut g = lock.lock().unwrap();
                record_skip(&mut g, &url, R_ROBOTS);
                g.active_workers = g.active_workers.saturating_sub(1);
                cvar.notify_all();
                emit_now(&g, &emit, started);
                continue;
            }
        }

        // Capture the page.
        let captured = capture_page(&http, &url);

        let mut g = lock.lock().unwrap();
        match captured {
            Ok(page) => {
                g.net_fail_streak = 0;
                // Bytes cap check post-fetch (we already have the bytes).
                g.bytes_downloaded += page.bytes;
                g.asset_count += page.asset_count;
                g.failed_asset_count += page.failed_asset_count;

                // Allocate a local path for this page and record it.
                let local = allocate_local_path(&mut g, &url);
                g.captured.insert(normalize(&url), local.clone());
                g.pages_done += 1;
                g.items.push(CapturedItem {
                    url: url.as_str().to_string(),
                    status: "captured".to_string(),
                    local_path: local.clone(),
                    reason: String::new(),
                });

                // Write assets immediately (relative to the page's dir).
                // A write failure whose root cause is a full disk auto-pauses
                // the job (FR-PROG-7): partials are already on disk, and the
                // frontier is preserved so the user can free space and resume.
                let page_dir = out_dir.join(&local).parent().map(|p| p.to_path_buf());
                let mut disk_full = false;
                if let Some(page_dir) = page_dir {
                    let _ = std::fs::create_dir_all(&page_dir);
                    for asset in &page.assets {
                        // Assets are all under `<page_dir>/assets/...`.
                        let dest = page_dir.join(&asset.rel_path);
                        if let Some(parent) = dest.parent() {
                            let _ = std::fs::create_dir_all(parent);
                        }
                        if let Err(e) = std::fs::write(&dest, &asset.body) {
                            if is_disk_full(&e) {
                                disk_full = true;
                                break;
                            }
                        }
                    }
                }
                if disk_full {
                    g.stop_reason = format!(
                        "Ran out of space in {}. Free some space, then Resume.",
                        out_dir.display()
                    );
                    g.status = "disk-full".to_string();
                    g.active_workers = g.active_workers.saturating_sub(1);
                    drop(g);
                    controller.set(Control::DiskFull);
                    cvar.notify_all();
                    continue;
                }

                // Defer HTML write until inter-page links are rewritten.
                let abs_path = out_dir.join(&local);
                g.pending_rewrites.push(PendingPage {
                    abs_path,
                    html: page.html,
                    page_url: url.clone(),
                });

                // Enqueue in-scope links if crawling the whole site.
                if g.cfg.scope == "site" && item.depth < g.cfg.depth {
                    let child_depth = item.depth + 1;
                    // Snapshot the config fields we need to avoid borrow issues.
                    for link in page.links {
                        let norm = normalize(&link);
                        if g.visited.contains(&norm) {
                            continue;
                        }
                        if in_scope(&g, &link) {
                            g.visited.insert(norm);
                            g.pages_discovered += 1;
                            g.frontier.push_back(QueueItem { url: link, depth: child_depth });
                        } else {
                            // Record off-scope once (not fetched — FR-SCOPE-4).
                            g.visited.insert(norm);
                            record_skip(&mut g, &link, R_OFF_SCOPE);
                        }
                    }
                }
            }
            Err(e) => {
                let reason = classify_error(&e);
                if reason == R_BLOCKED {
                    // 429/403 backoff: push the host's next-ok out and re-queue.
                    let host = url.host_str().unwrap_or("").to_string();
                    let backoff = Duration::from_secs(30);
                    let next = Instant::now() + backoff;
                    let entry = g.next_ok.entry(host).or_insert(next);
                    *entry = (*entry).max(next);
                    record_skip(&mut g, &url, R_BLOCKED);
                } else if reason == R_CONNECT {
                    // Connection failure (DNS/connect/reset): could be a network
                    // drop. Count the streak; on a run of them, auto-pause into
                    // `offline` and re-queue this URL so nothing is lost. A
                    // background probe (in lib.rs) auto-resumes when back online.
                    g.net_fail_streak += 1;
                    if g.net_fail_streak >= NET_FAIL_THRESHOLD
                        && controller.get() == Control::Running
                    {
                        g.frontier.push_front(item.clone());
                        g.stop_reason =
                            "Offline — waiting to reconnect.".to_string();
                        g.status = "offline".to_string();
                        g.active_workers = g.active_workers.saturating_sub(1);
                        drop(g);
                        controller.set(Control::Offline);
                        cvar.notify_all();
                        continue;
                    }
                    record_skip(&mut g, &url, reason);
                } else {
                    g.net_fail_streak = 0;
                    record_skip(&mut g, &url, reason);
                }
            }
        }
        maybe_save(&mut g, started);
        g.active_workers = g.active_workers.saturating_sub(1);
        cvar.notify_all();
        emit_now(&g, &emit, started);
    }
}

// ----- Scope / normalization ---------------------------------------------

/// Normalize a URL for dedupe: lowercase host, drop fragment, drop trailing
/// slash on non-root paths, drop default ports.
fn normalize(u: &Url) -> String {
    let mut u = u.clone();
    u.set_fragment(None);
    let host = u.host_str().unwrap_or("").to_lowercase();
    let scheme = u.scheme().to_string();
    let port = match (u.port(), scheme.as_str()) {
        (Some(80), "http") | (Some(443), "https") => String::new(),
        (Some(p), _) => format!(":{p}"),
        (None, _) => String::new(),
    };
    let mut path = u.path().to_string();
    if path.len() > 1 && path.ends_with('/') {
        path.pop();
    }
    let query = u.query().map(|q| format!("?{q}")).unwrap_or_default();
    format!("{scheme}://{host}{port}{path}{query}")
}

/// True if `link` is within the configured domain scope.
fn in_scope(g: &Shared, link: &Url) -> bool {
    let Some(host) = link.host_str() else { return false };
    let host = host.to_lowercase();
    let seed = g.seed_host.to_lowercase();

    let allow_extra = g
        .cfg
        .allowed_domains
        .iter()
        .any(|d| host == d.to_lowercase());

    match g.cfg.domain_scope.as_str() {
        "any" => true,
        "list" => host == seed || allow_extra,
        "subdomains" => host == seed || host.ends_with(&format!(".{seed}")) || allow_extra,
        // default "same"
        _ => host == seed || allow_extra,
    }
}

// ----- Caps ---------------------------------------------------------------

/// Returns a stop reason if any cap is exceeded (LG-CAPS-1). Checked before
/// dispensing new work so we stop-and-report rather than silently truncate.
fn check_caps(g: &Shared, started: Instant) -> Option<String> {
    if g.pages_done >= g.cfg.max_pages {
        return Some(format!("Reached the page limit ({} pages).", g.cfg.max_pages));
    }
    if g.bytes_downloaded >= g.cfg.max_bytes {
        return Some(format!(
            "Reached the size limit ({}).",
            human_bytes(g.cfg.max_bytes)
        ));
    }
    if g.base_elapsed + started.elapsed().as_secs() >= g.cfg.max_seconds {
        return Some(format!(
            "Reached the time limit ({} min).",
            g.cfg.max_seconds / 60
        ));
    }
    None
}

fn human_bytes(b: u64) -> String {
    let gb = b as f64 / (1024.0 * 1024.0 * 1024.0);
    if gb >= 1.0 {
        format!("{gb:.0} GB")
    } else {
        format!("{} MB", b / (1024 * 1024))
    }
}

// ----- robots.txt ---------------------------------------------------------

/// Returns true if the URL is allowed (or robots couldn't be evaluated safely,
/// in which case we allow — standard permissive-on-error behaviour, but only
/// after a genuine fetch attempt).
fn robots_allows(
    shared: &Arc<(Mutex<Shared>, Condvar)>,
    http: &reqwest::blocking::Client,
    url: &Url,
) -> bool {
    let host = url.host_str().unwrap_or("").to_string();

    // Fast path: cached.
    {
        let g = shared.0.lock().unwrap();
        if let Some(entry) = g.robots.get(&host) {
            return match entry {
                Some(info) => robots_check(&info.body, url, &g.cfg.effective_ua()),
                None => true, // no robots.txt / unreachable -> allow
            };
        }
    }

    // Fetch robots.txt (outside the lock).
    let robots_url = {
        let mut r = url.clone();
        r.set_path("/robots.txt");
        r.set_query(None);
        r.set_fragment(None);
        r
    };
    let fetched: Option<RobotsInfo> = match http.get(robots_url).send() {
        Ok(resp) if resp.status().is_success() => resp.text().ok().map(|body| {
            let crawl_delay = parse_crawl_delay(&body, &default_user_agent());
            RobotsInfo { body, crawl_delay }
        }),
        _ => None,
    };

    let mut g = shared.0.lock().unwrap();
    let ua = g.cfg.effective_ua();
    let allowed = match &fetched {
        Some(info) => robots_check(&info.body, url, &ua),
        None => true,
    };
    g.robots.insert(host, fetched);
    allowed
}

/// Evaluate robots rules using texting_robots.
fn robots_check(body: &str, url: &Url, ua: &str) -> bool {
    match texting_robots::Robot::new(ua, body.as_bytes()) {
        Ok(robot) => robot.allowed(url.as_str()),
        Err(_) => true, // unparseable robots -> don't block
    }
}

/// Extract a Crawl-delay applicable to our UA (falls back to `*`).
fn parse_crawl_delay(body: &str, ua: &str) -> Option<f64> {
    texting_robots::Robot::new(ua, body.as_bytes())
        .ok()
        .and_then(|r| r.delay)
        .map(|d| d as f64)
}

// ----- Skip / progress bookkeeping ---------------------------------------

fn record_skip(g: &mut Shared, url: &Url, reason: &str) {
    *g.reasons.entry(reason.to_string()).or_insert(0) += 1;
    if reason != R_OFF_SCOPE {
        g.errors += 1;
    }
    let status = if reason == R_OFF_SCOPE || reason == R_ROBOTS {
        "skipped"
    } else {
        "failed"
    };
    g.items.push(CapturedItem {
        url: url.as_str().to_string(),
        status: status.to_string(),
        local_path: String::new(),
        reason: reason.to_string(),
    });
}

fn classify_error(e: &str) -> &'static str {
    let lo = e.to_lowercase();
    if lo.contains("http 429") || lo.contains("http 403") {
        R_BLOCKED
    } else if lo.contains("http ") {
        R_HTTP_ERROR
    } else if lo.contains("timed out") || lo.contains("timeout") {
        R_TIMEOUT
    } else if lo.contains("too large") {
        R_TOO_LARGE
    } else if lo.contains("dns")
        || lo.contains("connect")
        || lo.contains("connection")
        || lo.contains("network")
        || lo.contains("sending request")
        || lo.contains("reset")
        || lo.contains("unreachable")
        || lo.contains("resolve")
    {
        R_CONNECT
    } else {
        R_HTTP_ERROR
    }
}

/// True when an IO error is a disk-full condition (ENOSPC).
fn is_disk_full(e: &std::io::Error) -> bool {
    #[cfg(unix)]
    {
        if e.raw_os_error() == Some(28) {
            return true;
        }
    }
    #[cfg(windows)]
    {
        // ERROR_DISK_FULL = 112, ERROR_HANDLE_DISK_FULL = 39.
        if matches!(e.raw_os_error(), Some(112) | Some(39)) {
            return true;
        }
    }
    let msg = e.to_string().to_lowercase();
    msg.contains("no space") || msg.contains("disk full")
}

/// Set the paused-state stop_reason copy when entering an auto/user pause (only
/// if one isn't already set by a more specific trigger like disk-full/offline).
fn set_pause_reason(g: &mut Shared, c: Control) {
    if !g.stop_reason.is_empty() {
        return;
    }
    g.stop_reason = match c {
        Control::Paused => "Paused. Resume to continue where you left off.".to_string(),
        Control::Offline => "Offline — waiting to reconnect.".to_string(),
        Control::SessionExpired => {
            "Your interlinedlist.com session expired. Sign in to resume.".to_string()
        }
        Control::DiskFull => "Out of disk space. Free some space, then Resume.".to_string(),
        _ => String::new(),
    };
}

fn snapshot_progress(g: &Shared, status: &str, elapsed: u64) -> CrawlProgress {
    CrawlProgress {
        job_dir: path_string(&g.out_dir),
        status: status.to_string(),
        current_url: String::new(),
        pages_done: g.pages_done,
        pages_discovered: g.pages_discovered,
        queue_depth: g.frontier.len() as u32,
        bytes_downloaded: g.bytes_downloaded,
        errors: g.errors,
        reasons: g.reasons.clone(),
        elapsed_secs: elapsed,
        stop_reason: g.stop_reason.clone(),
        host: g.seed_host.clone(),
        url: g.cfg.url.clone(),
    }
}

fn emit_now<F>(g: &Shared, emit: &Arc<F>, started: Instant)
where
    F: Fn(CrawlProgress) + Send + Sync + 'static,
{
    let prog = snapshot_progress(g, &g.status, g.base_elapsed + started.elapsed().as_secs());
    (emit)(prog);
}

// ----- Local path allocation ---------------------------------------------

/// Map a URL to a stable local relative path. The seed page becomes
/// `index.html`; other pages mirror their path, with directory-style URLs
/// getting an `index.html`.
fn allocate_local_path(g: &mut Shared, url: &Url) -> String {
    if normalize(url) == normalize(&g.seed) {
        g.used_paths.insert("index.html".to_string());
        return "index.html".to_string();
    }

    let mut path = url.path().trim_start_matches('/').to_string();
    if path.is_empty() || path.ends_with('/') {
        path.push_str("index.html");
    } else if !path.to_lowercase().ends_with(".html") && !path.to_lowercase().ends_with(".htm") {
        // Add .html so it opens as a page and avoids clashing with dirs.
        path.push_str(".html");
    }

    // Sanitize each segment; keep the directory structure.
    let sanitized: Vec<String> = path
        .split('/')
        .map(|seg| {
            seg.chars()
                .map(|c| {
                    if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                        c
                    } else {
                        '_'
                    }
                })
                .collect::<String>()
        })
        .filter(|s| !s.is_empty())
        .collect();
    let mut rel = sanitized.join("/");
    if rel.is_empty() {
        rel = "page.html".to_string();
    }

    // Encode the query into the filename to disambiguate ?a=1 vs ?a=2.
    if let Some(q) = url.query() {
        let qhash: String = q
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
            .take(24)
            .collect();
        rel = match rel.rfind('.') {
            Some(dot) => format!("{}__{}{}", &rel[..dot], qhash, &rel[dot..]),
            None => format!("{rel}__{qhash}"),
        };
    }

    // Ensure uniqueness.
    if g.used_paths.contains(&rel) {
        let mut n = 2;
        loop {
            let candidate = match rel.rfind('.') {
                Some(dot) => format!("{}_{}{}", &rel[..dot], n, &rel[dot..]),
                None => format!("{rel}_{n}"),
            };
            if !g.used_paths.contains(&candidate) {
                rel = candidate;
                break;
            }
            n += 1;
        }
    }
    g.used_paths.insert(rel.clone());
    rel
}

// ----- Finalization: inter-page link rewrite + write ---------------------

/// Rewrite `<a href>` links to captured pages into local relative paths, keep
/// uncaptured/off-scope links absolute, then write each page file (FR-ASSET-2).
fn finalize(g: &mut Shared) {
    let pending = std::mem::take(&mut g.pending_rewrites);
    for page in pending {
        let mut html = page.html;

        // For each captured target, replace occurrences of the (absolute or
        // page-relative) href with a path relative to THIS page's location.
        // We match on the resolved absolute URL string and known relative forms.
        let from_dir = parent_rel(&local_of(g, &page.page_url));

        for (norm_target, target_local) in &g.captured {
            if norm_target == &normalize(&page.page_url) {
                continue;
            }
            let rel = relative_path(&from_dir, target_local);
            // The HTML still holds ORIGINAL hrefs. Resolve each captured target
            // back to candidate original strings is lossy; instead we rewrite by
            // matching the absolute URL and its common relative spellings.
            if let Ok(target_url) = Url::parse(&reconstruct(norm_target)) {
                for candidate in href_candidates(&page.page_url, &target_url) {
                    html = scrape::replace_attr_value(&html, &candidate, &rel);
                }
            }
        }

        if let Some(parent) = page.abs_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&page.abs_path, html.as_bytes());
    }
}

fn local_of(g: &Shared, url: &Url) -> String {
    g.captured
        .get(&normalize(url))
        .cloned()
        .unwrap_or_else(|| "index.html".to_string())
}

/// Directory portion (relative) of a local page path, e.g. `docs/guide.html`
/// -> `docs`. Root pages -> "".
fn parent_rel(local: &str) -> String {
    match local.rfind('/') {
        Some(i) => local[..i].to_string(),
        None => String::new(),
    }
}

/// Compute a path to `target` relative to a page living in directory `from_dir`.
fn relative_path(from_dir: &str, target: &str) -> String {
    let from_parts: Vec<&str> = if from_dir.is_empty() {
        vec![]
    } else {
        from_dir.split('/').collect()
    };
    let target_parts: Vec<&str> = target.split('/').collect();

    // Common prefix.
    let mut common = 0;
    let tdir = &target_parts[..target_parts.len().saturating_sub(1)];
    while common < from_parts.len() && common < tdir.len() && from_parts[common] == tdir[common] {
        common += 1;
    }
    let ups = from_parts.len() - common;
    let mut rel = String::new();
    for _ in 0..ups {
        rel.push_str("../");
    }
    rel.push_str(&target_parts[common..].join("/"));
    if rel.is_empty() {
        rel = target.to_string();
    }
    rel
}

/// A crude reconstruction of an absolute URL from our normalized form so we can
/// re-parse it. `normalize` already yields a valid absolute URL string.
fn reconstruct(norm: &str) -> String {
    norm.to_string()
}

/// Candidate original href spellings for `target` as it may appear in `page`'s
/// HTML: the absolute URL, the root-relative path, and the page-relative path.
fn href_candidates(page: &Url, target: &Url) -> Vec<String> {
    let mut out = Vec::new();
    out.push(target.as_str().to_string());
    // Absolute without trailing slash variant.
    out.push(target.as_str().trim_end_matches('/').to_string());
    // Root-relative.
    let mut rootrel = target.path().to_string();
    if let Some(q) = target.query() {
        rootrel.push('?');
        rootrel.push_str(q);
    }
    out.push(rootrel.clone());
    out.push(rootrel.trim_end_matches('/').to_string());
    // Page-relative (last segment) when same directory.
    if page.host_str() == target.host_str() {
        if let (Some(pp), Some(tp)) = (page.path_segments(), target.path_segments()) {
            let pdir: Vec<&str> = pp.collect();
            let tdir: Vec<&str> = tp.collect();
            if pdir.len() >= 1 && !tdir.is_empty() {
                out.push(tdir.join("/"));
                out.push(tdir.last().copied().unwrap_or("").to_string());
            }
        }
    }
    out.retain(|s| !s.is_empty());
    out.sort();
    out.dedup();
    out
}

// Config helper for robots UA.
impl CrawlConfig {
    fn effective_ua(&self) -> String {
        self.user_agent
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(default_user_agent)
    }
}
