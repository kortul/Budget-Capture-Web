import assert from 'node:assert/strict';
import {
  parseSberLinePages, parseTbankRows, parseRaiffeisenCSV, decodeStatementBytes, defaultCategory,
  monthNowPrevious, categoryKind, isInternalTransfer, amountCents, numbersValue, numbersCategoryTotals, sortCategoriesAlphabetically, categoryDropdownGroup, categoryDropdownGroups, parseDate
} from '../core.js';

const sberLines=[{x:20,top:10,text:'25 октября,'}];
const samples=[
  'Ипотека •• 9001 474 163,22 ₽',
  'Платёжный счёт •• 9002 474 900 ₽',
  ...Array.from({length:18},(_,i)=>`MERCHANT ${i+1} ${100+i},00 ₽`)
];
for(const text of samples)sberLines.push({x:100,top:30+sberLines.length*12,text});
const sber=parseSberLinePages([sberLines],'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef','synthetic-sber.pdf',2026);
assert.equal(sber.rows.length,20);
assert.equal(sber.rows[0].amount,-474163.22);
assert.equal(sber.rows[1].amount,-474900);
assert(!sber.rows.some(r=>Math.abs(r.amount)>1_000_000));
assert.equal(sber.rows[0].source_ref,'bankpdf:sber-history:0123456789abcdef01234567:p1:r1','Sber source refs must use the same 24-character digest prefix as Windows.');

// Sber must preserve a trailing merchant hyphen: the dash belongs to the
// merchant, not to the unsigned outgoing amount that follows it.
const sberSpecialLines=[{x:20,top:10,text:'25 октября,'}];
const sberSpecialRows=[
  ['IP VINOGRADOVA SANKT- 1 280 ₽','Оплата товаров и услуг',-1280,'expense','IP VINOGRADOVA SANKT-'],
  ['OZON +141 ₽','Возврат, отмена операций',141,'income','OZON'],
  ['Ипотека •• 9001 0 ₽','Капитализация',0,'expense','Ипотека •• 9001'],
  ...Array.from({length:17},(_,i)=>[`MERCHANT ${i+1} ${100+i} ₽`,'Оплата товаров и услуг',-(100+i),'expense',`MERCHANT ${i+1}`])
];
for(let i=0;i<sberSpecialRows.length;i++){
  const [merchantLine,comment]=sberSpecialRows[i];
  sberSpecialLines.push({x:100,top:30+i*24,text:merchantLine});
  sberSpecialLines.push({x:100,top:42+i*24,text:comment});
}
const sberSpecial=parseSberLinePages([sberSpecialLines],'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef','sber-special-cases.pdf',2026);
assert.equal(sberSpecial.rows.length,20);
assert.equal(sberSpecial.rows[0].description,'IP VINOGRADOVA SANKT-','trailing hyphen belongs to the Sber merchant, not amount sign');
assert.equal(sberSpecial.rows[0].amount,-1280);
assert.equal(sberSpecial.rows[0].transaction_type,'expense');
assert.equal(sberSpecial.rows[1].transaction_type,'income','positive Sber return rows must match Windows type income');
assert.equal(sberSpecial.rows[2].amount,0);
assert.equal(sberSpecial.rows[2].transaction_type,'expense','zero-value capitalization must match Windows type expense');

const tbank=[
 ['Имя счёта','Дата операции','Сумма операции','Валюта операции','Сумма в валюте счёта','Валюта счёта','Статус','Описание','Сообщение','Учёт в аналитике','Номер карты','Категория по-умолчанию','Ваша категория','MCC','Округление','Сумма операции с округлением','Бонусы (включая кэшбэк)'],
 ['Black','31.10.2026','14046,90','RUB','14046,90','RUB','Ок','Sample Payee','','Да','*9001','Переводы','','','','','']
];
const tb=parseTbankRows(tbank,'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789','Tbank.xlsx');
assert.equal(tb.rows.length,1);assert.equal(tb.rows[0].amount,14046.9);assert.equal(tb.rows[0].merchant,'Sample Payee');
assert.equal(tb.rows[0].source_ref,'tbank-xlsx:abcdef0123456789abcdef01:r2','T-Bank source refs must match the Windows 24-character digest convention.');

const raif='Дата операции;Номер документа;Детали операции (назначение платежа);Сумма в валюте счета (поступления);Сумма в валюте счета (расходы);Валюта счета\n31.10.2026;123;Salary;1000;;RUB';
const rf=await parseRaiffeisenCSV(raif,'fixture','raif.csv');
assert.equal(rf.rows.length,1);assert.equal(rf.rows[0].amount,1000);
assert.equal(rf.rows[0].source_ref,'doc:123');
const atm='Дата операции;Детали операции (назначение платежа);Сумма в валюте счета (поступления);Сумма в валюте счета (расходы);Валюта счета\n31.10.2026;ATM MOSCOW; ;1000;RUB';
const atmRows=await parseRaiffeisenCSV(atm,'fixture','raif.csv',new Map([['raiffeisen:atm:moscow','ATM VST']]),new Map([['raiffeisen:atm:moscow','Снятие наличных']]));
assert.equal(atmRows.rows[0].merchant,'ATM VST','Raiffeisen rule key must match the Windows ATM key.');
assert.equal(atmRows.rows[0].category,'Снятие наличных','Raiffeisen ATM suggestion must match Windows.');
assert.equal(atmRows.audit.outgoing_total,1000,'Raiffeisen outgoing totals are displayed as positive magnitudes, consistent with other bank parsers.');
const failed='Дата операции;Детали операции (назначение платежа);Сумма в валюте счета (поступления);Сумма в валюте счета (расходы);Валюта счета\n31.10.2026;Unable to transfer to card; ;1000;RUB';
const failedRows=await parseRaiffeisenCSV(failed,'fixture','raif.csv');
assert.equal(failedRows.rows[0].merchant_key,'raiffeisen:failed-transfer-card-number');
assert.equal(failedRows.rows[0].transaction_type,'review');

