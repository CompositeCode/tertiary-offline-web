import { el } from "../dom";
import {
  isTauri,
  openPath,
  jobReport,
  mirrorFilesPresent,
  type CaptureReport,
  type SkipGroup,
  type InlineFix,
  type RescrapeOptions,
} from "../tauri";
import { fmtBytes, fmtDate } from "../format";
import { isCrawl, type Mirror } from "../store";

/**
 * Screen G — Results, with the capture report (G1) and recovery states.
 *
 * Header: site name, capture date, page/asset counts, size, output path, and the
 * persistent fidelity banner (FR-RES-1). Actions: Open in browser, Show in
 * folder, Re-scrape, Delete (FR-RES-2). A captured tree/list with per-item
 * status where each captured item opens locally (FR-RES-3), a filterable
 * errors/skips panel (F1), and the capture report — captured vs. skipped grouped
 * + explained, fidelity notes, and inline fixes (FR-REPORT-1/2/3).
 *
 * Recovery/empty states (FR-RES-4/5):
 *  - files-not-found → "Files not found at <path>" + Locate / Re-scrape.
 *  - partial → Partial badge leading with what's missing + Resume / Re-scrape.
 *  - zero-capture → diagnosis + the single most likely fix as a button.
 */
export interface ResultsActions {
  onNewScrape: () => void;
  /** Re-scrape this mirror. `options` selects overwrite vs. new dated capture
   *  and carries any inline-fix config overrides. */
  onRescrape: (m: Mirror, options?: RescrapeOptions) => void;
  /** Resume a partial/paused job (Library → Resume path). */
  onResume?: (m: Mirror) => void;
  /** Delete this mirror; the callback returns to Library on success. */
  onDelete?: (m: Mirror) => void;
  /** Re-render Results (e.g. after Locate re-checks files). */
  onReload?: () => void;
}

export function renderResults(
  container: HTMLElement,
  mirror: Mirror,
  actions: ResultsActions,
): void {
  const tauri = isTauri();

  // ---- Header --------------------------------------------------------------
  const badge = statusBadge(mirror);
  container.append(
    el("div", { class: "page-head" }, [
      el("h1", {}, [mirror.host]),
      el("span", { class: `badge${badgeClass(mirror)}` }, [
        `${badge} · ${fmtDate(mirror.capturedAt)}`,
      ]),
    ]),
  );

  // Files-not-found recovery is decided async (FR-RES-4). Render the body once
  // we know whether the files are present, so we never show a broken "Open".
  const body = el("div", { class: "results-body" });
  container.append(body);

  void (async () => {
    let present = true;
    if (tauri && mirror.jobDir) {
      try {
        present = await mirrorFilesPresent(mirror.jobDir);
      } catch {
        present = true; // don't block on a check failure
      }
    }
    if (!present) {
      renderFilesNotFound(body, mirror, actions);
      return;
    }
    renderPresent(body, mirror, actions);
  })();
}

