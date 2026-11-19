# Local validation scope — Budget Capture Web 0.1.6.0

Публичные тесты используют только синтетические данные. Реальная пользовательская SQLite-база и файл персонального профиля находятся вне каталога проекта и не должны попадать в Git, ZIP, Pages `dist` или CI artifacts.

Реальная база проверяется приватно: сверка имён категорий и групп с legacy runtime, миграция в копию, проверка `PRAGMA integrity_check`, флагов Numbers, повторное открытие и отсутствие изменения исходника. Публикуемый проект содержит только универсальные defaults и алгоритмы миграции.

## Third-party parser hardening

- SheetJS CE upgraded to official 0.20.3 tarball from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`; the npm registry package remains stale at 0.18.5. Runtime asset is vendored locally into Pages output.
- PDF.js upgraded to `pdfjs-dist@6.5.438`; the legacy ESM API/worker pair is vendored locally. The app passes `isEvalSupported: false` when opening untrusted PDFs.
- Build checks both declared dependency specs and installed package versions.
- Do not release before generated lockfile, `dist` validation, Chromium E2E, and real Safari/iPhone smoke test are completed.
