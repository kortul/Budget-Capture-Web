# Release-проверка Budget Capture Web 0.1.6.0

**Дата:** 19 ноября 2026  
**Результат:** source regression и contract checks проходят; production build, dist verification, lockfile и Chromium E2E не подтверждены.

## Подтверждено в последнем запуске

- `node --check app.js`, `core.js`, `db.js`, `profile.js` — PASS.
- `npm test` — все 9 source suites PASS: `core_smoke`, `profile_migration`, `db_roundtrip`, `app_contract`, `build_contract`, `lockfile_guard`, `windows_compat`, `yandex_pdf`.
- В первоначальной попытке build contract проверял `sql.js@1.13.0`; после дополнительной проверки свежести pin обновлён до `1.16.0` (см. раздел Dependency freshness review ниже). Остальные pins: `pdfjs-dist@6.5.438`, официальный SheetJS CE `0.20.3`, `playwright@1.65.1`.
- Browser E2E код дополнен реальными проверками версий PDF.js / SheetJS и same-origin загрузки PDF/XLSX. Сам E2E в этом окружении не запускался.
- PDF.js parser и Pages builder теперь предусматривают same-origin CMaps, standard fonts, WASM и ICC resources; они включаются в SHA-256 manifest и dist contract.

## Что сейчас не проходит и почему

1. `npm run build:pages` останавливается до сборки: отсутствует `node_modules/sql.js`. Папка `dist/` не создаётся.
2. `npm run verify:lock` останавливается, потому что `package-lock.json` ещё не создан.
3. `npm run test:dist` останавливается, потому что не существует `dist/asset-manifest.json`; это downstream-следствие отсутствующей сборки, а не провал проверки готовых dist-файлов.
4. Предыдущая попытка `npm install` завершилась timeout; DNS к npm registry / публичным ресурсам не работал в той среде.
4a. Builder и `test:dist` прошли на отдельной синтетической fixture-копии (17 placeholder assets); это только structural test и не заменяет установку/проверку реальных npm package contents.
5. Повторная Chromium-проверка через системный `/usr/bin/chromium` вернула `ERR_BLOCKED_BY_ADMINISTRATOR` даже для `data:` URL; системная `URLBlocklist: ["*"]` блокирует браузерную навигацию. Реальный E2E не подтверждён.
6. GitHub Actions / GitHub Pages deployment и ручная проверка iPhone Safari не выполнялись.

## Интерпретация

- Source regression: PASS.
- Security changes: закреплены в исходном коде, package specs, build contracts и E2E assertions; production execution ещё не доказан.
- Production bundle / browser runtime / hosted site / iPhone Safari: NOT VERIFIED.
- Версию 0.1.7.0 нельзя считать готовой.

## Следующие действия в сетевой среде

1. Сгенерировать `package-lock.json` с проверяемыми tarball URLs и integrity metadata; особенно проверить официальный SheetJS CDN tarball.
2. Проверить lockfile review, затем запускать CI через `npm ci`.
3. Установить Chromium через Playwright.
4. Выполнить `npm test`, `npm run build:pages`, `npm run test:dist`, `npm run test:e2e`.
5. Проверить, что dist содержит все пять vendor-файлов, SHA-256 manifest и не делает внешних runtime CDN requests.
6. Запустить GitHub Actions и проверить фактический Pages URL.
7. Отдельно проверить Open → Import → Review → Save → Reopen на Windows и Safari/iPhone.


## Lockfile bootstrap workflow

Чтобы не создавать фиктивный lockfile при недоступном DNS к npm registry, добавлен ручной GitHub Actions workflow `.github/workflows/prepare-lockfile.yml`. Он предназначен для генерации lockfile на GitHub runner и отдаёт его только после проверки `npm run verify:lock`. Workflow не устанавливает package contents, не запускает install scripts и не публикует Pages. Его контракт покрыт отдельным локальным тестом.


## Дополнение — 19.11.2026

- `npm test`: 9/9 PASS, включая новый `lockfile_workflow_contract.mjs`.
- Ruby YAML parser принял новый `.github/workflows/prepare-lockfile.yml`; contract assertions проверяют шаги генерации, verifier-before-upload, checksum/source metadata и отсутствие deployment.
- Свежая изолированная synthetic fixture на текущем checkout: `npm run build:pages` и `npm run test:dist` PASS; 20 assets в manifest. Vendor-файлы fixture искусственные, production runtime не подтверждён.
- Реальный lockfile по-прежнему не генерировался локально: DNS к `registry.npmjs.org` и `cdn.sheetjs.com` не разрешается. Новый manual GitHub workflow предназначен для получения настоящего lockfile на runner.


## Dependency freshness review — 19.11.2026

- Проверка текущих официальных package/release pages показала, что `sql.js@1.16.0` выпущен 10.11.2026 и заменяет прежний pin `1.13.0` от марта 2025.
- `pdfjs-dist@6.5.438` и SheetJS CE `0.20.3` остаются текущими стабильными выпусками в проверенных источниках; Playwright `1.65.1` — текущий stable tag, alpha 1.66 не используется.
- `package.json`, build verifier, lockfile verifier и contract tests обновлены под `sql.js@1.16.0`.
- В `app.js` явно передаётся `useOldExtensionFunctions: true`, чтобы зафиксировать прежнюю семантику legacy math/string functions из sql.js 1.x; новые native functions не включаются в этой версии приложения.
- Полноценная проверка browser runtime против реального sql.js 1.16.0 будет выполнена после успешного `npm ci` на GitHub-hosted runner.

## Независимый повторный запуск — 19.11.2026

- Исходный ZIP `NODE24-ACTIONS-CHECKPOINT` повторно сверён с SHA-256: совпадение; архив содержит 41 файл.
- Среда: Node `v22.16.0`, npm `10.9.2` (не Node 24 hosted runner).
- `npm test`: 9/9 PASS.
- JS/MJS syntax: PASS; YAML parse обоих workflows: PASS; immutable Action pins: 8/8 PASS.
- Повторная попытка lockfile generation завершилась timeout из-за DNS `EAI_AGAIN` при запросе `https://registry.npmjs.org/sql.js`; `package-lock.json` не создан.
- `npm run verify:lock`: BLOCKED из-за отсутствующего lockfile.
- `npm run build:pages`: BLOCKED из-за отсутствующего `node_modules/sql.js`.
- Источник кода не менялся. Следующий шаг — выполнить уже имеющийся manual bootstrap workflow на GitHub-hosted runner, затем проверить artifact checksum/source commit, закоммитить lockfile и запускать Pages pipeline.

## Дополнительное изменение — публикация теперь только вручную

При повторном просмотре workflow обнаружено, что прежний `pages.yml` публиковал сайт автоматически при push в `main`. Это не соответствовало текущему ограничению «публикацию пока не запускать». Workflow разделён:

- push в `main` запускает только build/test/E2E job и экспортирует `dist` artifact;
- отдельный deploy job может выполняться только для `workflow_dispatch` с `deploy=true`;
- boolean input по умолчанию `false`;
- deployment token permissions находятся только в deploy job;
- для передачи `dist` используется `actions/download-artifact@v8.0.2`, закреплённый SHA `9000827ccba6bdab643e8b6fd33ac0654aef8333`.

После изменения: `npm test` 9/9 PASS, YAML parse PASS, 10/10 direct Actions pins immutable. GitHub deployment намеренно не запускался.
