# Start from here — dev handoff

You (another Claude instance, on a different machine) are taking over development
of **Offline Web** — a free cross-platform desktop app (Tauri v2) that
mirrors a web page or a whole website to a local folder for offline reading.
Sign-in with an InterlinedList account gates the scraping features.

Read this file first, then `README.md`, then `docs/plan.md`.

The app is **feature-complete at `0.1.0`** — the remaining work is *shipping it*
(CI, signing, releasing). The end-to-end shipping procedure lives in
[**Shipping signed installers**](#shipping-signed-installers--the-full-procedure)
below (this used to be a separate `THE-STUFF-TO-DO-NOW.md`; it's been folded in).

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
src-tauri/PACKAGING.md        # signing inputs the human must supply
.github/workflows/build.yml   # CI: unsigned rolling prerelease on push to main
.github/workflows/release.yml # CI: signed per-version release on vX.Y.Z tag
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

The remaining work is **release hardening**, not features — see
[What to work on next](#what-to-work-on-next-prioritized).

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

## Conventions

- Match surrounding style; frontend is framework-free vanilla TS on purpose.
- Brand values are centralized (`src/styles/brand.css`, `src/brand.ts`) for a
  one-edit swap when official assets land — don't hardcode brand colors/names
  elsewhere.
- Specialized subagents are defined in `.claude/agents/` (project-manager,
  engineer, ux-designer, documentation) — use them for their domains.

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

Everything signing-related is **gated per secret**, so a tag build succeeds even
with zero secrets — it just produces *unsigned* artifacts. The full step-by-step
for going from nothing to a signed, notarized, auto-updating release is next.

---

## Shipping signed installers — the full procedure

Complete, repo-specific procedure for getting **Offline Web** shipped as a signed
macOS `.pkg` and a signed Windows `.msi`.

Two things worth knowing up front, confirmed against the actual pipeline:

- The updater **pubkey and endpoint are already real** in `tauri.conf.json`
  (not placeholders — `src-tauri/PACKAGING.md`'s summary reflects this now).
  **Do not regenerate the updater key** — it breaks auto-update for every
  already-installed client.
- **Tauri has no native `.pkg` target.** `bundle.targets: "all"` gives you
  `.app` + `.dmg` on macOS and `.msi` + `.exe` on Windows. The `.pkg` is produced
  by a **custom `productbuild` step in `release.yml`** — so it only exists via the
  CI release path (or if you run `productbuild` by hand, see Part 5).

### How shipping works here

Everything is driven by **pushing a `vX.Y.Z` git tag**, which triggers
`.github/workflows/release.yml`. That workflow builds on macOS + Windows + Linux
runners, signs whatever it has secrets for, and publishes a per-version GitHub
Release with the installers attached. Signing is **independently gated per
secret** — a tag build succeeds even with zero secrets, it just produces
*unsigned* artifacts. So "getting it shipped as a signed `.pkg` + `.msi`" =
**obtain 2 certs → add them as GitHub secrets → tag & push.**

### Part 0 — One-time: obtain the certificates

You cannot produce *distributable* (non-warned) installers without these. This is
the part that needs money/decisions and can't be automated.

**macOS `.pkg`** needs an **Apple Developer Program** membership ($99/yr) and
**two** certificates:

| Cert | Signs |
|---|---|
| **Developer ID Application** | the `.app` inside the pkg |
| **Developer ID Installer** | the `.pkg` wrapper itself |

Create both at [developer.apple.com → Certificates](https://developer.apple.com/account/resources/certificates),
download, and add to Keychain. Also create an **app-specific password**
(appleid.apple.com → Sign-In & Security) for notarization.

**Windows `.msi`** needs a **code-signing certificate** from a CA (DigiCert,
Sectigo, SSL.com, etc.):

- **OV** cert — cheaper, but Windows SmartScreen still warns until the download
  builds "reputation."
- **EV** cert — immediate SmartScreen reputation; traditionally ships on a
  hardware token (harder to put in CI). **Azure Trusted Signing** is the modern
  cloud alternative (the config supports a `signCommand` path if you go that route).

### Part 1 — macOS `.pkg`: export certs → set secrets

**1a. Export each cert as a `.p12`** from Keychain Access (right-click the cert →
Export, set a password). You'll have `DeveloperIDApplication.p12` and
`DeveloperIDInstaller.p12`.

**1b. Set the secrets** (base64-encode each `.p12`). From the repo dir with `gh`
authenticated:

```bash
# ---- App signing + notarization (signs the .app/.dmg) ----
gh secret set APPLE_CERTIFICATE < <(base64 -i DeveloperIDApplication.p12)
gh secret set APPLE_CERTIFICATE_PASSWORD --body 'p12-password'
gh secret set APPLE_SIGNING_IDENTITY --body 'Developer ID Application: Your Name (TEAMID)'
gh secret set APPLE_ID --body 'you@example.com'
gh secret set APPLE_PASSWORD --body 'app-specific-password'   # NOT your Apple ID password
gh secret set APPLE_TEAM_ID --body 'TEAMID'

# ---- Installer signing (signs the .pkg wrapper) ----
gh secret set APPLE_INSTALLER_CERTIFICATE < <(base64 -i DeveloperIDInstaller.p12)
gh secret set APPLE_INSTALLER_CERTIFICATE_PASSWORD --body 'installer-p12-password'
gh secret set APPLE_INSTALLER_IDENTITY --body 'Developer ID Installer: Your Name (TEAMID)'
```

Find the exact identity strings with `security find-identity -v` on the machine
that has the certs.

**What CI does with them** (already coded in `release.yml`): the matrix builds a
`universal-apple-darwin` `.app`, `tauri-action` signs + **notarizes** the
`.app`/`.dmg`, then the custom step runs `productbuild` to wrap the `.app` into a
`.pkg` and `productsign`s it with your Installer identity, and uploads it to the
release.

> ✅ **`.pkg` notarization is handled:** the step signs the `.pkg` **and** — when
> the `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` notarization secrets are
> present — runs `xcrun notarytool submit "$out" --wait` + `xcrun stapler staple
> "$out"`, so the wrapper is stapled and a browser download won't trip Gatekeeper.
> Without those secrets it still produces a signed-but-un-notarized `.pkg` and logs
> a warning. (This was previously a known gap; fixed in `release.yml`.)

### Part 2 — Windows `.msi`: export cert → set secrets

**2a. Export the code-signing cert as a `.pfx`** (with a password) — from the CA
portal or `certmgr.msc → Export → include private key`.

**2b. Set the secrets:**

```bash
gh secret set WINDOWS_CERTIFICATE < <(base64 -i codesign.pfx)
gh secret set WINDOWS_CERTIFICATE_PASSWORD --body 'pfx-password'
```

**What CI does:** the Windows runner imports the PFX, reads its thumbprint, and
merges `{ bundle.windows.certificateThumbprint }` into a `ci.overlay.json` passed
to `tauri build` — so `bundle.windows.certificateThumbprint` stays `null` in the
committed config and is injected only at build time. `targets: "all"` builds both
the WiX **`.msi`** and the NSIS `.exe`, both signed, with SHA-256 + the DigiCert
timestamp URL already configured.

### Part 3 — (Recommended) enable auto-update signing

Not required to produce installers, but without it the shipped app can't
self-update. The **pubkey and endpoint are already committed** — you only need
the private key:

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/interlinedlist-offline-updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --body ''   # key has no password
```

This makes CI attach signed updater artifacts + `latest.json` to the release (the
endpoint already points at `releases/latest/download/latest.json`). The private
key is at `~/.tauri/interlinedlist-offline-updater.key` on the source machine.

### Part 4 — Ship it: tag & push

**4a. Versions must match across three files or the `verify` job fails fast.**
They're currently all `0.1.0` (confirmed: `package.json`,
`src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`). For a real first release,
decide whether to keep `0.1.0` or bump:

```bash
# if bumping, edit all three to the SAME version, then commit
git add -A && git commit -m "Release v0.1.0"
```

**4b. Tag and push** (the tag drives everything):

```bash
git tag v0.1.0
git push origin v0.1.0
```

**4c. Monitor and collect** (needs `gh auth login` first):

```bash
gh run watch                      # follow the release run live
gh release view v0.1.0            # see the attached installers
```

The result is a GitHub Release named "Offline Web v0.1.0" with the signed
`Offline Web_0.1.0_universal.pkg`, `.msi`, `.dmg`, `.exe`, and Linux packages.
The updater only delivers versions **newer than what's installed**, so the version
bump is what makes an update fire.

### Part 5 — Local build alternative (no CI)

You can produce installers locally, but **each OS only builds its own** — you need
a Mac for the `.pkg` and a Windows machine for the `.msi` (no practical
cross-compilation of installers).

**macOS** (on this machine):

```bash
export PATH="$HOME/.cargo/bin:$PATH"
npm run tauri build -- --target universal-apple-darwin
# -> produces .app + .dmg. To get a .pkg you must run productbuild yourself:
APP="src-tauri/target/universal-apple-darwin/release/bundle/macos/Offline Web.app"
productbuild --component "$APP" /Applications "Offline Web_0.1.0.pkg"      # unsigned
# signed: add --sign "Developer ID Installer: Your Name (TEAMID)" via productsign
```

**Windows** (on a Windows box):

```powershell
npm run tauri build      # -> target\release\bundle\msi\*.msi  and  \nsis\*.exe
```

Unsigned locally unless you set `bundle.windows.certificateThumbprint` (or pass a
`--config` overlay like CI does).

### GitHub secrets checklist (all set via `gh secret set …`)

| Secret | Enables |
|---|---|
| `APPLE_CERTIFICATE` (+ `_PASSWORD`) | sign the `.app`/`.dmg` |
| `APPLE_SIGNING_IDENTITY` | Developer ID Application identity string |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | notarization (of the `.app`/`.dmg` **and** the `.pkg`) |
| `APPLE_INSTALLER_CERTIFICATE` (+ `_PASSWORD`, `_IDENTITY`) | sign the `.pkg` |
| `WINDOWS_CERTIFICATE` (+ `_PASSWORD`) | sign the `.msi`/`.exe` |
| `TAURI_SIGNING_PRIVATE_KEY` (+ `_PASSWORD`) | signed auto-update artifacts |

---

## What to work on next (prioritized)

The app is feature-complete at 0.1.0; what's left is shipping it. Roughly in order
(the deep how-to for the release steps is in
[Shipping signed installers](#shipping-signed-installers--the-full-procedure)):

1. **Confirm CI is green on GitHub.** Repo:
   <https://github.com/CompositeCode/tertiary-offline-web> · Actions:
   <https://github.com/CompositeCode/tertiary-offline-web/actions>. Check the
   latest `build.yml` run on `main` built installers for all three OSes.
   (Local builds pass; CI hasn't been eyeballed this session — `gh` was
   unauthenticated. Run `gh auth login` first, then `gh run list`.)
2. **Activate auto-update** — set `TAURI_SIGNING_PRIVATE_KEY` (Part 3), then
   confirm the next tagged build uploads a signed `latest.json`.
3. **Cut the first stable release** — keep `0.1.0` or bump, then
   `git tag v0.1.0 && git push origin v0.1.0` (Part 4) so `release.yml` runs and
   the updater has a baseline to deliver.
4. **OS code signing** (needs the human owner's certs/$): Apple Developer ID +
   notarization (Part 1) and a Windows signing cert (Part 2) → removes
   Gatekeeper/SmartScreen warnings. Everything is wired and gated on secrets.
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
