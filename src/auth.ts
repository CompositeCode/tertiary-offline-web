import { isTauri, mockLogin, type Session } from "./tauri";

/**
 * In-memory auth state for M0.
 *
 * TODO(M0->real): replace mock with interlinedlist.com auth API + OS keychain
 * token storage. For M0 the token lives ONLY in module memory — it is never
 * written to disk, which keeps the "no plaintext secret" promise honest.
 * Keychain (macOS Keychain / Windows Credential Manager / Linux Secret Service)
 * is the real target per NFR-SEC-1.
 */
let session: Session | null = null;

export function getSession(): Session | null {
  return session;
}

export function isSignedIn(): boolean {
  return session !== null;
}

export function signOut(): void {
  session = null;
}

/**
 * Attempt sign-in. Returns an error message string on failure, or null on
 * success. Validates non-empty inputs client-side so browser mode can still
 * exercise the gate copy; the actual (mock) credential check happens in Rust.
 */
export async function signIn(
  username: string,
  password: string,
): Promise<string | null> {
  // Empty -> distinct copy per ux-design.md B error states.
  if (username.trim() === "" || password === "") {
    return "Enter your username and password.";
  }

  if (isTauri()) {
    try {
      session = await mockLogin(username, password);
      return null;
    } catch (e) {
      // Rust returns Err(String) for blank/invalid credentials.
      return typeof e === "string" ? e : "Incorrect username or password.";
    }
  }

  // Browser mode: no native backend. Mirror the mock rule (any non-empty
  // username AND password succeeds) so the UI flow is demonstrable in a browser.
  session = { username: username.trim(), token: "browser-mock-token" };
  return null;
}
