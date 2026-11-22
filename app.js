import {
  APP_VERSION, categoryKind, numbersCategoryTotals, sortCategoriesAlphabetically, categoryDropdownGroup, categoryDropdownGroups,
  isInternalTransfer, applyOwnSbpNameMarkers, uuid, monthNowPrevious, monthOf, amountCents,
  numbersValue, displayMoney, sha256Hex, parseSberLinePages,
  parseTbankRows, parseRaiffeisenCSV, parseYandexWordPages, pdfJsItemsToYandexWords, decodeStatementBytes, inferMonth, categoryRuleKey
} from './core.js';
import {
  createDatabase, openDatabase, initializeDatabase, databaseNeedsSave, all, one, scalar,
  insertTransaction, insertBatch, addRecognizedAccount, upsertRecognizedAccount, importLegacyJson,
  exportLegacyJson, readBudgetProfile, saveBudgetProfile, exportBudgetProfile, importBudgetProfile
} from './db.js';

const $ = (id) => document.getElementById(id);
const state = { SQL:null, db:null, dbName:'', fileHandle:null, dirty:false, selectedFiles:[], activeBank:'TOTAL', selected:new Set(), transactions:[], profile:null, toastTimer:null };
const fmt = new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2});
const esc = (v='') => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nowIso = () => new Date().toISOString();
let sharedSnapshotTimer = null;
async function saveSharedDatabaseSnapshot() {
  if (!state.db || !window.BudgetSharedDb) return;
  try {
    const bytes = state.db.export();
    await window.BudgetSharedDb.saveDatabase(state.dbName || 'MyBudget.budget', bytes);
  } catch (error) {
    console.warn('Analytics local database sync is unavailable:', error);
  }
}
function scheduleSharedDatabaseSnapshot() {
  clearTimeout(sharedSnapshotTimer);
  sharedSnapshotTimer = setTimeout(() => { void saveSharedDatabaseSnapshot(); }, 500);
}
const isReady = () => !!state.db;

function toast(message, bad=false){const el=$('toast');el.textContent=message;el.classList.toggle('bad',bad);el.classList.add('show');clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>el.classList.remove('show'),3600);}
function showError(message){toast(message,true);console.error(message);}
function setDirty(value=true){state.dirty=value;$('save-db').disabled=!state.db||!value;$('data-save').disabled=!state.db||!value;$('db-dot').classList.toggle('open',!!state.db&&!value);$('db-dot').classList.toggle('dirty',!!state.db&&value);$('db-state').textContent=state.db?(value?'Unsaved changes · analytics syncs in this browser':'Database open · all changes saved'):'Create a database or open your existing SQLite file';if(value)scheduleSharedDatabaseSnapshot();else clearTimeout(sharedSnapshotTimer);}
function setDbName(name){state.dbName=name||'MyBudget.budget';$('db-name').textContent=state.dbName;}
function ownSbpNameMarkers(){if(!state.db)return[];const row=one(state.db,"SELECT value FROM web_metadata WHERE key='own_sbp_name_markers'");try{return row?JSON.parse(row.value):[];}catch{return[];}}
function renderOwnSbpMarkers(){if(!state.db)return;const el=$('own-sbp-markers');if(el&&document.activeElement!==el)el.value=ownSbpNameMarkers().join('\n');}
function saveOwnSbpMarkers(){if(!state.db)return;const values=[...new Set($('own-sbp-markers').value.split(/\r?\n/).map(x=>x.trim()).filter(x=>x.length>=3))];state.db.run("INSERT OR REPLACE INTO web_metadata(key,value) VALUES('own_sbp_name_markers',?)",[JSON.stringify(values)]);setDirty(true);renderOwnSbpMarkers();toast(`Saved ${values.length} own SBP name marker(s) in this database`);updateStats();}
function updateStats(){if(!state.db){$('db-statistics').textContent='No database open.';return;}const counts={transactions:Number(scalar(state.db,'SELECT COUNT(*) FROM transactions WHERE deleted_at IS NULL')||0),categories:Number(scalar(state.db,'SELECT COUNT(*) FROM categories')||0),rules:Number(scalar(state.db,'SELECT COUNT(*) FROM category_rules')||0),accounts:Number(scalar(state.db,'SELECT COUNT(*) FROM recognized_accounts')||0),batches:Number(scalar(state.db,'SELECT COUNT(*) FROM import_batches')||0)};$('db-statistics').innerHTML=`<b>${counts.transactions.toLocaleString('ru-RU')}</b> active transactions · <b>${counts.categories}</b> categories · <b>${counts.rules}</b> category rules<br><b>${counts.accounts}</b> recognized accounts/cards · <b>${counts.batches}</b> import batches<br><span class="muted">${state.dirty?'Unsaved changes — save before closing this tab.':'No pending database changes.'}</span>`;}
function guardUnsaved(){if(state.dirty)return confirm('There are unsaved changes. Continue without saving?');return true;}

