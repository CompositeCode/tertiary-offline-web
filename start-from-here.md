# Start from here — dev handoff

You (another Claude instance, on a different machine) are taking over development
of **InterlinedList Offline** — a free cross-platform desktop app (Tauri v2) that
mirrors a web page or a whole website to a local folder for offline reading.
Sign-in with an InterlinedList account gates the scraping features.

Read this file first, then `README.md`, then `docs/plan.md`.

---

## ⚠️ READ THIS FIRST — the real code is NOT on the remote yet

The GitHub remote is **stale**. As of this handoff:

| Ref | Commit | Contains |
|-----|--------|----------|
| `origin/main` (what a fresh `git clone` gives you) | `646a713` | **Only M0 + M1.** No M2–M5, no docs beyond early ones, **no CI.** |
| local `main` (this machine) | `0166348` | Diverged from origin — see below |
| local **`dev`** (this machine, current branch) | `02b06db` | **Everything real: M2, M3, M4, M5, full docs, official branding/icons, CI workflow, version `0.1.0`.** 9 commits ahead of local `main`. **Never pushed.** |

**If you just cloned the repo, you have almost none of the actual app.** Before
you do anything, make sure you have the `dev` branch content. One of these must
happen:

1. **Preferred:** on *this* (source) machine, push `dev` to the remote:
   ```bash
   git push -u origin dev
   # and reconcile main if desired:
   git push origin main
   ```
   Then on your machine: `git fetch && git checkout dev`.

2. **If you can't push:** get the `dev` branch to your machine by bundle/patch
   (`git bundle create offline-web.bundle --all`) or a direct copy of the working
   tree. Do **not** start building on top of `origin/main` — you'd be redoing
   M2–M5.

Remote: `git@github.com:CompositeCode/tertiary-offline-web.git`

Confirm you're on the right base before coding:
```bash
git log --oneline -1        # expect 02b06db (or later): "Cleanup: version 0.1.0 consistency …"
git branch --show-current   # expect: dev
```

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

## CI / installers (`.github/workflows/build.yml`)

On every push to `main` (and via manual "Run workflow"), CI builds installers for
all three OSes and publishes them:

- **macOS** → `.pkg` (wrapped from the universal `.app` via `productbuild`) + `.dmg`
- **Windows** → `.msi` + NSIS `.exe`
- **Linux** → `.AppImage` + `.deb` + `.rpm`

Delivered two ways: as per-run **workflow artifacts**, and as a rolling **`latest`
prerelease** (recreated each push) for a stable download URL. Installers are
currently **unsigned** — the workflow's trailing comment block lists exactly which
repo secrets to add for macOS/Windows signing.

Caveat: the workflow triggers on `main`. Since real work is on `dev`, either
merge `dev → main` before expecting CI to build the current app, or update the
trigger branch. (This is a natural follow-up once `dev` is pushed.)

## Conventions

- Match surrounding style; frontend is framework-free vanilla TS on purpose.
- Brand values are centralized (`src/styles/brand.css`, `src/brand.ts`) for a
  one-edit swap when official assets land — don't hardcode brand colors/names
  elsewhere.
- Specialized subagents are defined in `.claude/agents/` (project-manager,
  engineer, ux-designer, documentation) — use them for their domains.

## First moves for the taker-over

1. Confirm you're on `dev` @ `13a70ce` or later (see warning above). If not, get
   the `dev` content before anything else.
2. `npm install && npm run tauri dev` — verify it launches and you can sign in.
3. Skim `docs/plan.md` (§6 milestones) and reconcile the stale README status table.
4. Merge `dev → main` (once pushed) so CI produces installers for the real app.
5. Pick up M5 polish — code signing + auto-update are the biggest open items.
