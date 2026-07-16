import { el } from "../dom";
import { isTauri, renderAvailable, pickFolder, checkOutputPath } from "../tauri";
import type { CrawlConfig } from "../tauri";
import { hostOf } from "../format";
import type { Mirror } from "../store";
import { getSettings } from "../settings";

/**
 * Screen D — New scrape. URL field, scope toggle (This page only / Whole site),
 * depth presets, an Advanced drawer (D1) with domain scope / rate / concurrency
 * / robots / safety caps, all pre-filled from Settings → Defaults (FR-SET-2). On
 * Start it validates the output folder (FR-OUT-2) then routes to Progress (F).
 */

// Safe defaults (plan §0 / Q9). These are the hard-coded fallbacks; Settings →
// Defaults (FR-SET-2) override the seed values at render time via `getSettings`.
const DEFAULTS = {
  depth: 2,
  domainScope: "same" as const,
  ratePerSec: 1,
  concurrency: 2,
  respectRobots: true,
  maxPages: 500,
  maxBytesGb: 2,
  maxMinutes: 30,
  userAgent: "InterlinedListOffline/0.1.0 (+https://interlinedlist.com)",
};

const DEPTH_PRESETS: { label: string; value: number }[] = [
  { label: "Just this section (1)", value: 1 },
  { label: "A few levels (2)", value: 2 },
  { label: "Deeper (4)", value: 4 },
  { label: "Everything (unlimited)", value: 100 },
];

