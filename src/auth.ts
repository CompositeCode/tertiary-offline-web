import {
  isTauri,
  login as tauriLogin,
  currentSession as tauriCurrentSession,
  logout as tauriLogout,
  type Session,
} from "./tauri";

/**
 * Auth state for the UI.
 *
 * The real secret (the interlinedlist.com Bearer "sync token") lives ONLY in
 * the OS keychain on the Rust side — it never crosses into JS. This module
 * caches just the `Session` (account email) so screens can render the signed-in
 * identity without a round-trip. The keychain, not this variable, is the source
 * of truth; `refreshSession()` re-syncs from Rust on launch.
 */
let session: Session | null = null;

/** Distinguishes the three sign-in failure modes for the UI copy. */
export type SignInErrorKind = "invalid" | "unreachable" | "empty" | "other";

export interface SignInError {
  kind: SignInErrorKind;
  message: string;
}

export function getSession(): Session | null {
  return session;
}

export function isSignedIn(): boolean {
  return session !== null;
}

/**
 * Ask the backend whether a stored token is still valid (validates against
 * `/api/user`; a definitive 401 clears the keychain). Populates the cached
 * session and returns it. In browser mode there is no keychain, so this is
 * always signed-out. Call once on launch to route Library vs Sign-in.
 */
export async function refreshSession(): Promise<Session | null> {
  if (!isTauri()) {
    session = null;
    return null;
  }
  try {
    session = await tauriCurrentSession();
  } catch {
    session = null;
  }
  return session;
}

/**
 * Handle a session-expired signal from an authenticated call (e.g. a future
 * crawl-time request that returns 401). Drops the cached session so the app's
 * `route()` sends the user back to the Sign-in gate. Full auto-pause/resume of
 * an in-flight job is M2 (FR-AUTH-5); for now clearing the session + routing to
 * Sign-in is the honest "don't fail silently" behavior. The keychain token is
 * cleared lazily by `current_session()` on the next launch/validation.
 */
export function handleSessionExpired(): void {
  session = null;
}

/**
 * Sign out. Best-effort server invalidation + keychain clear on the Rust side,
 * then drop the cached session regardless.
 */
export async function signOut(): Promise<void> {
  if (isTauri()) {
    try {
      await tauriLogout();
    } catch {
      // Even if the network logout fails, the token is cleared locally; fall
      // through and drop the session so the UI returns to Sign-in.
    }
  }
  session = null;
}

/**
 * Attempt sign-in. Returns a typed error on failure, or null on success.
 * Validates non-empty inputs client-side (distinct "empty" copy), then calls
 * the real Rust `login` command which performs the HTTPS token exchange and
 * stores the token in the keychain. The password is passed straight through to
 * Rust and never retained in JS.
 */
export async function signIn(
  email: string,
  password: string,
): Promise<SignInError | null> {
  if (email.trim() === "" || password === "") {
    return { kind: "empty", message: "Enter your email and password." };
  }

  if (!isTauri()) {
    // Browser preview: no native backend, so we can't reach the keychain or
    // perform a real exchange. Explain that the desktop app is required rather
    // than faking a session (consistent with M0/M1 browser-mode behavior).
    return {
      kind: "other",
      message: "Signing in requires the InterlinedList Offline desktop app.",
    };
  }

  try {
    session = await tauriLogin(email.trim(), password);
    return null;
  } catch (e) {
    // Rust rejects with "<kind>: <message>". Split back into a typed error.
    const raw = typeof e === "string" ? e : String(e);
    const idx = raw.indexOf(":");
    const kind = idx > 0 ? raw.slice(0, idx).trim() : "";
    const rest = idx > 0 ? raw.slice(idx + 1).trim() : raw;
    if (kind === "invalid") {
      return { kind: "invalid", message: "Incorrect email or password." };
    }
    if (kind === "unreachable") {
      return {
        kind: "unreachable",
        message:
          "Can't reach interlinedlist.com. Check your connection and try again.",
      };
    }
    return { kind: "other", message: rest || "Sign-in failed. Please try again." };
  }
}
