# offline-web — Requirements & Plan

**Status:** Confirmed decisions recorded (see §0). Blocking questions resolved. Awaiting human go-ahead to start M0.
**Author:** Project Management
**Date:** 2026-07-15
**Inputs:** `docs/ux-design.md` (UX Design, 2026-07-15)

---

## 0. Decisions Log (human-confirmed 2026-07-15)

| Q | Decision | Consequence |
|---|----------|-------------|
| Q13 Framework | **Tauri** (Rust core + native webview) | Small installers, native keychain; headless render is an opt-in/on-demand add-on. |
| Q2 Auth mechanism | **Username + password via interlinedlist.com API** (direct credential → token exchange) | App shows a native sign-in form, POSTs credentials over HTTPS to the auth API, stores only the returned token in the OS keychain. *Supersedes the earlier browser OAuth/PKCE choice — changed 2026-07-15 at human request; use the API the way it's intended.* |
| Q1 What login unlocks | **Pure access gate** — no entitlements/quotas/tiers | No usage-metering code. Logged in → all features; logged out → scraping disabled. |
| IL auth reality | **interlinedlist.com exposes a token-issuing auth API** | Direct integration. **NEEDS FROM HUMAN:** login endpoint URL + request/response JSON shape, token type & lifetime, refresh endpoint (if any), a token-verify/"me" endpoint, and whether login requires MFA/a secondary challenge. |
| Q6 robots.txt | **Respect by default; override behind Advanced** + one-time ack + manifest record | LG-ROBOTS-2 path (b). |
| Q9 Politeness defaults | **1 req/s, concurrency 2, caps 500 pages / 2 GB / 30 min, hard ceiling ~5 req/s** | Fixes FR-SCOPE-5, LG-RATE-1 numbers. |
| Q3 JS render | **Static default + smart 'needs JavaScript' detection → one-click re-scrape with rendering** | Confirms FR-RENDER path (a); headless is opt-in (M4). |
| Q5 Branding | **Tie to interlinedlist.com branding** — implemented now with InterlinedList-themed placeholders | Product name **"InterlinedList Offline"**; brand tokens (colors, wordmark, logo) centralized as CSS variables in `src/styles/brand.css` + `src/brand.ts` so official assets swap in without touching feature code. **STILL NEEDS FROM HUMAN:** official logo file, exact hex palette, and final product name to replace placeholders. |

**Deferrable questions — adopting recommended defaults unless the human overrides:**
- **Q4 Output format:** browsable file tree for v1; single-file archive (WARC/ZIP) deferred.
- **Q12 Re-scrape semantics:** new dated capture (non-destructive) with an explicit "overwrite" option.
- **Q7 Authenticated-target scraping:** out of scope for v1.
- **Q8 Concurrency:** one job at a time for v1.
- **Q10 Updates:** built-in auto-update (Tauri updater) with a non-blocking banner.
- **Q11 Telemetry:** opt-in crash reports only; never includes scraped content/URLs; consent at first-run.

**Two open info items needed from the human before/at M0 (not blocking scaffolding):**
1. interlinedlist.com auth API details — login endpoint URL, request/response JSON shape, token type & lifetime, refresh endpoint (if any), a token-verify/"me" endpoint, and whether login requires MFA/a secondary challenge.
2. Final product name, logo, and colors (interlinedlist-tied).

---

## 1. Summary

**offline-web** is a free, cross-platform (macOS / Linux / Windows) desktop application that mirrors a single web page or an entire website to a local folder for offline reading. Use is gated behind a login to `https://interlinedlist.com` — the app is free, has no subscription, and simply requires an authenticated account to unlock scraping. The output is an honest **static mirror**: assets are captured and links rewritten so the result opens offline in the user's browser, with clear disclosure that dynamic features won't work. The guiding constraints are **safe, polite defaults** (single-page, robots-respecting, rate-limited, same-domain out of the box), **power behind an Advanced surface**, **legible long-running jobs** (progress/pause/stop/resume), **honest auth** (never trap the user, never silently discard work on session expiry), and a **native desktop feel**. This document derives testable requirements, non-functional and legal guardrails, an incremental milestone roadmap (M0 walking skeleton → v1), and per-agent work briefs from the UX concept.

---

## 2. Functional Requirements

Testable, RFC-2119 keywords (MUST / SHOULD / MAY). IDs are stable references for tasks and acceptance criteria.

### 2.1 Authentication gate

