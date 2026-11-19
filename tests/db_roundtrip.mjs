import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase, openDatabase, databaseNeedsSave, all, scalar, exportLegacyJson, importLegacyJson, addRecognizedAccount, upsertRecognizedAccount, insertTransaction, readBudgetProfile, saveBudgetProfile, exportBudgetProfile, importBudgetProfile } from '../db.js';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-web-db-test-'));
const sourcePath = path.join(tempRoot, 'windows-v163.sqlite3');
const invalidPath = path.join(tempRoot, 'unrelated.sqlite3');
const reopenedPath = path.join(tempRoot, 'roundtrip.sqlite3');

class CompatibleStatement {
  constructor(database, sql) { this.database = database; this.sql = sql; this.statement = database.handle.prepare(sql); this.rows = []; this.index = 0; }
  bind(params = []) { this.rows = this.statement.all(...params); this.index = 0; return this; }
  step() { return this.index < this.rows.length; }
  getAsObject() { return this.rows[this.index++]; }
  run(params = []) { this.statement.run(...params); return this; }
  free() { /* Node's prepared statements are released with the owning database. */ }
}
class SQLiteCompatibilityDatabase {
  constructor(bytes) {
    this.filename = path.join(tempRoot, `db-${Math.random().toString(16).slice(2)}.sqlite3`);
    if (bytes) fs.writeFileSync(this.filename, Buffer.from(bytes));
    this.handle = new DatabaseSync(this.filename);
  }
  run(sql, params = []) {
    if (params?.length) this.handle.prepare(sql).run(...params);
    else this.handle.prepare(sql).run();
    return this;
  }
  exec(sql) { this.handle.exec(sql); return this; }
  prepare(sql) { return new CompatibleStatement(this, sql); }
  getRowsModified() { return Number(this.handle.prepare('SELECT changes() AS n').get().n || 0); }
  export() { this.handle.exec('PRAGMA wal_checkpoint(TRUNCATE)'); return new Uint8Array(fs.readFileSync(this.filename)); }
  close() { try { this.handle.close(); } catch {} }
}
const SQL = { Database: SQLiteCompatibilityDatabase };

