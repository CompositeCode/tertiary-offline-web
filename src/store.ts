import type { ScrapeResult } from "./tauri";

/** A completed scrape captured during this session (Library list, M0). */
export interface Mirror {
  url: string;
  host: string;
  capturedAt: Date;
  result: ScrapeResult;
}

// Session-only list — not persisted for M0.
const mirrors: Mirror[] = [];

export function addMirror(m: Mirror): void {
  mirrors.unshift(m);
}

export function listMirrors(): Mirror[] {
  return mirrors;
}
