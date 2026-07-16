import { el } from "../dom";
import { signIn } from "../auth";
import { isTauri } from "../tauri";
import { logoSvg, WORDMARK, IL_SITE_NAME, IL_SITE_URL, PRODUCT_NAME } from "../brand";

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
    el("div", { class: "signin-links" }, [forgot]),
    el("div", { class: "signin-footer" }, [
      linkBtn("Quit", () => quit()),
      linkBtn("About", () => alert(`${PRODUCT_NAME}\nM0 walking skeleton.`)),
      linkBtn("Help", () => openExternal(IL_SITE_URL)),
    ]),
  ]);

  const wrap = el("div", { class: "signin-wrap" }, [card]);
  root.append(wrap);
  userInput.focus();
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
