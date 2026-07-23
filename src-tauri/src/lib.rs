//! Offline Web — Tauri backend.
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
//!  - `job_report`      : structured capture report from the manifest (M3)
//!  - `mirror_files_present` : detect files moved/deleted outside the app (M3)
//!  - `delete_mirror`   : safely delete a capture folder (within root) (M3)
//!  - `rescrape`        : re-run a job into a new dated capture / overwrite (M3)
//!  - `open_path`       : reveal/open a file or folder
//!
//! Job model (v1: one job at a time — Q8): a running crawl registers a
//! `crawl::Controller` in `CrawlState`. Pause/Resume/Stop/Rate and the
//! session-expiry check act on that controller. Crawls run on a background
//! thread so the command returns immediately and the UI stays responsive
//! (NFR-PERF-2); progress arrives via `crawl://progress` events.

mod auth;
mod crawl;
mod fsutil;
mod images;
mod render;
mod scrape;
mod settings;

use auth::Session;
use fsutil::{DiskUsage, PathCheck};
use images::{ImageDownloadResult, ImageProgress, ImageSearchConfig};
use settings::AppSettings;
use crawl::{
    CaptureReport, Controller, CrawlConfig, CrawlProgress, CrawlResult, JobSummary, PersistedJob,
    RescrapeOptions,
};
use std::sync::atomic::{AtomicBool, Ordering};
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

/// App-wide state for the single active image download: a cooperative cancel
/// flag `stop_image_download` can flip. `None` when no download is running.
#[derive(Default)]
struct ImageState {
    cancel: Mutex<Option<Arc<AtomicBool>>>,
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

/// Fetch the account's theme preference from InterlinedList (best-effort;
/// `None` when signed out/offline/unsupported). Applied on startup.
#[tauri::command]
fn get_remote_theme() -> Option<String> {
    auth::get_remote_theme()
}

/// Persist the account's theme preference to InterlinedList (best-effort).
#[tauri::command]
fn set_remote_theme(theme: String) -> Result<(), String> {
    auth::set_remote_theme_command(theme)
}

/// Scrape a single page to `<out_root>/<host>/`.
#[tauri::command]
fn scrape_page(url: String, out_root: String) -> Result<scrape::ScrapeResult, String> {
    scrape::scrape_page(&url, &out_root)
}

/// Search the web (Openverse) for openly-licensed images matching a term and
/// download them to `<out_root>/<query-slug>/`. Runs to completion off the UI
/// thread, streaming `images://progress` events, and can be cancelled by
/// `stop_image_download`. Only one download runs at a time.
#[tauri::command]
fn start_image_download(
    app: tauri::AppHandle,
    config: ImageSearchConfig,
) -> Result<ImageDownloadResult, String> {
    // Register a fresh cancel flag as the active download, rejecting if one is
    // already live (v1 runs one at a time, mirroring the crawler).
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let state = app.state::<ImageState>();
        let mut guard = state.cancel.lock().unwrap();
        if guard.is_some() {
            return Err("An image download is already running.".to_string());
        }
        *guard = Some(cancel.clone());
    }

    let emit_app = app.clone();
    let emit = move |progress: ImageProgress| {
        let _ = emit_app.emit("images://progress", progress);
    };
    let result = images::run_image_download(config, cancel, emit);

    // Clear the active-download registration regardless of outcome.
    *app.state::<ImageState>().cancel.lock().unwrap() = None;

    // Notify on a clean, non-empty finish (mirrors the crawl completion notice).
    if let Ok(res) = &result {
        if res.status == "done" && res.downloaded > 0 {
            notify(
                &app,
                "Images downloaded",
                &format!(
                    "Saved {} image{} for \u{201c}{}\u{201d}.",
                    res.downloaded,
                    if res.downloaded == 1 { "" } else { "s" },
                    res.query
                ),
            );
        }
    }

    result
}

/// Cooperatively stop the running image download; images already saved are kept.
#[tauri::command]
fn stop_image_download(app: tauri::AppHandle) -> Result<(), String> {
    match app.state::<ImageState>().cancel.lock().unwrap().as_ref() {
        Some(flag) => {
            flag.store(true, Ordering::Relaxed);
            Ok(())
        }
        None => Err("No image download is running.".to_string()),
    }
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
    let root = out_root.unwrap_or_else(|| settings::load().mirrors_root);
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

/// Build a capture report from a persisted job's manifest (FR-REPORT-1/2/3).
/// Captured totals vs. skipped grouped + explained, fidelity notes, inline
/// fixes, files-present flag, and zero-capture diagnosis.
#[tauri::command]
fn job_report(job_dir: String) -> Result<CaptureReport, String> {
    crawl::job_report(&job_dir)
}

/// Check whether a mirror's captured files still exist on disk (FR-RES-4). False
/// means the files were moved/deleted outside the app → Results shows recovery.
#[tauri::command]
fn mirror_files_present(job_dir: String) -> bool {
    crawl::mirror_files_present(&job_dir)
}

/// Delete a capture folder safely (FR-RES-2). Refuses any path that isn't
/// strictly inside the mirrors root.
#[tauri::command]
fn delete_mirror(job_dir: String, out_root: Option<String>) -> Result<(), String> {
    let root = out_root.unwrap_or_else(|| settings::load().mirrors_root);
    crawl::delete_mirror(&job_dir, &root)
}

/// Re-scrape a job (FR-OUT-3, Q12). Reuses the original settings (plus any
/// inline-fix overrides) and runs into a NEW dated capture folder by default
/// (non-destructive), or overwrites the original in place when
/// `options.overwrite` is set. Behaves like `start_crawl`: runs off-thread,
/// emits `crawl://progress`, resolves with the final `CrawlResult`.
#[tauri::command]
fn rescrape(
    app: tauri::AppHandle,
    job_dir: String,
    options: Option<RescrapeOptions>,
) -> Result<CrawlResult, String> {
    let opts = options.unwrap_or_default();
    let config = crawl::rescrape_config(&job_dir, &opts)?;
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

/// Report whether a usable system Chrome/Chromium was found, so the UI can
/// honestly enable/disable the "Render JavaScript" option (M4, brief E-7). No
/// browser is bundled (NFR-SIZE-1); this is a cheap filesystem/PATH probe.
#[tauri::command]
fn render_available() -> bool {
    render::render_available()
}

/// Open/reveal a file or folder in the OS default handler.
#[tauri::command]
fn open_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| format!("Could not open path: {e}"))
}

