import { el } from "../dom";
import {
  isTauri,
  pickFolder,
  mirrorsDiskUsage,
  revealPath,
  checkOutputPath,
  type DiskUsage,
} from "../tauri";
import { getSession, signOut } from "../auth";
import { getSettings, saveSettings, type AppSettings, type Theme } from "../settings";
import { setTheme } from "../theme";
import { fmtBytes } from "../format";
import { IL_SITE_URL, IL_SITE_NAME, PRODUCT_NAME } from "../brand";
import { openAcceptableUse } from "../legal";

/**
 * Screen H — Settings. Four tabs (FR-SET-1): Account, Defaults, Storage,
 * Network. Persists via the settings store (src/settings.ts →
 * src-tauri/src/settings.rs). The safe defaults remain the defaults (FR-SET-2);
 * changes here pre-populate New Scrape.
 */

type Tab = "account" | "defaults" | "storage" | "network";

export function renderSettings(
  container: HTMLElement,
  onSignedOut: () => void,
): void {
  container.append(el("div", { class: "page-head" }, [el("h1", {}, ["Settings"])]));

  const tauri = isTauri();
  const s = getSettings();

  let current: Tab = "account";
  const body = el("div", { class: "settings-body" });

  const tabDefs: { id: Tab; label: string }[] = [
    { id: "account", label: "Account" },
    { id: "defaults", label: "Defaults" },
    { id: "storage", label: "Storage" },
    { id: "network", label: "Network" },
  ];

  const tabBar = el("div", { class: "settings-tabs", role: "tablist" });
  const tabButtons = new Map<Tab, HTMLElement>();
  for (const t of tabDefs) {
    const btn = el(
      "button",
      {
        class: "settings-tab",
        role: "tab",
        "aria-selected": current === t.id ? "true" : "false",
      },
      [t.label],
    );
    btn.addEventListener("click", () => select(t.id));
    tabButtons.set(t.id, btn);
    tabBar.append(btn);
  }

  function select(tab: Tab): void {
    current = tab;
    for (const [id, btn] of tabButtons) {
      btn.classList.toggle("active", id === tab);
      btn.setAttribute("aria-selected", id === tab ? "true" : "false");
    }
    body.innerHTML = "";
    if (tab === "account") body.append(accountTab(onSignedOut));
    else if (tab === "defaults") body.append(defaultsTab(s));
    else if (tab === "storage") body.append(storageTab(s, tauri));
    else body.append(networkTab(s));
  }

  container.append(tabBar, body);
  select("account");
}

// ---- Account -------------------------------------------------------------

