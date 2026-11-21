import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const builder = fs.readFileSync(path.join(root, 'scripts/build-pages.mjs'), 'utf8');
const publisher = fs.readFileSync(path.join(root, 'scripts/publish-root.mjs'), 'utf8');
const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README_RU.md'), 'utf8');

assert.match(pkg.scripts['publish:root'], /npm run build:pages && node scripts\/publish-root\.mjs --publish/);
assert.match(builder, /'numbers-import\.html'/, 'Numbers import page must be included in static build');
assert.match(builder, /'numbers-analytics\.html'/, 'Numbers analytics page must be included in static build');
assert.match(publisher, /asset-manifest\.json/, 'root publisher must require the generated asset manifest');
assert.match(publisher, /SHA-256 mismatch/, 'root publisher must recheck every asset hash before copying');
assert.match(publisher, /allowedOutputFiles/, 'root publisher must treat the manifest as an exact output allow-list');
assert.match(publisher, /Unmanifested file in build output/, 'root publisher must reject extra files not covered by the manifest');
assert.match(publisher, /Manifested output file is missing/, 'root publisher must reject missing manifest files');
assert.match(publisher, /requiredPages/, 'root publisher must require all three app pages');
assert.match(publisher, /forbiddenExtensions/, 'root publisher must reject private financial files');
assert.match(publisher, /process\.argv\.includes\('--publish'\)/, 'root publisher must require explicit publish intent');
assert.match(publisher, /Next: inspect git status, commit the generated vendor/, 'publisher must explain the final manual commit/push step');
assert.doesNotMatch(ignore, /^vendor\/$/m, 'runtime vendor assets must be committable');
assert.match(ignore, /^dist\/$/m, 'intermediate dist output must remain ignored');
assert.match(readme, /корня ветки `main`/i, 'README must document direct branch publishing');
assert.doesNotMatch(readme, /\.github\/workflows\/pages\.yml/, 'README must not depend on a Pages Actions workflow');
assert.equal(fs.existsSync(path.join(root, '.github/workflows/pages.yml')), false, 'Pages Actions workflow must stay deleted');
assert.equal(fs.existsSync(path.join(root, '.github/workflows/prepare-lockfile.yml')), false, 'lockfile Actions workflow must stay deleted');
assert.doesNotMatch(pkg.scripts.test, /lockfile_workflow_contract/, 'local regression suite must not depend on Actions workflow tests');

console.log('Direct GitHub Pages publishing contract: PASS · build, hash verification, root copy, no Actions');