// Production runtime dependencies are bundled into the GitHub Pages site by scripts/build-pages.mjs.
// Do not fall back to third-party CDNs: finance documents and database work must stay same-origin.
const SCRIPT_CANDIDATES={
  sql:[{script:'./vendor/sql.js/sql-wasm.js',base:'./vendor/sql.js/'}],
  xlsx:['./vendor/xlsx/xlsx.full.min.js'],
  pdf:[{module:'./vendor/pdfjs/pdf.mjs',worker:'./vendor/pdfjs/pdf.worker.mjs'}]
};
const loadedScripts=new Set();
function loadExternalScript(url){if(loadedScripts.has(url))return Promise.resolve();return new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=url;script.async=true;script.crossOrigin='anonymous';script.referrerPolicy='no-referrer';const host=()=>{try{return new URL(url,document.baseURI).hostname||'local bundle';}catch{return 'library source';}};const timer=setTimeout(()=>{script.remove();reject(new Error(`Timed out loading ${host()}`));},12000);script.onload=()=>{clearTimeout(timer);loadedScripts.add(url);resolve();};script.onerror=()=>{clearTimeout(timer);script.remove();reject(new Error(`Could not load ${host()}`));};document.head.appendChild(script);});}
async function loadGlobal(globalName,candidates){if(window[globalName])return null;let lastError;for(const candidate of candidates){const url=typeof candidate==='string'?candidate:candidate.script;try{await loadExternalScript(url);if(window[globalName])return candidate;lastError=new Error(`${globalName} was not created by ${url}`);}catch(error){lastError=error;}}throw new Error(`${globalName} library could not be loaded from the same-origin /vendor folder. The published site may be missing its bundled runtime assets. ${lastError?.message||''}`);}
async function loadSql(){if(state.SQL)return state.SQL;let lastError;let hasGlobal=typeof window.initSqlJs==='function';for(const candidate of SCRIPT_CANDIDATES.sql){try{if(!hasGlobal){await loadGlobal('initSqlJs',[candidate]);hasGlobal=true;}state.SQL=await window.initSqlJs({locateFile:file=>`${candidate.base}${file}`,useOldExtensionFunctions:true});return state.SQL;}catch(error){lastError=error;}}throw new Error(`SQLite engine could not be initialized from the same-origin /vendor folder. ${lastError?.message||''}`);}
async function loadXlsx(){if(window.XLSX)return window.XLSX;await loadGlobal('XLSX',SCRIPT_CANDIDATES.xlsx);return window.XLSX;}
async function loadPdf(){if(window.pdfjsLib)return window.pdfjsLib;let lastError;for(const candidate of SCRIPT_CANDIDATES.pdf){try{const library=await import(candidate.module);library.GlobalWorkerOptions.workerSrc=candidate.worker;window.pdfjsLib=library;return library;}catch(error){lastError=error;}}throw new Error(`PDF.js module could not be loaded from the same-origin /vendor folder. ${lastError?.message||''}`);}
function attachDb(db,name,{dirty=false}={}){if(state.db&&state.db!==db){try{state.db.close();}catch{}}state.db=db;state.profile=readBudgetProfile(db);setDbName(name);state.selected.clear();setDirty(false);if(dirty)setDirty(true);renderAll();void saveSharedDatabaseSnapshot();}
async function newDatabase(){if(!guardUnsaved())return;try{const SQL=await loadSql();attachDb(createDatabase(SQL),'MyBudget.budget',{dirty:true});}catch(e){showError(e.message);}}
async function openDatabaseFile(file){if(!file)return;if(!guardUnsaved())return;let db=null;try{const bytes=new Uint8Array(await file.arrayBuffer());const SQL=await loadSql();let dirty=false;if(file.name.toLowerCase().endsWith('.json')){const payload=JSON.parse(new TextDecoder().decode(bytes));db=importLegacyJson(SQL,payload);dirty=true;}else{db=openDatabase(SQL,bytes);dirty=databaseNeedsSave(db);}const txCount=Number(scalar(db,'SELECT COUNT(*) FROM transactions')||0);attachDb(db,file.name,{dirty});state.fileHandle=null;toast(dirty?`Database opened · ${txCount.toLocaleString('ru-RU')} records · migration changes need saving`:`Database opened · ${txCount.toLocaleString('ru-RU')} transaction records`);}catch(e){if(db){try{db.close();}catch{}}showError(`Could not open database: ${e.message}`);}}
async function saveDatabase(){
  if(!state.db)return;
  let verificationDb=null;
  try {
    const sourceCheck=String(scalar(state.db,'PRAGMA quick_check')||'');
    if(sourceCheck!=='ok')throw new Error(`Database integrity check failed: ${sourceCheck||'unknown result'}`);
    const bytes=state.db.export();
    verificationDb=new state.SQL.Database(bytes);
    const exportedCheck=String(scalar(verificationDb,'PRAGMA quick_check')||'');
    if(exportedCheck!=='ok')throw new Error(`Exported database integrity check failed: ${exportedCheck||'unknown result'}`);
    const tables=['transactions','accounts','categories','import_batches','merchant_rules','merchant_labels','category_rules','recognized_accounts','transaction_delete_actions','web_metadata','numbers_history'];
    for(const table of tables){
      const before=Number(scalar(state.db,`SELECT COUNT(*) FROM ${table}`)||0);
      const after=Number(scalar(verificationDb,`SELECT COUNT(*) FROM ${table}`)||0);
      if(before!==after)throw new Error(`Export verification failed for ${table}: ${before} → ${after} rows.`);
    }
    verificationDb.close();verificationDb=null;
    const blob=new Blob([bytes],{type:'application/vnd.sqlite3'});
    const base=(state.dbName||'MyBudget.budget').replace(/\.(sqlite3?|db|budget)$/i,'');
    const filename=`${base||'MyBudget'}.budget`;
    if(window.showSaveFilePicker){
      try {
        const handle=await window.showSaveFilePicker({suggestedName:filename,types:[{description:'Budget Capture database',accept:{'application/vnd.sqlite3':['.budget','.sqlite3']}}]});
        const writable=await handle.createWritable();
        await writable.write(blob);await writable.close();
        try{await window.BudgetSharedDb?.saveDatabase(handle.name||filename,bytes);}catch(cacheError){console.warn('Analytics local cache could not be updated:',cacheError);}
        state.fileHandle=handle;setDbName(handle.name||filename);setDirty(false);updateStats();toast('Database saved and verified');return;
      } catch(error) {
        if(error.name==='AbortError')return;
        console.warn('Save picker unavailable; falling back to download',error);
      }
    }
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
    try{await window.BudgetSharedDb?.saveDatabase(filename,bytes);}catch(cacheError){console.warn('Analytics local cache could not be updated:',cacheError);}
    setDbName(filename);setDirty(false);updateStats();toast('Database downloaded and verified.');
  } catch(error) {
    showError(`Save failed: ${error.message}`);
  } finally {
    if(verificationDb){try{verificationDb.close();}catch{}}
  }
}

