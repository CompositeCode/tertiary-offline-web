import { el } from "../dom";
import { fmtBytes, hostOf } from "../format";
import {
  isTauri,
  onCrawlProgress,
  startCrawl,
  stopCrawl,
  pauseCrawl,
  resumeCrawl,
  setCrawlRate,
  resumeJob,
  loadJob,
  checkSession,
  type CrawlConfig,
  type CrawlProgress,
  type CrawlResult,
  type CrawlStatus,
} from "../tauri";
import type { Mirror } from "../store";
import { addMirror } from "../store";
import { handleSessionExpired } from "../auth";

/**
 * Monotonic generation token. Each `renderProgress` call bumps this; a Progress
 * instance only acts on its terminal result if it's still the current
 * generation. This makes a superseded instance's abandoned promise (e.g. after
 * routing away to Sign-in on session expiry) a no-op instead of mutating the
 * UI/Library out from under the new screen.
 */
let progressGen = 0;

/**
 * Screen F — Job Progress. Starts (or resumes) the crawl, listens to
 * `crawl://progress` events, and shows a live readout: status, current URL,
 * pages done/discovered, queue depth, bytes/throughput, and an errors/skips
 * counter grouped by reason.
 *
 * M2 controls: a **Pause/Resume** toggle (workers idle without dropping the
 * frontier), a live **Rate** control that retunes the running limiter without a
 * restart, and honest copy for the paused / offline / session-expired /
 * disk-full states (§2.3 failure paths). Space toggles pause/resume.
 *
 * When `resumeFrom` is set, this resumes a persisted job from disk (Library →
 * Resume) instead of starting fresh — completed pages are not re-fetched.
 */