/** The normal (files present) Results view. */
function renderPresent(
  body: HTMLElement,
  mirror: Mirror,
  actions: ResultsActions,
): void {
  const r = mirror.result;
  const tauri = isTauri();

  const failedNote = r.failed_asset_count > 0 ? ` (${r.failed_asset_count} failed)` : "";
  const stats = el("div", { class: "result-stats" }, [
    stat(String(r.page_count), r.page_count === 1 ? "Page" : "Pages"),
    stat(String(r.asset_count) + failedNote, "Assets"),
    stat(fmtBytes(r.total_bytes), "Size"),
  ]);

  const children: (Node | string)[] = [stats];

  // Partial-job note leading with what's missing (FR-RES-5).
  if (isCrawl(r) && r.status !== "done" && r.stopReason) {
    children.push(
      el("div", { class: "partial-note" }, [
        `Partial capture — ${r.stopReason} Results below are what was kept.`,
      ]),
    );
  }

  // Saved-to path + fidelity banner (persistent — FR-RES-1).
  children.push(
    el("div", { class: "field", style: "margin:6px 0 0" }, [
      el("label", {}, ["Saved to"]),
      el("div", { class: "readonly-path" }, [r.output_dir]),
    ]),
    el("div", { class: "fidelity-note" }, [
      "Static snapshot — interactive features (logins, live feeds, search boxes) may not work offline.",
    ]),
  );

  // Actions: Open in browser · Show in folder · Re-scrape · Delete (FR-RES-2).
  const openBtn = el("button", { class: "btn accent" }, ["Open in browser"]);
  const folderBtn = el("button", { class: "btn" }, ["Show in folder"]);
  const rescrapeBtn = el("button", { class: "btn" }, ["Re-scrape"]);
  const deleteBtn = el("button", { class: "btn ghost" }, ["Delete"]);

  if (tauri) {
    openBtn.addEventListener("click", () => openPath(r.index_path));
    folderBtn.addEventListener("click", () => openPath(r.output_dir));
    rescrapeBtn.addEventListener("click", () => openRescrapeSheet(mirror, actions));
    deleteBtn.addEventListener("click", () => confirmDelete(mirror, actions));
  } else {
    for (const b of [openBtn, folderBtn, rescrapeBtn, deleteBtn]) {
      (b as HTMLButtonElement).disabled = true;
    }
  }

  const actionRow = el("div", { class: "result-actions" }, [
    openBtn,
    folderBtn,
    rescrapeBtn,
    deleteBtn,
  ]);

  // Resume affordance for partial/paused jobs (FR-RES-5).
  if (mirror.resumable && actions.onResume && tauri) {
    const resumeBtn = el("button", { class: "btn accent" }, ["Resume"]);
    resumeBtn.addEventListener("click", () => actions.onResume!(mirror));
    actionRow.insertBefore(resumeBtn, actionRow.firstChild);
  }

  children.push(actionRow);
  body.append(el("div", { class: "card" }, children));

  // Multi-page: captured list + filterable skips panel + capture report.
  if (isCrawl(r)) {
    renderCapturedList(body, mirror);
    renderSkipsPanel(body, r.items);
    // Capture report (G1) — loaded async from the persisted manifest.
    renderReport(body, mirror, actions);
  }
}

// ---- Captured tree/list (FR-RES-3) --------------------------------------

function renderCapturedList(body: HTMLElement, mirror: Mirror): void {
  const r = mirror.result;
  if (!isCrawl(r)) return;
  const tauri = isTauri();
  const captured = r.items.filter((i) => i.status === "captured" || i.status === "partial");

  const list = el("div", { class: "captured-list" });
  for (const item of captured) {
    const partial = item.status === "partial";
    const row = el("div", { class: "captured-row" }, [
      el("span", { class: `cap-status ${partial ? "partial" : "ok"}` }, [
        partial ? "partial" : "captured",
      ]),
      el("span", { class: "cap-path", title: item.url }, [item.localPath || item.url]),
    ]);
    if (tauri && item.localPath) {
      const openItem = el("button", { class: "btn ghost small" }, ["Open"]);
      openItem.addEventListener("click", () =>
        openPath(joinPath(r.output_dir, item.localPath)),
      );
      row.append(openItem);
    }
    list.append(row);
  }

  body.append(
    el("div", { class: "card" }, [
      el("h2", { class: "sub-head" }, [`Captured (${captured.length})`]),
      captured.length > 0 ? list : el("div", { class: "hint" }, ["No pages captured."]),
    ]),
  );
}

// ---- Filterable errors/skips panel (F1, FR-PROG-4) ----------------------

