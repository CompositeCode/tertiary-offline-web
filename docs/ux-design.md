# offline-web — Initial UX Design Concept

**Status:** First-pass concept for PM to derive requirements. Not a spec. Not code.
**Author:** UX Design
**Date:** 2026-07-15

## 0. Product summary

**offline-web** is a free, cross-platform (macOS / Linux / Windows) desktop app that
mirrors a single web page or an entire website to a local folder for offline reading.

- **Free** to download and use. **No subscription.**
- **Login-gated**: the app requires the user to be signed in to
  `https://interlinedlist.com`. Core scraping is unavailable while signed out.
- The output is a **static mirror**. This is stated plainly and repeatedly:
  *"Static snapshot — some dynamic features (logins, live feeds, search boxes)
  won't work offline."*

### Design principles (the north star for every decision below)

1. **Safe, polite defaults.** Out of the box: single-page or shallow depth,
   respect `robots.txt`, conservative rate limit, same-domain only. A first-time
   user can get a good result without touching Advanced.
2. **Power behind Advanced.** Depth, cross-domain scope, ignoring robots, higher
   rates, and headless rendering all exist — but are tucked behind a clearly
   labeled **Advanced** affordance so they never clutter the happy path.
3. **Legible long-running jobs.** A scrape can run for minutes or hours. Progress
   must always answer: *What is it doing right now? How much is left? What's
   failing? Can I stop it safely?*
4. **Honest auth.** We never trap the user. Login is a simple username/password
   sign-in to the user's interlinedlist.com account (submitted to the site's auth API),
   sign-out is always reachable, and an expired session pauses work and asks — it never
   fails silently or discards a job.
5. **Native desktop feel.** Native menus, native file pickers, native
   notifications, platform-appropriate shortcuts and window chrome.
6. **Trustworthy results.** The app is explicit about what was captured vs.
   skipped, and about fidelity limits, so users trust what they got.

---

## 1. Information architecture

### 1.1 Screen map

```
offline-web
│
├─ A. Splash / Launch check ............ transient; checks session, routes onward
│
├─ B. Sign-in .......................... login-required gate (username/password → interlinedlist.com API)
│    └─ B1. Sign-in help / trouble ..... "can't sign in" recovery panel
│
├─ C. Home / Library (default screen) .. list of past & current jobs; primary hub
│    ├─ empty state → "New scrape" CTA
│    └─ per-job row → opens F (Job Detail) or G (Results)
│
├─ D. New Scrape — Setup ............... the configuration screen (Simple + Advanced)
│    └─ D1. Advanced drawer ............ depth, scope, robots, rate, rendering, assets
│    └─ D2. Pre-flight confirm sheet ... shown only when a scrape looks large/risky
│
├─ E. (reserved) — Setup review ........ merged into D2 confirm sheet, not a separate screen
│
├─ F. Job Progress (running job) ....... live monitor: current URL, queue, throughput, errors, pause/stop
│    └─ F1. Errors panel / log ......... filterable list of skips & failures
│
├─ G. Results / Captured Site ......... browse what was captured; open locally; capture report
│    └─ G1. Capture report ............. captured vs. skipped, fidelity notes, "open folder"
│
├─ H. Settings ........................ account, default scrape prefs, storage, network, notifications
│    ├─ H1. Account ................... signed-in identity, sign out, "what login unlocks"
│    ├─ H2. Defaults .................. default depth/rate/scope/rendering/output location
│    ├─ H3. Storage .................. where mirrors live, disk usage, clear/relocate
│    └─ H4. Network & politeness ..... global rate cap, robots policy, user-agent
│
└─ Global: native menu bar, in-app banners (offline / session expired / update)
```

### 1.2 Navigation model

- **Left sidebar (persistent)** in the main window once signed in: `Library` (Home),
  `New Scrape`, `Settings`. This is the app's spine — always one click back to the hub.
- **Home / Library is the default landing** after sign-in. It's the hub; everything
  else is reached from here or the sidebar.
