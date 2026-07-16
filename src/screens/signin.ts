import { el } from "../dom";
import { signIn } from "../auth";
import { isTauri, listJobs, revealPath } from "../tauri";
import { getSettings } from "../settings";
import { logoSvg, WORDMARK, IL_SITE_NAME, IL_SITE_URL, PRODUCT_NAME } from "../brand";
import { openAcceptableUse } from "../legal";

/**
 * Screen B — Sign-in gate.
 * InterlinedList-branded so users trust entering credentials (Risk R7).
 *
 * Real auth: the email + password are handed to the Rust `login` command, which
 * exchanges them over HTTPS for a long-lived Bearer sync token and stores that
 * token in the OS keychain. The password never leaves the exchange; the token
 * never crosses into JS (see src/auth.ts, src-tauri/src/auth.rs).
 */
export function renderSignIn(root: HTMLElement, onSuccess: () => void): void {
  let showPassword = false;

  const errorEl = el("div", { class: "error-text", role: "alert" });
  const userInput = el("input", {
    class: "input",
    type: "email",
    id: "il-email",
    autocomplete: "username",
    inputmode: "email",
    placeholder: "you@example.com",
  }) as HTMLInputElement;
  const passInput = el("input", {
    class: "input",
    type: "password",
    id: "il-password",
    autocomplete: "current-password",
  }) as HTMLInputElement;

  const toggleBtn = el(
    "button",
    { class: "toggle", type: "button", "aria-label": "Show password" },
    ["show"],
  );
  toggleBtn.addEventListener("click", () => {
    showPassword = !showPassword;
    passInput.type = showPassword ? "text" : "password";
    toggleBtn.textContent = showPassword ? "hide" : "show";
  });

  const submitBtn = el("button", {
    class: "btn primary block",
    type: "submit",
  }, ["Sign in"]) as HTMLButtonElement;

  async function attempt(ev: Event) {
    ev.preventDefault();
    errorEl.textContent = "";
    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in…";
    const err = await signIn(userInput.value, passInput.value);
    if (err) {
      errorEl.textContent = err.message;
      // Clear the password on any failure so it never lingers in the DOM.
      // Keep it on "unreachable" so the user can retry without retyping? No —
      // consistent hygiene: always clear the password field on failure.
      passInput.value = "";
      submitBtn.disabled = false;
      submitBtn.textContent = "Sign in";
    } else {
      onSuccess();
    }
  }

  const form = el("form", { class: "signin-form", novalidate: true }, [
    el("div", { class: "field" }, [
      el("label", { for: "il-email" }, ["Email"]),
      userInput,
    ]),
    el("div", { class: "field" }, [
      el("label", { for: "il-password" }, ["Password"]),
      el("div", { class: "input-group" }, [passInput, toggleBtn]),
    ]),
    errorEl,
    submitBtn,
  ]);
  form.addEventListener("submit", attempt);

  const forgot = el("a", {}, ["Forgot password?"]);
  forgot.addEventListener("click", (e) => {
    e.preventDefault();
    // Password reset happens on the website, not in the app (FR-AUTH-2b).
    openExternal(`${IL_SITE_URL}/forgot-password`);
  });

  // B1. "Trouble signing in?" recovery panel (docs/ux-design.md §4.B). A quiet
  // affordance that reveals can't-reach guidance, a forgot-password link, and —
  // when local mirrors exist — a way to open them offline. Collapsed by default.
  const { toggle: troubleToggle, panel: troublePanel } = buildTroublePanel();

  const card = el("div", { class: "signin-card" }, [
    el("div", { class: "signin-header" }, [
      el("div", { class: "logo", html: logoSvg(40) }),
      el("div", { class: "wordmark" }, [
        WORDMARK.primary,
        el("span", { class: "suffix" }, [WORDMARK.suffix]),
      ]),
      el("div", { class: "signin-sub" }, ["Mirror the web for offline reading"]),
    ]),
    el("div", { class: "signin-gate-note" }, [
      `${PRODUCT_NAME} is free, but requires an ${IL_SITE_NAME} account.`,
    ]),
    form,
    el("div", { class: "signin-links" }, [forgot, troubleToggle]),
    troublePanel,
    el("div", { class: "signin-footer" }, [
      linkBtn("Quit", () => quit()),
      linkBtn("Acceptable use", () => void openAcceptableUse()),
      linkBtn("Help", () => openExternal(IL_SITE_URL)),
    ]),
  ]);

  const wrap = el("div", { class: "signin-wrap" }, [card]);
  root.append(wrap);
  userInput.focus();
}

/**
 * B1 recovery panel builder. Returns a small toggle link and the collapsible
 * help panel it controls. The "browse existing mirrors offline" affordance only
 * appears once we confirm local mirrors exist on disk (async, non-blocking).
 */
function buildTroublePanel(): { toggle: HTMLElement; panel: HTMLElement } {
  const panel = el("div", { class: "signin-trouble", hidden: true, role: "region" }, [
    el("p", { class: "hint", style: "margin-top:0" }, [
      `If ${IL_SITE_NAME} won't load, check your internet connection and try again — ` +
        `${PRODUCT_NAME} needs to reach ${IL_SITE_NAME} once to sign you in.`,
    ]),
    el("p", { class: "hint" }, [
      "Forgot your password? Reset it on the website, then come back and sign in: ",
      troubleLink("Reset password", () => openExternal(`${IL_SITE_URL}/forgot-password`)),
      ".",
    ]),
  ]);

  const toggle = el("a", { href: "#", "aria-expanded": "false" }, ["Trouble signing in?"]);
  toggle.addEventListener("click", (e) => {
    e.preventDefault();
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });

  // If local mirrors exist, offer an offline "browse existing mirrors" path.
  // Sign-in isn't required to read local mirrors, so we surface the folder.
  if (isTauri()) {
    void (async () => {
      try {
        const root = getSettings().mirrorsRoot;
        const jobs = await listJobs(root);
        if (jobs.length > 0) {
          panel.append(
            el("p", { class: "hint" }, [
              `You already have ${jobs.length} mirror${jobs.length === 1 ? "" : "s"} saved on this device. `,
              troubleLink("Browse existing mirrors offline", () =>
                void revealPath(root).catch(() => {}),
              ),
              " — reading saved mirrors doesn't require signing in.",
            ]),
          );
        }
      } catch {
        /* no mirrors / not available — omit the offline affordance */
      }
    })();
  }

  return { toggle, panel };
}

function troubleLink(label: string, onClick: () => void): HTMLElement {
  const a = el("a", { href: "#" }, [label]);
  a.addEventListener("click", (e) => {
    e.preventDefault();
    onClick();
  });
  return a;
}

function linkBtn(label: string, onClick: () => void): HTMLElement {
  const a = el("a", { href: "#" }, [label]);
  a.addEventListener("click", (e) => {
    e.preventDefault();
    onClick();
  });
  return a;
}

async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener");
  }
}

async function quit(): Promise<void> {
  if (isTauri()) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  } else {
    // Best-effort in a browser tab.
    window.close();
  }
}
