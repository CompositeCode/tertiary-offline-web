/**
 * Thin bridge to the Tauri backend that degrades gracefully in a plain browser.
 *
 * When running under `npm run dev` (no Tauri runtime), `isTauri()` is false and
 * the UI shows a mock/disabled state ("Runs in the desktop app.") instead of
 * calling native commands. Under `npm run tauri dev` the real `invoke` is used.
 */

/** True when the Tauri runtime is present (i.e. running in the desktop app). */
export function isTauri(): boolean {
  // Tauri v2 injects `__TAURI_INTERNALS__` into the webview window.
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// ---- Backend types (mirror the Rust structs) ---------------------------
/**
 * The session the backend exposes to the UI. Deliberately carries only the
 * account email — the Bearer sync token stays in the OS keychain and never
 * crosses into the frontend (NFR-SEC-1, FR-AUTH-3).
 */
export interface Session {
  email: string;
}

export interface ScrapeResult {
  output_dir: string;
  index_path: string;
  page_count: number;
  asset_count: number;
  failed_asset_count: number;
  total_bytes: number;
}

// ---- Crawl (M1) --------------------------------------------------------

/** Config sent to `start_crawl` (serde camelCase on the Rust side). */
export interface CrawlConfig {
  url: string;
  /** "page" (this page only) or "site" (whole site). */
  scope: "page" | "site";
  depth: number;
  /** "same" | "subdomains" | "list" | "any". */
  domainScope: "same" | "subdomains" | "list" | "any";
  allowedDomains: string[];
  outRoot: string;
  /** Explicit output dir (re-scrape dated folders); default layout otherwise. */
  outDirOverride?: string;
  ratePerSec: number;
  concurrency: number;
  respectRobots: boolean;
  userAgent?: string;
  maxPages: number;
  maxBytes: number;
  maxSeconds: number;
}

/** Crawl lifecycle status, including M2 paused/auto-pause states. */
export type CrawlStatus =
  | "running"
  | "paused"
  | "offline"
  | "session-expired"
  | "disk-full"
  | "finishing"
  | "done"
  | "stopped"
  | "capped"
  | "error";

/** Live progress payload from `crawl://progress` events. */
export interface CrawlProgress {
  jobDir: string;
  status: CrawlStatus;
  currentUrl: string;
  pagesDone: number;
  pagesDiscovered: number;
  queueDepth: number;
  bytesDownloaded: number;
  errors: number;
  reasons: Record<string, number>;
  elapsedSecs: number;
  stopReason: string;
  host: string;
  url: string;
}

export interface CapturedItem {
  url: string;
  status: "captured" | "partial" | "skipped" | "failed";
  localPath: string;
  reason: string;
}

/** Final result from `start_crawl` / `resume_job` (may be a paused status). */
export interface CrawlResult {
  output_dir: string;
  index_path: string;
  page_count: number;
  asset_count: number;
  failed_asset_count: number;
  total_bytes: number;
  status: CrawlStatus;
  stopReason: string;
  reasons: Record<string, number>;
  items: CapturedItem[];
}

/**
 * A persisted job discovered on disk by `list_jobs` (Library survives restart).
 * `resumable` is true for paused / partial / interrupted jobs with queued work.
 */
export interface JobSummary {
  jobDir: string;
  url: string;
  host: string;
  status: CrawlStatus;
  stopReason: string;
  pageCount: number;
  totalBytes: number;
  assetCount: number;
  failedAssetCount: number;
  reasons: Record<string, number>;
  resumable: boolean;
  updatedAt: number;
  items: CapturedItem[];
  indexPath: string;
}

/** One persisted frontier entry. */
export interface PersistItem {
  url: string;
  depth: number;
}

/** Full on-disk job state (`<jobDir>/.iloffline/job.json`). */
export interface PersistedJob {
  version: number;
  config: CrawlConfig;
  status: CrawlStatus;
  stopReason: string;
  frontier: PersistItem[];
  visited: string[];
  items: CapturedItem[];
  captured: Record<string, string>;
  usedPaths: string[];
  pagesDone: number;
  pagesDiscovered: number;
  bytesDownloaded: number;
  errors: number;
  assetCount: number;
  failedAssetCount: number;
  reasons: Record<string, number>;
  elapsedSecs: number;
}

/**
 * Invoke a Tauri command. Throws in browser mode — callers must gate on
 * `isTauri()` first. We import `@tauri-apps/api/core` lazily so a plain browser
 * bundle never trips over a missing runtime at import time.
 */
async function invokeCmd<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error("Tauri runtime not available (browser mode).");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/**
 * Sign in against interlinedlist.com. Resolves with the `Session` (email only)
 * on success. Rejects with a string error prefixed by a stable kind
 * (`invalid: …` / `unreachable: …` / `other: …`). The password is passed once
 * to the backend and never retained here.
 */
export function login(email: string, password: string): Promise<Session> {
  return invokeCmd<Session>("login", { email, password });
}

/** Validate a stored token on launch. Returns the Session or null. */
export function currentSession(): Promise<Session | null> {
  return invokeCmd<Session | null>("current_session");
}

/** Sign out: invalidate + clear the stored token. */
export function logout(): Promise<void> {
  return invokeCmd<void>("logout");
}

export function scrapePage(url: string, outRoot: string): Promise<ScrapeResult> {
  return invokeCmd<ScrapeResult>("scrape_page", { url, outRoot });
}

export function openPath(path: string): Promise<void> {
  return invokeCmd<void>("open_path", { path });
}

/**
 * Start a crawl. Resolves with the final result when the crawl finishes or is
 * stopped. Live updates arrive via `onCrawlProgress`.
 */
export function startCrawl(config: CrawlConfig): Promise<CrawlResult> {
  return invokeCmd<CrawlResult>("start_crawl", { config });
}

/** Cooperatively stop the running crawl; partial results are kept. */
export function stopCrawl(): Promise<void> {
  return invokeCmd<void>("stop_crawl");
}

/** Pause the running crawl (workers idle, frontier kept). */
export function pauseCrawl(): Promise<void> {
  return invokeCmd<void>("pause_crawl");
}

/** Resume a paused (still in-process) crawl. */
export function resumeCrawl(): Promise<void> {
  return invokeCmd<void>("resume_crawl");
}

/** Retune the live rate (and optionally concurrency) without restarting. */
export function setCrawlRate(ratePerSec: number, concurrency?: number): Promise<void> {
  return invokeCmd<void>("set_crawl_rate", { ratePerSec, concurrency });
}

/**
 * Resume a persisted job from disk after a restart. Behaves like `startCrawl`:
 * resolves with the final `CrawlResult` and streams `crawl://progress` events.
 */
export function resumeJob(jobDir: string): Promise<CrawlResult> {
  return invokeCmd<CrawlResult>("resume_job", { jobDir });
}

/** Scan the mirrors root for persisted jobs (Library survives restart). */
export async function listJobs(outRoot?: string): Promise<JobSummary[]> {
  if (!isTauri()) return [];
  return invokeCmd<JobSummary[]>("list_jobs", { outRoot });
}

/** Load one persisted job's full state (for Results after a cold start). */
export function loadJob(jobDir: string): Promise<PersistedJob> {
  return invokeCmd<PersistedJob>("load_job", { jobDir });
}

/**
 * Validate the IL session. Returns true if valid; false auto-pauses any running
 * job on the backend (FR-AUTH-5) and signals the UI to prompt re-sign-in.
 */
export async function checkSession(): Promise<boolean> {
  if (!isTauri()) return true;
  return invokeCmd<boolean>("check_session");
}

// ---- Capture report + re-scrape + delete (M3) --------------------------

/** An inline remedy the report/Results UI can wire to a re-scrape. */
export interface InlineFix {
  /**
   * `render-js` | `increase-depth` | `allow-subdomains` | `ignore-robots` |
   * `raise-caps` | `re-scrape`.
   */
  action: string;
  label: string;
}

/** One skip-reason group with count, explanation, examples, optional fix. */
export interface SkipGroup {
  reason: string;
  label: string;
  count: number;
  explanation: string;
  fix: InlineFix | null;
  examples: string[];
}

/** Structured capture report (from `job_report`). */
export interface CaptureReport {
  host: string;
  url: string;
  status: CrawlStatus;
  stopReason: string;
  filesPresent: boolean;
  pages: number;
  assets: number;
  failedAssets: number;
  totalBytes: number;
  skipGroups: SkipGroup[];
  totalSkipped: number;
  fidelityNotes: string[];
  zeroCapture: boolean;
  topFix: InlineFix | null;
  resumable: boolean;
}

/** Partial config overrides an inline fix can request for a re-scrape. */
export interface ConfigOverrides {
  scope?: "page" | "site";
  depth?: number;
  domainScope?: "same" | "subdomains" | "list" | "any";
  respectRobots?: boolean;
  maxPages?: number;
  maxBytes?: number;
  maxSeconds?: number;
}

/** Options for `rescrape`: overwrite-in-place (else new dated capture) + fixes. */
export interface RescrapeOptions {
  overwrite?: boolean;
  overrides?: ConfigOverrides;
}

/** Build a capture report from a persisted job's manifest (FR-REPORT-1/2/3). */
export function jobReport(jobDir: string): Promise<CaptureReport> {
  return invokeCmd<CaptureReport>("job_report", { jobDir });
}

/** Check whether a mirror's captured files still exist on disk (FR-RES-4). */
export async function mirrorFilesPresent(jobDir: string): Promise<boolean> {
  if (!isTauri()) return true;
  return invokeCmd<boolean>("mirror_files_present", { jobDir });
}

/** Delete a capture folder safely (refuses paths outside the mirrors root). */
export function deleteMirror(jobDir: string, outRoot?: string): Promise<void> {
  return invokeCmd<void>("delete_mirror", { jobDir, outRoot });
}

/**
 * Re-scrape a job (Q12). New dated capture by default; `options.overwrite`
 * rewrites in place. Behaves like `startCrawl` (streams progress, resolves with
 * the final result).
 */
export function rescrape(
  jobDir: string,
  options?: RescrapeOptions,
): Promise<CrawlResult> {
  return invokeCmd<CrawlResult>("rescrape", { jobDir, options });
}

/**
 * Subscribe to live crawl progress. Returns an unlisten function. In browser
 * mode (no Tauri runtime) this is a no-op returning a no-op unlisten.
 */
export async function onCrawlProgress(
  handler: (p: CrawlProgress) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<CrawlProgress>("crawl://progress", (evt) => {
    handler(evt.payload);
  });
  return unlisten;
}
