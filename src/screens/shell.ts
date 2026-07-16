import { el } from "../dom";
import { logoSvg, WORDMARK } from "../brand";
import { getSession, signOut } from "../auth";
import { isTauri } from "../tauri";
import type { Route } from "../main";
import { route } from "../main";
import { renderLibrary } from "./library";
import { renderNewScrape } from "./newscrape";
import { renderResults } from "./results";
import type { Mirror } from "../store";

/** State passed to the Results screen (the most recent completed scrape). */
let lastMirror: Mirror | null = null;
export function setLastMirror(m: Mirror): void {
  lastMirror = m;
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
  if (current === "library") {
    renderLibrary(contentInner, () => renderShell(root, "new-scrape"), goResults);
  } else if (current === "new-scrape") {
    renderNewScrape(contentInner, goResults);
  } else if (current === "results" && lastMirror) {
    renderResults(contentInner, lastMirror, () => renderShell(root, "new-scrape"));
  } else {
    renderLibrary(contentInner, () => renderShell(root, "new-scrape"), goResults);
  }
}
