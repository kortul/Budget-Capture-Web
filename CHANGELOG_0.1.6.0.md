# Budget Capture Web 0.1.6.0

## Локальный профиль категорий и Numbers
- Добавлен версионированный профиль категорий в `web_metadata` внутри SQLite-файла `.budget`.
- Категории разделяются на Expenses / Income / Other; имена и порядок хранятся в открытой базе, а не в публичном JavaScript.
- Специальные категории дополнительных поступлений/списаний и заголовки Numbers-таблиц перенесены в профиль.
- Заголовок отмеченных операций также настраивается в профиле.
- Добавлен экран Data & Backup для редактирования, импорта и экспорта только профиля без транзакций.
- Для пустой базы используется безопасный универсальный профиль без пользовательских названий.

## Миграция и совместимость
- При первом открытии старой SQLite-базы создаётся `budget_profile_v1`; категории из существующей таблицы переносятся в профиль.
- Для старых баз тип категории определяется по истории операций, специальные группы обнаруживаются по структурному шаблону названия. Неоднозначные категории сохраняются как Other, а не удаляются.
- Старый пользовательский флаг Numbers переносится в нейтральное поле `highlighted_flag`; исходная колонка остаётся в базе для обратной совместимости.
- Нормализация `Uncategorized` выполняется до дальнейшей работы; повторное открытие уже сохранённого файла не должно менять профиль повторно.
- Добавлены проверки default profile, legacy inference, edit/import/export/save/reopen и database migration.

## Что не входит в подтверждённый статус
- Hosted GitHub Actions / GitHub Pages deployment ещё не подтверждены.
- Production build и Chromium E2E зависят от установки pinned npm dependencies и наличия Chromium.
- Safari/iPhone Open/Save должен быть проверен на физическом устройстве.

## Release-проверка 19.11.2026

- Повторно выполнены `node --check` и все 7 source regression suites: PASS.
- Проверена приватная профильная `.budget` копия: SQLite quick check PASS; профиль присутствует.
- Повторно проверены ZIP CRC и отсутствие персональных/финансовых файлов в публичном архиве.
- Production build / `test:dist` / Chromium E2E остались заблокированы внешними ограничениями среды (нет доступа к npm registry; Chromium URLBlocklist). См. `VALIDATION_ATTEMPT_2026-11-19_RU.md`.


## Security maintenance — 19 ноября 2026

- Подготовлен переход с `xlsx@0.18.5` на официальный SheetJS CE `0.20.3` tarball из `cdn.sheetjs.com`; npm-пакет `xlsx` на npmjs.org устарел.
- Подготовлен переход PDF.js с `3.11.174` на `pdfjs-dist@6.5.438`, включая legacy ESM API и worker.
- При открытии PDF принудительно задано `isEvalSupported: false`.
- Build script сверяет фактически установленные версии пакетов перед сборкой.
- Обновлён Chromium E2E: PDF.js загружается как ESM, XLSX создаётся и читается через одноимённый same-origin browser runtime.
- Это source hardening checkpoint; production build, Chromium E2E и Safari ещё требуют запуска в сетевой среде.


## Дополнительное release hardening

- Уточнён privacy-раздел: персональные категории и Numbers captions находятся в локальном профиле `.budget`, публичный код содержит только универсальные defaults.
- `verify-lockfile.mjs` теперь сравнивает dependency maps независимо от порядка ключей, требует SHA-512 для всех транзитивных tarball entries и разрешает только HTTPS с официальных npm / SheetJS hosts.
- Добавлен `tests/lockfile_guard.mjs` с синтетическими положительными и отрицательными сценариями; suite включён в общий `npm test`.
- Эти проверки не заменяют реальную генерацию `package-lock.json`, `npm ci`, production build или Chromium E2E; они остаются отдельными release gates.

