import assert from 'node:assert/strict';
import { sortTransactions } from '../core.js';
const rows=[
 {id:'old',tx_date:'2026-10-01',account:'TBANK',merchant:'Zulu',description:'Old Zulu',amount:-900,category:'Еда',status:'Needs review',highlighted_flag:0},
 {id:'new',tx_date:'2026-10-23',account:'SBER',merchant:'Alpha',description:'New Alpha',amount:1200,category:'Кафе',status:'Confirmed',highlighted_flag:1},
 {id:'middle',tx_date:'2026-10-12',account:'TBANK',merchant:'Beta',description:'Middle Beta',amount:-120,category:'Бензин',status:'Confirmed',highlighted_flag:0},
 {id:'same-date',tx_date:'2026-10-23',account:'YANDEX',merchant:'Gamma',description:'Same date Gamma',amount:0,category:'Дом',status:'Needs review',highlighted_flag:1}
];
const ids=(key,direction)=>sortTransactions(rows,{key,direction}).map(row=>row.id);
assert.deepEqual(ids('date','desc'),['new','same-date','middle','old']);
assert.deepEqual(ids('date','asc'),['old','middle','new','same-date']);
assert.deepEqual(ids('bank','asc'),['new','old','middle','same-date']);
assert.deepEqual(ids('merchant','asc'),['new','middle','old','same-date']);
assert.deepEqual(ids('amount','desc'),['new','same-date','middle','old']);
assert.deepEqual(ids('amount','asc'),['old','middle','same-date','new']);
assert.deepEqual(ids('category','asc'),['middle','same-date','old','new']);
assert.deepEqual(ids('done','desc'),['new','middle','old','same-date']);
assert.deepEqual(ids('heart','desc'),['new','same-date','old','middle']);
assert.deepEqual(sortTransactions(rows,{key:'invalid'}).map(row=>row.id),['new','same-date','middle','old']);
console.log('Transaction sort tests: PASS · date, bank, merchant, signed amount, category, Done, ♥');
