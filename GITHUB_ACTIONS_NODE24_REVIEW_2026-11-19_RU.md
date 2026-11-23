# GitHub Actions — Node 24 pin review

**Дата проверки:** 19 ноября 2026  
**Проект:** Budget Capture Web 0.1.6.0

Все внешние Actions в обоих workflow закреплены полными 40-символьными commit SHA. Сами Actions и nested composite dependency сверены с официальными upstream release/metadata.

| Использование | Release | Immutable commit SHA | Runtime / заметка |
|---|---|---|---|
| `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` | Node 24 |
| `actions/setup-node` | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` | Action runtime Node 24; installs project Node 24 |
| `actions/configure-pages` | v6.0.0 | `45bfe0192ca1faeb007ade9deae92b16b8254a0d` | Node 24 |
| `actions/upload-pages-artifact` | v5.0.0 | `fc324d3547104276b827a68afc52ff2a11cc49c9` | Composite action; internally pins upload-artifact v7.0.0 |
| nested `actions/upload-artifact` used by Pages artifact action | v7.0.0 | `bbbca2ddaa5d8feaa63e36b76fdaad77386f024f` | Node 24 |
| `actions/deploy-pages` | v5.0.1 | `368f82528645a54fb793d4d04e342629a3f51346` | Node 24 |
| `actions/upload-artifact` in lockfile bootstrap and validation artifact export | v6.0.0 | `b7c566a772e6b6bfb58ed0dc250532a479d7789f` | Node 24 |
| `actions/download-artifact` in manual deploy job | v8.0.2 | `9000827ccba6bdab643e8b6fd33ac0654aef8333` | Node 24 |

## Sources checked

- Checkout v7.0.1 release: https://github.com/actions/checkout/releases/tag/v7.0.1
- Checkout action metadata: https://raw.githubusercontent.com/actions/checkout/3d3c42e5aac5ba805825da76410c181273ba90b1/action.yml
- setup-node v7.1.0 release: https://github.com/actions/setup-node/releases/tag/v7.1.0
- setup-node action metadata: https://raw.githubusercontent.com/actions/setup-node/949feb2413d6458794dcd2491c4babbbce0c15c1/action.yml
- configure-pages v6.0.0 release and metadata: https://github.com/actions/configure-pages/releases/tag/v6.0.0
- upload-pages-artifact v5.0.0 release and metadata: https://github.com/actions/upload-pages-artifact/releases/tag/v5.0.0
- nested upload-artifact v7.0.0 metadata: https://raw.githubusercontent.com/actions/upload-artifact/bbbca2ddaa5d8feaa63e36b76fdaad77386f024f/action.yml
- deploy-pages v5.0.1 release and metadata: https://github.com/actions/deploy-pages/releases/tag/v5.0.1
- upload-artifact v6.0.0 release and metadata: https://github.com/actions/upload-artifact/releases/tag/v6.0.0
- download-artifact v8.0.2 latest release: https://github.com/actions/download-artifact/releases/tag/v8.0.2
- download-artifact v8.0.2 immutable action metadata: https://github.com/actions/download-artifact/blob/9000827ccba6bdab643e8b6fd33ac0654aef8333/action.yml

## Validation status

- `.github/workflows/pages.yml` uses Node 24 and only full-length immutable Action SHAs.
- `.github/workflows/prepare-lockfile.yml` uses Node 24 and only full-length immutable Action SHAs.
- `.github/workflows/pages.yml` separates validation and deployment. Pushes to `main` cannot deploy; the deploy job requires a manual `workflow_dispatch` with `deploy=true` (default is `false`). Its artifact download uses `actions/download-artifact@v8.0.2`, whose pinned metadata declares Node 24.
- Checkout credentials are not persisted (`persist-credentials: false`).
- The workflow contract test checks expected refs, Node 24 configuration, and the no-auto-deploy gate.
- Both YAML files parse successfully with PyYAML.
- This is source/workflow validation only. The workflows have not yet been run in the user's GitHub repository.


## Quality workflow — 23 ноября 2026

- `.github/workflows/quality.yml` переведён на проверенные immutable refs `actions/checkout@v7.0.1` (`3d3c42e5aac5ba805825da76410c181273ba90b1`) и `actions/setup-node@v7.1.0` (`949feb2413d6458794dcd2491c4babbbce0c15c1`).
- Checkout настроен с `persist-credentials: false`: workflow только читает исходники и не нуждается в сохранённом GitHub token для последующих команд.
- Проектный Node.js runtime оставлен на 22; Node 24 используется для самих GitHub Actions.
