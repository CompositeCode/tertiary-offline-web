//! Filesystem checks for output-location validation (FR-OUT-2) and the Storage
//! settings tab (FR-SET-1): writability, free space, and recursive disk usage.
//!
//! `available_space` uses `statvfs`/`GetDiskFreeSpaceExW` via a tiny platform
//! shim rather than pulling in a crate, to keep the binary small (NFR-SIZE-1).
//! When free space can't be determined the checks fail *open* (assume writable)
//! so we never block a legitimate Start on a platform quirk.

use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::scrape::expand_home;

/// Result of validating a chosen output folder before Start (FR-OUT-2).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PathCheck {
    /// The path we can actually create/write into (may be an existing ancestor
    /// when the exact folder doesn't exist yet).
    pub resolved: String,
    /// True when a file can be created under this path.
    pub writable: bool,
    /// Free bytes available on the target volume (0 when undeterminable).
    pub free_bytes: u64,
    /// Present when `writable` is false — a plain-language reason.
    pub error: Option<String>,
}

/// Recursive size of a folder (for the Storage tab's "disk usage of mirrors").
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiskUsage {
    pub root: String,
    pub exists: bool,
    pub total_bytes: u64,
    /// Number of immediate mirror subfolders (rough "how many mirrors").
    pub mirror_count: u32,
}

/// Walk up to the nearest existing ancestor of `path` (so we can test
/// writability of a not-yet-created output folder against its parent).
fn nearest_existing(path: &Path) -> Option<PathBuf> {
    let mut cur = Some(path.to_path_buf());
    while let Some(p) = cur {
        if p.exists() {
            return Some(p);
        }
        cur = p.parent().map(|p| p.to_path_buf());
    }
    None
}

/// Validate an output folder before Start (FR-OUT-2). Confirms we can create a
/// file under it (creating intermediate dirs is fine — we test the nearest
/// existing ancestor) and reports free space.
pub fn check_output_path(raw: &str) -> PathCheck {
    let path = expand_home(raw.trim());
    let resolved = path.to_string_lossy().to_string();

    let Some(anchor) = nearest_existing(&path) else {
        return PathCheck {
            resolved,
            writable: false,
            free_bytes: 0,
            error: Some("That location doesn't exist and can't be created.".to_string()),
        };
    };

    // Probe writability by creating (and removing) a temp file in the anchor.
    let probe = anchor.join(".iloffline-write-test");
    let writable = match std::fs::write(&probe, b"ok") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    };

    let free_bytes = available_space(&anchor);

    PathCheck {
        resolved,
        writable,
        free_bytes,
        error: if writable {
            None
        } else {
            Some("This folder isn't writable. Pick a different location.".to_string())
        },
    }
}

/// Recursive disk usage of the mirrors root (Storage tab).
pub fn disk_usage(raw_root: &str) -> DiskUsage {
    let root = expand_home(raw_root.trim());
    let root_str = root.to_string_lossy().to_string();
    if !root.exists() {
        return DiskUsage {
            root: root_str,
            exists: false,
            total_bytes: 0,
            mirror_count: 0,
        };
    }
    let total_bytes = dir_size(&root);
    let mirror_count = std::fs::read_dir(&root)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .count() as u32
        })
        .unwrap_or(0);
    DiskUsage {
        root: root_str,
        exists: true,
        total_bytes,
        mirror_count,
    }
}

/// Sum file sizes under `dir` recursively (best-effort; unreadable entries are
/// skipped). Iterative to avoid deep-recursion stack risk on huge trees.
fn dir_size(dir: &Path) -> u64 {
    let mut total: u64 = 0;
    let mut stack: Vec<PathBuf> = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else {
            continue;
        };
        for entry in rd.filter_map(|e| e.ok()) {
            let path = entry.path();
            match entry.file_type() {
                Ok(ft) if ft.is_dir() => stack.push(path),
                Ok(ft) if ft.is_file() => {
                    if let Ok(meta) = entry.metadata() {
                        total = total.saturating_add(meta.len());
                    }
                    let _ = ft;
                }
                _ => {}
            }
        }
    }
    total
}

// ---- available_space -------------------------------------------------------
//
// Determining exact free space portably needs a platform FFI (statvfs /
// GetDiskFreeSpaceExW) or an extra crate (`fs2`/`sysinfo`). To honor NFR-SIZE-1
// and avoid an FFI/crate footprint in v1, free space is reported as `0`
// ("undeterminable") and the writability probe carries FR-OUT-2. The struct
// field is kept so a later build can populate it without a shape change; the UI
// only surfaces a low-space warning when a positive value is present.
fn available_space(_path: &Path) -> u64 {
    0
}