- **Job rows** in Library open **Job Progress (F)** if running, or **Results (G)** if
  finished. A running job and its results are the same object at different lifecycle
  stages, so the row is stable and just changes affordances.
- **New Scrape (D)** is reachable from the sidebar and from the Library empty-state CTA.
- **Settings (H)** is sidebar-level, not modal — users return to it often.
- **Back / breadcrumb**: Setup → Confirm → Progress → Results is a linear spine within
  a job; the sidebar always escapes it.
- **Global banners** (offline, session expired, update available) dock at the top of
  the content area regardless of screen, and are dismissible where non-blocking.

---

## 2. Core flows (step-by-step, with failure paths)

Notation: **→** happy path, **✗** failure/branch, **↺** recovery.

### 2.1 First run + login to interlinedlist.com

→ 1. App launches → **A. Splash** shows a brief branded check ("Starting…").
→ 2. No stored session found → route to **B. Sign-in**.
→ 3. Sign-in screen explains *why*: "offline-web is free but requires an
     interlinedlist.com account. Sign in to start mirroring pages."
→ 4. User enters their **interlinedlist.com username (or email) and password**
     directly in the app's sign-in form and clicks **Sign in**.
→ 5. The app POSTs those credentials over HTTPS to interlinedlist.com's auth API and
     receives a session token. The plaintext password is used only for this exchange
     and is never stored.
→ 6. On success → session token stored in OS keychain/credential store →
     route to **C. Library** (empty state on first run).
→ 7. First-run Library shows a one-time, dismissible **welcome card**:
     "Mirror your first page →" with a **New Scrape** button and a one-line
     fidelity note.

Failure paths:
- ✗ **Wrong credentials** → the API returns an auth failure → inline form error:
  "Incorrect username or password." App does nothing destructive; password field is
  cleared. ↺ user retries.
- ✗ **Can't reach the API / network down** → shows **B1. Sign-in trouble**: "Can't
  reach interlinedlist.com. Check your connection." with **Retry** and **Work offline
  (browse existing mirrors)** if any local results exist. ↺ Retry re-attempts; Offline
  routes to a read-only Library.
- ✗ **MFA / secondary verification required** → if the API responds with a challenge,
  the form presents the follow-up step (e.g. a one-time-code field) inline before a
  token is issued. *(Whether interlinedlist.com requires this is an Open Question — §7.)*
- ✗ **Account locked / rate-limited** (too many attempts) → surface the API's message
  ("Too many attempts — try again later") and briefly disable **Sign in**.
- ✗ **Account valid but login doesn't unlock scraping** (e.g., entitlement issue) →
  route to a clear message: "You're signed in, but your account can't start mirrors
  right now," with a link to interlinedlist.com and **Sign out**.
  *(Login is a pure access gate for v1 — see §0 of the plan.)*

### 2.2 Configure and start a scrape

→ 1. From Library or sidebar → **D. New Scrape — Setup**.
→ 2. **URL field** (only required input). User pastes/types a URL. App validates
     scheme + reachability lazily (a small inline "checking…" then a favicon/title
     preview when it resolves).
→ 3. **Scope toggle** (the single most important choice), presented as two clear cards:
     - **This page only** (default) — one page + its immediate assets.
     - **This whole site** — follows links within the same site.
