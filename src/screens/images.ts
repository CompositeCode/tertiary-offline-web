import { el, clear } from "../dom";
import {
  isTauri,
  pickFolder,
  checkOutputPath,
  openPath,
  revealPath,
  startImageDownload,
  stopImageDownload,
  onImageProgress,
  type ImageSearchConfig,
  type ImageProgress,
  type ImageDownloadResult,
  type ImageItem,
} from "../tauri";
import { getSettings } from "../settings";
import { fmtBytes } from "../format";

/**
 * Screen — Find images. A sibling to New scrape: instead of a URL the user
 * gives a search term, and the app searches the web (Openverse — openly-licensed
 * images, no API key) and downloads the matches to a chosen folder.
 *
 * Unlike the crawl flow (which threads a job through the shell's Progress /
 * Results screens), the image flow keeps its three states — form, downloading,
 * results — inside this one screen, re-rendering `container` as it advances.
 */

const COUNT_PRESETS = [10, 25, 50, 100];

// Openverse `license` filter presets. Empty = any open license.
const LICENSE_PRESETS: [string, string][] = [
  ["", "Any open license"],
  ["cc0,pdm", "Public domain only (CC0 / PDM)"],
  ["cc0,pdm,by", "Public domain + attribution (CC BY)"],
  ["cc0,pdm,by,by-sa", "Also allow share-alike (CC BY-SA)"],
];