- Production Pages builder теперь копирует CMaps, standard fonts, WASM decoders и ICC profiles PDF.js из того же pinned package; парсер передаёт их same-origin URLs. Все вспомогательные файлы входят в SHA-256 asset manifest и проверяются `test:dist`; E2E также скачивает реальные representative CMap/font/WASM/ICC файлы с same-origin.
- Исправлен metadata contract: корневой `asset-manifest.json` теперь содержит package versions / SheetJS source / PDF.js build info, которые проверяет `test:dist`. Ранее эти метаданные были только в `vendor/versions.json`, из-за чего dist contract не мог пройти.
- E2E сценарий передаёт PDF.js те же локальные URL CMaps/fonts/WASM/ICC, что и приложение; representative-файлы каждого каталога загружаются и проверяются по ответу сервера.

## Runtime distribution / license manifest — 19 ноября 2026

- Production builder дополнительно сохраняет license texts трёх vendored runtime-библиотек (sql.js, PDF.js, SheetJS CE) в `dist/vendor/licenses/`.
- License files включены в общий SHA-256 asset manifest и проверяются `test:dist`, чтобы публикация сохраняла сведения о лицензиях рядом с исполняемыми файлами.
- В builder разрешён ненулевой размер для коротких, но валидных license/resource files; основной runtime по-прежнему проходит строгую проверку минимального размера.

## Повторная проверка release gate — 19 ноября 2026

- После последних изменений повторно выполнен полный `npm test`: 8/8 source suites PASS; все JS syntax checks PASS.
- Builder + `test:dist` повторно пройдены на синтетическом fixture: 20 assets проверены по SHA-256, включая три license files. Это структурная проверка builder/manifest, не реальный production build.
- Отдельный privacy scan: 37 private-only категорий/подписей проверены на точное совпадение с границами токена; совпадений в публичном проекте нет.
- Реальный `npm ci`, production build, Chromium E2E, GitHub Pages deployment и iPhone Safari остаются неподтверждёнными из-за отсутствия lockfile/пакетов и системной блокировки Chromium в рабочей среде.


## Dependency lockfile bootstrap — 19 ноября 2026

- Добавлен отдельный manual GitHub Actions workflow для генерации `package-lock.json` в сетевой среде GitHub-hosted runner (`--package-lock-only --ignore-scripts`).
- Lockfile загружается artifact только после строгого `npm run verify:lock`; вместе с ним публикуются SHA-256 checksum и метаданные исходного commit / Node / npm.
- Bootstrap workflow не устанавливает пакеты, не выполняет lifecycle scripts и не запускает Pages deployment.
- Добавлен `tests/lockfile_workflow_contract.mjs` в общий `npm test`.


## Manual lockfile bootstrap workflow — 19 ноября 2026

- Добавлен `.github/workflows/prepare-lockfile.yml` для ручной генерации npm lockfile на GitHub-hosted runner, когда локальный DNS/npm registry недоступен.
- Workflow только разрешает lock metadata (`--package-lock-only --ignore-scripts`), затем запускает существующий strict lockfile verifier и экспортирует `package-lock.json`, SHA-256 и source commit metadata.
- Deployment и установка package contents не выполняются; новый workflow contract включён в `npm test`.
- README теперь объясняет ручной bootstrap и безопасное добавление lockfile в репозиторий.


### Dependency freshness review — 19.11.2026

- Updated `sql.js` from 1.13.0 to 1.16.0 after verifying the 10 Nov 2026 stable release.
- Pinned `useOldExtensionFunctions: true` explicitly to preserve legacy SQL math/string function behavior while retaining the newer SQLite engine.
- Updated build, lockfile and dist contract expectations to the new exact pin.

### Regression refresh after sql.js update — 19.11.2026

- Added a lockfile-guard regression that rejects sql.js 1.13.0.
- Refreshed test report and resume instructions with the current exact pin.
- Re-ran all 9 source suites and syntax checks.
- Re-ran builder/dist contract on isolated placeholder fixture: 20 files hashed and verified. Real npm package runtime remains unverified until GitHub Actions bootstrap and Pages CI run.

## 19 November 2026 — GitHub Actions Node 24 hardening

