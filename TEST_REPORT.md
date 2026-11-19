# Test report — Budget Capture Web 0.1.6.0

**Дата последнего запуска:** 19 ноября 2026.

## Source regression suites

| Suite | Result |
|---|---|
| `tests/core_smoke.mjs` | PASS |
| `tests/profile_migration.mjs` | PASS |
| `tests/db_roundtrip.mjs` | PASS |
| `tests/app_contract.mjs` | PASS |
| `tests/build_contract.mjs` | PASS |
| `tests/lockfile_guard.mjs` | PASS |
| `tests/lockfile_workflow_contract.mjs` | PASS |
| `tests/windows_compat.mjs` | PASS |
| `tests/yandex_pdf.mjs` | PASS |

`node --check` для всех runtime-модулей, build scripts и test scripts — PASS.
Separate privacy scan against the migrated profile: 37 private-only labels/captions checked; 0 exact/token-boundary matches in public project files — PASS.

## Release checks

| Check | Result | Details |
|---|---|---|
| `npm test` | PASS | 9/9 source suites |
| `npm run build:pages` | BLOCKED | `node_modules/sql.js` отсутствует в реальном проектном каталоге |
| Synthetic build fixture + `test:dist` | PASS (STRUCTURAL ONLY) | 20 фиктивных assets, включая вспомогательные PDF.js ресурсы и лицензии; проверяет builder/manifest, не валидирует реальные библиотеки |
| `npm run verify:lock` | BLOCKED | `package-lock.json` отсутствует |
| `npm run test:dist` | BLOCKED | `dist/asset-manifest.json` ещё не создан |
| Chromium E2E | NOT RUN | системная Chromium URLBlocklist мешает навигации |
| GitHub Pages | NOT VERIFIED | deployment не запускался |
| iPhone Safari | NOT VERIFIED | требуется ручной тест на устройстве |

## Security maintenance

- SQLite pin: `sql.js@1.16.0` (released 10 Nov 2026; SQLite 3.54.1); app explicitly sets `useOldExtensionFunctions: true` to preserve legacy math/string behavior. Lockfile guard rejects the previous 1.13.0 pin.
- SheetJS CE pin: официальный `xlsx-0.20.3.tgz`.
- PDF.js pin: `pdfjs-dist@6.5.438`, legacy ESM API + matching worker.
- PDF extraction uses `isEvalSupported: false`.
- PDF.js auxiliary resources: builder и dist contract проверяют CMaps, standard fonts, WASM и ICC assets; парсер указывает same-origin URLs, E2E скачивает representative-файлы каждого типа. Manifest также публикует проверяемые package versions и источник SheetJS.
- Production `dist` сохраняет лицензии sql.js, PDF.js и SheetJS рядом с vendored runtime; license files входят в SHA-256 manifest и проходят проверку на непустое содержимое.
- E2E содержит assertions для package versions и same-origin assets, но ещё не был исполнен в Chromium.

## Private database

Персональная `.budget` база и профиль не включены в публичный ZIP. Прежняя read-only проверка базы зафиксирована в предыдущем checkpoint; текущий пакет не содержит SQLite / `.budget` / backup / statement exports.


## Lockfile security guard

`tests/lockfile_guard.mjs` проверяет сравнение зависимостей без зависимости от порядка ключей, SHA-512 для всех транзитивных пакетов, HTTPS и allowlist официальных хостов, точные версии sql.js 1.16.0 / PDF.js / SheetJS / Playwright; старый sql.js 1.13.0 явно отклоняется.


## Lockfile bootstrap workflow

`.github/workflows/prepare-lockfile.yml` is manually triggered. It creates `package-lock.json` with `--package-lock-only --ignore-scripts`, runs `npm run verify:lock` before exporting, and attaches `package-lock.json`, SHA-256 and source commit metadata as an artifact. It does not install package contents and never deploys Pages. The workflow contract is covered by `tests/lockfile_workflow_contract.mjs`.


## Dependency freshness review — 19.11.2026

