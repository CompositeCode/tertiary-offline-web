//! images.rs — web image search + download.
//!
//! A sibling to the page scrape/crawl: instead of a URL, the user gives a
//! *search term*; we query the Openverse API (https://api.openverse.org) for
//! openly-licensed images and download the matches to a chosen folder. Openverse
//! aggregates Creative-Commons / public-domain images from many sources
//! (Flickr, Wikimedia, museums, …) and needs no API key — a good fit for an app
//! built around polite, permission-respecting capture.
//!
//! Because every result carries a license, we also write a `CREDITS.txt` into
//! the output folder listing each image's title, creator, license and source
//! landing page, so the download is properly attributable.
//!
//! Like the crawler, a download runs to completion inside the invoking command
//! (Tauri runs commands off the UI thread), emitting `images://progress` events
//! as it goes and honouring a cooperative cancel flag for Stop.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use url::Url;

use crate::scrape::{build_client, default_user_agent, expand_home, path_string};

/// Openverse image-search endpoint (no key required for anonymous use).
const OPENVERSE_ENDPOINT: &str = "https://api.openverse.org/v1/images/";
/// Results requested per API page (Openverse caps anonymous page size at 20).
const PAGE_SIZE: u32 = 20;
/// Hard ceiling on how many images one job may fetch, regardless of request.
const MAX_IMAGES_CEILING: u32 = 200;
/// Polite pause between image downloads so we don't hammer the source hosts.
const DOWNLOAD_DELAY: Duration = Duration::from_millis(150);

/// Config sent from the frontend to `start_image_download` (serde camelCase).
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImageSearchConfig {
    /// The search term, e.g. "red panda".
    pub query: String,
    /// Root folder to save into. `~` is expanded; images land in
    /// `<out_root>/<query-slug>/`.
    pub out_root: String,
    /// How many images to download (clamped to `1..=MAX_IMAGES_CEILING`).
    #[serde(default = "default_max_images")]
    pub max_images: u32,
    /// Optional Openverse `license` filter, e.g. `"cc0,pdm"` (public-domain
    /// only) or `"by,by-sa"`. `None`/empty = any open license.
    #[serde(default)]
    pub license: Option<String>,
    /// Exclude results flagged as sensitive/mature. Default true.
    #[serde(default = "default_true")]
    pub safe: bool,
    /// Truthful, identifiable User-Agent (falls back to the app default).
    #[serde(default)]
    pub user_agent: Option<String>,
}

fn default_max_images() -> u32 {
    25
}
fn default_true() -> bool {
    true
}

/// Live progress payload for `images://progress`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImageProgress {
    /// `searching` | `downloading` | `done` | `stopped` | `error`.
    pub status: String,
    pub query: String,
    /// Total results Openverse reports for the query (0 until known).
    pub found: u32,
    /// How many images this job is aiming to download.
    pub target: u32,
    pub downloaded: u32,
    pub failed: u32,
    pub bytes_downloaded: u64,
    pub current_url: String,
    pub out_dir: String,
    pub elapsed_secs: u64,
    /// Human-readable status/error line for the UI.
    pub message: String,
}

/// One image's outcome, surfaced in the final result + credits file.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImageItem {
    pub source_url: String,
    pub local_path: String,
    pub thumbnail: String,
    pub title: String,
    pub creator: String,
    pub license: String,
    pub source: String,
    pub landing_url: String,
    /// `downloaded` | `failed`.
    pub status: String,
}

/// Final result returned by `start_image_download`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImageDownloadResult {
    pub out_dir: String,
    pub query: String,
    pub target: u32,
    pub downloaded: u32,
    pub failed: u32,
    pub bytes_downloaded: u64,
    /// `done` | `stopped` | `error`.
    pub status: String,
    pub message: String,
    pub items: Vec<ImageItem>,
}

// ---- Openverse API response shapes (only the fields we use) -------------

#[derive(Deserialize)]
struct OpenverseResponse {
    #[serde(default)]
    result_count: u32,
    #[serde(default)]
    results: Vec<OpenverseImage>,
}

#[derive(Deserialize, Clone)]
struct OpenverseImage {
    #[serde(default)]
    title: String,
    #[serde(default)]
    creator: String,
    /// Full-resolution image URL (may be absent for a few records).
    url: Option<String>,
    #[serde(default)]
    thumbnail: String,
    #[serde(default)]
    license: String,
    #[serde(default)]
    license_version: String,
    #[serde(default)]
    source: String,
    #[serde(default)]
    filetype: Option<String>,
    #[serde(default)]
    foreign_landing_url: String,
}