function accountTab(onSignedOut: () => void): HTMLElement {
  const email = getSession()?.email ?? "Not signed in";
  const s = getSettings();

  // Notifications & Privacy (wires the previously headless `notifications` /
  // `crashReports` settings).
  const notifyToggle = checkboxRow(
    "Show a native notification when a mirror finishes",
    s.notifications,
    (v) => void saveSettings({ notifications: v }),
  );
  const crashToggle = checkboxRow(
    "Send crash reports (opt-in)",
    s.crashReports,
    (v) => void saveSettings({ crashReports: v }),
  );

  // Appearance (theme). Saved to the InterlinedList account so it follows the
  // user across devices; applied immediately on change.
  const themeSel = selectInput(
    [
      ["system", "Match system"],
      ["light", "Light"],
      ["dark", "Dark"],
    ],
    s.theme,
    (v) => void setTheme(v as Theme),
  );

  const signoutBtn = el(
    "button",
    { class: "btn danger", "aria-label": "Sign out of your InterlinedList account" },
    ["Sign out"],
  ) as HTMLButtonElement;
  signoutBtn.addEventListener("click", async () => {
    signoutBtn.disabled = true;
    await signOut();
    onSignedOut();
  });

  return el("div", { class: "card" }, [
    el("div", { class: "field" }, [
      el("label", {}, ["Signed in as"]),
      el("div", { class: "settings-value" }, [email]),
    ]),
    el("div", { class: "settings-block" }, [
      el("div", { class: "settings-block-title" }, ["Appearance"]),
      field("Theme", themeSel),
      el("p", { class: "hint", style: "margin-top:2px" }, [
        `Light, dark, or match your system. Saved to your ${IL_SITE_NAME} account ` +
          "and applied on every device you sign in to.",
      ]),
    ]),
    el("div", { class: "settings-block" }, [
      el("div", { class: "settings-block-title" }, ["What your login unlocks"]),
      el("p", { class: "hint" }, [
        `${PRODUCT_NAME} is free. Your ${IL_SITE_NAME} account is a simple access ` +
          "gate — signing in unlocks scraping; there are no tiers, quotas, or " +
          "subscriptions. Your captures stay on this device and are never uploaded.",
      ]),
    ]),
    el("div", { class: "settings-block" }, [
      el("div", { class: "settings-block-title" }, ["Notifications & Privacy"]),
      el("div", { class: "field" }, [notifyToggle]),
      el("p", { class: "hint", style: "margin-top:2px" }, [
        "Native notifications only fire when this is on — they never contain " +
          "scraped content.",
      ]),
      el("div", { class: "field", style: "margin-top:10px" }, [crashToggle]),
      el("p", { class: "hint", style: "margin-top:2px" }, [
        "Crash reports are never sent unless you opt in; they never include " +
          "scraped content or URLs.",
      ]),
    ]),
    el("div", { class: "settings-block" }, [
      el("div", { class: "settings-block-title" }, ["About & legal"]),
      aboutVersionLine(),
      el("div", { class: "settings-links" }, [
        legalLink("Acceptable-use guide", () => void openAcceptableUse()),
        legalLink("InterlinedList", () => void openExternalUrl(IL_SITE_URL)),
      ]),
    ]),
    el("div", { style: "margin-top:16px" }, [signoutBtn]),
  ]);
}

/**
 * Version line for the About block. Reads the real bundle version from the
 * Tauri app API (`getVersion`) so it can never drift from Cargo/tauri.conf;
 * falls back to the compile-time constant in browser mode. The constant is
 * kept in sync with Cargo.toml / package.json / tauri.conf.json.
 */
const APP_VERSION_FALLBACK = "0.1.0";

function aboutVersionLine(): HTMLElement {
  const line = el("p", { class: "hint" }, [`${PRODUCT_NAME} — version ${APP_VERSION_FALLBACK}.`]);
  if (isTauri()) {
    void (async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        const v = await getVersion();
        if (v) line.textContent = `${PRODUCT_NAME} — version ${v}.`;
      } catch {
        /* keep the fallback */
      }
    })();
  }
  return line;
}

function legalLink(label: string, onClick: () => void): HTMLElement {
  const a = el("a", { href: "#" }, [label]);
  a.addEventListener("click", (e) => {
    e.preventDefault();
    onClick();
  });
  return a;
}

async function openExternalUrl(url: string): Promise<void> {
  if (isTauri()) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    } catch {
      /* fall through */
    }
  }
  window.open(url, "_blank", "noopener");
}

// ---- Defaults (FR-SET-2) -------------------------------------------------

