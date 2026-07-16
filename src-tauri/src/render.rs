//! Opt-in JavaScript rendering (M4, FR-RENDER-2/3, brief E-7).
//!
//! The default capture path is a plain static HTTP GET (`scrape::capture_page`).
//! JS-only pages — SPA shells, client-rendered content — come back near-empty
//! from a static fetch. This module:
//!
//!  1. Detects a "needs JavaScript" static capture with a conservative heuristic
//!     (`looks_js_only`) so the crawler can record a `needs-js` skip reason that
//!     M3's report already surfaces with a one-click "Re-scrape with JavaScript
//!     rendering" fix (FR-RENDER-3/4).
//!  2. Renders a page by driving a **system-installed** Chrome/Chromium over the
//!     DevTools Protocol (CDP) via the `headless_chrome` crate, then hands the
//!     rendered `outerHTML` back to the existing capture/asset/link-rewrite
//!     pipeline (`scrape::capture_html`) so the offline result reflects the
//!     rendered DOM (FR-RENDER-2).
//!
//! ## Why CDP against a system browser (NFR-SIZE-1 / Risk R2)
//!
//! We deliberately do NOT bundle or download Chromium. `headless_chrome` is a
//! small pure-Rust CDP client; the size-heavy `fetch`/`zip` features that would
//! pull a ~150 MB Chromium are left OFF in Cargo.toml. At runtime we locate an
//! already-installed browser. If none is found we degrade gracefully with a
//! clear, actionable message — never a crash, never a silently empty page.

use std::path::PathBuf;
use std::time::Duration;
use url::Url;

use crate::scrape::{self, CapturedPage};

/// How long to wait for a rendered page to settle before extracting the DOM.
const RENDER_NAV_TIMEOUT: Duration = Duration::from_secs(30);
/// Extra settle time after load for late client-side rendering / XHRs.
const RENDER_SETTLE: Duration = Duration::from_millis(1200);

// ----- Availability probe (render_available) ------------------------------

