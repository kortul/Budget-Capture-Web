# Budget Capture Web — CHECKPOINT: direct GitHub Pages from main

**Дата:** 21 ноября 2026  
**Текущая ветка:** `main`  
**HEAD на момент фиксации:** `38c53d62ad680dd97da1b360ccbd0a34f7c24d46`  
**Версия приложения:** `0.1.6.0`  
**Статус:** source/configuration checkpoint saved; runtime assets and local validation still pending.

## 1. Главная договорённость

Публикуем GitHub Pages напрямую из корня ветки `main`: **Settings → Pages → Deploy from a branch → `main` → `/(root)`**.

**GitHub Actions не используем.** Оба workflow удалены, каталог `.github/workflows/` пуст. Не добавлять workflow, CI deploy, `workflow_dispatch` или `deploy=true` обратно без отдельной просьбы пользователя.

После обычного `git commit` + `git push origin main` GitHub Pages должен раздавать файлы из корня. Никакой `dist` upload action, artifact deployment или Actions pipeline не нужен.

## 2. Что уже закоммичено в main

### Direct Pages build/publish

- `scripts/build-pages.mjs` теперь собирает три страницы: `index.html`, `numbers-import.html`, `numbers-analytics.html`, плюс JS/CSS, локальные библиотеки, PDF.js CMaps/standard fonts/WASM/ICC и лицензии.
- Build пишет `asset-manifest.json` с размерами и SHA-256 всех production assets.
- Build проверяет same-origin CSP и отсутствие внешних CDN URL на всех трёх HTML-страницах и в основном runtime JS.
- `scripts/publish-root.mjs` добавлен как безопасный copier: требует `--publish`, проверяет `asset-manifest.json`, app version, размеры, SHA-256, обязательные страницы и запрещённые финансовые форматы, затем копирует только собранные production-файлы из `dist/` в корень репозитория.
- В `package.json` добавлена команда `npm run publish:root` = `npm run build:pages` + `scripts/publish-root.mjs --publish`.
- `.gitignore` продолжает игнорировать `dist/`, но больше не игнорирует `vendor/`. `vendor/` должен попадать в Git, так как при branch-root Pages это production runtime.
- `tests/root_publish_contract.mjs` проверяет прямую схему, проверки manifest, наличие обеих Numbers-страниц и отсутствие workflow files.
- `tests/build_contract.mjs`, `tests/app_contract.mjs`, `tests/dist_contract.mjs` приведены к прямой схеме и проверке Numbers pages.

### Numbers Import / Analytics

- `numbers-import.html`: названия Numbers-категорий и соответствия категорий базы экранируются через `escapeHtml()` перед вставкой в HTML.
- При выборе нового Excel export отключается до успешного импорта; при ошибке парсинга сбрасывается состояние Import.
- Загрузчик `.budget` закрывает старую базу и проверяет новую через временную SQLite-копию; при невалидной базе временный handle закрывается и Import остаётся выключенным.
- `numbers-analytics.html`: названия категорий также экранируются перед вставкой в HTML.
- Добавлен `tests/numbers_import_e2e.mjs`: тестирует Excel preview, XSS category string, загрузку тестовой `.budget`, импорт в отдельную `numbers_history`, скачивание обновлённой базы, проверку количества history rows, сохранность `transactions`, отсутствие добавления незнакомой категории в live categories, повторную замену history и чтение через Financial Analytics.
- `npm run test:e2e` включает существующий app E2E и новый Numbers E2E.

### Документация

- `README_RU.md` переписан: direct main-root publishing, local build, commit/push, no Actions.
- `RESUME_NEXT_STEPS_RU.md` содержит актуальные следующие команды и запреты.
- `CHECKPOINT_CURRENT_RU.md` дополнен новым текущим блоком; историческая документация Actions оставлена ниже как история.
- `TEST_REPORT.md` обновлён, чтобы явно говорить, что актуальные локальные тесты после последних правок пока не запускались.

## 3. Ключевые коммиты этой сессии

