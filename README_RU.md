# Budget Capture Web 0.1.6.0

## Профиль категорий и Numbers

Категории, их группы и подписи специальных Numbers-таблиц сохраняются в `web_metadata` внутри открытого `.budget` файла. На вкладке **Data & Backup** можно редактировать группы, менять заголовки таблиц, а также импортировать/экспортировать отдельный JSON профиля. Экспорт профиля не содержит операций, банковских реквизитов или выписок. Новая пустая база получает универсальные безопасные категории. При первом открытии старой SQLite-базы приложение создаёт профиль из категорий базы и истории операций; неоднозначные категории сохраняются как Other до ручной настройки.

Статическое браузерное приложение Budget Capture для работы с локальным переносимым файлом базы данных. GitHub Pages раздаёт только HTML/CSS/JavaScript и закреплённые runtime-библиотеки; банковские документы и сама база обрабатываются локально в браузере.

## Поддерживаемые форматы

- Открытие существующей SQLite-базы Windows Budget Capture (`budget_capture.sqlite3`, `.sqlite3`, `.db`, `.budget`).
- Создание новой базы и сохранение в переносимый файл `.budget`.
- **Sber Online History PDF** — новый печатный формат Sber Online; сохраняются merchant punctuation, корректно классифицируются возвраты и нулевые операции.
- **Yandex Bank PDF** — платёжный счёт с несколькими валютными колонками и накопительный счёт «Сейв» с одной суммой в валюте договора. Печатные итоги сверяются с извлечёнными строками.
- **T-Bank XLSX** — история операций с текстом банка, данными карты, статусом, MCC и дополнительными полями.
- **Raiffeisen CSV** — структурированная история операций.
- Review: изменение merchant/category, запоминание правил по точному банковскому описанию, Completed, фильтры и сортировка, soft-delete и восстановление.
- Numbers: месячные расходы/доходы, дополнительные таблицы и copy-ready значения.
- Recognized Accounts: локальный справочник карт/счетов и владельцев.

Не перенесены из Windows-сборки: legacy Sber card PDFs, сканированные/image-only PDF, OCR и локальная интеграция Ollama.

## Первый перенос Windows-базы

1. В Windows закрой Budget Capture.
2. Запусти `06_Backup_Data.bat` из папки `App`.
3. Из свежего `BudgetCapture_backup_*.zip` извлеки `budget_capture.sqlite3`.
4. Открой сайт, нажми **Open database** и выбери SQLite-файл.
5. Если сайт сообщил о миграции, нажми **Save database** и сохрани новую копию как `MyBudget.budget`.
6. Не открывай разные копии одной базы для одновременного редактирования на нескольких устройствах.

Исходный SQLite читается из выбранного файла в память браузера. Миграции меняют только открытую копию, не исходный файл. Перед сохранением выполняется SQLite integrity check, экспортированный файл повторно открывается и проверяется.

Переход и сохранение проверены на копии реальной Windows-базы. Персональные количества, банковские суммы, имена контрагентов, номера карт и source references намеренно не включены в проектные документы.

## Проверка совместимости

Парсеры Sber, оба макета Yandex и T-Bank сравнивались с соответствующими операциями Windows-базы по source reference, дате, description, merchant, merchant key, amount и transaction type. Для Yandex и T-Bank также проверялась валюта. Печатные итоги обоих Yandex PDF сверялись с извлечёнными строками.

Для Raiffeisen существующие в базе операции совпали с результатами парсера. Часть уникальных source references из CSV отсутствует в текущей базе; причины не установлены. Они не импортируются автоматически задним числом.

Подробные пользовательские результаты сверки не входят в этот репозиторий или release ZIP.

## GitHub Pages

Workflow `.github/workflows/pages.yml` устанавливает закреплённые зависимости, запускает исходные тесты, строит `dist/` с локальными runtime-библиотеками, проверяет SHA-256 manifest и выполняет Playwright Chromium E2E. Push в `main` запускает только job проверки и сборки; готовый `dist/` сохраняется как artifact для инспекции. **Автоматической публикации при push нет.**

Job публикации отделён от проверки и запускается только при ручном `workflow_dispatch` с явно включённым параметром `deploy=true`. По умолчанию этот параметр выключен. Настоящий `package-lock.json` уже получен через `Prepare verified dependency lockfile` и добавлен в `main`. Полный GitHub-hosted validation/build workflow был успешно запущен; production artifact выгружен для проверки. Публикация всё равно остаётся отдельным ручным действием и не запускается в рамках обычного push или проверки.

