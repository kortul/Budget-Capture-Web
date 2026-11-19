# Security dependency review — 19 ноября 2026

## Result

The 0.1.6.0 dependency set must not be released unchanged. The XLSX and PDF parsers consume user-supplied bank documents, so known parser vulnerabilities matter even in a local-first app.

## XLSX / SheetJS

- Previous pin: npm `xlsx@0.18.5`.
- Security issue references: CVE-2023-30533 (prototype pollution) and CVE-2024-22363 (regular-expression denial of service).
- The npm registry's `xlsx` package is stale. SheetJS documentation identifies its CDN as the authoritative distribution and documents the 0.20.3 tarball.
- New pin: `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.
- Build output vendors `dist/xlsx.full.min.js` into the same-origin Pages runtime; there is no runtime CDN request. The browser E2E asserts the loaded global is exactly 0.20.3.

## PDF.js

- Previous pin: `pdfjs-dist@3.11.174`.
- The old version is below the 4.2.67 fix level for the `font_loader.js` arbitrary code injection issue when eval support is enabled.
- New pin: `pdfjs-dist@6.5.438`, using the legacy ESM API and worker pair.
- Every PDF open passes `isEvalSupported: false` as defense in depth. API and worker must always be from the exact same package version. The E2E asserts API version 6.5.438 and extracts text using its local worker.

## Validation still required

- Install all dependencies in a network-enabled environment.
- Generate and commit `package-lock.json` with package tarball integrity metadata.
- Run source tests, production Pages build, SHA-256 dist contract and Chromium E2E.
- Confirm no external runtime requests.
- Check supported Safari version: PDF.js legacy builds currently list Safari 18+ as mostly supported; a real iPhone Safari test is still required.
- Do not promote this source checkpoint to 0.1.7.0 or publish until those steps pass.

## References

- SheetJS standalone scripts and current official browser bundle: https://docs.sheetjs.com/docs/getting-started/installation/standalone/
- SheetJS NodeJS tarball installation and note on stale npm registry package: https://docs.sheetjs.com/docs/getting-started/installation/nodejs/
- PDF.js npm package release information: https://www.npmjs.com/package/pdfjs-dist
- PDF.js supported browser matrix and legacy build: https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions
- Snyk advisory summary for xlsx 0.18.5: https://security.snyk.io/package/npm/xlsx/0.18.5
- Snyk advisory summary for pdfjs-dist 3.11.174: https://security.snyk.io/package/npm/pdfjs-dist/3.11.174


## Актуализация зависимостей — 19.11.2026

- `sql.js` обновлён до 1.16.0 (10.11.2026; SQLite 3.54.1). Предыдущий pin 1.13.0 был выпущен в марте 2025 и больше не является свежим. В проверенной базе Snyk для 1.16.0 прямые уязвимости не указаны; это не заменяет полный аудит транзитивных компонентов после получения lockfile.
- Источник: официальный [sql.js release notes](https://github.com/sql-js/sql.js/releases) и npm version history.
- Для сохранения прежнего поведения `sql.js` при инициализации явно включён `useOldExtensionFunctions: true`.
- Текущие проверенные pins: `sql.js@1.16.0`, `pdfjs-dist@6.5.438`, SheetJS CE `xlsx@0.20.3` с официального CDN tarball, `playwright@1.65.1`.
- Стабильный `playwright@1.65.1` выбран вместо `1.66.0-alpha`; prerelease не включается в production lock.
