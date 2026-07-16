import { el } from "../dom";
import { isTauri } from "../tauri";
import type { CrawlConfig } from "../tauri";
import { hostOf } from "../format";
import type { Mirror } from "../store";
import { renderProgress } from "./progress";

/**
 * Screen D — New scrape. URL field, scope toggle (This page only / Whole site),
 * depth presets, an Advanced drawer (D1) with domain scope / rate / concurrency
 * / robots / safety caps, all pre-filled with safe defaults. On Start it routes
 * to the live Progress screen (F).
 */

// Safe defaults (plan §0 / Q9).
const DEFAULTS = {
  depth: 2,
  domainScope: "same" as const,
  ratePerSec: 1,
  concurrency: 2,
  respectRobots: true,
  maxPages: 500,
  maxBytesGb: 2,
  maxMinutes: 30,
  userAgent: "InterlinedListOffline/0.1 (+https://interlinedlist.com)",
};

const DEPTH_PRESETS: { label: string; value: number }[] = [
  { label: "Just this section (1)", value: 1 },
  { label: "A few levels (2)", value: 2 },
  { label: "Deeper (4)", value: 4 },
  { label: "Everything (unlimited)", value: 100 },
];

export function renderNewScrape(
  container: HTMLElement,
  onDone: (m: Mirror) => void,
): void {
  const tauri = isTauri();

  container.append(el("div", { class: "page-head" }, [el("h1", {}, ["New scrape"])]));

  // ---- URL ----------------------------------------------------------------
  const urlInput = el("input", {
    class: "input",
    type: "url",
    placeholder: "https://example.com",
    autocomplete: "off",
  }) as HTMLInputElement;
  const urlError = el("div", { class: "error-text" });

  const pathPreview = el("div", { class: "readonly-path" }, [
    "~/InterlinedList Offline/<host>/",
  ]);
  urlInput.addEventListener("input", () => {
    const host = urlInput.value.trim() ? hostOf(urlInput.value.trim()) : "<host>";
    pathPreview.textContent = `~/InterlinedList Offline/${host}/`;
    urlError.textContent = "";
  });

  // ---- Scope toggle -------------------------------------------------------
  let scope: "page" | "site" = "page";
  const pageCard = el("div", { class: "choice selected" }, [
    el("div", { class: "t" }, ["This page only"]),
    el("div", { class: "d" }, ["One page + its immediate assets"]),
  ]);
  const siteCard = el("div", { class: "choice" }, [
    el("div", { class: "t" }, ["Whole site"]),
    el("div", { class: "d" }, ["Follows links within scope"]),
  ]);
  const scopeRow = el("div", { class: "locked-choice" }, [pageCard, siteCard]);

  // ---- Depth (whole site only) -------------------------------------------
  const depthSelect = el("select", { class: "input" }) as HTMLSelectElement;
  for (const p of DEPTH_PRESETS) {
    const opt = el("option", { value: String(p.value) }, [p.label]) as HTMLOptionElement;
    if (p.value === DEFAULTS.depth) opt.selected = true;
    depthSelect.append(opt);
  }
  const depthField = el("div", { class: "field", style: "display:none" }, [
    el("label", {}, ["Depth (whole site only)"]),
    depthSelect,
  ]);

  function selectScope(next: "page" | "site"): void {
    scope = next;
    pageCard.classList.toggle("selected", next === "page");
    siteCard.classList.toggle("selected", next === "site");
    depthField.style.display = next === "site" ? "" : "none";
  }
  pageCard.addEventListener("click", () => selectScope("page"));
  siteCard.addEventListener("click", () => selectScope("site"));

  // ---- Advanced drawer (D1) ----------------------------------------------
  const domainScope = el("select", { class: "input" }) as HTMLSelectElement;
  for (const [v, label] of [
    ["same", "Same domain (default)"],
    ["subdomains", "Include subdomains"],
    ["list", "Specific domains…"],
    ["any", "Any domain (danger)"],
  ] as const) {
    const opt = el("option", { value: v }, [label]) as HTMLOptionElement;
    if (v === DEFAULTS.domainScope) opt.selected = true;
    domainScope.append(opt);
  }

  const allowedDomainsInput = el("input", {
    class: "input",
    type: "text",
    placeholder: "docs.example.com, cdn.example.com",
    autocomplete: "off",
  }) as HTMLInputElement;
  const allowedField = el("div", { class: "field", style: "display:none" }, [
    el("label", {}, ["Allowed domains (comma-separated)"]),
    allowedDomainsInput,
  ]);
  const anyDomainCaution = el(
    "div",
    { class: "caution", style: "display:none" },
    ["Any-domain crawls can wander across the whole web. Use with care."],
  );
  domainScope.addEventListener("change", () => {
    allowedField.style.display = domainScope.value === "list" ? "" : "none";
    anyDomainCaution.style.display = domainScope.value === "any" ? "" : "none";
  });

  const rateInput = numInput(DEFAULTS.ratePerSec, "0.1", "5");
  const concurrencyInput = numInput(DEFAULTS.concurrency, "1", "8");

  let respectRobots = DEFAULTS.respectRobots;
  const robotsRespect = el("label", { class: "radio" }, [
    radio("robots", true, () => (respectRobots = true)),
    " Respect robots.txt (default)",
  ]);
  const robotsIgnore = el("label", { class: "radio" }, [
    radio("robots", false, () => (respectRobots = false)),
    " Ignore robots.txt",
  ]);
  const robotsCaution = el("div", { class: "caution" }, [
    "Ignoring robots.txt overrides the site's stated crawl preferences — only do this for content you're allowed to mirror.",
  ]);

  const uaInput = el("input", {
    class: "input",
    type: "text",
    value: DEFAULTS.userAgent,
    autocomplete: "off",
  }) as HTMLInputElement;

  const maxPagesInput = numInput(DEFAULTS.maxPages, "1", "100000");
  const maxSizeInput = numInput(DEFAULTS.maxBytesGb, "0.1", "100");
  const maxTimeInput = numInput(DEFAULTS.maxMinutes, "1", "600");

  const advancedBody = el("div", { class: "advanced-body", style: "display:none" }, [
    el("div", { class: "field" }, [el("label", {}, ["Domain scope"]), domainScope]),
    allowedField,
    anyDomainCaution,
    twoCol(
      field("Rate (requests/sec/host)", rateInput),
      field("Concurrency (workers)", concurrencyInput),
    ),
    el("div", { class: "hint", style: "margin:-8px 0 14px" }, [
      "Polite zone: ≤ 1 req/s. A hard ceiling of ~5 req/s applies regardless.",
    ]),
    el("div", { class: "field" }, [
      el("label", {}, ["robots.txt"]),
      robotsRespect,
      robotsIgnore,
      robotsCaution,
    ]),
    el("div", { class: "field" }, [el("label", {}, ["User-agent"]), uaInput]),
    el("div", { class: "field" }, [el("label", {}, ["Safety limits"])]),
    twoCol(field("Max pages", maxPagesInput), field("Max size (GB)", maxSizeInput)),
    field("Max time (minutes)", maxTimeInput),
  ]);
  const advancedToggle = el("button", { class: "advanced-toggle" }, ["▸ Advanced"]);
  let advancedOpen = false;
  advancedToggle.addEventListener("click", () => {
    advancedOpen = !advancedOpen;
    advancedBody.style.display = advancedOpen ? "" : "none";
    advancedToggle.textContent = advancedOpen ? "▾ Advanced" : "▸ Advanced";
  });

  // ---- Start --------------------------------------------------------------
  const startBtn = el("button", { class: "btn accent" }, [
    tauri ? "Start scrape" : "Runs in the desktop app",
  ]) as HTMLButtonElement;
  if (!tauri) startBtn.disabled = true;

  const card = el("div", { class: "card" }, [
    el("div", { class: "field" }, [el("label", {}, ["URL"]), urlInput, urlError]),
    el("div", { class: "field" }, [el("label", {}, ["What to capture"]), scopeRow]),
    depthField,
    el("div", { class: "field" }, [
      el("label", {}, ["Save to"]),
      pathPreview,
      el("div", { class: "hint", style: "margin-top:6px" }, ["Default location."]),
    ]),
    el("div", { class: "advanced" }, [advancedToggle, advancedBody]),
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

  startBtn.addEventListener("click", () => {
    const err = validate();
    if (err) {
      urlError.textContent = err;
      return;
    }
    const url = urlInput.value.trim();
    const allowedDomains = allowedDomainsInput.value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const config: CrawlConfig = {
      url,
      scope,
      depth: scope === "site" ? Number(depthSelect.value) : 0,
      domainScope: domainScope.value as CrawlConfig["domainScope"],
      allowedDomains,
      outRoot: "~/InterlinedList Offline",
      ratePerSec: clampNum(rateInput.value, 0.1, 5, DEFAULTS.ratePerSec),
      concurrency: Math.round(clampNum(concurrencyInput.value, 1, 8, DEFAULTS.concurrency)),
      respectRobots,
      userAgent: uaInput.value.trim() || undefined,
      maxPages: Math.round(clampNum(maxPagesInput.value, 1, 100000, DEFAULTS.maxPages)),
      maxBytes: Math.round(
        clampNum(maxSizeInput.value, 0.1, 100, DEFAULTS.maxBytesGb) * 1024 * 1024 * 1024,
      ),
      maxSeconds: Math.round(clampNum(maxTimeInput.value, 1, 600, DEFAULTS.maxMinutes) * 60),
    };

    container.innerHTML = "";
    renderProgress(container, config, onDone, () => renderNewScrape(container, onDone));
  });
}

// ---- Small builders -----------------------------------------------------

function numInput(value: number, min: string, max: string): HTMLInputElement {
  return el("input", {
    class: "input",
    type: "number",
    value: String(value),
    min,
    max,
    step: "any",
  }) as HTMLInputElement;
}

function field(label: string, input: HTMLElement): HTMLElement {
  return el("div", { class: "field", style: "margin-bottom:0" }, [
    el("label", {}, [label]),
    input,
  ]);
}

function twoCol(a: HTMLElement, b: HTMLElement): HTMLElement {
  return el("div", { class: "two-col" }, [a, b]);
}

function radio(name: string, checked: boolean, onSelect: () => void): HTMLElement {
  const r = el("input", { type: "radio", name }) as HTMLInputElement;
  r.checked = checked;
  r.addEventListener("change", () => {
    if (r.checked) onSelect();
  });
  return r;
}

function clampNum(raw: string, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
