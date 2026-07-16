import type { ScrapeResult, CrawlResult } from "./tauri";

/**
 * A completed capture in the Library list (M1). A capture is either a
 * single-page M0 `ScrapeResult` or a whole-site `CrawlResult`. Both share the
 * core stats fields (output_dir, index_path, page_count, ...); `CrawlResult`
 * additionally carries per-item status and skip reasons.
 */
export type CaptureResult = ScrapeResult | CrawlResult;

export interface Mirror {
  url: string;
  host: string;
  capturedAt: Date;
  result: CaptureResult;
}

/** Type guard: does this capture carry the multi-page crawl report? */
export function isCrawl(r: CaptureResult): r is CrawlResult {
  return "items" in r;
}

// Session-only list — not persisted for M1 (persistence is M2).
const mirrors: Mirror[] = [];

export function addMirror(m: Mirror): void {
  mirrors.unshift(m);
}

export function listMirrors(): Mirror[] {
  return mirrors;
}
