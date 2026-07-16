import { el } from "../dom";
import { signIn } from "../auth";
import { isTauri } from "../tauri";
import { logoSvg, WORDMARK, IL_SITE_NAME, IL_SITE_URL, PRODUCT_NAME } from "../brand";

/**
 * Screen B — Sign-in gate.
 * InterlinedList-branded so users trust entering credentials (Risk R7).
 *
 * TODO(M0->real): replace mock with interlinedlist.com auth API + OS keychain
 * token storage. M0 keeps the token in memory only (see src/auth.ts).
 */
export function renderSignIn(root: HTMLElement, onSuccess: () => void): void {
  let showPassword = false;

  const errorEl = el("div", { class: "error-text", role: "alert" });
  const userInput = el("input", {
    class: "input",
    type: "text",
    id: "il-username",
    autocomplete: "username",
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
      errorEl.textContent = err;
      passInput.value = ""; // clear password on failure (never linger)
      submitBtn.disabled = false;
      submitBtn.textContent = "Sign in";
    } else {
      onSuccess();
    }
  }

  const form = el("form", { class: "signin-form", novalidate: true }, [
    el("div", { class: "field" }, [
      el("label", { for: "il-username" }, ["Username or email"]),
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
    openExternal(IL_SITE_URL);
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
