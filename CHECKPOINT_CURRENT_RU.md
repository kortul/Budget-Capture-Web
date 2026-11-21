<!-- CURRENT STATUS: DIRECT MAIN ROOT PUBLISHING -->
# Budget Capture Web — актуальная контрольная точка 0.1.6.0 · 21 ноября 2026

## Текущая архитектура публикации

**GitHub Pages: Deploy from a branch → main → /(root). GitHub Actions не используются.** Оба workflow удалены из `.github/workflows/`; в `npm test` нет теста, требующего этих workflow. Не восстанавливать Actions.

## Что изменено после перехода на прямую публикацию

- `scripts/build-pages.mjs` создаёт production `dist/` и включает `index.html`, `numbers-import.html`, `numbers-analytics.html`, приложение, стили, локальные runtime assets, PDF.js CMaps/fonts/WASM/ICC и лицензии. Build проверяет same-origin CSP и отсутствие CDN-ссылок на всех трёх HTML-страницах.
- `scripts/publish-root.mjs` копирует проверенный production build из `dist/` в корень репозитория. Перед копированием он проверяет manifest, версию приложения, SHA-256 и размеры всех assets, обязательные HTML-страницы и отсутствие финансовых файлов. Требует явный флаг `--publish`.
- `package.json` содержит `npm run publish:root`: build + safe copy to repository root.
- `.gitignore` игнорирует `dist/`, но не `vendor/`. При прямой публикации `vendor/` должен быть закоммичен.
- README и resume-инструкция обновлены под branch-root publishing.
- `numbers-import.html`: исправлены состояния disabled для Import/Export при смене файлов; невалидная SQLite-копия закрывается; категории из Excel/SQLite экранируются перед вставкой в HTML.
- `numbers-analytics.html`: категории экранируются перед вставкой в HTML.
- Добавлен `tests/numbers_import_e2e.mjs`: проверяет загрузку XLSX, preview, запись в `numbers_history`, экспорт `.budget`, повторный импорт без накопления дублей, неизменность `transactions` и live categories и последующее чтение Financial Analytics.
- `npm run test:e2e` теперь включает app E2E и Numbers E2E.

## Текущий проверенный статус

- Код и конфигурация этих изменений сохранены непосредственно в `main`.
- Приложение остаётся версии **0.1.6.0**.
- Существующий `package-lock.json` не изменён.
- Исторический vendor artifact от более ранней сборки содержит проверенные версии sql.js 1.16.0, PDF.js 6.5.438, SheetJS 0.20.3; он послужил ориентиром, но его файлы ещё не перенесены в корень `main`.
- `vendor/` **ещё не присутствует в корне main**. Поэтому прямую публикацию с готовыми runtime assets пока нельзя считать завершённой.
- Настройку Settings → Pages подключение не позволило прочитать. Требуется вручную подтвердить `Deploy from a branch`, Branch `main`, Folder `/(root)`.
- После последних изменений не выполнялись локально `npm ci`, `npm test`, `npm run build:pages`, `npm run publish:root`, `npm run test:dist` и Chromium E2E. Результаты этих тестов не заявлять как PASS.
- Опубликованный сайт и Numbers-страницы в браузере ещё не проверены.

## Следующий шаг

На локальной Windows-машине из корня клонированного проекта выполнить команды из `RESUME_NEXT_STEPS_RU.md`: `npm ci`, `npm run verify:lock`, `npx playwright install chromium`, `npm test`, `npm run publish:root`, `npm run test:dist`, `npm run test:e2e`. Затем проверить `git status --short`, изучить Changes, сделать обычный commit и Push origin. Это стандартная публикация из ветки `main`; workflow не нужен.

После публикации проверить Pages в браузере и пройти import → download `.budget` → повторное открытие → Analytics на синтетической тестовой базе. Пользовательскую финансовую базу не использовать для первого теста.

---
> Всё ниже этой строки сохранено как исторический контекст прежней архитектуры Actions и не описывает текущий publishing plan.

# Budget Capture Web — актуальная контрольная точка 0.1.6.0 (20 ноября 2026)

> Этот раздел supersedes более ранние статусы ниже. Исторические заметки сохранены для истории изменений.

## Текущий подтверждённый статус

