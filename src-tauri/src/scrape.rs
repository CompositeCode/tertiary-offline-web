//! Page capture primitives shared by the single-page scrape (M0) and the
//! whole-site crawler (M1).
//!
//! `capture_page` fetches one page's HTML, downloads its same-origin render
//! assets, rewrites the asset references to local relative paths, and returns
//! the result WITHOUT writing anything to disk. It also extracts the in-page
//! `<a href>` links so the crawler can grow its frontier. Inter-page link
//! rewriting is deferred to the crawler (it needs the full captured set first).
//!
//! `scrape_page` keeps the M0 single-page behaviour: capture one page and write
//! a browsable `index.html` tree, resolving links against the live site.

use scraper::{Html, Selector};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use url::Url;

#[derive(Serialize)]
pub struct ScrapeResult {
    pub output_dir: String,
    pub index_path: String,
    pub page_count: u32,
    pub asset_count: u32,
    pub failed_asset_count: u32,
    pub total_bytes: u64,
}

/// One captured page: rewritten HTML (assets already pointed at local files),
/// the asset files to write, discovered outbound links, and byte totals.
pub struct CapturedPage {
    /// HTML with same-origin asset refs rewritten to `assets/<name>` relative
    /// paths. Inter-page `<a href>` links are left as their original (resolved
    /// absolute) form for the crawler to rewrite in a later pass.
    pub html: String,
    /// Asset files to write, keyed by relative path (e.g. `assets/style.css`).
    pub assets: Vec<CapturedAsset>,
    /// Absolute URLs of `<a href>` links found on the page (already resolved
    /// against the page URL, fragment stripped). Includes off-scope links; the
    /// caller decides scope.
    pub links: Vec<Url>,
    /// Total bytes for this page (HTML + captured asset bodies).
    pub bytes: u64,
    pub asset_count: u32,
    pub failed_asset_count: u32,
}

pub struct CapturedAsset {
    /// Relative path under the page's output dir, e.g. `assets/logo.png`.
    pub rel_path: String,
    pub body: Vec<u8>,
}

/// Expand a leading `~` to the user's home directory.
pub fn expand_home(p: &str) -> PathBuf {
    if let Some(rest) = p.strip_prefix("~/") {
        if let Some(home) = home_dir() {
            return home.join(rest);
        }
    } else if p == "~" {
        if let Some(home) = home_dir() {
            return home;
        }
    }
    PathBuf::from(p)
}

/// Minimal cross-platform home dir lookup without extra crates.
fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

/// Default truthful, identifiable User-Agent.
pub fn default_user_agent() -> String {
    format!(
        "InterlinedListOffline/{} (+https://interlinedlist.com)",
        env!("CARGO_PKG_VERSION")
    )
}

/// Build a blocking HTTP client with the given (truthful) User-Agent.
pub fn build_client(user_agent: &str) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(user_agent.to_string())
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Could not initialize HTTP client: {e}"))
}

/// Build a blocking HTTP client with the M0 default User-Agent.
fn client() -> Result<reqwest::blocking::Client, String> {
    build_client(&default_user_agent())
}

/// Sanitize an asset URL into a safe relative filename under `assets/`.
fn asset_filename(asset_url: &Url, used: &mut HashMap<String, u32>) -> String {
    // Take the last path segment, fall back to a generated name.
    let raw = asset_url
        .path_segments()
        .and_then(|s| s.last())
        .filter(|s| !s.is_empty())
        .unwrap_or("asset");

    // Strip anything unsafe; keep it simple and filesystem-portable.
    let mut base: String = raw
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' })
        .collect();
    if base.is_empty() {
        base = "asset".to_string();
    }

    // Deduplicate collisions (e.g. two different dirs with `style.css`).
    let count = used.entry(base.clone()).or_insert(0);
    let name = if *count == 0 {
        base.clone()
    } else {
        // Insert the counter before the extension when possible.
        match base.rfind('.') {
            Some(dot) => format!("{}_{}{}", &base[..dot], count, &base[dot..]),
            None => format!("{base}_{count}"),
        }
    };
    *count += 1;
    name
}

/// Attributes we treat as same-origin downloadable assets.
struct AssetRef {
    selector: &'static str,
    attr: &'static str,
}

const ASSET_REFS: &[AssetRef] = &[
    AssetRef { selector: "img[src]", attr: "src" },
    AssetRef { selector: "link[rel=\"stylesheet\"][href]", attr: "href" },
    AssetRef { selector: "script[src]", attr: "src" },
];

