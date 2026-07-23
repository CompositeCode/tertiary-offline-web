# Packaging & Signing — inputs the human must supply (M5, Q10 / NFR-XPLAT-1)

The bundle and updater config in `tauri.conf.json` is wired for macOS, Windows,
and Linux. The updater **public key and endpoint are real committed values**
(see §1). What still needs private material you must supply out of band is
**code-signing** (the `null` `signingIdentity` / `certificateThumbprint`) and the
**updater private key** — none of which we invent here.

`tauri build` was intentionally NOT run by engineering — the orchestrator/human
runs it (or CI does, via `.github/workflows/release.yml`).

## 1. Updater signing key (Q10) — REQUIRED for auto-update to work

`plugins.updater.pubkey` and `plugins.updater.endpoints[0]` are **already real,
committed values** — not placeholders. The pubkey is a valid minisign public key
and the endpoint points at
`https://github.com/CompositeCode/tertiary-offline-web/releases/latest/download/latest.json`.
**Do not regenerate the key** — doing so breaks auto-update for every already-installed
client (they verify updates against the committed pubkey). The `{{target}}`/`{{arch}}`/
`{{current_version}}` template vars in the endpoint are filled by the client.

What's still missing is the matching **private** key, used only at build time to
sign updater artifacts. Set it as a CI secret / build env:
   - `TAURI_SIGNING_PRIVATE_KEY` (the private key file contents or path)
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

`bundle.createUpdaterArtifacts` is `false` in the committed config, but CI's
`ci.overlay.json` flips it to `true` when the private key is present, so the build
emits the signed `.sig` + archive the endpoint serves. (Only regenerate the
keypair if you are intentionally starting a fresh update lineage; then paste the
new **public** key into `plugins.updater.pubkey`.)

## 2. macOS signing + notarization

In `bundle.macOS`:
- `signingIdentity`: set to your `Developer ID Application: <Name> (TEAMID)`
  certificate (installed in the login keychain). Currently `null` → unsigned
  local build only.
- Notarization credentials via env at build time (either set):
  - `APPLE_ID`, `APPLE_PASSWORD` (app-specific password), `APPLE_TEAM_ID`, **or**
  - `APPLE_API_KEY`, `APPLE_API_ISSUER`, `APPLE_API_KEY_PATH`.
- If you use hardened runtime entitlements, point `entitlements` at a plist.

## 3. Windows signing

In `bundle.windows`:
- `certificateThumbprint`: SHA-1 thumbprint of your installed code-signing cert
  (currently `null` → unsigned). Alternatively configure `signCommand` to sign
  via Azure Trusted Signing / an HSM.
- `digestAlgorithm` (`sha256`) and `timestampUrl` are safe defaults.

## 4. Linux

`.deb` / `.AppImage` / `.rpm` are produced from `targets: "all"`. Linux packages
aren't code-signed the same way; if you distribute via a repo, sign the repo
metadata out of band. No secrets needed here for a basic build.

## Summary of what still needs private material

The updater `pubkey` and `endpoints[0]` are **real committed values** — nothing to
do there. What remains is signing material supplied at build time (as CI secrets):

| Field | File | Action |
|-------|------|--------|
| `bundle.macOS.signingIdentity` | tauri.conf.json | set to Developer ID cert (+ notarization env). CI injects this from secrets; leave `null` in the committed config. |
| `bundle.windows.certificateThumbprint` | tauri.conf.json | set to signing cert thumbprint. CI injects it via `ci.overlay.json`; leave `null` in the committed config. |
| `TAURI_SIGNING_PRIVATE_KEY` (+ password) | build env | export for signed updater artifacts (matches the committed pubkey) |

See `start-from-here.md` at the repo root ("Shipping signed installers") for the
end-to-end "obtain certs → set secrets → tag & push" procedure.
