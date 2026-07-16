import "./styles/brand.css";
import "./styles/app.css";
import { renderSignIn } from "./screens/signin";
import { renderShell, takePendingResume } from "./screens/shell";
import { isSignedIn, refreshSession } from "./auth";
import { loadSettings } from "./settings";
import { initTheme, syncThemeFromAccount } from "./theme";
import { pollForUpdate } from "./banners";

/**
 * App entry. A tiny state machine routes between the sign-in gate (B) and the
 * signed-in shell (Library / New scrape / Results / Settings). No framework —
 * each screen renders into #app and calls back into `route()` to re-render.
 */

export type Route = "library" | "new-scrape" | "results" | "progress" | "settings";

const root = document.getElementById("app")!;

/** Re-render the whole app based on current (already-resolved) auth state. */
export function route(initial: Route = "library"): void {
  root.innerHTML = "";
  if (!isSignedIn()) {
    renderSignIn(root, () => {
      // On successful sign-in, resume any job that auto-paused on session
      // expiry (FR-AUTH-5). The resume callback re-enters the running crawl.
      const resume = takePendingResume();
      if (resume) {
        resume();
        route("library");
      } else {
        route("library");
      }
    });
  } else {
    renderShell(root, initial);
  }
}

/**
 * Launch: validate any stored token against interlinedlist.com (FR-AUTH-9),
 * then route to Library if valid or Sign-in if not. A stored-but-offline token
 * is tolerated by the backend so existing mirrors stay reachable.
 */
async function launch(): Promise<void> {
  root.innerHTML = "";
  // Load persisted settings (defaults on first run) before the first render so
  // Defaults pre-populate New Scrape and the first-run ack flag is known.
  await Promise.all([refreshSession(), loadSettings()]);
  // Apply the cached theme before the first paint so there's no light/dark flash.
  initTheme();
  route();
  // Pull the account's theme from InterlinedList and apply if it differs (the
  // preference follows the user across devices). Non-blocking.
  void syncThemeFromAccount();
  // Non-blocking update check (Q10). If one is found, re-render so the banner
  // shows on the current screen.
  void pollForUpdate(() => {
    if (isSignedIn()) route();
  });
}

void launch();
