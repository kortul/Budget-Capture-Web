# Budget Capture Web 0.1.1

- Connected browser UI to the database and browser import core.
- Added strict SQLite integrity and Budget Capture schema validation before migration.
- Added migration dirty-state reporting; opening a Windows DB never writes the selected original file in place.
- Added save verification by reopening exported SQLite bytes and checking integrity and key table row counts.
- Added support for old Windows JSON backups, preserving soft-deleted rows and deletion/restore history.
- Preserved user-confirmed recognized-account owners during automatic card detection; manual account edits use an explicit upsert.
- Added T-Bank card defaults matching Windows behavior.
- Lazy-load pinned sql.js, SheetJS and PDF.js with secondary CDN fallbacks.
- Corrected visible app version to 0.1.1.
- Added migration, invalid-file rejection, JSON round-trip, SQLite save/reopen and DOM-contract tests.

At 0.1.1, real user database round-trip and Yandex PDF were not yet supported; Yandex payment-account and savings layouts were ported in later releases. Legacy Sber card PDFs, scanned/image-only OCR and local Ollama remain outside the current static web build. Current runtime no longer uses the historical CDN fallback. Safari/iPhone and hosted Chromium deployment checks remain pending.
