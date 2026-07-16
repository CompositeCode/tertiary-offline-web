# Packaging & Signing — inputs the human must supply (M5, Q10 / NFR-XPLAT-1)

The bundle and updater config in `tauri.conf.json` is wired for macOS, Windows,
and Linux, but real code-signing and update-signing need private material we do
**not** invent. Everything below is a **placeholder / null** in the committed
config; supply the real values before a production release build.

`tauri build` was intentionally NOT run by engineering — the orchestrator/human
runs it.

## 1. Updater signing key (Q10) — REQUIRED for auto-update to work

`plugins.updater.pubkey` is currently the literal string
`PLACEHOLDER_REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY`, which is **not** a valid
key — the client will (correctly) reject every update until it's replaced.

1. Generate a keypair:  `npm run tauri signer generate -- -w ~/.tauri/il-offline.key`
2. Paste the printed **public** key into `plugins.updater.pubkey`.
3. Keep the **private** key secret. At build time set:
   - `TAURI_SIGNING_PRIVATE_KEY` (the private key file contents or path)
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
4. Replace `plugins.updater.endpoints[0]` with a real HTTPS URL that serves the
   Tauri updater manifest (`latest.json`-style). The `{{target}}`/`{{arch}}`/
   `{{current_version}}` template vars are filled by the client.

`bundle.createUpdaterArtifacts` is `true` so the build emits the signed
`.sig` + archive the endpoint must serve.

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

## Summary of what is still a placeholder

| Field | File | Action |
|-------|------|--------|
| `plugins.updater.pubkey` | tauri.conf.json | replace with generated public key |
| `plugins.updater.endpoints[0]` | tauri.conf.json | replace with real HTTPS manifest URL |
| `bundle.macOS.signingIdentity` | tauri.conf.json | set to Developer ID cert (+ notarization env) |
| `bundle.windows.certificateThumbprint` | tauri.conf.json | set to signing cert thumbprint |
| `TAURI_SIGNING_PRIVATE_KEY` (+ password) | build env | export for signed updater artifacts |
