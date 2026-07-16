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