/// Reveal a file/folder in the platform file manager (Finder / Explorer /
/// Files) — the native "Show in …" action (NFR-XPLAT-1). Falls back to opening
/// the path if reveal isn't supported.
#[tauri::command]
fn reveal_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    match app.opener().reveal_item_in_dir(&path) {
        Ok(()) => Ok(()),
        Err(_) => app
            .opener()
            .open_path(path, None::<&str>)
            .map_err(|e| format!("Could not reveal path: {e}")),
    }
}

// ---- Settings + first-run ack (M5, FR-SET-1/2, LG-TOS-1) ----------------

/// Load persisted app settings (defaults on a first run).
#[tauri::command]
fn get_settings() -> AppSettings {
    settings::load()
}

/// Persist app settings (write-then-rename). Rejects with a message on failure.
#[tauri::command]
fn save_settings(settings: AppSettings) -> Result<(), String> {
    settings::save(&settings)
}

/// Mark the first-run ToS acknowledgment seen (LG-TOS-1). Never re-prompt after.
#[tauri::command]
fn mark_acknowledged() -> Result<(), String> {
    settings::mark_acknowledged()
}

// ---- Output-location validation + storage (FR-OUT-2, FR-SET-1) ----------

/// Validate an output folder before Start: writability + free space (FR-OUT-2).
#[tauri::command]
fn check_output_path(path: String) -> PathCheck {
    fsutil::check_output_path(&path)
}

/// Recursive disk usage of the mirrors root for the Storage settings tab.
#[tauri::command]
fn mirrors_disk_usage(root: Option<String>) -> DiskUsage {
    let root = root.unwrap_or_else(|| settings::load().mirrors_root);
    fsutil::disk_usage(&root)
}

/// Fire a native OS notification (best-effort — a missing permission is not an
/// error worth surfacing). Gated on the user's `notifications` setting
/// (default ON): when the user turns notifications off, nothing fires.
fn notify(app: &tauri::AppHandle, title: &str, body: &str) {
    if !settings::load().notifications {
        return;
    }
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

/// Build the native application menu (NFR-XPLAT-1). Uses platform-standard
/// accelerators: `CmdOrCtrl+N` (new scrape), `CmdOrCtrl+,` (settings/preferences
/// — the macOS convention), plus a native Quit. On macOS the app submenu
/// (About/Services/Hide/Quit) is added automatically; our items live under a
/// "File" submenu. Menu clicks emit `menu://<id>` events the frontend routes.
fn build_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};

    let new_scrape = MenuItemBuilder::with_id("new-scrape", "New scrape")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let find_images = MenuItemBuilder::with_id("find-images", "Find images…")
        .accelerator("CmdOrCtrl+Shift+N")
        .build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    let file = SubmenuBuilder::new(app, "File")
        .item(&new_scrape)
        .item(&find_images)
        .item(&settings)
        .separator()
        .quit() // native platform Quit (labelled per-OS)
        .build()?;

    // Keep a standard Edit menu so copy/paste/select-all shortcuts work in the
    // sign-in fields and text inputs (a11y / platform expectation).
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    MenuBuilder::new(app).item(&file).item(&edit).build()
}

/// Route native-menu clicks to the frontend via a `menu://<id>` event. The web
/// layer listens and performs the same navigation as the in-app buttons, so the
/// menu and the sidebar stay consistent.
fn handle_menu_event(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().0.as_str();
    match id {
        "new-scrape" | "find-images" | "settings" => {
            let _ = app.emit("menu://navigate", id.to_string());
        }
        _ => {}
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init());

    // The updater plugin (Q10, NFR-XPLAT-1) is desktop-only. Its endpoints /
    // signing pubkey come from `tauri.conf.json` (`plugins.updater`). Guarded so
    // a mobile build (which has no updater) still compiles.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .manage(CrawlState::default())
        .manage(ImageState::default())
        .menu(build_menu)
        .on_menu_event(handle_menu_event)
        .setup(|app| {
            spawn_offline_watcher(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            login,
            current_session,
            logout,
            get_remote_theme,
            set_remote_theme,
            scrape_page,
            start_image_download,
            stop_image_download,
            start_crawl,
            stop_crawl,
            pause_crawl,
            resume_crawl,
            set_crawl_rate,
            resume_job,
            list_jobs,
            load_job,
            check_session,
            job_report,
            mirror_files_present,
            delete_mirror,
            rescrape,
            render_available,
            open_path,
            reveal_path,
            get_settings,
            save_settings,
            mark_acknowledged,
            check_output_path,
            mirrors_disk_usage
        ])
        .run(tauri::generate_context!())
        .expect("error while running Offline Web");
}
