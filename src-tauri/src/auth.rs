//! Real authentication against interlinedlist.com.
//!
//! Contract (confirmed from `https://interlinedlist.com/api/openapi.json`,
//! 2026-07-15):
//!  - `POST /api/auth/sync-token` with JSON `{ email, password, deviceLabel?, name? }`
//!    -> **201** with a long-lived Bearer "sync token" tied to the account.
//!    (spec `securitySchemes.bearerAuth`, `bearerFormat: "SyncToken"`,
//!    summary: "Authenticate with email and password; returns a sync token
//!    (API key) for CLI use.")
//!  - `GET /api/user` -> 200 (valid Bearer) / 401 (missing/expired) — used to
//!    validate a stored token on launch.
//!  - `POST /api/auth/logout` invalidates the token.
//!  - Errors use a `{ "error": string }` envelope (spec `Error` schema; verified
//!    live: 400 `{"error":"Email and password are required"}`, 401
//!    `{"error":"Invalid email or password"}`).
//!
//! Token hygiene (NFR-SEC-1/2, FR-AUTH-2/3):
//!  - The plaintext password is only ever placed in the outgoing HTTPS request
//!    body and is dropped immediately after the exchange. It is never logged,
//!    persisted, or returned to the frontend.
//!  - Only the sync token (+ the account email, for display) is persisted, and
//!    only in the OS keychain. The token is never returned from a command, never
//!    logged, and never serialized into any state the frontend can read.

use keyring::Entry;
use serde::Serialize;
use std::time::Duration;

/// Keychain service name (shared across all secrets for this app).
const KEYCHAIN_SERVICE: &str = "com.interlinedlist.offline";
/// Keychain account/key under which the Bearer sync token is stored.
const TOKEN_KEY: &str = "sync-token";
/// Keychain account/key under which the account email is stored (for display).
const EMAIL_KEY: &str = "account-email";

const BASE_URL: &str = "https://interlinedlist.com";
const SYNC_TOKEN_URL: &str = "https://interlinedlist.com/api/auth/sync-token";
const USER_URL: &str = "https://interlinedlist.com/api/user";
const LOGOUT_URL: &str = "https://interlinedlist.com/api/auth/logout";

const TIMEOUT: Duration = Duration::from_secs(30);

/// What the frontend is allowed to see about the current session.
/// Deliberately does NOT contain the token (FR-AUTH-3, NFR-SEC-1).
#[derive(Serialize, Clone)]
pub struct Session {
    pub email: String,
}

/// Typed auth failures, mapped to stable string kinds the frontend switches on.
pub enum AuthError {
    /// 400/401 — bad email/password.
    InvalidCredentials,
    /// Network/timeout/TLS — server unreachable.
    Unreachable,
    /// Anything else (unexpected status, malformed body, keychain failure).
    Other(String),
}

impl AuthError {
    /// Stable machine-readable kind + human copy the frontend can key off.
    /// Format: `"<kind>: <message>"`. Kinds: `invalid`, `unreachable`, `other`.
    fn to_command_error(&self) -> String {
        match self {
            AuthError::InvalidCredentials => "invalid: Incorrect email or password.".to_string(),
            AuthError::Unreachable => {
                "unreachable: Can't reach interlinedlist.com.".to_string()
            }
            AuthError::Other(m) => format!("other: {m}"),
        }
    }
}

/// The `deviceLabel` sent to the API, e.g. `InterlinedList Offline (macos)`.
fn device_label() -> String {
    format!("InterlinedList Offline ({})", std::env::consts::OS)
}

/// Build a blocking reqwest client with a truthful UA and TLS validation on
/// (rustls default). Certificate validation is NOT disabled anywhere.
fn http_client() -> Result<reqwest::blocking::Client, AuthError> {
    reqwest::blocking::Client::builder()
        .user_agent(concat!(
            "InterlinedListOffline/",
            env!("CARGO_PKG_VERSION")
        ))
        .timeout(TIMEOUT)
        .build()
        .map_err(|e| AuthError::Other(format!("http client init failed: {e}")))
}

// ---- keychain helpers --------------------------------------------------

fn token_entry() -> Result<Entry, AuthError> {
    Entry::new(KEYCHAIN_SERVICE, TOKEN_KEY)
        .map_err(|e| AuthError::Other(format!("keychain unavailable: {e}")))
}

fn email_entry() -> Result<Entry, AuthError> {
    Entry::new(KEYCHAIN_SERVICE, EMAIL_KEY)
        .map_err(|e| AuthError::Other(format!("keychain unavailable: {e}")))
}

/// Read the stored Bearer token, if any. Internal only — never surfaced to the
/// frontend. Used by `bearer_token()` for future authenticated calls.
fn read_token() -> Option<String> {
    let entry = token_entry().ok()?;
    match entry.get_password() {
        Ok(t) if !t.is_empty() => Some(t),
        _ => None,
    }
}

fn read_email() -> Option<String> {
    let entry = email_entry().ok()?;
    entry.get_password().ok().filter(|e| !e.is_empty())
}

/// Persist token + email to the keychain. Returns Other on failure.
fn store_credentials(token: &str, email: &str) -> Result<(), AuthError> {
    token_entry()?
        .set_password(token)
        .map_err(|e| AuthError::Other(format!("keychain write failed: {e}")))?;
    email_entry()?
        .set_password(email)
        .map_err(|e| AuthError::Other(format!("keychain write failed: {e}")))?;
    Ok(())
}

/// Delete both keychain entries (best-effort; missing entries are fine).
fn clear_credentials() {
    if let Ok(e) = token_entry() {
        let _ = e.delete_credential();
    }
    if let Ok(e) = email_entry() {
        let _ = e.delete_credential();
    }
}