function renderSkipsPanel(
  body: HTMLElement,
  items: { url: string; status: string; reason: string }[],
): void {
  const skipped = items.filter((i) => i.status !== "captured" && i.status !== "partial");
  if (skipped.length === 0) return;

  const groups = new Map<string, number>();
  for (const s of skipped) groups.set(s.reason, (groups.get(s.reason) ?? 0) + 1);

  const card = el("div", { class: "card" });
  card.append(el("h2", { class: "sub-head" }, [`Skipped & errors (${skipped.length})`]));

  // Filter dropdown (F1: filter by reason).
  const filter = el("select", { class: "input filter-select" }) as HTMLSelectElement;
  filter.append(el("option", { value: "" }, ["All reasons"]) as HTMLOptionElement);
  for (const [reason, count] of groups) {
    filter.append(
      el("option", { value: reason }, [`${reasonLabel(reason)} (${count})`]) as HTMLOptionElement,
    );
  }
  card.append(
    el("div", { class: "filter-row" }, [el("label", {}, ["Filter"]), filter]),
  );

  const rowsBox = el("div", { class: "skip-rows" });
  card.append(rowsBox);

  function draw(): void {
    rowsBox.innerHTML = "";
    const sel = filter.value;
    const shown = skipped.filter((s) => !sel || s.reason === sel);
    for (const s of shown.slice(0, 200)) {
      rowsBox.append(
        el("div", { class: "skip-row" }, [
          el("span", { class: "skip-reason-tag" }, [reasonLabel(s.reason)]),
          el("span", { class: "skip-url", title: s.url }, [s.url]),
        ]),
      );
    }
    if (shown.length > 200) {
      rowsBox.append(
        el("div", { class: "hint", style: "margin-top:8px" }, [
          `Showing 200 of ${shown.length}.`,
        ]),
      );
    }
  }
  filter.addEventListener("change", draw);
  draw();

  body.append(card);
}

// ---- Capture report (G1, FR-REPORT-1/2/3) -------------------------------

function renderReport(body: HTMLElement, mirror: Mirror, actions: ResultsActions): void {
  if (!isTauri() || !mirror.jobDir) return;
  const slot = el("div", { class: "report-slot" });
  body.append(slot);

  void (async () => {
    let report: CaptureReport;
    try {
      report = await jobReport(mirror.jobDir!);
    } catch {
      return; // report is best-effort; the rest of Results still works
    }

    // Zero-capture diagnosis + single top fix as a button (FR-RES-5).
    if (report.zeroCapture) {
      renderZeroCapture(slot, mirror, report, actions);
      return;
    }

    const card = el("div", { class: "card" }, [
      el("h2", { class: "sub-head" }, ["Capture report"]),
      el("div", { class: "report-summary" }, [
        `${report.pages} page${report.pages === 1 ? "" : "s"} captured · ` +
          `${report.assets} asset${report.assets === 1 ? "" : "s"} · ` +
          `${fmtBytes(report.totalBytes)}` +
          (report.totalSkipped > 0 ? ` · ${report.totalSkipped} skipped` : ""),
      ]),
    ]);

    // Skipped, grouped + explained, with inline fixes (FR-REPORT-1/3).
    for (const g of report.skipGroups) {
      card.append(reportGroup(g, mirror, actions));
    }

    // Fidelity notes (FR-REPORT-2).
    if (report.fidelityNotes.length > 0) {
      card.append(
        el("div", { class: "fidelity-block" }, [
          el("h3", { class: "fidelity-head" }, ["What likely won't work offline"]),
          el(
            "ul",
            { class: "fidelity-list" },
            report.fidelityNotes.map((n) => el("li", {}, [n])),
          ),
        ]),
      );
    }

    slot.append(card);
  })();
}

