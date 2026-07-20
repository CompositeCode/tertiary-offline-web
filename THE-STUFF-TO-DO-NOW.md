# THE STUFF TO DO NOW — shipping signed `.pkg` + `.msi`

Complete, repo-specific procedure for getting **Offline Web** shipped as a signed
macOS `.pkg` and a signed Windows `.msi`.

Two things that differ from the older docs, confirmed against the actual pipeline:

- The updater **pubkey and endpoint are already real** in `tauri.conf.json`
  (not placeholders — `src-tauri/PACKAGING.md` is stale on that point).
- **Tauri has no native `.pkg` target.** `bundle.targets: "all"` gives you
  `.app` + `.dmg` on macOS and `.msi` + `.exe` on Windows. The `.pkg` is produced
  by a **custom `productbuild` step in `release.yml`** — so it only exists via the
  CI release path (or if you run `productbuild` by hand).

---

## How shipping works here

Everything is driven by **pushing a `vX.Y.Z` git tag**, which triggers
`.github/workflows/release.yml`. That workflow builds on macOS + Windows + Linux
runners, signs whatever it has secrets for, and publishes a per-version GitHub
Release with the installers attached. Signing is **independently gated per
secret** — a tag build succeeds even with zero secrets, it just produces
*unsigned* artifacts. So "getting it shipped as a signed `.pkg` + `.msi`" =
**obtain 2 certs → add them as GitHub secrets → tag & push.**

---

## Part 0 — One-time: obtain the certificates

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

---

## Part 1 — macOS `.pkg`: export certs → set secrets

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
`.app`/`.dmg`, then the custom step (lines 197–230) runs `productbuild` to wrap
the `.app` into a `.pkg` and `productsign`s it with your Installer identity, and
uploads it to the release.

> ⚠️ **Gap to be aware of:** that step signs the `.pkg` but does **not notarize
> the `.pkg` itself** (it relies on the inner `.app` being notarized). A `.pkg`
> downloaded via a browser can still get a Gatekeeper prompt because it isn't
> stapled. To ship a truly clean installer, the step should also run
> `xcrun notarytool submit "$out" --wait` + `xcrun stapler staple "$out"`.

---

## Part 2 — Windows `.msi`: export cert → set secrets

**2a. Export the code-signing cert as a `.pfx`** (with a password) — from the CA
portal or `certmgr.msc → Export → include private key`.

**2b. Set the secrets:**

```bash
gh secret set WINDOWS_CERTIFICATE < <(base64 -i codesign.pfx)
gh secret set WINDOWS_CERTIFICATE_PASSWORD --body 'pfx-password'
```

**What CI does** (lines 130–167): the Windows runner imports the PFX, reads its
thumbprint, and merges `{ bundle.windows.certificateThumbprint }` into a
`ci.overlay.json` passed to `tauri build` — so `bundle.windows.certificateThumbprint`
stays `null` in the committed config and is injected only at build time.
`targets: "all"` builds both the WiX **`.msi`** and the NSIS `.exe`, both signed,
with SHA-256 + the DigiCert timestamp URL already configured.

---

## Part 3 — (Recommended) enable auto-update signing

Not required to produce installers, but without it the shipped app can't
self-update. The **pubkey and endpoint are already committed** — you only need
the private key:

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/interlinedlist-offline-updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --body ''   # key has no password
```

This makes CI attach signed updater artifacts + `latest.json` to the release (the
endpoint already points at `releases/latest/download/latest.json`).

---

## Part 4 — Ship it: tag & push

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

---

## Part 5 — Local build alternative (no CI)

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

---

## Housekeeping items noticed while writing this

1. **`src-tauri/PACKAGING.md` is stale** — it still calls the updater `pubkey` and
   `endpoints[0]` "placeholders," but both are now real committed values. Worth
   correcting so a future maintainer doesn't regenerate the key and break existing
   installs.
2. The **`.pkg` notarization gap** in Part 1 — `release.yml` signs the `.pkg` but
   doesn't notarize + staple it.

### GitHub secrets checklist (all set via `gh secret set …`)

| Secret | Enables |
|---|---|
| `APPLE_CERTIFICATE` (+ `_PASSWORD`) | sign the `.app`/`.dmg` |
| `APPLE_SIGNING_IDENTITY` | Developer ID Application identity string |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | notarization |
| `APPLE_INSTALLER_CERTIFICATE` (+ `_PASSWORD`, `_IDENTITY`) | sign the `.pkg` |
| `WINDOWS_CERTIFICATE` (+ `_PASSWORD`) | sign the `.msi`/`.exe` |
| `TAURI_SIGNING_PRIVATE_KEY` (+ `_PASSWORD`) | signed auto-update artifacts |
