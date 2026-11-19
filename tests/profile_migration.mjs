import assert from 'node:assert/strict';
import {SAFE_DEFAULT_PROFILE, PROFILE_SCHEMA_VERSION, normalizeProfile, inferLegacyProfile, profileKind} from '../profile.js';

assert.equal(PROFILE_SCHEMA_VERSION,1);
const fresh=normalizeProfile(SAFE_DEFAULT_PROFILE);
assert(fresh.categories.length>=8,'a new database receives a usable generic profile');
assert(!fresh.categories.some(item=>/private|personal|owner a|owner b/i.test(item.name)),'safe default profile contains no personal labels');
assert.equal(profileKind(fresh,'Не распределено'),'other');

const migrated=inferLegacyProfile(
  [
    {name:'Не распределено'},
    {name:'Внутренний перевод (не расход)'},
    {name:'Sample expense'},
    {name:'Sample income'},
    {name:'Вводы дополнительные спец'},
    {name:'Выводы дополнительные спец'},
    {name:'No history yet'}
  ],
  [
    {category:'Sample expense',amount:-10},
    {category:'Sample expense',amount:-20},
    {category:'Sample income',amount:100},
    {category:'Вводы дополнительные спец',amount:50},
    {category:'Выводы дополнительные спец',amount:-25}
  ]
);
assert.deepEqual(migrated.categories.map(item=>item.name),[
  'Не распределено','Внутренний перевод (не расход)','Sample expense','Sample income',
  'Вводы дополнительные спец','Выводы дополнительные спец','No history yet'
],'legacy category order is retained');
assert.equal(profileKind(migrated,'Sample expense'),'expense');
assert.equal(profileKind(migrated,'Sample income'),'income');
assert.equal(profileKind(migrated,'Вводы дополнительные спец'),'special_input');
assert.equal(profileKind(migrated,'Выводы дополнительные спец'),'special_output');
assert.equal(profileKind(migrated,'No history yet'),'other','categories without reliable history are retained without guessing a financial group');

const normalized=normalizeProfile({
  categories:[{name:'Alpha',kind:'expense'},{name:'Alpha',kind:'income'},{name:'Beta',kind:'income'}],
  numbers:{
    expenseTitle:'  MY EXPENSES  ',incomeTitle:'INCOME',
    specialInput:{category:'Extra inflow',title:'SPECIAL IN'},
    specialOutput:{category:'Extra outflow',title:'SPECIAL OUT'},
    highlightedTitle:'Marked list'
  }
});
assert.deepEqual(normalized.categories.map(item=>item.name),['Alpha','Beta','Extra inflow','Extra outflow']);
assert.equal(profileKind(normalized,'Extra inflow'),'special_input');
assert.equal(profileKind(normalized,'Extra outflow'),'special_output');
assert.equal(normalized.numbers.expenseTitle,'MY EXPENSES');
assert.equal(normalized.numbers.highlightedTitle,'Marked list');

console.log('Profile defaults, legacy inference, normalization and special Numbers labels: PASS');