function makeWindowsV163Fixture(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, account TEXT NOT NULL DEFAULT '', tx_date TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '', merchant TEXT NOT NULL DEFAULT '', merchant_key TEXT NOT NULL DEFAULT '',
      transaction_type TEXT NOT NULL DEFAULT 'unknown', source_ref TEXT NOT NULL DEFAULT '', amount REAL,
      currency TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'Не распределено', status TEXT NOT NULL DEFAULT 'Needs review',
      confidence REAL, source_file TEXT NOT NULL DEFAULT '', source_frame INTEGER, raw_text TEXT NOT NULL DEFAULT '',
      duplicate_of TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', manually_adjusted INTEGER NOT NULL DEFAULT 0,
      member_flag INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, delete_action_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE accounts(name TEXT PRIMARY KEY,last_used_at TEXT NOT NULL);
    CREATE TABLE recognized_accounts(id INTEGER PRIMARY KEY AUTOINCREMENT,bank_code TEXT NOT NULL DEFAULT 'SBER',identifier TEXT NOT NULL,label TEXT NOT NULL DEFAULT '',owner TEXT NOT NULL DEFAULT 'Unverified',account_type TEXT NOT NULL DEFAULT 'account',notes TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(bank_code,identifier));
    CREATE TABLE categories(name TEXT PRIMARY KEY,created_at TEXT NOT NULL);
    CREATE TABLE import_batches(id TEXT PRIMARY KEY,account TEXT NOT NULL,period TEXT NOT NULL DEFAULT '',original_files TEXT NOT NULL DEFAULT '[]',imported_count INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,reconciliation_json TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE merchant_rules(merchant_key TEXT PRIMARY KEY,merchant TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT 'Не распределено',updated_at TEXT NOT NULL);
    CREATE TABLE merchant_labels(merchant_key TEXT PRIMARY KEY,merchant TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL);
    CREATE TABLE category_rules(merchant_key TEXT PRIMARY KEY,category TEXT NOT NULL DEFAULT 'Не распределено',updated_at TEXT NOT NULL);
    CREATE TABLE transaction_delete_actions(id TEXT PRIMARY KEY,transaction_ids TEXT NOT NULL,created_at TEXT NOT NULL,undone_at TEXT NOT NULL DEFAULT '');
  `);
  db.prepare('INSERT INTO categories(name,created_at) VALUES(?,?)').run('Еда ', '2026-10-01T00:00:00Z');
  db.prepare('INSERT INTO categories(name,created_at) VALUES(?,?)').run('Sample expense', '2026-10-01T00:00:00Z');
  db.prepare('INSERT INTO accounts(name,last_used_at) VALUES(?,?)').run('TBANK', '2026-11-01T00:00:00Z');
  db.prepare('INSERT INTO recognized_accounts(bank_code,identifier,label,owner,account_type,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('TBANK','9001','Black','Owner A','card','','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z');
  db.prepare('INSERT INTO import_batches(id,account,period,original_files,imported_count,created_at,reconciliation_json) VALUES(?,?,?,?,?,?,?)').run('batch-1','TBANK','2026-10','["Tbank.xlsx"]',3,'2026-11-01T00:00:00Z','[{"rows":3}]');
  db.prepare('INSERT INTO merchant_rules(merchant_key,merchant,category,updated_at) VALUES(?,?,?,?)').run('tbank:groceries','Sample Market','Еда ','2026-11-01T00:00:00Z');
  db.prepare('INSERT INTO category_rules(merchant_key,category,updated_at) VALUES(?,?,?)').run('tbank:sample','Sample expense','2026-11-01T00:00:00Z');
  db.prepare('INSERT INTO merchant_labels(merchant_key,merchant,updated_at) VALUES(?,?,?)').run('tbank:sample','Sample vendor','2026-11-01T00:00:00Z');
  const ins = db.prepare(`INSERT INTO transactions(id,batch_id,account,tx_date,description,merchant,merchant_key,transaction_type,source_ref,amount,currency,category,status,confidence,source_file,source_frame,raw_text,duplicate_of,notes,manually_adjusted,member_flag,deleted_at,delete_action_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const rows = [
    ['tx-1','batch-1','TBANK','2026-10-31','Оплата продуктов','Sample Market','tbank:groceries','expense','doc:1',-812,'RUB','Еда ','Confirmed',99,'Tbank.xlsx',null,'{"mcc":"5411"}','', 'Комментарий банка',0,0,null,'','2026-11-01T00:00:00Z'],
    ['tx-2','batch-1','TBANK','2026-10-25','Sample payment','Sample Payee','tbank:sample','income','doc:2',14046.90,'RUB','Sample expense','Confirmed',99,'Tbank.xlsx',null,'{"bank_status":"Ок"}','', '',0,0,null,'','2026-11-01T00:00:01Z'],
    ['tx-3','batch-1','YANDEX','2026-10-24','Исходящий перевод СБП, Test Account Holder, +1 555 010-2020','Test Account Holder','yandex:own-sbp','internal_transfer','doc:3',-15000,'RUB','Не распределено','Confirmed',99,'Sber.pdf',2,'{"card":"9002"}','', '',0,0,null,'','2026-11-01T00:00:02Z'],
    ['tx-4','batch-1','TBANK','2026-10-22','Old ignored row','Merchant','tbank:old','expense','doc:4',-100,'RUB','Uncategorized','Ignored',99,'Tbank.xlsx',null,'{}','', '',0,0,null,'','2026-11-01T00:00:03Z'],
    ['tx-5','batch-1','SBER','2026-10-08','Deleted transaction','Ипотека','sber:loan','expense','doc:5',-1.29,'RUB','Sample Housing','Confirmed',99,'Sber.pdf',1,'{"original":true}','', '',1,1,'2026-11-03T00:00:00Z','delete-1','2026-11-01T00:00:04Z']
  ];
  for (const row of rows) ins.run(...row);
  db.prepare('INSERT INTO transaction_delete_actions(id,transaction_ids,created_at,undone_at) VALUES(?,?,?,?)').run('delete-1','["tx-5"]','2026-11-03T00:00:00Z','');
  db.close();
}

try {
  const fresh = createDatabase(SQL);
  assert(Number(scalar(fresh, "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('transactions','categories','recognized_accounts','import_batches','merchant_rules','merchant_labels','category_rules','transaction_delete_actions','web_metadata')")) === 9, 'a new database must create every required table');
  assert(Number(scalar(fresh,'SELECT COUNT(*) FROM categories')) >= 10, 'default categories seeded in a new database');
  fresh.close();

  makeWindowsV163Fixture(sourcePath);
  const originalBytes = fs.readFileSync(sourcePath);
  const originalHash = Buffer.from(originalBytes).toString('base64');
  const db = openDatabase(SQL, new Uint8Array(originalBytes));
  assert.equal(Number(scalar(db,"SELECT highlighted_flag FROM transactions WHERE id='tx-5'")),1,'legacy custom flag values migrate into the generic highlighted flag');
  const initialProfile=readBudgetProfile(db);
  assert(initialProfile.categories.some(item=>item.name==='Sample expense'),'legacy categories are migrated into the database profile');
  const editedProfile=saveBudgetProfile(db,{
    ...initialProfile,
    categories:[...initialProfile.categories,{name:'Added profile category',kind:'expense'}],
    numbers:{...initialProfile.numbers,highlightedTitle:'Custom list heading'}
  });
  assert.equal(editedProfile.numbers.highlightedTitle,'Custom list heading','profile editor changes are stored');
  const profileExport=exportBudgetProfile(db);
  assert.equal(profileExport.schema_version,1,'profile export has a numeric schema version');
  assert(!('transactions' in profileExport),'profile JSON must never contain transaction rows');
  const profileImportDb=createDatabase(SQL);
  const importedProfile=importBudgetProfile(profileImportDb,profileExport);
  assert.equal(importedProfile.numbers.highlightedTitle,'Custom list heading','profile JSON imports into another database');
  profileImportDb.close();
  insertTransaction(db,{id:'legacy-json-flag',created_at:'2026-11-01T00:00:05Z',amount:-5,category:'Sample Housing',description:'Legacy JSON flag row',synthetic_flag:1});
  assert.equal(Number(scalar(db,"SELECT highlighted_flag FROM transactions WHERE id='legacy-json-flag'")),1,'legacy JSON flag fields are mapped generically');
  assert.equal(Number(scalar(db,'SELECT COUNT(*) FROM transactions')),6,'all transactions including soft-deleted rows must remain');
  assert.equal(Number(scalar(db,'SELECT COUNT(*) FROM transactions WHERE deleted_at IS NOT NULL')),1,'soft-delete state preserved');
  assert.equal(Number(scalar(db,"SELECT COUNT(*) FROM transaction_delete_actions WHERE id='delete-1'")),1,'undo history preserved');
  assert.equal(all(db,"SELECT category FROM transactions WHERE id='tx-1'")[0].category,'Еда','transaction category whitespace normalized');
  assert.equal(all(db,"SELECT category FROM category_rules WHERE merchant_key='tbank:groceries'")[0].category,'Еда','rule category whitespace normalized');
  assert.equal(all(db,"SELECT transaction_type FROM transactions WHERE id='tx-3'")[0].transaction_type,'internal_transfer','existing internal type preserved');
  assert.deepEqual(JSON.parse(all(db,"SELECT value FROM web_metadata WHERE key='own_sbp_name_markers'")[0].value),['Test Account Holder'],'own SBP matching names are migrated into local DB metadata, not shipped in JS');
  assert.equal(all(db,"SELECT status FROM transactions WHERE id='tx-4'")[0].status,'Needs review','legacy ignored status normalized');
  assert.equal(all(db,"SELECT category FROM transactions WHERE id='tx-4'")[0].category,'Не распределено','legacy Uncategorized transaction category maps exactly like Windows.');
  assert.equal(all(db,"SELECT merchant FROM merchant_labels WHERE merchant_key='tbank:groceries'")[0].merchant,'Sample Market','merchant label preserved from legacy rule');
  assert.equal(all(db,"SELECT category FROM category_rules WHERE merchant_key='tbank:groceries'")[0].category,'Еда','category rule preserved from legacy rule');
  assert.equal(all(db,"SELECT identifier FROM recognized_accounts WHERE bank_code='TBANK'")[0].identifier,'9001','recognized account preserved');
  addRecognizedAccount(db,{bank_code:'TBANK',identifier:'9001',label:'Black',owner:'Unverified',account_type:'card'});
  assert.equal(all(db,"SELECT owner FROM recognized_accounts WHERE bank_code='TBANK' AND identifier='9001'")[0].owner,'Owner A','repeat automatic card detection must not overwrite confirmed owner');
  upsertRecognizedAccount(db,{bank_code:'TBANK',identifier:'9001',label:'Black',owner:'Owner B',account_type:'card'});
  assert.equal(all(db,"SELECT owner FROM recognized_accounts WHERE bank_code='TBANK' AND identifier='9001'")[0].owner,'Owner B','manual account edit must update owner');
  upsertRecognizedAccount(db,{bank_code:'TBANK',identifier:'9001',label:'Black',owner:'Owner A',account_type:'card'});
  assert.equal(Number(scalar(db,"SELECT COUNT(*) FROM recognized_accounts WHERE bank_code='SBER'")),0,'new databases must not contain hard-coded personal Sber identifiers');
  assert.equal(databaseNeedsSave(db),true,'normalization/seeding marks database dirty and saveable');

  const legacyJson = exportLegacyJson(db);
  assert.equal(legacyJson.transactions.length,6,'JSON backup includes soft-deleted and newly inserted transactions');
  assert.equal(legacyJson.transaction_delete_actions.length,1,'JSON backup includes undo history');
  const jsonReopened = importLegacyJson(SQL,legacyJson);
  assert.equal(Number(scalar(jsonReopened,'SELECT COUNT(*) FROM transactions')),6,'JSON backup round-trip preserves all transactions');
  assert.equal(Number(scalar(jsonReopened,"SELECT COUNT(*) FROM transactions WHERE deleted_at IS NOT NULL")),1,'JSON backup round-trip preserves soft-delete state');
  assert.equal(Number(scalar(jsonReopened,'SELECT COUNT(*) FROM transaction_delete_actions')),1,'JSON backup round-trip preserves recovery history');
  jsonReopened.close();

  const exported = db.export();
  fs.writeFileSync(reopenedPath,Buffer.from(exported));
  db.close();
  const reopened = openDatabase(SQL,new Uint8Array(fs.readFileSync(reopenedPath)));
  assert.equal(readBudgetProfile(reopened).numbers.highlightedTitle,'Custom list heading','edited profile survives SQLite save/reopen');
  assert(readBudgetProfile(reopened).categories.some(item=>item.name==='Added profile category'),'new profile category survives SQLite save/reopen');
  assert.equal(Number(scalar(reopened,'SELECT COUNT(*) FROM transactions')),6,'round-trip transaction count preserved');
  assert.equal(Number(scalar(reopened,"SELECT COUNT(*) FROM transactions WHERE deleted_at IS NOT NULL")),1,'round-trip deleted transaction preserved');
  assert.equal(Number(scalar(reopened,'SELECT COUNT(*) FROM transaction_delete_actions')),1,'round-trip recovery history preserved');
  assert.equal(Number(scalar(reopened,'SELECT COUNT(*) FROM import_batches')),1,'round-trip import batch preserved');
  assert.equal(Number(scalar(reopened,'SELECT COUNT(*) FROM category_rules')),2,'all category rules preserved');
  assert.equal(databaseNeedsSave(reopened),false,'a saved, already-migrated database opens clean');
  reopened.close();
  assert.equal(Buffer.from(fs.readFileSync(sourcePath)).toString('base64'),originalHash,'the original Windows database file must never be modified in place');

  const invalid = new DatabaseSync(invalidPath);
  invalid.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT); INSERT INTO users(name) VALUES (\'not Budget Capture\');');
  invalid.close();
  const invalidBytes = fs.readFileSync(invalidPath);
  assert.throws(()=>openDatabase(SQL,new Uint8Array(invalidBytes)),/does not look like a Budget Capture database/i,'an arbitrary SQLite file must be rejected before migrations');
  assert.deepEqual(fs.readFileSync(invalidPath),invalidBytes,'an unrelated SQLite file must remain byte-for-byte unchanged');

  console.log('Database compatibility + migration + save/reopen round-trip: PASS');
  console.log(JSON.stringify({transactions:5,softDeleted:1,deleteActions:1,batches:1,categoryRules:2,recognizedAccounts:1,migrationMarkedDirty:true,reopenClean:true,sourceFileUnchanged:true,invalidSqliteRejected:true},null,2));
} finally {
  fs.rmSync(tempRoot,{recursive:true,force:true});
}
