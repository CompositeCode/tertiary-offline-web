import "./styles/brand.css";
import "./styles/app.css";
import { renderSignIn } from "./screens/signin";
import { renderShell } from "./screens/shell";
import { isSignedIn } from "./auth";

/**
 * App entry. A tiny state machine routes between the sign-in gate (B) and the
 * signed-in shell (Library / New scrape / Results). No framework — each screen
 * renders into #app and calls back into `route()` to re-render.
 */

export type Route = "library" | "new-scrape" | "results";

const root = document.getElementById("app")!;

/** Re-render the whole app based on current auth state. */
export function route(initial: Route = "library"): void {
  root.innerHTML = "";
  if (!isSignedIn()) {
    renderSignIn(root, () => route("library"));
  } else {
    renderShell(root, initial);
  }
}

route();