export function renderNewScrape(
  container: HTMLElement,
  _onDone: (m: Mirror) => void,
  onStart: (config: CrawlConfig) => void,
): void {
  const tauri = isTauri();
  // Pull the persisted defaults (FR-SET-2). Falls back to DEFAULTS in browser
  // mode / before settings load.
  const settings = getSettings();
  // The mirrors root the output folder is derived from; the folder picker can
  // override it per-job.
  let outRoot = settings.mirrorsRoot || "~/InterlinedList Offline";

  container.append(el("div", { class: "page-head" }, [el("h1", {}, ["New scrape"])]));

  // ---- URL ----------------------------------------------------------------
  const urlInput = el("input", {
    class: "input",
    type: "url",
    placeholder: "https://example.com",
    autocomplete: "off",
    "aria-label": "URL to capture",
  }) as HTMLInputElement;
  const urlError = el("div", { class: "error-text", role: "alert" });

  const pathPreview = el("div", { class: "readonly-path" }, [
    `${outRoot}/<host>/`,
  ]);
  function currentHost(): string {
    return urlInput.value.trim() ? hostOf(urlInput.value.trim()) : "<host>";
  }
  function refreshPathPreview(): void {
    pathPreview.textContent = `${outRoot}/${currentHost()}/`;
  }
  urlInput.addEventListener("input", () => {
    refreshPathPreview();
    urlError.textContent = "";
  });

  // Native "Change…" folder chooser for this job's output root (FR-OUT-1/2).
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
      refreshPathPreview();
    }
  });

  // ---- Scope toggle (seeded from Settings → Defaults, FR-SET-2) -----------
  let scope: "page" | "site" = settings.defaultScope === "site" ? "site" : "page";
  const pageCard = el("div", { class: `choice${scope === "page" ? " selected" : ""}` }, [
    el("div", { class: "t" }, ["This page only"]),
    el("div", { class: "d" }, ["One page + its immediate assets"]),
  ]);
  const siteCard = el("div", { class: `choice${scope === "site" ? " selected" : ""}` }, [
    el("div", { class: "t" }, ["Whole site"]),
    el("div", { class: "d" }, ["Follows links within scope"]),
  ]);
  const scopeRow = el("div", { class: "locked-choice" }, [pageCard, siteCard]);

  // ---- Depth (whole site only) -------------------------------------------
  const depthSelect = el("select", { class: "input" }) as HTMLSelectElement;
  for (const p of DEPTH_PRESETS) {
    const opt = el("option", { value: String(p.value) }, [p.label]) as HTMLOptionElement;
    if (p.value === (settings.defaultDepth || DEFAULTS.depth)) opt.selected = true;
    depthSelect.append(opt);
  }
  const depthField = el("div", {
    class: "field",
    style: scope === "site" ? "" : "display:none",
  }, [
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
    if (v === (settings.defaultDomainScope || DEFAULTS.domainScope)) opt.selected = true;
    domainScope.append(opt);
  }

  const allowedDomainsInput = el("input", {
    class: "input",
    type: "text",
    placeholder: "docs.example.com, cdn.example.com",
    autocomplete: "off",
  }) as HTMLInputElement;
  const allowedField = el("div", {
    class: "field",
    style: domainScope.value === "list" ? "" : "display:none",
  }, [
    el("label", {}, ["Allowed domains (comma-separated)"]),
    allowedDomainsInput,
  ]);
  const anyDomainCaution = el(
    "div",
    { class: "caution", style: domainScope.value === "any" ? "" : "display:none" },
    ["Any-domain crawls can wander across the whole web. Use with care."],
  );
  domainScope.addEventListener("change", () => {
    allowedField.style.display = domainScope.value === "list" ? "" : "none";
    anyDomainCaution.style.display = domainScope.value === "any" ? "" : "none";
  });

  const rateInput = numInput(settings.ratePerSec || DEFAULTS.ratePerSec, "0.1", "5");
  const concurrencyInput = numInput(
    settings.concurrency || DEFAULTS.concurrency,
    "1",
    "8",
  );

  const robotsDefault = settings.respectRobots ?? DEFAULTS.respectRobots;
  let respectRobots = robotsDefault;
  const robotsRespect = el("label", { class: "radio" }, [
    radio("robots", robotsDefault, () => (respectRobots = true)),
    " Respect robots.txt (default)",
  ]);
  const robotsIgnore = el("label", { class: "radio" }, [
    radio("robots", !robotsDefault, () => (respectRobots = false)),
    " Ignore robots.txt",
  ]);
  const robotsCaution = el("div", { class: "caution" }, [
    "Ignoring robots.txt overrides the site's stated crawl preferences — only do this for content you're allowed to mirror.",
  ]);

  const uaInput = el("input", {
    class: "input",
    type: "text",
    value: settings.userAgent || DEFAULTS.userAgent,
    autocomplete: "off",
  }) as HTMLInputElement;

  const maxPagesInput = numInput(DEFAULTS.maxPages, "1", "100000");
  const maxSizeInput = numInput(DEFAULTS.maxBytesGb, "0.1", "100");
  const maxTimeInput = numInput(DEFAULTS.maxMinutes, "1", "600");

  // ---- Render JavaScript toggle (D1, M4 / FR-RENDER-2) -------------------
  // Opt-in; static (unchecked) is the default (FR-RENDER-1). Disabled with a
  // tooltip until we confirm a system browser exists (render_available), so the
  // option is honest about what the machine can actually do.
  let render = settings.defaultRender ?? false;
  const renderCheckbox = el("input", { type: "checkbox" }) as HTMLInputElement;
  renderCheckbox.checked = render;
  // Start disabled: enabled once the availability probe resolves true.
  renderCheckbox.disabled = true;
  renderCheckbox.addEventListener("change", () => {
    render = renderCheckbox.checked;
  });
  const renderLabel = el("label", { class: "radio" }, [
    renderCheckbox,
    " Render JavaScript (slower)",
  ]);
  const renderHint = el("div", { class: "hint", style: "margin-top:6px" }, [
    "Drives a system Chrome/Chromium to capture pages that build their content with JavaScript. Slower, and needs Chrome installed. Static fetch is the default.",
  ]);
  const renderField = el("div", { class: "field" }, [
    el("label", {}, ["JavaScript rendering"]),
    renderLabel,
    renderHint,
  ]);
  // Probe availability; enable the toggle only if a browser was found, else set
  // an explanatory tooltip (E-7). No-op / disabled in browser mode.
  if (tauri) {
    void renderAvailable().then((ok) => {
      if (ok) {
        renderCheckbox.disabled = false;
        renderLabel.removeAttribute("title");
      } else {
        renderCheckbox.disabled = true;
        renderCheckbox.checked = false;
        render = false;
        renderLabel.setAttribute(
          "title",
          "JavaScript rendering needs Google Chrome (or another Chromium browser) installed on this computer.",
        );
        renderHint.textContent =
          "Unavailable: install Google Chrome (or another Chromium browser) to capture JavaScript-rendered pages. Static fetch is used otherwise.";
      }
    });
  } else {
    renderLabel.setAttribute("title", "Rendering runs in the desktop app.");
  }

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
    renderField,
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
      el("div", { class: "path-row" }, [pathPreview, changeFolderBtn]),
      outPathError,
      el("div", { class: "hint", style: "margin-top:6px" }, [
        "The mirror is written to this folder. Change it per-job or set a new default in Settings → Storage.",
      ]),
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

  startBtn.addEventListener("click", async () => {
    const err = validate();
    if (err) {
      urlError.textContent = err;
      return;
    }
    outPathError.textContent = "";
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
      outRoot,
      ratePerSec: clampNum(rateInput.value, 0.1, 5, DEFAULTS.ratePerSec),
      concurrency: Math.round(clampNum(concurrencyInput.value, 1, 8, DEFAULTS.concurrency)),
      respectRobots,
      userAgent: uaInput.value.trim() || undefined,
      maxPages: Math.round(clampNum(maxPagesInput.value, 1, 100000, DEFAULTS.maxPages)),
      maxBytes: Math.round(
        clampNum(maxSizeInput.value, 0.1, 100, DEFAULTS.maxBytesGb) * 1024 * 1024 * 1024,
      ),
      maxSeconds: Math.round(clampNum(maxTimeInput.value, 1, 600, DEFAULTS.maxMinutes) * 60),
      render,
    };

    // Validate the output folder is writable + has space before Start (FR-OUT-2).
    // Block Start with an inline error if unwritable.
    if (tauri) {
      startBtn.disabled = true;
      const prev = startBtn.textContent;
      startBtn.textContent = "Checking folder…";
      let check;
      try {
        check = await checkOutputPath(`${outRoot}/${currentHost()}`);
      } finally {
        startBtn.disabled = false;
        startBtn.textContent = prev;
      }
      if (!check.writable) {
        outPathError.textContent =
          check.error ?? "That folder isn't writable. Pick a different location.";
        return;
      }
      // Warn (don't block) when free space is known and tight vs. the size cap.
      if (check.freeBytes > 0 && check.freeBytes < config.maxBytes) {
        outPathError.textContent = `Low disk space at this location (${fmtGb(check.freeBytes)} free). The job may hit the disk-full cap.`;
        // Non-blocking: fall through to the pre-flight / start.
      }
    }

    // Pre-flight confirm sheet (D2, FR-SET-3): shown ONLY when the job trips a
    // threshold. Small/safe jobs skip it and go straight to Progress.
    const cautions = preflightCautions(config);
    if (cautions.length > 0) {
      openPreflight(config, cautions, () => onStart(config));
    } else {
      onStart(config);
    }
  });
}

