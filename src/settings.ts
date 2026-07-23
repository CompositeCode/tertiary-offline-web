/**
 * App settings + first-run acknowledgment bridge (M5, FR-SET-1/2, LG-TOS-1).
 *
 * Settings persist in a JSON file in the OS app-config dir via the Rust
 * `get_settings`/`save_settings` commands (see src-tauri/src/settings.rs). No
 * secrets live here. This module caches the loaded settings for the session and
 * degrades gracefully in browser mode (returns in-memory defaults; nothing is
 * persisted without the native backend).
 */

import { isTauri } from "./tauri";

/** UI theme preference. `"system"` follows the OS light/dark setting. */
export type Theme = "system" | "light" | "dark";

/** Mirrors the Rust `AppSettings` (serde camelCase). */
export interface AppSettings {
  acknowledged: boolean;
  crashReports: boolean;
  notifications: boolean;
  defaultScope: "page" | "site";
  defaultDepth: number;
  defaultAssets: boolean;
  defaultRender: boolean;
  defaultDomainScope: "same" | "subdomains" | "list" | "any";
  mirrorsRoot: string;
  imagesRoot: string;
  ratePerSec: number;
  concurrency: number;
  respectRobots: boolean;
  userAgent: string;
  theme: Theme;
}

/** The safe-by-default set (FR-SET-2). Kept identical to the Rust defaults. */
export const DEFAULT_SETTINGS: AppSettings = {
  acknowledged: false,
  crashReports: false,
  notifications: true,
  defaultScope: "page",
  defaultDepth: 2,
  defaultAssets: true,
  defaultRender: false,
  defaultDomainScope: "same",
  mirrorsRoot: "~/Offline Web",
  imagesRoot: "~/Offline Web/Images",
  ratePerSec: 1,
  concurrency: 2,
  respectRobots: true,
  userAgent: "OfflineWeb/0.1.0 (+https://interlinedlist.com)",
  theme: "system",
};

/** Session cache of the loaded settings (source of truth is the Rust file). */
let cached: AppSettings = { ...DEFAULT_SETTINGS };
let loaded = false;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/**
 * Load settings from the backend (once per session; subsequent calls return the
 * cache). In browser mode there's no store — returns the in-memory defaults.
 */
export async function loadSettings(force = false): Promise<AppSettings> {
  if (loaded && !force) return cached;
  if (!isTauri()) {
    loaded = true;
    return cached;
  }
  try {
    const s = await invoke<AppSettings>("get_settings");
    cached = { ...DEFAULT_SETTINGS, ...s };
  } catch {
    cached = { ...DEFAULT_SETTINGS };
  }
  loaded = true;
  return cached;
}

/** The cached settings without a round-trip (call `loadSettings` on launch). */
export function getSettings(): AppSettings {
  return cached;
}

/**
 * Persist a partial update, merging into the cache. In browser mode this only
 * updates the in-memory cache (no store to write to).
 */
export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  cached = { ...cached, ...patch };
  if (isTauri()) {
    try {
      await invoke<void>("save_settings", { settings: cached });
    } catch {
      // Keep the in-memory update even if the disk write fails; the next
      // successful save will re-persist.
    }
  }
  return cached;
}

/** True once the user has dismissed the first-run acknowledgment (LG-TOS-1). */
export function isAcknowledged(): boolean {
  return cached.acknowledged;
}

/** Record the first-run acknowledgment (LG-TOS-1). Never re-prompt after. */
export async function markAcknowledged(): Promise<void> {
  cached.acknowledged = true;
  if (isTauri()) {
    try {
      await invoke<void>("mark_acknowledged");
    } catch {
      // Non-fatal; the flag is at least set in-session.
    }
  }
}