GitHub Actions использует Node.js 24. Локальные npm scripts поддерживают Node.js 22+; для совпадения с CI используй Node 24. В сети с доступом к npm registry и `cdn.sheetjs.com` lockfile можно создать локально:

```bash
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
npm run verify:lock
```

История bootstrap сохранена в `package-lock-build-info.txt`: lockfile был разрешён на GitHub-hosted Node 24 runner, проверен `verify:lock`, а SHA-256 сверена с `package-lock.sha256`. В репозитории уже находятся `package-lock.json`, checksum и build metadata. Повторно генерировать lockfile без изменения `package.json` не нужно. Workflow подготовки lockfile не устанавливает пакеты, не выполняет lifecycle scripts и не публикует сайт.

После добавления lockfile все установки выполняются строго через:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run verify:lock
npm test
npm run build:pages
npm run test:dist
npm run test:e2e
```

## Работа на разных устройствах

- На Windows, Mac или iPhone открывай одну и ту же актуальную копию `.budget` из iCloud Drive / Google Drive / Files.
- После изменений нажми **Save database**.
- В Chrome/Edge с File System Access API сайт может записать выбранный файл. В Safari/iPhone база скачивается; замени старую копию в Files/Drive и только после этого открывай её на другом устройстве.
- Это перенос файла, а не автоматическая синхронизация. Не редактируй одну базу одновременно на нескольких устройствах: сохранение более старой копии может затереть более новые изменения.

## Приватность и публикация

Финансовая база, банковские документы, распознанные номера счетов, названия контрагентов и локальные SBP-маркеры не должны попадать в Git. Файлы данных и backup исключены в `.gitignore`.

**Профиль и публичный код:** персональные категории, их группы и специальные подписи Numbers хранятся в `web_metadata` конкретного `.budget` файла либо в отдельном JSON-экспорте профиля. В публичном исходном коде находятся только универсальные defaults и логика миграции; персональные подписи из пользовательской базы в него не копируются. Не добавляй `.budget`, `.sqlite*`, `.db`, backup ZIP, PDF, XLSX, CSV или личные JSON exports в GitHub. GitHub Pages остаётся публичным сайтом, поэтому публикуемый архив и `dist/` должны содержать только универсальные настройки и синтетические тестовые данные.

Не добавляй `.budget`, `.sqlite*`, `.db`, backup ZIP, PDF, XLSX, CSV, личные JSON exports или отчёты с source references в Git.

## Текущий статус проверки — 20 ноября 2026

- `npm test`: 9/9 source suites PASS на текущем исходном архиве.
- `npm run verify:lock`: PASS; 17 package entries, точные версии, разрешённые HTTPS hosts и SHA-512 integrity.
- GitHub Actions на Node 24: пользователь подтвердил успешный `Build and test (no publication)`; workflow создал production `dist` artifact.
- Production artifact `budget-capture-dist-1f6ae9bd61194964c93e323d0a52045eb68a1d35.zip`: `npm run test:dist` PASS, 218/218 assets сверены по SHA-256; семь основных runtime-файлов побайтно совпали с исходниками текущего архива.
- Сам artifact содержит локальные sql.js, PDF.js и SheetJS runtime, PDF.js CMaps/fonts/WASM/ICC resources и тексты лицензий; `dist` не содержит SQLite/`.budget` баз, банковских выписок PDF/XLSX/CSV или резервных копий.
- В текущем E2E тесте усилено ожидание результата повторного импорта: теперь он обязан отличаться от первого результата, а счётчики проверяются по связанным label/value элементам. Эта последняя корректировка теста требует нового GitHub Actions запуска.
- Реальная миграция и сохранение пользовательской Windows-базы в браузере, Safari/iPhone file-open/save flow и реальная публикация Pages ещё требуют отдельной ручной проверки.

Публикацию не запускать. `deploy=true` не выбирать до успешного повторного CI после E2E-корректировки и отдельного одобрения.
GitHub Actions in both workflows are pinned to verified full-length commit SHAs; checkout runs with `persist-credentials: false`. Keep these immutable references unless a replacement SHA is checked against the official upstream release and reviewed.