// ---- Pre-flight (D2) -----------------------------------------------------

/** Depth beyond which a whole-site crawl counts as "deep" for the pre-flight. */
const DEEP_DEPTH = 4;

/**
 * Decide whether a job trips a pre-flight threshold and, if so, produce the
 * targeted caution line(s) (FR-SET-3, LG-TOS-2). Returns an empty array for a
 * small/safe job (no sheet shown). Copy lifted from docs/acceptable-use.md.
 */
function preflightCautions(c: CrawlConfig): string[] {
  const out: string[] = [];
  const wholeSiteDeep = c.scope === "site" && c.depth >= DEEP_DEPTH;
  if (wholeSiteDeep) {
    out.push(
      "This is a whole-site crawl going several levels deep — it could capture a lot of pages.",
    );
  }
  if (!c.respectRobots) {
    out.push(
      "⚠ You chose to ignore robots.txt for this job. Make sure you have the right to mirror these pages.",
    );
  }
  if (c.domainScope === "any") {
    out.push(
      "⚠ You allowed any domain. This job can follow links off the original site — only do this for content you're allowed to mirror.",
    );
  } else if (c.domainScope === "subdomains" || c.domainScope === "list") {
    out.push("This job may cross into other domains you allowed.");
  }
  // Estimate over the safety caps: treat generous caps as "over the limit".
  const overPageCap = c.maxPages > DEFAULTS.maxPages;
  const overSizeCap = c.maxBytes > DEFAULTS.maxBytesGb * 1024 * 1024 * 1024;
  const overTimeCap = c.maxSeconds > DEFAULTS.maxMinutes * 60;
  if (overPageCap || overSizeCap || overTimeCap) {
    // Verbatim "Unlimited / no caps" caution from docs/acceptable-use.md
    // (LG-TOS-2). Shown when the user raised any safety limit above the default.
    out.push(
      "⚠ You removed the safety limits. This job has no page, size, or time cap and could get very large.",
    );
  }
  return out;
}

/** Compact GB label for the low-space warning. */
function fmtGb(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${Math.round(mb)} MB`;
}

/** A one-sentence scope summary for the pre-flight header. */
function scopeSentence(c: CrawlConfig): string {
  const scopeStr = c.scope === "site" ? "Whole site" : "This page only";
  const domain =
    c.domainScope === "same"
      ? "same domain"
      : c.domainScope === "subdomains"
        ? "including subdomains"
        : c.domainScope === "list"
          ? "specific domains"
          : "any domain";
  const depthStr = c.scope === "site" ? ` · depth ${c.depth}` : "";
  return `${scopeStr}${depthStr} · ${domain}`;
}

/** Show the pre-flight confirm sheet with Start anyway / Adjust (FR-SET-3). */
function openPreflight(c: CrawlConfig, cautions: string[], onConfirm: () => void): void {
  const overlay = el("div", { class: "sheet-overlay" });
  const close = () => overlay.remove();

  const cautionEls = cautions.map((line) =>
    el("div", { class: line.startsWith("⚠") ? "caution" : "hint" }, [line]),
  );

  const startBtn = el("button", { class: "btn accent block" }, ["Start anyway"]);
  startBtn.addEventListener("click", () => {
    close();
    onConfirm();
  });
  const adjustBtn = el("button", { class: "btn ghost block" }, ["Adjust settings"]);
  adjustBtn.addEventListener("click", close);

  const sheet = el("div", { class: "sheet" }, [
    el("h2", { class: "sheet-title" }, ["Before we start"]),
    el("div", { class: "preflight-scope" }, [scopeSentence(c)]),
    ...cautionEls,
    startBtn,
    adjustBtn,
  ]);
  overlay.append(sheet);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.body.append(overlay);
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
