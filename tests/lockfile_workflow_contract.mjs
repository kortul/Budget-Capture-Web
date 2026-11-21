import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(root, '.github/workflows/prepare-lockfile.yml');
assert(fs.existsSync(workflowPath), 'manual lockfile bootstrap workflow must exist');
const workflow = fs.readFileSync(workflowPath, 'utf8');

assert(workflow.includes('workflow_dispatch:'), 'lockfile preparation must be manually triggered');
assert(workflow.includes('node-version: 24'), 'workflow must use Node.js 24');
assert(workflow.includes('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1'), 'bootstrap must pin checkout v7.0.1 (Node 24) by immutable SHA');
assert(workflow.includes('actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1'), 'bootstrap must pin setup-node v7.1.0 (Node 24) by immutable SHA');
assert(workflow.includes('registry-url: https://registry.npmjs.org'), 'npm dependencies must resolve through the standard npm registry');
assert(workflow.includes('npm install --package-lock-only --ignore-scripts --no-audit --no-fund'), 'workflow must generate metadata-only lockfile without lifecycle scripts');
assert(workflow.includes('npm run verify:lock'), 'strict lockfile verifier must run before artifact upload');
assert(workflow.indexOf('npm install --package-lock-only') < workflow.indexOf('npm run verify:lock'), 'lockfile generation must precede verification');
assert(workflow.indexOf('npm run verify:lock') < workflow.indexOf('actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f'), 'artifact upload must happen only after verification');
assert(workflow.includes('sha256sum package-lock.json'), 'workflow must produce a SHA-256 checksum');
assert(workflow.includes('actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f'), 'verified lockfile must be downloadable using the reviewed upload-artifact v6.0.0 Node 24 commit');
assert(workflow.includes('package-lock.json\n            package-lock.sha256\n            package-lock-build-info.txt'), 'artifact must include lockfile, checksum and source metadata');
assert(workflow.includes('Source commit: ${GITHUB_SHA}'), 'artifact metadata must identify the exact source commit');
assert(!workflow.includes('npm ci'), 'bootstrap workflow must not pretend it installed runtime dependencies');
assert(!workflow.includes('deploy-pages') && !workflow.includes('upload-pages-artifact'), 'lockfile bootstrap must never publish the site');
assert(workflow.includes('permissions:\n  contents: read'), 'workflow must use least-privilege repository permissions');

console.log('Lockfile bootstrap workflow contract: PASS · manual trigger · metadata-only resolution · verifier-before-export · checksum · no deployment');

const pagesWorkflow = fs.readFileSync(path.join(root, '.github/workflows/pages.yml'), 'utf8');
assert(pagesWorkflow.includes('node-version: 24'), 'Pages workflow must run Node.js 24');
assert(pagesWorkflow.includes('actions/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d'), 'Pages configure action must be Node 24 v6.0.0 pinned by immutable SHA');
assert(pagesWorkflow.includes('actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9'), 'Pages artifact composite action must be v5.0.0 pinned by immutable SHA');
assert(pagesWorkflow.includes('actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346'), 'Pages deploy action must be Node 24 v5.0.1 pinned by immutable SHA');
assert(pagesWorkflow.includes('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1'), 'Pages checkout must be Node 24 v7.0.1 pinned by immutable SHA');
assert(pagesWorkflow.includes('actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1'), 'Pages setup-node must be Node 24 v7.1.0 pinned by immutable SHA');
assert(pagesWorkflow.includes('actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f'), 'validation artifact export must use reviewed upload-artifact v6.0.0 by SHA');
assert(pagesWorkflow.includes('actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9'), 'GitHub Pages artifact must be uploaded by the validation job');

// Publishing must be opt-in: pushes and manual validation runs never deploy by default.
assert(pagesWorkflow.includes('workflow_dispatch:'), 'Pages workflow must remain manually runnable');
assert.match(pagesWorkflow, /deploy:\s*\n\s*description: 'Publish[\s\S]*?required: true\s*\n\s*type: boolean\s*\n\s*default: false/, 'manual deploy input must be boolean and default to false');
assert(pagesWorkflow.includes("if: github.event_name == 'workflow_dispatch' && inputs.deploy == true"), 'deployment job must require an explicit manual true input');
assert(pagesWorkflow.includes('  validate:'), 'push workflow must run a separate validation job');
assert(pagesWorkflow.includes('  deploy:'), 'deployment must be isolated in its own job');
assert(pagesWorkflow.includes('needs: validate'), 'deployment must depend on successful validation');
const deployStart = pagesWorkflow.indexOf('\n  deploy:');
assert(deployStart > 0, 'deployment job must be declared after validation');
const validationJob = pagesWorkflow.slice(0, deployStart);
const deploymentJob = pagesWorkflow.slice(deployStart);
assert(!validationJob.includes('actions/deploy-pages@'), 'validation job must never deploy');
assert(!validationJob.includes('pages: write') && !validationJob.includes('id-token: write'), 'validation job must not receive Pages deployment permissions');
assert(validationJob.includes('actions/upload-artifact@') && validationJob.includes('path: dist/'), 'validation job must export its tested dist artifact');
assert(validationJob.includes('actions/upload-pages-artifact@') && validationJob.includes('path: dist'), 'validation job must upload the Pages artifact only after tests');
assert(!deploymentJob.includes('actions/download-artifact@') && !deploymentJob.includes('actions/upload-pages-artifact@'), 'deployment job must reuse the artifact from the completed validation job without uploading a duplicate');
assert(deploymentJob.includes('pages: write') && deploymentJob.includes('id-token: write'), 'only the deployment job may request Pages deployment permissions');
assert(deploymentJob.includes('actions/deploy-pages@'), 'manual deployment job must deploy after validation');

// Third-party Actions must be immutable full-length commit references, not movable tags.
for (const file of ['.github/workflows/prepare-lockfile.yml', '.github/workflows/pages.yml']) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const uses = [...text.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map(match => match[1]);
  assert(uses.length > 0, `${file} must contain external Actions`);
  for (const ref of uses) {
    assert.match(ref, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/, `${file} action must be pinned to a full 40-character commit SHA: ${ref}`);
  }
  assert.match(text, /persist-credentials: false/, `${file} checkout must not persist the workflow token in git config`);
}

console.log('Pages workflow contract: PASS · Node 24 · immutable pins · push-only validation · explicit manual deployment opt-in');
