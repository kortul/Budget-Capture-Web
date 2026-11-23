import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const port = Number(process.env.PORT || 4175);
const basePath = '/budget-capture-e2e/';
const origin = `http://127.0.0.1:${port}`;

function makeSyntheticPdf() {
  const stream = 'BT\n/F1 18 Tf\n50 700 Td\n(BROWSER PDF WORKER TEST) Tj\nET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'ascii');
}

// Wait for the import result to become visible and, on repeat imports, change.
// Visibility alone can accidentally accept the previous import's still-rendered text.
async function waitForImportResult(page, previousText = null) {
  await page.waitForFunction(previous => {
    const result = document.querySelector('#import-result');
    if (!result || result.classList.contains('hidden')) return false;
    const currentText = result.innerText.trim();
    return currentText.length > 0 && (previous === null || currentText !== previous);
  }, previousText, { timeout: 20000 });

  return page.locator('#import-result').evaluate(result => ({
    text: result.innerText.trim(),
    heading: result.querySelector(':scope > b')?.textContent?.trim() || '',
    metrics: Object.fromEntries([...result.querySelectorAll('.result-cell')].map(cell => [
      cell.querySelector('span')?.textContent?.trim() || '',
      cell.querySelector('b')?.textContent?.trim() || '',
    ])),
  }));
}
const server = spawn(process.execPath, ['scripts/serve-test.mjs'], {env:{...process.env,PORT:String(port),BASE_PATH:basePath},stdio:['ignore','pipe','pipe']});
let serverOutput = '';
server.stdout.on('data', chunk => { serverOutput += chunk.toString(); });
server.stderr.on('data', chunk => { serverOutput += chunk.toString(); });
let browser;
try {
  let ready = false;
  for (let i=0;i<80;i++) {
    try { const r=await fetch(origin+basePath); if(r.ok){ready=true;break;} } catch {}
    if(server.exitCode!==null)break;
    await delay(250);
  }
  assert(ready, `static server did not become ready: ${serverOutput}`);
  browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context = await browser.newContext({acceptDownloads:true});
  const page = await context.newPage();
  const pageErrors=[]; const externalRequests=[]; const failedRequests=[];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('request', req => { if(new URL(req.url()).origin!==origin) externalRequests.push(req.url()); });
  page.on('requestfailed', req => failedRequests.push(`${req.url()} · ${req.failure()?.errorText||'failed'}`));
  const response=await page.goto(origin+basePath,{waitUntil:'networkidle',timeout:30000});
  assert.equal(response.status(),200,'site root must be served under a repository subpath');
  await page.waitForFunction(()=>document.querySelector('#new-db')&&!document.querySelector('#new-db').disabled,{},{timeout:20000});
  assert.equal(await page.locator('#app-version').textContent(),'0.1.6.0');
  assert.equal(await page.locator('#dependency-warning').isVisible(),false,'same-origin SQLite runtime should load');
  const pdfResourceSamples = await page.evaluate(async () => {
    const manifestResponse = await fetch('./asset-manifest.json');
    if (!manifestResponse.ok) throw new Error('asset-manifest.json is not available');
    const manifest = await manifestResponse.json();
    const assets = Object.keys(manifest.assets || {});
    const required = [
      ['CMap', 'vendor/pdfjs/cmaps/', '.bcmap'],
      ['standard font', 'vendor/pdfjs/standard_fonts/', '.ttf'],
      ['WASM decoder', 'vendor/pdfjs/wasm/', '.wasm'],
      ['ICC profile', 'vendor/pdfjs/iccs/', '.icc'],
    ];
    const samples = required.map(([label, prefix, extension]) => {
      const asset = assets.find(path => path.startsWith(prefix) && path.endsWith(extension));
      if (!asset) throw new Error(`PDF.js ${label} is missing from the asset manifest`);
      return { label, asset };
    });
    const checks = await Promise.all(samples.map(async sample => {
      const response = await fetch(sample.asset);
      const bytes = await response.arrayBuffer();
      return { ...sample, status: response.status, bytes: bytes.byteLength };
    }));
    return checks;
  });
  for (const resource of pdfResourceSamples) {
    assert.equal(resource.status, 200, `same-origin ${resource.label} must load`);
    assert(resource.bytes > 0, `same-origin ${resource.label} must not be empty`);
  }
  await page.evaluate(async ({apiUrl,workerUrl})=>{
    const library=await import(apiUrl);
    library.GlobalWorkerOptions.workerSrc=workerUrl;
    window.pdfjsLib=library;
  },{apiUrl:origin+basePath+'vendor/pdfjs/pdf.mjs',workerUrl:origin+basePath+'vendor/pdfjs/pdf.worker.mjs'});
  assert.equal(await page.evaluate(()=>typeof window.pdfjsLib?.getDocument),'function','same-origin PDF.js ESM runtime should load');
  assert.equal(await page.evaluate(()=>window.pdfjsLib?.version),'6.5.438','PDF.js API version must match the pinned package');
  const syntheticPdf = Array.from(makeSyntheticPdf());
  const extractedPdfText = await page.evaluate(async bytes => {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.mjs';
    const assetBase = new URL('./vendor/pdfjs/', globalThis.document.baseURI).href;
    const pdfLoadingTask = window.pdfjsLib.getDocument({
      data:new Uint8Array(bytes),
      isEvalSupported:false,
      cMapUrl:`${assetBase}cmaps/`,
      cMapPacked:true,
      standardFontDataUrl:`${assetBase}standard_fonts/`,
      wasmUrl:`${assetBase}wasm/`,
      iccUrl:`${assetBase}iccs/`,
      useWorkerFetch:true,
    });
    if (typeof pdfLoadingTask.destroy !== 'function') {
      throw new TypeError('PDF.js loading task does not expose destroy()');
    }
    try {
      const pdfDocument = await pdfLoadingTask.promise;
      const firstPage = await pdfDocument.getPage(1);
      const text = await firstPage.getTextContent();
      return text.items.map(item => item.str).join(' ');
    } finally {
      // PDF.js 6.x exposes destroy() on PDFDocumentLoadingTask, not on
      // PDFDocumentProxy. Always terminate the worker after extracting text.
      await pdfLoadingTask.destroy();
    }
  }, syntheticPdf);
  assert.match(extractedPdfText,/BROWSER PDF WORKER TEST/,'PDF.js must execute the same-origin worker and extract text');

  await page.evaluate(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));
  await page.locator('#new-db').click();
  try {
    await page.waitForFunction(()=>document.querySelector('#db-state')?.textContent.includes('Unsaved changes'),null,{timeout:10000});
  } catch(error) {
    const uiState=await page.evaluate(()=>({
      databaseState:document.querySelector('#db-state')?.textContent||'',
      toast:document.querySelector('#toast')?.textContent||'',
      dependencyWarning:document.querySelector('#dependency-warning')?.textContent||'',
      statistics:document.querySelector('#db-statistics')?.textContent||'',
      newDatabaseDisabled:document.querySelector('#new-db')?.disabled??null
    }));
    throw new Error(`Creating a new browser test database failed: ${JSON.stringify({uiState,pageErrors})}; ${error.message}`);
  }

  const headers=['Имя счёта','Дата операции','Сумма операции','Валюта операции','Сумма в валюте счёта','Валюта счёта','Статус','Описание','Сообщение','Учёт в аналитике','Номер карты'];
  await page.addScriptTag({url:origin+basePath+'vendor/xlsx/xlsx.full.min.js'});
  assert.equal(await page.evaluate(()=>window.XLSX?.version),'0.20.3','same-origin SheetJS runtime must use the pinned security-maintained version');
  const xlsxBase64=await page.evaluate(({headers})=>{
    const XLSX=window.XLSX;
    const wb=XLSX.utils.book_new();
    const sheet=XLSX.utils.aoa_to_sheet([headers,['Black','31.10.2026','123.45','RUB','123.45','RUB','Ок','E2E MARKET','','Да','*9001']]);
    XLSX.utils.book_append_sheet(wb,sheet,'Операции');
    return XLSX.write(wb,{bookType:'xlsx',type:'base64'});
  },{headers});
  const buffer=Buffer.from(xlsxBase64,'base64');
  const file={name:'Budget-Capture-E2E.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer};
  await page.locator('#statement-files').setInputFiles(file);
  await page.locator('#run-import').click();
  const firstImportResult = await waitForImportResult(page);
  assert.match(firstImportResult.heading,/^Import complete/i,'first import must complete successfully');
  assert.equal(firstImportResult.metrics.Imported,'1','first import must insert one transaction');
  assert.equal(firstImportResult.metrics['Duplicates skipped'],'0','first import must not report duplicates');
  await page.locator('[data-tab="review"]').click();
  await page.waitForFunction(()=>document.querySelector('#transaction-count')?.textContent==='1');
  assert.match(await page.locator('#transactions-body').innerText(),/E2E MARKET/);
  const searchInput=page.locator('#filter-search');
  await searchInput.fill('E2E MARKET');
  await page.waitForFunction(()=>document.querySelector('#transaction-count')?.textContent==='1');
  assert.match(await page.locator('#transactions-body').innerText(),/E2E MARKET/,'Review search must retain matching rows');
  await searchInput.fill('NO SUCH MERCHANT');
  await page.waitForFunction(()=>document.querySelector('#transaction-count')?.textContent==='0');
  assert.match(await page.locator('#transactions-body').innerText(),/No transactions match/,'Review search must hide non-matching rows');
  await searchInput.fill('');
  await page.waitForFunction(()=>document.querySelector('#transaction-count')?.textContent==='1');

  // Category dropdowns mirror the desktop workflow: grouped by category type,
  // with Russian/Latin names naturally alphabetized inside each group.
  const categoryUi = await page.evaluate(() => {
    const transactionSelect = document.querySelector('#transactions-body select[data-action="category"]');
    const filterSelect = document.querySelector('#filter-category');
    const readGroups = select => [...select.querySelectorAll(':scope > optgroup')].map(group => {
      const names = [...group.querySelectorAll(':scope > option')].map(option => option.textContent.trim());
      const collator = new Intl.Collator('ru-RU',{sensitivity:'base',numeric:true});
      return {
        label: group.label,
        names,
        alphabetized: names.every((name,index) => index===0 || collator.compare(names[index-1],name)<=0)
      };
    });
    return {transaction:readGroups(transactionSelect),filter:readGroups(filterSelect)};
  });
  const categoryGroupNames = categoryUi.transaction.map(group => group.label);
  assert.deepEqual(categoryGroupNames,['РАСХОДЫ','ДОХОДЫ'],'Review category dropdown must show exactly Expenses then Income');
  assert(categoryUi.transaction.every(group => group.alphabetized),'each Review category group must be alphabetically sorted');
  assert(categoryUi.transaction.every((group,index) => group.names.length>0),'each category group must contain options');
  assert.deepEqual(categoryUi.filter.map(group => group.label),categoryUi.transaction.map(group => group.label),'category filter must use the same two groups as transaction editing');
  assert(categoryUi.filter.every(group => group.alphabetized),'each filter category group must be alphabetically sorted');
  const optionColors = await page.locator('#transactions-body select[data-action="category"]').evaluate(select => ({
    expense:select.querySelector('optgroup.expense-group option')?.classList.contains('expense-option')||false,
    income:select.querySelector('optgroup.income-group option')?.classList.contains('income-option')||false
  }));
  assert.deepEqual(optionColors,{expense:true,income:true},'expense and income options must carry their distinct red/green styles');
  await page.locator('#transactions-body select[data-action="category"]').selectOption('Еда');
  assert.equal(await page.locator('#transactions-body select[data-action="category"]').inputValue(),'Еда','manual category reassignment must update the transaction itself');


  // Reimport the same bytes. Stable source refs must prevent a duplicate row.
  await page.locator('[data-tab="import"]').click();
  await page.locator('#statement-files').setInputFiles(file);
  await page.locator('#run-import').click();
  const duplicateImportResult = await waitForImportResult(page, firstImportResult.text);
  assert.match(duplicateImportResult.heading,/^Import complete/i,'repeat import must complete successfully');
  assert.equal(duplicateImportResult.metrics.Imported,'0','repeat import must not insert a duplicate transaction');
  assert.equal(duplicateImportResult.metrics['Duplicates skipped'],'1','repeat import must skip the existing transaction');
  assert.equal(duplicateImportResult.metrics.Extracted,'1','repeat import must still parse the source row');
  await page.locator('[data-tab="review"]').click();
  await page.waitForFunction(()=>document.querySelector('#transaction-count')?.textContent==='1');

  const downloadPromise=page.waitForEvent('download');
  await page.locator('#save-db').click();
  const download=await downloadPromise;
  assert.equal(download.suggestedFilename(),'MyBudget.budget');
  const savedPath=await download.path();
  assert(savedPath&&fs.statSync(savedPath).size>10000,'saved SQLite file must be non-empty');
  const savedDb=new DatabaseSync(savedPath);
  try {
    const savedCategory=savedDb.prepare("SELECT category FROM transactions WHERE merchant LIKE '%E2E MARKET%' ORDER BY tx_date DESC LIMIT 1").get()?.category;
    assert.equal(savedCategory,'Еда','manual category reassignment must persist in the saved transaction ledger');
    const legacyAdjustments=Number(savedDb.prepare('SELECT COUNT(*) AS count FROM numbers_category_adjustments').get()?.count||0);
    assert.equal(legacyAdjustments,0,'manual category reassignment must not recreate the removed Sigma adjustment workflow');
  } finally {
    savedDb.close();
  }
  await page.locator('#open-file').setInputFiles(savedPath);
  await page.waitForFunction(()=>document.querySelector('#db-state')?.textContent.includes('Database open'));
  await page.locator('[data-tab="review"]').click();
  await page.waitForFunction(()=>document.querySelector('#transaction-count')?.textContent==='1');
  assert.match(await page.locator('#transactions-body').innerText(),/E2E MARKET/);
  assert.equal(await page.locator('#transactions-body select[data-action="category"]').inputValue(),'Еда','reassigned transaction category must survive .budget save and reopen');



  // Financial analytics opens on the selected month; period filters remain isolated
  // and cannot prevent opening a month that is outside the selected period.
  const analyticsFixtureDir=fs.mkdtempSync(path.join(os.tmpdir(),'budget-analytics-e2e-'));
  const analyticsFixturePath=path.join(analyticsFixtureDir,'Analytics.budget');
  const analyticsFixture=new DatabaseSync(analyticsFixturePath);
  try {
    analyticsFixture.exec(`CREATE TABLE numbers_history (
      month_key TEXT NOT NULL,year INTEGER NOT NULL,month INTEGER NOT NULL,
      kind TEXT NOT NULL,category TEXT NOT NULL,amount REAL NOT NULL,role TEXT,source TEXT NOT NULL
    )`);
    const addHistory=analyticsFixture.prepare('INSERT INTO numbers_history(month_key,year,month,kind,category,amount,role,source) VALUES(?,?,?,?,?,?,?,?)');
    for(const row of [
      ['2026-09',2026,9,'income','Работа',1000,'income','numbers'],
      ['2026-05',2026,5,'expense','Еда',0,'expense','numbers'],
      ['2026-06',2026,6,'expense','Еда',0,'expense','numbers'],
      ['2026-07',2026,7,'expense','Еда',0,'expense','numbers'],
      ['2026-08',2026,8,'expense','Еда',0,'expense','numbers'],
      ['2026-09',2026,9,'expense','Еда',3000,'expense','numbers'],
      ['2026-09',2026,9,'expense','Ремонт',5000,'expense','numbers'],
      ['2026-10',2026,10,'income','Работа',2000,'income','numbers'],
      ['2026-10',2026,10,'expense','Еда',4000,'expense','numbers'],
      ['2026-11',2026,11,'income','Работа',500,'income','numbers'],
      ['2026-11',2026,11,'expense','Еда',8000,'expense','numbers'],
      ['2026-11',2026,11,'expense','Ремонт',20000,'expense','numbers'],
    ]) addHistory.run(...row);
  } finally { analyticsFixture.close(); }

  const analyticsPage=await context.newPage();
  analyticsPage.on('pageerror',e=>pageErrors.push('analytics: '+e.message));
  analyticsPage.on('request',req=>{if(new URL(req.url()).origin!==origin)externalRequests.push(req.url());});
  analyticsPage.on('requestfailed',req=>failedRequests.push('analytics: '+req.url()+' · '+(req.failure()?.errorText||'failed')));
  await analyticsPage.goto(origin+basePath+'numbers-analytics.html',{waitUntil:'networkidle',timeout:30000});
  await analyticsPage.locator('#manual-file').setInputFiles(analyticsFixturePath);
  await analyticsPage.waitForFunction(()=>!document.querySelector('#dashboard')?.classList.contains('hidden')&&document.querySelector('#month-detail-title')?.textContent==='Ноябрь 2026',null,{timeout:20000});
  assert.equal(await analyticsPage.locator('#report-tab-month').getAttribute('aria-selected'),'true','Month tab must be selected by default');
  assert.equal(await analyticsPage.locator('#month-view').isVisible(),true,'Month analysis must be the first visible workspace');
  assert.equal(await analyticsPage.locator('#period-view').isVisible(),false,'Period analysis must be a separate inactive tab');
  assert.equal(await analyticsPage.locator('#month-overall-net').textContent(),'-27 500 ₽','default month must show that month only');
  assert.equal(await analyticsPage.locator('#month-insights .a-month-insight').count(),4,'Month view must show two headline insights plus category growth and anomaly analysis');
  const growthText=await analyticsPage.locator('#month-insights').nth(2).textContent();
  assert.match(growthText,/Еда/,'three-month comparison must flag the rising Food category');
  assert.match(growthText,/Ремонт/,'three-month comparison must flag the rising Repair category');
  assert.match(await analyticsPage.locator('#month-insights').nth(3).textContent(),/Ремонт/,'six-month anomaly analysis must flag an unusually high category spend');
  assert.match(await analyticsPage.locator('#month-insights').nth(3).textContent(),/медиан/i,'anomaly insight must disclose its six-month median baseline');
  const monthOptions=await analyticsPage.locator('#month-detail-select option').evaluateAll(options=>options.map(option=>option.value));
  assert.deepEqual(monthOptions,['2026-09','2026-10','2026-11'],'Month picker must list all months in the database');

  await analyticsPage.locator('#report-tab-period').click();
  assert.equal(await analyticsPage.locator('#period-view').isVisible(),true,'Period tab must open its own workspace');
  assert.equal(await analyticsPage.locator('#month-view').isVisible(),false,'Month workspace must be hidden while Period is active');
  await analyticsPage.locator('#range-from').fill('2026-11');
  await analyticsPage.locator('#range-from').dispatchEvent('change');
  await analyticsPage.locator('#range-to').fill('2026-11');
  await analyticsPage.locator('#range-to').dispatchEvent('change');
  assert.equal(await analyticsPage.locator('#overview-range').textContent(),'2026-11 — 2026-11','Period tab must apply its own one-month range');

  await analyticsPage.locator('#report-tab-month').click();
  await analyticsPage.locator('#month-detail-select').selectOption('2026-10');
  await analyticsPage.waitForFunction(()=>document.querySelector('#month-detail-title')?.textContent==='Октябрь 2026');
  assert.equal(await analyticsPage.locator('#month-overall-net').textContent(),'500 ₽','October must open even though the Period tab is filtered to November');
  assert.equal(await analyticsPage.locator('#range-from').inputValue(),'2026-11','Month selection must not change Period start');
  assert.equal(await analyticsPage.locator('#range-to').inputValue(),'2026-11','Month selection must not change Period end');
  await analyticsPage.locator('#report-tab-year').click();
  assert.equal(await analyticsPage.locator('#year-view').isVisible(),true,'Year tab must show its own annual workspace');
  assert.equal(await analyticsPage.locator('#period-view').isVisible(),false,'Year tab must not reuse Period workspace');
  assert.equal(await analyticsPage.locator('#year-detail-select').inputValue(),'2026','Year selector must default to latest available year');
  assert.equal(await analyticsPage.locator('#year-income-value').textContent(),'3 500 ₽','Year report must aggregate all ordinary income for selected year');
  assert.equal(await analyticsPage.locator('#year-expense-value').textContent(),'40 000 ₽','Year report must aggregate all ordinary expenses for selected year');
  assert.equal(await analyticsPage.locator('#year-net-value').textContent(),'-36 500 ₽','Year report must calculate annual net cash flow');
  assert.equal(await analyticsPage.locator('#year-month-chart svg').count(),1,'Year report must render monthly cashflow');
  assert.equal(await analyticsPage.locator('#year-expense-list .a-month-category-row').count(),2,'Year report must list expense categories');
  assert.equal(await analyticsPage.locator('#year-comparison').count(),1,'Long-term year comparison must be available inside Year tab');
  await analyticsPage.close();
  fs.rmSync(analyticsFixtureDir,{recursive:true,force:true});

  assert.deepEqual(pageErrors,[],'browser page must not raise uncaught errors');
  assert.deepEqual(externalRequests,[],'all runtime assets must be same-origin');
  assert.deepEqual(failedRequests,[],'no browser requests may fail');
  console.log('Chromium E2E: PASS · GitHub Pages subpath · local SQLite WASM · PDF.js worker/text extraction · T-Bank import · duplicate guard · .budget save/reopen · zero external requests');
  await context.close();
} finally {
  if(browser) await browser.close().catch(()=>{});
  server.kill('SIGTERM');
}