/// Fetch one page and capture its same-origin assets, returning rewritten HTML
/// and discovered links. Nothing is written to disk. Assets are best-effort:
/// failures are skipped and counted. Assets are captured from the page's own
/// origin (host) only, matching M0 fidelity behaviour.
///
/// `http` is a shared client so the crawler can reuse connections/UA.
pub fn capture_page(http: &reqwest::blocking::Client, url: &Url) -> Result<CapturedPage, String> {
    // 1. Fetch the page HTML.
    let resp = http
        .get(url.clone())
        .send()
        .map_err(|e| format!("Could not fetch page: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("HTTP {}", status.as_u16()));
    }
    let html_text = resp
        .text()
        .map_err(|e| format!("Could not read page body: {e}"))?;

    // 2+. Run the shared capture pipeline over the fetched HTML.
    capture_html(http, url, html_text)
}

/// Run the asset-capture + reference-rewrite + link-extraction pipeline over an
/// already-obtained HTML string for `url`, returning a `CapturedPage`. Shared by
/// the static path (`capture_page`, which fetches first) and the M4 rendered
/// path (`render::capture_page_rendered`, which passes the rendered DOM). The
/// `http` client is used only to download the page's same-origin assets.
pub fn capture_html(
    http: &reqwest::blocking::Client,
    url: &Url,
    html_text: String,
) -> Result<CapturedPage, String> {
    let host = url
        .host_str()
        .ok_or_else(|| "URL has no host.".to_string())?
        .to_string();

    // Parse, find same-origin assets, download them, map original -> local.
    let document = Html::parse_document(&html_text);
    let mut rewrites: HashMap<String, String> = HashMap::new();
    let mut used_names: HashMap<String, u32> = HashMap::new();
    let mut assets: Vec<CapturedAsset> = Vec::new();
    let mut asset_count: u32 = 0;
    let mut failed_asset_count: u32 = 0;
    let mut total_bytes: u64 = html_text.len() as u64;

    for aref in ASSET_REFS {
        let selector = match Selector::parse(aref.selector) {
            Ok(s) => s,
            Err(_) => continue,
        };
        for element in document.select(&selector) {
            let Some(orig) = element.value().attr(aref.attr) else { continue };
            if orig.trim().is_empty() {
                continue;
            }
            // Skip data: URIs and in-page anchors.
            if orig.starts_with("data:") || orig.starts_with('#') {
                continue;
            }
            // Resolve relative to the page URL.
            let Ok(resolved) = url.join(orig) else { continue };
            // Same-origin only.
            if resolved.host_str() != Some(host.as_str()) {
                continue;
            }
            if rewrites.contains_key(orig) {
                continue; // already handled this exact reference string
            }

            match http.get(resolved.clone()).send() {
                Ok(r) if r.status().is_success() => match r.bytes() {
                    Ok(body) => {
                        let name = asset_filename(&resolved, &mut used_names);
                        let rel = format!("assets/{name}");
                        total_bytes += body.len() as u64;
                        asset_count += 1;
                        assets.push(CapturedAsset { rel_path: rel.clone(), body: body.to_vec() });
                        rewrites.insert(orig.to_string(), rel);
                    }
                    Err(_) => failed_asset_count += 1,
                },
                _ => failed_asset_count += 1,
            }
        }
    }

    // 3. Extract outbound <a href> links (resolved, fragment-stripped).
    let mut links: Vec<Url> = Vec::new();
    if let Ok(a_sel) = Selector::parse("a[href]") {
        for element in document.select(&a_sel) {
            let Some(href) = element.value().attr("href") else { continue };
            let href = href.trim();
            if href.is_empty() || href.starts_with('#') {
                continue;
            }
            if href.starts_with("mailto:")
                || href.starts_with("tel:")
                || href.starts_with("javascript:")
                || href.starts_with("data:")
            {
                continue;
            }
            let Ok(mut resolved) = url.join(href) else { continue };
            if resolved.scheme() != "http" && resolved.scheme() != "https" {
                continue;
            }
            resolved.set_fragment(None);
            links.push(resolved);
        }
    }

    // 4. Rewrite asset references in the raw HTML.
    let mut rewritten = html_text;
    for (orig, local) in &rewrites {
        rewritten = replace_attr_value(&rewritten, orig, local);
    }

    Ok(CapturedPage {
        html: rewritten,
        assets,
        links,
        bytes: total_bytes,
        asset_count,
        failed_asset_count,
    })
}

/// M0 single-page scrape: capture one page and write a browsable tree to
/// `<out_root>/<host>/index.html`. Kept for the M0 "This page only" path.
pub fn scrape_page(url: &str, out_root: &str) -> Result<ScrapeResult, String> {
    let page_url = Url::parse(url).map_err(|_| "Invalid URL.".to_string())?;
    if page_url.scheme() != "http" && page_url.scheme() != "https" {
        return Err("URL must use http or https.".to_string());
    }
    let host = page_url
        .host_str()
        .ok_or_else(|| "URL has no host.".to_string())?
        .to_string();

    let http = client()?;
    let captured = capture_page(&http, &page_url)?;

    // Prepare output dirs: <out_root>/<host>/ and .../assets/
    let out_dir = expand_home(out_root).join(&host);
    let assets_dir = out_dir.join("assets");
    fs::create_dir_all(&assets_dir)
        .map_err(|e| format!("Could not create output folder: {e}"))?;

    // Write assets.
    for asset in &captured.assets {
        let dest = out_dir.join(&asset.rel_path);
        if let Some(parent) = dest.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(&dest, &asset.body);
    }

    // Write index.html.
    let index_path = out_dir.join("index.html");
    fs::write(&index_path, captured.html.as_bytes())
        .map_err(|e| format!("Could not write index.html: {e}"))?;

    Ok(ScrapeResult {
        output_dir: path_string(&out_dir),
        index_path: path_string(&index_path),
        page_count: 1,
        asset_count: captured.asset_count,
        failed_asset_count: captured.failed_asset_count,
        total_bytes: captured.bytes,
    })
}

/// Replace an attribute value only when it appears inside quotes, so we don't
/// accidentally rewrite substrings elsewhere in the document.
pub fn replace_attr_value(html: &str, orig: &str, local: &str) -> String {
    html.replace(&format!("\"{orig}\""), &format!("\"{local}\""))
        .replace(&format!("'{orig}'"), &format!("'{local}'"))
}

pub fn path_string(p: &Path) -> String {
    p.to_string_lossy().to_string()
}