→ 4. If **whole site** → a **Depth** control appears (default: shallow, e.g. 2 levels),
     with plain-language labels ("Just this section" / "A few levels" / "Everything —
     may be large").
→ 5. **Output folder** — shows a sensible default (e.g. `~/offline-web/<site-name>/`)
     with a **Change…** button → native folder picker.
→ 6. **Include assets** — a friendly default set (images, CSS, fonts, JS needed to
     render) is on; a compact summary reads "Images, styles, scripts." Fine-grained
     toggles live in Advanced.
→ 7. **Advanced (D1)** is collapsed by default. Expanding reveals:
     - **Domain scope**: same-domain (default) / include subdomains / specific
       allowed domains / (danger) any domain.
     - **Rate limit**: requests/sec + concurrency, default conservative; slider with
       a "Be polite" marked zone and a warning past it.
     - **robots.txt**: **Respect (default)** / Ignore (with an inline caution).
     - **Rendering**: **Static fetch (default, fast)** / **Render JavaScript
       (headless, slower)** — for JS-only pages. *(Default is an Open Question, §7.)*
     - **Asset detail**: per-type include/exclude, max file size, external assets.
     - **Limits**: max pages, max total size, max time — safety ceilings.
     - **Auth for the target site**: (future) reuse a logged-in session for the site
       being scraped — flagged as an Open Question.
→ 8. User clicks **Start**.
→ 9. **Pre-flight (D2)** appears *only if* the job trips a threshold — whole-site +
     deep, robots-ignore, cross-domain, or an estimate over N pages / N MB. It
     summarizes scope in one sentence, shows estimated size/pages if known, restates
     any risky choices ("Ignoring robots.txt", "No page limit"), and offers
     **Start anyway** / **Adjust settings**. For small/safe jobs, **Start** goes
     straight to Progress — no nag.
→ 10. Route to **F. Job Progress**.

Failure paths:
- ✗ **Invalid / unreachable URL** → inline field error, **Start** disabled until fixed.
- ✗ **Output folder not writable / no space** → inline error at the folder field with
  **Change…**; block Start.
- ✗ **Not signed in / session expired at Start** → intercept, show session-expired
  banner + **Sign in** (see §2.5); preserve the fully configured job so nothing is lost.
- ✗ **robots.txt disallows the target** (with Respect on) → non-blocking notice in
  pre-flight: "This site asks crawlers not to fetch some/all of these pages. We'll
  skip those." Offer **Continue (skip blocked)** or **Open Advanced** to change policy.

### 2.3 Watch progress on a long-running job

→ 1. **F. Job Progress** opens immediately on Start; header shows job name (site
     title/URL), a big **status** (Running / Paused / Finishing), and elapsed time.
→ 2. **Live readout**, always visible:
     - **Current URL** being fetched (truncated, hover/expand for full).
     - **Progress**: pages done / discovered; a determinate bar when a max is set,
       otherwise a "N of ~M discovered" indeterminate style.
     - **Queue depth**: URLs waiting.
     - **Throughput**: pages/sec and data downloaded (MB), plus a rough ETA when
       estimable (clearly labeled "estimate").
     - **Errors/skips counter** with a click-through to **F1**.
→ 3. **Controls**: **Pause** (safe, resumable), **Stop** (finalizes what's captured),
     and **Rate** quick-adjust (slow down / speed up) without stopping the job.
→ 4. **Errors panel (F1)** — a filterable, scrollable list: URL, reason
     (404, blocked by robots, timeout, too large, JS-only, off-scope), timestamp.
     Grouped by reason with counts so 500 timeouts read as one collapsible group.
→ 5. Job can run **minimized**; a native notification fires on completion, on repeated
     errors crossing a threshold, or on session expiry.
→ 6. On completion → status flips to **Done**, a summary appears inline, and a
     **View results** button routes to **G**.

Failure paths:
- ✗ **Session expires mid-job** → job **auto-pauses** (does not fail), banner: "Your
  interlinedlist.com session expired. Sign in to resume." **Sign in** → on success,
  **Resume** the exact job from where it paused.
- ✗ **Network drops** → job auto-pauses with an "Offline — waiting to reconnect"
  state; auto-resumes when back, or user can Stop and keep partial results.
- ✗ **Target site rate-limits/blocks us (429/403)** → app auto-backs-off, surfaces a
  gentle "Site is limiting us — slowing down" note; if persistent, suggests lowering
  rate or stopping.
- ✗ **Disk fills** → pause + clear error: "Ran out of space in <folder>." with
  **Free space / Change folder** guidance; partial results preserved.
- ✗ **Runaway/huge site** → when a soft ceiling (pages/size/time) is hit, pause and
  ask: "This is bigger than expected (X pages, Y GB). Keep going, or stop here?"

### 2.4 Browse and open results

→ 1. From Library (finished job) or Progress completion → **G. Results**.
→ 2. Header: site name, capture date, total pages, total size, and a one-line
     **fidelity banner**: "Static snapshot. Interactive features may not work offline."
→ 3. **Primary actions**: **Open in browser** (opens the local entry `index.html`
     via the OS default browser), **Show in Finder/Explorer/Files** (native reveal),
     **Re-scrape** (reuses this job's settings), **Delete**.
→ 4. **Captured tree/list**: pages captured, organized by path; each item shows
     status (captured / partial / skipped) and links to open locally.
→ 5. **Capture report (G1)**:
     - **Captured**: N pages, N assets, total size.
     - **Skipped** (grouped, expandable): robots-blocked, off-scope, over-limit,
       failed, JS-only/needs-render. Each group explains *why* in plain language and,
       where relevant, offers a fix ("Re-scrape with JavaScript rendering",
       "Increase depth", "Allow subdomains").
     - **Fidelity notes**: explicit list of what likely won't work (server search,
       login areas, live/streamed content, some interactive JS).

Failure paths:
- ✗ **Local files moved/deleted outside the app** → Results shows "Files not found at
  <path>" with **Locate folder…** or **Re-scrape**.
- ✗ **Partial job** (stopped early / errored) → Results clearly badges **Partial** and
  the report leads with what's missing and a **Resume/Re-scrape** path.
- ✗ **Nothing captured** (e.g. everything robots-blocked) → empty results with a
  diagnosis and the single most likely fix surfaced as a button.

### 2.5 Recover from errors (cross-cutting)

- **Login expired** → global banner + auto-pause of any running job; **Sign in**
  resumes exactly where it stopped. Never discard configured/in-progress work.
- **Offline** → global offline banner; New Scrape's Start is disabled with a tooltip;
  Library becomes read-only browse of existing mirrors; running jobs auto-pause and
  auto-resume.
- **robots-blocked** → framed as the site's request, not our failure. Default respects
  it and skips; the report explains what was skipped; Advanced allows override with a
  clear caution (and a note about the user's responsibility).
- **JS-only page** (near-empty static capture) → detected heuristically; Results flags
  "This page needs JavaScript to show content" and offers **Re-scrape with JavaScript
  rendering** in one click.
- **Huge site** → soft ceilings + a mid-job "bigger than expected" checkpoint; never a
  silent multi-GB surprise. Pre-flight warns up front when estimable.

---

## 3. Wireframe-level layouts (every control named)

### B. Sign-in
```
┌──────────────────────────────────────────────┐
│                 [ offline-web logo ]           │
│                                                │
│        Mirror the web for offline reading      │
│                                                │
│   offline-web is free, but requires an         │
│   interlinedlist.com account.                  │
│                                                │
│   Username or email                            │
│   [ ____________________________________ ]     │
│                                                │
│   Password                          [ 👁 show ]│
│   [ ____________________________________ ]     │
│   ↳ inline error appears here, e.g.            │
│     "Incorrect username or password."          │
│                                                │
│            [            Sign in            ]   │  ← primary button
│                                                │
│   [ Forgot password? ]      [ Trouble? → B1 ]  │
│                                                │
│   (footer) [ Quit ]        [ About ] [ Help ]  │
└──────────────────────────────────────────────┘
```
Controls: **Username/email** field, **Password** field, **Show/hide password** toggle,
**Sign in** (primary), **Forgot password?** (opens interlinedlist.com in the system
browser), **Trouble signing in?** (link → B1), **Quit**, **About**, **Help**. If the
API returns an MFA challenge, a **one-time-code** field appears inline before sign-in
completes.

### C. Home / Library
```
┌───────────┬──────────────────────────────────────────────┐
│ SIDEBAR   │  Library                     [ + New scrape ] │
│           │  ──────────────────────────────────────────── │
│ ▸ Library │  [ banner slot: offline / session / update ]  │
│ ▸ New     │                                                │
│   scrape  │  Search: [___________]   Filter: [All ▾]       │
│ ▸ Settings│                                                │
│           │  ┌──────────────────────────────────────────┐ │
│           │  │ ● example.com        Running · 42/120 pgs │ │ → F
│  [ user ] │  │   ▁▂▃ 3.2/s · 18 MB      [Open][Pause]    │ │
│  avatar/  │  ├──────────────────────────────────────────┤ │
│  name     │  │ ✓ docs.foo.io        Done · 512 pgs·88 MB │ │ → G
│           │  │   Captured Jul 14        [Open][Re-scrape]│ │
│           │  ├──────────────────────────────────────────┤ │
│           │  │ ⚠ blog.bar.net       Partial · 30 pgs    │ │ → G
│           │  │   Stopped early          [Open][Resume]   │ │
│           │  └──────────────────────────────────────────┘ │
└───────────┴──────────────────────────────────────────────┘
```
Controls: sidebar **Library / New scrape / Settings**, **user/account chip**,
**+ New scrape**, **Search**, **Filter (All / Running / Done / Partial)**, per-row
**status badge**, **Open**, **Pause/Resume**, **Re-scrape**, row context menu
(Delete, Show in files, Rename).

### D. New Scrape — Setup
```
┌───────────┬──────────────────────────────────────────────┐
│ SIDEBAR   │  New scrape                                    │
│           │  ──────────────────────────────────────────── │
│           │  URL                                           │
│           │  [ https://example.com________________ ] ✓     │
│           │   ↳ example.com · "Example Domain"  (preview)  │
│           │                                                │
│           │  What to capture                               │
│           │  ┌───────────────┐   ┌───────────────┐         │
│           │  │ ◉ This page   │   │ ○ Whole site  │         │
│           │  │   only        │   │   (follow     │         │
│           │  │               │   │    links)     │         │
│           │  └───────────────┘   └───────────────┘         │
│           │                                                │
│           │  Depth (whole site only)  [Section|Few|All ▾]  │
│           │                                                │
│           │  Include:  ☑ Images ☑ Styles ☑ Scripts         │
│           │                                                │
│           │  Save to:  ~/offline-web/example.com [Change…] │
│           │                                                │
│           │  ▸ Advanced                                    │  ← collapsed drawer (D1)
│           │                                                │
│           │  Static snapshot — some dynamic features won't │
│           │  work offline.                                 │
│           │                                                │
│           │              [ Cancel ]   [ Start scrape ]     │
└───────────┴──────────────────────────────────────────────┘
```
Controls: **URL** (+ inline validation/preview), **This page only / Whole site**,
**Depth**, **Include: Images/Styles/Scripts**, **Save to / Change…**, **Advanced**
(disclosure), **Cancel**, **Start scrape**, persistent **fidelity note**.

### D1. Advanced drawer (expanded)
```
▾ Advanced
  Domain scope     [ Same domain ▾ ]  (Same / +subdomains / Specific… / Any)
  Rate limit       [====|·········]  2 req/s   ⚠ high beyond marker
  Concurrency      [ 4 ▾ ]
  robots.txt       ◉ Respect   ○ Ignore  ⚠(caution text)
  Rendering        ◉ Static (fast)  ○ Render JavaScript (slower)
  Assets…          [ Configure per-type / max size / external ]
  Safety limits    Max pages [ 500 ]  Max size [ 2 GB ]  Max time [ 30 min ]
```

### D2. Pre-flight confirm sheet (conditional)
```
┌──────────────────────────────────────────────┐
│  Before we start                               │
│                                                │
│  Whole site · a few levels · same domain       │
│  Estimated: ~300–600 pages, ~150–400 MB        │
│                                                │
│  ⚠ You chose to ignore robots.txt.             │  (only if applicable)
│  ⚠ No page limit set.                          │  (only if applicable)
│                                                │
│      [ Adjust settings ]     [ Start anyway ]  │
└──────────────────────────────────────────────┘
```

### F. Job Progress
```
┌───────────┬──────────────────────────────────────────────┐
│ SIDEBAR   │  example.com                    ● Running 04:12│
│           │  ──────────────────────────────────────────── │
│           │  Now: https://example.com/docs/guide/setup…   │
│           │  [████████████░░░░░░░░]  128 / ~300 pages      │
│           │                                                │
│           │  Queue: 172   ·   3.4 pg/s   ·   84 MB         │
│           │  ETA ~6 min (estimate)                         │
│           │                                                │
│           │  ⚠ 14 skipped / errored   [ View details ]  → F1│
│           │                                                │
│           │  Rate: [ – slower ]  ●●●○○  [ faster + ]       │
│           │                                                │
│           │        [ Pause ]      [ Stop & keep results ]  │
└───────────┴──────────────────────────────────────────────┘
```
Controls: **Current URL**, **progress bar / counts**, **Queue**, **throughput**,
**ETA**, **skipped counter → View details (F1)**, **Rate slower/faster**,
**Pause**, **Stop & keep results**.

### F1. Errors / skips panel
```
  Skipped & errors (14)          Filter: [All ▾]  [ Copy log ]
  ─────────────────────────────────────────────────────────
  ▸ Blocked by robots.txt (8)
  ▸ Timed out (3)
  ▸ Off-scope link (2)
  ▸ Needs JavaScript (1)   [ note: re-scrape with rendering ]
```

### G. Results / Captured site
```
┌───────────┬──────────────────────────────────────────────┐
│ SIDEBAR   │  docs.foo.io           ✓ Done · Jul 14         │
│           │  ──────────────────────────────────────────── │
│           │  512 pages · 88 MB · saved to ~/offline-web/…  │
│           │  Static snapshot — interactive features may    │
│           │  not work offline.                             │
│           │                                                │
│           │  [ Open in browser ] [ Show in Finder ]        │
│           │  [ Re-scrape ] [ Delete ]                      │
│           │                                                │
│           │  ▾ Captured (512)                              │
│           │     / (index)                     ✓            │
│           │     /guide/setup                  ✓            │
│           │     /guide/advanced               ◐ partial    │
│           │  ▸ Skipped (23)   → Capture report (G1)         │
└───────────┴──────────────────────────────────────────────┘
```
Controls: **Open in browser**, **Show in Finder/Explorer/Files**, **Re-scrape**,
**Delete**, **Captured tree** (each opens locally), **Skipped → report (G1)**.

### H. Settings (tabs)
```
  Settings
  [ Account ] [ Defaults ] [ Storage ] [ Network ]
  ────────────────────────────────────────────────
  Account:   Signed in as user@example  [ Sign out ]
             What your login unlocks →
  Defaults:  Default scope, depth, assets, rendering, save location
  Storage:   Mirrors folder [Change…]  · Disk used: 1.2 GB  [ Clean up… ]
  Network:   Global rate cap · robots policy · User-agent string
```

---

## 4. State design (per key screen)

For each screen: **loading / empty / error / partial / offline / not-logged-in**.

### C. Library
- **Loading**: skeleton rows while jobs list hydrates.
- **Empty**: friendly first-run card — "No mirrors yet. Capture your first page →
  [New scrape]" + one-line fidelity note.
- **Error**: "Couldn't load your library" + **Retry**; still allow **New scrape**.
- **Partial**: jobs badged **Partial** sort/appear normally with a Resume affordance.
- **Offline**: offline banner; rows browsable (read-only); **New scrape** Start
  disabled with tooltip; existing local results still openable.
- **Not-logged-in**: user shouldn't reach Library signed-out; if session drops here,
  show session-expired banner + **Sign in**, keep list visible read-only.

### D. New Scrape — Setup
- **Loading**: URL preview shows "checking…" spinner inline; rest is instant.
- **Empty**: pristine defaults (page-only, respect robots, conservative rate).
- **Error**: field-level errors (bad URL, unwritable folder); **Start** disabled.
- **Partial**: n/a (config screen) — but "Re-scrape" pre-fills from a prior job.
- **Offline**: banner; URL reachability can't be checked (note shown); **Start**
  disabled until online.
- **Not-logged-in**: intercept on Start → session banner + **Sign in**; config preserved.

### F. Job Progress
- **Loading**: "Starting…" while the first fetch resolves and queue seeds.
- **Empty**: n/a (a job always has ≥1 URL); if discovery finds nothing beyond the
  seed, show "Only 1 page found" honestly.
- **Error**: inline job-level error states (disk full, blocked); per-URL errors in F1.
- **Partial**: after Stop → "Stopped. Kept N pages." → **View results**.
- **Offline**: "Offline — waiting to reconnect" paused state; auto-resume.
- **Not-logged-in**: session-expired auto-pause + **Sign in to resume**.

### G. Results
- **Loading**: brief while reading the capture manifest.
- **Empty**: "Nothing was captured" + diagnosis + top fix button.
- **Error**: "Files not found at <path>" → **Locate…** / **Re-scrape**.
- **Partial**: **Partial** badge; report leads with missing + **Resume/Re-scrape**.
- **Offline**: fully usable — results are local; only **Re-scrape** is disabled offline.
- **Not-logged-in**: browsing results does **not** require login (they're local);
  **Re-scrape** does — prompts sign-in.

### B. Sign-in
- **Loading**: **Sign in** shows "Signing in…" and the form disables while the
  credential-for-token exchange is in flight.
- **Empty**: default sign-in form with empty username/password fields.
- **Error**: inline field error for bad credentials; B1 trouble panel for
  can't-reach/server errors + **Retry**; MFA/challenge step shown inline when required.
- **Offline**: "Can't reach interlinedlist.com — you appear to be offline" +
  **Work offline (browse existing mirrors)** if any exist; **Sign in** disabled.
- **Not-logged-in**: this is the state; **Quit** always available (no trap).

---

## 5. Trust & safety UX

Goal: be responsible and legible **without nagging**. Safe by default, honest when the
user opts into risk, silent when everything is fine.

- **robots.txt**: Respected by default. When it blocks content, we frame it as the
  site's stated preference ("This site asks crawlers not to fetch these pages") and
  simply skip, surfacing the count in the capture report — not a blocking modal.
  Overriding lives in Advanced behind a one-line caution, shown once, not repeated.
- **Rate limiting**: Conservative default (low req/s + low concurrency). The rate
  slider has a visible "polite" zone; going past it shows an inline caution but doesn't
  block. On live 429/403, we auto-back-off and inform gently. The point: protect target
  sites and the user's IP reputation by default.
- **ToS / legal**: A brief, non-blocking **first-run acknowledgment** ("You're
  responsible for respecting each site's terms and copyright; mirror only content you're
  allowed to") shown once, plus a persistent link in Settings/About. We do **not**
  re-prompt per scrape. When the user chooses risky options (ignore robots, any-domain),
  the pre-flight restates responsibility in one line — targeted, not blanket.
- **Large-download confirmation**: The **pre-flight sheet (D2)** appears only when a job
  crosses a size/page/time threshold or uses risky scope. It shows an estimate and lets
  the user proceed or adjust. Mid-job, a soft-ceiling checkpoint catches surprises. Small
  jobs never see it.
- **The Advanced principle**: everything dangerous or expert-level (ignore robots,
  cross-domain, high rates, no limits, JS rendering) is reachable but not in the way.
  Defaults are the safe answer; Advanced is the informed override.
- **Anti-nag rules**: each caution is shown at most once per relevant action; nothing
  that's already the safe default ever prompts; confirmations only for genuinely
  consequential or irreversible actions (large download, ignore robots, delete a mirror).

---

## 6. Cross-platform considerations

- **Native menu bar**:
  - macOS: app menu (About, Preferences… = Settings, Quit), **File** (New scrape…),
    **Edit**, **Window**, **Help**. Preferences uses ⌘, and follows macOS conventions.
  - Windows/Linux: in-window menu / hamburger as appropriate; **Settings** rather than
    "Preferences"; standard **File / Edit / Help**. Respect platform title-bar chrome.
- **File pickers**: always the **native** folder chooser for output location and
  "Locate folder…"; never a custom in-app browser. Default paths use platform home
  conventions (`~/offline-web` / `%USERPROFILE%\offline-web`).
- **Reveal in file manager**: label adapts — **Show in Finder** (macOS), **Show in
  Explorer** (Windows), **Show in Files / Open folder** (Linux).
- **Notifications**: native OS notifications for job complete, session expired,
  repeated errors, and low disk. Respect OS Do-Not-Disturb; user can toggle categories
  in Settings → Notifications.
- **Keyboard shortcuts**: ⌘/Ctrl-N new scrape, ⌘/Ctrl-, settings, ⌘/Ctrl-W close,
  space to pause/resume a focused running job. Platform-correct modifiers.
- **Open-in-browser**: launches the OS default browser on the local `index.html`
  (`file://`), not an embedded view — real fidelity, and it's clearly "your browser."
- **Credential storage**: OS keychain / Credential Manager / Secret Service — never a
  plaintext file.
- **Window state / dock/taskbar**: long jobs continue when minimized; progress reflected
  in dock/taskbar where the platform supports it (badge/progress).

---

## 7. Open UX questions (need human product decisions)

1. **What does login unlock, exactly?** Is interlinedlist.com login purely an
   access gate, or does the account carry entitlements/quotas (max pages, sites,
   concurrent jobs)? This changes error copy (§2.1 fail path) and whether we show
   any usage meter.
2. **Auth mechanism**: ~~embedded web view vs. system browser~~ — **RESOLVED**:
   username/password submitted directly to interlinedlist.com's auth API for a token
   (see plan §0). Remaining sub-question: does interlinedlist.com's login require MFA
   or any secondary challenge the form must handle, and is there a refresh-token flow?
3. **Headless-render default**: should **Render JavaScript** ever be the default (many
   modern sites are JS-only), or always opt-in for speed/safety? Proposed: opt-in, with
   smart detection prompting a one-click re-scrape. Needs a call.
4. **Output format**: raw mirrored files (browsable `index.html` tree) only, or also a
   single-file archive (e.g. `.html`/`.warc`/`.zip`) option? Affects Results and Storage.
5. **Branding**: app name shown to user (is it literally "offline-web"?), logo, color,
   relationship/marketing tie to interlinedlist.com on the sign-in screen.
6. **robots override policy**: do we allow ignoring robots at all in a free, widely
   distributed app, given abuse/liability? If yes, how strong is the caution and do we
   require an explicit acknowledgment?
7. **Scraping authenticated target sites**: do we support mirroring pages that require
   the *user's own* login to the target site (reusing their browser session)? Big
   feature + legal surface — in or out for v1?
8. **Concurrency of jobs**: can users run multiple scrapes at once, or one at a time?
   Impacts Library, Progress, and resource/rate messaging.
9. **Default rate + ceilings**: what exact numbers are "polite" defaults (req/s,
   concurrency) and safety ceilings (max pages/size/time)? Needs a defensible baseline.
10. **Update mechanism**: how does the app self-update, and how prominent is the update
    banner? Affects the global banner slot.
11. **Telemetry / crash reporting**: any, and how is consent surfaced on first run
    (alongside the ToS acknowledgment)?
12. **Re-scrape / refresh semantics**: does re-scrape overwrite in place, version, or
    create a new dated capture? Affects Storage and Results copy.