/// Locate a usable system Chrome/Chromium so the UI can honestly enable or
/// disable the "Render JavaScript" option (brief E-7). Returns the resolved
/// executable path, or `None` when no browser is installed.
///
/// Resolution order:
///  1. `headless_chrome`'s own default finder (respects `CHROME` env + PATH +
///     platform install locations).
///  2. A short list of well-known platform install paths as a fallback, since
///     the crate's finder can miss the macOS `.app` bundle on some setups.
pub fn find_browser() -> Option<PathBuf> {
    if let Ok(p) = headless_chrome::browser::default_executable() {
        return Some(p);
    }
    for cand in KNOWN_BROWSER_PATHS {
        let p = PathBuf::from(cand);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

/// True when a usable system browser was found (drives the UI toggle's enabled
/// state and the tooltip). Cheap: a filesystem/PATH lookup, no launch.
pub fn render_available() -> bool {
    find_browser().is_some()
}

/// Well-known Chrome/Chromium/Edge/Brave install locations per platform, used as
/// a fallback when the crate's PATH-based finder comes up empty.
#[cfg(target_os = "macos")]
const KNOWN_BROWSER_PATHS: &[&str] = &[
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
];

#[cfg(target_os = "windows")]
const KNOWN_BROWSER_PATHS: &[&str] = &[
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
];

#[cfg(all(unix, not(target_os = "macos")))]
const KNOWN_BROWSER_PATHS: &[&str] = &[
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
    "/usr/bin/brave-browser",
    "/snap/bin/chromium",
];

/// The user-facing message when rendering is requested but no browser exists.
/// Actionable, not a crash (FR-RENDER guidance / graceful degrade).
pub const NO_BROWSER_MSG: &str =
    "JavaScript rendering needs Google Chrome (or another Chromium browser) installed on this computer. Install Chrome, then try again — or capture this page as a static snapshot.";

// ----- JS-only detection heuristic (FR-RENDER-3) --------------------------

/// Conservatively decide whether a *static* capture looks like a JS-only page
/// that would benefit from rendering (FR-RENDER-3). The goal is to catch SPA
/// shells and client-rendered pages WITHOUT false-positiving on legitimately
/// small static pages (a short blog post, a redirect stub, a 404 page).
///
/// A page is flagged only when BOTH hold:
///  - the visible text is very thin (`< MIN_TEXT_CHARS` of non-whitespace text
///    outside `<script>`/`<style>`), AND
///  - there is real evidence of a client-side app: either heavy script presence
///    (`>= MIN_SCRIPTS` `<script src>` tags or a large inline script payload) OR
///    a known empty SPA root container (`<div id="root">`/`app`/`__next` with no
///    children).
///
/// The two-part AND is the false-positive guard: a genuinely small page with
/// little script (e.g. a plain text stub) fails the second clause and is NOT
/// flagged; a script-heavy page that DID render substantial text (server-side
/// rendered React) fails the first clause and is NOT flagged.
pub fn looks_js_only(html: &str) -> bool {
    let text_len = visible_text_len(html);
    if text_len >= MIN_TEXT_CHARS {
        return false; // Substantial rendered text — not empty. No flag.
    }
    heavy_script_presence(html) || empty_spa_root(html)
}

/// Below this many chars of visible (non-script/style) text, a page is "thin".
const MIN_TEXT_CHARS: usize = 200;
/// This many external `<script src>` tags counts as "script-heavy".
const MIN_SCRIPTS: usize = 3;
/// This many bytes of inline script also counts as "script-heavy".
const MIN_INLINE_SCRIPT_BYTES: usize = 2000;

/// Approximate count of visible text characters: strip `<script>`/`<style>`
/// blocks and all tags, collapse whitespace, count non-whitespace-ish length.
/// Deliberately simple (no full parse) — the crawler already parsed once; this
/// runs on the returned HTML string and only needs a rough magnitude.
fn visible_text_len(html: &str) -> usize {
    let stripped = strip_blocks(html, "script");
    let stripped = strip_blocks(&stripped, "style");
    let mut out = String::new();
    let mut in_tag = false;
    for c in stripped.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().map(|w| w.len()).sum()
}

/// Remove `<tag ...>...</tag>` blocks (case-insensitive) so their contents don't
/// count as visible text. Robust to attributes; falls through on malformed tags.
fn strip_blocks(html: &str, tag: &str) -> String {
    let lower = html.to_lowercase();
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut out = String::with_capacity(html.len());
    let mut i = 0usize;
    while i < html.len() {
        if lower[i..].starts_with(&open) {
            // Find the end of the block; if none, drop the rest.
            if let Some(rel) = lower[i..].find(&close) {
                i += rel + close.len();
            } else {
                break;
            }
        } else {
            // Copy this char (respecting UTF-8 boundaries via char_indices step).
            let ch = html[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

/// True when the page carries substantial client-side script: several external
/// scripts or a large inline script blob.
fn heavy_script_presence(html: &str) -> bool {
    let lower = html.to_lowercase();
    let total_scripts = lower.matches("<script").count();
    // Several external script tags is the strongest signal.
    if count_external_scripts(&lower) >= MIN_SCRIPTS {
        return true;
    }
    // A large inline script payload, or a lot of script tags overall, also
    // suggests a client-rendered page.
    inline_script_bytes(html) >= MIN_INLINE_SCRIPT_BYTES || total_scripts >= MIN_SCRIPTS + 2
}

/// Count `<script ... src=...>` occurrences (external scripts).
fn count_external_scripts(lower: &str) -> usize {
    let mut count = 0;
    let mut search = lower;
    while let Some(pos) = search.find("<script") {
        let rest = &search[pos..];
        let tag_end = rest.find('>').map(|e| e + 1).unwrap_or(rest.len());
        if rest[..tag_end].contains(" src") {
            count += 1;
        }
        search = &rest[tag_end..];
    }
    count
}

/// Approximate total bytes of inline (non-src) script content.
fn inline_script_bytes(html: &str) -> usize {
    let lower = html.to_lowercase();
    let mut total = 0usize;
    let mut i = 0usize;
    while let Some(rel) = lower[i..].find("<script") {
        let open = i + rel;
        let Some(gt) = lower[open..].find('>') else { break };
        let content_start = open + gt + 1;
        let tag = &lower[open..content_start];
        let Some(crel) = lower[content_start..].find("</script>") else { break };
        let content_end = content_start + crel;
        if !tag.contains(" src") {
            total += content_end - content_start;
        }
        i = content_end + "</script>".len();
    }
    total
}

/// True when the page contains a known SPA mount point that is empty (no child
/// elements), the classic "needs JavaScript" shell.
fn empty_spa_root(html: &str) -> bool {
    const ROOTS: &[&str] = &[
        "id=\"root\"",
        "id='root'",
        "id=\"app\"",
        "id='app'",
        "id=\"__next\"",
        "id=\"__nuxt\"",
    ];
    let lower = html.to_lowercase();
    for marker in ROOTS {
        if let Some(pos) = lower.find(marker) {
            // Find the end of the opening tag, then the immediate content up to
            // the next tag. Empty (whitespace only) => empty mount point.
            let after = &lower[pos..];
            if let Some(gt) = after.find('>') {
                let content = &after[gt + 1..];
                let trimmed = content.trim_start();
                // Empty root: the very next thing is a closing tag.
                if trimmed.starts_with("</div") || trimmed.starts_with("</main") {
                    return true;
                }
            }
        }
    }
    false
}

// ----- Rendered capture (FR-RENDER-2) -------------------------------------

/// Fetch a page by driving a system headless browser, then feed the rendered
/// `outerHTML` into the existing capture/asset/link-rewrite pipeline so the
/// offline result reflects the rendered DOM (FR-RENDER-2).
///
/// Reuses `scrape::capture_html`: the rendered HTML goes through the SAME asset
/// download + reference-rewrite + link-extraction machinery as a static capture,
/// so disk layout, asset handling and the crawler's frontier all behave
/// identically — only the source HTML differs.
///
/// Errors (browser missing, launch failure, navigation timeout) are returned as
/// `String` so the crawler records them as a normal skip reason rather than
/// crashing; a missing browser yields `NO_BROWSER_MSG`.
pub fn capture_page_rendered(
    http: &reqwest::blocking::Client,
    url: &Url,
) -> Result<CapturedPage, String> {
    let html = render_html(url)?;
    // Reuse the static pipeline on the RENDERED html (assets/links/rewrite).
    scrape::capture_html(http, url, html)
}

/// Launch a system headless browser, navigate to `url`, wait for load +
/// network-idle-ish settle, and return the rendered `document.documentElement`
/// `outerHTML`. A fresh browser is launched per call and dropped on return
/// (v1 scope: single-page render is the primary Q3 path; a long-lived shared
/// browser is a later optimization).
pub fn render_html(url: &Url) -> Result<String, String> {
    use headless_chrome::{Browser, LaunchOptions};

    let exe = find_browser().ok_or_else(|| NO_BROWSER_MSG.to_string())?;

    let options = LaunchOptions::default_builder()
        .path(Some(exe))
        .headless(true)
        // Sandbox off improves compatibility across CI/desktop launch contexts;
        // we only ever load the user's target URL, no untrusted extension code.
        .sandbox(false)
        .idle_browser_timeout(RENDER_NAV_TIMEOUT)
        .build()
        .map_err(|e| format!("Could not configure the browser: {e}"))?;

    let browser = Browser::new(options)
        .map_err(|e| format!("Could not start the browser for rendering: {e}"))?;

    let tab = browser
        .new_tab()
        .map_err(|e| format!("Could not open a render tab: {e}"))?;

    tab.set_default_timeout(RENDER_NAV_TIMEOUT);

    tab.navigate_to(url.as_str())
        .map_err(|e| format!("Could not load the page for rendering: {e}"))?;
    tab.wait_until_navigated()
        .map_err(|e| format!("The page didn't finish loading in time: {e}"))?;

    // Give late client-side rendering a moment to populate the DOM.
    std::thread::sleep(RENDER_SETTLE);

    let html = tab
        .get_content()
        .map_err(|e| format!("Could not read the rendered page: {e}"))?;

    if html.trim().is_empty() {
        return Err("The rendered page was empty.".to_string());
    }
    Ok(html)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spa_shell_is_flagged() {
        let html = r#"<!doctype html><html><head>
            <script src="/a.js"></script><script src="/b.js"></script>
            <script src="/c.js"></script></head>
            <body><div id="root"></div></body></html>"#;
        assert!(looks_js_only(html));
    }

    #[test]
    fn small_static_page_not_flagged() {
        // Thin text but NO script evidence -> must not flag (false-positive guard).
        let html = "<html><body><p>Short note.</p></body></html>";
        assert!(!looks_js_only(html));
    }

    #[test]
    fn content_rich_page_not_flagged() {
        // Script-heavy but substantial rendered text -> not flagged.
        let body = "word ".repeat(100);
        let html = format!(
            "<html><head><script src=/a.js></script><script src=/b.js></script>\
             <script src=/c.js></script></head><body><article>{body}</article></body></html>"
        );
        assert!(!looks_js_only(&html));
    }
}
