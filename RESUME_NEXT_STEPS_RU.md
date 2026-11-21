# Продолжение работы — Budget Capture Web 0.1.6.0

> Сначала открыть [CHECKPOINT_DIRECT_PAGES_2026-11-21_RU.md](CHECKPOINT_DIRECT_PAGES_2026-11-21_RU.md) и [VENDOR_RUNTIME_RECOVERY_2026-11-21_RU.md](VENDOR_RUNTIME_RECOVERY_2026-11-21_RU.md). Актуальный путь публикации — `main` → `/(root)`, без GitHub Actions.

## Текущий статус

- Pages workflows удалены; не восстанавливать Actions.
- Build включает `index.html`, `numbers-import.html`, `numbers-analytics.html`.
- Добавлен `publish:root`: проверяет production manifest и переносит только manifest-listed файлы из `dist/` в корень.
- Publisher теперь требует точное совпадение набора файлов и asset manifest; rejects unmanifested files.
- Build поддерживает два источника runtime: pinned `node_modules` или проверенный `vendor/` bundle. В fallback проверяются версии, точный список из 212 файлов и SHA-256.
- `vendor/` должен быть закоммичен, `dist/` остаётся ignored.
- Добавлены исправления Numbers Import/Analytics и отдельный Chromium E2E для import/export/history replacement/transactions unchanged/analytics.
- Приложение остаётся `0.1.6.0`; `package-lock.json` не менялся.

## Runtime bundle

В текущем разговоре приложен архив `Budget-Capture-vendor-runtime-0.1.6.0.zip`. Он содержит только `vendor/`, README, `Install-Vendor.ps1` и SHA-256 list. Перед упаковкой были проверены все 218 файлов исходного production artifact; все размеры и SHA-256 совпали. В bundle 212 vendor-файлов, SHA-256 перепроверены после упаковки. Он не содержит финансовых данных.

Чтобы восстановить runtime на Windows: извлечь архив и запустить `Install-Vendor.ps1 -ProjectRoot 'C:\path\to\Budget-Capture-Web'`. Скрипт откажется перезаписывать существующий `vendor/`, если явно не передать `-ReplaceExistingVendor`.

## Следующий шаг — preferred path with npm access

PowerShell в корне клона:

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

После `publish:root` проверь Changes, убедись, что `vendor/`, `.nojekyll`, `asset-manifest.json`, обе Numbers-страницы и runtime-файлы добавляются в корень, а `dist/` не попадает в Git. Затем commit + Push origin.

## Alternative without npm registry access

После установки проверенного `vendor/` bundle можно выполнить:

```powershell
npm test
npm run publish:root
npm run test:dist
git status --short
```

В этом режиме builder использует `vendor/runtime-manifest.json` и сверяет все runtime SHA-256. `test:e2e` не запускается без Playwright. Не заявлять Chromium E2E как PASS, пока он реально не запущен на среде с Playwright.

## Не подтверждено

- Новые tests/build/fallback ещё не выполнялись на локальной машине пользователя.
- `npm test`, `npm run publish:root`, `npm run test:dist` и Chromium E2E на текущем HEAD не запускались.
- `vendor/` ещё не добавлен в GitHub main; bundle подготовлен и выдан как attachment в этом чате.
- Settings → Pages не прочитаны через интеграцию; вручную проверить `Deploy from a branch`, `main`, `/(root)`.
- Не проверены реальные опубликованные страницы и пользовательский browser flow.
- Не проверены Safari/iPhone open/save.

## Не делать

- Не использовать GitHub Actions и не добавлять workflows.
- Не коммитить `dist/`.
- Не игнорировать `vendor/`.
- Не добавлять `.budget`, SQLite, PDF, XLSX, CSV, backup ZIP или персональный JSON.
- Не повышать версию до `0.1.7.0`, пока импорт/экспорт и Analytics не проверены.
- Все тесты базы выполнять на синтетической или отдельной копии.
