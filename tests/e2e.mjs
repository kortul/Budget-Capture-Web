import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import fs from 'node:fs';

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
  await page.locator('#open-file').setInputFiles(savedPath);
  await page.waitForFunction(()=>document.querySelector('#db-state')?.textContent.includes('Database open'));
  await page.locator('[data-tab="review"]').click();
  await page.waitForFunction(()=>document.querySelector('#transaction-count')?.textContent==='1');
  assert.match(await page.locator('#transactions-body').innerText(),/E2E MARKET/);

  assert.deepEqual(pageErrors,[],'browser page must not raise uncaught errors');
  assert.deepEqual(externalRequests,[],'all runtime assets must be same-origin');
  assert.deepEqual(failedRequests,[],'no browser requests may fail');
  console.log('Chromium E2E: PASS · GitHub Pages subpath · local SQLite WASM · PDF.js worker/text extraction · T-Bank import · duplicate guard · .budget save/reopen · zero external requests');
  await context.close();
} finally {
  if(browser) await browser.close().catch(()=>{});
  server.kill('SIGTERM');
}