export function renderProgress(
  container: HTMLElement,
  config: CrawlConfig,
  onDone: (m: Mirror) => void,
  onCancel: () => void,
  onSessionExpired: (config: CrawlConfig, jobDir: string | undefined) => void,
  resumeFrom?: string,
  /**
   * Reattach to a job that is already alive in-process (e.g. after re-auth on a
   * session-expiry pause). We un-park it via `resumeCrawl` and follow its
   * `crawl://progress` events, routing to Results when a terminal event
   * arrives — we don't own the backend promise in this mode.
   */
  reattach?: boolean,
): void {
  const host = hostOf(config.url);
  const startedAt = Date.now();
  const gen = ++progressGen;
  const isCurrent = () => gen === progressGen;

  const statusBadge = el("span", { class: "badge" }, ["Starting…"]);
  const currentUrl = el("div", { class: "cur-url" }, ["Preparing…"]);
  const bar = el("div", { class: "bar-fill" });
  const barWrap = el("div", { class: "bar-wrap" }, [bar]);
  const counts = el("div", { class: "prog-counts" }, ["0 of ~1 pages"]);
  const stats = el("div", { class: "prog-stats" }, ["Queue: 0 · 0 B"]);
  const stateNote = el("div", { class: "prog-state-note", style: "display:none" }, []);
  const errorLine = el("div", { class: "prog-errors" }, []);
  const reasonsBox = el("div", { class: "reasons" });

  // ---- Live rate control (retunes without restart) -----------------------
  const rateValue = el("span", { class: "rate-value" }, [`${config.ratePerSec} req/s`]);
  const rateSlider = el("input", {
    class: "rate-slider",
    type: "range",
    min: "0.2",
    max: "5",
    step: "0.2",
    value: String(config.ratePerSec),
  }) as HTMLInputElement;
  let liveRate = config.ratePerSec;
  rateSlider.addEventListener("input", () => {
    liveRate = Number(rateSlider.value);
    rateValue.textContent = `${liveRate} req/s${liveRate > 1 ? " ⚠" : ""}`;
  });
  rateSlider.addEventListener("change", () => {
    if (isTauri()) void setCrawlRate(liveRate).catch(() => {});
  });
  const rateRow = el("div", { class: "rate-row" }, [
    el("label", {}, ["Rate"]),
    rateSlider,
    rateValue,
  ]);

  // ---- Pause / Resume toggle + Stop --------------------------------------
  const pauseBtn = el("button", { class: "btn" }, ["Pause"]) as HTMLButtonElement;
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
      stateNote,
      errorLine,
      reasonsBox,
      rateRow,
      el("div", { class: "result-actions" }, [pauseBtn, stopBtn, cancelBtn]),
    ]),
  );

  if (!isTauri()) {
    statusBadge.textContent = "Desktop only";
    currentUrl.textContent = "Crawling runs in the desktop app.";
    pauseBtn.disabled = true;
    stopBtn.disabled = true;
    rateSlider.disabled = true;
    return;
  }

  // Track the last-seen live status so the toggle + shortcut act correctly.
  let lastStatus: CrawlStatus = "running";
  // The job's on-disk dir, learned from the first progress event (needed to
  // re-enter via reattach after a session-expiry sign-out/in round-trip).
  let liveJobDir: string | undefined = resumeFrom;
  let terminated = false;

  function isPausedStatus(s: CrawlStatus): boolean {
    return (
      s === "paused" || s === "offline" || s === "session-expired" || s === "disk-full"
    );
  }

  function togglePause(): void {
    if (terminated) return;
    if (isPausedStatus(lastStatus)) {
      // Only user-pause is directly resumable here; auto-paused states resume
      // when their condition clears (network back / re-auth). But a user Resume
      // on a plain `paused` job is the common case.
      if (lastStatus === "paused") void resumeCrawl().catch(() => {});
    } else {
      void pauseCrawl().catch(() => {});
    }
  }
  pauseBtn.addEventListener("click", togglePause);

  // Space-to-pause shortcut (§6 keyboard shortcuts).
  const onKey = (e: KeyboardEvent) => {
    if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      togglePause();
    }
  };
  window.addEventListener("keydown", onKey);

  stopBtn.addEventListener("click", async () => {
    stopBtn.disabled = true;
    pauseBtn.disabled = true;
    stopBtn.textContent = "Finishing…";
    try {
      await stopCrawl();
    } catch {
      /* crawl may have already finished */
    }
  });

  // Periodic session check while running: on expiry the backend auto-pauses the
  // job (FR-AUTH-5); we route to Sign-in and resume on success.
  let sessionTimer: ReturnType<typeof setInterval> | null = null;
  let sessionPrompted = false;
  function startSessionWatch(): void {
    sessionTimer = setInterval(async () => {
      if (terminated || !isCurrent()) return;
      try {
        const ok = await checkSession();
        if (!ok && !sessionPrompted) {
          sessionPrompted = true;
          handleSessionExpired();
          // The backend has auto-paused the job (session-expired). Route to
          // Sign-in; on success we reattach to this exact paused job.
          onSessionExpired(config, liveJobDir);
        }
      } catch {
        /* ignore transient check failures */
      }
    }, 30_000);
  }

  function render(p: CrawlProgress): void {
    lastStatus = p.status;
    if (p.jobDir) liveJobDir = p.jobDir;
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

    // Paused-state banner with honest copy.
    if (isPausedStatus(p.status)) {
      stateNote.style.display = "";
      stateNote.className = "prog-state-note paused";
      stateNote.textContent = p.stopReason || stateCopy(p.status);
      pauseBtn.textContent = p.status === "paused" ? "Resume" : "Waiting…";
      pauseBtn.disabled = p.status !== "paused";
    } else if (p.status === "running") {
      stateNote.style.display = "none";
      pauseBtn.textContent = "Pause";
      pauseBtn.disabled = false;
    } else {
      stateNote.style.display = "none";
    }

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

    // In reattach mode we don't own the backend promise, so we detect the
    // terminal event here and route to Results ourselves.
    if (reattach && isTerminal(p.status) && !terminated && isCurrent()) {
      void finishFromEvent(p);
    }
  }

  /** Reattach-mode completion: load the persisted job and route to Results. */
  async function finishFromEvent(p: CrawlProgress): Promise<void> {
    if (unlisten) unlisten();
    cleanup();
    if (!isCurrent()) return;
    try {
      const job = await loadJob(p.jobDir);
      const result: CrawlResult = {
        output_dir: p.jobDir,
        index_path: `${p.jobDir}/index.html`,
        page_count: job.pagesDone,
        asset_count: job.assetCount,
        failed_asset_count: job.failedAssetCount,
        total_bytes: job.bytesDownloaded,
        status: job.status,
        stopReason: job.stopReason,
        reasons: job.reasons,
        items: job.items,
      };
      const mirror: Mirror = {
        url: config.url,
        host,
        capturedAt: new Date(),
        result,
        jobDir: p.jobDir,
        status: job.status,
        resumable: false,
      };
      addMirror(mirror);
      onDone(mirror);
    } catch {
      onCancel();
    }
  }

  function cleanup(): void {
    terminated = true;
    window.removeEventListener("keydown", onKey);
    if (sessionTimer) clearInterval(sessionTimer);
  }

  let unlisten: (() => void) | null = null;

  (async () => {
    unlisten = await onCrawlProgress(render);
    startSessionWatch();

    // Reattach mode: the job is already alive in-process; just un-park it and
    // follow events. `finishFromEvent` handles the terminal transition.
    if (reattach) {
      statusBadge.textContent = "Resuming…";
      try {
        await resumeCrawl();
      } catch {
        /* nothing to resume — fall back to Library */
        onCancel();
      }
      return;
    }

    try {
      const result = resumeFrom
        ? await resumeJob(resumeFrom)
        : await startCrawl(config);
      if (unlisten) unlisten();
      cleanup();

      // Superseded (e.g. we routed to Sign-in on session expiry and the user is
      // now elsewhere): don't touch the UI or Library. The backend job's state
      // is already persisted; whoever's on screen owns the view now.
      if (!isCurrent()) return;

      // If the job resolved into a paused state (auto-pause), don't route to
      // Results — leave it in Library as resumable. The final progress event
      // already reflected the paused status; surface it here too.
      if (isPausedStatus(result.status)) {
        statusBadge.textContent = statusLabel(result.status);
        stateNote.style.display = "";
        stateNote.className = "prog-state-note paused";
        stateNote.textContent = result.stopReason || stateCopy(result.status);
        pauseBtn.textContent = "Back to Library";
        pauseBtn.disabled = false;
        pauseBtn.onclick = onCancel;
        stopBtn.disabled = true;
        return;
      }

      const mirror: Mirror = {
        url: config.url,
        host,
        capturedAt: new Date(startedAt),
        result,
        jobDir: result.output_dir,
        status: result.status,
        resumable: false,
      };
      addMirror(mirror);
      onDone(mirror);
    } catch (e) {
      if (unlisten) unlisten();
      cleanup();
      statusBadge.textContent = "Failed";
      currentUrl.textContent = typeof e === "string" ? e : "Crawl failed.";
      pauseBtn.disabled = true;
      stopBtn.disabled = true;
    }
  })();
}

function statusLabel(status: CrawlStatus): string {
  switch (status) {
    case "running":
      return "Running";
    case "paused":
      return "Paused";
    case "offline":
      return "Offline";
    case "session-expired":
      return "Sign-in needed";
    case "disk-full":
      return "Out of space";
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

/** A terminal (job-finished) status — routes to Results. */
function isTerminal(status: CrawlStatus): boolean {
  return status === "done" || status === "stopped" || status === "capped" || status === "error";
}

function stateCopy(status: CrawlStatus): string {
  switch (status) {
    case "paused":
      return "Paused. Resume to continue where you left off.";
    case "offline":
      return "Offline — waiting to reconnect. The job will resume automatically.";
    case "session-expired":
      return "Your interlinedlist.com session expired. Sign in to resume.";
    case "disk-full":
      return "Ran out of disk space. Free some space, then Resume.";
    default:
      return "";
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
    case "connection-failed":
      return "Connection failed";
    default:
      return reason;
  }
}
