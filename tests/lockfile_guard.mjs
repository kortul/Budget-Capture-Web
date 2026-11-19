import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateLockfile } from '../scripts/verify-lockfile.mjs';

const pkg = {
  name: 'budget-capture-web',
  version: '0.1.6.0',
  devDependencies: {
    'sql.js': '1.16.0',
    'pdfjs-dist': '6.5.438',
    xlsx: 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz',
    playwright: '1.65.1',
  },
};
const integrity = `sha512-${createHash('sha512').update('synthetic-package').digest('base64')}`;
const packageEntry = (version, resolved, extra = {}) => ({ version, resolved, integrity, ...extra });

function validLock() {
  return {
    name: pkg.name,
    version: pkg.version,
    lockfileVersion: 3,
    packages: {
      '': {
        name: pkg.name,
        version: pkg.version,
        // Deliberately reversed to prove property order does not matter.
        devDependencies: {
          playwright: '1.65.1',
          xlsx: 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz',
          'pdfjs-dist': '6.5.438',
          'sql.js': '1.16.0',
        },
      },
      'node_modules/sql.js': packageEntry('1.16.0', 'https://registry.npmjs.org/sql.js/-/sql.js-1.16.0.tgz'),
      'node_modules/pdfjs-dist': packageEntry('6.5.438', 'https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.5.438.tgz'),
      'node_modules/xlsx': packageEntry('0.20.3', 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz'),
      'node_modules/playwright': packageEntry('1.65.1', 'https://registry.npmjs.org/playwright/-/playwright-1.65.1.tgz', {
        dependencies: { 'playwright-core': '1.65.1' },
      }),
      'node_modules/playwright-core': packageEntry('1.65.1', 'https://registry.npmjs.org/playwright-core/-/playwright-core-1.65.1.tgz'),
      'node_modules/example-transitive': packageEntry('2.3.4', 'https://registry.npmjs.org/example-transitive/-/example-transitive-2.3.4.tgz'),
    },
  };
}

const good = validateLockfile(pkg, validLock());
assert.equal(good.packageCount, 6, 'all transitive packages must be counted');

{
  const lock = validLock();
  delete lock.packages['node_modules/example-transitive'].integrity;
  assert.throws(() => validateLockfile(pkg, lock), /example-transitive.*SHA-512/i);
}
{
  const lock = validLock();
  lock.packages['node_modules/example-transitive'].resolved = 'http://registry.npmjs.org/example.tgz';
  assert.throws(() => validateLockfile(pkg, lock), /HTTPS/i);
}
{
  const lock = validLock();
  lock.packages['node_modules/example-transitive'].resolved = 'https://evil.example/package.tgz';
  assert.throws(() => validateLockfile(pkg, lock), /unapproved host/i);
}
{
  const lock = validLock();
  lock.packages['node_modules/sql.js'].version = '1.13.0';
  lock.packages['node_modules/sql.js'].resolved = 'https://registry.npmjs.org/sql.js/-/sql.js-1.13.0.tgz';
  assert.throws(() => validateLockfile(pkg, lock), /sql\.js is locked at 1\.13\.0/i);
}
{
  const lock = validLock();
  lock.packages['node_modules/xlsx'].version = '0.18.5';
  lock.packages['node_modules/xlsx'].resolved = 'https://registry.npmjs.org/xlsx/-/xlsx-0.18.5.tgz';
  assert.throws(() => validateLockfile(pkg, lock), /xlsx is locked at 0.18.5/i);
}
{
  const lock = validLock();
  lock.packages['node_modules/pdfjs-dist'].version = '3.11.174';
  assert.throws(() => validateLockfile(pkg, lock), /pdfjs-dist is locked at 3.11.174/i);
}
{
  const lock = validLock();
  lock.packages['node_modules/playwright'].dependencies['playwright-core'] = '1.64.0';
  assert.throws(() => validateLockfile(pkg, lock), /playwright-core@1.65.1/i);
}

console.log('Lockfile security guard tests: PASS · key-order independent · full transitive SHA-512 · HTTPS allowlist · exact parser pins');