export function renderImageSearch(container: HTMLElement): void {
  const tauri = isTauri();
  const settings = getSettings();
  let outRoot = settings.imagesRoot || "~/Offline Web/Images";

  container.append(el("div", { class: "page-head" }, [el("h1", {}, ["Find images"])]));

  // A dedicated area we swap between the form and the download view.
  const stage = el("div", {});
  container.append(stage);

  // ---- Form state ---------------------------------------------------------
  let count = 25;
  let license = "";
  let safe = true;

  function renderForm(prefillQuery = ""): void {
    clear(stage);

    const queryInput = el("input", {
      class: "input",
      type: "text",
      placeholder: "e.g. red panda, san francisco skyline, watercolor texture",
      autocomplete: "off",
      "aria-label": "What to search for",
      value: prefillQuery,
    }) as HTMLInputElement;
    const queryError = el("div", { class: "error-text", role: "alert" });
    queryInput.addEventListener("input", () => (queryError.textContent = ""));

    // ---- How many ---------------------------------------------------------
    const countSelect = el("select", { class: "input" }) as HTMLSelectElement;
    for (const n of COUNT_PRESETS) {
      const opt = el("option", { value: String(n) }, [`${n} images`]) as HTMLOptionElement;
      if (n === count) opt.selected = true;
      countSelect.append(opt);
    }
    countSelect.addEventListener("change", () => (count = Number(countSelect.value)));

    // ---- License filter ---------------------------------------------------
    const licenseSelect = el("select", { class: "input" }) as HTMLSelectElement;
    for (const [v, label] of LICENSE_PRESETS) {
      const opt = el("option", { value: v }, [label]) as HTMLOptionElement;
      if (v === license) opt.selected = true;
      licenseSelect.append(opt);
    }
    licenseSelect.addEventListener("change", () => (license = licenseSelect.value));

    // ---- Safe search ------------------------------------------------------
    const safeCheckbox = el("input", { type: "checkbox" }) as HTMLInputElement;
    safeCheckbox.checked = safe;
    safeCheckbox.addEventListener("change", () => (safe = safeCheckbox.checked));
    const safeLabel = el("label", { class: "radio" }, [
      safeCheckbox,
      " Hide results flagged as sensitive",
    ]);

    // ---- Save to ----------------------------------------------------------
    const pathPreview = el("div", { class: "readonly-path" }, [`${outRoot}/<search>/`]);
    const outPathError = el("div", { class: "error-text", role: "alert" });
    const changeFolderBtn = el(
      "button",
      { class: "btn small", type: "button", "aria-label": "Change save folder" },
      ["Change…"],
    ) as HTMLButtonElement;
    if (!tauri) changeFolderBtn.disabled = true;
    changeFolderBtn.addEventListener("click", async () => {
      const picked = await pickFolder(outRoot);
      if (picked) {
        outRoot = picked;
        outPathError.textContent = "";
        pathPreview.textContent = `${outRoot}/<search>/`;
      }
    });

    // ---- Start ------------------------------------------------------------
    const startBtn = el("button", { class: "btn accent" }, [
      tauri ? "Download images" : "Runs in the desktop app",
    ]) as HTMLButtonElement;
    if (!tauri) startBtn.disabled = true;

    startBtn.addEventListener("click", async () => {
      const query = queryInput.value.trim();
      if (!query) {
        queryError.textContent = "Enter something to search for.";
        return;
      }
      outPathError.textContent = "";

      // Validate the output folder is writable before we start (FR-OUT-2).
      if (tauri) {
        startBtn.disabled = true;
        const prev = startBtn.textContent;
        startBtn.textContent = "Checking folder…";
        let check;
        try {
          check = await checkOutputPath(outRoot);
        } finally {
          startBtn.disabled = false;
          startBtn.textContent = prev;
        }
        if (!check.writable) {
          outPathError.textContent =
            check.error ?? "That folder isn't writable. Pick a different location.";
          return;
        }
      }

      const config: ImageSearchConfig = {
        query,
        outRoot,
        maxImages: count,
        license: license || undefined,
        safe,
        userAgent: settings.userAgent || undefined,
      };
      renderDownload(config);
    });

    stage.append(
      el("div", { class: "card" }, [
        el("div", { class: "field" }, [
          el("label", {}, ["Search for"]),
          queryInput,
          queryError,
        ]),
        twoCol(
          field("How many", countSelect),
          field("License", licenseSelect),
        ),
        el("div", { class: "field" }, [safeLabel]),
        el("div", { class: "field" }, [
          el("label", {}, ["Save to"]),
          el("div", { class: "path-row" }, [pathPreview, changeFolderBtn]),
          outPathError,
          el("div", { class: "hint", style: "margin-top:6px" }, [
            "Images are saved under this folder in a subfolder named for your " +
              "search. Change it per-search or set a new default in Settings → Storage.",
          ]),
        ]),
        el("div", { class: "fidelity-note" }, [
          "Results come from Openverse — openly-licensed images from Flickr, " +
            "Wikimedia, museums and more. A CREDITS.txt with attribution is saved " +
            "alongside them. Check each license before reuse.",
        ]),
        el("div", { style: "display:flex;justify-content:flex-end;gap:10px" }, [startBtn]),
      ]),
    );
  }

  // ---- Downloading + results state ---------------------------------------
  function renderDownload(config: ImageSearchConfig): void {
    clear(stage);

    const statusLine = el("div", { class: "img-status" }, ["Searching Openverse…"]);
    const countLine = el("div", { class: "img-metrics" }, ["—"]);
    const bar = el("div", { class: "img-bar-fill", style: "width:0%" });
    const barTrack = el("div", { class: "img-bar" }, [bar]);
    const grid = el("div", { class: "img-grid" });

    const stopBtn = el("button", { class: "btn ghost" }, ["Stop"]) as HTMLButtonElement;
    const actionRow = el("div", { class: "img-actions" }, [stopBtn]);

    stage.append(
      el("div", { class: "card" }, [
        el("div", { class: "img-head" }, [
          el("h2", { class: "img-title" }, [`“${config.query}”`]),
          statusLine,
        ]),
        barTrack,
        countLine,
        actionRow,
        grid,
      ]),
    );

    const seen = new Set<string>();
    function addThumb(url: string): void {
      if (!url || seen.has(url)) return;
      seen.add(url);
      const img = el("img", { class: "img-thumb", src: url, loading: "lazy", alt: "" });
      grid.append(img);
    }

    stopBtn.addEventListener("click", () => {
      stopBtn.disabled = true;
      stopBtn.textContent = "Stopping…";
      void stopImageDownload().catch(() => {});
    });

    // Live progress → update the bar, metrics, and thumbnail stream.
    let unlisten: () => void = () => {};
    void onImageProgress((p: ImageProgress) => {
      updateProgress(p);
    }).then((fn) => (unlisten = fn));

    function updateProgress(p: ImageProgress): void {
      statusLine.textContent = p.message;
      const done = p.downloaded + p.failed;
      const pct = p.target > 0 ? Math.min(100, Math.round((done / p.target) * 100)) : 0;
      bar.style.width = `${pct}%`;
      countLine.textContent =
        `${p.downloaded} saved` +
        (p.failed > 0 ? ` · ${p.failed} failed` : "") +
        ` · ${fmtBytes(p.bytesDownloaded)}`;
      if (p.currentUrl) addThumb(p.currentUrl);
    }

    // Kick off the download; resolve to the results view.
    startImageDownload(config)
      .then((res) => {
        unlisten();
        renderResults(config, res);
      })
      .catch((e) => {
        unlisten();
        statusLine.textContent = typeof e === "string" ? e : "The image download failed.";
        statusLine.classList.add("img-error");
        clear(actionRow);
        actionRow.append(newSearchBtn(config.query));
      });
  }

  // ---- Results ------------------------------------------------------------
  function renderResults(config: ImageSearchConfig, res: ImageDownloadResult): void {
    clear(stage);

    const saved = res.items.filter((i) => i.status === "downloaded");
    const headline =
      res.status === "stopped"
        ? `Stopped — saved ${res.downloaded} image${res.downloaded === 1 ? "" : "s"}.`
        : res.downloaded === 0
          ? "No images could be downloaded for that search."
          : `Saved ${res.downloaded} image${res.downloaded === 1 ? "" : "s"}.`;

    const openBtn = el("button", { class: "btn small", type: "button" }, ["Open folder"]);
    openBtn.addEventListener("click", () => void openPath(res.outDir).catch(() => {}));
    const revealBtn = el("button", { class: "btn small", type: "button" }, [revealLabel()]);
    revealBtn.addEventListener("click", () => void revealPath(res.outDir).catch(() => {}));

    const grid = el("div", { class: "img-grid" });
    for (const item of saved) grid.append(resultCard(item));

    stage.append(
      el("div", { class: "card" }, [
        el("div", { class: "img-head" }, [
          el("h2", { class: "img-title" }, [`“${config.query}”`]),
          el("div", { class: "img-status" }, [headline]),
        ]),
        el("div", { class: "img-metrics" }, [
          `${res.downloaded} saved` +
            (res.failed > 0 ? ` · ${res.failed} failed` : "") +
            ` · ${fmtBytes(res.bytesDownloaded)}`,
        ]),
        el("div", { class: "readonly-path" }, [res.outDir]),
        el("div", { class: "img-actions" }, [
          openBtn,
          revealBtn,
          newSearchBtn(config.query),
        ]),
        grid,
      ]),
    );
  }

  function resultCard(item: ImageItem): HTMLElement {
    const thumb = el("img", {
      class: "img-thumb",
      src: item.thumbnail || item.sourceUrl,
      loading: "lazy",
      alt: item.title,
      title: `${item.title} — ${item.license}`,
    });
    const card = el("div", { class: "img-card" }, [
      thumb,
      el("div", { class: "img-card-license" }, [item.license]),
    ]);
    // Click a saved image to open it locally.
    card.addEventListener("click", () => void openPath(item.localPath).catch(() => {}));
    return card;
  }

  function newSearchBtn(prefill: string): HTMLElement {
    const btn = el("button", { class: "btn accent", type: "button" }, ["New search"]);
    btn.addEventListener("click", () => renderForm(prefill));
    return btn;
  }

  renderForm();
}

// ---- Small builders (kept local to mirror newscrape.ts) -----------------

function field(label: string, control: HTMLElement): HTMLElement {
  return el("div", { class: "field", style: "margin-bottom:0" }, [
    el("label", {}, [label]),
    control,
  ]);
}

function twoCol(a: HTMLElement, b: HTMLElement): HTMLElement {
  return el("div", { class: "two-col" }, [a, b]);
}

/** Platform-correct file-manager verb (NFR-XPLAT-1). */
function revealLabel(): string {
  const p = navigator.platform.toLowerCase();
  if (p.includes("mac")) return "Show in Finder";
  if (p.includes("win")) return "Show in Explorer";
  return "Show in Files";
}
