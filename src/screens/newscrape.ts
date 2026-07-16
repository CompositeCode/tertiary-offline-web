import { el } from "../dom";
import { isTauri, scrapePage } from "../tauri";
import { hostOf } from "../format";
import { addMirror, type Mirror } from "../store";

/**
 * Screen D — New scrape. URL field (required, http/https), "This page only"
 * locked for M0, read-only save path, fidelity note, Start scrape. On success
 * routes to Results.
 */
export function renderNewScrape(
  container: HTMLElement,
  onDone: (m: Mirror) => void,
): void {
  const tauri = isTauri();

  container.append(el("div", { class: "page-head" }, [el("h1", {}, ["New scrape"])]));

  const urlInput = el("input", {
    class: "input",
    type: "url",
    placeholder: "https://example.com",
    autocomplete: "off",
  }) as HTMLInputElement;

  const urlError = el("div", { class: "error-text" });

  // Read-only default save path preview updates as the user types the URL.
  const pathPreview = el("div", { class: "readonly-path" }, [
    "~/InterlinedList Offline/<host>/",
  ]);
  urlInput.addEventListener("input", () => {
    const host = urlInput.value.trim() ? hostOf(urlInput.value.trim()) : "<host>";
    pathPreview.textContent = `~/InterlinedList Offline/${host}/`;
    urlError.textContent = "";
  });

  const startBtn = el("button", { class: "btn accent" }, [
    tauri ? "Start scrape" : "Runs in the desktop app",
  ]) as HTMLButtonElement;
  if (!tauri) startBtn.disabled = true;

  const card = el("div", { class: "card" }, [
    el("div", { class: "field" }, [
      el("label", {}, ["URL"]),
      urlInput,
      urlError,
    ]),
    el("div", { class: "field" }, [
      el("label", {}, ["What to capture"]),
      el("div", { class: "locked-choice" }, [
        el("div", { class: "choice selected" }, [
          el("div", { class: "t" }, ["This page only"]),
          el("div", { class: "d" }, ["One page + its immediate assets"]),
        ]),
        el("div", { class: "choice disabled" }, [
          el("div", { class: "t" }, ["Whole site"]),
          el("div", { class: "d" }, ["Coming soon"]),
        ]),
      ]),
    ]),
    el("div", { class: "field" }, [
      el("label", {}, ["Save to"]),
      pathPreview,
      el("div", { class: "hint", style: "margin-top:6px" }, [
        "Default location for M0 (read-only).",
      ]),
    ]),
    el("div", { class: "fidelity-note" }, [
      "Static snapshot — some dynamic features won't work offline.",
    ]),
    el("div", { style: "display:flex;justify-content:flex-end;gap:10px" }, [startBtn]),
  ]);
  container.append(card);

  function validate(): string | null {
    const raw = urlInput.value.trim();
    if (!raw) return "Enter a URL to capture.";
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return "That doesn't look like a valid URL.";
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return "URL must start with http:// or https://";
    }
    return null;
  }

  startBtn.addEventListener("click", async () => {
    const err = validate();
    if (err) {
      urlError.textContent = err;
      return;
    }
    const url = urlInput.value.trim();
    // Progress (minimal): spinner while the backend runs.
    container.innerHTML = "";
    container.append(
      el("div", { class: "progress-wrap" }, [
        el("div", { class: "spinner" }),
        el("div", {}, [`Scraping ${url}…`]),
      ]),
    );

    try {
      // out_root default: ~/InterlinedList Offline (backend appends <host>/).
      const outRoot = "~/InterlinedList Offline";
      const result = await scrapePage(url, outRoot);
      const mirror: Mirror = {
        url,
        host: hostOf(url),
        capturedAt: new Date(),
        result,
      };
      addMirror(mirror);
      onDone(mirror);
    } catch (e) {
      container.innerHTML = "";
      renderNewScrape(container, onDone);
      // Re-query the freshly rendered error slot.
      const slot = container.querySelector(".error-text");
      if (slot) slot.textContent = typeof e === "string" ? e : "Scrape failed.";
    }
  });
}
