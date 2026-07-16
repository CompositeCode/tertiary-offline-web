import { el } from "../dom";
import { listMirrors, type Mirror } from "../store";
import { fmtBytes, fmtDate } from "../format";

/**
 * Screen C — Library / Home. Lists mirrors completed this session, or an empty
 * state pointing to New scrape.
 */
export function renderLibrary(
  container: HTMLElement,
  onNewScrape: () => void,
  onOpenMirror: (m: Mirror) => void,
): void {
  const newBtn = el("button", { class: "btn accent" }, ["+ New scrape"]);
  newBtn.addEventListener("click", onNewScrape);

  container.append(
    el("div", { class: "page-head" }, [el("h1", {}, ["Library"]), newBtn]),
  );

  const mirrors = listMirrors();
  if (mirrors.length === 0) {
    const cta = el("button", { class: "btn accent" }, ["New scrape"]);
    cta.addEventListener("click", onNewScrape);
    container.append(
      el("div", { class: "empty-state" }, [
        el("h2", {}, ["No mirrors yet"]),
        el("p", {}, ["Capture your first page. Static snapshot — some dynamic features won't work offline."]),
        cta,
      ]),
    );
    return;
  }

  const list = el("div", { class: "job-list" });
  for (const m of mirrors) {
    const open = el("button", { class: "btn" }, ["Open"]);
    open.addEventListener("click", () => onOpenMirror(m));
    list.append(
      el("div", { class: "job-row" }, [
        el("div", { class: "meta" }, [
          el("div", { class: "title" }, [
            el("span", { class: "badge" }, ["Done"]),
            m.host,
          ]),
          el("div", { class: "sub" }, [
            `${m.result.page_count} page · ${fmtBytes(m.result.total_bytes)} · ${fmtDate(m.capturedAt)}`,
          ]),
        ]),
        open,
      ]),
    );
  }
  container.append(list);
}