/** One expandable skip group with explanation + optional inline fix button. */
function reportGroup(g: SkipGroup, mirror: Mirror, actions: ResultsActions): HTMLElement {
  const details = el("details", { class: "report-group" }) as HTMLDetailsElement;
  const summary = el("summary", {}, [
    el("span", { class: "rg-label" }, [g.label]),
    el("span", { class: "rg-count" }, [String(g.count)]),
  ]);
  details.append(summary);

  const inner = el("div", { class: "rg-body" }, [
    el("p", { class: "rg-explain" }, [g.explanation]),
  ]);

  if (g.examples.length > 0) {
    inner.append(
      el(
        "div",
        { class: "rg-examples" },
        g.examples.map((u) => el("div", { class: "rg-example", title: u }, [u])),
      ),
    );
  }

  if (g.fix) {
    inner.append(inlineFixButton(g.fix, mirror, actions));
  }
  details.append(inner);
  return details;
}

/** A wired inline-fix button that re-scrapes with the fix's config overrides. */
function inlineFixButton(
  fix: InlineFix,
  mirror: Mirror,
  actions: ResultsActions,
): HTMLElement {
  const btn = el("button", { class: "btn small fix-btn" }, [fix.label]);
  btn.addEventListener("click", () => {
    actions.onRescrape(mirror, { overrides: overridesForFix(fix) });
  });
  return btn;
}

/** Map an inline-fix action to concrete re-scrape config overrides. */
function overridesForFix(fix: InlineFix): RescrapeOptions["overrides"] {
  switch (fix.action) {
    case "render-js":
      // Headless render is M4; pre-set nothing config-wise yet, but re-run so
      // the JS-only detection re-surfaces. (M4 wires the render flag here.)
      return {};
    case "increase-depth":
      return { scope: "site", depth: 6 };
    case "allow-subdomains":
      return { domainScope: "subdomains" };
    case "ignore-robots":
      return { respectRobots: false };
    case "raise-caps":
      return {
        maxPages: 5000,
        maxBytes: 10 * 1024 * 1024 * 1024,
        maxSeconds: 120 * 60,
      };
    default:
      return {};
  }
}

// ---- Zero-capture state (FR-RES-5) --------------------------------------

function renderZeroCapture(
  slot: HTMLElement,
  mirror: Mirror,
  report: CaptureReport,
  actions: ResultsActions,
): void {
  const diagnosis =
    report.skipGroups.length > 0
      ? `Nothing was captured — ${report.skipGroups[0].explanation}`
      : "Nothing was captured from this URL.";

  const card = el("div", { class: "card empty-state" }, [
    el("h2", {}, ["Nothing was captured"]),
    el("p", {}, [diagnosis]),
  ]);

  if (report.topFix) {
    const btn = el("button", { class: "btn accent" }, [report.topFix.label]);
    btn.addEventListener("click", () =>
      actions.onRescrape(mirror, { overrides: overridesForFix(report.topFix!) }),
    );
    card.append(btn);
  } else {
    const btn = el("button", { class: "btn accent" }, ["Re-scrape"]);
    btn.addEventListener("click", () => actions.onRescrape(mirror));
    card.append(btn);
  }
  slot.append(card);
}

// ---- Files-not-found recovery (FR-RES-4) --------------------------------

function renderFilesNotFound(
  body: HTMLElement,
  mirror: Mirror,
  actions: ResultsActions,
): void {
  const path = mirror.result.output_dir;
  const card = el("div", { class: "card empty-state" }, [
    el("h2", {}, ["Files not found"]),
    el("p", {}, [
      "This mirror's files were moved or deleted outside the app.",
    ]),
    el("div", { class: "readonly-path", style: "margin:0 auto 18px;max-width:520px" }, [
      path,
    ]),
  ]);

  const locateBtn = el("button", { class: "btn" }, ["Locate folder…"]);
  locateBtn.addEventListener("click", () => {
    // Best-effort: re-check + re-render. A full native "locate & relink" picker
    // is a Settings/Storage feature (M5); here we re-verify and reveal.
    if (isTauri()) void openPath(path).catch(() => {});
    actions.onReload?.();
  });

  const rescrapeBtn = el("button", { class: "btn accent" }, ["Re-scrape"]);
  rescrapeBtn.addEventListener("click", () => actions.onRescrape(mirror));

  card.append(el("div", { class: "result-actions", style: "justify-content:center" }, [
    locateBtn,
    rescrapeBtn,
  ]));
  body.append(card);
}