function activateTab(tab){document.querySelectorAll('.main-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active',p.id===`tab-${tab}`));if(tab==='review')renderTransactions();if(tab==='numbers')renderNumbers();if(tab==='accounts')renderAccounts();if(tab==='data'){updateStats();renderOwnSbpMarkers();}}
function categoryItems(extraName=''){
  if(!state.db)return[];
  state.profile=readBudgetProfile(state.db);
  const items=[...state.profile.categories];
  if(extraName&&!items.some(item=>item.name===extraName))items.push({name:extraName,kind:'other'});
  return items;
}
function categoryOptionGroups(selected=''){
  const groups=categoryDropdownGroups(categoryItems(selected));
  const render=(kind,label)=>groups[kind].length
    ? `<optgroup label="${label}" class="${kind}-group">`+groups[kind].map(item=>
        `<option class="${kind}-option" value="${esc(item.name)}" ${item.name===selected?'selected':''}>${esc(item.name)}</option>`
      ).join('')+'</optgroup>'
    : '';
  return render('expense','РАСХОДЫ')+render('income','ДОХОДЫ');
}
function populateBankFilter(){if(!state.db)return;const el=$('filter-bank'),old=el.value;const banks=all(state.db,`SELECT name FROM accounts UNION SELECT DISTINCT account AS name FROM transactions WHERE account<>'' ORDER BY name COLLATE NOCASE`).map(r=>r.name).filter(Boolean);el.innerHTML='<option value="">All banks</option>'+banks.map(b=>`<option value="${esc(b)}">${esc(b)}</option>`).join('');el.value=banks.includes(old)?old:'';}
function existingRuleMaps(){const labels=new Map(all(state.db,'SELECT merchant_key,merchant FROM merchant_labels').map(r=>[r.merchant_key,r.merchant]));const rules=new Map(all(state.db,'SELECT merchant_key,category FROM category_rules').map(r=>[r.merchant_key,r.category]));return {labels,rules};}
function groupLines(items){const out=[];for(const item of items){const top=Number(item.transform?.[5]??0),x=Number(item.transform?.[4]??0);let line=out.find(l=>Math.abs(l.y-top)<2.8);if(!line){line={y:top,x,text:''};out.push(line);}line.x=Math.min(line.x,x);line.items??=[];line.items.push({x,text:item.str||''});}return out.map(l=>({x:l.x,top:-l.y,text:l.items.sort((a,b)=>a.x-b.x).map(x=>x.text).join(' ').replace(/\s+/g,' ').trim()})).sort((a,b)=>a.top-b.top||a.x-b.x);}
async function parsePdf(file,buffer,digest,labels=new Map(),rules=new Map()){
  const pdfjs=await loadPdf();let pdf=null,lastError=null;
  const pdfAssetBase=new URL('./vendor/pdfjs/',document.baseURI).href;
  const pdfOptions={
    data:buffer,
    isEvalSupported:false,
    cMapUrl:`${pdfAssetBase}cmaps/`,
    cMapPacked:true,
    standardFontDataUrl:`${pdfAssetBase}standard_fonts/`,
    wasmUrl:`${pdfAssetBase}wasm/`,
    iccUrl:`${pdfAssetBase}iccs/`,
    useWorkerFetch:true,
  };
  for(const candidate of SCRIPT_CANDIDATES.pdf){try{pdfjs.GlobalWorkerOptions.workerSrc=candidate.worker;pdf=await pdfjs.getDocument(pdfOptions).promise;break;}catch(error){lastError=error;}}
  if(!pdf)throw new Error(`PDF.js could not open this file: ${lastError?.message||'worker unavailable'}`);
  const sberPages=[],yandexPages=[];let isYandex=false;
  for(let p=1;p<=pdf.numPages;p++){
    const page=await pdf.getPage(p);const content=await page.getTextContent();
    const viewport=page.getViewport({scale:1});
    const words=pdfJsItemsToYandexWords(content.items,viewport.height);
    if(p===1){const firstText=words.map(w=>w.text).join(' ').toLowerCase().replaceAll('ё','е');isYandex=firstText.includes('яндекс банк');}
    yandexPages.push(words);sberPages.push(groupLines(content.items));
  }
  if(isYandex)return parseYandexWordPages(yandexPages,digest,file.name,labels,rules);
  return {...parseSberLinePages(sberPages,digest,file.name,new Date().getFullYear()),bank:'SBER'};
}
function addImportLog(text){const box=$('import-activity');box.classList.remove('hidden');const line=document.createElement('div');line.className='activity-line';line.textContent=`${new Date().toLocaleTimeString('ru-RU')} · ${text}`;box.appendChild(line);box.scrollTop=box.scrollHeight;}
function renderSelectedFiles(){const box=$('selected-files');box.textContent=state.selectedFiles.length?state.selectedFiles.map(f=>`${f.name} · ${fmt.format(f.size/1024)} KB`).join('\n'):'No files selected';$('run-import').disabled=!state.selectedFiles.length||!state.db;$('clear-files').disabled=!state.selectedFiles.length;}
function getBank(file){const ext=file.name.toLowerCase().split('.').pop();if(ext==='xlsx'||ext==='xls')return 'TBANK';if(ext==='csv')return 'RAIFFEISEN';if(ext==='pdf')return 'PDF';throw new Error(`Unsupported file type: ${file.name}`);}
async function importFiles(){
  if(!state.db){showError('Open or create a database first.');return;}
  if(!state.selectedFiles.length)return;
  const fileKinds=[...new Set(state.selectedFiles.map(getBank))];
  if(fileKinds.length>1){showError('Import one bank and document format at a time. Do not mix PDF, T-Bank Excel and Raiffeisen CSV files in one batch.');return;}
  const fileKind=fileKinds[0],importBtn=$('run-import');
  importBtn.disabled=true;$('import-result').classList.add('hidden');$('import-activity').innerHTML='';$('import-activity').classList.remove('hidden');
  let inserted=0,duplicates=0,allRows=[],bank='';const prepared=[];const {labels,rules}=existingRuleMaps();const periodOverride=$('import-month').value;
  try{
    // Parse and validate every selected file before opening a database transaction.
    // This prevents a mixed Sber/Yandex PDF selection or one broken file from
    // leaving a partially imported batch in the database.
    for(const file of state.selectedFiles){
      addImportLog(`Reading ${file.name}`);const buffer=await file.arrayBuffer();const digest=(await sha256Hex(buffer)).slice(0,24);let parsed,detectedBank;
      if(fileKind==='PDF'){
        addImportLog('Extracting text and coordinates from PDF pages');parsed=await parsePdf(file,buffer,digest,labels,rules);detectedBank=parsed.bank||'YANDEX';
      }else if(fileKind==='TBANK'){
        const XLSX=await loadXlsx();const wb=XLSX.read(buffer,{type:'array',cellDates:true});const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,raw:false,defval:''});parsed=parseTbankRows(rows,digest,file.name,labels,rules);detectedBank='TBANK';
      }else{parsed=await parseRaiffeisenCSV(await decodeStatementBytes(buffer),digest,file.name,labels,rules);detectedBank='RAIFFEISEN';}
      parsed.rows=applyOwnSbpNameMarkers(parsed.rows,ownSbpNameMarkers());
      if(bank&&bank!==detectedBank)throw new Error(`Mixed bank PDFs detected (${bank} and ${detectedBank}). Nothing was imported. Select files from one bank only.`);
      bank=detectedBank;prepared.push({file,parsed,bank:detectedBank});
      addImportLog(`${file.name}: ${parsed.rows.length} rows extracted with ${parsed.audit.parser}.`);
    }
    if(!prepared.length)throw new Error('No importable statements were selected.');
    const batchResults=[];
    state.db.run('BEGIN');
    try{
      for(const item of prepared){
        const {file,parsed}=item;const account=bank;const period=periodOverride||inferMonth(parsed.rows);const batchId=uuid();let fileInserted=0;
        for(const row of parsed.rows){
          const clean={...row,id:uuid(),batch_id:batchId,account,created_at:nowIso()};
          if(!clean.category)clean.category='Не распределено';if(!clean.status)clean.status='Needs review';
          if(insertTransaction(state.db,clean)){inserted++;fileInserted++;}else duplicates++;
        }
        insertBatch(state.db,{id:batchId,account,period,files:[file.name],count:fileInserted,reconciliation:[{...parsed.audit,source_file:file.name,bank_code:bank,inserted_count:fileInserted,duplicates_skipped:parsed.rows.length-fileInserted,statement_totals_match:parsed.audit.statement_totals_match??null}]});
        if(bank==='SBER')for(const identifier of parsed.accounts||[])addRecognizedAccount(state.db,{bank_code:bank,identifier,label:'Detected in Sber statement',owner:'Unverified',account_type:'card'});
        if(bank==='TBANK')for(const acc of parsed.cards||[])addRecognizedAccount(state.db,{bank_code:bank,identifier:acc.identifier,label:acc.label||'T-Bank card',owner:'Unverified',account_type:'card'});
        batchResults.push({file:file.name,period,extracted:parsed.rows.length,inserted:fileInserted,duplicates:parsed.rows.length-fileInserted,audit:parsed.audit});
      }
      state.db.run('COMMIT');
    }catch(error){state.db.run('ROLLBACK');throw error;}
    allRows=prepared.flatMap(x=>x.parsed.rows);
    const selectedPeriod=batchResults.at(-1)?.period||monthNowPrevious();$('filter-month').value=selectedPeriod;$('totals-month').value=selectedPeriod;
    setDirty(true);renderAll();
    const auditLines=batchResults.map(r=>{
      const a=r.audit||{};
      const reconciliation=a.statement_totals_available?(a.statement_totals_match?'printed statement totals MATCH':'printed statement totals unavailable / not matched'):'no printed statement totals detected';
      return `<li>${esc(r.file)}: ${r.extracted} extracted, ${r.inserted} imported, ${r.duplicates} duplicates · ${esc(reconciliation)}</li>`;
    }).join('');
    const output=$('import-result');output.classList.remove('hidden','error');
    output.innerHTML=`<b>Import complete · ${esc(bank)}</b><div class="result-grid"><div class="result-cell"><b>${inserted}</b><span>Imported</span></div><div class="result-cell"><b>${duplicates}</b><span>Duplicates skipped</span></div><div class="result-cell"><b>${allRows.length}</b><span>Extracted</span></div></div><ul class="import-audit-list">${auditLines}</ul><p>All newly imported transactions are marked Needs review. Each file was parsed and checked before any transaction rows were written.</p>`;
    toast(`Imported ${inserted} transactions · ${duplicates} duplicates skipped`);activateTab('review');
  }catch(e){const output=$('import-result');output.classList.remove('hidden');output.classList.add('error');output.textContent=`Import failed: ${e.message}`;addImportLog(`ERROR: ${e.message}`);showError(e.message);}
  finally{importBtn.disabled=false;renderSelectedFiles();}
}
function filteredTransactions(){if(!state.db)return[];const month=$('filter-month').value,bank=$('filter-bank').value,status=$('filter-status').value,category=$('filter-category').value,search=$('filter-search').value.trim().toLowerCase(),showInternal=$('show-internal').checked,sort=$('filter-sort').value;let rows=all(state.db,'SELECT * FROM transactions WHERE deleted_at IS NULL');rows=rows.filter(r=>{if(month&&monthOf(r.tx_date)!==month)return false;if(bank&&r.account!==bank)return false;if(status&&r.status!==status)return false;if(category&&r.category!==category)return false;if(!showInternal&&isInternalTransfer(r.transaction_type,r.description,r.merchant,r.notes,r.raw_text))return false;if(search&&!`${r.description} ${r.merchant} ${r.account} ${r.notes} ${r.raw_text}`.toLowerCase().includes(search))return false;return true;});rows.sort((a,b)=>{if(sort==='amount_asc'||sort==='amount_desc'){const av=Number(a.amount),bv=Number(b.amount);if(av!==bv)return sort==='amount_asc'?av-bv:bv-av;}return String(b.tx_date).localeCompare(String(a.tx_date))||String(a.merchant).localeCompare(String(b.merchant),'ru');});return rows;}
function transactionRow(r){const kind=categoryDropdownGroup(state.profile?.categories?.find(item=>item.name===r.category)||{name:r.category,kind:'other'});const opts=categoryOptionGroups(r.category);const internal=isInternalTransfer(r.transaction_type,r.description,r.merchant,r.notes,r.raw_text);const signed=Number(r.amount)||0;const amountClass=signed>0?'positive':signed<0?'negative':'';return `<tr data-id="${esc(r.id)}"><td><input class="row-check" type="checkbox" data-action="select" ${state.selected.has(r.id)?'checked':''}></td><td>${esc(r.tx_date)}</td><td><span class="bank-pill">${esc(r.account)}</span>${internal?'<small class="internal-tag">Own transfer</small>':''}</td><td><input class="merchant-input" data-action="merchant" value="${esc(r.merchant||r.description)}" aria-label="Merchant"><small class="description-text">${esc(r.description)}${r.notes?` · ${esc(r.notes)}`:''}</small></td><td class="amount-cell ${amountClass}">${esc(displayMoney(amountCents(r.amount),r.currency))}</td><td><select class="category-select ${kind}" data-action="category">${opts}</select><label class="remember-line"><input type="checkbox" data-action="remember" checked> Remember category</label></td><td><input type="checkbox" data-action="done" ${r.status==='Confirmed'?'checked':''} aria-label="Completed"></td><td><button class="heart-button ${r.highlighted_flag?'active':''}" data-action="heart" title="Add to custom Numbers list">${r.highlighted_flag?'♥':'♡'}</button></td><td><button class="delete-button" data-action="delete" title="Delete transaction">×</button></td></tr>`;}
function renderTransactions(){if(!state.db){$('transactions-body').innerHTML='<tr><td colspan="9" class="empty-cell">Open a database to review transactions.</td></tr>';return;}populateCategoryFilter();populateBankFilter();const rows=filteredTransactions();state.transactions=rows;$('transactions-body').innerHTML=rows.length?rows.map(transactionRow).join(''):'<tr><td colspan="9" class="empty-cell">No transactions match these filters.</td></tr>';$('transaction-count').textContent=rows.length.toLocaleString('ru-RU');const awaiting=rows.filter(r=>r.status!=='Confirmed').length;$('awaiting-count').textContent=`${awaiting} awaiting review`;$('review-tab-count').textContent=awaiting;$('visible-count').textContent=`${rows.length} rows`;$('selected-count').textContent=`${state.selected.size} selected`;$('bulk-delete').disabled=!state.selected.size;$('select-all-visible').checked=rows.length>0&&rows.every(r=>state.selected.has(r.id));}
function saveTransaction(id,changes){const keys=Object.keys(changes);if(!keys.length)return;const sql=`UPDATE transactions SET ${keys.map(k=>`${k}=?`).join(',')} WHERE id=?`;state.db.run(sql,[...Object.values(changes),id]);setDirty(true);renderTransactions();renderNumbers();updateStats();}
function rememberRule(row,merchant,category){const key=row.merchant_key||`${row.account.toLowerCase()}:`+String(row.description).toLowerCase().trim();const now=nowIso();state.db.run('INSERT OR REPLACE INTO merchant_labels(merchant_key,merchant,updated_at) VALUES(?,?,?)',[key,merchant,now]);state.db.run('INSERT OR REPLACE INTO category_rules(merchant_key,category,updated_at) VALUES(?,?,?)',[key,category,now]);state.db.run('INSERT OR REPLACE INTO merchant_rules(merchant_key,merchant,category,updated_at) VALUES(?,?,?,?)',[key,merchant,category,now]);}
function handleTransactionAction(event){const el=event.target.closest('[data-action]');if(!el)return;const tr=el.closest('tr[data-id]');if(!tr)return;const id=tr.dataset.id;const row=one(state.db,'SELECT * FROM transactions WHERE id=?',[id]);if(!row)return;const action=el.dataset.action;if(action==='select'){if(el.checked)state.selected.add(id);else state.selected.delete(id);$('selected-count').textContent=`${state.selected.size} selected`;$('bulk-delete').disabled=!state.selected.size;}else if(action==='merchant'){if(event.type==='change'||event.type==='focusout'){const merchant=el.value.trim()||row.description;const remember=tr.querySelector('[data-action="remember"]')?.checked;if(remember)rememberRule(row,merchant,row.category);saveTransaction(id,{merchant});}}else if(action==='category'){const remember=tr.querySelector('[data-action="remember"]')?.checked;const changes={category:el.value};if(remember){rememberRule(row,row.merchant||row.description,el.value);}saveTransaction(id,changes);}else if(action==='done'){saveTransaction(id,{status:el.checked?'Confirmed':'Needs review'});}else if(action==='heart'){saveTransaction(id,{highlighted_flag:row.highlighted_flag?0:1});}else if(action==='delete'){deleteTransactions([id],false);}}
function deleteTransactions(ids,bulk){if(!ids.length)return;if(bulk&&!confirm(`Delete ${ids.length} selected transactions?`))return;const actionId=uuid(),now=nowIso();state.db.run('BEGIN');try{state.db.run('INSERT INTO transaction_delete_actions(id,transaction_ids,created_at) VALUES(?,?,?)',[actionId,JSON.stringify(ids),now]);const stmt=state.db.prepare('UPDATE transactions SET deleted_at=?,delete_action_id=? WHERE id=?');for(const id of ids)stmt.run([now,actionId,id]);stmt.free();state.db.run('COMMIT');}catch(e){state.db.run('ROLLBACK');throw e;}state.selected.clear();setDirty(true);renderAll();toast(`${ids.length} transaction(s) moved to Recently deleted`);}
function renderRecovery(){if(!state.db)return;const actions=all(state.db,'SELECT * FROM transaction_delete_actions WHERE undone_at=\'\' ORDER BY created_at DESC LIMIT 10');if(!actions.length){$('recovery-list').textContent='No recent deletions.';return;}$('recovery-list').innerHTML=actions.map(a=>{const ids=JSON.parse(a.transaction_ids||'[]');const names=ids.slice(0,3).map(id=>one(state.db,'SELECT merchant,description FROM transactions WHERE id=?',[id])).filter(Boolean).map(r=>r.merchant||r.description);return `<div class="recovery-action"><div><b>${ids.length} transaction(s)</b><div class="recovery-preview">${esc(names.join(' · '))}${ids.length>3?' …':''} · ${esc(new Date(a.created_at).toLocaleString('ru-RU'))}</div></div><button class="button secondary button-small" data-restore="${esc(a.id)}">Restore</button></div>`;}).join('');}
function restoreAction(id){const action=one(state.db,'SELECT * FROM transaction_delete_actions WHERE id=?',[id]);if(!action)return;const ids=JSON.parse(action.transaction_ids||'[]');state.db.run('BEGIN');try{const stmt=state.db.prepare('UPDATE transactions SET deleted_at=NULL,delete_action_id=\'\' WHERE id=?');for(const tx of ids)stmt.run([tx]);stmt.free();state.db.run('UPDATE transaction_delete_actions SET undone_at=? WHERE id=?',[nowIso(),id]);state.db.run('COMMIT');}catch(e){state.db.run('ROLLBACK');throw e;}setDirty(true);renderAll();toast(`Restored ${ids.length} transaction(s)`);}