| ID | Req |
|----|-----|
| FR-AUTH-1 | The app MUST require a valid `interlinedlist.com` session before any scraping action can start. Scraping controls MUST be disabled or intercepted when signed out. |
| FR-AUTH-2 | The app MUST authenticate by collecting the user's interlinedlist.com username (or email) and password in a native sign-in form and exchanging them, over HTTPS with certificate validation, against interlinedlist.com's auth API for a session token. The plaintext password MUST be held only in memory for the duration of the exchange, MUST NOT be persisted/logged/written to config, and SHOULD be cleared from memory immediately after the token is obtained. |
| FR-AUTH-2b | The sign-in form MUST provide a **Forgot password? / account help** link that opens interlinedlist.com in the system browser (the app does not handle password reset), and SHOULD offer a show/hide-password toggle. If the auth API returns an MFA/secondary-challenge response, the form MUST present the follow-up step (e.g. a one-time-code field) before a token is issued. |
| FR-AUTH-3 | On successful sign-in the app MUST persist the returned session token (and refresh token, if any) in the OS keychain/credential store (see NFR-SEC-1). It MUST NOT write the token or the password to a plaintext file, log, or config. |
| FR-AUTH-4 | Sign-out MUST always be reachable (Settings → Account) and MUST clear the stored credential. |
| FR-AUTH-5 | On session expiry the app MUST NOT fail silently. Any running job MUST auto-pause (not fail), and the user MUST be shown a session-expired banner with a **Sign in** action that resumes the exact paused job. |
| FR-AUTH-6 | Configured-but-not-yet-started work MUST be preserved if a session expires at Start; after re-auth the user MUST be able to start it without re-entering configuration. |
| FR-AUTH-7 | The app MUST distinguish "authenticated but not entitled to scrape" from "not signed in" and show distinct copy/paths for each (depends on Q1). |
| FR-AUTH-8 | Browsing existing local results (Results screen, Open in browser, Show in file manager) MUST NOT require an active session. Re-scrape MAY require one. |
| FR-AUTH-9 | The app SHOULD validate a stored session on launch (splash check, via the token-verify/"me" endpoint or token expiry) and route to Library if valid, Sign-in if not. It SHOULD tolerate being offline at launch by offering read-only access to existing mirrors (see FR-OFF-2). |
| FR-AUTH-10 | If interlinedlist.com issues a refresh token, the app SHOULD refresh the session silently before/upon expiry and store the refreshed token in the keychain. If no refresh mechanism exists, on expiry the app MUST re-prompt for the password via the FR-AUTH-5 auto-pause + re-auth flow rather than failing the job. |

### 2.2 Scrape scope

| ID | Req |
|----|-----|
| FR-SCOPE-1 | The app MUST support **This page only** (seed page + its immediate render assets) and **Whole site** (follow in-scope links). This-page-only MUST be the default. |
| FR-SCOPE-2 | For whole-site jobs the app MUST expose a **depth** limit with plain-language presets (e.g. "Just this section" / "A few levels" / "Everything"). A finite default depth (e.g. 2) MUST apply; "Everything" MUST be an explicit choice. |
| FR-SCOPE-3 | The app MUST enforce a **domain boundary**. Default MUST be same-domain only. It SHOULD offer include-subdomains and specific-allowed-domains; any-domain MAY be offered and MUST be treated as a danger option (Q6). |
| FR-SCOPE-4 | The crawler MUST NOT follow links outside the configured scope; out-of-scope links MUST be recorded as skipped with reason "off-scope," not fetched. |
| FR-SCOPE-5 | The app MUST enforce safety ceilings — **max pages**, **max total size**, **max time** — with conservative defaults (Q9). Hitting a ceiling MUST pause and prompt, not silently truncate or silently continue. |
| FR-SCOPE-6 | The crawler MUST deduplicate URLs (normalize + visited-set) so a page is fetched at most once per job. |

### 2.3 Asset capture & link rewriting (offline fidelity)

| ID | Req |
|----|-----|
| FR-ASSET-1 | The app MUST capture the assets required to render captured pages offline: images, CSS, fonts, and JS, on by default. |
| FR-ASSET-2 | The app MUST rewrite in-page links and asset references so a captured page opens correctly from the local filesystem (`file://`) with no network. Links to captured pages MUST resolve locally; links to uncaptured/out-of-scope targets MUST remain as absolute original URLs (not broken relative paths). |
| FR-ASSET-3 | The app MUST resolve and rewrite assets referenced in HTML attributes and in CSS (`url()`, `@import`), including `srcset`. It SHOULD handle common inline styles. |
| FR-ASSET-4 | The app MUST produce a stable, browsable directory layout with an entry point (`index.html`) openable from Results. |
| FR-ASSET-5 | The app SHOULD support per-type asset include/exclude, a max-asset-size cap, and an external-asset toggle in Advanced. |
| FR-ASSET-6 | The app MUST record per-asset outcome (captured / skipped / failed) for the capture report (FR-REPORT-2). |
| FR-ASSET-7 | Output format for v1 MUST be a browsable file tree; single-file archive (WARC/ZIP/single-HTML) is deferred (Q4) and MAY be added later. |

