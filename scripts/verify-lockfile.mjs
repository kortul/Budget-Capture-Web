import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableObject(value[key])]));
}

function fail(message) {
  throw new Error(message);
}

export function validateLockfile(pkg, lock) {
  if (!lock || lock.lockfileVersion !== 3) fail(`Expected npm lockfileVersion 3, got ${lock?.lockfileVersion ?? 'missing'}. Use npm 9+ / Node.js 22+ (CI workflows use Node.js 24).`);
  if (lock.name !== pkg.name || lock.version !== pkg.version) fail('package-lock.json root identity does not match package.json.');

  const rootLock = lock.packages?.[''];
  if (!rootLock) fail('package-lock.json is missing the root package entry.');
  if (JSON.stringify(stableObject(rootLock.devDependencies || {})) !== JSON.stringify(stableObject(pkg.devDependencies || {}))) {
    fail('package-lock.json root devDependencies do not match package.json. Regenerate the lockfile.');
  }

  const expected = {
    'sql.js': { version: '1.16.0', resolved: /^https:\/\/registry\.npmjs\.org\/sql\.js\// },
    'pdfjs-dist': { version: '6.5.438', resolved: /^https:\/\/registry\.npmjs\.org\/pdfjs-dist\// },
    'xlsx': { version: '0.20.3', resolved: /^https:\/\/cdn\.sheetjs\.com\/xlsx-0\.20\.3\/xlsx-0\.20\.3\.tgz$/ },
    'playwright': { version: '1.65.1', resolved: /^https:\/\/registry\.npmjs\.org\/playwright\// },
    'playwright-core': { version: '1.65.1', resolved: /^https:\/\/registry\.npmjs\.org\/playwright-core\// },
  };

  for (const [name, pin] of Object.entries(expected)) {
    const entry = lock.packages?.[`node_modules/${name}`];
    if (!entry) fail(`package-lock.json does not contain node_modules/${name}.`);
    if (entry.version !== pin.version) fail(`${name} is locked at ${entry.version}; expected ${pin.version}.`);
    if (!pin.resolved.test(entry.resolved || '')) fail(`${name} does not resolve from the expected authoritative tarball source.`);
    if (!/^sha512-[A-Za-z0-9+/]{86}={0,2}$/.test(entry.integrity || '')) fail(`${name} is missing a valid SHA-512 integrity hash in package-lock.json.`);
  }

  const playwright = lock.packages['node_modules/playwright'];
  if (playwright.dependencies?.['playwright-core'] !== '1.65.1') {
    fail('playwright@1.65.1 must depend on playwright-core@1.65.1.');
  }

  // Lock every fetched package to HTTPS and SHA-512. This prevents an otherwise
  // correctly pinned top-level package from pulling an unverified transitive tarball.
  const packageEntries = Object.entries(lock.packages).filter(([key]) => key !== '');
  if (!packageEntries.length) fail('package-lock.json contains no package entries.');
  for (const [key, entry] of packageEntries) {
    if (entry.link || entry.inBundle) continue;
    if (!entry.resolved) fail(`${key} has no resolved tarball URL.`);
    let url;
    try { url = new URL(entry.resolved); } catch { fail(`${key} has an invalid resolved URL.`); }
    if (url.protocol !== 'https:') fail(`${key} must resolve over HTTPS.`);
    if (!['registry.npmjs.org', 'cdn.sheetjs.com'].includes(url.hostname)) {
      fail(`${key} resolves from an unapproved host: ${url.hostname}.`);
    }
    if (!/^sha512-[A-Za-z0-9+/]{86}={0,2}$/.test(entry.integrity || '')) {
      fail(`${key} is missing a valid SHA-512 integrity hash.`);
    }
  }

  return {
    packageCount: packageEntries.length,
    checkedTopLevel: Object.keys(expected),
    approvedHosts: ['registry.npmjs.org', 'cdn.sheetjs.com'],
  };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const packagePath = path.join(root, 'package.json');
  const lockPath = path.join(root, 'package-lock.json');
  if (!fs.existsSync(lockPath)) {
    fail('package-lock.json is missing. In a trusted network environment run `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`, review the lockfile, and commit it before release.');
  }
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const result = validateLockfile(pkg, lock);
  console.log(`Dependency lockfile verification: PASS · ${result.packageCount} package entries · exact pins · approved HTTPS sources · SHA-512 integrity`);
}
