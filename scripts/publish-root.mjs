import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const publishRequested = process.argv.includes('--publish');

if (!publishRequested) {
  throw new Error('Refusing to copy build output without the explicit --publish flag.');
}
if (!fs.existsSync(path.join(dist, 'asset-manifest.json'))) {
  throw new Error('dist/asset-manifest.json is missing. Run npm run build:pages first.');
}

const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'asset-manifest.json'), 'utf8'));
if (manifest.runtime_origin !== 'self') throw new Error('Build is not configured for same-origin assets.');
if (manifest.app_version !== JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version) {
  throw new Error('Built app version does not match package.json.');
}

const requiredPages = ['index.html', 'numbers-import.html', 'numbers-analytics.html'];
for (const page of requiredPages) {
  if (!Object.hasOwn(manifest.assets || {}, page)) throw new Error(`Build is missing required page: ${page}`);
  if (!fs.existsSync(path.join(dist, page))) throw new Error(`Build output is missing required page: ${page}`);
}

const forbiddenExtensions = new Set(['.budget', '.sqlite', '.sqlite3', '.db', '.pdf', '.xlsx', '.xls', '.csv', '.numbers']);
for (const relative of Object.keys(manifest.assets || {})) {
  const full = path.join(dist, relative);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error(`Manifest asset is missing: ${relative}`);
  const bytes = fs.readFileSync(full);
  const expected = manifest.assets[relative];
  if (bytes.length !== expected.bytes) throw new Error(`Asset size mismatch: ${relative}`);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== expected.sha256) throw new Error(`Asset SHA-256 mismatch: ${relative}`);
  if (forbiddenExtensions.has(path.extname(relative).toLowerCase())) {
    throw new Error(`Refusing to publish private data file: ${relative}`);
  }
}

const outputFiles = [];
function collectFiles(directory, prefix = '') {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) collectFiles(full, relative);
    else if (entry.isFile()) outputFiles.push(relative);
    else throw new Error(`Unsupported generated output: ${relative}`);
  }
}
collectFiles(dist);
if (!outputFiles.includes('asset-manifest.json')) throw new Error('Build manifest is not present in dist/.');

const generatedRoots = new Set(['vendor', 'index.html', 'numbers-import.html', 'numbers-analytics.html', 'styles.css', 'app.js', 'core.js', 'db.js', 'profile.js', 'manifest.webmanifest', '.nojekyll', 'asset-manifest.json']);
for (const relative of outputFiles) {
  const topLevel = relative.split('/')[0];
  if (!generatedRoots.has(topLevel)) throw new Error(`Unexpected generated path; refusing to copy: ${relative}`);
}

for (const target of ['vendor']) {
  fs.rmSync(path.join(root, target), { recursive: true, force: true });
}

for (const relative of outputFiles) {
  const source = path.join(dist, relative);
  const destination = path.resolve(root, relative);
  const backToRoot = path.relative(root, destination);
  if (!backToRoot || backToRoot.startsWith('..') || path.isAbsolute(backToRoot)) {
    throw new Error(`Unsafe publish destination: ${relative}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

console.log(`Prepared direct GitHub Pages root: ${outputFiles.length} files copied from the verified dist build (app ${manifest.app_version}).`);
console.log('Next: inspect git status, commit the generated vendor/ and runtime files, then push main. No GitHub Actions workflow is required.');
