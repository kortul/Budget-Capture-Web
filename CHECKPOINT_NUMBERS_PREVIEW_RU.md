# Budget Capture — Numbers Import Preview checkpoint

**Checkpoint:** Numbers preview improvements committed to `main`.

## Changes
- Added `Numbers history` link in the app header.
- Numbers preview now allows selecting an Excel file and a `.budget` database separately.
- Reads database category names locally from the selected SQLite file using same-origin sql.js.
- Shows exact normalized category matches and flags categories with no match as `New category`.
- Corrected metrics to show distinct category counts rather than counting category-month rows.
- Preview remains read-only; it does not add or modify transactions.


## Verified on supplied files
- Excel workbook contains 907 sheets.
- Parser candidates: monthly `Income` and `Расходы` sheets; excludes helper/summary sheets.
- Local analysis found 2,266 numeric category-month rows, 130 month keys, across 2016–2026.
- These are monthly category totals, not bank transactions; direct transaction import is intentionally not attempted.

## Commits
- Preview + category matching: `66172f473637ac1ffc5e7eff0b4d611e6985e4f9`
- Whitespace normalization correction: `6b56a7a9941581d17806d5f3d6be3593147d9e1c`
- Header link: `982e879285c275bbd64c529ce8f1b406edc0a31b`

## Next verification
- Open `numbers-import.html` on Pages and test Excel + `.budget` selectors together.
- Validate monthly totals and exact matches in browser.
- Do not import reconstructed monthly aggregates into transactions; next feature should be a dedicated historical Numbers data store / analytics view.
