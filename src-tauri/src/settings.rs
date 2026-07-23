//! Persistent app settings + first-run acknowledgment (M5, FR-SET-1/2, LG-TOS-1).
//!
//! Settings are stored as a small JSON file in the OS app-config directory
//! (`<config-dir>/Offline Web/settings.json`) — NOT in the keychain
//! (no secrets live here). This is a deliberately dependency-light store: a
//! single serde struct read/written whole, with `#[serde(default)]` on every
//! field so an older/partial file upgrades cleanly.
//!
//! Nothing here ever touches the auth token, the password, or scraped content
//! (NFR-SEC-1/2, LG-PII-1). The only user-content-adjacent value stored is the
//! *mirrors root folder path* the user picked — a path, not content.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::scrape::{default_user_agent, expand_home};

/// The persisted settings document. Every field defaults so a missing file or a
/// file written by an older build still deserializes (forward/backward safe).
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    /// True once the user has seen (and dismissed) the first-run ToS
    /// acknowledgment (LG-TOS-1). Never re-prompt when set.
    #[serde(default)]
    pub acknowledged: bool,

    /// Opt-in crash reporting (Q11 / LG-PII-1). Default OFF — consent is opt-in
    /// and never includes scraped content or URLs.
    #[serde(default)]
    pub crash_reports: bool,

    /// Whether completion / error / session native notifications fire
    /// (NFR-XPLAT-1). Default ON.
    #[serde(default = "default_true")]
    pub notifications: bool,

    // ---- Scrape defaults (FR-SET-2). These pre-populate New Scrape. The safe
    // set (page-only, respect robots, polite rate, same-domain, static) MUST
    // remain the defaults. ----
    /// `"page"` | `"site"`. Default `"page"` (this-page-only).
    #[serde(default = "default_scope")]
    pub default_scope: String,
    /// Default whole-site depth preset. Default 2.
    #[serde(default = "default_depth")]
    pub default_depth: u32,
    /// Capture images/CSS/fonts/JS by default. Default true.
    #[serde(default = "default_true")]
    pub default_assets: bool,
    /// Render JavaScript by default. Default false (static — FR-RENDER-1).
    #[serde(default)]
    pub default_render: bool,
    /// `"same"` | `"subdomains"` | `"list"` | `"any"`. Default `"same"`.
    #[serde(default = "default_domain_scope")]
    pub default_domain_scope: String,

    // ---- Storage (FR-SET-1) ----
    /// The mirrors root folder. `~` is expanded at use. Platform-appropriate
    /// default (`~/Offline Web`). Changeable via the native picker.
    #[serde(default = "default_mirrors_root")]
    pub mirrors_root: String,

    /// The images root folder for the image-download feature. Downloads land in
    /// `<images_root>/<query-slug>/`. Default `~/Offline Web/Images`.
    #[serde(default = "default_images_root")]
    pub images_root: String,

    // ---- Network (FR-SET-1) ----
    /// Global rate cap (req/s/host). Default 1 (polite).
    #[serde(default = "default_rate")]
    pub rate_per_sec: f64,
    /// Concurrency (workers). Default 2.
    #[serde(default = "default_concurrency")]
    pub concurrency: u32,
    /// Respect robots.txt by default. Default true.
    #[serde(default = "default_true")]
    pub respect_robots: bool,
    /// Truthful, configurable User-Agent (LG-RATE-2).
    #[serde(default = "default_user_agent")]
    pub user_agent: String,

    // ---- Appearance ----
    /// UI theme: `"system"` | `"light"` | `"dark"`. Default `"system"`. Mirrors
    /// the account's InterlinedList preference; cached locally so startup has no
    /// flash and it still applies offline.
    #[serde(default = "default_theme")]
    pub theme: String,
}

fn default_true() -> bool { true }
fn default_scope() -> String { "page".to_string() }
fn default_depth() -> u32 { 2 }
fn default_domain_scope() -> String { "same".to_string() }
fn default_mirrors_root() -> String { "~/Offline Web".to_string() }
fn default_images_root() -> String { "~/Offline Web/Images".to_string() }
fn default_rate() -> f64 { 1.0 }
fn default_concurrency() -> u32 { 2 }
fn default_theme() -> String { "system".to_string() }

impl Default for AppSettings {
    fn default() -> Self {
        // Round-trips through serde so the defaults live in exactly one place
        // (the `#[serde(default = ...)]` fns above).
        serde_json::from_str("{}").expect("empty object deserializes to defaults")
    }
}

/// Cross-platform app-config directory: `<config>/Offline Web/`.
/// - macOS:   `~/Library/Application Support/Offline Web/`
/// - Windows: `%APPDATA%\Offline Web\`
/// - Linux:   `$XDG_CONFIG_HOME` or `~/.config/Offline Web/`
///
/// Kept dependency-light (no `dirs`/`directories` crate) to honor NFR-SIZE-1.
fn config_dir() -> PathBuf {
    let base: PathBuf = {
        #[cfg(target_os = "macos")]
        {
            expand_home("~/Library/Application Support")
        }
        #[cfg(target_os = "windows")]
        {
            std::env::var_os("APPDATA")
                .map(PathBuf::from)
                .unwrap_or_else(|| expand_home("~"))
        }
        #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
        {
            std::env::var_os("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| expand_home("~/.config"))
        }
    };
    base.join("Offline Web")
}

fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

/// Load settings from disk, falling back to defaults on any error (missing file,
/// malformed JSON, unreadable). A never-run install returns defaults.
pub fn load() -> AppSettings {
    let path = settings_path();
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => AppSettings::default(),
    }
}

/// Persist settings to disk (creating the config dir if needed). Write-then-
/// rename so a crash mid-write can't corrupt the file.
pub fn save(settings: &AppSettings) -> Result<(), String> {
    let dir = config_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create config dir: {e}"))?;
    let path = settings_path();
    let tmp = path.with_extension("json.tmp");
    let text =
        serde_json::to_string_pretty(settings).map_err(|e| format!("Could not serialize: {e}"))?;
    fs::write(&tmp, text.as_bytes()).map_err(|e| format!("Could not write settings: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("Could not save settings: {e}"))?;
    Ok(())
}

/// Mark the first-run acknowledgment seen (LG-TOS-1) without disturbing other
/// fields. Idempotent.
pub fn mark_acknowledged() -> Result<(), String> {
    let mut s = load();
    if s.acknowledged {
        return Ok(());
    }
    s.acknowledged = true;
    save(&s)
}