- Версия приложения и `package.json`: **0.1.6.0**. Не повышалась до 0.1.7.0.
- Настоящий `package-lock.json` получен на GitHub-hosted Node `v24.22.2` / npm `11.19.1`; source ref `refs/heads/main`, bootstrap source commit `3861348f3badec8cb7f3ad109117e1b66370c967`. Его SHA-256: `1ef207fcf848ca60438a99de738ee593cbcfc700e88973d6926bc6b2b3e985b8`.
- `npm run verify:lock` на текущем исходном архиве: PASS, 17 package entries; точные direct/transitive pins, approved HTTPS hosts и SHA-512 integrity.
- `npm test` на текущем исходном архиве: 9/9 PASS (локальный Node `v22.16.0`, npm `10.9.2`).
- Все JS/MJS syntax checks и YAML parsing двух workflow файлов: PASS.
- Пользователь подтвердил успешный GitHub Actions `Build and test (no publication)` на Node 24, 48 секунд. Artifact commit identifier: `1f6ae9bd61194964c93e323d0a52045eb68a1d35`.
- Полученный production artifact проверен на текущем контейнере: `npm run test:dist` PASS, **218/218** manifest assets по SHA-256; 219 файлов всего вместе с manifest, 8,799,044 bytes unpacked. Основные `index.html`, `styles.css`, `app.js`, `core.js`, `db.js`, `profile.js` и `manifest.webmanifest` побайтно совпадают с текущим source ZIP.
- В artifact используются same-origin runtime assets: sql.js 1.16.0, PDF.js 6.5.438 и SheetJS 0.20.3; external CDN URLs в runtime entry files не обнаружены. Базы и банковские документы в artifact не найдены.
- Deployment gate остаётся закрытым: `push` запускает только validation/build; Pages deploy требует отдельного `workflow_dispatch` с `deploy=true`.

## Последняя корректировка E2E

Проверка исходного архива выявила, что второй импорт в `tests/e2e.mjs` ждал видимый `#import-result`, но не сравнивал его с текстом первого импорта. Это могло принять старый результат за новый. Исправление теперь ждёт изменения текста результата, затем читает пары metric label/value и явно проверяет `Imported = 0`, `Duplicates skipped = 1`, `Extracted = 1`. Contract test закрепляет это поведение. Требуется новый GitHub Actions запуск после commit этой корректировки.

## Оставшиеся release gates

1. Применить E2E correction из patch ZIP, commit + push.
2. Убедиться, что GitHub Actions повторно проходит все этапы, включая fresh-result duplicate-import E2E.
3. Провести ручной тест открытия, импорта, Review, Save и Reopen пользовательской Windows-базы в целевом браузере.
4. Проверить Safari/iPhone open/save flow на реальном устройстве.
5. Только после этих проверок отдельно решить вопрос о публикации Pages. Не включать `deploy=true` до явного решения.

**Текущий вывод:** 0.1.6.0 имеет успешный hosted CI/build artifact по сообщённому запуску и проверенный artifact integrity. Это ещё не финальный production release: повторный CI после укрепления E2E и ручные проверки браузеров остаются открытыми.

---

# Budget Capture Web — контрольная точка 0.1.6.0

**Дата:** 19 ноября 2026  
**Статус:** профиль категорий завершён; source regression и security-hardening contract проверки проходят. Production build / dist / Chromium E2E пока не подтверждены.

## Что реализовано

- `profile.js` — версия профиля, универсальные defaults, нормализация и legacy migration.
- `db.js` — профиль внутри SQLite `web_metadata` под ключом `budget_profile_v1`, миграция legacy-флага в нейтральное поле `highlighted_flag`, save/reopen и import/export.
- `app.js` + `index.html` — редактирование Expenses / Income / Other, специальных Numbers categories и captions.
- Персональные категории и имена специальных Numbers-таблиц не зашиты в публичный JavaScript.
- Персональная `.budget` копия хранится отдельно; исходный Windows backup не перезаписывался.

## Security hardening, 19.11.2026

