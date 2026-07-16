import type { CrawlConfig } from "./tauri";
import type { Mirror } from "./store";

/**
 * Build a display `CrawlConfig` for the Progress screen when resuming a
 * persisted job. The backend re-reads the authoritative config from
 * `<jobDir>/.iloffline/job.json` — this is only used by Progress to render the
 * URL/host and seed the rate slider, so the safe defaults here are cosmetic.
 */
export function configFromMirror(m: Mirror): CrawlConfig {
  return {
    url: m.url,
    scope: "site",
    depth: 2,
    domainScope: "same",
    allowedDomains: [],
    outRoot: "~/InterlinedList Offline",
    ratePerSec: 1,
    concurrency: 2,
    respectRobots: true,
    maxPages: 500,
    maxBytes: 2 * 1024 * 1024 * 1024,
    maxSeconds: 30 * 60,
  };
}