assert.equal(monthNowPrevious(new Date('2026-11-18T12:00:00Z')),'2026-10');
assert.equal(categoryKind('Sample expense',{categories:[{name:'Sample expense',kind:'expense'}]}),'expense');
assert.equal(categoryKind('Возвраты',{categories:[{name:'Возвраты',kind:'income'}]}),'income');
assert.equal(isInternalTransfer('Между своими счетами'),true);
assert.equal(defaultCategory('Перевод со счёта', 'internal_transfer'),'Внутренний перевод (не расход)','An internal-transfer transaction type must never default to an expense category.');
assert.equal(defaultCategory('Перевод со счёта', 'transfer'),'Внутренний перевод (не расход)');
assert.equal(defaultCategory('ATM cash deposit', 'income'),'Внесение наличных','ATM deposit suggestions use a generic category label, not a user-specific one.');
assert.equal(numbersValue(amountCents(474164.51)),'474164,51');
const numberGroups=numbersCategoryTotals([
  {category:'Food',amount:-100.25},
  {category:'Food',amount:20},
  {category:'Salary',amount:500},
  {category:'Unassigned',amount:-8.5}
],[
  {name:'Food',kind:'expense'},
  {name:'Salary',kind:'income'},
  {name:'No history yet',kind:'other'},
  {name:'Unassigned',kind:'other'}
]);
assert.equal(numberGroups.expense.items[0].cents,8025,'expense category values use the same net-outflow sign as the Numbers table');
assert.equal(numberGroups.expense.cents,8025,'expense group total is calculated from integer cents');
assert.equal(numberGroups.income.cents,50000,'income group total is calculated from integer cents');
assert.equal(numberGroups.other.items[0].count,0,'unused legacy categories remain visible with zero transactions');
assert.equal(numberGroups.other.items[0].cents,0,'unused legacy categories retain a zero total');
assert.equal(numberGroups.other.items[1].cents,-850,'Other group preserves the signed net of its transactions');
const alpha=sortCategoriesAlphabetically([
  {name:'Такси',kind:'expense'},
  {name:'Еда',kind:'expense'},
  {name:'iTunes',kind:'expense'},
  {name:'Кафе',kind:'expense'},
  {name:'Авиабилеты',kind:'expense'},
  {name:'food 10',kind:'expense'},
  {name:'food 2',kind:'expense'}
]);
const alphaNames=alpha.map(item=>item.name);
assert.equal(alphaNames.length,7,'alphabetical sort retains every category');
assert.equal(new Set(alphaNames).size,7,'alphabetical sort does not merge categories');
assert(alphaNames.indexOf('Авиабилеты')<alphaNames.indexOf('Еда'),'Cyrillic categories sort alphabetically');
assert(alphaNames.indexOf('Еда')<alphaNames.indexOf('Кафе'),'Cyrillic categories sort alphabetically');
assert(alphaNames.indexOf('food 2')<alphaNames.indexOf('food 10'),'numeric suffixes use natural alphabetical ordering');
const dropdownGroups=categoryDropdownGroups([
  {name:'Кафе',kind:'expense'},
  {name:'Приход магазин',kind:'income'},
  {name:'Авиабилеты',kind:'other'},
  {name:'Возвраты',kind:'income'},
  {name:'ВВОДЫ ДИМА СПЕЦ',kind:'special_input'},
  {name:'ВЫВОДЫ ДИМА СПЕЦ',kind:'special_output'},
  {name:'Внутренний перевод (не расход)',kind:'other'},
  {name:'Такси',kind:'expense'}
]);
assert.deepEqual(Object.keys(dropdownGroups),['expense','income'],'the dropdown has exactly two groups');
assert.deepEqual(dropdownGroups.expense.map(item=>item.name),['Авиабилеты','Внутренний перевод (не расход)','ВЫВОДЫ ДИМА СПЕЦ','Кафе','Такси'],'expenses come first and all entries sort alphabetically using Russian collation');
assert.deepEqual(dropdownGroups.income.map(item=>item.name),['ВВОДЫ ДИМА СПЕЦ','Возвраты','Приход магазин'],'income categories use the green group');
assert.equal(categoryDropdownGroup({name:'Приход от работы Дима',kind:'other'}),'income','unused legacy income categories can be placed in Income from their explicit name');
assert.equal(categoryDropdownGroup({name:'Траты по работе',kind:'other'}),'expense','unclassified legacy categories default to Expenses');
assert.equal(parseDate(46326.52072916667),'2026-10-31','Excel date serials must be handled by browser T-Bank import.');
assert.equal(parseDate('46326.52072916667'),'2026-10-31','Excel date serial strings must be handled by browser T-Bank import.');
const cp1251=await decodeStatementBytes(new Uint8Array([0xC4,0xE0,0xF2,0xE0]));
assert.equal(cp1251,'Дата','Raiffeisen CSV decoder must fall back to Windows-1251.');
console.log('Browser core smoke tests: PASS');
