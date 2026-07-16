# Start from here — dev handoff

You (another Claude instance, on a different machine) are taking over development
of **InterlinedList Offline** — a free cross-platform desktop app (Tauri v2) that
mirrors a web page or a whole website to a local folder for offline reading.
Sign-in with an InterlinedList account gates the scraping features.

Read this file first, then `README.md`, then `docs/plan.md`.

---

## READ THIS FIRST — remote is now synced; a plain clone works

The full app (M2–M5, docs, branding, CI, auto-update wiring) has been pushed.
`main` and `dev` on the remote both point at the same commit, so **a normal
`git clone` gives you everything** — no bundle/patch dance needed.

| Ref | Contains |
|-----|----------|
| `origin/main` (default clone) | **Everything: M0–M5, full docs, official branding/icons, CI workflow, auto-update wiring, version `0.1.0`.** |
| `origin/dev` | Same commit as `main` right now; use it as the working branch for new work. |

Remote: `git@github.com:CompositeCode/tertiary-offline-web.git`

```bash
git clone git@github.com:CompositeCode/tertiary-offline-web.git
cd tertiary-offline-web
git checkout dev        # do new work here, then merge/PR to main
```

CI builds installers on every push to **`main`**, so land releasable work there
(or merge `dev → main`). See "CI / installers" below.

---

## What the app is

- **Save one page or a whole site** — "This page only" or a bounded, polite
  "Whole site" crawl (depth + domain scope, dedupe, safety caps, robots.txt,
  1 req/s rate limiting, backoff).
- **Static snapshots** — captures images/CSS/fonts/JS and rewrites links so the
  copy opens offline from `file://`. Honest about what won't work offline.
- **Long-job UX** — live progress with Pause / Resume / Stop / live-rate;
  crash-survivable persisted jobs (survive quit, crash, network loss, session
  expiry → auto-pause + resume).
- **Results + capture report** — captured vs. skipped with reasons, fidelity
  notes, re-scrape / delete.
- **Opt-in JS rendering (M4)** — drives the user's *system* Chrome over CDP (no
  bundled Chromium) for JS-only pages.
- Credentials live in the **OS keychain**, never a plaintext file. Scraped
  content never leaves the device; the only server contacted is InterlinedList
  sign-in.

## Tech stack

- **Tauri v2** desktop shell — Rust backend + native webview.
- **Vite + vanilla TypeScript** frontend — no framework, minimal deps.
- Rust scraping: `reqwest` (rustls, blocking) + `scraper` + `url` +
  `texting_robots`; secrets via `keyring`.

## Repo layout

```
src/                     # frontend (vanilla TS)
  main.ts                # app entry / router
  auth.ts store.ts resume.ts settings.ts   # state, persistence, auth, settings
  tauri.ts               # bridge to Rust commands
  brand.ts banners.ts legal.ts format.ts dom.ts
  screens/               # signin, newscrape, progress, results, library, settings, shell
  styles/                # app.css, brand.css   (brand.css = one-edit brand swap)
  assets/logo.svg
src-tauri/src/           # Rust backend
  lib.rs main.rs         # app setup + command registration
  auth.rs                # interlinedlist.com sign-in, keychain token
  crawl.rs scrape.rs     # whole-site crawl + single-page capture
  render.rs              # opt-in headless JS rendering via system Chrome (CDP)
  fsutil.rs settings.rs
src-tauri/tauri.conf.json # bundle config (productName, identifier, targets:"all")
src-tauri/Cargo.toml
.github/workflows/build.yml   # CI: installers on push to main (see below)
docs/                    # plan.md, ux-design.md, reference.md, user-guide.md, acceptable-use.md
```

## Milestone status (as of `dev` @ 02b06db, version 0.1.0)

M0, M1, M2, M3, M4, M5 have all landed on `dev` (see `git log`). Note the
`README.md` status table still lists M4/M5 as "Planned" — that table is stale
relative to `dev`; trust `git log` and `docs/plan.md`. Good first task: reconcile
the README status table with what's actually shipped.