/// Search Openverse and download up to `max_images` matches into
/// `<out_root>/<query-slug>/`, emitting progress and honouring `cancel`.
pub fn run_image_download<F: Fn(ImageProgress)>(
    config: ImageSearchConfig,
    cancel: Arc<AtomicBool>,
    emit: F,
) -> Result<ImageDownloadResult, String> {
    let started = Instant::now();
    let query = config.query.trim().to_string();
    if query.is_empty() {
        return Err("Enter something to search for.".to_string());
    }
    let target = config.max_images.clamp(1, MAX_IMAGES_CEILING);

    // Resolve + create the output folder: <out_root>/<query-slug>/.
    let slug = slugify(&query);
    let out_dir = expand_home(&config.out_root).join(&slug);
    fs::create_dir_all(&out_dir)
        .map_err(|e| format!("Could not create output folder: {e}"))?;
    let out_dir_str = path_string(&out_dir);

    let ua = config
        .user_agent
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(default_user_agent);
    let http = build_client(&ua)?;

    let mut progress = ImageProgress {
        status: "searching".into(),
        query: query.clone(),
        found: 0,
        target,
        downloaded: 0,
        failed: 0,
        bytes_downloaded: 0,
        current_url: String::new(),
        out_dir: out_dir_str.clone(),
        elapsed_secs: 0,
        message: "Searching Openverse…".into(),
    };
    emit(progress.clone());

    let mut items: Vec<ImageItem> = Vec::new();
    let mut used_names: HashMap<String, u32> = HashMap::new();
    let mut page: u32 = 1;

    // Paginate the search, downloading as we go, until we hit the target,
    // run out of results, or the user cancels.
    'outer: while (progress.downloaded as usize) < target as usize {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let results = match search_page(&http, &config, &query, page) {
            Ok(r) => r,
            Err(e) => {
                // A failure on the very first page is fatal (nothing captured);
                // later-page failures just end pagination with what we have.
                if page == 1 && items.is_empty() {
                    progress.status = "error".into();
                    progress.message = e.clone();
                    progress.elapsed_secs = started.elapsed().as_secs();
                    emit(progress.clone());
                    return Err(e);
                }
                break;
            }
        };
        if page == 1 {
            progress.found = results.result_count;
            progress.status = "downloading".into();
            progress.message = format!("Found {} image(s). Downloading…", results.result_count);
            emit(progress.clone());
        }
        if results.results.is_empty() {
            break; // no more pages
        }

        for img in results.results {
            if cancel.load(Ordering::Relaxed) {
                break 'outer;
            }
            if (progress.downloaded as usize) >= target as usize {
                break 'outer;
            }
            let Some(src) = img.url.clone().filter(|u| !u.trim().is_empty()) else {
                continue;
            };
            let Ok(src_url) = Url::parse(&src) else { continue };

            progress.current_url = src.clone();
            progress.elapsed_secs = started.elapsed().as_secs();
            progress.message = format!("Downloading image {}…", progress.downloaded + 1);
            emit(progress.clone());

            let filename = image_filename(&src_url, img.filetype.as_deref(), &mut used_names);
            let dest = out_dir.join(&filename);
            match download_image(&http, &src_url, &dest) {
                Ok(bytes) => {
                    progress.downloaded += 1;
                    progress.bytes_downloaded += bytes;
                    items.push(ImageItem {
                        source_url: src,
                        local_path: path_string(&dest),
                        thumbnail: img.thumbnail.clone(),
                        title: display_title(&img.title),
                        creator: img.creator.clone(),
                        license: license_label(&img.license, &img.license_version),
                        source: img.source.clone(),
                        landing_url: img.foreign_landing_url.clone(),
                        status: "downloaded".into(),
                    });
                }
                Err(_) => {
                    progress.failed += 1;
                    items.push(ImageItem {
                        source_url: src,
                        local_path: String::new(),
                        thumbnail: img.thumbnail.clone(),
                        title: display_title(&img.title),
                        creator: img.creator.clone(),
                        license: license_label(&img.license, &img.license_version),
                        source: img.source.clone(),
                        landing_url: img.foreign_landing_url.clone(),
                        status: "failed".into(),
                    });
                }
            }
            progress.elapsed_secs = started.elapsed().as_secs();
            emit(progress.clone());
            std::thread::sleep(DOWNLOAD_DELAY);
        }
        page += 1;
    }

    // Write an attribution file for the openly-licensed images we captured.
    write_credits(&out_dir, &query, &items);

    let cancelled = cancel.load(Ordering::Relaxed);
    progress.status = if cancelled { "stopped".into() } else { "done".into() };
    progress.current_url = String::new();
    progress.elapsed_secs = started.elapsed().as_secs();
    progress.message = if cancelled {
        format!("Stopped — kept {} image(s).", progress.downloaded)
    } else if progress.downloaded == 0 {
        "No images could be downloaded for that search.".into()
    } else {
        format!("Saved {} image(s).", progress.downloaded)
    };
    emit(progress.clone());

    Ok(ImageDownloadResult {
        out_dir: out_dir_str,
        query,
        target,
        downloaded: progress.downloaded,
        failed: progress.failed,
        bytes_downloaded: progress.bytes_downloaded,
        status: progress.status.clone(),
        message: progress.message.clone(),
        items,
    })
}

