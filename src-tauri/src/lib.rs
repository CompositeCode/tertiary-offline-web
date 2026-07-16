//! InterlinedList Offline — Tauri backend.
//!
//! Commands:
//!  - `login`           : real auth against interlinedlist.com sync-token API,
//!                        token stored in the OS keychain (never returned)
//!  - `current_session` : validate a stored token on launch (Library vs Sign-in)
//!  - `logout`          : invalidate + clear the stored token
//!  - `scrape_page`     : single-page static scrape to disk (M0)
//!  - `start_crawl`     : polite bounded whole-site crawl with progress events (M1)
//!  - `stop_crawl`      : cooperatively stop the running crawl, keeping partials (M1)
//!  - `pause_crawl`     : cooperatively pause (idle workers, keep frontier) (M2)
//!  - `resume_crawl`    : resume a paused *running* job in place (M2)
//!  - `set_crawl_rate`  : retune the live limiter without restarting (M2)
//!  - `resume_job`      : resume a persisted job from disk after restart (M2)
//!  - `list_jobs`       : scan the mirrors root for persisted jobs (M2)
//!  - `load_job`        : read one persisted job's full state (M2)
//!  - `check_session`   : validate the IL session; auto-pause on expiry (M2)
//!  - `open_path`       : reveal/open a file or folder
//!
//! Job model (v1: one job at a time — Q8): a running crawl registers a
//! `crawl::Controller` in `CrawlState`. Pause/Resume/Stop/Rate and the
//! session-expiry check act on that controller. Crawls run on a background
//! thread so the command returns immediately and the UI stays responsive
//! (NFR-PERF-2); progress arrives via `crawl://progress` events.

mod auth;
mod crawl;
mod scrape;

use auth::Session;
use crawl::{Controller, CrawlConfig, CrawlProgress, CrawlResult, JobSummary, PersistedJob};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

/// App-wide state: the controller for the single active crawl (v1 runs one job
/// at a time — Q8). `None` when no crawl is running.
#[derive(Default)]
struct CrawlState {
    controller: Mutex<Option<Controller>>,
}

impl CrawlState {
    /// The active controller, if a crawl is running.
    fn current(&self) -> Option<Controller> {
        self.controller.lock().unwrap().clone()
    }
}

/// Sign in with email + password against interlinedlist.com's sync-token API.
#[tauri::command]
fn login(email: String, password: String) -> Result<Session, String> {
    auth::login_command(email, password)
}

/// Validate any stored token on launch and return the session if valid.
#[tauri::command]
fn current_session() -> Option<Session> {
    auth::current_session()
}

/// Sign out: best-effort server-side invalidation, then clear the keychain.
#[tauri::command]
fn logout() {
    auth::logout();
}

/// Scrape a single page to `<out_root>/<host>/`.
#[tauri::command]
fn scrape_page(url: String, out_root: String) -> Result<scrape::ScrapeResult, String> {
    scrape::scrape_page(&url, &out_root)
}

/// Register a controller as the active crawl, rejecting if one is already live.
fn register_active(app: &tauri::AppHandle, controller: &Controller) -> Result<(), String> {
    let state = app.state::<CrawlState>();
    let mut guard = state.controller.lock().unwrap();
    if guard.is_some() {
        return Err("A crawl is already running.".to_string());
    }
    *guard = Some(controller.clone());
    Ok(())
}

/// Clear the active-crawl registration (only if it's still this controller).
fn clear_active(app: &tauri::AppHandle, controller: &Controller) {
    let state = app.state::<CrawlState>();
    let mut guard = state.controller.lock().unwrap();
    if let Some(active) = guard.as_ref() {
        if Arc::ptr_eq(&active.job_dir, &controller.job_dir) {
            *guard = None;
        }
    }
}

/// Run a crawl (fresh or resumed) to a pause/stop/completion, emitting progress
/// and firing a native notification on a clean finish. Shared by `start_crawl`
/// and `resume_job`.
fn drive_crawl(
    app: tauri::AppHandle,
    config: CrawlConfig,
    controller: Controller,
    resume: Option<PersistedJob>,
) -> Result<CrawlResult, String> {
    let emit_app = app.clone();
    let emit = move |progress: CrawlProgress| {
        let _ = emit_app.emit("crawl://progress", progress);
    };

    let result = crawl::run_crawl(config, controller.clone(), resume, emit);

    clear_active(&app, &controller);

    // Fire a native OS notification on a genuine completion (FR-PROG-5). Paused
    // states (offline / session-expired / disk-full / user pause) don't notify.
    if let Ok(res) = &result {
        match res.status.as_str() {
            "done" => notify(&app, "Mirror complete", &format!(
                "Captured {} page{}.",
                res.page_count,
                if res.page_count == 1 { "" } else { "s" }
            )),
            "capped" => notify(&app, "Mirror stopped at a limit", &res.stop_reason),
            _ => {}
        }
    }

    result
}

