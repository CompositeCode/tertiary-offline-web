import "./styles/brand.css";
import "./styles/app.css";
import { renderSignIn } from "./screens/signin";
import { renderShell, takePendingResume } from "./screens/shell";
import { isSignedIn, refreshSession } from "./auth";

/**
 * App entry. A tiny state machine routes between the sign-in gate (B) and the
 * signed-in shell (Library / New scrape / Results). No framework — each screen
 * renders into #app and calls back into `route()` to re-render.
 */

export type Route = "library" | "new-scrape" | "results" | "progress";

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
  await refreshSession();
  route();
}

void launch();
