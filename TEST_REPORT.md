# Test report — Budget Capture Web 0.1.6.0

**Обновлено:** 20 ноября 2026.

## Текущий source verification на архиве `Budget-Capture-Web-main.zip`

| Check | Result | Evidence |
|---|---|---|
| `npm test` | PASS | 9/9 suites на Node `v22.16.0`, npm `10.9.2` |
| `npm run verify:lock` | PASS | 17 package entries; exact pins, HTTPS allowlist, SHA-512 integrity |
| JS/MJS syntax | PASS | все `.js` и `.mjs` исходники/тесты |
| Workflow YAML parse | PASS | `pages.yml`, `prepare-lockfile.yml` |

## GitHub-hosted CI and production artifact

Пользователь сообщил об успешном GitHub Actions запуске `Validate and optionally deploy Budget Capture Web`, job `Build and test (no publication)`, 48 секунд. По его сообщению все шаги job завершились успешно. Artifact: `budget-capture-dist-1f6ae9bd61194964c93e323d0a52045eb68a1d35.zip`.

Artifact независимо проверен в рабочем контейнере:

| Check | Result | Evidence |
|---|---|---|
| ZIP integrity | PASS | архив читается полностью |
| `npm run test:dist` | PASS | 218 manifest assets |
| SHA-256 manifest | PASS | 218/218 files match |
| File sizes | PASS | все размеры совпали с manifest |
| Main source → dist | PASS | 7 основных runtime files byte-identical |
| Runtime package versions | PASS | sql.js 1.16.0, pdfjs-dist 6.5.438, xlsx 0.20.3 |
| Third-party runtime CDN strings | PASS | не обнаружены в runtime entry files |
| Personal database/statements | PASS | `.budget`, SQLite, PDF/XLSX/CSV backups не найдены |

Artifact totals: 219 files including `asset-manifest.json`; 8,799,044 unpacked bytes.

## E2E duplicate-import hardening — pending hosted rerun

В исходном `tests/e2e.mjs` повторный импорт ждал видимость `#import-result`, но не убеждался, что текст результата изменился по сравнению с первым импортом. Такая проверка недостаточно надёжна против stale UI output. Тест обновлён: ждёт нового текста, извлекает счётчики из пар `.result-cell` (значение + label) и проверяет `Imported = 0`, `Duplicates skipped = 1`, `Extracted = 1`. Добавлен source-contract assertion.

Локально после этой корректировки повторно пройдут `npm test`, `verify:lock`, syntax checks и `test:dist`. Полный Chromium E2E локально в контейнере не запускается, так как `node_modules` отсутствует; свежий hosted run после commit остаётся обязательным.

## Остальные открытые проверки

- Ручной Open → Import → Review → Save → Reopen на копии пользовательской Windows SQLite-базы в браузере.
- Safari/iPhone file-open/save flow на реальном устройстве.
- GitHub Pages publication: **не запускалась** и не входит в текущую проверку.

Не повышать версию до 0.1.7.0 и не публиковать до закрытия оставшихся release gates.
