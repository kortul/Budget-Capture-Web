import assert from 'node:assert/strict';
import {
  parseYandexWordPages, pdfJsItemsToYandexWords, categoryRuleKey, normText, applyOwnSbpNameMarkers,
} from '../core.js';

const word=(x,top,text)=>({x,top,text});
const dual=[
  word(20,20,'Яндекс Банк'),
  word(20,50,'Описание операции'),word(190,50,'Дата и время операции'),
  word(275,50,'Дата обработки операции'),word(395,50,'Сумма операции'),
  word(490,50,'Сумма в валюте договора'),
  word(20,100,'Перевод между счетами одного клиента'),
  word(190,100,'01.10.2026'),word(220,112,'в 10:15'),word(275,100,'01.10.2026'),
  word(400,100,'+15,00 ₽'),word(500,100,'+15,00 ₽'),
  word(20,200,'Всего расходных операций –0,00 ₽'),
  word(20,220,'Всего приходных операций +15,00 ₽'),
];
const dualResult=parseYandexWordPages([dual],'0123456789abcdef0123456789abcdef0123456789abcdef','payment.pdf');
assert.equal(dualResult.bank,'YANDEX');
assert.equal(dualResult.layout,'dual_currency');
assert.equal(dualResult.rows.length,1);
assert.equal(dualResult.rows[0].tx_date,'2026-10-01');
assert.equal(dualResult.rows[0].transaction_type,'internal_transfer');
assert.equal(JSON.parse(dualResult.rows[0].raw_text).operation_time,'10:15');
assert.equal(dualResult.audit.expected_incoming,15);
assert.equal(dualResult.audit.expected_outgoing,0);
assert.equal(dualResult.audit.statement_totals_match,true);
assert.equal(dualResult.rows[0].source_ref,'bankpdf:yandex:0123456789abcdef01234567:row:1');

const savings=[
  word(20,20,'Яндекс Банк'),word(20,50,'Описание операции'),
  word(345,50,'Дата операции'),word(480,50,'Сумма в валюте договора'),
  word(20,100,'Исходящий перевод СБП, Test Account Holder, +1 555 010-2020, Test Bank'),
  word(345,100,'02.10.2026'),word(500,100,'–25 000,00 ₽'),
  word(20,200,'Итого списаний –25 000,00 ₽'),
  word(20,220,'Итого зачислений +0,00 ₽'),
];
const savingsResult=parseYandexWordPages([savings],'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789','savings.pdf');
assert.equal(savingsResult.layout,'savings_single_currency');
assert.equal(savingsResult.rows[0].transaction_type,'expense','personal SBP markers must not be hard-coded in the parser');
const markedSavings=applyOwnSbpNameMarkers(savingsResult.rows,['Test Account Holder']);
assert.equal(markedSavings[0].transaction_type,'internal_transfer','own SBP markers are read from the local database settings');
assert.equal(markedSavings[0].category,'Внутренний перевод (не расход)');
assert.equal(savingsResult.audit.expected_outgoing,25000);
assert.equal(savingsResult.audit.statement_totals_match,true);

const mismatch=[...dual];
mismatch[mismatch.map(x=>x.text).lastIndexOf('+15,00 ₽')].text='–15,00 ₽';
assert.throws(()=>parseYandexWordPages([mismatch],'0123456789abcdef0123456789abcdef0123456789abcdef0123456789','wrong.pdf'),/reconciliation failed/);

assert.equal(normText('Оплата СБП QR (Market.CSGO_SBP)'),'оплата сбп qr market csgo_sbp');
assert.equal(normText('Погашение процентов по договору № КС123'),'погашение процентов по договору кс123');
assert.equal(categoryRuleKey('yandex-pdf','Оплата СБП QR (Market.CSGO_SBP)'),'yandex-pdf:оплата сбп qr market csgo_sbp');

// PDF.js text items are transformed from bottom-left PDF baseline to top-left
// page coordinates; token spacing retains the original X location.
const words=pdfJsItemsToYandexWords([
  {str:'Яндекс',transform:[1,0,0,10,20,812],height:10,width:30},
  {str:'Банк',transform:[1,0,0,10,55,812],height:10,width:20},
],842);
assert.equal(words[0].top,20);
assert.equal(words[1].top,20);
assert.equal(words[0].x,20);
assert.equal(words[1].x,55);

console.log('Yandex dual/savings parser + statement reconciliation tests: PASS');
