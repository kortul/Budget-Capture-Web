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
  await analytics.locator('#manual-file').setInputFiles(secondExportPath);
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
  await analytics.locator('#life > summary').click();
  assert.notEqual(await analytics.locator('#life').getAttribute('open'), null, 'the living expenses panel must expand on click');
  assert.equal(await analytics.locator('#life-trend-chart').isVisible(), true, 'visualization must be visible when its panel is expanded');
  await analytics.locator('#life > summary').click();
  assert.equal(await analytics.locator('#life').getAttribute('open'), null, 'the living expenses panel must collapse on the second click');
  assert.equal(await analytics.locator('#manual-references').count(), 0, 'the illustrative manual summary section must not be displayed');
  assert.equal(await analytics.locator('#range-from').inputValue(), '2026-01', 'analytics must default to the latest available year start');
  assert.ok(await analytics.locator('#month-detail-title').textContent(), 'monthly detail must be rendered after loading');
  assert.equal(await analytics.locator('#month-detail-select option').count(), 1, 'month selector must list available months in the reporting range');
  assert.equal(await analytics.locator('#month-income-list .a-month-category-row').count(), 1, 'income list must show active imported income categories');
  assert.equal(await analytics.locator('#month-expense-list .a-month-category-row').count(), 1, 'expense list must show active imported expense categories');
  assert.match(await analytics.locator('#month-income-list').innerText(), /Зарплата/, 'income list must show actual imported categories');
  assert.match(await analytics.locator('#month-expense-list').innerText(), /Продукты/, 'expense list must include categories assigned to the shop in settings');
  assert.equal(await analytics.locator('#month-expense-chart svg').count(), 1, 'expense composition must render a donut chart');
  assert.equal(await analytics.locator('#month-insights .a-month-insight').count(), 3, 'month view must include three concise data-driven insights');
  assert.equal(await analytics.locator('#month-expense-list .a-month-category-row').count(), 1, 'zero-valued categories must not be rendered');
  assert.equal(await analytics.locator('#cashflow-chart svg.a-chart-svg').count(), 1, 'Financial Analytics must render the interactive cashflow SVG chart');
  assert.match(await analytics.locator('#month-overall-net').textContent(), /247\\s?498/, 'month headline must show income less expense including all ordinary categories');
  assert.match(await analytics.locator('#month-no-shop-net').textContent(), /0/, 'manual no-shop total must stay zero when imported categories do not match its fixed lists');
  assert.match(await analytics.locator('#month-sasha-expense').textContent(), /0/, 'missing Sasha category must safely display zero');
  assert.match(await analytics.locator('#month-dima-net').textContent(), /50\\s?000/, 'Dima inputs minus outputs must appear as a separate monthly metric');
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
  const kgrAdjustmentFixture = await analytics.evaluate(() => {
    const base = [
      {month_key:'2026-10',year:2026,month:10,kind:'income',role:'income',category:'Приход магазин',amount:312366.88},
      {month_key:'2026-10',year:2026,month:10,kind:'expense',role:'expense',category:'KGR',amount:96784.78},
      {month_key:'2026-10',year:2026,month:10,kind:'expense',role:'expense',category:'Остальные расходы',amount:180835.39}
    ];
    const changes = [{base_category:'Не распределено',base_kind:'other',tx_date:'2026-10-23',amount:41000,currency:'RUB',current_category:'KGR'}];
    const kinds = new Map([['kgr','expense']]);
    const adjusted=applyNumbersCategoryAdjustments(base,changes,kinds);
    const october=adjusted.rows.filter(row=>row.month_key==='2026-10'),totals=totalsFor(october);
    return {kgr:october.find(row=>row.category==='KGR')?.amount,expense:totals.expense,income:totals.income,net:totals.net,applied:adjusted.applied};
  });
  assert.deepEqual(kgrAdjustmentFixture,{kgr:55784.78,expense:236620.17,income:312366.88,net:75746.71,applied:1},'positive RUB transaction assigned to KGR expense lowers it by 41,000 exactly once');


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
  }, 'manual no-shop ledger must reproduce the September 2026 hand calculation and exclude unrelated categories');

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
  await mainApp.locator('#open-file').setInputFiles(analyticsExportPath);
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
