# Продолжение работы — Budget Capture Web 0.1.6.0

Начинай с `CHECKPOINT_CURRENT_RU.md` и `TEST_REPORT.md`. Приложение остаётся на версии 0.1.6.0; персональная база не включается в репозиторий или dist.

## Что уже сделано

- Настоящий `package-lock.json` создан и проверен на GitHub-hosted Node 24; SHA-256 и source commit metadata сохранены рядом.
- Пользователь подтвердил успешный GitHub Actions `Build and test (no publication)`.
- Production `dist` artifact получен; его 218 assets сверены с SHA-256 manifest, а 7 основных runtime-файлов совпали с исходниками.
- Source regression `npm test` — 9/9 PASS; `verify:lock` — PASS, 17 package entries.
- Автоматическая публикация при push отключена. Ручной deploy возможен только при `workflow_dispatch` и `deploy=true`.

## Следующие шаги

1. Применить `tests/e2e.mjs` из `Budget-Capture-Web-E2E-RESULT-SYNC-FIX-2026-11-20.zip` к корню локального репозитория.
2. Вместе с ним применить `tests/app_contract.mjs`, `CHECKPOINT_CURRENT_RU.md`, `TEST_REPORT.md`, `README_RU.md`, `RESUME_NEXT_STEPS_RU.md` и `CHANGELOG_0.1.6.0.md` из того же patch ZIP.
3. В GitHub Desktop проверить Changes, commit с сообщением `Harden E2E repeat-import result synchronization`, затем Push origin.
4. Дождаться нового `Build and test (no publication)` и проверить, что Chromium E2E проходит с ожиданием свежего результата повторного импорта.
5. После CI вручную пройти Open → Import → Review → Save → Reopen на копии актуальной пользовательской Windows-базы.
6. Проверить Safari/iPhone open/save отдельно на реальном устройстве.
7. Только после этих проверок решать, повышать ли версию до 0.1.7.0 и публиковать ли Pages.

## Не делать

- Не менять `package-lock.json` без изменения `package.json`.
- Не откатывать `sql.js@1.16.0`, `pdfjs-dist@6.5.438`, SheetJS `0.20.3`, Playwright `1.65.1` и Node 24 Action pins.
- Не включать `deploy=true` и не публиковать Pages до отдельного одобрения.
- Не добавлять `.budget`, SQLite, backup ZIP, PDF, XLSX, CSV, личные JSON или персональные категории/подписи в Git.

