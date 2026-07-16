import { el } from "../dom";
import { logoSvg, WORDMARK } from "../brand";
import { getSession, signOut } from "../auth";
import { isTauri, deleteMirror, type CrawlConfig, type RescrapeOptions } from "../tauri";
import type { Route } from "../main";
import { route } from "../main";
import { renderLibrary } from "./library";
import { renderNewScrape } from "./newscrape";
import { renderResults } from "./results";
import { renderProgress } from "./progress";
import { configFromMirror } from "../resume";
import type { Mirror } from "../store";

/** State passed to the Results screen (the most recent completed scrape). */
let lastMirror: Mirror | null = null;
export function setLastMirror(m: Mirror): void {
  lastMirror = m;
}

/**
 * A pending job to (re)enter Progress with. When `resumeFrom` is set the crawl
 * resumes a persisted job from disk (Library → Resume); otherwise it starts a
 * fresh crawl for `config`. Set by `enterProgress` before switching to the
 * "progress" route.
 */
let pendingJob: {
  config: CrawlConfig;
  resumeFrom?: string;
  reattach?: boolean;
  rescrapeFrom?: { jobDir: string; options?: RescrapeOptions };
} | null = null;

/**
 * A pending re-auth resume callback: set when a running job auto-pauses on
 * session expiry so, after a successful sign-in, we can resume it (FR-AUTH-5).
 */
let pendingResume: (() => void) | null = null;
export function takePendingResume(): (() => void) | null {
  const r = pendingResume;
  pendingResume = null;
  return r;
}

/**
 * Signed-in app shell: persistent left sidebar (C) + content area that swaps
 * between Library, New scrape, and Results.
 */
export function renderShell(root: HTMLElement, current: Route): void {
  const session = getSession();
  const email = session?.email ?? "user";

  const content = el("div", { class: "content" });
  const contentInner = el("div", { class: "content-inner" });
  content.append(contentInner);

  function nav(target: Route): HTMLElement {
    const labels: Record<Route, string> = {
      library: "Library",
      "new-scrape": "New scrape",
      results: "Results",
      progress: "Progress",
    };
    const btn = el(
      "button",
      { class: `nav-item${current === target ? " active" : ""}` },
      [labels[target]],
    );
    btn.addEventListener("click", () => renderShell(root, target));
    return btn;
  }

  const navItems = el("div", { class: "nav" }, [
    nav("library"),
    nav("new-scrape"),
  ]);
  // Results is only reachable once something has been scraped.
  if (lastMirror) navItems.append(nav("results"));
  navItems.append(
    el("div", { class: "nav-item", style: "opacity:.5;cursor:default" }, [
      "Settings",
    ]),
  );

  const signoutBtn = el("button", { class: "signout-btn" }, ["Sign out"]);
  signoutBtn.addEventListener("click", async () => {
    (signoutBtn as HTMLButtonElement).disabled = true;
    await signOut();
    lastMirror = null;
    route();
  });

  const sidebar = el("div", { class: "sidebar" }, [
    el("div", { class: "sidebar-brand" }, [
      el("div", { class: "logo", html: logoSvg(26) }),
      el("div", { class: "wm" }, [
        WORDMARK.primary,
        el("span", { class: "suffix" }, [WORDMARK.suffix]),
      ]),
    ]),
    navItems,
    el("div", { class: "user-chip" }, [
      el("div", { class: "who" }, [
        el("div", { class: "avatar" }, [email.charAt(0).toUpperCase()]),
        el("div", { class: "name", title: email }, [email]),
      ]),
      signoutBtn,
    ]),
  ]);

  root.innerHTML = "";
  root.append(el("div", { class: "shell" }, [sidebar, content]));

  // Browser-mode banner (native scrape unavailable).
  if (!isTauri()) {
    contentInner.append(
      el("div", { class: "browser-banner" }, [
        "Browser preview — scraping runs in the desktop app. Launch with " +
          "`npm run tauri dev` to capture pages.",
      ]),
    );
  }

  // Route content.
  const goResults = (m: Mirror) => {
    setLastMirror(m);
    renderShell(root, "results");
  };
  const goLibrary = () => renderShell(root, "library");

  // Enter Progress for a fresh crawl (config) or a disk resume (jobDir).
  const enterProgress = (config: CrawlConfig, resumeFrom?: string) => {
    pendingJob = { config, resumeFrom };
    renderShell(root, "progress");
  };

  // Enter Progress in re-scrape mode: re-run an existing job's settings into a
  // new dated capture (default) or overwrite in place (FR-OUT-3 / Q12).
  const enterRescrape = (m: Mirror, options?: RescrapeOptions) => {
    if (!m.jobDir) return;
    pendingJob = {
      config: configFromMirror(m),
      rescrapeFrom: { jobDir: m.jobDir, options },
    };
    renderShell(root, "progress");
  };

  // Delete a mirror (FR-RES-2), then return to Library.
  const deleteAndReturn = async (m: Mirror) => {
    if (m.jobDir) {
      try {
        await deleteMirror(m.jobDir);
      } catch (e) {
        // Surface the guard error briefly; stay on Results.
        alert(typeof e === "string" ? e : "Could not delete this mirror.");
        return;
      }
    }
    if (lastMirror?.jobDir === m.jobDir) lastMirror = null;
    renderShell(root, "library");
  };

  const resultsActions = (m: Mirror) => ({
    onNewScrape: () => renderShell(root, "new-scrape"),
    onRescrape: (mm: Mirror, options?: RescrapeOptions) => enterRescrape(mm, options),
    onResume: (mm: Mirror) => enterProgress(configFromMirror(mm), mm.jobDir),
    onDelete: (mm: Mirror) => void deleteAndReturn(mm),
    onReload: () => {
      setLastMirror(m);
      renderShell(root, "results");
    },
  });

  // Session-expired handoff: stash a resume-after-reauth callback and route to
  // Sign-in (FR-AUTH-5). The paused job stays alive in-process; on successful
  // sign-in we re-enter Progress in reattach mode, which un-parks it and follows
  // its events to completion. `resume` (the caller's own un-park) is unused
  // because reattach mode handles the un-park itself.
  const onSessionExpired = (config2: CrawlConfig, jobDir: string | undefined) => {
    pendingResume = () => {
      pendingJob = { config: config2, resumeFrom: jobDir, reattach: true };
      renderShell(root, "progress");
    };
    route();
  };

  if (current === "library") {
    renderLibrary(
      contentInner,
      () => renderShell(root, "new-scrape"),
      goResults,
      (m) => enterProgress(configFromMirror(m), m.jobDir),
    );
  } else if (current === "new-scrape") {
    renderNewScrape(contentInner, goResults, enterProgress);
  } else if (current === "progress" && pendingJob) {
    const { config, resumeFrom, reattach, rescrapeFrom } = pendingJob;
    pendingJob = null;
    renderProgress(
      contentInner,
      config,
      goResults,
      goLibrary,
      onSessionExpired,
      resumeFrom,
      reattach,
      rescrapeFrom,
    );
  } else if (current === "results" && lastMirror) {
    renderResults(contentInner, lastMirror, resultsActions(lastMirror));
  } else {
    renderLibrary(
      contentInner,
      () => renderShell(root, "new-scrape"),
      goResults,
      (m) => enterProgress(configFromMirror(m), m.jobDir),
    );
  }
}
