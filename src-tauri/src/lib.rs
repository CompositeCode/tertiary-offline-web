//! InterlinedList Offline — Tauri backend (M0 walking skeleton).
//!
//! Commands:
//!  - `mock_login`  : mock auth gate (any non-empty user+pass -> dummy token)
//!  - `scrape_page` : single-page static scrape to disk
//!  - `open_path`   : reveal/open a file or folder

mod scrape;

use serde::Serialize;
use tauri_plugin_opener::OpenerExt;

#[derive(Serialize)]
pub struct Session {
    username: String,
    token: String,
}

/// Mock login. Validates non-empty credentials and returns a dummy token.
///
/// TODO(M0->real): replace mock with interlinedlist.com auth API + OS keychain
/// token storage. The token is NOT persisted anywhere in M0 (frontend holds it
/// in memory only), keeping the "no plaintext secret" promise honest.
#[tauri::command]
fn mock_login(username: String, password: String) -> Result<Session, String> {
    if username.trim().is_empty() || password.is_empty() {
        return Err("Enter your username and password.".to_string());
    }
    Ok(Session {
        username: username.trim().to_string(),
        // Dummy, clearly-labeled token — no real credential material.
        token: format!("mock-token-{}", username.trim()),
    })
}

/// Scrape a single page to `<out_root>/<host>/`.
#[tauri::command]
fn scrape_page(url: String, out_root: String) -> Result<scrape::ScrapeResult, String> {
    scrape::scrape_page(&url, &out_root)
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
        .invoke_handler(tauri::generate_handler![
            mock_login,
            scrape_page,
            open_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running InterlinedList Offline");
}
