import { el } from "../dom";
import { isTauri, openPath } from "../tauri";
import { fmtBytes, fmtDate } from "../format";
import { isCrawl, type Mirror } from "../store";

/**
 * Screen G — Results. Site name, capture date, page/asset counts, size, output
 * path, fidelity banner, Open in browser / Show in folder / New scrape. For
 * whole-site crawls it also lists the captured pages (tree/list) with per-item
 * status and a grouped skip summary, and badges partial/capped/stopped jobs.
 */
export function renderResults(
  container: HTMLElement,
  mirror: Mirror,
  onNewScrape: () => void,
): void {
  const r = mirror.result;
  const tauri = isTauri();

  const badgeText = statusBadge(mirror);
  container.append(
    el("div", { class: "page-head" }, [
      el("h1", {}, [mirror.host]),
      el("span", { class: "badge" }, [`${badgeText} · ${fmtDate(mirror.capturedAt)}`]),
    ]),
  );

  const failedNote =
    r.failed_asset_count > 0 ? ` (${r.failed_asset_count} failed)` : "";

  const stats = el("div", { class: "result-stats" }, [
    stat(String(r.page_count), r.page_count === 1 ? "Page" : "Pages"),
    stat(String(r.asset_count) + failedNote, "Assets"),
    stat(fmtBytes(r.total_bytes), "Size"),
  ]);

  const openBtn = el("button", { class: "btn accent" }, ["Open in browser"]);
  const folderBtn = el("button", { class: "btn" }, ["Show in folder"]);
  const newBtn = el("button", { class: "btn ghost" }, ["New scrape"]);
  newBtn.addEventListener("click", onNewScrape);

  if (tauri) {
    openBtn.addEventListener("click", () => openPath(r.index_path));
    folderBtn.addEventListener("click", () => openPath(r.output_dir));
  } else {
    (openBtn as HTMLButtonElement).disabled = true;
    (folderBtn as HTMLButtonElement).disabled = true;
  }

  const children: (Node | string)[] = [stats];

  // Stop/cap reason banner for partial jobs.
  if (isCrawl(r) && r.status !== "done" && r.stopReason) {
    children.push(
      el("div", { class: "partial-note" }, [
        `Partial capture — ${r.stopReason} Results below are what was kept.`,
      ]),
    );
  }

  children.push(
    el("div", { class: "field", style: "margin:6px 0 0" }, [
      el("label", {}, ["Saved to"]),
      el("div", { class: "readonly-path" }, [r.output_dir]),
    ]),
    el("div", { class: "fidelity-note" }, [
      "Static snapshot — interactive features (logins, live feeds, search boxes) may not work offline.",
    ]),
    el("div", { class: "result-actions" }, [openBtn, folderBtn, newBtn]),
  );

  container.append(el("div", { class: "card" }, children));

  // Multi-page: captured list + grouped skips.
  if (isCrawl(r)) {
    const captured = r.items.filter((i) => i.status === "captured");
    const skipped = r.items.filter((i) => i.status !== "captured");

    const list = el("div", { class: "captured-list" });
    for (const item of captured) {
      const row = el("div", { class: "captured-row" }, [
        el("span", { class: "cap-status ok" }, ["captured"]),
        el("span", { class: "cap-path", title: item.url }, [item.localPath]),
      ]);
      if (tauri) {
        const openItem = el("button", { class: "btn ghost small" }, ["Open"]);
        openItem.addEventListener("click", () =>
          openPath(joinPath(r.output_dir, item.localPath)),
        );
        row.append(openItem);
      }
      list.append(row);
    }

    container.append(
      el("div", { class: "card" }, [
        el("h2", { class: "sub-head" }, [`Captured (${captured.length})`]),
        captured.length > 0
          ? list
          : el("div", { class: "hint" }, ["No pages captured."]),
      ]),
    );

    if (skipped.length > 0) {
      const groups = new Map<string, number>();
      for (const s of skipped) {
        groups.set(s.reason, (groups.get(s.reason) ?? 0) + 1);
      }
      const rows = [...groups.entries()].map(([reason, count]) =>
        el("div", { class: "reason-row" }, [
          el("span", { class: "reason-name" }, [reasonLabel(reason)]),
          el("span", { class: "reason-count" }, [String(count)]),
        ]),
      );
      container.append(
        el("div", { class: "card" }, [
          el("h2", { class: "sub-head" }, [`Skipped (${skipped.length})`]),
          el("div", { class: "reasons" }, rows),
        ]),
      );
    }
  }
}

function statusBadge(mirror: Mirror): string {
  const r = mirror.result;
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