- Updated both workflows to Node 24-compatible official GitHub Actions releases.
- Pinned checkout v7.0.1, setup-node v7.1.0, configure-pages v6.0.0, upload-pages-artifact v5.0.0 and deploy-pages v5.0.1 by full commit SHA.
- Updated the lockfile artifact export to upload-artifact v6.0.0 (Node 24) pinned by full commit SHA.
- Extended the workflow contract tests to enforce the Node 24 runtime and the exact reviewed action pins.
- No npm lockfile was fabricated; dependency resolution remains delegated to the manual GitHub Actions bootstrap workflow.

## 19 November 2026 — GitHub Actions Node 24 runtime alignment

- Moved both workflows to official Node 24-compatible Action releases.
- Pinned checkout v7.0.1, setup-node v7.1.0, configure-pages v6.0.0, upload-pages-artifact v5.0.0, deploy-pages v5.0.1 and upload-artifact v6.0.0 by full immutable commit SHA.
- Confirmed `upload-pages-artifact@v5.0.0` pins its nested `upload-artifact@v7.0.0` by SHA.
- Updated workflow contract tests and added `GITHUB_ACTIONS_NODE24_REVIEW_2026-11-19_RU.md` with official release and metadata links.

## Publication gate hardening — 19 November 2026

- Removed automatic GitHub Pages deployment from `push` to `main`; pushes now run validation/build only and upload the tested `dist` as a short-lived artifact.
- Isolated publication in a separate job, gated by a manual `workflow_dispatch` boolean input `deploy` (default `false`).
- The deployment job receives `pages: write` and `id-token: write`; the validation job receives only `contents: read`.
- Pinned `actions/download-artifact@v8.0.2` by immutable SHA to transfer the validated `dist` artifact to the opt-in deploy job.
- Expanded workflow contract tests to prevent accidental automatic deployment.


## 20 ноября 2026 — GitHub-hosted CI и production artifact

- На GitHub-hosted runner Node 24 был выполнен успешный `Build and test (no publication)` (успешный запуск подтверждён пользователем; 48 секунд).
- Настоящий `package-lock.json` создан workflow `Prepare verified dependency lockfile`; SHA-256: `1ef207fcf848ca60438a99de738ee593cbcfc700e88973d6926bc6b2b3e985b8`; lockfile verifier на текущем source archive проверяет 17 package entries.
- Production artifact `budget-capture-dist-1f6ae9bd61194964c93e323d0a52045eb68a1d35.zip` независимо проверен: ZIP integrity PASS, `test:dist` PASS, 218/218 asset SHA-256 совпали; основные runtime-файлы byte-identical к предоставленному исходному архиву.
- Повторный импорт в E2E укреплён: ожидание теперь требует нового текста результата, а счетчики извлекаются по label/value парам; добавлен regression contract. Нужен новый hosted CI run после commit этой корректировки.
- Версия приложения остаётся `0.1.6.0`. GitHub Pages deployment не запускался; ручные Windows и Safari/iPhone проверки остаются открытыми.


## Unreleased — Numbers category visibility and totals

- Numbers now lists all three profile groups: Expenses, Income and Other. Legacy categories without reliable transaction history remain visible instead of disappearing from the Numbers screen.
- Each group shows its calculated total; the Other total is signed net, while expense and income totals follow the existing copy-list sign convention.
- Added integer-cent regression checks for mixed-sign expense categories, income totals and unused categories with zero transactions.


## Unreleased — Desktop-style category navigation

- Review transaction category dropdowns and the category filter now use visible optgroups: Expenses, Income, Other, Numbers extra input and Numbers extra output.
- Category names sort alphabetically inside each group using Russian-aware, case-insensitive natural sorting; numeric suffixes sort naturally.
- The profile editor and Numbers category lists use the same alphabetical order.
- The selected transaction category remains selected even when it is absent from the profile, and is displayed under Other until the profile is corrected.
- Added regression checks for group rendering and alphabetical ordering. The supplied backup contains the SQLite database and source statements, but no Windows executable/UI source or screenshots, so exact pixel-level parity with the desktop dropdown still needs visual confirmation.
