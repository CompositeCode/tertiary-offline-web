//! Single-page static scrape: fetch HTML, download same-origin assets, rewrite
//! references to local relative paths, and write a browsable `index.html` tree.

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

/// Expand a leading `~` to the user's home directory.
fn expand_home(p: &str) -> PathBuf {
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

/// Build a blocking HTTP client with a truthful, identifiable User-Agent.
fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(concat!(
            "InterlinedListOffline/",
            env!("CARGO_PKG_VERSION"),
            " (+https://interlinedlist.com)"
        ))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Could not initialize HTTP client: {e}"))
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

/// Scrape a single page. Best-effort on assets: failures are skipped and counted.
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

    // 1. Fetch the page HTML.
    let resp = http
        .get(page_url.clone())
        .send()
        .map_err(|e| format!("Could not fetch page: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Page returned HTTP {}.", resp.status().as_u16()));
    }
    let html_text = resp
        .text()
        .map_err(|e| format!("Could not read page body: {e}"))?;

    // 2. Prepare output dirs: <out_root>/<host>/ and .../assets/
    let out_dir = expand_home(out_root).join(&host);
    let assets_dir = out_dir.join("assets");
    fs::create_dir_all(&assets_dir)
        .map_err(|e| format!("Could not create output folder: {e}"))?;

    // 3. Parse, find same-origin assets, download them, map original -> local.
    let document = Html::parse_document(&html_text);
    let mut rewrites: HashMap<String, String> = HashMap::new();
    let mut used_names: HashMap<String, u32> = HashMap::new();
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
            let Ok(resolved) = page_url.join(orig) else { continue };
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
                        let dest = assets_dir.join(&name);
                        if fs::write(&dest, &body).is_ok() {
                            total_bytes += body.len() as u64;
                            asset_count += 1;
                            rewrites.insert(orig.to_string(), format!("assets/{name}"));
                        } else {
                            failed_asset_count += 1;
                        }
                    }
                    Err(_) => failed_asset_count += 1,
                },
                _ => failed_asset_count += 1,
            }
        }
    }

    // 4. Rewrite references in the raw HTML text (string replace on the exact
    //    attribute values we captured). Simple and predictable for M0.
    let mut rewritten = html_text.clone();
    for (orig, local) in &rewrites {
        rewritten = replace_attr_value(&rewritten, orig, local);
    }

    // 5. Write index.html.
    let index_path = out_dir.join("index.html");
    fs::write(&index_path, rewritten.as_bytes())
        .map_err(|e| format!("Could not write index.html: {e}"))?;

    Ok(ScrapeResult {
        output_dir: path_string(&out_dir),
        index_path: path_string(&index_path),
        page_count: 1,
        asset_count,
        failed_asset_count,
        total_bytes,
    })
}

/// Replace an attribute value only when it appears inside quotes, so we don't
/// accidentally rewrite substrings elsewhere in the document.
fn replace_attr_value(html: &str, orig: &str, local: &str) -> String {
    html.replace(&format!("\"{orig}\""), &format!("\"{local}\""))
        .replace(&format!("'{orig}'"), &format!("'{local}'"))
}

fn path_string(p: &Path) -> String {
    p.to_string_lossy().to_string()
}
