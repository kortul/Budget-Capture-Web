# Vendor runtime recovery — 21 November 2026

## Why this exists

Direct GitHub Pages publishing from `main/(root)` requires browser runtime files to exist in the repository root under `vendor/`. The current source tree deliberately tracks `vendor/` and does not use GitHub Actions.

The previous production artifact from commit `e88d35326f20c610100c7aef74c072f3b6d11a29` contains the runtime packages already used by this application. Its complete 218-asset `asset-manifest.json` was independently rechecked: all 218 files existed and all byte sizes and SHA-256 hashes matched.

## Exact package versions

- `sql.js`: `1.16.0`
- `pdfjs-dist`: `6.5.438`
- `xlsx` / SheetJS CE: `0.20.3`

The runtime bundle contains 211 files under `vendor/`: SQLite JS + WASM, PDF.js ESM + worker + CMaps + standard fonts + WASM decoders + ICC profiles, SheetJS, package version metadata, and license texts.

## Restore the vendor directory on Windows

1. Download the vendor runtime ZIP attached to the current Budget Capture development conversation.
2. Extract the ZIP. It contains `vendor/`, `vendor-files.sha256`, `Install-Vendor.ps1`, and this bundle's readme.
3. Run `Install-Vendor.ps1` from the extracted directory, passing the path to the local `Budget-Capture-Web` clone if it is not the current directory:

```powershell
.\Install-Vendor.ps1 -ProjectRoot 'C:\path\to\Budget-Capture-Web'
```

4. The script refuses to overwrite an existing `vendor/` unless `-ReplaceExistingVendor` is explicitly supplied. It verifies SHA-256 for all 211 copied files.
5. In the project, run `git status --short`. Confirm `vendor/` is visible as new/changed content and is not ignored.

Only copy `vendor/`. Do not replace `index.html`, `app.js`, `core.js`, `numbers-import.html`, `numbers-analytics.html`, or other application files with files from the older artifact.

## ## Build without npm registry access

The current `scripts/build-pages.mjs` supports the verified root `vendor/` folder as a runtime source. It checks `vendor/versions.json`, exact paths, file sizes and SHA-256 values in `vendor/runtime-manifest.json`. It then creates a new production build and fresh asset manifests.

After installing the ZIP bundle, you can build and validate the static site without downloading npm packages:

```powershell
npm test
npm run publish:root
npm run test:dist
git status --short
```

The app's source tests use Node built-ins. Chromium E2E additionally requires Playwright; only run/report E2E as passed on a machine where Playwright is installed and the browser test actually completes.

## Preferred build with npm registry access

When the network allows npm installs, the fully reproducible route remains:

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run verify:lock
npx playwright install chromium
npm test
npm run publish:root
npm run test:dist
npm run test:e2e
git status --short
```