Likely remaining work: finish/polish M5 (settings, first-run ToS, native menus,
accessibility, **code signing**, auto-update), and any M4 JS-render edge cases.

## Build & run

Prereqs: [Node.js](https://nodejs.org) (npm) + [Rust](https://rustup.rs), plus
per-OS Tauri deps — Xcode CLT (macOS); `webkit2gtk-4.1` / `libssl` /
`build-essential` / `libgtk-3-dev` (Linux); MSVC + WebView2 (Windows).

Toolchain reference: CI uses **Node 20**; `Cargo.toml` sets `rust-version =
1.77.2` (use current stable). This source machine has Node v23.

```bash
npm install

# Desktop app (real sign-in + real scraping):
npm run tauri dev

# Browser-only UI preview (no keychain, no scraping — click-through only):
npm run dev        # http://localhost:1420

# Production build / local installers:
npm run tauri build
```

Sign in with an InterlinedList account **email + password**. Sign-in and scraping
only work in the desktop app, not the browser preview.

## CI / installers — two channels (`.github/workflows/`)

All three OSes, both channels: **macOS** `.pkg` (universal `.app` wrapped via
`productbuild`) + `.dmg`; **Windows** `.msi` + NSIS `.exe`; **Linux** `.AppImage`
+ `.deb` + `.rpm`.

- **Dev channel — `build.yml`** (every push to `main`): **unsigned** installers to
  a rolling **`latest` prerelease** + per-run workflow artifacts. No auto-update.
  For testers grabbing the newest main build.
- **Stable channel — `release.yml`** (push a `vX.Y.Z` tag): **signed + notarized**
  installers as a per-version release, plus signed updater artifacts + `latest.json`.
  This is the channel the in-app updater reads (endpoint →
  `.../releases/latest/download/latest.json`, i.e. newest non-prerelease).

Everything signing-related is **gated on secrets**, so tag builds pass before any
cert exists (just less-signed). Secrets to add (repo → Settings → Secrets → Actions):

| Secret(s) | Enables |
|-----------|---------|
| `TAURI_SIGNING_PRIVATE_KEY` (+ `_PASSWORD`) | Auto-update (signed `latest.json`). Private key is at `~/.tauri/interlinedlist-offline-updater.key` on the source machine; pubkey already committed in `tauri.conf.json`. |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Sign + notarize macOS `.app`/`.dmg` |
| `APPLE_INSTALLER_CERTIFICATE` (+ `_PASSWORD`, `_IDENTITY`) | Sign the macOS `.pkg` |
| `WINDOWS_CERTIFICATE` (+ `_PASSWORD`) | Sign Windows `.msi`/`.exe` |

Activate auto-update:
```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/interlinedlist-offline-updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --body ""   # key has no password
```

**Cutting a stable release:** bump `version` in `package.json`,
`src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` (they must match — the tag
build fails otherwise), commit, then `git tag vX.Y.Z && git push origin vX.Y.Z`.
The updater only delivers versions **newer than what's installed**, so the bump is
what makes an update fire.

## Conventions

- Match surrounding style; frontend is framework-free vanilla TS on purpose.
- Brand values are centralized (`src/styles/brand.css`, `src/brand.ts`) for a
  one-edit swap when official assets land — don't hardcode brand colors/names
  elsewhere.
- Specialized subagents are defined in `.claude/agents/` (project-manager,
  engineer, ux-designer, documentation) — use them for their domains.

## First moves for the taker-over

1. `git clone … && git checkout dev`, then `npm install && npm run tauri dev` —
   verify it launches and you can sign in.
2. Skim `docs/plan.md` (§6 milestones); README status now matches reality.
3. If you own the repo, activate auto-update by setting the
   `TAURI_SIGNING_PRIVATE_KEY` secret (see "CI / installers" above), then confirm
   the next `main` build uploads `latest.json` to the `latest` release.
4. Remaining M5 items: **OS code signing** (Apple Developer ID + Windows cert →
   removes Gatekeeper/SmartScreen warnings) and **per-version release tagging** so
   auto-update actually fires. These need certs/decisions from the human owner.
