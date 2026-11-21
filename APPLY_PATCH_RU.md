# Применение патча — 20 ноября 2026

Этот ZIP содержит изменённые файлы для текущего GitHub Desktop репозитория Budget Capture Web.

1. Закройте редактор файлов проекта.
2. Распакуйте содержимое ZIP непосредственно в корневую папку локального `Budget-Capture-Web`.
3. Согласитесь заменить одноимённые файлы.
4. В GitHub Desktop проверьте изменения. Ожидаются `tests/e2e.mjs`, `tests/app_contract.mjs` и актуализированные документы.
5. Создайте commit `Harden E2E repeat-import result synchronization`.
6. Нажмите `Push origin`.
7. В GitHub Actions проверьте новый `Build and test (no publication)`.

Патч не меняет runtime-код приложения, package.json, package-lock.json, версию 0.1.6.0 или deploy workflow. GitHub Pages не публикуется.
