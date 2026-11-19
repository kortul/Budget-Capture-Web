# Budget Capture Web — checkpoint 0.1.5.1

**Дата:** 18 ноября 2026
**Статус:** исходный код и шесть Node regression suite проверены. Реальные Windows SQLite и банковские источники использовались локально для field-parity проверки. Browser runtime, hosted CI и GitHub Pages deployment ещё не подтверждены.

## Архитектура

- Статический GitHub Pages frontend; собственного backend не требуется.
- SQLite через sql.js/WebAssembly в браузере.
- Один переносимый `.budget` файл пользователь вручную открывает и сохраняет на Windows/Mac/iPhone.
- Не редактировать копии базы одновременно на нескольких устройствах.
- Личная база и исходные выписки не входят в project ZIP.

## Настоящая Windows-база

- Миграция, экспорт, повторное открытие и SQLite `quick_check` выполнены на копии настоящей Windows-базы.
- Существующие транзакции, категории, category/merchant rules, recognized accounts, import batches, soft-deleted rows и recovery history сохранены.
- Исходный backup не изменялся.
- Старые операции внутренних переводов нормализуются по Windows-совместимым правилам.
- Имена собственных SBP-контрагентов извлекаются только из уже классифицированных внутренних переводов и хранятся в локальной таблице `web_metadata`; они не зашиты в runtime JavaScript.

## Реальные банковские документы

- Sber Online History: после фиксов проверяемые поля совпадают с Windows; завершающий дефис merchant, возвраты и нулевые операции классифицируются согласованно.
- Yandex: оба PDF-макета сравнивались с Windows; печатные итоги сверялись с извлечёнными операциями.
- T-Bank: XLSX-парсер сравнивался с Windows, включая source IDs, Excel serial dates и поля карты/сообщения.
- Raiffeisen: текущие операции, найденные в базе, совпали; часть refs из исходных CSV не представлена в базе, причина не установлена. Не импортировать их автоматически задним числом.

Все персональные суммы, числа операций, имена, masked account identifiers и source references исключены из этого checkpoint.

## Автоматические проверки

`npm test` выполняет шесть suite: core smoke, DB roundtrip, app contract, Pages build contract, Windows compatibility и Yandex PDF tests.

## Незавершённое

1. В текущем контейнере npm registry недоступен; локальная сборка vendor зависимостей не выполнена.
2. Headless Chromium navigation ограничен политикой контейнера; E2E, включая проверку PDF.js worker/text extraction, должен выполниться в hosted GitHub Actions.
3. iPhone Safari open/save flow не проверен на физическом устройстве.
4. GitHub repository не подключён; Pages не опубликован.
5. До публичной публикации нужно перенести персонализированные названия категорий и Numbers labels из runtime JS в локальную конфигурацию `.budget`.

## Продолжение

1. Запустить exact dependency install, `npm test`, `npm run build:pages`, `npm run test:dist` и `npm run test:e2e` в GitHub Actions.
2. Убедиться, что deploy заблокирован при любом fail.
3. Перенести персонализированные labels в local DB settings перед публикацией исходников.
4. Вручную проверить Safari/iPhone и открытие/сохранение переносимого файла.
