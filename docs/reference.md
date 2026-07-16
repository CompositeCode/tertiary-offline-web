# Offline Web — Reference

**Audience:** users who want the full detail behind every Settings control,
a fix for whatever the app is telling them, and a record of what shipped in v1.

**What this is:** the complete reference for **Offline Web v1**. It
has three parts:

1. [Settings reference](#1-settings-reference) — every setting, tab by tab.
2. [Troubleshooting & FAQ](#2-troubleshooting--faq) — keyed to the exact states
   and skip reasons the app reports.
3. [v1 release notes](#3-v1-release-notes) — what shipped, and what didn't.

> **See also.** For a task-by-task walkthrough, read the
> [User Guide](user-guide.md). For your responsibilities as a user and how the
> app protects sites, read [Acceptable Use](acceptable-use.md). This reference
> does not repeat those — it goes deeper on Settings, failure states, and the
> changelog.

---

## 1. Settings reference

Open **Settings** from the sidebar. It has four tabs — **Account**,
**Defaults**, **Storage**, **Network** — matching the four areas in the plan
(FR-SET-1).

### Where settings live and how they behave

> **Settings persist in a plain JSON file in your OS app-config directory** —
> **not** in the keychain, because no secrets live here. The file is:
>
> | Platform | Location |
> |----------|----------|
> | **macOS** | `~/Library/Application Support/Offline Web/settings.json` |
> | **Windows** | `%APPDATA%\Offline Web\settings.json` |
> | **Linux** | `$XDG_CONFIG_HOME/Offline Web/settings.json` (or `~/.config/...`) |

- **Changes save immediately** as you edit each control — there is no separate
  "Save" button. Writes use write-then-rename, so a crash mid-save can't
  corrupt the file.
- **Defaults pre-populate New Scrape** (FR-SET-2). What you set under the
  **Defaults** and **Network** tabs becomes the starting point every time you
  open **New scrape** — you can still override any of it per job.
- **The safe set stays the safe set.** Page-only, respect robots, polite rate,
  same-domain, and static fetch remain the shipped defaults. Nothing you change
  here can remove the hard politeness ceiling (see Network).
- **The only content-adjacent value stored is a folder *path*** (your mirrors
  root). Never your password, token, or any scraped content.

> **Running from source vs. a packaged app.** A few Storage controls (folder
> picker, "Show in…", disk-usage total) only work in the desktop app, not the
> browser preview. They appear disabled with a note when the native backend
> isn't present. Everything else works either way.

---

### 1.1 Account tab

Identity, what your login unlocks, about/legal links, and sign-out.

| Setting / element | What it does | Default / value |
|---|---|---|
| **Signed in as** | Shows the email of your current InterlinedList account (read from the keychain-backed session). | Your account email, or "Not signed in". |
| **What your login unlocks** | Explains that the app is free and your login is a pure access gate — no tiers, quotas, or subscriptions. Captures stay on-device. | Informational. |
| **About & legal** | Shows the app version and links to the **Acceptable-use guide** and **interlinedlist.com** (opens in your system browser). | Version string; links. |
| **Sign out** | Clears your stored login token from the OS keychain and returns you to the sign-in screen. Your saved mirrors stay on disk and remain openable signed-out. | Action. |

> **Sign-out never deletes your mirrors.** It only removes the credential.
> Browsing existing results never requires a session.

---

### 1.2 Defaults tab

These pre-populate the **New scrape** screen (FR-SET-2). Setting them here just
changes your starting point; you still adjust any job before you start it.

| Setting | What it does | Default | Notes / limits |
|---|---|---|---|
| **Default scope** | Whether new jobs start as **This page only** or **Whole site**. | **This page only** | Page-only is the safe default. |
| **Default depth (whole site)** | Starting depth preset for whole-site jobs: *Just this section (1)* / *A few levels (2)* / *Deeper (4)* / *Everything (unlimited)*. | **A few levels (2)** | "Everything" is unbounded depth — choose deliberately. |
| **Default domain scope** | Where crawls may go: *Same domain* / *Include subdomains* / *Specific domains* / *Any domain (danger)*. | **Same domain** | *Any domain* is a danger option; it trips the pre-flight confirm. |
| **Assets** | **Informational, not a toggle.** States that images, CSS, fonts, and JS are *always* captured so pages render offline. | Always on | You cannot turn asset capture off in v1 (see [Known limitations](#known-limitations--not-yet-in-v1)). |
| **Rendering** | Whether new jobs default to **Render JavaScript** instead of a static fetch. | **Off (static)** | Static is the default (FR-RENDER-1). Rendering needs a system Chromium browser installed (see [Network / rendering](#needs-javascript--rendering-unavailable)). |

> **The Assets row is a statement, not a switch.** Per-type asset include/exclude
> and an asset-size cap were specified (FR-ASSET-5) but are **not exposed in
> v1** — assets are simply always captured.

---

### 1.3 Storage tab

Where mirrors are saved, how much space they use, and re-scrape semantics.

| Setting / element | What it does | Default | Notes / limits |
|---|---|---|---|
| **Mirrors root folder** | The folder new captures are written under, as `<host>/`. **Change…** opens the native folder picker; **Show in Finder/Explorer/Files** reveals it. | `~/Offline Web` | Changing it does **not** move existing mirrors — only new captures use the new root. Buttons are disabled outside the desktop app. |
| **Disk usage** | Recursively totals the size of everything under the mirrors root and counts immediate mirror subfolders. | Calculated live | Shown only in the desktop app. Shows "No mirrors yet" before your first capture. |
| **Re-scrape semantics** | Explains that re-scraping writes a **new dated capture** by default (non-destructive); you can choose **Overwrite in place** from Results, and **Delete** a mirror there to reclaim space. | New dated capture | Informational (the choice is made per re-scrape on the Results screen). |

> **⚠️ Free-space reporting is dormant in v1.** The app validates that your
> output folder is **writable** before every job (it creates and removes a test
> file), and that check is live. But it does **not** currently report how many
> bytes are *free* on the volume — that reads as `0` ("undeterminable"), so the
> pre-Start **low-space warning never fires**. You'll still get an honest
> **"Out of space"** auto-pause if the disk actually fills mid-job (see
> [Disk full](#disk-full)); you just won't be warned in advance. This is a known
> v1 limitation, not a bug.

---

### 1.4 Network tab

Global politeness controls that pre-populate New Scrape's Advanced drawer.

| Setting | What it does | Default | Limits |
|---|---|---|---|
| **Global rate cap (requests/sec/host)** | Default fetch rate per host for new jobs. | **1** | Accepts 0.1–5. **A hard global ceiling of ~5 req/s is enforced in the crawler regardless of what you enter here** — you cannot exceed it even in Advanced. Values ≤ 1 req/s are the marked "polite" zone. |
| **Concurrency (workers)** | How many pages new jobs fetch at once. | **2** | Accepts 1–8 (whole numbers; clamped). |
| **robots.txt policy default** | Whether new jobs *Respect* or *Ignore* robots.txt. | **Respect** | Ignoring is an advanced choice; it trips the pre-flight confirm and a one-time acknowledgment (see [Acceptable Use §4](acceptable-use.md#4-the-robotstxt-override)). |
| **User-Agent** | The identity string the app sends to sites. | `OfflineWeb/0.1 (+https://interlinedlist.com)` | Editable, but it is sent **truthfully** — the app never spoofs a UA to evade blocks (LG-RATE-2). |

> **The politeness ceiling is not negotiable.** Even if you raise the rate, the
> crawler clamps the *effective* rate to ~5 req/s and backs off automatically on
> HTTP 429/403. This is by design (LG-RATE-1) and cannot be turned off.

---

## 2. Troubleshooting & FAQ

This section expands the User Guide's basics. Each entry names **what you see**
(the app's real state or skip reason) and **what to do**. The italic keyword
after each heading is the internal state/reason so you can match it to what the
app shows.

### Signing in

#### I can't sign in — "Incorrect email or password" *(invalid)*

**What you see:** the sign-in form rejects your credentials.

**What to do:**
- Verify the same email and password work on **interlinedlist.com** in your
  browser. The sign-in field is your account **email**, not a username.
- Use **Forgot password?** on the sign-in screen — it opens interlinedlist.com
  in your browser to reset (the app doesn't handle resets).

#### "Can't reach interlinedlist.com" *(unreachable)*

**What you see:** a network-style error rather than a credentials rejection.

**What to do:** this is a connectivity problem, not a wrong password. Check your
internet connection, any VPN/proxy or firewall, and try again. The app talks to
interlinedlist.com **only** to sign you in.

#### Sign-in fails with a keychain / unexpected error *(other)*

**What you see:** an error that isn't "incorrect password" and isn't
"can't reach" — typically a keychain problem (`keychain unavailable` /
`keychain write failed`).

**What to do:** the OS secure credential store (macOS Keychain, Windows
Credential Manager, Linux Secret Service) couldn't be read or written. On Linux
this usually means no Secret Service provider (e.g. GNOME Keyring / KWallet) is
running — start or install one. Then try signing in again.

> **Sign-in only works in the desktop app.** The browser preview can't reach
> your keychain or the network, so its Start button is disabled. Use the desktop
> app to sign in and scrape.

#### My session expired in the middle of a job *(session-expired)*

**What you see:** the running job's status changes to **Sign-in needed** and
shows *"Your interlinedlist.com session expired. Sign in to resume."* You're
routed to the sign-in screen. The job is **paused, not failed**.

**What to do:** sign in again. The app **resumes the exact paused job** right
where it left off — no pages are re-fetched and nothing needs reconfiguring
(FR-AUTH-5). Configured-but-not-started work is preserved too (FR-AUTH-6).

> **Browsing existing mirrors never needs a session.** Only starting a new
> scrape or a re-scrape does.

---

### During a crawl — skips and pauses

The Progress screen and the capture report group skips by reason. Here's each
real reason and what it means.

#### "Blocked by robots.txt" *(robots-blocked)*

**What you see:** pages counted under *Blocked by robots.txt* in the skip
breakdown. **What it means:** the site's `robots.txt` asked automated tools not
to fetch those paths, and the app respected that by default.

**What to do:** this is normal and honest — nothing disappears silently. If (and
only if) you have a clear right to mirror the content, the report offers
**Re-scrape ignoring robots.txt** inline (this option appears only when you were
respecting robots). See [Acceptable Use §4](acceptable-use.md#4-the-robotstxt-override).

#### "Off-scope links" *(off-scope)*

**What you see:** links counted under *Off-scope links*. **What it means:** those
links point outside the **domain scope** you set (default: same domain), so the
crawler recorded them but did **not** fetch them (FR-SCOPE-4).

**What to do:** if you want them, widen the scope. When you were on *Same domain*,
the report offers **Re-scrape including subdomains** inline. You can also set
*Specific domains* or *Any domain* in Advanced (the latter trips the pre-flight
confirm).

#### My captured page is blank — "Needs JavaScript" *(needs-js)*

**What you see:** pages flagged **Needs JavaScript** in the report. **What it
means:** the page builds its content with JavaScript, so a static fetch came
back nearly empty. The app detects this and flags it rather than saving a silent
blank (FR-RENDER-3/4).

**What to do:** the report offers **Re-scrape with JavaScript rendering** inline.
This requires a system Chromium browser — see the next entry.

#### "JavaScript rendering unavailable" — needs system Chrome *(render-unavailable)*

**What you see:** when you asked for rendering but no browser is installed, pages
are skipped as **JavaScript rendering unavailable** with:
*"Rendering these pages needs Google Chrome (or another Chromium browser)
installed on this computer. Install Chrome, then try again — or keep the static
snapshot."*

**What to do:** Offline Web does **not** bundle a browser (to keep the
download small). It drives a **system-installed** Chrome/Chromium/Edge/Brave.
Install one of those, then re-scrape with rendering. On the New scrape screen the
**Render JavaScript** toggle is disabled with a tooltip until a browser is found.

> **Rendering is heavy.** Each rendered page launches a fresh headless browser,
> so a whole-site render is slow and resource-hungry. Prefer rendering the
> specific pages that need it (via the report's inline re-scrape) over rendering
> an entire site.

#### The site is huge / a safety cap was hit *(capped)*

**What you see:** the job status becomes **Limit reached** and it pauses with a
message like *"Reached the page limit (500 pages)."*, *"Reached the size limit
(2 GB)."*, or *"Reached the time limit (30 min)."* — whichever comes first.
Results badge the mirror **Partial**.

**What to do:** the job **kept everything captured so far** — it never truncates
silently or runs forever. You can keep the partial result, or **Re-scrape with
higher limits** (offered inline for *Too large*), lower the **Depth**, or lower
the **Rate**. Defaults are **500 pages / 2 GB / 30 minutes**; raising them trips
the pre-flight confirm.

#### Other skip reasons you may see

| Reason (shown) | Internal | Meaning / remedy |
|---|---|---|
| **Too large** | `too-large` | Response exceeded the size limit. Inline fix: **Re-scrape with higher limits**. |
| **Timed out** | `timeout` | Page didn't respond in time. A slower rate or a retry often helps. Inline fix: **Re-scrape**. |
| **Rate-limited (backed off)** | `rate-limited` | Site returned HTTP 429/403; the crawler backed off. Lower the rate. Inline fix: **Re-scrape**. |
| **Connection failed** | `connection-failed` | DNS/connection error reaching the URL. Check the network. Inline fix: **Re-scrape**. |
| **HTTP error** | `http-error` | Server returned an error (e.g. 404/500). No automatic fix. |

---

### Interruptions — the app pauses, never loses work

A job's state is persisted to disk as it runs, so it survives app quit, crash,
network loss, and session expiry (NFR-RESUME-1). Interrupted jobs appear in the
Library as **Paused** or **Partial** with a **Resume** button.

#### I went offline mid-job *(offline)*

**What you see:** status **Offline** — *"Offline — waiting to reconnect. The job
will resume automatically."*

**What to do:** nothing. The job auto-pauses and **resumes on its own** when your
connection returns.

#### The disk filled up *(disk-full)*

**What you see:** status **Out of space** — *"Ran out of disk space. Free some
space, then Resume."* The partial result is preserved. This is caught at
page-write time (an `ENOSPC` error).

**What to do:** free space (or plan to move the mirrors root in Storage settings),
then click **Resume**.

> **Reminder:** the app does not *warn* you about low free space before a job in
> v1 (free-space reporting is dormant — see [Storage tab](#13-storage-tab)). It
> only reacts when the disk actually fills. The pre-Start writability check is
> live, so an *unwritable* folder is still blocked up front.

#### I quit or the app crashed mid-job

**What you see:** the mirror appears in the Library as **Paused** / **Partial**.

**What to do:** click **Resume**. It continues from where it stopped with **no
re-fetching** of completed pages. Jobs also keep running when the window is
minimized, and fire a native completion notification when done.

---

### Results problems

#### Results say "Files not found" *(files-not-found)*

**What you see:** *"Files not found at &lt;path&gt;"* with **Locate folder…** and
**Re-scrape** — instead of a crash. **What it means:** the saved files were moved
or deleted outside the app (FR-RES-4).

**What to do:** use **Locate folder…** to point at where you moved them, or
**Re-scrape** to capture the site again.

#### "Nothing captured" *(zero-capture)*

**What you see:** a plain-language diagnosis plus the single most likely fix as a
button (FR-RES-5). Common cause: everything was blocked — e.g. all pages
`robots-blocked`, in which case the top fix is a robots override (only if you
have the right to mirror), or the biggest skip group's remedy.

**What to do:** use the offered fix, or reconsider scope/robots/rendering
depending on the diagnosis.

#### What likely won't work offline (fidelity)

Every capture report lists honest fidelity notes (FR-REPORT-2). A **static**
mirror can't reproduce:

- Server-side **search boxes** (they won't return results offline).
- **Login areas** and anything behind an account.
- **Live or streamed** content (feeds, video, chat) — frozen or missing.
- Some **interactive JavaScript** features.

This is expected. Rendering (where available) helps with JS-*rendered content*,
but not with anything that needs a live server.

---

### General FAQ

**Does anything I scrape get uploaded?** No. Captured pages, assets, and reports
are written only to your mirrors folder. The app contacts a server **only** to
sign you in. There is no cloud sync of your mirrors (LG-PII-1).

**Where are settings stored?** In `settings.json` in your OS app-config dir (see
[§1](#where-settings-live-and-how-they-behave)). No secrets are in it; your token
lives only in the OS keychain.

**Can I turn off asset capture, or exclude images?** Not in v1 — assets are
always captured so pages render offline.

**Why can't I go faster than ~5 requests/second?** That's the enforced hard
politeness ceiling. It protects the sites you mirror and your own IP's
reputation, and it can't be disabled.

---

## 3. v1 release notes

**Offline Web v1** is the first complete release: milestones **M0–M5**
plus real InterlinedList authentication, all shipped. Below is what landed,
organized by capability, followed by an honest list of what did **not** make v1.

### Authentication (M0 + real auth)

- Native **email + password** sign-in against interlinedlist.com's real API
  (`POST /api/auth/sync-token` → long-lived Bearer token).
- Password held **in memory only** for the token exchange, then cleared; never
  written to disk, logs, or config.
- Token stored **only in the OS keychain** (macOS Keychain / Windows Credential
  Manager / Linux Secret Service).
- Distinct, honest errors: **invalid credentials**, **can't reach
  interlinedlist.com**, and keychain/other failures.
- **Forgot password?** opens interlinedlist.com in the system browser.
- **Launch session check** validates the stored token (`GET /api/user`) and
  routes to Library or Sign-in; tolerates being offline at launch.
- **Sign out** from Settings → Account clears the credential; existing mirrors
  stay browsable signed-out.

### Scraping / crawl + politeness (M0–M1)

- **This page only** (default) and **Whole site** crawl.
- **Depth** presets (1 / 2 / 4 / unlimited), **domain-scope** enforcement
  (same / subdomains / specific / any), URL **dedupe**, and out-of-scope links
  recorded (not fetched).
- **Assets always captured** (images, CSS, fonts, JS) with link/reference
  rewriting — including CSS `url()`/`@import` and `srcset` — so mirrors open from
  `file://` with no network.
- **Safety caps**: 500 pages / 2 GB / 30 minutes by default — hitting one
  **pauses and prompts**, keeping the partial result.
- **Politeness**: robots.txt respected by default (with a friction-gated
  override); **1 req/s**, **concurrency 2** defaults; per-host rate limiter;
  **hard ~5 req/s global ceiling**; automatic **429/403 back-off**; a truthful,
  configurable **User-Agent**.
- **Conditional pre-flight confirm** only when a job trips a threshold
  (deep whole-site, ignore-robots, cross-domain, or raised caps).

### Long jobs: pause / resume / persistence (M2)

- Live **Progress** view: status badge, current URL, pages done/discovered,
  queue depth, throughput, and skip breakdown by reason.
- **Pause / Resume** (exact-queue, no re-fetch), **Stop & keep results**, and a
  **live Rate** slider that retunes without restarting.
- Job state **persisted incrementally** to disk — survives quit, crash, network
  loss, and session expiry, all as **pauses, not failures**.
- Auto-pause states with honest copy: **offline** (auto-resumes), **out of
  space**, **sign-in needed**, and **limit reached**.
- **Native completion notification**; jobs continue when minimized.

### Results & capture report (M3)

- **Results** screen: site name, capture date, page/asset counts, total size,
  output path, and a persistent **static-snapshot fidelity banner**.
- Actions: **Open in browser** (`file://`), **Show in file manager**,
  **Re-scrape** (new dated capture *or* overwrite), **Delete**, and **Resume**
  on partial/paused mirrors.
- **Capture report**: captured vs. skipped, skips grouped by plain-language
  reason, **inline fixes** (re-scrape with rendering, include subdomains, raise
  limits, ignore robots…), and fidelity notes.
- Recovery states: **Partial** badge, **Nothing captured** diagnosis with a
  one-button fix, and **Files not found** with Locate/Re-scrape.

### JavaScript rendering (M4)

- Opt-in **Render JavaScript** mode driving a **system-installed** Chromium
  browser over CDP (no bundled browser — keeps the download small).
- **"Needs JavaScript" detection** on near-empty static captures, flagged in the
  report with one-click **Re-scrape with JavaScript rendering**.
- Graceful degrade when **no browser is installed**: honest
  *rendering-unavailable* skip and a disabled toggle with a tooltip — never a
  crash or a silent blank.

### Settings & packaging (M5)

- Four-tab **Settings**: Account, Defaults, Storage, Network — persisted to
  `settings.json` in the OS app-config dir; **Defaults pre-populate New Scrape**.
- **Storage**: change the mirrors root via native picker, reveal it, and see
  recursive disk usage.
- **First-run acceptable-use acknowledgment** (shown once, non-blocking) with
  persistent links from Settings/About.
- **Cross-platform**: native file pickers, platform-correct "Show in
  Finder/Explorer/Files", native notifications, keychain per OS.
- **Packaging config** wired for macOS/Windows/Linux bundles and a Tauri
  auto-updater (see maintainer note below).

### Known limitations / not yet in v1

An honest list so expectations are calibrated.

> **🔧 Maintainer-only: packaged, signed installers require the maintainer's
> certificates.** The bundle/updater config is wired, but real code-signing and
> update-signing need private material that is **placeholder/null** in the
> committed config. Until a maintainer supplies it, you build/run from source.
> Everything needed — updater keypair, macOS Developer ID + notarization,
> Windows signing cert, Linux packaging — is documented in
> **`src-tauri/PACKAGING.md`**. `tauri build` is intentionally left for the
> maintainer/orchestrator to run.

- **Free-space warning is dormant.** The pre-Start **writability** check is live,
  but **available free space is reported as `0` (undeterminable)**, so the
  low-space warning never fires. A real **"Out of space"** auto-pause still
  happens if the disk fills mid-job. (Determining free space needs a platform
  FFI that was left out to keep the binary small; the data shape is ready for a
  later build.)
- **The Assets toggle is informational.** Assets are always captured; per-type
  include/exclude and an asset-size cap (FR-ASSET-5) are **not exposed**.
- **Whole-crawl rendering is heavy.** Each rendered page launches a fresh
  headless browser (no shared/long-lived browser yet), so rendering a whole site
  is slow. Prefer rendering only the specific pages that need it.
- **Rendering needs a system browser.** No Chromium is bundled or downloaded; you
  must have Chrome/Chromium/Edge/Brave installed.
- **Authenticated-target scraping is out of scope for v1.** The app mirrors
  ordinary public pages; it does not reuse *your* login to scrape sites behind an
  account (LG-AUTHSITE-1).

**Also deferred beyond v1** (designed, not shipped): single-file archive output
(WARC/ZIP), and any account quotas/usage metering (the login is a pure access
gate, so none exists).