/// Start a polite, bounded crawl. Runs off the UI thread; emits
/// `crawl://progress`; resolves with the final `CrawlResult` (which may be a
/// paused status). Only one crawl runs at a time.
#[tauri::command]
fn start_crawl(app: tauri::AppHandle, config: CrawlConfig) -> Result<CrawlResult, String> {
    let out_dir = crawl::output_dir_for(&config)?;
    let controller = Controller::new(
        out_dir,
        config.url.clone(),
        config.rate_per_sec,
        config.concurrency,
    );
    register_active(&app, &controller)?;
    drive_crawl(app, config, controller, None)
}

/// Resume a persisted job from disk after a restart / crash (NFR-RESUME-1).
/// Reads `<job_dir>/.iloffline/job.json`, then continues from the saved frontier
/// without re-fetching completed pages. Resolves with the final `CrawlResult`.
#[tauri::command]
fn resume_job(app: tauri::AppHandle, job_dir: String) -> Result<CrawlResult, String> {
    let persisted = crawl::load_persisted(&job_dir)?;
    if persisted.frontier.is_empty() {
        return Err("Nothing left to resume — this job is complete.".to_string());
    }
    let config = persisted.config.clone();
    let out_dir = crawl::output_dir_for(&config)?;
    let controller = Controller::new(
        out_dir,
        config.url.clone(),
        config.rate_per_sec,
        config.concurrency,
    );
    register_active(&app, &controller)?;
    drive_crawl(app, config, controller, Some(persisted))
}

/// Cooperatively stop the running crawl (finalize + keep partials).
#[tauri::command]
fn stop_crawl(app: tauri::AppHandle) -> Result<(), String> {
    match app.state::<CrawlState>().current() {
        Some(c) => {
            c.stop();
            Ok(())
        }
        None => Err("No crawl is running.".to_string()),
    }
}

/// Pause the running crawl: workers idle without dropping the frontier (M2).
#[tauri::command]
fn pause_crawl(app: tauri::AppHandle) -> Result<(), String> {
    match app.state::<CrawlState>().current() {
        Some(c) => {
            c.pause();
            Ok(())
        }
        None => Err("No crawl is running.".to_string()),
    }
}

/// Resume a paused (but still in-process) crawl in place.
#[tauri::command]
fn resume_crawl(app: tauri::AppHandle) -> Result<(), String> {
    match app.state::<CrawlState>().current() {
        Some(c) => {
            c.resume();
            Ok(())
        }
        None => Err("No crawl is running.".to_string()),
    }
}

/// Retune the live rate (and optionally concurrency) without restarting (M2).
#[tauri::command]
fn set_crawl_rate(
    app: tauri::AppHandle,
    rate_per_sec: f64,
    concurrency: Option<u32>,
) -> Result<(), String> {
    match app.state::<CrawlState>().current() {
        Some(c) => {
            c.set_rate(rate_per_sec, concurrency);
            Ok(())
        }
        None => Err("No crawl is running.".to_string()),
    }
}

/// Scan the mirrors root for persisted jobs so the Library survives restart.
#[tauri::command]
fn list_jobs(out_root: Option<String>) -> Vec<JobSummary> {
    let root = out_root.unwrap_or_else(|| "~/InterlinedList Offline".to_string());
    crawl::list_jobs(&root)
}

/// Load one persisted job's full state (for Results after a cold start).
#[tauri::command]
fn load_job(job_dir: String) -> Result<PersistedJob, String> {
    crawl::load_persisted(&job_dir)
}

/// Validate the IL session; if it's invalid and a job is running, auto-PAUSE it
/// (never fail — FR-AUTH-5) and return false so the frontend prompts re-sign-in.
/// Returns true when the session is valid.
#[tauri::command]
fn check_session(app: tauri::AppHandle) -> bool {
    let valid = auth::session_is_valid();
    if !valid {
        if let Some(c) = app.state::<CrawlState>().current() {
            c.signal_session_expired();
            notify(
                &app,
                "Sign-in needed",
                "Your interlinedlist.com session expired. Sign in to resume your mirror.",
            );
        }
    }
    valid
}

/// Open/reveal a file or folder in the OS default handler.
#[tauri::command]
fn open_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| format!("Could not open path: {e}"))
}

/// Fire a native OS notification (best-effort — a missing permission is not an
/// error worth surfacing).
fn notify(app: &tauri::AppHandle, title: &str, body: &str) {
    let _ = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show();
}

/// Background watcher: while a job is auto-paused `offline`, probe connectivity
/// and auto-resume when the network returns (FR-PROG-6 / §2.5). Cheap: only
/// probes when something is actually offline.
fn spawn_offline_watcher(app: tauri::AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(5));
        let state = app.state::<CrawlState>();
        let Some(controller) = state.current() else {
            continue;
        };
        // Only act when the current job is in the auto-offline state.
        if !controller.is_offline() {
            continue;
        }
        // Probe the seed host; resume if back online.
        let url = controller.probe_url();
        if !url.is_empty() && crawl::is_online(&url) {
            controller.resume();
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(CrawlState::default())
        .setup(|app| {
            spawn_offline_watcher(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            login,
            current_session,
            logout,
            scrape_page,
            start_crawl,
            stop_crawl,
            pause_crawl,
            resume_crawl,
            set_crawl_rate,
            resume_job,
            list_jobs,
            load_job,
            check_session,
            open_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running InterlinedList Offline");
}
