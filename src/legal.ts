/**
 * Acceptable-use / ToS wiring (M5, LG-TOS-1/2).
 *
 * The full acceptable-use document lives at docs/acceptable-use.md and, in
 * production, at interlinedlist.com. From the app we open the hosted copy so the
 * link is always current; browser mode opens a new tab. Kept in one place so the
 * URL swaps in a single edit.
 */

import { isTauri } from "./tauri";
import { IL_SITE_URL } from "./brand";

/** Canonical hosted location of the acceptable-use guide. */
export const ACCEPTABLE_USE_URL = `${IL_SITE_URL}/offline/acceptable-use`;

/** Open the acceptable-use guide in the system browser (Settings/About link). */
export async function openAcceptableUse(): Promise<void> {
  await openExternal(ACCEPTABLE_USE_URL);
}

async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    } catch {
      // fall through to window.open as a last resort
    }
  }
  window.open(url, "_blank", "noopener");
}
