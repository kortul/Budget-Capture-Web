# Продолжение работы — Budget Capture Web 0.1.6.0

**Актуальная архитектура на 21 ноября 2026:** GitHub Pages публикует напрямую из `main` → `/(root)`. GitHub Actions не используются. Не создавать workflow и не возвращать Actions без отдельной просьбы пользователя.

## Что уже сделано

- Удалены `.github/workflows/pages.yml` и `.github/workflows/prepare-lockfile.yml`.
- Удалён устаревший `tests/lockfile_workflow_contract.mjs`; `npm test` больше не зависит от Actions.
- В `scripts/build-pages.mjs` в production build включены все три HTML-страницы: `index.html`, `numbers-import.html`, `numbers-analytics.html`.
- Добавлен безопасный `scripts/publish-root.mjs` и команда `npm run publish:root`. Скрипт проверяет manifest, версии, SHA-256, обязательные страницы и запрещённые финансовые файлы перед копированием production assets из `dist/` в корень.
- `vendor/` удалён из `.gitignore` и должен быть закоммичен: GitHub Pages раздаёт локальные runtime-библиотеки из корня `main`.
- Numbers Import исправлен: при смене базы/Excel сбрасывается состояние Export; ошибочная SQLite-копия закрывается; категории из Excel/SQLite экранируются перед выводом в HTML.
- Financial Analytics также экранирует категории перед выводом.
- Добавлен `tests/numbers_import_e2e.mjs`: проверяет XLSX preview, импорт истории в отдельную таблицу, Download `.budget`, повторный импорт без дублей, неизменность `transactions`, неизменность live categories и чтение аналитикой.
- `npm run test:e2e` включает обычный app E2E и новый Numbers E2E.
- `README_RU.md` переписан под прямую публикацию из `main` без Actions.
- Существующий `package-lock.json` не менялся; версия приложения остаётся 0.1.6.0.

## Следующий обязательный шаг на локальной Windows-машине

В PowerShell из корня клонированного репозитория:

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

`npm run publish:root` копирует проверенные production-файлы из `dist/` в корень проекта. Команда не делает commit и не отправляет данные в Git сама. После её выполнения открыть GitHub Desktop и внимательно проверить список изменений.

Ожидается появление/обновление `vendor/`, `.nojekyll`, `asset-manifest.json`, `numbers-import.html`, `numbers-analytics.html` и runtime-файлов. Не добавлять `.budget`, `.sqlite*`, `.db`, PDF, XLSX, CSV, backup ZIP или личные JSON.

Затем сделать обычный commit и Push origin в `main`. При корректной настройке GitHub Pages `Deploy from a branch → main → /(root)` сайт опубликуется без Actions.

## Что ещё не подтверждено

- `vendor/` ещё отсутствует в корне ветки `main`: пока не выполнен локальный `npm run publish:root` с реальными `node_modules`.
- Настройка Settings → Pages не прочитана текущим GitHub-коннектором; проверить вручную `Deploy from a branch`, `main`, `/(root)`.
- Актуальный публичный сайт и две Numbers-страницы не проверены через настоящий браузер.
- Новые тесты `npm test`, `test:dist`, app Chromium E2E и Numbers Chromium E2E в этой сессии не запускались. Нельзя заявлять PASS до реального локального запуска.
- После публикации нужно проверить на тестовой копии базы полный цикл Excel → import → download `.budget` → повторное открытие → Financial Analytics. Проверить отдельно, что `transactions` не меняется.
- Safari/iPhone open/save flow остаётся отдельной ручной проверкой.

## Не делать

- Не использовать GitHub Actions для сборки или публикации.
- Не запускать и не восстанавливать `deploy=true`, workflow_dispatch или Pages workflow.
- Не коммитить `dist/`: это временный build output, он игнорируется.
- Не игнорировать и не удалять `vendor/`: эти файлы обязательны для прямой публикации.
- Не менять версии зависимостей или `package-lock.json` без необходимости.
- Не повышать приложение до 0.1.7.0, пока импорт/экспорт и Analytics не проверены на тестовой базе.
- Не работать с единственной пользовательской базой; все проверки выполнять на отдельной копии.
