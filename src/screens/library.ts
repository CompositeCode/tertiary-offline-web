import { el } from "../dom";
import { loadLibrary, isCrawl, type Mirror } from "../store";
import { fmtBytes, fmtDate } from "../format";
import { isTauri } from "../tauri";

/**
 * Screen C — Library / Home. Lists persisted jobs discovered on disk (survives
 * restart — FR-PROG-3) plus any in-session captures. Completed AND paused/
 * partial jobs both appear; paused/partial rows get a Resume affordance that
 * re-enters Progress and continues where the job left off.
 */
export function renderLibrary(
  container: HTMLElement,
  onNewScrape: () => void,
  onOpenMirror: (m: Mirror) => void,
  onResume: (m: Mirror) => void,
): void {
  const newBtn = el("button", { class: "btn accent" }, ["+ New scrape"]);
  newBtn.addEventListener("click", onNewScrape);

  container.append(
    el("div", { class: "page-head" }, [el("h1", {}, ["Library"]), newBtn]),
  );

  // Async: hydrate from the on-disk scan. Show a light loading line first.
  const listSlot = el("div", { class: "job-list-slot" }, [
    el("div", { class: "hint" }, [
      isTauri() ? "Loading your mirrors…" : "Mirrors live in the desktop app.",
    ]),
  ]);
  container.append(listSlot);

  void (async () => {
    const mirrors = await loadLibrary();
    listSlot.innerHTML = "";

    if (mirrors.length === 0) {
      const cta = el("button", { class: "btn accent" }, ["New scrape"]);
      cta.addEventListener("click", onNewScrape);
      listSlot.append(
        el("div", { class: "empty-state" }, [
          el("h2", {}, ["No mirrors yet"]),
          el("p", {}, [
            "Capture your first page. Static snapshot — some dynamic features won't work offline.",
          ]),
          cta,
        ]),
      );
      return;
    }

    const list = el("div", { class: "job-list" });
    for (const m of mirrors) {
      const badge = badgeText(m);
      const running = m.status === "running";

      const meta = el("div", { class: "meta" }, [
        el("div", { class: "title" }, [
          el("span", { class: `badge${badgeClass(m)}` }, [badge]),
          m.host,
        ]),
        el("div", { class: "sub" }, [subLine(m)]),
      ]);

      const actions = el("div", { class: "row-actions" });
      const openBtn = el("button", { class: "btn" }, ["Open"]);
      openBtn.addEventListener("click", () => onOpenMirror(m));
      actions.append(openBtn);

      // Resume affordance for paused/partial/interrupted jobs (§2.3, FR-RES-5).
      if (m.resumable && isTauri() && !running) {
        const resumeBtn = el("button", { class: "btn accent" }, ["Resume"]);
        resumeBtn.addEventListener("click", () => onResume(m));
        actions.append(resumeBtn);
      }

      list.append(el("div", { class: "job-row" }, [meta, actions]));
    }
    listSlot.append(list);
  })();
}

/** Badge text for a mirror's lifecycle status. */
function badgeText(m: Mirror): string {
  switch (m.status) {
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
    case "stopped":
      return "Stopped";
    case "capped":
      return "Partial";
    case "error":
      return "Error";
    case "done":
      return "Done";
    default:
      // M0 single-page or a crawl result without an explicit status.
      if (isCrawl(m.result) && m.result.status !== "done") {
        return m.result.status === "stopped" ? "Stopped" : "Partial";
      }
      return "Done";
  }
}

function badgeClass(m: Mirror): string {
  switch (m.status) {
    case "running":
      return " running";
    case "paused":
    case "offline":
    case "session-expired":
    case "disk-full":
      return " paused";
    default:
      return "";
  }
}

function subLine(m: Mirror): string {
  const pages = m.result.page_count;
  const base = `${pages} ${pages === 1 ? "page" : "pages"} · ${fmtBytes(m.result.total_bytes)} · ${fmtDate(m.capturedAt)}`;
  if (m.resumable && m.status && m.status !== "done" && m.status !== "running") {
    return `${base} · ${m.result && isCrawl(m.result) && m.result.stopReason ? m.result.stopReason : "Resumable"}`;
  }
  return base;
}