### 2.4 Static vs. headless-render modes

| ID | Req |
|----|-----|
| FR-RENDER-1 | The app MUST support **Static fetch** (HTTP GET + parse). Static MUST be the default (Q3). |
| FR-RENDER-2 | The app SHOULD support **Render JavaScript** (headless browser) as an opt-in mode for JS-dependent pages. |
| FR-RENDER-3 | The app SHOULD heuristically detect a near-empty static capture ("needs JavaScript") and flag it in results with a one-click **Re-scrape with JavaScript rendering**. |
| FR-RENDER-4 | If headless rendering is not shipped in a given milestone, the JS-only detection MUST still surface as an informational skip reason (no silent empty pages). |

### 2.5 Progress / pause / stop / resume

| ID | Req |
|----|-----|
| FR-PROG-1 | On Start the app MUST route to a live Job Progress view showing status (Running/Paused/Finishing), current URL, pages done/discovered, queue depth, throughput (pages/s, MB), and a labeled ETA estimate where estimable. |
| FR-PROG-2 | The app MUST provide **Pause** (safe, resumable), **Stop** (finalize captured, keep partial results), and a live **Rate** adjust that does not restart the job. |
| FR-PROG-3 | Paused jobs MUST be resumable to the exact remaining queue without re-fetching completed pages. Job state MUST be persisted to disk so resume survives app restart and crash (see NFR-RESUME-1). |
| FR-PROG-4 | The app MUST surface a filterable errors/skips panel grouping failures by reason (404, robots-blocked, timeout, too-large, JS-only, off-scope) with counts and timestamps. |
| FR-PROG-5 | Jobs MUST continue when the window is minimized, and the app MUST fire a native notification on completion, on repeated errors crossing a threshold, and on session expiry (see FR-XPLAT-4). |
| FR-PROG-6 | On live rate-limit/block (HTTP 429/403) the crawler MUST auto-back-off and inform the user gently; persistent limiting SHOULD suggest lowering rate or stopping. |
| FR-PROG-7 | On disk-full the job MUST pause with a clear error and preserve partial results; the user MUST be offered free-space / change-folder guidance. |
| FR-PROG-8 | Whether multiple jobs may run concurrently or one-at-a-time depends on Q8; the chosen model MUST be enforced consistently across Library and Progress. |

### 2.6 Results browsing & capture report

