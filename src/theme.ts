/**
 * Theme (appearance) control — system / light / dark.
 *
 * The chosen theme is applied by setting `data-theme` on <html>; the CSS in
 * styles/brand.css maps each value (and, for "system", the OS `prefers-color-
 * scheme`) to the dark or light token set.
 *
 * Source of truth is the InterlinedList account so the preference follows the
 * user across devices ("retrieve that setting on startup"). It is also cached
 * locally in AppSettings so the first paint has no flash and it still applies
 * offline. Flow:
 *   startup   -> initTheme() applies the local cache immediately, then
 *                syncThemeFromAccount() pulls the account value and re-applies.
 *   on change -> setTheme() applies, caches locally, and pushes to the account.
 */

import { getSettings, saveSettings, type Theme } from "./settings";
import { isTauri } from "./tauri";

const darkQuery = (): MediaQueryList | null =>
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

/** Whether the given theme resolves to dark right now (accounts for "system"). */
function isDark(theme: Theme): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return darkQuery()?.matches ?? false;
}

/** Keep the native title-bar / meta color in step with the effective theme. */
function updateThemeColor(theme: Theme): void {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", isDark(theme) ? "#0c2c3a" : "#184860");
}

/** Apply a theme now. Safe to call before the first render (avoids a flash). */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  updateThemeColor(theme);
}

/**
 * Apply the locally-cached theme and wire the OS-scheme listener so a "system"
 * choice tracks the OS flipping light<->dark while the app is open. Call once,
 * after settings are loaded and before the first render.
 */
export function initTheme(): void {
  applyTheme(getSettings().theme);
  darkQuery()?.addEventListener?.("change", () => {
    if (getSettings().theme === "system") updateThemeColor("system");
  });
}

/**
 * Change the theme: apply immediately, cache locally, and push to the
 * InterlinedList account (best-effort — the local cache is the durable store).
 */
export async function setTheme(theme: Theme): Promise<void> {
  applyTheme(theme);
  await saveSettings({ theme });
  if (!isTauri()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_remote_theme", { theme });
  } catch {
    /* best-effort; the local cache already holds the choice */
  }
}

/**
 * Pull the account's theme from InterlinedList and apply it if it differs from
 * the local cache. Non-blocking; leaves the local value in place on any failure.
 */
export async function syncThemeFromAccount(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const remote = await invoke<Theme | null>("get_remote_theme");
    if (remote && remote !== getSettings().theme) {
      applyTheme(remote);
      await saveSettings({ theme: remote });
    }
  } catch {
    /* keep the local theme */
  }
}
