import {uuid, isInternalTransfer} from './core.js';
import {SAFE_DEFAULT_PROFILE, PROFILE_STORAGE_KEY, normalizeProfile, inferLegacyProfile} from './profile.js';

const DATABASES_REQUIRING_SAVE = new WeakSet();

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS transactions (
 id TEXT PRIMARY KEY, batch_id TEXT NOT NULL DEFAULT '', account TEXT NOT NULL DEFAULT '', tx_date TEXT NOT NULL DEFAULT '',
 description TEXT NOT NULL DEFAULT '', merchant TEXT NOT NULL DEFAULT '', merchant_key TEXT NOT NULL DEFAULT '', transaction_type TEXT NOT NULL DEFAULT 'unknown',
 source_ref TEXT NOT NULL DEFAULT '', amount REAL, currency TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'Не распределено',
 status TEXT NOT NULL DEFAULT 'Needs review', confidence REAL, source_file TEXT NOT NULL DEFAULT '', source_frame INTEGER,
 raw_text TEXT NOT NULL DEFAULT '', duplicate_of TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', manually_adjusted INTEGER NOT NULL DEFAULT 0,
 highlighted_flag INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, delete_action_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS accounts (name TEXT PRIMARY KEY,last_used_at TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS recognized_accounts (
 id INTEGER PRIMARY KEY AUTOINCREMENT,bank_code TEXT NOT NULL DEFAULT 'SBER',identifier TEXT NOT NULL,label TEXT NOT NULL DEFAULT '',
 owner TEXT NOT NULL DEFAULT 'Unverified',account_type TEXT NOT NULL DEFAULT 'account',notes TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT '',UNIQUE(bank_code,identifier)
);
CREATE TABLE IF NOT EXISTS categories(name TEXT PRIMARY KEY,created_at TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS import_batches (
 id TEXT PRIMARY KEY,account TEXT NOT NULL DEFAULT '',period TEXT NOT NULL DEFAULT '',original_files TEXT NOT NULL DEFAULT '[]',
 imported_count INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT '',reconciliation_json TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS merchant_rules(merchant_key TEXT PRIMARY KEY,merchant TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT 'Не распределено',updated_at TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS merchant_labels(merchant_key TEXT PRIMARY KEY,merchant TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS category_rules(merchant_key TEXT PRIMARY KEY,category TEXT NOT NULL DEFAULT 'Не распределено',updated_at TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS transaction_delete_actions(id TEXT PRIMARY KEY,transaction_ids TEXT NOT NULL,created_at TEXT NOT NULL,undone_at TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS web_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS numbers_history (id TEXT PRIMARY KEY, source TEXT NOT NULL DEFAULT 'numbers', month_key TEXT NOT NULL, year INTEGER NOT NULL, month INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('income','expense')), category TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, role TEXT NOT NULL DEFAULT '', imported_at TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS idx_numbers_history_month ON numbers_history(month_key);
CREATE TABLE IF NOT EXISTS numbers_category_adjustments (
 transaction_id TEXT PRIMARY KEY,
 base_category TEXT NOT NULL DEFAULT 'Не распределено',
 base_kind TEXT NOT NULL DEFAULT 'other',
 created_at TEXT NOT NULL DEFAULT ''
);
`;

export function createDatabase(SQL) {
  const db=new SQL.Database(); initializeDatabase(db); return db;
}
export function openDatabase(SQL, bytes) {
  const db=new SQL.Database(bytes);
  try {
    const integrity=String(scalar(db,'PRAGMA quick_check')||'');
    if(integrity!=='ok') throw new Error(`SQLite integrity check failed: ${integrity||'unknown result'}`);
    assertBudgetDatabase(db);
    const before=databaseSnapshot(db);
    initializeDatabase(db);
    const after=databaseSnapshot(db);
    if(JSON.stringify(before)!==JSON.stringify(after)) DATABASES_REQUIRING_SAVE.add(db);
    return db;
  } catch(error) {
    try { db.close(); } catch {}
    throw error;
  }
}

export function databaseNeedsSave(db) {
  return DATABASES_REQUIRING_SAVE.has(db);
}

export function assertBudgetDatabase(db) {
  const tables=new Set(all(db, "SELECT name FROM sqlite_master WHERE type='table'").map(r=>r.name));
  if(!tables.has('transactions') || !tables.has('categories')) {
    throw new Error('This file is SQLite, but it does not look like a Budget Capture database. The original file has not been modified.');
  }
  const columns=new Set(all(db,'PRAGMA table_info(transactions)').map(r=>r.name));
  const required=['id','account','tx_date','amount','category','status'];
  const missing=required.filter(name=>!columns.has(name));
  if(missing.length) throw new Error(`This Budget Capture database is missing required transaction fields: ${missing.join(', ')}. The original file has not been modified.`);
  return true;
}

function databaseSnapshot(db) {
  const schema=all(db, "SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name");
  const snapshot={schema};
  const safe=(table,sql)=>{
    try { snapshot[table]=all(db,sql); } catch { snapshot[table]=null; }
  };
  safe('categories','SELECT name,created_at FROM categories ORDER BY name');
  safe('recognized_accounts','SELECT * FROM recognized_accounts ORDER BY bank_code,identifier');
  safe('merchant_labels','SELECT * FROM merchant_labels ORDER BY merchant_key');
  safe('category_rules','SELECT * FROM category_rules ORDER BY merchant_key');
  safe('merchant_rules','SELECT * FROM merchant_rules ORDER BY merchant_key');
  safe('web_metadata','SELECT * FROM web_metadata ORDER BY key');
  safe('numbers_category_adjustments','SELECT * FROM numbers_category_adjustments ORDER BY transaction_id');
  const txCols=new Set(all(db,'PRAGMA table_info(transactions)').map(r=>r.name));
  const txFields=['id','category','status','transaction_type','highlighted_flag'].filter(f=>txCols.has(f));
  safe('transaction_migrations',`SELECT ${txFields.join(',')} FROM transactions ORDER BY id`);
  return snapshot;
}

export function initializeDatabase(db) {
  const tablesBefore=new Set(all(db,"SELECT name FROM sqlite_master WHERE type='table'").map(row=>row.name));
  const legacyCategoryRows=tablesBefore.has('categories')?all(db,'SELECT rowid,name,created_at FROM categories ORDER BY rowid'):[];
  const legacyTxColumns=tablesBefore.has('transactions')?new Set(all(db,'PRAGMA table_info(transactions)').map(row=>row.name)):new Set();
  const legacyTxFields=['category','amount'].filter(name=>legacyTxColumns.has(name));
  const legacyTransactionRows=legacyTxFields.length===2?all(db,'SELECT category,amount FROM transactions'):[];
  db.exec(SCHEMA);
  const historyCols=all(db,'PRAGMA table_info(numbers_history)').map(r=>r.name);
  if(!historyCols.includes('role')) db.run("ALTER TABLE numbers_history ADD COLUMN role TEXT NOT NULL DEFAULT ''");
  const cols=all(db,'PRAGMA table_info(transactions)').map(r=>r.name);
  const migrations={merchant:"TEXT NOT NULL DEFAULT ''",merchant_key:"TEXT NOT NULL DEFAULT ''",transaction_type:"TEXT NOT NULL DEFAULT 'unknown'",source_ref:"TEXT NOT NULL DEFAULT ''",manually_adjusted:'INTEGER NOT NULL DEFAULT 0',deleted_at:'TEXT',delete_action_id:"TEXT NOT NULL DEFAULT ''"};
  for(const [name,ddl] of Object.entries(migrations)) if(!cols.includes(name)) db.run(`ALTER TABLE transactions ADD COLUMN ${name} ${ddl}`);
  if(!cols.includes('highlighted_flag')) {
    db.run('ALTER TABLE transactions ADD COLUMN highlighted_flag INTEGER NOT NULL DEFAULT 0');
    const legacyFlagColumns=cols.filter(name=>name.endsWith('_flag'));
    for(const name of legacyFlagColumns) {
      const quoted='"'+name.replaceAll('"','""')+'"';
      db.run(`UPDATE transactions SET highlighted_flag=CASE WHEN COALESCE(highlighted_flag,0)<>0 OR COALESCE(${quoted},0)<>0 THEN 1 ELSE 0 END`);
    }
  }
  const batches=all(db,'PRAGMA table_info(import_batches)').map(r=>r.name);
  if(!batches.includes('reconciliation_json'))db.run("ALTER TABLE import_batches ADD COLUMN reconciliation_json TEXT NOT NULL DEFAULT '[]'");
  db.run('CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(tx_date)');
  db.run('CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account)');
  db.run('CREATE INDEX IF NOT EXISTS idx_transactions_batch ON transactions(batch_id)');
  try { db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_source_ref ON transactions(account,source_ref) WHERE source_ref <> ''"); }
  catch (error) { console.warn('Could not add optional unique source index; duplicate protection will use a lookup.', error); }

  // Older Windows releases stored merchant name and category in one rule table.
  db.run(`INSERT OR IGNORE INTO merchant_labels(merchant_key,merchant,updated_at) SELECT merchant_key,merchant,updated_at FROM merchant_rules`);
  db.run(`INSERT OR IGNORE INTO category_rules(merchant_key,category,updated_at) SELECT merchant_key,category,updated_at FROM merchant_rules`);

  // Match the Windows application's legacy category mapping and normalization.
  for(const table of ['transactions','category_rules','merchant_rules']) {
    db.run(`UPDATE ${table} SET category='Не распределено' WHERE category='Uncategorized'`);
    db.run(`UPDATE ${table} SET category='Не распределено' WHERE category IS NULL OR TRIM(category)=''`);
    db.run(`UPDATE ${table} SET category=TRIM(category) WHERE category IS NOT NULL AND category<>TRIM(category)`);
  }
  db.run(`INSERT OR IGNORE INTO categories(name,created_at) SELECT DISTINCT TRIM(name),created_at FROM categories WHERE name IS NOT NULL AND TRIM(name)<>''`);
  db.run(`DELETE FROM categories WHERE name IS NULL OR name='' OR name<>TRIM(name)`);
  db.run("DELETE FROM categories WHERE name='Uncategorized' AND NOT EXISTS (SELECT 1 FROM transactions WHERE category='Uncategorized')");
  db.run("UPDATE transactions SET status='Needs review' WHERE status='Ignored'");

  // Reapply the exact known own-transfer markers used in the Windows application.
  const oldTransferRows=all(db,"SELECT id,category,description,merchant,notes,raw_text FROM transactions WHERE transaction_type<>'internal_transfer' OR transaction_type IS NULL");
  const markTransfer=db.prepare("UPDATE transactions SET transaction_type='internal_transfer' WHERE id=?");
  for(const row of oldTransferRows) if(isInternalTransfer(row.category,row.description,row.merchant,row.notes,row.raw_text)) markTransfer.run([row.id]);
  markTransfer.free();

  const now=new Date().toISOString();
  const storedProfile=one(db,'SELECT value FROM web_metadata WHERE key=?',[PROFILE_STORAGE_KEY]);
  if(!storedProfile) {
    const inferred=legacyCategoryRows.length
      ? inferLegacyProfile(legacyCategoryRows,legacyTransactionRows)
      : normalizeProfile(SAFE_DEFAULT_PROFILE);
    db.run('INSERT OR IGNORE INTO web_metadata(key,value) VALUES(?,?)',[PROFILE_STORAGE_KEY,JSON.stringify(inferred)]);
  }
  const profile=readBudgetProfile(db);
  const insert=db.prepare('INSERT OR IGNORE INTO categories(name,created_at) VALUES (?,?)');
  for(const item of profile.categories)insert.run([item.name,now]);
  insert.free();

  // User-specific SBP counterparty names live in the local database, never in public JS.
  // For a Windows database, infer them only from rows already classified as own/internal transfers.
  const markerSetting=one(db,"SELECT value FROM web_metadata WHERE key='own_sbp_name_markers'");
  if(!markerSetting){
    const markerSet=new Set();
    for(const row of all(db,"SELECT description FROM transactions WHERE transaction_type='internal_transfer'")){
      const match=String(row.description||'').match(/(?:исходящий|входящий)\s+перевод\s+сбп\s*,\s*([^,]{2,80})/i);
      if(match&&match[1].trim())markerSet.add(match[1].trim());
    }
    db.run('INSERT OR IGNORE INTO web_metadata(key,value) VALUES(?,?)',['own_sbp_name_markers',JSON.stringify([...markerSet])]);
  }

  // Account identifiers are never hard-coded in the public application source.
  // Existing recognized accounts are preserved from the user's SQLite database.
  return db;
}
export function run(db,sql,params=[]) { db.run(sql,params); }
export function all(db,sql,params=[]) {
  const stmt=db.prepare(sql); try{stmt.bind(params);const out=[];while(stmt.step())out.push(stmt.getAsObject());return out;}finally{stmt.free();}
}
export function one(db,sql,params=[]) { return all(db,sql,params)[0]||null; }
export function scalar(db,sql,params=[]) { const r=one(db,sql,params);return r?Object.values(r)[0]:null; }
export function execute(db,sql,params=[]) { const before=db.getRowsModified();db.run(sql,params);return db.getRowsModified()-before; }

export function readBudgetProfile(db) {
  const stored=one(db,'SELECT value FROM web_metadata WHERE key=?',[PROFILE_STORAGE_KEY]);
  let profile;
  try { profile=normalizeProfile(stored?JSON.parse(stored.value):SAFE_DEFAULT_PROFILE); }
  catch { profile=normalizeProfile(SAFE_DEFAULT_PROFILE); }
  const known=new Set(profile.categories.map(item=>item.name));
  const categoryRows=all(db,'SELECT name FROM categories ORDER BY rowid');
  for(const row of categoryRows) {
    const name=String(row.name||'').trim();
    if(name&&!known.has(name)) { profile.categories.push({name,kind:'other'}); known.add(name); }
  }
  return normalizeProfile(profile);
}

export function saveBudgetProfile(db,input) {
  const profile=normalizeProfile(input);
  const known=new Set(profile.categories.map(item=>item.name));
  for(const row of all(db,'SELECT name FROM categories ORDER BY rowid')) {
    const name=String(row.name||'').trim();
    if(name&&!known.has(name)) { profile.categories.push({name,kind:'other'}); known.add(name); }
  }
  const normalized=normalizeProfile(profile);
  const now=new Date().toISOString();
  db.run('INSERT OR REPLACE INTO web_metadata(key,value) VALUES(?,?)',[PROFILE_STORAGE_KEY,JSON.stringify(normalized)]);
  const insert=db.prepare('INSERT OR IGNORE INTO categories(name,created_at) VALUES(?,?)');
  for(const item of normalized.categories)insert.run([item.name,now]);
  insert.free();
  return normalized;
}

export function exportBudgetProfile(db) {
  return {
    app:'Budget Capture Profile',
    schema_version:1,
    exported_at:new Date().toISOString(),
    profile:readBudgetProfile(db)
  };
}

export function importBudgetProfile(db,payload) {
  if(!payload||payload.app!=='Budget Capture Profile'||payload.schema_version!==1||!payload.profile||typeof payload.profile!=='object') {
    throw new Error('This is not a supported Budget Capture profile JSON file.');
  }
  return saveBudgetProfile(db,payload.profile);
}

export function insertTransaction(db,row) {
  if(row.source_ref) {
    const existing=one(db,'SELECT id FROM transactions WHERE account=? AND source_ref=? LIMIT 1',[row.account||'',row.source_ref]);
    if(existing)return false;
  }
  const fields=['id','batch_id','account','tx_date','description','merchant','merchant_key','transaction_type','source_ref','amount','currency','category','status','confidence','source_file','source_frame','raw_text','duplicate_of','notes','manually_adjusted','highlighted_flag','deleted_at','delete_action_id','created_at'];
  // Old desktop backups may use a custom per-person flag name. Preserve its value
  // without carrying that private column name into the public browser schema.
  const legacyMarked=Object.entries(row).some(([name,value])=>name.endsWith('_flag')&&Number(value)!==0)?1:0;
  const values=fields.map(k=>k==='highlighted_flag'?(row.highlighted_flag??legacyMarked):(row[k]??(k==='id'?uuid():k==='batch_id'?'':k==='account'?'':k==='tx_date'?'':k==='description'?'':k==='merchant'?'':k==='merchant_key'?'':k==='transaction_type'?'unknown':k==='source_ref'?'':k==='currency'?'':k==='category'?'Не распределено':k==='status'?'Needs review':k==='source_file'?'':k==='raw_text'?'':k==='duplicate_of'?'':k==='notes'?'':k==='manually_adjusted'?0:k==='delete_action_id'?'':k==='created_at'?new Date().toISOString():null)));
  const placeholders=fields.map(()=>'?').join(',');
  db.run(`INSERT OR IGNORE INTO transactions(${fields.join(',')}) VALUES(${placeholders})`,values);
  return db.getRowsModified()===1;
}
export function insertBatch(db,{id,account,period,files,count,reconciliation}) {
  const now=new Date().toISOString();
  db.run('INSERT OR REPLACE INTO accounts(name,last_used_at) VALUES(?,?)',[account,now]);
  db.run('INSERT OR REPLACE INTO import_batches(id,account,period,original_files,imported_count,created_at,reconciliation_json) VALUES(?,?,?,?,?,?,?)',
    [id,account,period,JSON.stringify(files),count,now,JSON.stringify(reconciliation||[])]);
}
export function addRecognizedAccount(db,{bank_code,identifier,label='',owner='Unverified',account_type='account',notes=''}) {
  const now=new Date().toISOString();
  // Automatic discovery must never overwrite a user-confirmed owner or account label.
  db.run('INSERT OR IGNORE INTO recognized_accounts(bank_code,identifier,label,owner,account_type,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',[bank_code,identifier,label,owner,account_type,notes,now,now]);
}
export function upsertRecognizedAccount(db,{bank_code,identifier,label='',owner='Unverified',account_type='account',notes=''}) {
  const now=new Date().toISOString();
  db.run(`INSERT INTO recognized_accounts(bank_code,identifier,label,owner,account_type,notes,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(bank_code,identifier) DO UPDATE SET label=excluded.label,owner=excluded.owner,account_type=excluded.account_type,notes=excluded.notes,updated_at=excluded.updated_at`,
    [bank_code,identifier,label,owner,account_type,notes,now,now]);
}
export function importLegacyJson(SQL,payload) {
  if(!payload||payload.app!=='Budget Capture'||!Array.isArray(payload.transactions))throw new Error('This is not a supported Budget Capture database JSON backup.');
  const db=createDatabase(SQL);const now=new Date().toISOString();
  const cats=Array.isArray(payload.categories)?payload.categories:[];
  for(const c of cats)if(typeof c==='string'&&c.trim())db.run('INSERT OR IGNORE INTO categories(name,created_at) VALUES(?,?)',[c.trim(),now]);
  for(const name of payload.accounts||[])if(typeof name==='string'&&name.trim())db.run('INSERT OR IGNORE INTO accounts(name,last_used_at) VALUES(?,?)',[name.trim(),now]);
  for(const b of payload.batches||[])if(b?.id)db.run('INSERT OR IGNORE INTO import_batches(id,account,period,original_files,imported_count,created_at,reconciliation_json) VALUES(?,?,?,?,?,?,?)',[b.id,b.account||'',b.period||'',b.original_files||'[]',b.imported_count||0,b.created_at||now,b.reconciliation_json||'[]']);
  for(const row of payload.transactions){if(!row||!row.id||!row.created_at||!('amount' in row))continue;insertTransaction(db,{...row,deleted_at:row.deleted_at??null,delete_action_id:row.delete_action_id??''});}
  for(const r of payload.merchant_rules||[])if(r?.merchant_key){db.run('INSERT OR REPLACE INTO merchant_rules(merchant_key,merchant,category,updated_at) VALUES(?,?,?,?)',[r.merchant_key,r.merchant||'',r.category||'Не распределено',r.updated_at||now]);db.run('INSERT OR IGNORE INTO merchant_labels(merchant_key,merchant,updated_at) VALUES(?,?,?)',[r.merchant_key,r.merchant||'',r.updated_at||now]);db.run('INSERT OR IGNORE INTO category_rules(merchant_key,category,updated_at) VALUES(?,?,?)',[r.merchant_key,r.category||'Не распределено',r.updated_at||now]);}
  for(const r of payload.merchant_labels||[])if(r?.merchant_key)db.run('INSERT OR REPLACE INTO merchant_labels(merchant_key,merchant,updated_at) VALUES(?,?,?)',[r.merchant_key,r.merchant||'',r.updated_at||now]);
  for(const r of payload.category_rules||[])if(r?.merchant_key)db.run('INSERT OR REPLACE INTO category_rules(merchant_key,category,updated_at) VALUES(?,?,?)',[r.merchant_key,r.category||'Не распределено',r.updated_at||now]);
  for(const r of payload.recognized_accounts||[])if(r?.bank_code&&r?.identifier)upsertRecognizedAccount(db,r);
  for(const a of payload.transaction_delete_actions||[])if(a?.id)db.run('INSERT OR REPLACE INTO transaction_delete_actions(id,transaction_ids,created_at,undone_at) VALUES(?,?,?,?)',[a.id,a.transaction_ids||'[]',a.created_at||now,a.undone_at||'']);
  for(const m of payload.web_metadata||[])if(m?.key)db.run('INSERT OR REPLACE INTO web_metadata(key,value) VALUES(?,?)',[m.key,m.value||'']);
  for(const r of payload.numbers_history||[])if(r?.id&&r?.month_key&&r?.kind&&r?.category)db.run('INSERT OR REPLACE INTO numbers_history(id,source,month_key,year,month,kind,category,amount,role,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?)',[r.id,r.source||'numbers',r.month_key,r.year||0,r.month||0,r.kind,r.category,Number(r.amount)||0,r.role||r.kind,r.imported_at||now]);
  initializeDatabase(db);
  DATABASES_REQUIRING_SAVE.add(db);
  return db;
}
export function exportLegacyJson(db) {
  const tables=['transactions','accounts','categories','import_batches','merchant_rules','merchant_labels','category_rules','recognized_accounts'];
  const payload={app:'Budget Capture',version:'1.6.4',web_export_version:'0.1.6.0',exported_at:new Date().toISOString()};
  payload.transactions=all(db,'SELECT * FROM transactions ORDER BY created_at');
  payload.accounts=all(db,'SELECT name FROM accounts').map(x=>x.name);
  payload.categories=all(db,'SELECT name FROM categories').map(x=>x.name);
  payload.numbers_history=all(db,'SELECT * FROM numbers_history ORDER BY month_key,kind,category');
  for(const t of ['import_batches','merchant_rules','merchant_labels','category_rules','recognized_accounts','transaction_delete_actions','web_metadata'])payload[t]=all(db,`SELECT * FROM ${t}`);
  return payload;
}