| ID | Req |
|----|-----|
| FR-RES-1 | The Results screen MUST show site name, capture date, total pages, total size, output path, and a persistent fidelity banner ("Static snapshot — interactive features may not work offline"). |
| FR-RES-2 | Results MUST provide **Open in browser** (opens local `index.html` in the OS default browser via `file://`), **Show in file manager** (native reveal), **Re-scrape** (reuses settings), and **Delete**. |
| FR-RES-3 | Results MUST present a captured tree/list with per-item status (captured / partial / skipped) where each captured item opens locally. |
| FR-REPORT-1 | The app MUST generate a capture report: captured (pages, assets, size) vs. skipped, with skips grouped by reason and explained in plain language. |
| FR-REPORT-2 | The report MUST list fidelity notes (what likely won't work: server search, login areas, live/streamed content, some interactive JS). |
| FR-REPORT-3 | Where a skip has a remedy, the report SHOULD offer the fix inline (Re-scrape with rendering / increase depth / allow subdomains). |
| FR-RES-4 | If local files were moved/deleted outside the app, Results MUST show "files not found at <path>" with **Locate folder…** / **Re-scrape**, not a crash. |
| FR-RES-5 | Partial jobs MUST be badged **Partial**, leading with what's missing and a Resume/Re-scrape path. A zero-capture job MUST show a diagnosis and the single most likely fix as a button. |

### 2.7 Output location, settings & defaults

| ID | Req |
|----|-----|
| FR-OUT-1 | Each job MUST have an output folder with a sensible platform default (e.g. `~/offline-web/<site>/`, `%USERPROFILE%\offline-web\<site>` on Windows), changeable via the **native** folder picker. |
| FR-OUT-2 | The app MUST validate output-folder writability and available space before Start and block Start with an inline error if unwritable. |
| FR-OUT-3 | Re-scrape semantics (overwrite in place / version / new dated capture) depend on Q12 and MUST be applied consistently and communicated in Results/Storage copy. |
| FR-SET-1 | Settings MUST expose Account (identity, sign out, "what login unlocks"), Defaults (scope/depth/assets/rendering/save location), Storage (mirrors folder, disk usage, clean-up/relocate), and Network (global rate cap, robots policy, user-agent). |
| FR-SET-2 | Default scrape configuration MUST be the safe set: page-only, respect robots, conservative rate/concurrency, same-domain, static fetch. Changes in Defaults MUST pre-populate New Scrape. |
| FR-SET-3 | The app MUST show a conditional **pre-flight confirm** only when a job trips a threshold (whole-site+deep, robots-ignore, cross-domain, or an estimate over configured page/size limits). Small/safe jobs MUST go straight to Progress. |

---

## 3. Non-Functional Requirements

| ID | Req |
|----|-----|
| NFR-XPLAT-1 | The app MUST ship signed, installable packages for macOS, Windows, and Linux from a single codebase. Reveal/menu/shortcut/notification behavior MUST follow each platform's conventions (native menu bar, native file pickers, "Show in Finder/Explorer/Files"). |
| NFR-SEC-1 | Secrets (session token/credential) MUST be stored only in the OS keychain (macOS Keychain / Windows Credential Manager / Linux Secret Service). No plaintext credential in files, logs, or telemetry. |
| NFR-SEC-2 | The user's password MUST be sent only to interlinedlist.com's auth endpoint, only over HTTPS with certificate validation, and MUST NOT appear in logs, crash reports, telemetry, or any on-disk state. The app holds the password in memory only until the token exchange completes, then clears it; only the resulting token is persisted (keychain, per NFR-SEC-1). |
| NFR-PERF-1 | Politeness is a performance ceiling, not a floor: default request rate and concurrency MUST be conservative (Q9), with per-host limits. The crawler MUST stream large responses to disk rather than buffering whole sites in memory. |
| NFR-PERF-2 | The UI MUST remain responsive during multi-hour jobs; scraping MUST run off the UI thread/process and report progress incrementally. |
| NFR-RESUME-1 | Job state (queue, visited set, config, partial manifest) MUST be persisted incrementally so a job survives app quit, crash, network loss, and session expiry, and can resume without re-fetching completed work. |
| NFR-A11Y-1 | The app SHOULD meet baseline accessibility: full keyboard navigation, visible focus, screen-reader labels on controls, sufficient contrast, and platform-correct shortcuts. |
| NFR-SIZE-1 | Installed binary size SHOULD be minimized. The static-fetch core SHOULD be small; a bundled headless browser is the dominant size risk and SHOULD be optional/downloaded-on-demand rather than always bundled (see Risk R2 and Q3). |
| NFR-OFF-1 | Offline behavior MUST be graceful: an offline banner, disabled Start with tooltip, read-only Library, and auto-pause/auto-resume of running jobs. |
| NFR-OFF-2 | Existing local mirrors MUST be fully browsable and openable while the app is offline and/or signed out (results are local artifacts). |
| NFR-OBS-1 | The app SHOULD keep a per-job log (URLs, outcomes, timings) written to the job folder for support/debugging, excluding secrets. |

---

## 4. Legal / Ethical Guardrails (as build requirements)

These are requirements to build, not disclaimers to display.

| ID | Req |
|----|-----|
| LG-ROBOTS-1 | The crawler MUST fetch and honor `robots.txt` by default: disallowed paths MUST be skipped and recorded as "robots-blocked" in the report. `Crawl-delay` SHOULD be respected when present. |
| LG-ROBOTS-2 | Whether robots.txt may be overridden at all in a free, widely distributed app is Q6. If override is permitted, it MUST live behind Advanced with a one-line caution and SHOULD require an explicit acknowledgment; the override state MUST be recorded in the job manifest. |
| LG-RATE-1 | The crawler MUST enforce a rate limit and concurrency cap per host with conservative defaults (Q9). The rate UI MUST mark a "polite" zone and warn beyond it. A hard global ceiling MUST prevent abusive rates even in Advanced. |
| LG-RATE-2 | The crawler MUST send a truthful, identifiable User-Agent (configurable in Settings→Network) and MUST NOT spoof to evade blocks. On 429/403 it MUST back off (LG-RATE / FR-PROG-6). |
| LG-CAPS-1 | Every job MUST have enforced size, page-count, and time caps (FR-SCOPE-5). Defaults MUST be finite; unlimited MUST be an explicit, warned choice. |
| LG-TOS-1 | The app MUST show a one-time, non-blocking first-run acknowledgment covering the user's responsibility for site terms, copyright, and personal data ("mirror only content you're allowed to"), with a persistent link in Settings/About. It MUST NOT re-prompt per scrape. |
| LG-TOS-2 | When the user opts into risk (ignore robots, any-domain, unlimited caps), the pre-flight MUST restate responsibility in one targeted line — not a blanket nag. |
| LG-PII-1 | The app MUST NOT transmit scraped content off-device (no cloud upload of mirrors). Scraped data stays local. If telemetry ships (Q11), it MUST exclude scraped content and target URLs by default. |
| LG-ACCEPT-1 | The default configuration (page-only, respect robots, polite rate, same-domain, finite caps) MUST embody an acceptable-use posture such that a user who never opens Advanced cannot produce an abusive crawl. |
| LG-AUTHSITE-1 | Mirroring target sites behind the *user's own* login (session reuse) is Q7 and is **out of scope for v1** unless the human decides otherwise; if added later it MUST carry its own legal review and explicit consent. |

---

## 5. Assumptions & Risks

**Assumptions**
- A1. interlinedlist.com exposes a usable auth flow (a login page and a way for the app to obtain and verify a session/token). *Unverified — the auth contract is the single biggest unknown.*
- A2. The app is distributed free; there is no billing/subscription code path.
- A3. Scraped mirrors are single-user, local-only artifacts; no server-side component beyond auth.
- A4. Targets are ordinary public websites; authenticated-target scraping is deferred (Q7).

**Risks** (top first)

| ID | Risk | Impact | Mitigation |
|----|------|--------|------------|
| R1 (TOP) | **Auth API contract with interlinedlist.com must be pinned down.** The login endpoint URL, request/response shape, token type & lifetime, refresh mechanism, token-verify endpoint, and whether MFA is required are all needed. This blocks the login gate — the app's core precondition. | Cannot build M0 login gate; risk of coding to the wrong request/response shape. | Get the auth API spec from the interlinedlist.com owner before M0. Keep auth behind a swappable `AuthProvider` so the exact shape plugs in; ship a mock provider to unblock scaffolding. Design job persistence so expiry mid-job is a pause, not a loss (FR-AUTH-5). |
| R2 | **Headless rendering complexity & binary size.** A bundled headless browser (Chromium) can add 100–300 MB, complicates packaging/signing per platform, and adds a large maintenance/security surface. | Bloated download contradicts NFR-SIZE-1; slower, riskier releases. | Ship static-fetch first; make headless opt-in and, if possible, download-on-demand or reuse a system browser rather than always-bundle. Decide via Q3. |
| R3 | Framework choice (Tauri vs Electron) affects size, security, native feel, and effort. | Rework if chosen late. | Decide Q13 before M0; recommendation in §8. |
| R4 | Offline fidelity is inherently imperfect (JS apps, server search, streaming). | User disappointment / trust. | Honest fidelity banner + capture report (FR-RES-1, FR-REPORT-2) already required. |
| R5 | Legal exposure from misuse (aggressive crawling, copyright). | Reputation/liability for a free, widely distributed app. | Safe-by-default guardrails (§4), finite caps, robots respect, truthful UA, no cloud exfiltration. |
| R6 | Resume correctness across crash/expiry is hard (partial writes, dedupe integrity). | Corrupt mirrors / re-fetch storms. | Incremental, atomic persistence of job state and manifest (NFR-RESUME-1); write-then-rename for files. |
| R7 | **App collects the user's interlinedlist.com password directly** (consequence of the API-login decision). Users must trust a downloadable app with their credentials; it also raises phishing-lookalike risk and removes provider-side login protections (MFA prompts, device checks) unless the API surfaces them. | Trust/security concern; weaker isolation than a delegated/hosted login page. | Password in memory only, HTTPS-only to the auth endpoint, never logged/persisted (NFR-SEC-2, FR-AUTH-2); clear interlinedlist branding on the form; no other network destination for credentials; handle any API MFA/challenge step (FR-AUTH-2b); document the security posture (D-2). |

---

## 6. Milestones

Incremental vertical slices. Each milestone is shippable/demoable. Owners: **E**=engineer, **U**=ux-designer, **D**=documentation, **PM**=project management.

| M | Goal | Key deliverables | Owners |
|---|------|------------------|--------|
| **M0 — Walking skeleton** | Prove the spine end to end: launch → login gate → scrape one page → write to disk → open it. | App shell in chosen framework (Q13); splash/session check; login gate to interlinedlist.com (mechanism per Q2) with keychain storage; single-page static fetch + asset capture + link rewrite; write browsable folder; Results "Open in browser". *(Depends on BLOCKING Q1, Q2, Q13.)* | E (impl), U (skeleton screens B/C/D/G), PM (unblock auth) |
| **M1 — Whole-site crawl + scope/limits** | Turn one page into a polite bounded crawl. | Link discovery, depth + domain-boundary enforcement, dedupe, safety caps (pages/size/time), robots.txt respect, rate limiting + concurrency, per-host backoff. | E (impl), U (Advanced drawer D1, pre-flight D2), D (guardrails doc) |
| **M2 — Long-job UX: progress/pause/stop/resume** | Make long jobs legible and safe. | Live Progress (F) with counts/throughput/ETA; Pause/Stop/live-Rate; errors panel (F1); persisted job state + crash/quit/network/expiry resume; native completion notification. | E (impl), U (F/F1 states), PM (resume acceptance) |
| **M3 — Results & capture report** | Trustworthy, actionable results. | Capture report (G1) captured-vs-skipped grouped by reason, fidelity notes, inline fixes; captured tree; Re-scrape/Delete; "files not found" recovery; partial/zero-capture states. | E (impl), U (G/G1), D (fidelity/limits copy) |
| **M4 — Headless render (opt-in)** | Handle JS-only pages without bloating the default. | Opt-in JS rendering (bundled or on-demand per Q3); JS-only detection heuristic; one-click re-scrape-with-rendering from results. | E (impl), U (render toggle + detection copy), PM (size decision) |
| **M5 — Settings, polish, cross-platform hardening** | Ship-quality v1. | Settings tabs (Account/Defaults/Storage/Network); global banners (offline/session/update); native menus/shortcuts/notifications per platform; first-run ToS acknowledgment; storage clean-up/relocate; accessibility pass; signed installers for all three OSes; update mechanism (Q10). | E (impl+packaging), U (Settings H, banners, a11y), D (user guide, ToS/acceptable-use, release notes) |

**v1 = M0–M5.** Deferred beyond v1: single-file archive output (Q4), authenticated-target scraping (Q7), account quotas/usage meter if entitlements exist (Q1).

---

## 7. Work Allocation (task briefs)

Format: **Title · Owner · Inputs · Deliverable · Acceptance criteria · Dependencies.**

### Engineer

**E-1 · App shell + login gate + keychain (M0)**
- **Owner:** engineer
- **Inputs:** Tauri (Q13); API username/password auth (Q1/Q2, §0); auth API spec (R1); ux §2.1, §3 B/C.
- **Deliverable:** Runnable Tauri app: splash → session check → **native username/password sign-in form** → POST to interlinedlist.com auth API → token in OS keychain → Library. Auth sits behind a swappable `AuthProvider` (real API client + mock provider for scaffolding).
- **Acceptance:** FR-AUTH-1..6, FR-AUTH-2b, FR-AUTH-9, FR-AUTH-10, NFR-SEC-1/2 pass; password never written to disk/logs (verified); signed-out cannot scrape; expiry auto-pauses (stubbed job) rather than failing.
- **Dependencies:** BLOCKING Q13; auth API spec (R1) — mock provider unblocks scaffolding until it lands.

**E-2 · Single-page capture engine (M0)**
- **Owner:** engineer
- **Inputs:** ux §2.2, §2.4; FR-ASSET-*, FR-RENDER-1.
- **Deliverable:** Static fetch of one URL, capture images/CSS/fonts/JS, rewrite links/refs, write browsable `index.html` tree; open via OS default browser.
- **Acceptance:** FR-ASSET-1..4/6, FR-OUT-1/2, FR-RES-2 (open in browser) pass on 3 representative sites; captured page renders offline with no network.
- **Dependencies:** E-1 shell.

**E-3 · Crawler: scope, depth, domain, dedupe, caps (M1)**
- **Owner:** engineer
- **Inputs:** FR-SCOPE-*, LG-CAPS-1; ux §2.2, D1.
- **Deliverable:** Bounded whole-site crawl with depth/domain/scope enforcement, URL dedupe, and enforced page/size/time caps.
- **Acceptance:** FR-SCOPE-1..6 pass; out-of-scope links recorded not fetched; ceilings pause+prompt.
- **Dependencies:** E-2.

**E-4 · Politeness: robots.txt, rate limit, backoff, UA (M1)**
- **Owner:** engineer
- **Inputs:** LG-ROBOTS-*, LG-RATE-*, FR-PROG-6; Q6, Q9.
- **Deliverable:** robots fetch+honor (default), per-host rate/concurrency limiter, 429/403 backoff, truthful configurable UA, hard global rate ceiling.
- **Acceptance:** LG-ROBOTS-1, LG-RATE-1/2, LG-ACCEPT-1 pass; robots-blocked recorded as skips; defaults produce a non-abusive crawl.
- **Dependencies:** E-3; Q9 numbers, Q6 policy.

**E-5 · Progress, controls, resume, persistence (M2)**
- **Owner:** engineer
- **Inputs:** FR-PROG-*, NFR-RESUME-1, NFR-PERF-2; ux §2.3 F/F1.
- **Deliverable:** Off-thread engine reporting live progress; Pause/Stop/live-Rate; grouped errors panel; incrementally persisted job state resumable after crash/quit/offline/expiry; completion notification.
- **Acceptance:** FR-PROG-1..7, NFR-RESUME-1 pass; kill app mid-job → relaunch → resume with no re-fetch of completed pages.
- **Dependencies:** E-3, E-4.

**E-6 · Results + capture report + recovery (M3)**
- **Owner:** engineer
- **Inputs:** FR-RES-*, FR-REPORT-*; ux §2.4 G/G1.
- **Deliverable:** Results screen, capture report (captured/skipped grouped, fidelity notes, inline fixes), captured tree, Re-scrape/Delete, files-not-found and partial/zero states.
- **Acceptance:** FR-RES-1..5, FR-REPORT-1..3 pass.
- **Dependencies:** E-5; Q12 re-scrape semantics.

**E-7 · Headless rendering, opt-in (M4)**
- **Owner:** engineer
- **Inputs:** FR-RENDER-2/3/4, NFR-SIZE-1; Q3.
- **Deliverable:** Opt-in JS rendering (bundled/on-demand per Q3), JS-only detection, one-click re-scrape-with-rendering.
- **Acceptance:** FR-RENDER-2..4 pass; default download size honors NFR-SIZE-1.
- **Dependencies:** E-6; Q3 decision.

**E-8 · Settings, cross-platform packaging, update, a11y (M5)**
- **Owner:** engineer
- **Inputs:** FR-SET-*, NFR-XPLAT-1, NFR-A11Y-1, LG-TOS-1; Q10.
- **Deliverable:** Settings tabs; global banners; native menus/shortcuts/notifications; first-run ToS acknowledgment; storage clean-up/relocate; signed installers (mac/win/linux); update mechanism.
- **Acceptance:** FR-SET-1..3, NFR-XPLAT-1, NFR-A11Y-1, LG-TOS-1/2 pass; installers verified on all three OSes.
- **Dependencies:** E-6 (and E-7 if rendering ships in v1); Q10.

### UX Designer

**U-1 · M0 skeleton screens (B/C/D/G) + auth-flow finalization**
- **Owner:** ux-designer
- **Inputs:** own ux-design.md; resolved Q2, Q5.
- **Deliverable:** Tightened specs/wireframes for Sign-in (B), Library (C), minimal New Scrape (D), Results (G), including exact auth-flow and error copy.
- **Acceptance:** Screens cover loading/empty/error/offline/not-logged-in states; copy final for M0; hands E-1/E-2 unambiguous layouts.
- **Dependencies:** Q2, Q5.

**U-2 · Advanced drawer (D1) + pre-flight (D2) + guardrail UX**
- **Owner:** ux-designer
- **Inputs:** §4 guardrails; Q6, Q9.
- **Deliverable:** Final D1 controls, D2 threshold logic and copy, "polite zone" rate UI, anti-nag rules.
- **Acceptance:** Matches FR-SET-3, LG-* thresholds; each caution shown at most once.
- **Dependencies:** Q6, Q9.

**U-3 · Progress/errors (F/F1) + Results/report (G1) state design**
- **Owner:** ux-designer
- **Inputs:** FR-PROG-*, FR-REPORT-*.
- **Deliverable:** Full state specs for F, F1, G1 including partial/zero/offline/expiry.
- **Acceptance:** Every state in ux §4 specified; grouped-error and fidelity-note copy final.
- **Dependencies:** U-1.

**U-4 · Settings (H), banners, cross-platform + accessibility spec**
- **Owner:** ux-designer
- **Inputs:** FR-SET-*, NFR-XPLAT-1, NFR-A11Y-1; Q10.
- **Deliverable:** Settings tabs, global banner behavior, per-platform menu/shortcut/reveal specs, a11y checklist.
- **Acceptance:** Meets NFR-XPLAT-1, NFR-A11Y-1; platform copy adapts (Finder/Explorer/Files).
- **Dependencies:** Q10.

### Documentation

**D-1 · User guide (getting started → first mirror)**
- **Owner:** documentation
- **Inputs:** shipped M0–M3 behavior.
- **Deliverable:** Install, sign-in, first scrape, understanding results & fidelity.
- **Acceptance:** A new user can reach a first mirror using only the guide.
- **Dependencies:** M3.

**D-2 · Acceptable-use, legal & guardrails doc + first-run ToS copy**
- **Owner:** documentation
- **Inputs:** §4; Q6, Q11.
- **Deliverable:** Acceptable-use policy, robots/rate/caps explanation, ToS acknowledgment text, copyright/PII posture.
- **Acceptance:** Satisfies LG-TOS-1/2; reviewed for a free widely-distributed app.
- **Dependencies:** Q6, Q11.

**D-3 · Settings reference, troubleshooting, release notes (v1)**
- **Owner:** documentation
- **Inputs:** M5 build.
- **Deliverable:** Settings reference, sign-in/network/disk troubleshooting, v1 release notes.
- **Acceptance:** Covers all Settings tabs and common failure paths from ux §2.5.
- **Dependencies:** M5.

---

## 8. Open Questions for the Human

Answer BLOCKING items before M0 starts. Grouped for efficient decisions.

### Group A — Auth & tech stack (mostly BLOCKING for M0)

**Q1. What does interlinedlist.com login unlock?** *(BLOCKING)*
Options: (a) pure access gate, no entitlements; (b) gate + account entitlements/quotas (max pages/sites/concurrent jobs); (c) tiered accounts.
**Recommendation:** (a) for v1 — simplest, matches "free, no subscription." Add a usage meter only if (b) is real.

**Q2. Auth mechanism?** *(BLOCKING)*
Options: (a) embedded sandboxed web view; (b) system browser + deep-link callback (PKCE-style); (c) both, with paste-code fallback.
**Recommendation:** (b) system browser + deep-link if interlinedlist.com supports an OAuth/PKCE-style flow (best security, no credential handling); fall back to (a) embedded only if it doesn't. **Requires confirming interlinedlist.com's actual auth capabilities — please supply.**

**Q13. Framework: Tauri vs Electron?** *(BLOCKING)*
Options: (a) **Tauri** (Rust core + system webview) — much smaller binaries, strong security, good keychain/native integration; (b) **Electron** (bundled Chromium) — larger, but headless rendering is "already there" and web-dev familiarity is high.
**Recommendation:** **Tauri**, for NFR-SIZE-1 and NFR-SEC-*; treat headless rendering as an opt-in/on-demand component (ties to Q3). Choose Electron only if the team strongly prefers it and accepts the size cost.

### Group B — Scraping behavior & defaults (needed for M1; some BLOCKING there)

**Q3. Headless-render default?** *(blocking for M4; decide direction early)*
Options: (a) always opt-in, static default + smart detection prompt; (b) auto-render when static looks empty; (c) default render.
**Recommendation:** (a) — matches politeness/size goals; smart detection gives one-click upgrade.

**Q6. Allow ignoring robots.txt at all?** *(BLOCKING for M1)*
Options: (a) never allow (respect always); (b) allow behind Advanced + one-time acknowledgment; (c) allow freely.
**Recommendation:** (b) — override behind Advanced with acknowledgment and manifest record. Reconsider (a) given the free/wide-distribution liability (R5).

**Q9. Polite default rate + safety ceilings?** *(BLOCKING for M1)*
Options: propose defaults — e.g. 1–2 req/s, concurrency 2–4, max 500 pages / 2 GB / 30 min.
**Recommendation:** Default 1 req/s, concurrency 2, caps 500 pages / 2 GB / 30 min; hard global ceiling ~5 req/s. Confirm numbers.

**Q8. Concurrent jobs or one-at-a-time?** *(needed for M2)*
Options: (a) one at a time; (b) N concurrent with a shared global rate budget.
**Recommendation:** (a) for v1 — simpler resource/rate story; revisit later.

### Group C — Output, storage & product (needed by M3/M5; deferrable for M0)

**Q4. Output format — file tree only, or add single-file archive?** Recommend file tree for v1; defer archive (WARC/ZIP). *(deferrable)*
**Q12. Re-scrape semantics — overwrite / version / new dated capture?** Recommend new dated capture (safe, non-destructive) with an "overwrite" option. *(needed for M3)*
**Q7. Scrape authenticated target sites (user's own login)?** Recommend **out for v1** (legal surface, R5/LG-AUTHSITE-1). *(deferrable)*

### Group D — Platform, trust & release (needed by M5; deferrable for M0)

**Q5. Branding** — app name shown to users ("offline-web"?), logo, color, interlinedlist.com tie on sign-in. Recommend confirm name/logo before U-1. *(needed for U-1)*
**Q10. Update mechanism** — Options: (a) built-in auto-update (e.g. framework updater); (b) manual download; (c) store distribution. Recommend (a) with a non-blocking update banner. *(needed for M5)*
**Q11. Telemetry / crash reporting?** Options: (a) none; (b) opt-in crash reports only; (c) opt-in usage analytics. Recommend (b), consent surfaced with first-run ToS, never including scraped content/URLs (LG-PII-1). *(needed for M5)*

**BLOCKING for M0:** Q1, Q2, Q13. **BLOCKING for M1:** Q6, Q9 (and Q3 direction). Everything else is deferrable but should land before its milestone.
