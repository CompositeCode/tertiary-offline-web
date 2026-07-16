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
//!  - `open_path`       : reveal/open a file or folder

mod auth;
mod crawl;
mod scrape;

use auth::Session;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

/// App-wide state: the stop flag for the single active crawl (v1 runs one job
/// at a time — Q8). `None` when no crawl is running.
#[derive(Default)]
struct CrawlState {
    stop: Mutex<Option<Arc<AtomicBool>>>,
}

/// Sign in with email + password against interlinedlist.com's sync-token API.
/// On success the long-lived Bearer token is stored ONLY in the OS keychain;
/// the returned `Session` carries just the email (never the token). The
/// plaintext password never leaves the outgoing HTTPS request body and is
/// dropped immediately after (NFR-SEC-2, FR-AUTH-2). Errors are prefixed with a
/// stable kind (`invalid:` / `unreachable:` / `other:`) for the frontend.
#[tauri::command]
fn login(email: String, password: String) -> Result<Session, String> {
    auth::login_command(email, password)
}

/// Validate any stored token on launch and return the session if valid, else
/// None (routing Library vs Sign-in). Clears the token on a definitive 401
/// (FR-AUTH-9). Never returns the token.
#[tauri::command]
fn current_session() -> Option<Session> {
    auth::current_session()
}

/// Sign out: best-effort server-side invalidation, then clear the keychain
/// (FR-AUTH-4).
#[tauri::command]
fn logout() {
    auth::logout();
}

/// Scrape a single page to `<out_root>/<host>/`.
#[tauri::command]
fn scrape_page(url: String, out_root: String) -> Result<scrape::ScrapeResult, String> {
    scrape::scrape_page(&url, &out_root)
}

/// Start a polite, bounded whole-site (or single-page) crawl. Runs off the UI
/// thread, emits `crawl://progress` events throughout, and resolves with the
/// final `CrawlResult`. Only one crawl runs at a time (v1). Stop via
/// `stop_crawl` — partial results are kept.
///
/// This is a synchronous command: Tauri runs `invoke_handler` commands on a
/// worker thread pool, so the blocking crawl never stalls the UI thread while
/// still emitting live progress events.
#[tauri::command]
fn start_crawl(
    app: tauri::AppHandle,
    config: crawl::CrawlConfig,
) -> Result<crawl::CrawlResult, String> {
    // Register a fresh stop flag; reject if a crawl is already running.
    let stop = Arc::new(AtomicBool::new(false));
    {
        let state = app.state::<CrawlState>();
        let mut guard = state.stop.lock().unwrap();
        if guard.as_ref().map(|f| !f.load(Ordering::Relaxed)).unwrap_or(false) {
            return Err("A crawl is already running.".to_string());
        }
        *guard = Some(Arc::clone(&stop));
    }

    let emit_app = app.clone();
    let emit = move |progress: crawl::CrawlProgress| {
        let _ = emit_app.emit("crawl://progress", progress);
    };

    let result = crawl::run_crawl(config, stop, emit);

    // Clear the active-crawl registration.
    {
        let state = app.state::<CrawlState>();
        let mut guard = state.stop.lock().unwrap();
        *guard = None;
    }

    result
}

/// Cooperatively stop the running crawl. The crawl finalizes what it has
/// captured and keeps partial results (Pause/resume is M2 — Stop suffices now).
#[tauri::command]
fn stop_crawl(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<CrawlState>();
    let guard = state.stop.lock().unwrap();
    if let Some(flag) = guard.as_ref() {
        flag.store(true, Ordering::Relaxed);
        Ok(())
    } else {
        Err("No crawl is running.".to_string())
    }
}

/// Open/reveal a file or folder in the OS default handler.
#[tauri::command]
fn open_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| format!("Could not open path: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(CrawlState::default())
        .invoke_handler(tauri::generate_handler![
            login,
            current_session,
            logout,
            scrape_page,
            start_crawl,
            stop_crawl,
            open_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running InterlinedList Offline");
}
