import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root = path.resolve(new URL('../dist/', import.meta.url).pathname);
const manifestPath = path.join(root, 'asset-manifest.json');
assert(fs.existsSync(manifestPath), 'build must emit asset-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert.equal(manifest.app_version, '0.1.6.0');
assert.equal(manifest.runtime_origin, 'self');
assert.equal(manifest.packages?.['sql.js'], '1.16.0');
assert.equal(manifest.packages?.['pdfjs-dist'], '6.5.438');
assert.equal(manifest.packages?.xlsx, '0.20.3');
assert(fs.existsSync(path.join(root, 'vendor/runtime-manifest.json')), 'build must include a vendor-only runtime integrity manifest');
const runtimeManifest = JSON.parse(fs.readFileSync(path.join(root, 'vendor/runtime-manifest.json'), 'utf8'));
assert.equal(runtimeManifest.format_version, 1);
assert.equal(runtimeManifest.packages?.['sql.js'], '1.16.0');
assert(Object.keys(runtimeManifest.assets || {}).length > 200, 'vendor runtime manifest must cover all vendored resources');
assert.match(manifest.xlsx_source || '', /official SheetJS CDN tarball/);
assert.match(manifest.pdfjs_build || '', /legacy ESM/);
assert.match(manifest.delivery || '', /same-origin/);
for (const [relative, meta] of Object.entries(manifest.assets)) {
  const full = path.join(root, relative);
  assert(fs.existsSync(full), `missing dist asset ${relative}`);
  const data = fs.readFileSync(full);
  assert.equal(data.length, meta.bytes, `size mismatch ${relative}`);
  assert.equal(createHash('sha256').update(data).digest('hex'), meta.sha256, `SHA-256 mismatch ${relative}`);
}
for (const page of ['index.html','numbers-import.html','numbers-analytics.html']) assert(fs.existsSync(path.join(root,page)), `missing built page ${page}`);
const importPage = fs.readFileSync(path.join(root, 'numbers-import.html'), 'utf8');
const analyticsPage = fs.readFileSync(path.join(root, 'numbers-analytics.html'), 'utf8');
assert.match(importPage, /id=\"import-history\"/);
assert.match(importPage, /id=\"export-history\"/);
assert.match(importPage, /vendor\/sql\.js\/sql-wasm\.js/);
assert.match(importPage, /vendor\/xlsx\/xlsx\.full\.min\.js/);
assert.match(analyticsPage, /numbers_history/);
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
assert(!/https?:\/\/(?:cdn\.|cdnjs\.|unpkg\.|jsdelivr\.)/i.test(app), 'production app must not call external CDNs');
for (const asset of ['vendor/sql.js/sql-wasm.js','vendor/sql.js/sql-wasm.wasm','vendor/pdfjs/pdf.mjs','vendor/pdfjs/pdf.worker.mjs','vendor/xlsx/xlsx.full.min.js']) {
  assert(fs.existsSync(path.join(root, asset)), `missing local runtime ${asset}`);
}
for (const license of ['vendor/licenses/sql.js.txt','vendor/licenses/pdfjs-dist.txt','vendor/licenses/sheetjs-ce.txt']) {
  assert(fs.existsSync(path.join(root, license)), `missing third-party license ${license}`);
  assert(fs.statSync(path.join(root, license)).size > 0, `third-party license must not be empty: ${license}`);
  assert(Object.hasOwn(manifest.assets, license), `third-party license must be covered by SHA-256 manifest: ${license}`);
}
for (const directory of ['cmaps','standard_fonts','wasm','iccs']) {
  const prefix = `vendor/pdfjs/${directory}/`;
  const entries = Object.keys(manifest.assets).filter(file => file.startsWith(prefix));
  assert(entries.length > 0, `dist manifest must hash PDF.js ${directory} resources`);
  for (const relative of entries) assert(fs.existsSync(path.join(root, relative)), `missing PDF.js resource ${relative}`);
}
console.log(`Built Pages artifact contract: PASS · ${Object.keys(manifest.assets).length} assets verified by SHA-256`);
