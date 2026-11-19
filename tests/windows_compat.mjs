import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseSberLinePages,parseTbankRows,parseRaiffeisenCSV,normText,categoryRuleKey} from '../core.js';

assert.equal(normText('Оплата СБП QR (Market.CSGO_SBP)'), 'оплата сбп qr market csgo_sbp');
assert.equal(normText('Погашение процентов по договору № КС123'), 'погашение процентов по договору кс123');
assert.equal(categoryRuleKey('yandex-pdf', 'Оплата СБП QR (Market.CSGO_SBP)'), 'yandex-pdf:оплата сбп qr market csgo_sbp');

// Sber and T-Bank Windows importers use the first 24 hex characters of the file SHA-256.
const digest='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const sber=parseSberLinePages([[{x:20,top:10,text:'25 октября,'},{x:100,top:30,text:'MERCHANT 1 100 ₽'},...Array.from({length:19},(_,i)=>({x:100,top:50+i*10,text:`MERCHANT ${i+2} ${101+i} ₽`}))]],digest,'sber.pdf',2026);
assert.equal(sber.rows[0].source_ref,'bankpdf:sber-history:0123456789abcdef01234567:p1:r1');

const headers=['Имя счёта','Дата операции','Сумма операции','Валюта операции','Сумма в валюте счёта','Валюта счёта','Статус','Описание','Сообщение','Учёт в аналитике','Номер карты'];
const tbank=parseTbankRows([headers,['Black','31.10.2026','100','RUB','100','RUB','Ок','Payee','','Да','*9001']],digest,'Tbank.xlsx');
assert.equal(tbank.rows[0].source_ref,'tbank-xlsx:0123456789abcdef01234567:r2');
assert.match(tbank.rows[0].notes,/Учёт в аналитике банка: Да/);

// Raiffeisen stable references without document numbers must match Python's
// json.dumps(raw, ensure_ascii=False, sort_keys=True) SHA-256 algorithm.
const noDoc='Дата операции;Детали операции (назначение платежа);Сумма в валюте счета (поступления);Сумма в валюте счета (расходы);Валюта счета\n31.10.2026;Salary To account: *1234 SBP ID ABC123;1000;;RUB';
const raif=await parseRaiffeisenCSV(noDoc,'unused','raif.csv');
assert.equal(raif.rows[0].source_ref,'row:64274b9a9b9d8ca28fb3faf0cb4d71ab467608188cb2840ed1929989ee5ff373:1');
const duplicate=await parseRaiffeisenCSV(noDoc+'\n31.10.2026;Salary To account: *1234 SBP ID ABC123;1000;;RUB','unused','raif.csv');
assert.equal(duplicate.rows[0].source_ref,raif.rows[0].source_ref);
assert.equal(duplicate.rows[1].source_ref,raif.rows[0].source_ref.replace(/:1$/ , ':2'));

// Keys and merchant labels match Windows app rules for ATM and SBP transfers.
const atm='Дата операции;Детали операции (назначение платежа);Сумма в валюте счета (поступления);Сумма в валюте счета (расходы);Валюта счета\n31.10.2026;ATM MOSCOW; ;1000;RUB';
const atmRule=await parseRaiffeisenCSV(atm,'x','raif.csv',new Map([['raiffeisen:atm:moscow','Банкомат VST']]));
assert.equal(atmRule.rows[0].merchant,'Банкомат VST');
assert.equal(atmRule.rows[0].category,'Снятие наличных');
const sbp='Дата операции;Детали операции (назначение платежа);Сумма в валюте счета (поступления);Сумма в валюте счета (расходы);Валюта счета\n31.10.2026;Transfer to Recipient phone number +79991234567 Recipient\'s bank Tinkoff SBP ID ABC; ;1000;RUB';
const sbpRule=await parseRaiffeisenCSV(sbp,'x','raif.csv');
assert.equal(sbpRule.rows[0].merchant_key,'raiffeisen:sbp:9991234567:tinkoff');
assert.equal(sbpRule.rows[0].merchant,'Перевод СБП — Tinkoff · ***4567');

console.log('Windows/browser import compatibility tests: PASS');
