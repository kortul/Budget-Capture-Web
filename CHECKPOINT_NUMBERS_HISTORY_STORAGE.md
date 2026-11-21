# CHECKPOINT — Numbers History Storage + Financial Analytics
Date: 2026-11-21

## Implemented
- Added SQLite table `numbers_history` to Budget Capture schema. Aggregated monthly Numbers rows remain separate from transactions.
- Numbers Import page now accepts Excel + a .budget SQLite file, previews category matching, imports rows transactionally into numbers_history (replaces previous Numbers source rows), and downloads the updated .budget.
- Download is explicitly required: import happens in the browser copy; the user's original file is untouched until they replace it with the downloaded file.
- Analytics now reads stored numbers_history from a selected .budget instead of requiring Excel.
- JSON backup export/import preserves numbers_history.
- Historical categories that do not match live categories are stored as historical labels only; live category list is unchanged.
- Import is repeatable (delete and replace source='numbers'), no duplicate rows, no modifications to transactions.

## Workflow
1. Numbers history → choose workbook.
2. Choose current .budget.
3. Click Import Numbers history.
4. Download updated .budget and replace/backup the database file.
5. Analytics → select updated .budget.

## Commits
- f6579a65533d78fc72642b459a7b40a28022c41a — schema
- 165545ad482a8e517de4265a71516630ef63bc84 — import/export
- 20dd7b42de0ffbb5dda1bf29ca93b4eab1708ead — transaction/loader fixes
- c35e58650fc7fd75f278daac2517b673be65ad38 — analytics reads database
- 9aa7d38225baef92974602d191bde985f20bd776 — bundled SQL loader
- 09cf80189aa4119457736602323da0d5a0722733 — export file extension
- 6e66c5ecea62f6f53581397f450377bdbe6421fb — workflow clarification
- 8c5aeb76d220220ce29a5b6519c6d0fc17f7c501 — JSON backup support
- 57bf88e3034ec3d3a64cde2b54cbb90235177b59 — category wording

## Not verified
- No browser runtime test, local build, or GitHub Actions run was performed. Test on Pages before relying on the import.