/// Extract the Bearer token from a 201 sync-token response body.
///
/// The exact JSON field name is NOT documented in the OpenAPI spec (the 201
/// response has no schema) and could not be observed live (no valid test
/// credentials — a probe only yields 400/401). We therefore accept the most
/// likely field names in priority order so the real server's choice works
/// whichever it is. If the body is a bare JSON string, we accept that too.
fn extract_token(body: &serde_json::Value) -> Option<String> {
    // Bare string body: "eyJ..."
    if let Some(s) = body.as_str() {
        if !s.is_empty() {
            return Some(s.to_string());
        }
    }
    // Object body: try known/likely field names, including one level of nesting.
    const CANDIDATES: &[&str] = &["syncToken", "token", "apiKey", "access_token", "accessToken"];
    for key in CANDIDATES {
        if let Some(v) = body.get(key).and_then(|v| v.as_str()) {
            if !v.is_empty() {
                return Some(v.to_string());
            }
        }
    }
    // Common nesting: { "data": { ... } } or { "syncToken": { "token": ... } }.
    for parent in ["data", "syncToken", "result"] {
        if let Some(obj) = body.get(parent) {
            for key in CANDIDATES {
                if let Some(v) = obj.get(key).and_then(|v| v.as_str()) {
                    if !v.is_empty() {
                        return Some(v.to_string());
                    }
                }
            }
        }
    }
    None
}

// ---- public API (called by the Tauri commands in lib.rs) ---------------

/// Exchange email+password for a sync token and persist it.
///
/// `password` is taken by value and dropped at the end of this function; it is
/// only ever written into the outgoing HTTPS request body. Nothing here logs or
/// persists the password or the returned token beyond the keychain write.
pub fn login(email: String, password: String) -> Result<Session, AuthError> {
    let client = http_client()?;

    // Build the request body. Serialize with serde so the plaintext password
    // exists only inside this JSON value and the request buffer, both of which
    // are dropped when this function returns.
    let body = serde_json::json!({
        "email": email,
        "password": password,
        "deviceLabel": device_label(),
        "name": "InterlinedList Offline",
    });

    let resp = client.post(SYNC_TOKEN_URL).json(&body).send();
    // Drop the password-bearing body immediately after the request is sent.
    drop(body);
    drop(password);

    let resp = match resp {
        Ok(r) => r,
        Err(e) => {
            // Connect/timeout/TLS failures -> "unreachable". reqwest error is
            // logged WITHOUT any request body (bodies aren't in the error).
            if e.is_status() {
                return Err(AuthError::Other(format!("request failed: {e}")));
            }
            return Err(AuthError::Unreachable);
        }
    };

    let status = resp.status();
    if status == reqwest::StatusCode::CREATED || status.is_success() {
        let json: serde_json::Value = resp
            .json()
            .map_err(|e| AuthError::Other(format!("malformed auth response: {e}")))?;
        let token = extract_token(&json).ok_or_else(|| {
            AuthError::Other(
                "auth succeeded but no token field found in response".to_string(),
            )
        })?;
        store_credentials(&token, &email)?;
        // token goes out of scope here; only the email leaves this function.
        Ok(Session { email })
    } else if status == reqwest::StatusCode::BAD_REQUEST
        || status == reqwest::StatusCode::UNAUTHORIZED
    {
        Err(AuthError::InvalidCredentials)
    } else {
        Err(AuthError::Other(format!("unexpected status {status}")))
    }
}

/// Return the current session if a stored token exists and is (lazily/actively)
/// valid. Validates against `GET /api/user`: 200 -> valid, 401 -> expired
/// (clears keychain). If the network is unreachable at launch, we tolerate it
/// and treat a stored token as logged-in (FR-AUTH-9 / offline grace) so existing
/// mirrors remain browsable; the next authenticated call re-checks.
pub fn current_session() -> Option<Session> {
    let token = read_token()?;
    let email = read_email().unwrap_or_default();

    let client = match http_client() {
        Ok(c) => c,
        Err(_) => return Some(Session { email }), // no client -> lazy trust
    };

    match client
        .get(USER_URL)
        .bearer_auth(&token)
        .send()
    {
        Ok(r) if r.status() == reqwest::StatusCode::UNAUTHORIZED => {
            // Token expired/invalidated server-side — clear it.
            clear_credentials();
            None
        }
        Ok(_) => Some(Session { email }),
        // Network error at launch: don't lock the user out of local mirrors.
        Err(_) => Some(Session { email }),
    }
}

/// Sign out: best-effort logout call, then delete the stored token regardless.
pub fn logout() {
    if let Some(token) = read_token() {
        if let Ok(client) = http_client() {
            let _ = client.post(LOGOUT_URL).bearer_auth(&token).send();
        }
    }
    clear_credentials();
}

/// Attach-a-Bearer helper for future authenticated requests (e.g. crawl-time
/// calls). Returns the stored token or None. Kept internal to Rust — callers in
/// the backend use it to set `Authorization: Bearer <token>`; it is never sent
/// to the frontend.
#[allow(dead_code)]
pub fn bearer_token() -> Option<String> {
    read_token()
}

/// The API base URL, exposed so other backend modules can build authed calls.
#[allow(dead_code)]
pub fn api_base_url() -> &'static str {
    BASE_URL
}

// ---- command-facing thin wrappers (map AuthError -> String) ------------

pub fn login_command(email: String, password: String) -> Result<Session, String> {
    login(email, password).map_err(|e| e.to_command_error())
}
