import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import fs from 'node:fs';

const port = Number(process.env.PORT || 4176);
const basePath = '/budget-numbers-e2e/';
const origin = `http://127.0.0.1:${port}`;

const server = spawn(process.execPath, ['scripts/serve-test.mjs'], {
  env: { ...process.env, PORT: String(port), BASE_PATH: basePath },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
server.stdout.on('data', chunk => { serverOutput += chunk.toString(); });
server.stderr.on('data', chunk => { serverOutput += chunk.toString(); });

let browser;
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(origin + basePath + 'numbers-import.html');
      if (response.ok) { ready = true; break; }
    } catch {}
    if (server.exitCode !== null) break;
    await delay(250);
  }
  assert(ready, `static server did not become ready: ${serverOutput}`);

  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const pageErrors = [];
  const externalRequests = [];
  const failedRequests = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).origin !== origin) externalRequests.push(request.url());
  });
  page.on('requestfailed', request => failedRequests.push(`${request.url()} · ${request.failure()?.errorText || 'failed'}`));

  const response = await page.goto(origin + basePath + 'numbers-import.html', { waitUntil: 'networkidle', timeout: 30000 });
  assert.equal(response.status(), 200, 'Numbers import page must be served from the Pages subpath');
  await page.waitForFunction(() => window.XLSX?.version === '0.20.3', null, { timeout: 20000 });

  await page.addScriptTag({ url: origin + basePath + 'vendor/sql.js/sql-wasm.js' });
  const databaseBytes = await page.evaluate(async () => {
    const SQL = await window.initSqlJs({
      locateFile: file => './vendor/sql.js/' + file,
      useOldExtensionFunctions: true,
    });
    const db = new SQL.Database();
    db.run('CREATE TABLE categories (name TEXT PRIMARY KEY)');
    db.run('INSERT INTO categories(name) VALUES (?), (?)', ['Зарплата', 'Продукты']);
    db.run('CREATE TABLE transactions (id TEXT PRIMARY KEY, description TEXT NOT NULL)');
    db.run('INSERT INTO transactions(id, description) VALUES (?, ?)', ['sentinel-transaction', 'Must remain unchanged']);
    const bytes = Array.from(db.export());
    db.close();
    return bytes;
  });

  const makeWorkbook = async (income, expenses, suspiciousAmount) => {
    const base64 = await page.evaluate(({ income, expenses, suspiciousAmount }) => {
      const workbook = XLSX.utils.book_new();
      const incomeSheet = XLSX.utils.aoa_to_sheet([
        ['Категория', 'Сумма'],
        ['Зарплата', income],
        ['Итого', income],
      ]);
      const suspiciousCategory = '<img src=x onerror="window.__numbersXss=1">';
      const expenseSheet = XLSX.utils.aoa_to_sheet([
        ['Категория', 'Сумма'],
        ['Продукты', expenses],
        [suspiciousCategory, suspiciousAmount],
        ['****Note: Саша 30 Тотал', 3000],
        ['****Note: Paris Total', 4000],
        ['****Note: Provance/Chamonix Total', 5000],
        ['Всего Сент-декабрь', 6000],
        ['ИТОГО РАСХОДЫ', expenses + suspiciousAmount],
      ]);
      XLSX.utils.book_append_sheet(workbook, incomeSheet, 'Октябрь 2026 - Income');
      XLSX.utils.book_append_sheet(workbook, expenseSheet, 'Октябрь 2026 - Расходы');
      return XLSX.write(workbook, { bookType: 'xlsx', type: 'base64' });
    }, { income, expenses, suspiciousAmount });
    return Buffer.from(base64, 'base64');
  };

  const originalWorkbook = await makeWorkbook(250000, 12000, 1);
  const originalExcel = {
    name: 'Numbers-history.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: originalWorkbook,
  };
  const originalDatabase = {
    name: 'MyBudget.budget',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(databaseBytes),
  };

  await page.locator('#file').setInputFiles(originalExcel);
  await page.locator('#dbfile').setInputFiles(originalDatabase);
  await page.waitForFunction(() => {
    const button = document.querySelector('#import-history');
    return button && !button.disabled && document.querySelector('#db-import-status')?.textContent.includes('Database loaded');
  }, null, { timeout: 20000 });

  assert.equal(await page.locator('#export-history').isDisabled(), true, 'export must stay disabled before a successful import');
  assert.match(await page.locator('#status').textContent(), /4 summary\/total rows excluded/, 'named Total/Тотал/Всего helper rows must be excluded from the Numbers preview');
  assert.equal(await page.locator('#matching').isVisible(), true, 'database categories must be matched against the Numbers preview');
  assert.equal(await page.locator('#matching-body img').count(), 0, 'untrusted Excel category text must not create HTML elements');
  assert.equal(await page.evaluate(() => window.__numbersXss || 0), 0, 'Excel category payload must not execute');

  await page.locator('#import-history').click();
  await page.waitForFunction(() => document.querySelector('#db-import-status')?.textContent.includes('Imported 3 rows'), null, { timeout: 20000 });
  assert.equal(await page.locator('#export-history').isDisabled(), false, 'export must become available after successful import');

  const firstDownloadPromise = page.waitForEvent('download');
  await page.locator('#export-history').click();
  const firstDownload = await firstDownloadPromise;
  assert.equal(firstDownload.suggestedFilename(), 'MyBudget_with_numbers.budget');
  const firstExportPath = await firstDownload.path();
  assert(firstExportPath && fs.statSync(firstExportPath).size > 10000, 'first exported database must be a non-empty SQLite file');

  const firstDatabaseState = await page.evaluate(async bytes => {
    const SQL = await window.initSqlJs({
      locateFile: file => './vendor/sql.js/' + file,
      useOldExtensionFunctions: true,
    });
    const db = new SQL.Database(new Uint8Array(bytes));
    const count = sql => Number(db.exec(sql)[0].values[0][0]);
    const totals = db.exec("SELECT kind, SUM(amount) FROM numbers_history WHERE source='numbers' GROUP BY kind ORDER BY kind")[0].values;
    const result = {
      historyRows: count("SELECT COUNT(*) FROM numbers_history WHERE source='numbers'"),
      transactionRows: count('SELECT COUNT(*) FROM transactions'),
      categoryRows: count('SELECT COUNT(*) FROM categories'),
      totals: Object.fromEntries(totals.map(row => [String(row[0]), Number(row[1])])),
      description: String(db.exec('SELECT description FROM transactions WHERE id=\'sentinel-transaction\'')[0].values[0][0]),
    };
    db.close();
    return result;
  }, Array.from(fs.readFileSync(firstExportPath)));
  assert.equal(firstDatabaseState.historyRows, 3, 'all three month/category rows must be stored');
  assert.equal(firstDatabaseState.transactionRows, 1, 'Numbers import must not alter transactions');
  assert.equal(firstDatabaseState.categoryRows, 2, 'unmatched historical categories must not be added to live categories');
  assert.deepEqual(firstDatabaseState.totals, { expense: 12001, income: 250000 });
  assert.equal(firstDatabaseState.description, 'Must remain unchanged');

  // Import a revised workbook into the just-exported database. Existing Numbers
  // history must be replaced rather than appended; live transactions stay intact.
  await page.locator('#dbfile').setInputFiles(firstExportPath);
  await page.waitForFunction(() => document.querySelector('#db-import-status')?.textContent.includes('Database loaded'), null, { timeout: 20000 });
  assert.equal(await page.locator('#export-history').isDisabled(), true, 'loading a new database must invalidate the previous export-ready state');

  const revisedWorkbook = await makeWorkbook(260000, 12500, 2);
  await page.locator('#file').setInputFiles({
    name: 'Numbers-history-revised.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: revisedWorkbook,
  });
  await page.waitForFunction(() => !document.querySelector('#import-history').disabled, null, { timeout: 20000 });
  assert.equal(await page.locator('#export-history').isDisabled(), true, 'changing the workbook must disable export until the new data is imported');

  await page.locator('#import-history').click();
  await page.waitForFunction(() => document.querySelector('#db-import-status')?.textContent.includes('Imported 3 rows'), null, { timeout: 20000 });
  const secondDownloadPromise = page.waitForEvent('download');
  await page.locator('#export-history').click();
  const secondDownload = await secondDownloadPromise;
  const secondExportPath = await secondDownload.path();
  assert(secondExportPath && fs.statSync(secondExportPath).size > 10000, 'updated database must be downloadable');

  const finalDatabaseState = await page.evaluate(async bytes => {
    const SQL = await window.initSqlJs({
      locateFile: file => './vendor/sql.js/' + file,
      useOldExtensionFunctions: true,
    });
    const db = new SQL.Database(new Uint8Array(bytes));
    const count = sql => Number(db.exec(sql)[0].values[0][0]);
    const totals = db.exec("SELECT kind, SUM(amount) FROM numbers_history WHERE source='numbers' GROUP BY kind ORDER BY kind")[0].values;
    const result = {
      historyRows: count("SELECT COUNT(*) FROM numbers_history WHERE source='numbers'"),
      transactionRows: count('SELECT COUNT(*) FROM transactions'),
      categoryRows: count('SELECT COUNT(*) FROM categories'),
      totals: Object.fromEntries(totals.map(row => [String(row[0]), Number(row[1])])),
    };
    db.close();
    return result;
  }, Array.from(fs.readFileSync(secondExportPath)));
  assert.equal(finalDatabaseState.historyRows, 3, 're-import must replace the previous Numbers history, not duplicate it');
  assert.equal(finalDatabaseState.transactionRows, 1, 're-import must leave live transactions untouched');
  assert.equal(finalDatabaseState.categoryRows, 2, 'unmatched historical categories must remain outside live categories');
  assert.deepEqual(finalDatabaseState.totals, { expense: 12502, income: 260000 });

  const analytics = await context.newPage();
  analytics.on('pageerror', error => pageErrors.push(error.message));
  analytics.on('request', request => {
    if (new URL(request.url()).origin !== origin) externalRequests.push(request.url());
  });
  analytics.on('requestfailed', request => failedRequests.push(`${request.url()} · ${request.failure()?.errorText || 'failed'}`));
  const analyticsResponse = await analytics.goto(origin + basePath + 'numbers-analytics.html', { waitUntil: 'networkidle', timeout: 30000 });
  assert.equal(analyticsResponse.status(), 200, 'Financial Analytics page must be served from the Pages subpath');
  await analytics.locator('#file').setInputFiles(secondExportPath);
  await analytics.waitForFunction(() => !document.querySelector('#dashboard').classList.contains('hidden'), null, { timeout: 20000 });
  assert.match(await analytics.locator('#incomeMetric').textContent(), /260\s?000/);
  assert.match(await analytics.locator('#expenseMetric').textContent(), /12\s?502/);
  assert.match(await analytics.locator('#netMetric').textContent(), /247\s?498/);
  assert.equal(await analytics.locator('#categoryList img').count(), 0, 'untrusted historical category names must be rendered as text');
  assert.equal(await analytics.evaluate(() => window.__numbersXss || 0), 0, 'historical category payload must not execute in analytics');
  assert.match(await analytics.locator('#categoryRows').innerText(), /Продукты/);

  assert.deepEqual(pageErrors, [], 'Numbers pages must not raise uncaught browser errors');
  assert.deepEqual(externalRequests, [], 'Numbers pages must load every runtime asset from the same origin');
  assert.deepEqual(failedRequests, [], 'Numbers page asset requests must not fail');
  console.log('Numbers Chromium E2E: PASS · Excel preview · SQLite import/export · history replacement · transactions untouched · analytics reopen · escaped category text');
  await context.close();
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGTERM');
}