- `sql.js@1.16.0` is now pinned across package/build/lockfile validators. The app explicitly retains legacy extension functions for compatibility.
- Official release/package references were checked for sql.js 1.16.0, pdfjs-dist 6.5.438, SheetJS CE 0.20.3 and Playwright 1.65.1.
- Real npm tarballs were not downloaded in this execution environment. The synthetic build fixture reuses placeholder runtime files; it is structural validation only.
GitHub Actions in both workflows are pinned to verified full-length commit SHAs; checkout runs with `persist-credentials: false`. Keep these immutable references unless a replacement SHA is checked against the official upstream release and reviewed.

## GitHub Actions Node 24 refresh — 19.11.2026

- `pages.yml` и `prepare-lockfile.yml` используют Node 24.
- Все direct `uses:` dependencies закреплены полными 40-character SHA.
- Action release/metadata reviewed: checkout v7.0.1, setup-node v7.1.0, configure-pages v6.0.0, upload-pages-artifact v5.0.0, deploy-pages v5.0.1, upload-artifact v6.0.0. The Pages artifact composite action itself pins nested upload-artifact v7.0.0.
- `tests/lockfile_workflow_contract.mjs` now checks exact refs and Node 24 setup.
- Both workflow YAML files parse successfully.
- This does not mean the workflows have run in the user's GitHub repository; no lockfile was generated and no Pages deploy was performed.


## Latest checkpoint validation — 19.11.2026

| Validation | Result |
|---|---|
| `npm test` | PASS — 9/9 source suites |
| JS/MJS syntax | PASS — runtime, scripts and tests |
| GitHub Actions YAML parse | PASS — both workflows |
| Direct Action pin audit | PASS — 8/8 `uses:` entries use full 40-character SHAs |
| Node 24 workflow contract | PASS — exact versions/pins checked in contract test |
| Synthetic `build:pages` | PASS — 20 assets generated in fixture only |
| Synthetic `test:dist` | PASS — 20/20 SHA-256 entries verified |
| Real npm install / lockfile | NOT RUN — no lockfile or vendor dependencies available |
| Chromium E2E / Pages deploy / iPhone Safari | NOT RUN / NOT VERIFIED |

Action refs and runtime metadata are documented in `GITHUB_ACTIONS_NODE24_REVIEW_2026-11-19_RU.md`. Do not interpret the synthetic build as a real production build.

## Independent local recheck — 19.11.2026 (after Node 24 Action refresh)

Environment: Node.js `v22.16.0`, npm `10.9.2`; this was not the GitHub-hosted Node 24 runner.

| Check | Result | Details |
|---|---|---|
| Original checkpoint ZIP checksum | PASS | SHA-256 matched `e6b2412e316ec7e88af4655e219c69ca421f6c49b1ae99dbcba89e29bf0c95e3` |
| Project archive contents | PASS | 41 files |
| `npm test` | PASS | 9/9 source suites |
| JS/MJS syntax | PASS | all project JS/MJS files |
| Workflow YAML parse | PASS | both workflow files |
| Immutable Action refs | PASS | 8/8 direct `uses:` entries have 40-character SHAs |
| Local lockfile generation | BLOCKED | npm registry DNS returned `EAI_AGAIN`; no partial lockfile was created |
| `npm run verify:lock` | BLOCKED | `package-lock.json` is absent, as expected |
| `npm run build:pages` | BLOCKED | `node_modules/sql.js` is absent |

No project runtime code changed during this recheck. The only next step remains the manual GitHub-hosted lockfile workflow; do not synthesize a lockfile or bypass `verify:lock`.

## Publication gate regression — 19.11.2026

| Check | Result | Details |
|---|---|---|
| `npm test` after workflow split | PASS | 9/9 source suites; new assertions prevent push-triggered deployment |
| Pages workflow YAML parse | PASS | `validate` and `deploy` jobs parse |
| Direct immutable Action pins | PASS | 10/10 full 40-character SHAs across both workflows |
| Push-to-main behavior | PASS (CONTRACT) | validation/build only; no Pages deployment step in validation job |
| Manual deploy input | PASS (CONTRACT) | `workflow_dispatch` boolean `deploy`, default `false` |
| Deployment permissions | PASS (CONTRACT) | `pages: write` and `id-token: write` only in the isolated deploy job |
| Validated dist transfer | PASS (CONTRACT) | validation uploads by commit SHA; manual deploy downloads same artifact and depends on successful validation |

The validation above is local/source-contract evidence, not an actual GitHub-hosted run. The deploy job was deliberately not triggered.