/// Fetch one page of Openverse search results.
fn search_page(
    http: &reqwest::blocking::Client,
    config: &ImageSearchConfig,
    query: &str,
    page: u32,
) -> Result<OpenverseResponse, String> {
    let mut req = http
        .get(OPENVERSE_ENDPOINT)
        .query(&[("q", query)])
        .query(&[("page_size", PAGE_SIZE.to_string())])
        .query(&[("page", page.to_string())]);
    // Exclude sensitive results unless explicitly allowed.
    if config.safe {
        req = req.query(&[("mature", "false")]);
    }
    if let Some(lic) = config.license.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        req = req.query(&[("license", lic)]);
    }

    let resp = req
        .send()
        .map_err(|e| format!("Could not reach the image search: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("Image search failed (HTTP {}).", status.as_u16()));
    }
    resp.json::<OpenverseResponse>()
        .map_err(|e| format!("Could not read the image search response: {e}"))
}

/// Download one image to `dest`, returning the byte count. Best-effort: an HTTP
/// error or unreadable body is reported as `Err` and counted as a failure.
fn download_image(
    http: &reqwest::blocking::Client,
    url: &Url,
    dest: &PathBuf,
) -> Result<u64, String> {
    let resp = http
        .get(url.clone())
        .send()
        .map_err(|e| format!("fetch failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }
    let body = resp.bytes().map_err(|e| format!("read failed: {e}"))?;
    fs::write(dest, &body).map_err(|e| format!("write failed: {e}"))?;
    Ok(body.len() as u64)
}

/// Turn a search term into a filesystem-safe folder name (`Red Panda!` →
/// `red-panda`).
fn slugify(q: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for c in q.trim().to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "images".to_string()
    } else {
        trimmed
    }
}

/// Derive a safe, de-duplicated filename for a downloaded image, ensuring it
/// carries an image extension (falling back to the reported filetype).
fn image_filename(
    url: &Url,
    filetype: Option<&str>,
    used: &mut HashMap<String, u32>,
) -> String {
    let raw = url
        .path_segments()
        .and_then(|s| s.last())
        .filter(|s| !s.is_empty())
        .unwrap_or("image");
    let mut base: String = raw
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' })
        .collect();
    if base.is_empty() {
        base = "image".to_string();
    }
    // Ensure an extension: use the URL's, else the API-reported filetype, else jpg.
    if !base.contains('.') {
        let ext = filetype.map(|s| s.trim()).filter(|s| !s.is_empty()).unwrap_or("jpg");
        base = format!("{base}.{ext}");
    }

    let count = used.entry(base.clone()).or_insert(0);
    let name = if *count == 0 {
        base.clone()
    } else {
        match base.rfind('.') {
            Some(dot) => format!("{}_{}{}", &base[..dot], count, &base[dot..]),
            None => format!("{base}_{count}"),
        }
    };
    *count += 1;
    name
}

/// A human-friendly title, falling back to "Untitled" for blank records.
fn display_title(title: &str) -> String {
    let t = title.trim();
    if t.is_empty() {
        "Untitled".to_string()
    } else {
        t.to_string()
    }
}

/// A readable license label, e.g. `by` + `2.0` → "CC BY 2.0"; `cc0` → "CC0";
/// `pdm` → "Public Domain".
fn license_label(license: &str, version: &str) -> String {
    let lic = license.trim().to_lowercase();
    if lic.is_empty() {
        return "Unknown license".to_string();
    }
    let base = match lic.as_str() {
        "cc0" => "CC0".to_string(),
        "pdm" => "Public Domain".to_string(),
        other => format!("CC {}", other.to_uppercase()),
    };
    let v = version.trim();
    if v.is_empty() || lic == "pdm" {
        base
    } else {
        format!("{base} {v}")
    }
}

/// Write a plain-text attribution file listing every downloaded image's title,
/// creator, license and source page. Best-effort — a write failure is ignored.
fn write_credits(out_dir: &PathBuf, query: &str, items: &[ImageItem]) {
    let downloaded: Vec<&ImageItem> = items.iter().filter(|i| i.status == "downloaded").collect();
    if downloaded.is_empty() {
        return;
    }
    let mut text = String::new();
    text.push_str(&format!("Image credits — search: \"{query}\"\n"));
    text.push_str("Sourced via Openverse (https://openverse.org). Check each license before reuse.\n\n");
    for item in downloaded {
        let file = PathBuf::from(&item.local_path);
        let name = file
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| item.local_path.clone());
        text.push_str(&format!("{name}\n"));
        text.push_str(&format!("  Title:   {}\n", item.title));
        if !item.creator.trim().is_empty() {
            text.push_str(&format!("  Creator: {}\n", item.creator));
        }
        text.push_str(&format!("  License: {}\n", item.license));
        if !item.source.trim().is_empty() {
            text.push_str(&format!("  Source:  {}\n", item.source));
        }
        if !item.landing_url.trim().is_empty() {
            text.push_str(&format!("  Page:    {}\n", item.landing_url));
        }
        text.push('\n');
    }
    let _ = fs::write(out_dir.join("CREDITS.txt"), text.as_bytes());
}
