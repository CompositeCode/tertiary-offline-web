# InterlinedList Offline

**InterlinedList Offline** is a free, cross-platform (macOS / Linux / Windows)
desktop app that mirrors a web page — or a whole website — to a local folder so
you can read it offline. It is **free, with no subscription**, but requires
signing in with a free **InterlinedList** account (interlinedlist.com) to unlock
scraping. The login is a pure access gate: sign in once and every feature is
unlocked.

> **Screenshot placeholder.** _App screenshots (sign-in, New scrape, live
> Progress, Results with capture report) go here once captured._

## What it does

- **Save one page or a whole site** — "This page only" (a page plus its assets)
  or "Whole site" (a bounded, polite crawl with depth and domain scope).
- **Honest static snapshots** — captures images, CSS, fonts, and scripts and
  rewrites links so the copy opens offline from your disk. Some dynamic features
  (logins, live feeds, search boxes, streaming) won't work offline, and the app
  says so clearly.
- **Safe, polite defaults** — respects `robots.txt`, fetches slowly (1 req/s),
  stays same-domain, and stops at finite caps (500 pages / 2 GB / 30 min). You
  can't produce an abusive crawl without deliberately opening Advanced.
- **Legible, resumable jobs** — live progress with Pause / Resume / Stop and a
  live rate control; jobs survive quit, crash, network loss, and session expiry.
- **Trustworthy results** — a capture report showing captured vs. skipped (with
  reasons) and honest fidelity notes.

## Quick start

> **Installers are built by CI** on every push to `main` — macOS `.pkg`/`.dmg`,
> Windows `.msi`/`.exe`, Linux `.AppImage`/`.deb`/`.rpm` (see
> `.github/workflows/build.yml`). They are currently **unsigned** (Gatekeeper /
> SmartScreen will warn on first launch); code signing and auto-update are the
> remaining M5 items. You can also run from source, below.

**Prereqs:** [Node.js](https://nodejs.org) (npm) and the
[Rust toolchain](https://rustup.rs). Plus each platform's build deps for the
desktop shell — Xcode Command Line Tools on macOS;
`webkit2gtk` / `libssl` / `build-essential` on Linux; MSVC + WebView2 on Windows.

```bash
npm install

# Desktop app (real sign-in + real scraping):
npm run tauri dev

# Browser-only UI preview (no sign-in, no scraping):
npm run dev        # serves the UI at http://localhost:1420
```

Sign in with your InterlinedList account **email and password**. Signing in and
scraping only work in the **desktop app** — the browser preview lets you click
through the screens but can't reach the keychain or fetch pages.

New users: start with **[docs/user-guide.md](docs/user-guide.md)**.

## Documentation

- **[User guide](docs/user-guide.md)** — install, sign in, make your first
  mirror, whole-site & advanced options, watching a job, reading results.
- **[Acceptable use & your responsibilities](docs/acceptable-use.md)** — what the
  app is for, how it protects sites by default, and the copyright / personal-data
  principles you're asked to follow.

## How it works & fidelity

The app fetches pages over HTTPS, saves the assets needed to render them, and
rewrites in-page links and references so the result opens from `file://` with no
network. The output is a **browsable folder tree** with an `index.html` entry
point:

```
~/InterlinedList Offline/<host>/
  index.html          # rewritten entry page, opens offline
  assets/             # downloaded images / CSS / fonts / JS
  ...                 # additional captured pages (whole-site jobs)
```

Because it's a **static snapshot**, anything that needs a live server or a running
app — search, sign-in areas, live/streamed content, some interactive JavaScript —
won't function offline. The capture report tells you specifically what was skipped
and what likely won't work. Your scraped content **never leaves your device**; the
only server the app talks to is InterlinedList's sign-in.

## Tech stack

- **Tauri v2** desktop shell (Rust backend + native webview).
- **Vite + vanilla TypeScript** frontend — no UI framework, minimal deps.
- Rust scraping: `reqwest` (rustls) + `scraper` + `url`.
- Credentials in the **OS keychain** (macOS Keychain / Windows Credential Manager
  / Linux Secret Service) — never in a plaintext file. Your password is used only
  for the sign-in exchange and is never written to disk or logs.

## Status

Milestones are incremental vertical slices (see `docs/plan.md` §6).

| Milestone | Scope | Status |
|-----------|-------|--------|
| **Auth** | Real email + password sign-in to interlinedlist.com; token in OS keychain; session-expiry auto-pause + resume | **Shipped** |
| **M0** | Walking skeleton: launch → login gate → single-page capture → open in browser | **Shipped** |
| **M1** | Whole-site crawl: depth, domain scope, dedupe, safety caps, robots.txt, rate limiting, backoff | **Shipped** |
| **M2** | Long-job UX: live Progress, Pause / Resume / Stop / live Rate, persisted crash-survivable resume | **Shipped** |
| **M3** | Results & capture report: captured vs. skipped, fidelity notes, inline fixes, Re-scrape / Delete, recovery states | **Shipped** |
| **M4** | Opt-in JavaScript rendering (drives system Chrome over CDP, no bundled Chromium) for JS-only pages | **Shipped** |
| **M5** | Settings tabs, first-run ToS acknowledgment, native menus/notifications, accessibility, packaged installers, auto-update | **Mostly shipped** — settings, ToS, menus, notifications, a11y, and CI-built installers are done; **code signing and auto-update are configured but not yet functional** (unsigned installers; updater pubkey is a placeholder) |

### Honest limitations today

- **JavaScript rendering is opt-in (M4).** Pages that build their content with
  JavaScript are flagged **Needs JavaScript**; you can opt into rendering them by
  driving your installed system Chrome over CDP (no Chromium is bundled). Off by
  default.
- **Installers are unsigned.** CI builds `.pkg`/`.dmg`/`.msi`/`.exe`/`.AppImage`/
  `.deb`/`.rpm` on every push to `main`, but they are not code-signed yet, so
  Gatekeeper (macOS) and SmartScreen (Windows) warn on first launch.
- **Auto-update is not live yet.** The updater is wired in config
  (`createUpdaterArtifacts`), but the updater public key is a placeholder and no
  release endpoint is published, so in-app updates don't work until signing keys
  land.
- **One job at a time.** Concurrent jobs are deferred beyond v1.

## Branding

Brand values (name, wordmark, logo, colors) are placeholders derived from
interlinedlist.com and centralized for a one-edit swap when official assets land:

- `src/styles/brand.css` — colors, radius, fonts (CSS custom properties).
- `src/brand.ts` — product name, wordmark, and inline SVG logo.