function defaultsTab(s: AppSettings): HTMLElement {
  // Scope
  const scopeSel = selectInput(
    [
      ["page", "This page only (safe default)"],
      ["site", "Whole site"],
    ],
    s.defaultScope,
    (v) => void saveSettings({ defaultScope: v as AppSettings["defaultScope"] }),
  );

  // Depth
  const depthSel = selectInput(
    [
      ["1", "Just this section (1)"],
      ["2", "A few levels (2)"],
      ["4", "Deeper (4)"],
      ["100", "Everything (unlimited)"],
    ],
    String(s.defaultDepth),
    (v) => void saveSettings({ defaultDepth: Number(v) }),
  );

  // Domain scope
  const domainSel = selectInput(
    [
      ["same", "Same domain (safe default)"],
      ["subdomains", "Include subdomains"],
      ["list", "Specific domains"],
      ["any", "Any domain (danger)"],
    ],
    s.defaultDomainScope,
    (v) => void saveSettings({ defaultDomainScope: v as AppSettings["defaultDomainScope"] }),
  );

  // Rendering
  const renderToggle = checkboxRow(
    "Render JavaScript by default (slower; static is the default)",
    s.defaultRender,
    (v) => void saveSettings({ defaultRender: v }),
  );

  return el("div", { class: "card" }, [
    el("p", { class: "hint", style: "margin-top:0" }, [
      "These pre-populate New Scrape. The safe set — page-only, respect robots, " +
        "polite rate, same-domain, static — stays the default.",
    ]),
    field("Default scope", scopeSel),
    field("Default depth (whole site)", depthSel),
    field("Default domain scope", domainSel),
    el("div", { class: "field" }, [
      el("label", {}, ["Assets"]),
      el("div", { class: "settings-value" }, [
        "Images, CSS, fonts & JS are always captured so pages render offline.",
      ]),
    ]),
    field("Rendering", renderToggle),
  ]);
}

// ---- Storage (FR-SET-1) --------------------------------------------------

function storageTab(s: AppSettings, tauri: boolean): HTMLElement {
  const rootValue = el("div", { class: "readonly-path" }, [s.mirrorsRoot]);

  const usageLine = el("div", { class: "settings-value" }, ["Calculating…"]);
  const freeLine = el("div", { class: "settings-value" }, [tauri ? "Calculating…" : ""]);
  function refreshUsage(): void {
    if (!tauri) {
      usageLine.textContent = "Disk usage is shown in the desktop app.";
      freeLine.textContent = "";
      return;
    }
    void mirrorsDiskUsage(s.mirrorsRoot).then((u: DiskUsage) => {
      if (!u.exists) {
        usageLine.textContent = "No mirrors yet — this folder will be created on first capture.";
      } else {
        usageLine.textContent = `${fmtBytes(u.totalBytes)} across ${u.mirrorCount} mirror${u.mirrorCount === 1 ? "" : "s"}.`;
      }
    });
    // Real free space on the volume that holds the mirrors root (FR-OUT-2 /
    // FR-SET-1). Reuses the writability/free-space probe.
    freeLine.textContent = "Calculating…";
    void checkOutputPath(s.mirrorsRoot).then((c) => {
      freeLine.textContent =
        c.freeBytes > 0 ? `${fmtBytes(c.freeBytes)} free on this volume.` : "Free space unavailable.";
    });
  }
  refreshUsage();

  const changeBtn = el("button", { class: "btn small", type: "button" }, ["Change…"]) as HTMLButtonElement;
  if (!tauri) changeBtn.disabled = true;
  changeBtn.addEventListener("click", async () => {
    const picked = await pickFolder(s.mirrorsRoot);
    if (picked) {
      s.mirrorsRoot = picked;
      await saveSettings({ mirrorsRoot: picked });
      rootValue.textContent = picked;
      refreshUsage();
    }
  });

  const revealBtn = el("button", { class: "btn small", type: "button" }, [revealLabel()]) as HTMLButtonElement;
  if (!tauri) revealBtn.disabled = true;
  revealBtn.addEventListener("click", () => void revealPath(s.mirrorsRoot).catch(() => {}));

  return el("div", { class: "card" }, [
    el("div", { class: "field" }, [
      el("label", {}, ["Mirrors root folder"]),
      el("div", { class: "path-row" }, [rootValue, changeBtn, revealBtn]),
      el("div", { class: "hint", style: "margin-top:6px" }, [
        "New captures are written under this folder as <host>/. Existing mirrors " +
          "aren't moved when you change it.",
      ]),
    ]),
    el("div", { class: "field" }, [
      el("label", {}, ["Disk usage"]),
      usageLine,
    ]),
    el("div", { class: "field" }, [
      el("label", {}, ["Free space"]),
      freeLine,
    ]),
    el("div", { class: "settings-block" }, [
      el("div", { class: "settings-block-title" }, ["Re-scrape semantics"]),
      el("p", { class: "hint" }, [
        "Re-scraping a mirror writes a new dated capture by default (non-" +
          "destructive); you can choose to overwrite in place from the Results " +
          "screen. Delete a mirror from Results to reclaim space.",
      ]),
    ]),
  ]);
}

