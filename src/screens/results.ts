import { el } from "../dom";
import { isTauri, openPath } from "../tauri";
import { fmtBytes, fmtDate } from "../format";
import type { Mirror } from "../store";

/**
 * Screen G — Results. Site name, capture date, page/asset counts, size, output
 * path, fidelity banner, Open in browser / Show in folder / New scrape.
 */
export function renderResults(
  container: HTMLElement,
  mirror: Mirror,
  onNewScrape: () => void,
): void {
  const r = mirror.result;
  const tauri = isTauri();

  container.append(
    el("div", { class: "page-head" }, [
      el("h1", {}, [mirror.host]),
      el("span", { class: "badge" }, [`Done · ${fmtDate(mirror.capturedAt)}`]),
    ]),
  );

  const failedNote =
    r.failed_asset_count > 0 ? ` (${r.failed_asset_count} failed)` : "";

  const stats = el("div", { class: "result-stats" }, [
    stat(String(r.page_count), "Pages"),
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

  container.append(
    el("div", { class: "card" }, [
      stats,
      el("div", { class: "field", style: "margin:6px 0 0" }, [
        el("label", {}, ["Saved to"]),
        el("div", { class: "readonly-path" }, [r.output_dir]),
      ]),
      el("div", { class: "fidelity-note" }, [
        "Static snapshot — interactive features (logins, live feeds, search boxes) may not work offline.",
      ]),
      el("div", { class: "result-actions" }, [openBtn, folderBtn, newBtn]),
    ]),
  );
}

function stat(n: string, label: string): HTMLElement {
  return el("div", { class: "stat" }, [
    el("div", { class: "n" }, [n]),
    el("div", { class: "l" }, [label]),
  ]);
}
