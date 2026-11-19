# Budget Capture Web 0.1.5.1

## Same-origin runtime and CI
- Удалены внешние CDN fallback для sql.js, PDF.js и SheetJS. Production runtime загружает библиотеки только с того же origin.
- Добавлена Content Security Policy для same-origin scripts/workers, локального WASM и блокировки внешних объектов/connections.
- GitHub Pages builder проверяет точные версии прямых зависимостей, копирует vendor assets и формирует SHA-256 asset manifest.
- GitHub Actions запускает исходные тесты, сборку, проверку dist manifest и Chromium E2E; deploy зависит от успешных предыдущих шагов.

## Приватность локального профиля
- Имя владельца новой карты вводится локально свободным текстом; имена людей не перечисляются в форме.
- Номера карт/счетов не зашиваются в runtime JavaScript; существующий справочник берётся из SQLite.
- Собственные SBP counterparty markers хранятся в `web_metadata` выбранной базы. Для существующей Windows-базы значения извлекаются из уже классифицированных внутренних переводов; новая база позволяет заполнить их вручную.
- Исправлен Unicode-поиск SBP marker: начало описания с кириллицей проверяется без ASCII-only `\\b`.
- Удалены личные суммы, source refs и row counts из проектной документации. Пользовательские category/Numbers labels ещё остаются в runtime; их нужно вынести в локальную конфигурацию до публичной публикации.

## Поддерживаемые форматы и подсказки
- Уточнён экран Data & Backup: оба Yandex PDF layout перечислены как поддерживаемые.
- Существующие тесты Sber/Yandex/T-Bank и Windows DB migration/save/reopen продолжают проходить.

## Ограничения проверки
- `npm test` выполняет шесть локальных suite.
- В текущем контейнере npm registry недоступен, поэтому vendor build и Playwright Chromium E2E здесь не запускались.
- Hosted GitHub Actions workflow ещё не запускался; GitHub Pages не опубликован.

## Patch 0.1.5.1
- Исправлена Unicode-граница при сопоставлении локальных SBP counterparty markers.
- Поле владельца новой карты теперь свободно редактируется и не содержит персональные имена в HTML.
- Удалены локальные validation details с персональными row counts, financial totals и source references из проекта; заменены privacy-safe scope notes.
- Добавлена проверка отсутствия известных masked card suffixes в runtime-файлах.