// ---- Network (FR-SET-1) --------------------------------------------------

function networkTab(s: AppSettings): HTMLElement {
  const rateInput = el("input", {
    class: "input",
    type: "number",
    min: "0.1",
    max: "5",
    step: "any",
    value: String(s.ratePerSec),
    "aria-label": "Global rate cap in requests per second",
  }) as HTMLInputElement;
  rateInput.addEventListener("change", () => {
    const v = clamp(Number(rateInput.value), 0.1, 5, 1);
    rateInput.value = String(v);
    void saveSettings({ ratePerSec: v });
  });

  const concInput = el("input", {
    class: "input",
    type: "number",
    min: "1",
    max: "8",
    step: "1",
    value: String(s.concurrency),
    "aria-label": "Concurrency (workers)",
  }) as HTMLInputElement;
  concInput.addEventListener("change", () => {
    const v = Math.round(clamp(Number(concInput.value), 1, 8, 2));
    concInput.value = String(v);
    void saveSettings({ concurrency: v });
  });

  const robotsSel = selectInput(
    [
      ["true", "Respect robots.txt (default)"],
      ["false", "Ignore robots.txt (advanced)"],
    ],
    String(s.respectRobots),
    (v) => void saveSettings({ respectRobots: v === "true" }),
  );

  const uaInput = el("input", {
    class: "input",
    type: "text",
    value: s.userAgent,
    "aria-label": "User-Agent string",
  }) as HTMLInputElement;
  uaInput.addEventListener("change", () => {
    const v = uaInput.value.trim();
    if (v) void saveSettings({ userAgent: v });
  });

  return el("div", { class: "card" }, [
    el("p", { class: "hint", style: "margin-top:0" }, [
      "The global politeness ceiling (~5 req/s) applies regardless of these " +
        "values. The User-Agent is sent truthfully — it isn't spoofed to evade blocks.",
    ]),
    field("Global rate cap (requests/sec/host)", rateInput),
    field("Concurrency (workers)", concInput),
    field("robots.txt policy default", robotsSel),
    field("User-Agent", uaInput),
  ]);
}

// ---- Small builders ------------------------------------------------------

function field(label: string, control: HTMLElement): HTMLElement {
  return el("div", { class: "field" }, [el("label", {}, [label]), control]);
}

function selectInput(
  options: [string, string][],
  selected: string,
  onChange: (v: string) => void,
): HTMLSelectElement {
  const sel = el("select", { class: "input" }) as HTMLSelectElement;
  for (const [v, label] of options) {
    const opt = el("option", { value: v }, [label]) as HTMLOptionElement;
    if (v === selected) opt.selected = true;
    sel.append(opt);
  }
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}

function checkboxRow(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const cb = el("input", { type: "checkbox" }) as HTMLInputElement;
  cb.checked = checked;
  cb.addEventListener("change", () => onChange(cb.checked));
  return el("label", { class: "radio" }, [cb, ` ${label}`]);
}

function clamp(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Platform-correct file-manager verb (NFR-XPLAT-1). */
function revealLabel(): string {
  const p = navigator.platform.toLowerCase();
  if (p.includes("mac")) return "Show in Finder";
  if (p.includes("win")) return "Show in Explorer";
  return "Show in Files";
}
