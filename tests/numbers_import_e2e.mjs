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
    db.run("CREATE TABLE categories (name TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT '')");
    db.run('INSERT INTO categories(name) VALUES (?), (?), (?), (?)', ['Зарплата', 'Продукты', 'ВВОДЫ ДИМА СПЕЦ', 'ВЫВОДЫ ДИМА СПЕЦ']);
    db.run('CREATE TABLE web_metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL)');
    db.run('INSERT INTO web_metadata(key,value) VALUES (?,?)', ['budget_profile_v1', JSON.stringify({categories:[{name:'Зарплата',kind:'income'},{name:'Продукты',kind:'expense'},{name:'ВВОДЫ ДИМА СПЕЦ',kind:'special_input'},{name:'ВЫВОДЫ ДИМА СПЕЦ',kind:'special_output'}],numbers:{specialInput:{category:'ВВОДЫ ДИМА СПЕЦ'},specialOutput:{category:'ВЫВОДЫ ДИМА СПЕЦ'}}})]);
    db.run('INSERT INTO web_metadata(key,value) VALUES (?,?)', ['numbers_manual_reference_v1', JSON.stringify({exampleOnly:true})]);
    db.run("CREATE TABLE transactions (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL DEFAULT '', account TEXT NOT NULL DEFAULT '', tx_date TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', merchant TEXT NOT NULL DEFAULT '', merchant_key TEXT NOT NULL DEFAULT '', transaction_type TEXT NOT NULL DEFAULT 'unknown', source_ref TEXT NOT NULL DEFAULT '', amount REAL, currency TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'Не распределено', status TEXT NOT NULL DEFAULT 'Needs review', confidence REAL, source_file TEXT NOT NULL DEFAULT '', source_frame INTEGER, raw_text TEXT NOT NULL DEFAULT '', duplicate_of TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', manually_adjusted INTEGER NOT NULL DEFAULT 0, highlighted_flag INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, delete_action_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '')");
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
        ['ВВОДЫ ДИМА СПЕЦ', 203700000],
        ['ВЫВОДЫ ДИМА СПЕЦ', 203650000],
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
  assert.match(await page.locator('#status').textContent(), /6 summary\/total rows excluded/, 'named Total/Тотал/Всего helper rows must be excluded from the Numbers preview');
  assert.equal(await page.locator('#matching').isVisible(), true, 'database categories must be matched against the Numbers preview');
  assert.equal(await page.locator('#matching-body img').count(), 0, 'untrusted Excel category text must not create HTML elements');
  assert.equal(await page.evaluate(() => window.__numbersXss || 0), 0, 'Excel category payload must not execute');

  await page.locator('#import-history').click();
  await page.waitForFunction(() => document.querySelector('#db-import-status')?.textContent.includes('Импортировано 5 строк'), null, { timeout: 20000 });
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
    const totals = db.exec("SELECT kind, SUM(amount) FROM numbers_history WHERE source='numbers' AND role IN ('income','expense') GROUP BY kind ORDER BY kind")[0].values;
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
  assert.equal(firstDatabaseState.historyRows, 5, 'all five category rows must be stored');
  assert.equal(firstDatabaseState.transactionRows, 1, 'Numbers import must not alter transactions');
  assert.equal(firstDatabaseState.categoryRows, 4, 'unmatched historical categories must not be added to live categories');
  assert.deepEqual(firstDatabaseState.totals, { expense: 12001, income: 250000 }, 'ordinary income/expense rows remain in their original kind totals');
  const firstRoles = await page.evaluate(async bytes => { const SQL=await window.initSqlJs({locateFile:file=>'./vendor/sql.js/'+file,useOldExtensionFunctions:true});const db=new SQL.Database(new Uint8Array(bytes));const rows=db.exec('SELECT role,SUM(amount) FROM numbers_history GROUP BY role ORDER BY role')[0].values;db.close();return Object.fromEntries(rows.map(row=>[String(row[0]),Number(row[1])])); }, Array.from(fs.readFileSync(firstExportPath)));
  assert.deepEqual(firstRoles,{expense:12001,income:250000,special_input:203700000,special_output:203650000},'special input/output categories must persist as separate roles');
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
  await page.waitForFunction(() => document.querySelector('#db-import-status')?.textContent.includes('Импортировано 5 строк'), null, { timeout: 20000 });
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
    const totals = db.exec("SELECT kind, SUM(amount) FROM numbers_history WHERE source='numbers' AND role IN ('income','expense') GROUP BY kind ORDER BY kind")[0].values;
    const result = {
      historyRows: count("SELECT COUNT(*) FROM numbers_history WHERE source='numbers'"),
      transactionRows: count('SELECT COUNT(*) FROM transactions'),
      categoryRows: count('SELECT COUNT(*) FROM categories'),
      totals: Object.fromEntries(totals.map(row => [String(row[0]), Number(row[1])])),
    };
    db.close();
    return result;
  }, Array.from(fs.readFileSync(secondExportPath)));
  assert.equal(finalDatabaseState.historyRows, 5, 're-import must replace the previous Numbers history, not duplicate it');
  assert.equal(finalDatabaseState.transactionRows, 1, 're-import must leave live transactions untouched');
  assert.equal(finalDatabaseState.categoryRows, 4, 'unmatched historical categories must remain outside live categories');
  assert.deepEqual(finalDatabaseState.totals, { expense: 12502, income: 260000 });

  const analytics = await context.newPage();
  analytics.on('pageerror', error => pageErrors.push(error.message));
  analytics.on('request', request => {
    if (new URL(request.url()).origin !== origin) externalRequests.push(request.url());
  });
  analytics.on('requestfailed', request => failedRequests.push(`${request.url()} · ${request.failure()?.errorText || 'failed'}`));
  const analyticsResponse = await analytics.goto(origin + basePath + 'numbers-analytics.html', { waitUntil: 'networkidle', timeout: 30000 });
  assert.equal(analyticsResponse.status(), 200, 'Financial Analytics page must be served from the Pages subpath');
  await analytics.locator('#manual-file').setInputFiles({
    name: secondDownload.suggestedFilename(),
    mimeType: 'application/octet-stream',
    buffer: fs.readFileSync(secondExportPath),
  });
  await analytics.waitForFunction(() => !document.querySelector('#dashboard').classList.contains('hidden'), null, { timeout: 20000 });
  assert.match(await analytics.locator('#incomeMetric').textContent(), /260\s?000/);
  assert.match(await analytics.locator('#expenseMetric').textContent(), /12\s?502/);
  assert.match(await analytics.locator('#netMetric').textContent(), /247\s?498/);
  assert.match(await analytics.locator('#specialInputMetric').textContent(), /203\s?700\s?000/, 'analytics must show special inputs separately from Net');
  assert.match(await analytics.locator('#specialOutputMetric').textContent(), /203\s?650\s?000/, 'analytics must show special outputs separately from Net');
  assert.match(await analytics.locator('#lifeRows').textContent(), /Продукты/);
  const foldoutIds = ['monthly-balance', 'life', 'sasha', 'work', 'loans', 'year-comparison'];
  for (const id of foldoutIds) assert.equal(await analytics.locator('#' + id).getAttribute('open'), null, id + ' must be collapsed after initial load');
  for (const id of ['monthly-balance-chart', 'life-trend-chart', 'life-category-chart', 'sasha-trend-chart', 'sasha-category-chart', 'work-trend-chart', 'shop-trend-chart', 'loan-trend-chart', 'loan-category-chart', 'year-comparison-chart']) assert.equal(await analytics.locator('#' + id).count(), 1, id + ' visualization must be rendered');
  assert.equal(await analytics.locator('#monthly-preview-chart svg').count(), 1, 'monthly balance preview must include a sparkline');
  // The Life report is now part of the separate Period workspace.
  await analytics.locator('#report-tab-period').click();
  assert.equal(await analytics.locator('#period-view').isVisible(),true,'period reports must be opened before accessing their foldouts');
  await analytics.locator('#life > summary').click();
  assert.notEqual(await analytics.locator('#life').getAttribute('open'), null, 'the living expenses panel must expand on click');
  assert.equal(await analytics.locator('#life-trend-chart').isVisible(), true, 'visualization must be visible when its panel is expanded');
  await analytics.locator('#life > summary').click();
  assert.equal(await analytics.locator('#life').getAttribute('open'), null, 'the living expenses panel must collapse on the second click');
  assert.equal(await analytics.locator('#manual-references').count(), 0, 'the illustrative manual summary section must not be displayed');
  assert.equal(await analytics.locator('#range-from').inputValue(), '2026-01', 'analytics must default to the latest available year start');
  assert.ok(await analytics.locator('#month-detail-title').textContent(), 'monthly detail must be rendered after loading');
  assert.equal(await analytics.locator('#month-detail-select option').count(), 1, 'month selector must list available months in the reporting range');
  assert.equal(await analytics.locator('#report-tab-year').getAttribute('aria-selected'),'false', 'Year tab must be separate from default Month view');
  await analytics.locator('#report-tab-year').click();
  assert.equal(await analytics.locator('#year-view').isVisible(),true,'Year tab must render annual workspace');
  assert.equal(await analytics.locator('#year-detail-select').inputValue(),'2026','Year tab must select latest available year');
  assert.equal(await analytics.locator('#year-income-value').textContent(),'260 000 ₽','Annual tab must use Numbers income for selected year');
  assert.equal(await analytics.locator('#year-month-chart svg').count(),1,'Annual tab must render a monthly chart');
  await analytics.locator('#report-tab-period').click();
  assert.equal(await analytics.locator('#month-income-list .a-month-category-row').count(), 1, 'income list must show active imported income categories');
  assert.equal(await analytics.locator('#month-expense-list .a-month-category-row').count(), 2, 'expense list must preserve both nonzero imported expense categories');
  assert.equal(await analytics.locator('#month-expense-list img').count(), 0, 'untrusted historical category text must not create HTML elements');
  assert.match(await analytics.locator('#month-expense-list').textContent(), /<img src=x onerror=/, 'the untrusted category must remain visible as escaped plain text');
  assert.equal(await analytics.evaluate(() => window.__numbersXss || 0), 0, 'historical category text must not execute as HTML');
  assert.match(await analytics.locator('#month-income-list').innerText(), /Зарплата/, 'income list must show actual imported categories');
  assert.match(await analytics.locator('#month-expense-list').innerText(), /Продукты/, 'expense list must include categories assigned to the shop in settings');
  assert.equal(await analytics.locator('#month-expense-chart svg').count(), 1, 'expense composition must render a donut chart');
  assert.equal(await analytics.locator('#month-insights .a-month-insight').count(), 4, 'month view must show two headline cards plus growth and anomaly insights');
  assert.equal(await analytics.locator('#month-expense-list .a-month-category-row').count(), 2, 'both nonzero expense categories must render while zero-valued categories stay hidden');
  assert.equal(await analytics.locator('#cashflow-chart svg.a-chart-svg').count(), 1, 'Financial Analytics must render the interactive cashflow SVG chart');
  assert.match(await analytics.locator('#month-overall-net').textContent(), /247\s?498/, 'month headline must show income less expense including all ordinary categories');
  assert.match(await analytics.locator('#month-no-shop-net').textContent(), /0/, 'manual no-shop total must stay zero when imported categories do not match its fixed lists');
  assert.match(await analytics.locator('#month-sasha-expense').textContent(), /0/, 'missing Sasha category must safely display zero');
  assert.match(await analytics.locator('#month-dima-net').textContent(), /50\s?000/, 'Dima inputs minus outputs must appear as a separate monthly metric');
  assert.match(await analytics.locator('#month-income-list').textContent(), /Зарплата/, 'income list must use imported month categories');
  assert.doesNotMatch(await analytics.locator('#month-income-list').textContent(), /Приход от работы Дима/, 'manual no-shop rules must not replace the actual month category set');
  assert.match(await analytics.locator('#month-expense-list').textContent(), /Продукты/, 'expense list must show the imported category');
  const monthCategoryFixture = await analytics.evaluate(() => {
    const originalData = data, originalMonth = selectedMonthKey;
    data = [
      {month_key:'2026-10',year:2026,month:10,role:'income',category:'Зарплата',amount:150000},
      {month_key:'2026-10',year:2026,month:10,role:'income',category:'Подработка',amount:35000},
      {month_key:'2026-10',year:2026,month:10,role:'expense',category:'Аренда',amount:50000},
      {month_key:'2026-10',year:2026,month:10,role:'expense',category:'Еда',amount:18000},
      {month_key:'2026-10',year:2026,month:10,role:'expense',category:'Такси',amount:4000},
      {month_key:'2026-10',year:2026,month:10,role:'expense',category:'Нулевая категория',amount:0},
      {month_key:'2026-10',year:2026,month:10,role:'special_input',category:'ВВОДЫ ДИМА',amount:1000000}
    ];
    selectedMonthKey='2026-10';renderMonthDetail();
    const result={
      expenses:[...document.querySelectorAll('#month-expense-list .a-month-category-name')].map(el=>el.textContent),
      incomes:[...document.querySelectorAll('#month-income-list .a-month-category-name')].map(el=>el.textContent),
      zeroVisible:document.querySelector('#month-expense-list')?.textContent.includes('Нулевая категория')||false,
      specialVisible:document.querySelector('#month-expense-list')?.textContent.includes('ВВОДЫ ДИМА')||false,
      selectedMonth:document.querySelector('#month-detail-select')?.value,
      donut:document.querySelectorAll('#month-expense-chart svg circle.a-month-donut-segment').length
    };
    data=originalData;selectedMonthKey=originalMonth;renderAll();
    return result;
  });
  assert.deepEqual(monthCategoryFixture.expenses,['Аренда','Еда','Такси'],'expenses must sort by descending amount');
  assert.deepEqual(monthCategoryFixture.incomes,['Зарплата','Подработка'],'income categories must sort by descending amount');
  assert.equal(monthCategoryFixture.zeroVisible,false,'zero categories must be hidden');
  assert.equal(monthCategoryFixture.specialVisible,false,'special flows must stay outside ordinary category rankings');
  assert.equal(monthCategoryFixture.selectedMonth,'2026-10','month selector must reflect the active month');
  assert.ok(monthCategoryFixture.donut>=1,'expense donut must reflect monthly category totals');
  // Transaction-backed months must replace their duplicate Numbers snapshot.
  const ledgerAnalytics = await context.newPage();
  ledgerAnalytics.on('pageerror', error => pageErrors.push(error.message));
  ledgerAnalytics.on('request', request => {
    if (new URL(request.url()).origin !== origin) externalRequests.push(request.url());
  });
  ledgerAnalytics.on('requestfailed', request => failedRequests.push(request.url() + ' · ' + (request.failure()?.errorText || 'failed')));
  await ledgerAnalytics.goto(origin + basePath + 'numbers-analytics.html', { waitUntil: 'networkidle', timeout: 30000 });
  const ledgerStatus = await ledgerAnalytics.evaluate(async () => {
    const SQL = await window.initSqlJs({ locateFile: file => './vendor/sql.js/' + file, useOldExtensionFunctions: true });
    const fixture = new SQL.Database();
    fixture.run("CREATE TABLE numbers_history (id TEXT PRIMARY KEY,source TEXT NOT NULL DEFAULT 'numbers',month_key TEXT NOT NULL,year INTEGER NOT NULL,month INTEGER NOT NULL,kind TEXT NOT NULL,category TEXT NOT NULL,amount REAL NOT NULL DEFAULT 0,role TEXT NOT NULL DEFAULT '',imported_at TEXT NOT NULL DEFAULT '')");
    fixture.run("CREATE TABLE web_metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL)");
    fixture.run("CREATE TABLE transactions (id TEXT PRIMARY KEY,tx_date TEXT,amount REAL,currency TEXT,category TEXT,transaction_type TEXT,description TEXT,merchant TEXT,notes TEXT,raw_text TEXT,deleted_at TEXT)");
    fixture.run("INSERT INTO web_metadata(key,value) VALUES ('budget_profile_v1',?)", [JSON.stringify({categories:[{name:'Зарплата',kind:'income'},{name:'KGR',kind:'other'},{name:'Остальные расходы',kind:'expense'},{name:'Прочий доход',kind:'other'},{name:'Прочий расход',kind:'other'}],numbers:{specialInput:{category:''},specialOutput:{category:''}}})]);
    const history = fixture.prepare('INSERT INTO numbers_history(id,source,month_key,year,month,kind,category,amount,role,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
    const addHistory = (id,month,kind,category,amount,role=kind) => {
      const [year,monthNumber] = month.split('-').map(Number);
      history.run([id,'numbers',month,year,monthNumber,kind,category,amount,role,'']);
    };
    addHistory('aug-income','2026-08','income','Зарплата',12000);
    addHistory('aug-expense','2026-08','expense','Еда',4000);
    addHistory('sep-income','2026-09','income','Зарплата',10000);
    addHistory('sep-expense','2026-09','expense','Еда',2000);
    addHistory('oct-income','2026-10','income','Зарплата',312366.88);
    addHistory('oct-kgr','2026-10','expense','KGR',96784.78);
    addHistory('oct-other','2026-10','expense','Остальные расходы',180835.39);
    addHistory('oct-stale','2026-10','expense','Numbers only October',123);
    addHistory('jun-income','2026-06','income','Зарплата',8000);
    addHistory('jun-expense','2026-06','expense','Еда',3000);
    addHistory('jul-income','2026-07','income','Зарплата',7000);
    addHistory('jul-expense','2026-07','expense','Еда',2500);
    history.free();
    const tx = fixture.prepare('INSERT INTO transactions(id,tx_date,amount,currency,category,transaction_type,description,merchant,notes,raw_text,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    const addTx = (id,date,amount,category,type='expense',description='',currency='RUB') =>
      tx.run([id,date,amount,currency,category,type,description,'','','',null]);
    addTx('salary','2026-10-01',271366.88,'Зарплата','income');
    addTx('other-income-oct','2026-10-24',41000,'Прочий доход','income');
    addTx('kgr-expense','2026-10-05',-96784.78,'KGR');
    addTx('kgr-positive','2026-10-23',41000,'KGR','income');
    addTx('other-expense','2026-10-14',-168835.39,'Остальные расходы');
    addTx('other-expense-oct','2026-10-16',-12000,'Прочий расход','expense');
    addTx('aug-usd','2026-08-12',90000,'Зарплата','income','USD income','USD');
    addTx('sep-internal','2026-09-12',-50000,'Зарплата','internal_transfer','internal transfer');
    addTx('nov-income','2026-11-01',50000,'Зарплата','income');
    addTx('nov-expense','2026-11-02',-10000,'Остальные расходы');
    addTx('dec-other-income','2026-12-01',41000,'Прочий доход','income');
    addTx('dec-other-expense','2026-12-02',-12000,'Прочий расход','expense');
    addTx('sep-transfer-type','2026-09-13',-30000,'Зарплата','transfer','ordinary transfer label');
    addTx('sep-category-transfer','2026-09-14',-40000,'Внутренний перевод (не расход)','expense','uncategorized movement');
    addTx('oct-failed-review','2026-10-29',-50000,'Остальные расходы','review','Unable to transfer to card');
    addTx('jun-zero','2026-06-05',0,'Зарплата','income');
    addTx('jul-failed-review','2026-07-02',-8000,'Не распределено','review','Unable to transfer to card');
    addTx('internal','2026-10-20',-999999,'Зарплата','internal_transfer','internal transfer');
    tx.run(['deleted','2026-10-30',-500000,'RUB','Остальные расходы','expense','','','','','2026-10-31']);
    tx.free();
    const bytes = fixture.export();
    fixture.close();
    await window.loadDatabaseBytes(bytes, 'Ledger-test.budget');
    return document.querySelector('#status')?.textContent || '';
  });
  assert.match(ledgerStatus, /4 мес\. Numbers \/ 3 мес\. транзакции · исключено операций в валюте, отличной от RUB: 1 · операций на проверку: 2/, 'Analytics must identify month sources and disclose excluded foreign-currency and review transactions');
  await ledgerAnalytics.locator('#month-detail-select').selectOption('2026-11');
  assert.match(await ledgerAnalytics.locator('#month-income-total').textContent(), /50.?000/, 'November must calculate income directly from the transaction ledger without a Numbers row');
  assert.match(await ledgerAnalytics.locator('#month-expense-total').textContent(), /10.?000/, 'November must calculate expenses directly from the transaction ledger without a Numbers row');
  await ledgerAnalytics.locator('#month-detail-select').selectOption('2026-12');
  assert.match(await ledgerAnalytics.locator('#month-income-total').textContent(), /41.?000/, 'an other-kind category must still contribute income according to transaction_type');
  assert.match(await ledgerAnalytics.locator('#month-expense-total').textContent(), /12.?000/, 'an other-kind category must still contribute expenses according to transaction_type');
  assert.match(await ledgerAnalytics.locator('#month-overall-net').textContent(), /29.?000/, 'other-kind cash flows must affect monthly net');
  assert.match(await ledgerAnalytics.locator('#month-income-list').textContent(), /Прочий доход/, 'other-kind income must remain visible under its category name');
  assert.match(await ledgerAnalytics.locator('#month-expense-list').textContent(), /Прочий расход/, 'other-kind expense must remain visible under its category name');
  await ledgerAnalytics.locator('#month-detail-select').selectOption('2026-10');
  assert.match(await ledgerAnalytics.locator('#month-income-total').textContent(), /312.?366,88/, 'October income must come from the transaction ledger');
  assert.match(await ledgerAnalytics.locator('#month-expense-total').textContent(), /236.?620,17/, 'October expenses must be recalculated from transactions, including the positive KGR transaction');
  assert.match(await ledgerAnalytics.locator('#month-overall-net').textContent(), /75.?746,71/, 'October net must use the transaction ledger only once');
  assert.match(await ledgerAnalytics.locator('#month-expense-list').textContent(), /KGR[\s\S]*55.?784,78/, 'KGR must total 55,784.78 after the positive transaction is treated as an expense-category credit');
  assert.match(await ledgerAnalytics.locator('#month-income-list').textContent(), /Прочий доход[\s\S]*41.?000/, 'the missing 41,000 income must be recovered from an other-kind category by transaction direction');
  assert.match(await ledgerAnalytics.locator('#month-expense-list').textContent(), /Прочий расход[\s\S]*12.?000/, 'the missing 12,000 expense must be recovered from an other-kind category by transaction direction');
  assert.doesNotMatch(await ledgerAnalytics.locator('#month-expense-list').textContent(), /Numbers only October/, 'October Numbers category rows must be fully replaced when ledger transactions exist');
  await ledgerAnalytics.locator('#month-detail-select').selectOption('2026-09');
  assert.match(await ledgerAnalytics.locator('#month-income-total').textContent(), /10.?000/, 'September must retain Numbers history when its only live transaction is internal');
  assert.match(await ledgerAnalytics.locator('#month-expense-total').textContent(), /2.?000/, 'September expenses must remain sourced from Numbers history');
  await ledgerAnalytics.locator('#month-detail-select').selectOption('2026-08');
  assert.match(await ledgerAnalytics.locator('#month-income-total').textContent(), /12.?000/, 'a USD-only transaction must not replace August Numbers history');
  assert.match(await ledgerAnalytics.locator('#month-expense-total').textContent(), /4.?000/, 'August Numbers expenses must remain when there are no RUB ledger rows');
  await ledgerAnalytics.locator('#month-detail-select').selectOption('2026-06');
  assert.match(await ledgerAnalytics.locator('#month-income-total').textContent(), /8.?000/, 'a zero-value ledger row must not replace June Numbers income');
  assert.match(await ledgerAnalytics.locator('#month-expense-total').textContent(), /3.?000/, 'a zero-value ledger row must not replace June Numbers expenses');
  await ledgerAnalytics.locator('#month-detail-select').selectOption('2026-07');
  assert.match(await ledgerAnalytics.locator('#month-income-total').textContent(), /7.?000/, 'review-only activity must not replace July Numbers income');
  assert.match(await ledgerAnalytics.locator('#month-expense-total').textContent(), /2.?500/, 'review-only activity must not replace July Numbers expenses');
  await ledgerAnalytics.close();

  const ledgerOnlyAnalytics=await context.newPage();
  ledgerOnlyAnalytics.on('pageerror',error=>pageErrors.push(error.message));
  ledgerOnlyAnalytics.on('request',request=>{if(new URL(request.url()).origin!==origin)externalRequests.push(request.url());});
  ledgerOnlyAnalytics.on('requestfailed',request=>failedRequests.push(request.url()+' · '+(request.failure()?.errorText||'failed')));
  await ledgerOnlyAnalytics.goto(origin+basePath+'numbers-analytics.html',{waitUntil:'networkidle',timeout:30000});
  const ledgerOnlyStatus=await ledgerOnlyAnalytics.evaluate(async()=>{
    const SQL=await window.initSqlJs({locateFile:file=>'./vendor/sql.js/'+file,useOldExtensionFunctions:true});
    const fixture=new SQL.Database();
    fixture.run("CREATE TABLE web_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
    fixture.run("CREATE TABLE transactions(id TEXT PRIMARY KEY,tx_date TEXT,amount REAL,currency TEXT,category TEXT,transaction_type TEXT,description TEXT,merchant TEXT,notes TEXT,raw_text TEXT,deleted_at TEXT)");
    fixture.run("INSERT INTO web_metadata(key,value) VALUES ('budget_profile_v1',?)",[JSON.stringify({categories:[{name:'Зарплата',kind:'income'},{name:'Аренда',kind:'expense'},{name:'Прочий доход',kind:'other'},{name:'Прочий расход',kind:'other'}],numbers:{specialInput:{category:''},specialOutput:{category:''}}})]);
    const tx=fixture.prepare('INSERT INTO transactions(id,tx_date,amount,currency,category,transaction_type,description,merchant,notes,raw_text,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    tx.run(['salary','2027-03-01',50000,'RUB','Зарплата','income','','','','',null]);
    tx.run(['rent','2027-03-02',-20000,'RUB','Аренда','expense','','','','',null]);
    tx.run(['other-income','2027-03-03',10000,'RUB','Прочий доход','income','','','','',null]);
    tx.run(['other-expense','2027-03-04',-5000,'RUB','Прочий расход','expense','','','','',null]);
    tx.free();
    const bytes=fixture.export();fixture.close();
    await window.loadDatabaseBytes(bytes,'Ledger-only.budget');
    return document.querySelector('#status')?.textContent||'';
  });
  assert.match(ledgerOnlyStatus,/0 мес\. Numbers \/ 1 мес\. транзакции/,'Analytics must load transaction-only databases without Numbers history');
  assert.match(await ledgerOnlyAnalytics.locator('#month-income-total').textContent(),/60.?000/,'transaction-only databases must report all income categories');
  assert.match(await ledgerOnlyAnalytics.locator('#month-expense-total').textContent(),/25.?000/,'transaction-only databases must report all expense categories');
  assert.match(await ledgerOnlyAnalytics.locator('#month-overall-net').textContent(),/35.?000/,'transaction-only databases must calculate net cash flow');
  await ledgerOnlyAnalytics.close();

  assert.match(await analytics.locator('#month-expense-total').textContent(), /12.?502/, 'month expense total must use all ordinary expense categories');
  assert.match(await analytics.locator('#overview-period-caption').textContent(), /2026-01 — 2026-10/, 'the overview must display the selected reporting range');
  assert.equal(await analytics.locator('#range-year').getAttribute('aria-pressed'), 'true', 'the initial selected range preset must match the current-year period');
  assert.equal(await analytics.locator('#range-12').getAttribute('aria-pressed'), 'false', 'the 12-month preset must not be highlighted for the current-year range');
  assert.equal(await analytics.locator('#download-db').isDisabled(), true, 'opening Analytics must not silently modify or mark the selected .budget as changed');

  await analytics.locator('#settings-details > summary').click();
  await analytics.locator('[data-report-group="shop"][value="Продукты"]').check();

  const manualSeptember = await analytics.evaluate(() => {
    const rows = [
      {category:'Приход от работы Дима',amount:94000,role:'income'},
      {category:'Возвраты',amount:477,role:'income'},
      {category:'Дом/ Locker(аренда, ипотека, налоги, страховка)',amount:12500,role:'expense'},
      {category:'Кафе',amount:817,role:'expense'},
      {category:'Коммунальные услуги',amount:960,role:'expense'},
      {category:'Еда',amount:38912,role:'expense'},
      {category:'Для дома',amount:10938,role:'expense'},
      {category:'Путешествия',amount:58097,role:'expense'},
      {category:'Бензин Съем машины',amount:4025,role:'expense'},
      {category:'Такси',amount:1000,role:'expense'},
      {category:'Саша Расходы',amount:19739,role:'expense'},
      {category:'Саша Квартира Дедушки',amount:4892,role:'expense'},
      {category:'Продукты',amount:90000,role:'expense'},
      {category:'Магазин — вводы',amount:49000,role:'income'},
    ];
    const ledger = monthCategoriesWithoutShop(rows);
    const totals = noShopTotals(rows);
    return {
      income: totals.income,
      expense: totals.expense,
      net: totals.net,
      incomeRows: ledger.income.length,
      expenseRows: ledger.expense.length,
      cashDeposit: ledger.income.find(item => /наличные взнос/i.test(item.category))?.total ?? null,
      missingZero: ledger.expense.find(item => item.category === 'Рестораны')?.total ?? null,
      signedRefundNet: noShopTotals([
        {category:'Еда',amount:1000,role:'expense'},
        {category:'Еда',amount:-100,role:'expense'},
      ]).expense,
    };
  });
  assert.deepEqual(manualSeptember, {
    income: 94477,
    expense: 151880,
    net: -57403,
    incomeRows: 4,
    expenseRows: 28,
    cashDeposit: 0,
    missingZero: 0,
    signedRefundNet: 900,
  }, 'manual no-shop ledger must reproduce the September 2026 hand calculation, exclude unrelated categories, and net refunds');

  await analytics.locator('#sasha-shared-percent').fill('60');
  await analytics.locator('#save-settings').click();
  assert.match(await analytics.locator('#status').textContent(), /записаны внутрь базы/);
  assert.match(await analytics.locator('#month-no-shop-net').textContent(), /0/, 'changing shop settings must not alter the fixed manual no-shop calculation');
  assert.equal(await analytics.locator('#download-db').isDisabled(), false, 'only an explicit Save settings action should enable database export');
  const analyticsDownloadPromise = analytics.waitForEvent('download');
  await analytics.locator('#download-db').click();
  const analyticsDownload = await analyticsDownloadPromise;
  const analyticsExportPath = await analyticsDownload.path();
  assert(analyticsExportPath && fs.statSync(analyticsExportPath).size > 10000, 'Analytics must export the database with report settings');

  const settingsState = await analytics.evaluate(async bytes => {
    const SQL = await window.initSqlJs({ locateFile: file => './vendor/sql.js/' + file, useOldExtensionFunctions: true });
    const db = new SQL.Database(new Uint8Array(bytes));
    const read = key => JSON.parse(String(db.exec('SELECT value FROM web_metadata WHERE key=' + JSON.stringify(key))[0].values[0][0]));
    const settings = read('analytics_report_settings_v1');
    const legacyManualRow = db.exec("SELECT value FROM web_metadata WHERE key='numbers_manual_reference_v1'")[0]?.values?.[0]?.[0] ?? null;
    const legacyManualRows = legacyManualRow === null ? 0 : 1;
    const legacyManualValue = legacyManualRow === null ? null : JSON.parse(String(legacyManualRow));
    const result = { sharedPercent: settings.sharedPercent, shopCategories: settings.shop, hasNumbersHistory: Number(db.exec("SELECT COUNT(*) FROM numbers_history WHERE source='numbers'")[0].values[0][0]) === 5, legacyManualRows, legacyManualValue };
    db.close();
    return result;
  }, Array.from(fs.readFileSync(analyticsExportPath)));
  assert.equal(settingsState.sharedPercent, 60, 'Analytics category rules must be written inside the portable .budget file');
  assert.deepEqual(settingsState.shopCategories, ['Продукты'], 'shop exclusion rules must persist in the .budget file');
  assert.equal(settingsState.hasNumbersHistory, true, 'Analytics export must retain imported Numbers history');
  assert.equal(settingsState.legacyManualRows, 1, 'Analytics must preserve unrecognized legacy metadata instead of silently deleting it');
  assert.deepEqual(settingsState.legacyManualValue, { exampleOnly: true }, 'opening and exporting Analytics must leave legacy metadata unchanged');

  await analytics.locator('#manual-file').setInputFiles(analyticsExportPath);
  await analytics.waitForFunction(() => document.querySelector('#sasha-shared-percent')?.value === '60', null, { timeout: 20000 });

  // Opening Analytics from the main Budget Capture page must transfer the
  // already-open database in memory; the user must not select the file twice.
  const mainApp = await context.newPage();
  mainApp.on('pageerror', error => pageErrors.push(error.message));
  mainApp.on('request', request => {
    if (new URL(request.url()).origin !== origin) externalRequests.push(request.url());
  });
  mainApp.on('requestfailed', request => failedRequests.push(`${request.url()} · ${request.failure()?.errorText || 'failed'}`));
  await mainApp.goto(origin + basePath + 'index.html', { waitUntil: 'networkidle', timeout: 30000 });
  await mainApp.locator('#open-file').setInputFiles({
    name: analyticsDownload.suggestedFilename(),
    mimeType: 'application/octet-stream',
    buffer: fs.readFileSync(analyticsExportPath),
  });
  await mainApp.waitForFunction(() => document.querySelector('#db-name')?.textContent !== 'No database open', null, { timeout: 20000 });
  const popupPromise = context.waitForEvent('page');
  await mainApp.locator('#open-analytics').click();
  const transferredAnalytics = await popupPromise;
  transferredAnalytics.on('pageerror', error => pageErrors.push(error.message));
  transferredAnalytics.on('request', request => {
    if (new URL(request.url()).origin !== origin) externalRequests.push(request.url());
  });
  transferredAnalytics.on('requestfailed', request => failedRequests.push(`${request.url()} · ${request.failure()?.errorText || 'failed'}`));
  await transferredAnalytics.waitForFunction(() => !document.querySelector('#dashboard')?.classList.contains('hidden'), null, { timeout: 20000 });
  assert.match(await transferredAnalytics.locator('#incomeMetric').textContent(), /260\s?000/, 'Analytics must receive the main app database without a second file selection');
  assert.equal(await transferredAnalytics.locator('#manual-references').count(), 0, 'the handoff must not display illustrative manual figures');
  assert.ok(await transferredAnalytics.locator('#month-detail-title').textContent(), 'the handoff must render month detail');
  assert.equal(await transferredAnalytics.locator('#month-detail-select option').count(), 1, 'transferred history must populate the month selector');
  assert.equal(await transferredAnalytics.locator('#month-income-list .a-month-category-row').count(), 1, 'transferred history must render actual income categories');
  assert.equal(await transferredAnalytics.locator('#manual-file').inputValue(), '', 'the handoff must avoid a second file selection');
  assert.match(await transferredAnalytics.locator('#database-name').textContent(), /MyBudget|Budget/i, 'the transferred database name must be displayed');
  await transferredAnalytics.close();
  await mainApp.close();

  assert.deepEqual(pageErrors, [], 'Numbers pages must not raise uncaught browser errors');
  assert.deepEqual(externalRequests, [], 'Numbers pages must load every runtime asset from the same origin');
  assert.deepEqual(failedRequests, [], 'Numbers page asset requests must not fail');
  console.log('Numbers Chromium E2E: PASS · Excel preview · SQLite import/export · history replacement · transactions untouched · Analytics reads .budget without automatic writes, preserves legacy metadata, receives the already-open app database without re-selection, and saves report settings only after explicit action');
  await context.close();
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGTERM');
}