// ---- Re-scrape sheet (overwrite vs. new dated capture — Q12) -------------

function openRescrapeSheet(mirror: Mirror, actions: ResultsActions): void {
  const overlay = el("div", { class: "sheet-overlay" });
  const close = () => overlay.remove();

  const newBtn = el("button", { class: "btn accent block" }, [
    "New dated capture (keeps this one)",
  ]);
  newBtn.addEventListener("click", () => {
    close();
    actions.onRescrape(mirror, { overwrite: false });
  });

  const overwriteBtn = el("button", { class: "btn block" }, [
    "Overwrite this capture",
  ]);
  overwriteBtn.addEventListener("click", () => {
    close();
    actions.onRescrape(mirror, { overwrite: true });
  });

  const cancelBtn = el("button", { class: "btn ghost block" }, ["Cancel"]);
  cancelBtn.addEventListener("click", close);

  const sheet = el("div", { class: "sheet" }, [
    el("h2", { class: "sheet-title" }, ["Re-scrape this site"]),
    el("p", { class: "sheet-body" }, [
      "By default we save a new dated capture so your current copy stays intact. " +
        "You can also overwrite this capture in place.",
    ]),
    newBtn,
    overwriteBtn,
    cancelBtn,
  ]);
  overlay.append(sheet);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.body.append(overlay);
}

function confirmDelete(mirror: Mirror, actions: ResultsActions): void {
  const overlay = el("div", { class: "sheet-overlay" });
  const close = () => overlay.remove();

  const delBtn = el("button", { class: "btn accent block" }, ["Delete this mirror"]);
  delBtn.addEventListener("click", () => {
    close();
    actions.onDelete?.(mirror);
  });
  const cancelBtn = el("button", { class: "btn ghost block" }, ["Cancel"]);
  cancelBtn.addEventListener("click", close);

  const sheet = el("div", { class: "sheet" }, [
    el("h2", { class: "sheet-title" }, ["Delete this mirror?"]),
    el("p", { class: "sheet-body" }, [
      `This permanently removes the captured files at ${mirror.result.output_dir}. This can't be undone.`,
    ]),
    delBtn,
    cancelBtn,
  ]);
  overlay.append(sheet);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.body.append(overlay);
}

// ---- Helpers -------------------------------------------------------------

function statusBadge(mirror: Mirror): string {
  const r = mirror.result;
  if (mirror.status) {
    switch (mirror.status) {
      case "stopped":
        return "Stopped";
      case "capped":
        return "Partial";
      case "paused":
      case "offline":
      case "session-expired":
      case "disk-full":
        return "Partial";
      case "error":
        return "Error";
      case "done":
        return "Done";
    }
  }
  if (isCrawl(r)) {
    switch (r.status) {
      case "stopped":
        return "Stopped";
      case "capped":
        return "Partial";
      case "error":
        return "Error";
      default:
        return "Done";
    }
  }
  return "Done";
}

function badgeClass(mirror: Mirror): string {
  const b = statusBadge(mirror);
  return b === "Partial" || b === "Stopped" ? " paused" : "";
}

function joinPath(dir: string, rel: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  const relOs = sep === "\\" ? rel.replace(/\//g, "\\") : rel;
  return dir.endsWith(sep) ? dir + relOs : dir + sep + relOs;
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
    case "needs-js":
    case "js-only":
      return "Needs JavaScript";
    default:
      return reason;
  }
}

function stat(n: string, label: string): HTMLElement {
  return el("div", { class: "stat" }, [
    el("div", { class: "n" }, [n]),
    el("div", { class: "l" }, [label]),
  ]);
}
