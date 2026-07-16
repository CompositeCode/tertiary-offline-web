import type { ScrapeResult, CrawlResult, CrawlStatus, JobSummary, CapturedItem } from "./tauri";
import { listJobs } from "./tauri";

/**
 * A completed capture in the Library list. A capture is either a single-page M0
 * `ScrapeResult` or a whole-site `CrawlResult`. Both share the core stats fields
 * (output_dir, index_path, page_count, ...); `CrawlResult` additionally carries
 * per-item status and skip reasons.
 */
export type CaptureResult = ScrapeResult | CrawlResult;

export interface Mirror {
  url: string;
  host: string;
  capturedAt: Date;
  result: CaptureResult;
  /**
   * The on-disk job dir (`<out_root>/<host>`), when this mirror is backed by a
   * persisted crawl job. Present for all M2 crawls; absent for M0 single-page
   * scrapes that predate persistence. Used as the stable identity for
   * de-duplication and as the target for Resume.
   */
  jobDir?: string;
  /**
   * The persisted lifecycle status when known (`paused`, `offline`,
   * `session-expired`, `disk-full`, `done`, `stopped`, `capped`, ...). Drives
   * the Library badge and whether a Resume affordance is shown.
   */
  status?: CrawlStatus;
  /** True when the job has queued work left and can be resumed. */
  resumable?: boolean;
}

/** Type guard: does this capture carry the multi-page crawl report? */
export function isCrawl(r: CaptureResult): r is CrawlResult {
  return "items" in r;
}

/**
 * Session-side mirror list — captures completed (or started) this run. This is
 * a fast-path cache; the on-disk `.iloffline/job.json` files are the source of
 * truth for M2 and survive restart (see `loadLibrary`).
 */
const mirrors: Mirror[] = [];

/** Add or update a mirror in the session list (keyed by jobDir when present). */
export function addMirror(m: Mirror): void {
  if (m.jobDir) {
    const i = mirrors.findIndex((x) => x.jobDir === m.jobDir);
    if (i >= 0) {
      mirrors[i] = m;
      return;
    }
  }
  mirrors.unshift(m);
}

/** The session-only list (used as an immediate cache before the disk scan). */
export function listMirrors(): Mirror[] {
  return mirrors;
}

/** Convert a persisted `JobSummary` (from the disk scan) into a `Mirror`. */
export function mirrorFromSummary(s: JobSummary): Mirror {
  const result: CrawlResult = {
    output_dir: s.jobDir,
    index_path: s.indexPath,
    page_count: s.pageCount,
    asset_count: s.assetCount,
    failed_asset_count: s.failedAssetCount,
    total_bytes: s.totalBytes,
    status: s.status,
    stopReason: s.stopReason,
    reasons: s.reasons,
    items: s.items,
  };
  return {
    url: s.url,
    host: s.host,
    capturedAt: new Date(s.updatedAt * 1000),
    result,
    jobDir: s.jobDir,
    status: s.status,
    resumable: s.resumable,
  };
}

/**
 * Load the Library, merging on-disk persisted jobs (source of truth, survives
 * restart — FR-PROG-3) with any session mirrors that aren't on disk yet. Disk
 * jobs win on conflict (they carry the freshest persisted status). Returns
 * newest-first. In browser mode this yields just the session list.
 */
export async function loadLibrary(outRoot?: string): Promise<Mirror[]> {
  let disk: Mirror[] = [];
  try {
    const summaries = await listJobs(outRoot);
    disk = summaries.map(mirrorFromSummary);
  } catch {
    disk = [];
  }
  const byDir = new Map<string, Mirror>();
  for (const m of disk) {
    if (m.jobDir) byDir.set(m.jobDir, m);
  }
  // Fold in session mirrors not represented on disk (e.g. M0 single-page).
  for (const m of mirrors) {
    if (!m.jobDir || !byDir.has(m.jobDir)) {
      byDir.set(m.jobDir ?? `${m.host}:${m.capturedAt.getTime()}`, m);
    }
  }
  return [...byDir.values()].sort(
    (a, b) => b.capturedAt.getTime() - a.capturedAt.getTime(),
  );
}

/** Group a manifest's non-captured items by reason (shared by Library/Results). */
export function skipGroups(items: CapturedItem[]): Map<string, number> {
  const groups = new Map<string, number>();
  for (const it of items) {
    if (it.status !== "captured") {
      groups.set(it.reason, (groups.get(it.reason) ?? 0) + 1);
    }
  }
  return groups;
}
