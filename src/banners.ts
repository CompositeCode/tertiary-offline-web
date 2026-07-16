/**
 * Global banners docked at the top of the content area (M5).
 *
 * Three kinds:
 *  - offline:         network is unavailable (non-blocking, auto-clears)
 *  - session-expired: the IL session expired mid-use (actionable: Sign in)
 *  - update-available: a newer version is ready (non-blocking, dismissible)
 *
 * Plus the first-run ToS acknowledgment card (LG-TOS-1), which is a one-time,
 * non-blocking banner — not a modal — dismissed with "Got it".
 */

import { el } from "./dom";
import { checkForUpdate, type UpdateInfo } from "./tauri";
import { markAcknowledged, isAcknowledged } from "./settings";
import { openAcceptableUse } from "./legal";

/** Dismissed-this-session set so a dismissed update banner doesn't reappear. */
const dismissed = new Set<string>();

/**
 * Render the banner stack into `host` (the top of the content area). Reads live
 * connectivity + a cached update result; call on each shell render.
 */
export function renderBanners(host: HTMLElement): void {
  // First-run acknowledgment (LG-TOS-1): once, before anything else.
  if (!isAcknowledged()) {
    host.append(firstRunCard());
  }

  // Offline banner (NFR-OFF-1): driven by the browser's online state.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    host.append(
      banner(
        "offline",
        "You're offline. Scraping is paused until your connection returns; existing mirrors stay browsable.",
        null,
      ),
    );
  }

  // Update-available banner (Q10): shown when a check has surfaced one and it
  // wasn't dismissed this session.
  if (pendingUpdate && !dismissed.has(`update:${pendingUpdate.version}`)) {
    host.append(updateBanner(pendingUpdate));
  }
}

/** The first-run acknowledgment card (verbatim copy from acceptable-use.md). */
function firstRunCard(): HTMLElement {
  const card = el("div", { class: "banner ack", role: "region", "aria-label": "Before you start" });

  const gotIt = el("button", { class: "btn accent small" }, ["Got it"]);
  gotIt.addEventListener("click", () => {
    void markAcknowledged();
    card.remove();
  });
  const readGuide = el("button", { class: "btn ghost small" }, ["Read the acceptable-use guide"]);
  readGuide.addEventListener("click", () => void openAcceptableUse());

  card.append(
    el("div", { class: "banner-title" }, ["A quick note before you start"]),
    el("div", { class: "banner-text" }, [
      "InterlinedList Offline saves copies of web content to your computer for " +
        "offline reading. You're responsible for respecting each site's terms and " +
        "copyright — mirror only content you're allowed to. By default the app " +
        "respects robots.txt, fetches politely, and keeps everything on your " +
        "device — nothing you save is ever uploaded.",
    ]),
    el("div", { class: "banner-actions" }, [gotIt, readGuide]),
  );
  return card;
}

/** A generic docked banner. `action` (label + handler) is optional. */
function banner(
  kind: "offline" | "session" | "update",
  text: string,
  action: { label: string; onClick: () => void } | null,
  onDismiss?: () => void,
): HTMLElement {
  const children: (Node | string)[] = [el("div", { class: "banner-text" }, [text])];
  const actions = el("div", { class: "banner-actions" });
  if (action) {
    const btn = el("button", { class: "btn accent small" }, [action.label]);
    btn.addEventListener("click", action.onClick);
    actions.append(btn);
  }
  if (onDismiss) {
    const x = el("button", { class: "banner-dismiss", "aria-label": "Dismiss" }, ["×"]);
    x.addEventListener("click", onDismiss);
    actions.append(x);
  }
  children.push(actions);
  return el("div", { class: `banner ${kind}`, role: "status" }, children);
}

function updateBanner(update: UpdateInfo): HTMLElement {
  const b = banner(
    "update",
    `Version ${update.version} is available.`,
    {
      label: "Update now",
      onClick: () => void update.install(),
    },
    () => {
      dismissed.add(`update:${update.version}`);
      b.remove();
    },
  );
  return b;
}

// ---- Update polling ------------------------------------------------------

let pendingUpdate: UpdateInfo | null = null;

/**
 * Check for an update once at launch (Q10). Non-blocking: on success stashes the
 * result so the next `renderBanners` shows the banner. Callers may pass a
 * re-render hook to surface it immediately.
 */
export async function pollForUpdate(onFound?: () => void): Promise<void> {
  const update = await checkForUpdate();
  if (update) {
    pendingUpdate = update;
    onFound?.();
  }
}