function copyText(text){const value=String(text??'');if(navigator.clipboard?.writeText){navigator.clipboard.writeText(value).then(()=>toast('Copied to clipboard')).catch(()=>fallbackCopy(value));}else fallbackCopy(value);}
function fallbackCopy(value){const ta=document.createElement('textarea');ta.value=value;document.body.appendChild(ta);ta.select();try{document.execCommand('copy');toast('Copied to clipboard');}catch{showError('Clipboard access failed.');}ta.remove();}
function formatCell(cents){return numbersValue(cents);}
function numberRows(month,bank,currency,includeInternal){let rows=all(state.db,'SELECT * FROM transactions WHERE deleted_at IS NULL');rows=rows.filter(r=>(!month||monthOf(r.tx_date)===month)&&(!bank||bank==='TOTAL'||r.account===bank)&&(!currency||r.currency===currency)&&(includeInternal||!isInternalTransfer(r.transaction_type,r.description,r.merchant,r.notes,r.raw_text)));return rows;}
function renderNumbers(){
  if(!state.db){
    $('expenses-list').innerHTML='';
    $('incomes-list').innerHTML='';
    $('expenses-total').textContent='—';
    $('incomes-total').textContent='—';
    state.numberPayloads=null;
    return;
  }
  state.profile=readBudgetProfile(state.db);
  const profile=state.profile,numbers=profile.numbers;
  $('expenses-title').textContent=numbers.expenseTitle;
  $('incomes-title').textContent=numbers.incomeTitle;
  $('special-input-title').textContent=numbers.specialInput.title;
  $('special-output-title').textContent=numbers.specialOutput.title;
  $('highlighted-title').textContent=numbers.highlightedTitle;
  const month=$('totals-month').value||monthNowPrevious(),includeInternal=$('totals-show-internal').checked;
  const allRows=numberRows(month,'TOTAL','',includeInternal);
  const banks=[...new Set(allRows.map(r=>r.account))].sort();
  const tabs=['TOTAL',...banks];
  if(!tabs.includes(state.activeBank))state.activeBank='TOTAL';
  $('totals-bank-tabs').innerHTML=tabs.map(b=>`<button class="bank-tab ${state.activeBank===b?'active':''}" data-bank="${esc(b)}">${esc(b)}</button>`).join('');
  const bankRows=numberRows(month,state.activeBank,'',includeInternal);
  const currencies=[...new Set(bankRows.map(r=>r.currency).filter(Boolean))].sort();
  const curr=$('totals-currency');const prev=curr.value;
  curr.innerHTML='<option value="">Auto</option>'+currencies.map(c=>`<option>${esc(c)}</option>`).join('');
  if(currencies.includes(prev))curr.value=prev;
  const currency=curr.value||(currencies.length===1?currencies[0]:'');
  const rows=bankRows.filter(r=>!currency||r.currency===currency);
  const summary=numbersCategoryTotals(rows,profile.categories);
  const makeList=(kind)=>summary[kind].items.map(item=>
    `<div class="number-row"><span>${esc(item.name)}</span><span class="kind">${item.count||''}</span><span class="value ${kind}">${displayMoney(item.cents,currency||'')}</span></div>`
  ).join('');
  $('expenses-list').innerHTML=makeList('expense');
  $('incomes-list').innerHTML=makeList('income');
  $('expenses-total').textContent=displayMoney(summary.expense.cents,currency||'');
  $('incomes-total').textContent=displayMoney(summary.income.cents,currency||'');
  const specialInCategory=numbers.specialInput.category;
  const specialOutCategory=numbers.specialOutput.category;
  const specialIn=specialInCategory?rows.filter(r=>r.category===specialInCategory):[];
  const specialOut=specialOutCategory?rows.filter(r=>r.category===specialOutCategory):[];
  document.querySelector('[data-profile-role="special-input"]').hidden=!specialInCategory;
  document.querySelector('[data-profile-role="special-output"]').hidden=!specialOutCategory;
  const sumAbs=items=>items.reduce((sum,row)=>sum+Math.abs(amountCents(row.amount)||0),0);
  $('special-input-count').textContent=`${specialIn.length} transactions`;
  $('special-output-count').textContent=`${specialOut.length} transactions`;
  $('special-input-total').textContent=displayMoney(sumAbs(specialIn),currency||'RUB').replace(/\s*RUB$/,'');
  $('special-output-total').textContent=displayMoney(sumAbs(specialOut),currency||'RUB').replace(/\s*RUB$/,'');
  $('special-input-rows').innerHTML=specialIn.map(row=>specialRow(row)).join('')||'<div class="muted">No transactions</div>';
  $('special-output-rows').innerHTML=specialOut.map(row=>specialRow(row)).join('')||'<div class="muted">No transactions</div>';
  const expenseNames=new Set(profile.categories.filter(item=>item.kind==='expense').map(item=>item.name));
  const incomeNames=new Set(profile.categories.filter(item=>item.kind==='income').map(item=>item.name));
  const knownNames=new Set(profile.categories.map(item=>item.name));
  const expCount=rows.filter(row=>expenseNames.has(row.category)).length;
  const incCount=rows.filter(row=>incomeNames.has(row.category)).length;
  const unassigned=rows.filter(row=>!knownNames.has(row.category)||row.category==='Не распределено').length;
  $('numbers-integrity').className='integrity-banner '+(unassigned?'review':'pass');
  $('numbers-integrity').textContent=`${rows.length} transactions · ${expCount} expense-category rows · ${incCount} income-category rows · ${unassigned} unallocated / unknown category rows`;
  const highlighted=rows.filter(row=>row.highlighted_flag&&Number(row.amount)<0);
  $('highlighted-count').textContent=`${highlighted.length} transactions`;
  $('highlighted-total').textContent=displayMoney(sumAbs(highlighted),currency||'RUB');
  $('highlighted-rows').innerHTML=highlighted.map(row=>specialRow(row)).join('')||'<div class="muted">No transactions</div>';
  state.numberPayloads={
    expense:makeListValues(rows,'expense'),
    income:makeListValues(rows,'income'),
    specialIn,specialOut,highlighted
  };
}
function makeListValues(rows,kind){
  const summary=numbersCategoryTotals(rows,state.profile?.categories||[]);
  return (summary[kind]?.items||[]).map(item=>formatCell(item.cents)).join('\n');
}
function specialRow(r){return `<div class="special-row"><span>${esc(r.tx_date)} · ${esc(r.merchant||r.description)}</span><b>${esc(displayMoney(Math.abs(amountCents(r.amount)||0),r.currency||''))}</b></div>`;}
function profileLines(kind){return (state.profile?.categories||[]).filter(item=>item.kind===kind).map(item=>item.name).join('\n');}
function renderProfileEditor(){
  if(!state.db)return;
  state.profile=readBudgetProfile(state.db);
  const fields={
    'profile-expenses':profileLines('expense'),
    'profile-incomes':profileLines('income'),
    'profile-other':profileLines('other'),
    'profile-special-input-category':state.profile.numbers.specialInput.category,
    'profile-special-input-title':state.profile.numbers.specialInput.title,
    'profile-special-output-category':state.profile.numbers.specialOutput.category,
    'profile-special-output-title':state.profile.numbers.specialOutput.title,
    'profile-expense-title':state.profile.numbers.expenseTitle,
    'profile-income-title':state.profile.numbers.incomeTitle,
    'profile-highlighted-title':state.profile.numbers.highlightedTitle
  };
  for(const [id,value] of Object.entries(fields))if($(id)&&document.activeElement!==$(id))$(id).value=value;
}
function parseProfileLines(value){return [...new Set(String(value||'').split(/\r?\n/).map(item=>item.trim()).filter(Boolean))];}
function saveProfileFromEditor(){
  if(!state.db)return;
  try{
    const groups=[
      ['expense',$('profile-expenses').value],
      ['income',$('profile-incomes').value],
      ['other',$('profile-other').value]
    ];
    const categories=[],seen=new Set();
    for(const [kind,value] of groups)for(const name of parseProfileLines(value)){
      if(seen.has(name))throw new Error(`Category appears more than once: ${name}`);
      seen.add(name);categories.push({name,kind});
    }
    const inputCategory=$('profile-special-input-category').value.trim();
    const outputCategory=$('profile-special-output-category').value.trim();
    if(inputCategory&&seen.has(inputCategory))throw new Error('The special input category is already listed in another group.');
    if(outputCategory&&seen.has(outputCategory))throw new Error('The special output category is already listed in another group.');
    if(inputCategory&&inputCategory===outputCategory)throw new Error('Special input and output categories must be different.');
    if(inputCategory){seen.add(inputCategory);categories.push({name:inputCategory,kind:'special_input'});}
    if(outputCategory){seen.add(outputCategory);categories.push({name:outputCategory,kind:'special_output'});}
    for(const item of state.profile.categories)if(!seen.has(item.name)){seen.add(item.name);categories.push({name:item.name,kind:'other'});}
    const numbers={
      expenseTitle:$('profile-expense-title').value,
      incomeTitle:$('profile-income-title').value,
      specialInput:{category:inputCategory,title:$('profile-special-input-title').value},
      specialOutput:{category:outputCategory,title:$('profile-special-output-title').value},
      highlightedTitle:$('profile-highlighted-title').value
    };
    state.profile=saveBudgetProfile(state.db,{schemaVersion:1,categories,numbers});
    setDirty(true);renderAll();renderProfileEditor();toast('Category and Numbers profile saved inside this database');
  }catch(error){showError(`Profile was not saved: ${error.message}`);}
}
function exportProfileFile(){
  if(!state.db)return;
  const payload=exportBudgetProfile(state.db);
  download(new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'}),'Budget-Capture-Profile.json');
  toast('Private profile JSON exported without transactions or bank data');
}
async function importProfileFile(event){
  const file=event.target.files?.[0];
  if(!file||!state.db)return;
  try{
    const payload=JSON.parse(await file.text());
    state.profile=importBudgetProfile(state.db,payload);
    setDirty(true);renderAll();renderProfileEditor();toast('Profile imported into the open database. Save the .budget file to keep it.');
  }catch(error){showError(`Profile import failed: ${error.message}`);}
  event.target.value='';
}

function renderAccounts(){if(!state.db)return;const rows=all(state.db,'SELECT * FROM recognized_accounts ORDER BY bank_code,identifier');$('accounts-body').innerHTML=rows.length?rows.map(r=>`<tr><td>${esc(r.bank_code)}</td><td>••${esc(r.identifier)}</td><td>${esc(r.label)}</td><td>${esc(r.owner)}</td><td>${esc(r.account_type)}</td><td><button class="button danger button-small" data-delete-account="${r.id}">Delete</button></td></tr>`).join(''):'<tr><td colspan="6" class="empty-cell">No recognized accounts yet.</td></tr>';}
function renderAll(){if(!state.db)return;state.profile=readBudgetProfile(state.db);populateCategoryFilter();renderTransactions();renderRecovery();renderAccounts();renderNumbers();renderProfileEditor();updateStats();$('run-import').disabled=!state.selectedFiles.length;}
function exportCsv(){if(!state.db)return;const rows=filteredTransactions();const headers=['Date','Bank','Merchant','Description','Amount','Currency','Category','Type','Status','Notes','Source file'];const lines=[headers,...rows.map(r=>[r.tx_date,r.account,r.merchant,r.description,r.amount,r.currency,r.category,r.transaction_type,r.status,r.notes,r.source_file])];const csv='\ufeff'+lines.map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');download(new Blob([csv],{type:'text/csv;charset=utf-8'}),`budget-transactions-${$('filter-month').value||'all'}.csv`);}
function download(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
function handleEvents(){
  $('new-db').addEventListener('click',newDatabase);$('open-db').addEventListener('click',()=>$('open-file').click());$('data-open').addEventListener('click',()=>$('open-file').click());$('open-file').addEventListener('change',e=>{const f=e.target.files?.[0];if(f)openDatabaseFile(f);e.target.value='';});$('save-db').addEventListener('click',saveDatabase);$('data-save').addEventListener('click',saveDatabase);
  document.querySelectorAll('.main-tab').forEach(b=>b.addEventListener('click',()=>activateTab(b.dataset.tab)));
  const fileInput=$('statement-files');fileInput.addEventListener('change',e=>{state.selectedFiles=[...(e.target.files||[])];renderSelectedFiles();});const drop=$('drop-zone');drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragover');});drop.addEventListener('dragleave',()=>drop.classList.remove('dragover'));drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragover');state.selectedFiles=[...e.dataTransfer.files];renderSelectedFiles();});$('clear-files').addEventListener('click',()=>{state.selectedFiles=[];fileInput.value='';renderSelectedFiles();});$('run-import').addEventListener('click',importFiles);
  ['filter-month','filter-bank','filter-status','filter-category','filter-search','filter-sort','show-internal'].forEach(id=>$(id).addEventListener('input',()=>{state.selected.clear();renderTransactions();}));$('clear-filters').addEventListener('click',()=>{$('filter-month').value=monthNowPrevious();$('filter-bank').value='';$('filter-status').value='';$('filter-category').value='';$('filter-search').value='';$('filter-sort').value='date';$('show-internal').checked=false;state.selected.clear();renderTransactions();});
  $('transactions-body').addEventListener('change',handleTransactionAction);$('transactions-body').addEventListener('focusout',e=>{if(e.target.matches('[data-action="merchant"]'))handleTransactionAction(e);});$('transactions-body').addEventListener('click',e=>{const a=e.target.closest('[data-action]');if(a&&['delete','heart'].includes(a.dataset.action))handleTransactionAction(e);});$('select-all-visible').addEventListener('change',e=>{for(const r of state.transactions){if(e.target.checked)state.selected.add(r.id);else state.selected.delete(r.id);}renderTransactions();});$('bulk-delete').addEventListener('click',()=>deleteTransactions([...state.selected],true));$('recovery-panel').addEventListener('toggle',()=>{if($('recovery-panel').open)renderRecovery();});$('recovery-list').addEventListener('click',e=>{const b=e.target.closest('[data-restore]');if(b)restoreAction(b.dataset.restore);});$('show-recovery').addEventListener('click',()=>$('recovery-panel').open=!$('recovery-panel').open);$('export-csv').addEventListener('click',exportCsv);
  $('totals-month').addEventListener('change',renderNumbers);$('totals-currency').addEventListener('change',renderNumbers);$('totals-show-internal').addEventListener('change',renderNumbers);$('totals-bank-tabs').addEventListener('click',e=>{const b=e.target.closest('[data-bank]');if(b){state.activeBank=b.dataset.bank;renderNumbers();}});$('copy-expenses').addEventListener('click',()=>copyText(state.numberPayloads?.expense||''));$('copy-incomes').addEventListener('click',()=>copyText(state.numberPayloads?.income||''));$('copy-special-input-total').addEventListener('click',()=>copyText(numbersValue((state.numberPayloads?.specialIn||[]).reduce((s,r)=>s+Math.abs(amountCents(r.amount)||0),0))));$('copy-special-output-total').addEventListener('click',()=>copyText(numbersValue((state.numberPayloads?.specialOut||[]).reduce((s,r)=>s+Math.abs(amountCents(r.amount)||0),0))));$('copy-special-inputs').addEventListener('click',()=>copyText((state.numberPayloads?.specialIn||[]).map(r=>numbersValue(Math.abs(amountCents(r.amount)||0))).join('\n')));$('copy-special-outputs').addEventListener('click',()=>copyText((state.numberPayloads?.specialOut||[]).map(r=>numbersValue(Math.abs(amountCents(r.amount)||0))).join('\n')));$('copy-highlighted').addEventListener('click',()=>copyText((state.numberPayloads?.highlighted||[]).map(r=>`${r.tx_date}\t${r.merchant||r.description}\t${numbersValue(Math.abs(amountCents(r.amount)||0))}`).join('\n')));
  $('save-own-sbp-markers').addEventListener('click',saveOwnSbpMarkers);$('save-profile').addEventListener('click',saveProfileFromEditor);$('export-profile').addEventListener('click',exportProfileFile);$('profile-json').addEventListener('change',importProfileFile);$('account-form').addEventListener('submit',e=>{e.preventDefault();if(!state.db)return;upsertRecognizedAccount(state.db,{bank_code:$('account-bank').value,identifier:$('account-identifier').value.trim(),label:$('account-label').value.trim(),owner:$('account-owner').value,account_type:$('account-type').value});setDirty(true);e.target.reset();renderAccounts();updateStats();});$('accounts-body').addEventListener('click',e=>{const b=e.target.closest('[data-delete-account]');if(!b)return;if(!confirm('Delete this recognized account?'))return;state.db.run('DELETE FROM recognized_accounts WHERE id=?',[Number(b.dataset.deleteAccount)]);setDirty(true);renderAccounts();});
  $('legacy-json').addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f||!state.db)return;try{const payload=JSON.parse(await f.text());if(payload.app!=='Budget Capture'||!Array.isArray(payload.transactions))throw new Error('Unsupported Budget Capture JSON backup.');const imported=payload.transactions.filter(r=>r?.id&&r?.created_at&&'amount'in r).length;for(const c of payload.categories||[])state.db.run('INSERT OR IGNORE INTO categories(name,created_at) VALUES(?,?)',[c,nowIso()]);for(const row of payload.transactions){if(!row?.id||!row?.created_at||!('amount'in row))continue;insertTransaction(state.db,{...row,deleted_at:null,delete_action_id:''});}for(const r of payload.merchant_labels||[])if(r.merchant_key)state.db.run('INSERT OR REPLACE INTO merchant_labels(merchant_key,merchant,updated_at) VALUES(?,?,?)',[r.merchant_key,r.merchant||'',r.updated_at||nowIso()]);for(const r of payload.category_rules||[])if(r.merchant_key)state.db.run('INSERT OR REPLACE INTO category_rules(merchant_key,category,updated_at) VALUES(?,?,?)',[r.merchant_key,r.category||'Не распределено',r.updated_at||nowIso()]);setDirty(true);renderAll();toast(`Merged ${imported} legacy transaction rows`);}catch(err){showError(err.message);}e.target.value='';});
}

async function init(){try{handleEvents();window.addEventListener('beforeunload',e=>{if(state.dirty){e.preventDefault();e.returnValue='';}});$('filter-month').value=monthNowPrevious();$('totals-month').value=monthNowPrevious();$('import-month').value=monthNowPrevious();$('dependency-warning').classList.remove('hidden');$('dependency-warning').textContent='Loading SQLite database engine…';const SQL=await loadSql();if(!SQL)throw new Error('SQLite engine unavailable');$('dependency-warning').classList.add('hidden');$('new-db').disabled=false;renderSelectedFiles();if(location.protocol==='file:'){$('global-warning').classList.remove('hidden');$('global-warning').textContent='For PDF worker and database features, open this folder through a local web server or GitHub Pages (not by double-clicking index.html).';}toast('Budget Capture Web loaded · open a database to begin');}catch(e){$('dependency-warning').classList.remove('hidden');$('dependency-warning').textContent=e.message;showError(e.message);}}
init();
function allCategories(){return categoryItems().map(item=>item.name);}
function populateCategoryFilter(){
  if(!state.db)return;
  const el=$('filter-category'),old=el.value;
  el.innerHTML='<option value="">All categories</option>'+categoryOptionGroups(old);
  el.value=old;
}
