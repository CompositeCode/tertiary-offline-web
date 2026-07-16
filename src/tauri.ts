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
export interface Session {
  username: string;
  token: string;
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
  ratePerSec: number;
  concurrency: number;
  respectRobots: boolean;
  userAgent?: string;
  maxPages: number;
  maxBytes: number;
  maxSeconds: number;
}

/** Live progress payload from `crawl://progress` events. */
export interface CrawlProgress {
  status: "running" | "finishing" | "done" | "stopped" | "capped" | "error";
  currentUrl: string;
  pagesDone: number;
  pagesDiscovered: number;
  queueDepth: number;
  bytesDownloaded: number;
  errors: number;
  reasons: Record<string, number>;
  elapsedSecs: number;
  stopReason: string;
}

export interface CapturedItem {
  url: string;
  status: "captured" | "partial" | "skipped" | "failed";
  localPath: string;
  reason: string;
}

/** Final result from `start_crawl`. */
export interface CrawlResult {
  output_dir: string;
  index_path: string;
  page_count: number;
  asset_count: number;
  failed_asset_count: number;
  total_bytes: number;
  status: "done" | "stopped" | "capped" | "error";
  stopReason: string;
  reasons: Record<string, number>;
  items: CapturedItem[];
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

export function mockLogin(username: string, password: string): Promise<Session> {
  return invokeCmd<Session>("mock_login", { username, password });
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
