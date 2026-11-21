import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const staging = path.join(root, '.dist-staging');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function copyRequired(source, destination) {
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error(`Required build input is missing: ${path.relative(root, source)}. Run npm install first.`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}
function copyRequiredDirectory(source, destination) {
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    throw new Error(`Required runtime resource directory is missing: ${path.relative(root, source)}. Run npm install first.`);
  }
  const entries = fs.readdirSync(source, { withFileTypes: true });
  if (!entries.length) throw new Error(`Required runtime resource directory is empty: ${path.relative(root, source)}.`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, dereference: true });
}
function listFiles(directory, prefix = '') {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(full, relative));
    else if (entry.isFile()) result.push(relative);
    else throw new Error(`Unsupported file type in build output: ${relative}`);
  }
  return result;
}
function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const expectedVersions = {
  'sql.js': '1.16.0',
  'pdfjs-dist': '6.5.438',
  'xlsx': '0.20.3',
  'playwright': '1.65.1',
};
const expectedSpecs = {
  'sql.js': '1.16.0',
  'pdfjs-dist': '6.5.438',
  'xlsx': 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz',
  'playwright': '1.65.1',
};
for (const [name, expectedSpec] of Object.entries(expectedSpecs)) {
  const actualSpec = pkg.devDependencies?.[name];
  if (actualSpec !== expectedSpec) {
    throw new Error(`Unexpected pinned dependency ${name}: expected ${expectedSpec}, got ${actualSpec || 'missing'}`);
  }
  const installedPackage = path.join(root, 'node_modules', name, 'package.json');
  if (!fs.existsSync(installedPackage)) throw new Error(`Dependency ${name} is not installed. Run npm install first.`);
  const installedVersion = JSON.parse(fs.readFileSync(installedPackage, 'utf8')).version;
  if (installedVersion !== expectedVersions[name]) {
    throw new Error(`Installed dependency ${name} has version ${installedVersion}; expected ${expectedVersions[name]}.`);
  }
}

fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

const runtimeFiles = ['index.html', 'numbers-import.html', 'numbers-analytics.html', 'styles.css', 'app.js', 'core.js', 'db.js', 'profile.js', 'manifest.webmanifest'];
for (const file of runtimeFiles) copyRequired(path.join(root, file), path.join(staging, file));

// All executable browser libraries are served from the same origin as the app.
// This keeps statement parsing local and avoids CDN/script supply-chain fallbacks.
const vendors = [
  ['node_modules/sql.js/dist/sql-wasm.js', 'vendor/sql.js/sql-wasm.js'],
  ['node_modules/sql.js/dist/sql-wasm.wasm', 'vendor/sql.js/sql-wasm.wasm'],
  ['node_modules/pdfjs-dist/legacy/build/pdf.mjs', 'vendor/pdfjs/pdf.mjs'],
  ['node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', 'vendor/pdfjs/pdf.worker.mjs'],
  ['node_modules/xlsx/dist/xlsx.full.min.js', 'vendor/xlsx/xlsx.full.min.js'],
];
for (const [source, destination] of vendors) copyRequired(path.join(root, source), path.join(staging, destination));

// Keep third-party license texts beside the vendored browser runtimes.
const licenseFiles = [
  ['node_modules/sql.js/LICENSE', 'vendor/licenses/sql.js.txt'],
  ['node_modules/pdfjs-dist/LICENSE', 'vendor/licenses/pdfjs-dist.txt'],
  ['node_modules/xlsx/LICENSE', 'vendor/licenses/sheetjs-ce.txt'],
];
for (const [source, destination] of licenseFiles) copyRequired(path.join(root, source), path.join(staging, destination));

// PDF.js may request auxiliary assets for predefined CMaps, standard fonts,
// WebAssembly decoders and ICC profiles. Vendor them from the exact same pinned
// package so strict same-origin CSP and offline statement parsing remain valid.
const pdfResources = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];
for (const directory of pdfResources) {
  copyRequiredDirectory(
    path.join(root, 'node_modules/pdfjs-dist', directory),
    path.join(staging, 'vendor/pdfjs', directory),
  );
}

const versionPayload = {
  app_version: pkg.version,
  packages: Object.fromEntries(Object.entries(expectedVersions).filter(([name]) => name !== 'playwright')),
  xlsx_source: 'official SheetJS CDN tarball, vendored into this build; runtime stays same-origin',
  pdfjs_build: 'legacy ESM build for broader browser compatibility',
  delivery: 'same-origin GitHub Pages assets; no third-party CDN runtime fallback',
};
fs.writeFileSync(path.join(staging, 'vendor', 'versions.json'), JSON.stringify(versionPayload, null, 2) + '\n');
fs.writeFileSync(path.join(staging, '.nojekyll'), '');

const requiredFiles = [
  ...runtimeFiles,
  '.nojekyll',
  ...vendors.map(([, destination]) => destination),
  ...licenseFiles.map(([, destination]) => destination),
  'vendor/versions.json',
];
const resourceFiles = pdfResources.flatMap(directory =>
  listFiles(path.join(staging, 'vendor/pdfjs', directory), `vendor/pdfjs/${directory}`),
);
const expected = [...requiredFiles, ...resourceFiles];
const smallAllowedFiles = new Set([
  ...resourceFiles,
  ...licenseFiles.map(([, destination]) => destination),
]);
const assets = {};
for (const relative of expected.filter(file => file !== '.nojekyll')) {
  const full = path.join(staging, relative);
  if (!fs.existsSync(full)) throw new Error(`Pages output is incomplete: ${relative}`);
  const stat = fs.statSync(full);
  const minimumBytes = smallAllowedFiles.has(relative) ? 1 : 100;
  if (!stat.isFile() || stat.size < minimumBytes) throw new Error(`Pages asset appears empty or invalid: ${relative} (${stat.size} bytes)`);
  assets[relative] = { bytes: stat.size, sha256: sha256(full) };
}
fs.writeFileSync(path.join(staging, 'asset-manifest.json'), JSON.stringify({
  app_version: pkg.version,
  runtime_origin: 'self',
  packages: versionPayload.packages,
  xlsx_source: versionPayload.xlsx_source,
  pdfjs_build: versionPayload.pdfjs_build,
  delivery: versionPayload.delivery,
  assets,
}, null, 2) + '\n');

const appJs = fs.readFileSync(path.join(staging, 'app.js'), 'utf8');
const htmlPages = ['index.html', 'numbers-import.html', 'numbers-analytics.html']
  .map(file => [file, fs.readFileSync(path.join(staging, file), 'utf8')]);
for (const [file, html] of htmlPages) {
  if (!html.includes("default-src 'self'") || !html.includes("script-src 'self'")) {
    throw new Error(`Content Security Policy is missing or not same-origin in ${file}.`);
  }
  if (/https?:\/\/(?:cdn\.|cdnjs\.|unpkg\.|jsdelivr\.)/i.test(html)) {
    throw new Error(`An external CDN reference remains in ${file}.`);
  }
}
if (/https?:\/\/(?:cdn\.|cdnjs\.|unpkg\.|jsdelivr\.)/i.test(appJs)) {
  throw new Error('An external CDN reference remains in the production app runtime.');
}
fs.rmSync(output, { recursive: true, force: true });
fs.renameSync(staging, output);
console.log(`GitHub Pages build complete: ${Object.keys(assets).length} files hashed in dist/ (app ${pkg.version}).`);
