# Продолжение разработки — Budget Capture Web 0.1.6.0

Начинай с `CHECKPOINT_CURRENT_RU.md`. Профиль категорий завершён; не повторяй миграцию и не возвращай персональные подписи в публичный код.

## Следующий приоритет: воспроизводимая release-сборка

1. Использовать текущую ветку с pin `sql.js@1.16.0` и проверить, что все изменения включены в отправляемый проект; не восстанавливать старый pin 1.13.0.
2. Отправить исходный проект в GitHub (без персональных файлов) и открыть Actions.
3. Запустить вручную **Prepare verified dependency lockfile**.
4. Скачать artifact, проверить `package-lock.sha256` и source commit в `package-lock-build-info.txt`.
5. Добавить выданный `package-lock.json` в корень проекта, закоммитить и отправить в `main`.
6. Проверить `npm run verify:lock`, затем `npm ci --ignore-scripts --no-audit --no-fund`.
7. Установить Playwright Chromium.
8. Запустить последовательно `npm test`, `npm run build:pages`, `npm run test:dist`, `npm run test:e2e`.
9. Проверить отсутствие внешних runtime CDN requests и совпадение API/worker PDF.js.
10. Проверить GitHub Actions validation и artifact `dist`; deployment пока не запускать.
11. Отдельно пройти Open → Import → Review → Save → Reopen на Windows и Safari/iPhone.

## Подтверждённые проверки

- Source regression: 9/9 PASS.
- `node --check` всех runtime-модулей: PASS.
- Build contract, security dependency pins и unit tests для lockfile guard: PASS.
- `sql.js` pin обновлён до 1.16.0 (10.11.2026); app явно использует `useOldExtensionFunctions: true` для сохранения совместимости SQLite function semantics. Lockfile guard отдельно отклоняет старый pin 1.13.0.
- Builder + `test:dist` на свежем синтетическом fixture: PASS; 20 assets проверены через SHA-256 (структура, не production runtime).
- Права/лицензии vendored sql.js, PDF.js и SheetJS копируются в `dist/vendor/licenses/` и включены в manifest.
- Приватная база/профиль отделены от публичного архива.

## Текущие blockers

- Нет `package-lock.json`.
- Нет установленных npm dependencies (`node_modules`).
- `npm run build:pages` не создаёт dist без `sql.js` и других vendor files.
- `npm run test:dist` нельзя интерпретировать как готовый результат, пока dist не создан.
- Chromium E2E, GitHub Pages и iPhone Safari не подтверждены.

Не объявляй 0.1.7.0 готовой, пока все release checks не пройдут.

## Не публиковать

- `.budget`, SQLite, backups, PDF/XLSX/CSV и персональные JSON.
- Личные категории и имена специальных Numbers таблиц.


## Обновление 19.11.2026 — bootstrap для lockfile

Из-за недоступности npm registry в локальной среде добавлен отдельный ручной workflow `.github/workflows/prepare-lockfile.yml`. После отправки проекта в GitHub его можно запустить через Actions → Prepare verified dependency lockfile → Run workflow. Workflow выполняет `npm install --package-lock-only --ignore-scripts`, запускает `npm run verify:lock`, считает SHA-256 и публикует `package-lock.json`, checksum и метаданные source commit / Node / npm как artifact. Он не устанавливает пакеты, не выполняет lifecycle scripts и не деплоит Pages.

После успешного запуска: скачать artifact, проверить checksum, добавить `package-lock.json` в корень проекта, закоммитить и отправить его в `main`. Только затем запускать Pages workflow. Если resolver добавит неожиданный registry host, версию или пакет без SHA-512, verifier остановит workflow — не отключать проверку ради зелёного статуса.
GitHub Actions in both workflows are pinned to verified full-length commit SHAs; checkout runs with `persist-credentials: false`. Keep these immutable references unless a replacement SHA is checked against the official upstream release and reviewed.

## Обновление workflow — Node 24 (19.11.2026)

Оба workflow обновлены с Node 20-era action releases на проверенные Node 24-compatible релизы, все прямые `uses:` закреплены immutable full SHA. См. `GITHUB_ACTIONS_NODE24_REVIEW_2026-11-19_RU.md`.

При продолжении не откатывать Node 24 pins. Следующий практический шаг остаётся прежним: загрузить проект в GitHub, запустить `Prepare verified dependency lockfile`, скачать artifact и добавить проверенный `package-lock.json`. Затем запустить Pages CI на GitHub-hosted runner. Реальный workflow ещё не был запущен.


## Current checkpoint refresh — Node 24 Actions

Keep the reviewed Node 24 Action pins. See `GITHUB_ACTIONS_NODE24_REVIEW_2026-11-19_RU.md` for the exact immutable SHAs and official metadata. Latest local verification: 9/9 source suites; JS/MJS syntax; both workflow YAML files; all direct Action SHA pins; synthetic Pages build + dist contract (20 assets). This does not replace the real GitHub-hosted run.

Next: push this public source-only project to GitHub; run **Prepare verified dependency lockfile**; verify and commit the resulting `package-lock.json`; then let the push-triggered Pages workflow run validation, real `npm ci`, vendor build and Chromium E2E. It uploads the built `dist` as an artifact but does not deploy. Deployment requires a separate manual run with `deploy=true`, and must remain off until explicitly approved.

## Последняя независимая проверка — 19.11.2026

Архив исходной Node 24 checkpoint повторно сверён по SHA-256; совпадение. 41 файл. Локально `npm test` повторно прошёл 9/9, JS/MJS syntax и оба YAML parse прошли, 10/10 Action pins остались immutable (после добавления download-artifact v8.0.2). Среда этой проверки — Node 22.16.0 / npm 10.9.2, не Node 24 runner.

Повторный `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` не смог разрешить `registry.npmjs.org` (`EAI_AGAIN`); lockfile не появился. `verify:lock` ожидаемо blocked без lockfile, production builder blocked без `node_modules/sql.js`.

**Не повторять локальную попытку и не создавать lockfile вручную.** Следующий реальный шаг — загрузить source-only ZIP в GitHub, запустить `Prepare verified dependency lockfile`, проверить checksum и source commit артефакта, закоммитить lockfile в `main`; затем дать Pages workflow выполнить полный CI. Публикацию вручную не запускать до прохождения проверок.

## Публикация намеренно отключена по умолчанию

`pages.yml` теперь запускает при push в `main` только validation/build. `deploy` вынесен в отдельный job с условием `github.event_name == 'workflow_dispatch' && inputs.deploy == true`; boolean input `deploy` имеет default `false`. Для обычной проверки не включай его. Это позволяет получить реальный GitHub-hosted CI после добавления lockfile, не публикуя сайт автоматически.

## Обновлённая схема GitHub Pages — publication gate

Важно: прежний автоматический deploy на push в `main` удалён. Новый `pages.yml` на push выполняет только `validate` (npm ci, tests, build, dist checks, Chromium E2E) и сохраняет `dist` как artifact. Job `deploy` запускается только отдельным ручным `workflow_dispatch` с `deploy=true`; default input — `false`.

Поэтому после добавления проверенного `package-lock.json` в `main` сайт не будет опубликован. Сначала нужно изучить результат validate job и `dist` artifact. Не устанавливай `deploy=true`, пока публикация отдельно не одобрена.
