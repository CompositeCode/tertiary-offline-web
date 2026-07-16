import { el } from "../dom";
import { fmtBytes, hostOf } from "../format";
import {
  isTauri,
  onCrawlProgress,
  startCrawl,
  stopCrawl,
  type CrawlConfig,
  type CrawlProgress,
} from "../tauri";
import type { Mirror } from "../store";
import { addMirror } from "../store";

/**
 * Screen F — Job Progress. Starts the crawl, listens to `crawl://progress`
 * events, and shows a live readout: status, current URL, pages done/discovered,
 * queue depth, bytes/throughput, and an errors/skips counter grouped by reason.
 * A "Stop & keep results" button finalizes the crawl keeping partial output.
 * On completion it stores the Mirror and routes to Results via `onDone`.
 */
export function renderProgress(
  container: HTMLElement,
  config: CrawlConfig,
  onDone: (m: Mirror) => void,
  onCancel: () => void,
): void {
  const host = hostOf(config.url);
  const startedAt = Date.now();

  const statusBadge = el("span", { class: "badge" }, ["Starting…"]);
  const currentUrl = el("div", { class: "cur-url" }, ["Preparing…"]);
  const bar = el("div", { class: "bar-fill" });
  const barWrap = el("div", { class: "bar-wrap" }, [bar]);
  const counts = el("div", { class: "prog-counts" }, ["0 of ~1 pages"]);
  const stats = el("div", { class: "prog-stats" }, ["Queue: 0 · 0 B"]);
  const errorLine = el("div", { class: "prog-errors" }, []);
  const reasonsBox = el("div", { class: "reasons" });

  const stopBtn = el("button", { class: "btn" }, ["Stop & keep results"]) as HTMLButtonElement;
  const cancelBtn = el("button", { class: "btn ghost" }, ["Back"]);
  cancelBtn.addEventListener("click", onCancel);

  container.append(
    el("div", { class: "page-head" }, [el("h1", {}, [host]), statusBadge]),
    el("div", { class: "card" }, [
      el("div", { class: "field", style: "margin-bottom:12px" }, [
        el("label", {}, ["Now"]),
        currentUrl,
      ]),
      barWrap,
      counts,
      stats,
      errorLine,
      reasonsBox,
      el("div", { class: "result-actions" }, [stopBtn, cancelBtn]),
    ]),
  );

  if (!isTauri()) {
    statusBadge.textContent = "Desktop only";
    currentUrl.textContent = "Crawling runs in the desktop app.";
    stopBtn.disabled = true;
    return;
  }

  function render(p: CrawlProgress): void {
    statusBadge.textContent = statusLabel(p.status);
    currentUrl.textContent = p.currentUrl || "…";
    const done = p.pagesDone;
    const disc = Math.max(p.pagesDiscovered, done, 1);
    const pct = Math.min(100, Math.round((done / disc) * 100));
    bar.style.width = `${pct}%`;
    counts.textContent = `${done} of ~${disc} pages`;

    const secs = Math.max(1, p.elapsedSecs);
    const rate = (done / secs).toFixed(1);
    stats.textContent = `Queue: ${p.queueDepth} · ${rate} pg/s · ${fmtBytes(p.bytesDownloaded)}`;

    const totalSkips = Object.values(p.reasons).reduce((a, b) => a + b, 0);
    errorLine.textContent = totalSkips > 0 ? `${totalSkips} skipped / errored` : "";

    reasonsBox.innerHTML = "";
    for (const [reason, count] of Object.entries(p.reasons)) {
      reasonsBox.append(
        el("div", { class: "reason-row" }, [
          el("span", { class: "reason-name" }, [reasonLabel(reason)]),
          el("span", { class: "reason-count" }, [String(count)]),
        ]),
      );
    }
  }

  let unlisten: (() => void) | null = null;

  stopBtn.addEventListener("click", async () => {
    stopBtn.disabled = true;
    stopBtn.textContent = "Finishing…";
    try {
      await stopCrawl();
    } catch {
      /* crawl may have already finished */
    }
  });

  (async () => {
    unlisten = await onCrawlProgress(render);
    try {
      const result = await startCrawl(config);
      if (unlisten) unlisten();
      const mirror: Mirror = {
        url: config.url,
        host,
        capturedAt: new Date(startedAt),
        result,
      };
      addMirror(mirror);
      onDone(mirror);
    } catch (e) {
      if (unlisten) unlisten();
      statusBadge.textContent = "Failed";
      currentUrl.textContent = typeof e === "string" ? e : "Crawl failed.";
      stopBtn.disabled = true;
    }
  })();
}

function statusLabel(status: string): string {
  switch (status) {
    case "running":
      return "Running";
    case "finishing":
      return "Finishing";
    case "done":
      return "Done";
    case "stopped":
      return "Stopped";
    case "capped":
      return "Limit reached";
    case "error":
      return "Error";
    default:
      return status;
  }
}

function reasonLabel(reason: string): string {
  switch (reason) {
    case "off-scope":
      return "Off-scope links";
    case "robots-blocked":
      return "Blocked by robots.txt";
    case "too-large":
      return "Too large";
    case "http-error":
      return "HTTP error";
    case "timeout":
      return "Timed out";
    case "rate-limited":
      return "Rate-limited (backed off)";
    default:
      return reason;
  }
}