- `1010ad37` — удалить Pages deployment workflow.
- `ce5d7018` — удалить workflow подготовки lockfile.
- `cbbc4ea2`, `0b01fa4c`, `b341d64f` — откатить необязательные изменения builder/dist tests из-за перехода к публикации из корня.
- `d0e5fb50` — включить обе Numbers страницы в static build.
- `7f88eb98` — перестать игнорировать `vendor/`.
- `3bd7a41a`, `1c41fce8` — добавить `publish:root` script/команду.
- `369bda47`, `b0fd4eca` — укрепить Numbers Import state и escaping.
- `fd0d075e`, `869451bb`, `57c9c631` — escaping category names in Analytics (последняя правка markup — `57c9c631`).
- `436acc1b`, `f8598e51`, `96edfcae` — добавить Numbers Chromium E2E и включить его в `test:e2e`.
- `e037d1f4`, `ced8f1c9`, `1fd93b63`, `aee0c7cc` — зафиксировать no-Actions architecture и усилить проверки CSP/CDN в builder.
- `823068e3`, `d2e3cb51`, `38c53d62` — обновить resume, current checkpoint и test report.

## 4. Фактическое состояние HEAD

Проверка Git tree `main` на HEAD `38c53d62...` подтвердила:

- `.github/workflows/pages.yml` — отсутствует.
- `.github/workflows/prepare-lockfile.yml` — отсутствует.
- `.github/workflows/` не содержит файлов.
- `index.html`, `numbers-import.html`, `numbers-analytics.html` — есть.
- `scripts/build-pages.mjs`, `scripts/publish-root.mjs` — есть.
- `tests/numbers_import_e2e.mjs`, `tests/root_publish_contract.mjs` — есть.
- `package-lock.json` — есть, не менялся.
- `dist/` — отсутствует и должен оставаться локальным/ignored.
- `vendor/` — **пока отсутствует**; количество tracked vendor files = 0.

## 5. Что ещё НЕ сделано / не подтверждено

1. Не выполнен локальный `npm ci` после последних правок.
2. Не запущены текущие `npm test`, `npm run build:pages`, `npm run test:dist`, `npm run test:e2e`.
3. Не выполнен `npm run publish:root`; поэтому runtime vendor files ещё не скопированы в root `main`.
4. Не подтверждена настройка GitHub Settings → Pages. Нужно вручную проверить `Deploy from a branch`, `main`, `/(root)`.
5. Не выполнен browser smoke test актуального публичного сайта.
6. Не выполнен полный Numbers import → download `.budget` → reopen → analytics на тестовой базе.
7. Safari/iPhone file-open/save не проверены.

Старые успешные artifacts и Actions runs относятся к предыдущей архитектуре. Они не доказывают работоспособность текущего HEAD.

## 6. Следующее действие — локально на Windows

Открыть PowerShell в корне локального клона `Budget-Capture-Web` и выполнить:

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

Назначение шагов:

- `npm ci` — поставить точные зависимости из committed lockfile.
- `verify:lock` — перепроверить lockfile/версии/integrity.
- `npm test` — source contract/regression tests.
- `publish:root` — собрать `dist`, проверить SHA-256 и скопировать production runtime файлы в root, включая `vendor/`.
- `test:dist` — проверить manifest и production files.
- `test:e2e` — Chromium app flow и Numbers import/export/analytics.
- `git status --short` — внимательно проверить список generated changes до commit.

Если команда остановилась на ошибке, не публиковать частичный результат; сначала исправить ошибку и повторить проверки.

### Что ожидается в Git changes после успешного `publish:root`

- Добавятся/обновятся `vendor/`, `.nojekyll`, `asset-manifest.json`, app runtime files и обе Numbers pages.
- Не должно быть `.budget`, `.sqlite*`, `.db`, PDF, XLSX, CSV, backup ZIP или личных JSON.
- `dist/` не должен появиться в staged changes.

После успешных проверок проверить Changes в GitHub Desktop, сделать один обычный commit (например `Prepare direct GitHub Pages root assets`) и Push origin в `main`. Это и есть публикация без Actions.

## 7. Важные ограничения

- Не использовать пользовательскую финансовую базу для первого E2E или smoke test; только синтетическую копию.
- Не менять package pins или `package-lock.json` без причины.
- Не повышать app version выше `0.1.6.0`, пока свежий локальный тест и browser flow не подтверждены.
- Не возвращать GitHub Actions.
- Не игнорировать и не удалять `vendor/`: он обязателен при публикации из корня.
- Не коммитить `dist/`.
- Не говорить, что Pages опубликован или Numbers Import проверен, пока `vendor/` не добавлен, настройки Pages не проверены и браузерный тест не выполнен.

## 8. Точка продолжения

Начать следующий чат с этого файла и `RESUME_NEXT_STEPS_RU.md`. Последний подтверждённый source HEAD на момент checkpoint: `38c53d62ad680dd97da1b360ccbd0a34f7c24d46`.

