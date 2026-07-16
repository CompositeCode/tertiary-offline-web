# InterlinedList Offline

**InterlinedList Offline** is a free, cross-platform desktop app that mirrors a
web page to a local folder so you can read it offline. It is **free — no
subscription** — but requires signing in with an **InterlinedList** account to
unlock scraping.

This repository is the **M0 walking skeleton**: it proves the spine end to end —
launch → InterlinedList-branded login gate → New scrape (enter a URL) →
single-page static capture written to disk → Results with **Open in browser**.

## Tech stack

- **Tauri v2** desktop shell (Rust backend + native webview).
- **Vite + vanilla TypeScript** frontend — no UI framework, minimal deps.
- Rust scraping: `reqwest` (rustls, blocking) + `scraper` + `url`.

## Running it

Prereqs: **Node** (npm) and, for the desktop app, the **Rust toolchain**
(`rustup`, plus platform build deps that Tauri requires — Xcode CLT on macOS,
`webkit2gtk`/`libssl`/`build-essential` on Linux, MSVC + WebView2 on Windows).

```bash
npm install

# Desktop app (full functionality — real scraping):
npm run tauri dev

# Browser-only preview of the UI (no native scraping):
npm run dev        # serves the UI at http://localhost:1420
```

In **browser preview** the login flow and screens are fully navigable (mock
auth), but the **Start scrape** button is disabled with the note
"Runs in the desktop app." — real scraping needs the Tauri backend.

To build the frontend bundle on its own:

```bash
npm run build      # tsc typecheck + vite build -> dist/
```

## Signing in (M0)

Any **non-empty** username and password succeed and yield a mock token.
Empty fields show *"Enter your username and password."*; the backend rejects
blank credentials with *"Incorrect username or password."*

## Branding

All brand values are placeholders and centralized for easy swap:

- `src/styles/brand.css` — colors, radius, fonts (CSS custom properties).
- `src/brand.ts` — product name, wordmark, and inline SVG logo.

Both are marked `PLACEHOLDER — replace with official InterlinedList assets`.

## M0 limitations (by design)

- **Mock auth.** No real InterlinedList API call yet. The session **token lives
  in memory only** — it is never written to disk. The real target is the
  interlinedlist.com auth API with the token stored in the **OS keychain**
  (see the `TODO(M0->real)` markers in `src/auth.ts` and `src-tauri/src/lib.rs`).
- **Single page only.** "This page only" is locked; "Whole site" is shown
  disabled ("coming soon"). Whole-site crawl, depth/scope, robots, and rate
  limiting arrive in M1.
- **Same-origin assets only.** Captures `img[src]`, `link[rel=stylesheet]`, and
  `script[src]` from the same host, best-effort (failures are counted, not
  fatal), and rewrites those references to local `assets/…` paths.
- **Save location is fixed** to `~/InterlinedList Offline/<host>/` (read-only in
  the UI for M0).

## Output layout

```
~/InterlinedList Offline/<host>/
  index.html          # rewritten page, opens offline
  assets/             # downloaded same-origin images/CSS/JS
```

## Project layout

```
index.html              # Vite entry
src/                    # frontend (vanilla TS)
  main.ts               # router / entry
  auth.ts               # in-memory mock auth state
  tauri.ts              # Tauri bridge (degrades gracefully in a browser)
  brand.ts              # PLACEHOLDER brand name/wordmark/logo
  store.ts, format.ts, dom.ts
  screens/              # signin, shell, library, newscrape, results
  styles/               # brand.css (tokens) + app.css
src-tauri/              # Tauri v2 Rust backend
  src/lib.rs            # commands: mock_login, scrape_page, open_path
  src/scrape.rs         # single-page static scrape engine
  tauri.conf.json, Cargo.toml, build.rs
  capabilities/         # opener plugin permissions
  icons/                # app icons (placeholder InterlinedList mark)
```
