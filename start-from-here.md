# Start from here — dev handoff

You (another Claude instance, on a different machine) are taking over development
of **Offline Web** — a free cross-platform desktop app (Tauri v2) that
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

## Milestone status (as of `dev` @ 7c7bc52, version 0.1.0)

M0–M5 have all landed on `dev`/`main` (see `git log`). Since the original
handoff, two more commits shipped: the **rename to "Offline Web"** and an
**Appearance → Theme** control (system/light/dark, synced to the InterlinedList
account — see `src/theme.ts`).

**Docs are reconciled with reality** (done 2026-07-20): the README status table
is current (M4 "Shipped", M5 "Mostly shipped"); the theme feature is now
documented in `README.md`, `docs/user-guide.md` (§2), and the `docs/reference.md`
v1 release notes. No stale "InterlinedList Offline" name references remain.

**Builds verified green locally** (2026-07-20, this machine — Node v23, Rust
1.97 / cargo 1.85 pin): `npm run build` (tsc + vite) and `cargo build` in
`src-tauri/` both compile clean. `npm install` reports 2 npm audit findings
(1 moderate, 1 high) in dev deps — worth a look but not blocking.

The remaining work is **release hardening**, not features — see next section.

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

## What to work on next (prioritized)

The app is feature-complete at 0.1.0; what's left is shipping it. Roughly in order:

1. **Confirm CI is green on GitHub.** Repo:
   <https://github.com/CompositeCode/tertiary-offline-web> · Actions:
   <https://github.com/CompositeCode/tertiary-offline-web/actions>. Check the
   latest `build.yml` run on `main` built installers for all three OSes.
   (Local builds pass; CI hasn't been eyeballed this session — `gh` was
   unauthenticated. Run `gh auth login` first, then `gh run list`.)
2. **Activate auto-update** — set the `TAURI_SIGNING_PRIVATE_KEY` secret (see
   "CI / installers" above; key is at
   `~/.tauri/interlinedlist-offline-updater.key` on the source machine), then
   confirm the next tagged build uploads a signed `latest.json`.
3. **Cut the first stable release** — bump nothing (already 0.1.0) or bump to
   0.1.1, then `git tag v0.1.0 && git push origin v0.1.0` so `release.yml` runs
   and the updater has a baseline to deliver.
4. **OS code signing** (needs the human owner's certs/$): Apple Developer ID +
   notarization and a Windows signing cert → removes Gatekeeper/SmartScreen
   warnings. Everything is wired and gated on secrets; see `src-tauri/PACKAGING.md`.
5. **Capture the README screenshots** (there's a placeholder at the top of
   `README.md`): sign-in, New scrape, live Progress, Results.

### Smaller cleanups / known gaps (nice-to-have, not blocking)

- `package.json` `"name"` is still `interlinedlist-offline` (internal npm name;
  `productName` is correctly "Offline Web"). Harmless, but rename for consistency.
- `npm audit` flags 2 dev-dep advisories (1 moderate, 1 high) — triage them.
- **Free-space warning is dormant** — available space reports `0`, so the
  low-space pre-Start warning never fires (a real mid-job out-of-space auto-pause
  still works). Needs a small platform FFI; see `docs/reference.md` known-limits.
- M4 whole-site rendering spawns a fresh headless browser per page (slow) — a
  shared long-lived browser would speed it up.
