# Test report — актуальное состояние на 24 ноября 2026

**Текущий publishing path:** GitHub Pages → Deploy from a branch → `main` → `/(root)` (описан в checkpoint; фактический source mode GitHub Pages из этого подключения не подтверждён). GitHub Actions намеренно отсутствуют.

## UI polish и исправления — 24 ноября 2026

- Главный экран заменён на действие-ориентированный **Обзор**: расходы/поступления, чистый денежный поток, сравнение с предыдущим сопоставимым периодом, дневная динамика, изменения расходных категорий, незавершённые операции и последние транзакции.
- Исправлено сравнение валют: валюта выбирается по финансовым операциям обеих частей сравнения; собственные переводы и технические строки типа `review` не создают ложную неоднозначность.
- Границы месячных выборок переведены на исключительную дату следующего дня, чтобы операции с временем в последний день месяца не выпадали.
- Последние операции фильтруются той же валютой, что и обзор; для пустого месяца есть отдельное состояние графика.
- Фильтр «Не распределено» теперь охватывает и пустые значения категории; кнопка обзора ведёт в соответствующий список.
- Добавлены видимые состояния фокуса с клавиатуры, доступная подпись графика и поддержка `prefers-reduced-motion`.
- Добавлены regression assertions и Chromium E2E-проверки обзора и перехода к нераспределённым операциям.
- Обновлён корневой `asset-manifest.json`; SHA-256 и размеры трёх изменённых production-файлов (`index.html`, `app.js`, `styles.css`) повторно рассчитаны и совпадают с manifest.

## Mobile version — 24 November 2026

- Dedicated mobile layout at 700px and a tighter 380px breakpoint.
- Fixed six-item thumb navigation with compact Russian labels, translucent background and safe-area padding.
- Database state and actions reflow into a compact header; forms use larger touch targets and 16px inputs to avoid iOS auto-zoom.
- Overview cards, charts, review filters, import controls, account forms and profile editor are tuned for narrow screens.
- Transaction history remains horizontally scrollable with sticky date/selection columns and touch momentum; lower-priority data is not silently removed.
- Toast notifications and footer are repositioned above the bottom navigation.
- Added source-contract assertions and a mobile viewport scenario to Playwright E2E. Browser execution still requires local `npm run test:e2e`.

## Проверки, фактически выполненные в этой сессии

| Проверка | Результат | Объём |
|---|---|---|
| JS/MJS syntax parsing | PASS | `app.js`, `core.js`, `profile.js`, `tests/app_contract.mjs`, `tests/e2e.mjs` |
| DOM contract | PASS | 138 уникальных ID, 0 дубликатов, 0 отсутствующих ID-селекторов |
| Navigation / panels | PASS | все 6 пунктов навигации соответствуют секциям; ровно одна активная секция |
| Overview regression source checks | PASS | валюта, границы дат, пустые категории, выбранная валюта в последних операциях |
| Production manifest entries | PASS | SHA-256 и байты совпадают для изменённых `index.html`, `app.js`, `styles.css` |
| Mobile CSS structure | PASS | сбалансированные скобки, safe-area, touch nav, 700px/380px breakpoints |
| Mobile Playwright scenario | ADDED / NOT RUN | проверяет фиксированную навигацию и компактную подпись на 390px |
| Runtime metadata | PASS | версии манифестов совпадают с приложением; основные SQL.js/SheetJS-файлы присутствуют |
| `npm test` / `npm run test:e2e` | NOT RUN | нет локального checkout и доступного Node/Playwright прогона в этой сессии |
| GitHub CI status | NOT RUN | Actions удалены из проекта; API не вернул status checks |
| Public browser smoke test | NOT RUN | открытая production-страница не проверялась |

**Не считать полный npm/Chromium прогон пройденным.** Синтаксическая и DOM-проверки — это не замена запуску приложения в браузере. Ближайшая локальная проверка на машине проекта: `npm test`, затем `npm run test:e2e`, `npm run build:pages` и `npm run test:dist`.


---
# Test report — Budget Capture Web 0.1.6.0
---
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


---

## Direct Pages + vendor fallback update — 21 November 2026

- Publishing remains direct: GitHub Pages `main/(root)`; no Actions workflows.
- The previous successful artifact was independently revalidated: 218/218 assets matched their recorded byte sizes and SHA-256 values.
- A separate vendor-only ZIP has been created and CRC/SHA-256 verified: 212/212 vendor files, package versions sql.js 1.16.0 / PDF.js 6.5.438 / SheetJS 0.20.3. No financial data files are included.
- `scripts/build-pages.mjs` now supports a verified root-vendor fallback when `node_modules` is absent; it checks exact versions, file list, sizes and SHA-256.
- Builder produces `vendor/runtime-manifest.json` and the Pages manifest includes it.
- `scripts/publish-root.mjs` now enforces the exact manifest allow-list: extra or missing output files stop publication.
- Contract tests were expanded for vendor-only fallback and exact manifest allow-list.
- These are source-level changes only. Current local source tests/build/dist/browser E2E have **not** been run after the changes. Do not report PASS.
- The ZIP is attached to the development conversation but not yet extracted or committed to `main`. GitHub Pages settings and public browser tests remain unconfirmed.

Recommended next local verification without npm registry access: install the vendor ZIP, run `npm test`, `npm run publish:root`, `npm run test:dist`, inspect `git status --short`. Run `npm run test:e2e` only on a machine with Playwright installed.