- SQLite: `sql.js` обновлён с 1.13.0 до 1.16.0 (выпуск от 10.11.2026); `useOldExtensionFunctions: true` явно сохраняет прежнее поведение legacy SQLite math/string functions.
- XLSX: зависимость переключена со старого `xlsx@0.18.5` на официальный SheetJS CE tarball `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.
- PDF: `pdfjs-dist` обновлён до `6.5.438`; runtime использует legacy ESM API и worker из одной версии.
- PDF parser вызывается с `isEvalSupported: false`.
- Build script сверяет фактические установленные версии `sql.js`, `pdfjs-dist`, `xlsx` и `playwright` перед сборкой.
- E2E сценарий проверяет версию загруженного PDF.js и SheetJS, локальные same-origin пути и parsing PDF/XLSX.
- PDF parser явно передаёт same-origin URL для CMaps, standard fonts, WASM и ICC; build manifest должен хешировать все эти файлы; E2E дополнительно проверяет успешный same-origin fetch representative-файлов каждого каталога.
- Корневой `asset-manifest.json` включает версии пакетов и происхождение SheetJS/PDF.js; это согласовано с `test:dist`.
- `dist/vendor/licenses/` сохраняет лицензии sql.js, PDF.js и SheetJS CE; копии входят в SHA-256 manifest и проверяются на непустое содержимое.
- Runtime без CDN fallback: библиотеки и вспомогательные ресурсы PDF.js (CMaps / standard fonts / WASM / ICC) должны быть vendored в опубликованный `dist/vendor`.
- Эти изменения пока являются source-level hardening. Реальная production-сборка и браузерное выполнение ещё не подтверждены.

## Проверки, выполненные в этой контрольной точке

- `node --check` всех runtime-модулей, build scripts и test scripts — PASS.
- `npm test` — 9/9 source suites PASS (including explicit rejection of stale sql.js 1.13.0 in the lockfile guard):
  - core smoke;
  - profile migration;
  - SQLite migration/save/reopen round-trip;
  - app contract;
  - GitHub Pages build contract;
  - lockfile security guard (transitive SHA-512 / HTTPS host allowlist);
  - lockfile bootstrap workflow contract (manual trigger / verifier-before-artifact / no deployment);
  - Windows/browser import compatibility;
  - Yandex PDF parsing/reconciliation.
- `npm run build:pages` — BLOCKED: отсутствует `node_modules/sql.js`; `dist/` не создаётся.
- Builder + `test:dist` дополнительно прошли на отдельном синтетическом fixture-проекте: все assets и package metadata в manifest проверены SHA-256. Fixture использует искусственные vendor-файлы и не подтверждает реальные пакеты или production runtime.
- Privacy scan сверил 37 персональных категорий/подписей (за вычетом универсальных defaults): точных совпадений с текстовыми границами в публичном проекте — 0.
- `npm run verify:lock` — BLOCKED: отсутствует `package-lock.json`.
- `npm run test:dist` — BLOCKED: нет `dist/asset-manifest.json`, поскольку build не создан.
- Chromium E2E не запускался в этой контрольной точке. Предыдущая проверка среды зафиксировала системную Chromium policy `URLBlocklist: ["*"]`, блокирующую localhost и file URLs.
- GitHub Actions / Pages deployment и iPhone Safari не проверялись.

## Следующий шаг

В trusted network environment создать и проверить `package-lock.json` для точных зависимостей из `package.json`, затем выполнить `npm ci`, установить Playwright Chromium и пройти полный release pipeline:

```bash
npm run verify:lock
npm ci --ignore-scripts --no-audit --no-fund
npx playwright install --with-deps chromium
npm test
npm run build:pages
npm run test:dist
npm run test:e2e
```

Не повышать версию до 0.1.7.0 и не публиковать как production-ready, пока все этапы не пройдут. Подробности — в `VALIDATION_ATTEMPT_2026-11-19_RU.md` и `SECURITY_DEPENDENCY_REVIEW_2026-11-19_RU.md`.


## Дополнительная работа после release-gate hardening

- Добавлен отдельный ручной workflow `.github/workflows/prepare-lockfile.yml` для генерации настоящего npm lockfile на GitHub-hosted runner, где доступен registry. Он только разрешает package metadata (`--package-lock-only --ignore-scripts`), запускает строгий `verify:lock`, создаёт SHA-256 и экспортирует артефакт с checksum и commit metadata; deployment не выполняет.
- Добавлен `tests/lockfile_workflow_contract.mjs` в `npm test`: workflow должен быть ручным, Node 24, verifier должен выполняться до upload, артефакт содержит lockfile/checksum; workflow не должен запускать `npm ci` или Pages deployment.
- После загрузки проекта в GitHub запустить workflow вручную, скачать artifact, проверить checksum, добавить package-lock.json в root и сделать commit; только после этого Pages pipeline сможет пройти первый release gate.


## Lockfile bootstrap, 19.11.2026

- `sql.js` обновлён до 1.16.0; package/build/lockfile guards согласованы с этим pin, а legacy function semantics выставлены явно.
- Добавлен `.github/workflows/prepare-lockfile.yml`: ручной GitHub Actions запуск генерирует lockfile в доступной к npm сетевой среде, выполняет strict verifier и экспортирует lockfile + checksum + commit metadata. Не устанавливает библиотеки и не деплоит Pages.
- README и resume-инструкция обновлены: для текущей среды предпочитать этот workflow вместо попыток создать поддельный локальный lockfile.
- Добавлен contract test workflow; полный source suite теперь 9/9 PASS.


## Dependency refresh — sql.js 1.16.0

- 19.11.2026 проверена официальная release history: `sql.js@1.16.0` (10.11.2026) является актуальным stable, заменяет `1.13.0` (15.03.2025).
- Пакетный pin, builder version checks, lockfile verifier и tests обновлены на 1.16.0.
- `app.js` явно передаёт `useOldExtensionFunctions: true`, сохраняя прежнее поведение legacy math/string функций.
- `npm test` и синтетический `build:pages` / `test:dist` пройдены после обновления. Реальный runtime sql.js 1.16.0 остаётся на проверку GitHub runner после `npm ci`.

## Текущий dependency pin after freshness review

- `sql.js`: **1.16.0** (SQLite 3.54.1, released 10.11.2026). Previous `1.13.0` pin removed from active configs.
- `app.js` sets `useOldExtensionFunctions: true` explicitly, preserving legacy SQLite math/string behavior.
- Updated files: `package.json`, `scripts/build-pages.mjs`, `scripts/verify-lockfile.mjs`, `tests/build_contract.mjs`, `tests/dist_contract.mjs`, `tests/lockfile_guard.mjs`.
- Fresh test run after the change: `npm test` 9/9 PASS; JS/MJS syntax PASS; isolated structural build + `test:dist` PASS (20 placeholder assets).
- Real package installation and real sql.js WASM execution remain pending GitHub Actions/network access.
GitHub Actions in both workflows are pinned to verified full-length commit SHAs; checkout runs with `persist-credentials: false`. Keep these immutable references unless a replacement SHA is checked against the official upstream release and reviewed.

## GitHub Actions runtime hardening — Node 24

- Оба workflow обновлены на официальные Node 24-compatible релизы и full immutable SHA: checkout v7.0.1, setup-node v7.1.0, configure-pages v6.0.0, upload-pages-artifact v5.0.0, deploy-pages v5.0.1; lockfile bootstrap использует upload-artifact v6.0.0.
- Composite `upload-pages-artifact@v5.0.0` внутри себя использует `upload-artifact@v7.0.0`, также закреплённый upstream commit SHA.
- В `tests/lockfile_workflow_contract.mjs` добавлены точные утверждения о версиях Actions и Node 24.
- Официальные upstream release metadata checked; подробные ссылки и full SHA — в `GITHUB_ACTIONS_NODE24_REVIEW_2026-11-19_RU.md`.
- Source regression после обновления: 9/9 PASS. YAML parse обоих workflow — PASS. Чистый synthetic Pages build + `test:dist` — 20 assets, 20/20 SHA-256 PASS.
- Реальные GitHub Actions jobs не запускались: репозиторий пользователя ещё не подключён в этой рабочей сессии. `package-lock.json`, `npm ci`, production vendor build, Chromium E2E и Pages deployment остаются незавершёнными.


## Checkpoint refresh — GitHub Actions Node 24, 19.11.2026

- Both `.github/workflows/pages.yml` and `.github/workflows/prepare-lockfile.yml` now target Node 24.
- Direct Actions pins were upgraded and re-verified against official upstream release metadata: checkout v7.0.1, setup-node v7.1.0, configure-pages v6.0.0, upload-pages-artifact v5.0.0, deploy-pages v5.0.1, upload-artifact v6.0.0. Every direct reference is a full 40-character commit SHA.
- `upload-pages-artifact@v5.0.0` is a composite action that internally pins upload-artifact v7.0.0 by full SHA.
- Added `GITHUB_ACTIONS_NODE24_REVIEW_2026-11-19_RU.md` with all direct and nested pins and official metadata links.
- Expanded `tests/lockfile_workflow_contract.mjs` to require Node 24 and the reviewed SHA pins.
- Fresh verification: `npm test` 9/9 PASS; all JS/MJS syntax checks PASS; both workflow YAML documents parse; 8/8 direct action uses are full immutable SHA references; isolated synthetic build and `test:dist` PASS with 20/20 asset hashes.
- Important limits: no real lockfile has been generated; no real npm tarballs or runtime WASM were installed; no actual GitHub workflow run, Chromium E2E or Pages deploy has occurred. The synthetic fixture uses placeholder files and is structural-only.

## Независимая перепроверка после Node 24 checkpoint — 19.11.2026

Архив исходной контрольной точки повторно проверен: SHA-256 совпал с опубликованной суммой `e6b2412e316ec7e88af4655e219c69ca421f6c49b1ae99dbcba89e29bf0c95e3`; внутри 41 файл.

Локальная среда этой проверки: Node.js `v22.16.0`, npm `10.9.2` (это не GitHub Node 24 runner).

- `npm test` — PASS, 9/9 suites.
- JS/MJS syntax — PASS.
- YAML parse обоих workflows — PASS.
- Immutable Action references — PASS, 8/8 полных 40-символьных SHA.
- Попытка `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` не получила ответ от registry: DNS `EAI_AGAIN` на `registry.npmjs.org`. Частичный `package-lock.json` не создан.
- `npm run verify:lock` — BLOCKED: `package-lock.json` отсутствует.
- `npm run build:pages` — BLOCKED: отсутствует `node_modules/sql.js`.

Следовательно, состояние release gate не изменилось: исходные тесты подтверждены, но настоящая dependency resolution, `npm ci`, production vendor build, dist SHA verification, Chromium E2E и deployment ещё не выполнены. Не повышать версию и не публиковать.

**Единственный следующий технический шаг:** загрузить source-only ZIP в GitHub, запустить вручную `Actions → Prepare verified dependency lockfile → Run workflow`, скачать artifact, проверить SHA-256 и source commit, добавить полученный `package-lock.json` в корень и отправить commit в `main`. Затем Pages workflow сможет выполнить реальную сборку и E2E на GitHub-hosted runner.

## Publication gate hardening — 19.11.2026

Во время повторной проверки найдено опасное несоответствие требованию «публикацию пока не запускаем»: предыдущий `pages.yml` деплоил сайт автоматически после каждого push в `main`. Это исправлено до дальнейшего GitHub запуска.

- `push` в `main` выполняет только `validate`: lockfile verification, `npm ci`, Chromium install, source tests, production build, dist manifest verification и Chromium E2E.
- Проверенный `dist/` сохраняется как artifact `budget-capture-dist-<commit SHA>` для инспекции.
- `deploy` изолирован в отдельный job и требует ручного `workflow_dispatch` с boolean input `deploy=true`. Значение по умолчанию — `false`.
- Только deploy job получает `pages: write` и `id-token: write`; validation job имеет только `contents: read`.
- Добавлен pinned `actions/download-artifact@v8.0.2` (`9000827ccba6bdab643e8b6fd33ac0654aef8333`) с Node 24 runtime; action refs в двух workflows теперь 10/10 полных SHA.
- `tests/lockfile_workflow_contract.mjs` проверяет, что push не может вызвать deploy, input по умолчанию false и deploy зависит от успешного validate job.

Повторный `npm test` после изменения: 9/9 PASS, включая новый publication-gate contract. Оба YAML файла разбираются, immutable pins — 10/10 PASS. Реальный GitHub runner всё ещё не запускался; автоматической публикации теперь нет.

Действующий следующий шаг: загрузить этот ZIP в GitHub, выполнить manual lockfile bootstrap, проверить artifact и добавить lockfile в `main`. Это вызовет CI validation/build, но не опубликует сайт. Публикация возможна только отдельным ручным запуском с `deploy=true` и пока не требуется.
