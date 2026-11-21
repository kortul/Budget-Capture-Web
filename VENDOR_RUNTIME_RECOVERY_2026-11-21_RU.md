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

## After vendor recovery

Run the standard local checks and build:

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

`npm run publish:root` rebuilds using the pinned installed package versions and refreshes the production files in the root. Review changes before commit. Do not add `dist/`, `.budget`, SQLite databases, bank statements, backups, or personal JSON.

Commit the runtime/root updates and push `main`. With Settings → Pages configured as `Deploy from a branch → main → /(root)`, GitHub Pages will publish without Actions.

## Important

The historical artifact proves the vendor bundle's byte integrity; it does **not** prove the current application pages or new Numbers import E2E tests. Those must still pass on the current source after restoring vendor and running the local test commands.

