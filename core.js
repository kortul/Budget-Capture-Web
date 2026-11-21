export const APP_VERSION = '0.1.6.0';

export function categoryKind(category, profile) {
  const item = profile?.categories?.find(entry => entry?.name === category);
  return item?.kind || 'other';
}
export const INTERNAL_MARKERS = [
  'себе в другой банк','между своими счетами','между своими','себе из другого банка',
  'перевод между счетами одного клиента','перевод средств из кубышки','пополнение кубышки','internal transfer'
];
const MONTHS = {января:1,февраля:2,марта:3,апреля:4,мая:5,июня:6,июля:7,августа:8,сентября:9,октября:10,ноября:11,декабря:12};

export function fold(value='') {
  return String(value ?? '').normalize('NFKC').toLowerCase().replaceAll('ё','е').replace(/[^0-9a-zа-я]+/gi,' ').trim().replace(/\s+/g,' ');
}
export function normText(value='') { return String(value??'').toLowerCase().replaceAll('ё','е').replace(/[^\p{L}\p{Nd}_]+/gu,' ').trim().replace(/\s+/g,' '); }
export function isInternalTransfer(...values) {
  const text = fold(values.filter(v=>v!==null&&v!==undefined).join(' '));
  return INTERNAL_MARKERS.some(marker=>text.includes(fold(marker)));
}
export function applyOwnSbpNameMarkers(rows, markers=[]) {
  const names=[...new Set((markers||[]).map(fold).filter(name=>name.length>=3))];
  if(!names.length)return rows;
  return rows.map(row=>{
    if(row.transaction_type==='internal_transfer')return row;
    const description=fold(row.description||'');
    const isSbp=/^(?:исходящий|входящий) перевод сбп(?: |$)/.test(description);
    if(!isSbp||!names.some(name=>description.includes(name)))return row;
    return {...row,transaction_type:'internal_transfer',category:(!row.category||row.category==='Не распределено')?'Внутренний перевод (не расход)':row.category};
  });
}
export function uuid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
export function monthNowPrevious(now=new Date()) { const d=new Date(now.getFullYear(),now.getMonth()-1,1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
export function monthOf(date) { return String(date||'').slice(0,7); }
export function amountCents(value) {
  if (value===null||value===undefined||value==='') return null;
  const n=Number(value); return Number.isFinite(n) ? Math.round((n+Number.EPSILON)*100) : null;
}
export function fromCents(cents) { return cents/100; }
export function numbersValue(cents) {
  if (cents===null||cents===undefined) return '';
  const sign=cents<0?'-':''; const abs=Math.abs(cents); const whole=Math.floor(abs/100); const rest=abs%100;
  return sign+String(whole)+(rest?','+String(rest).padStart(2,'0').replace(/0$/,''):'');
}
export function displayMoney(cents, currency='RUB') {
  if (cents===null||cents===undefined) return '—';
  const raw=numbersValue(cents); const [whole,frac]=raw.split(',');
  const sign=whole.startsWith('-')?'-':''; const grouped=whole.replace('-','').replace(/\B(?=(\d{3})+(?!\d))/g,' ');
  return `${sign}${grouped}${frac?','+frac:''}${currency?' '+currency:''}`;
}

export function numbersCategoryTotals(rows=[], categories=[]) {
  const totals={
    expense:{items:[],cents:0},
    income:{items:[],cents:0},
    other:{items:[],cents:0}
  };
  for(const category of categories) {
    const group=totals[category?.kind];
    if(!group||!category?.name)continue;
    let cents=0,count=0;
    for(const row of rows) {
      if(row?.category!==category.name)continue;
      const value=amountCents(row.amount);
      if(value===null)continue;
      cents+=value;
      count++;
    }
    const valueCents=category.kind==='expense'?-cents:cents;
    group.items.push({name:category.name,count,cents:valueCents});
    group.cents+=valueCents;
  }
  return totals;
}
export function defaultCategory(description, type) {
  const t=fold(description);
  if (type==='transfer' || type==='internal_transfer' || isInternalTransfer(description)) return 'Внутренний перевод (не расход)';
  if (type==='refund' || t.includes('возврат') || t.includes('отмена')) return 'Возвраты';
  if (t.includes('atm') && type==='expense') return 'Снятие наличных';
  if (t.includes('atm') && type==='income') return 'Внесение наличных';
  return 'Не распределено';
}
export function transactionType(amount, ...textValues) {
  if (isInternalTransfer(...textValues)) return 'internal_transfer';
  const t=fold(textValues.join(' '));
  if (Number(amount)>0 && (t.includes('возврат')||t.includes('отмена'))) return 'refund';
  if (Number(amount)>0) return 'income';
  if (Number(amount)<0) return 'expense';
  return 'unknown';
}
export async function sha256Hex(buffer) {
  if (!globalThis.crypto?.subtle?.digest) {
    throw new Error('Secure SHA-256 is unavailable. Open Budget Capture from its HTTPS GitHub Pages address or localhost; duplicate protection will not use a weaker fingerprint.');
  }
  const digest=await globalThis.crypto.subtle.digest('SHA-256',buffer);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function parseMoney(value) {
  let text=String(value??'').trim().replace(/[\s\u00a0\u202f]/g,'').replace(/[−–—]/g,'-');
  if(!text)return null;
  if(text.includes(',')&&text.includes('.')) { if(text.lastIndexOf(',')>text.lastIndexOf('.')) text=text.replace(/\./g,'').replace(',','.'); else text=text.replace(/,/g,''); }
  else if(text.includes(',')) text=text.replace(',','.');
  const n=Number(text); return Number.isFinite(n)?Math.round(n*100)/100:null;
}
export function parseDate(value) {
  if(value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0,10);
  // Excel's 1900 date system stores dates as day serials (with fractional time).
  // T-Bank exports can reach this parser either as Date objects (SheetJS cellDates)
  // or as numeric serials when the workbook has no useful date display style.
  const numeric = typeof value === 'number' ? value : /^\d{5}(?:[.,]\d+)?$/.test(String(value ?? '').trim())
    ? Number(String(value).replace(',', '.')) : NaN;
  if(Number.isFinite(numeric) && numeric >= 20000 && numeric <= 80000) {
    const wholeDays = Math.floor(numeric);
    const dt = new Date(Date.UTC(1899, 11, 30) + wholeDays * 86400000);
    if(!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0,10);
  }
  const raw=String(value??'').trim();
  let m=raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/); if(m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  m=raw.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m)return m[0];
  const dt=new Date(raw); if(!Number.isNaN(dt.getTime()))return dt.toISOString().slice(0,10);
  throw new Error(`Cannot read transaction date: ${raw||'(blank)'}`);
}
export function categoryRuleKey(bankFormat, description) { return `${bankFormat}:`+normText(description); }

export function parseSberLinePages(pages, fileDigest, sourceFile='Sber History.pdf', fileYearFallback=new Date().getFullYear()) {
  const allText=pages.flat().map(x=>x.text).join('\n');
  const toDate=allText.match(/toDate=(\d{13})/i);
  const year=toDate?new Date(Number(toDate[1])).getUTCFullYear():(allText.match(/\b(20\d{2})\b/)?.[1]?Number(allText.match(/\b(20\d{2})\b/)[1]):fileYearFallback);
  const sourceDigest=String(fileDigest||'').slice(0,24);
  const rows=[]; const accounts=new Set(); const pageReports=[]; let currentDate='';
  for(let p=0;p<pages.length;p++){
    const lines=pages[p].map((line)=>({...line,text:String(line.text||'').trim()})).filter(x=>x.text).sort((a,b)=>a.top-b.top||a.x-b.x);
    for(const line of lines) for(const match of line.text.matchAll(/(?:••|\*{2,})\s*(\d{4})/g)) accounts.add(match[1]);
    const starts=[];
    for(let i=0;i<lines.length;i++){
      const dm=lines[i].text.match(/^\s*(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s*,/i);
      if(dm){const day=Number(dm[1]),mon=MONTHS[dm[2].toLowerCase()]; const dt=new Date(Date.UTC(year,mon-1,day)); currentDate=dt.toISOString().slice(0,10);}
      if(lines[i].x<90) continue;
      const money=extractSberMoney(lines[i].text);
      if(money) starts.push({index:i,date:currentDate,money});
    }
    const pageRows=[];
    for(let r=0;r<starts.length;r++){
      const st=starts[r], end=starts[r+1]?.index??lines.length;
      if(!st.date) throw new Error(`Sber page ${p+1}, row ${r+1}: no date heading found.`);
      const details=[], raw=[];
      for(let j=st.index;j<end;j++){
        const line=lines[j].text;
        if(!line)continue;
        if(/^\s*\d{1,2}\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s*,/i.test(line))continue;
        if(/^(https:\/\/online\.sberbank\.ru\/|page\s+|история)/i.test(line))break;
        raw.push(line);
        const cleaned=j===st.index?line.replace(st.money.full,'').replace(/\s+/g,' ').trim():line.trim();
        if(cleaned)details.push(cleaned);
      }
      const description=details[0]||'Операция Сбербанк Онлайн';
      const bankComment=[...new Set(details.slice(1))].join(' · ');
      const amount=st.money.value===0?0:(st.money.positive?Math.abs(st.money.value):-Math.abs(st.money.value));
      const detailText=details.join(' ');
      let txType=transactionType(amount,detailText);
      // Match the Windows Sber History importer: incoming refunds are income,
      // not a separate 'refund' transaction type; zero-value capitalization
      // entries are classified as expenses. Keep this Sber-specific so other
      // banks can retain their own transaction type semantics.
      const foldedDetails=fold(detailText);
      if(amount>0 && foldedDetails.includes('возврат отмена операций')) txType='income';
      if(amount===0 && foldedDetails.includes('капитализация')) txType='expense';
      const opType=details.slice(1).find(x=>/оплата|перевод|возврат|погашение|начисление|между своими|входящий|списание|капитализация/i.test(x))||details[1]||'Операция';
      const sourceRef=`bankpdf:sber-history:${sourceDigest}:p${p+1}:r${r+1}`;
      pageRows.push({tx_date:st.date,description,merchant:description,amount,currency:'RUB',transaction_type:txType,bank_comment:bankComment,
        source_ref:sourceRef,merchant_key:categoryRuleKey('sber_history-pdf',description),source_file:sourceFile,source_frame:p+1,raw_text:JSON.stringify({parser:'sber-online-history-web-v1',source_page:p+1,source_row:r+1,bank_category:opType,bank_comment:bankComment,detail_lines:details,raw_block:raw.join('\n')}),notes:bankComment?`Комментарий банка: ${bankComment}`:'',status:'Needs review',category:'Не распределено'});
      rows.push(pageRows.at(-1));
    }
    pageReports.push({page:p+1,rows:pageRows.length});
  }
  if(rows.length<20) throw new Error(`Only ${rows.length} Sber operations were found. This may not be a complete Sber Online History statement.`);
  return {rows,accounts:[...accounts].sort(),audit:{parser:'Sber Online History PDF.js parser',page_count:pages.length,transaction_count:rows.length,incoming_total:rows.filter(r=>r.amount>0).reduce((a,r)=>a+Math.round(r.amount*100),0)/100,outgoing_total:rows.filter(r=>r.amount<0).reduce((a,r)=>a+Math.round(-r.amount*100),0)/100,statement_totals_available:false,pages:pageReports}};
}
function extractSberMoney(line) {
  // Sber History marks incoming amounts with '+'. Outgoing amounts have no
  // sign. Do not consume a preceding hyphen: it may be the final character
  // of a merchant such as 'DIXY-78056D SANKT- 357 ₽'.
  const re=/(?<!\d)(\+?\s*(?:\d{1,3}(?:[\s\u00a0\u202f]\d{3})+|\d+)(?:[,.]\d{1,2})?)\s*₽/g;
  const matches=[...String(line).matchAll(re)]; if(!matches.length)return null;
  const m=matches.at(-1); const raw=m[1].replace(/[\s\u00a0\u202f]/g,'').replace(/[−–—]/g,'-');
  const positive=raw.startsWith('+'); const value=parseMoney(raw); if(value===null)return null;
  return {value:Math.abs(value),positive,full:m[0]};
}

// Yandex Bank uses two coordinate-based PDF layouts. The parser consumes word
// coordinates reconstructed from PDF.js text items and fails closed if either
// date or an explicitly signed amount is ambiguous.
const YANDEX_FOOTERS = [
  'продолжение на следующей странице','страница ','исходящий остаток',
  'всего расходных операций','всего приходных операций','итого списаний',
  'итого зачислений','с уважением','начальник отдела','ао «яндекс банк»'
];
const YANDEX_NOISE = new Set(['в','мск','карта','руб','₽']);
const YANDEX_DATE_RE = /(?<!\d)(\d{2}\.\d{2}\.\d{4})(?!\d)/;
const YANDEX_TIME_RE = /(?<!\d)(\d{2}:\d{2})(?!\d)/;
const YANDEX_MONEY_RE = /(?<![\w\d])([+\-−–—]?\s*(?:(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+)|\d+)[,.]\d{2})(?![\w])/g;

export function pdfJsItemsToYandexWords(items, pageHeight) {
  const words=[];
  for(const item of items||[]) {
    const text=String(item.str||'').trim();
    if(!text)continue;
    const transform=item.transform||[];
    const x0=Number(transform[4]||0);
    const baseline=Number(transform[5]||0);
    const height=Math.abs(Number(item.height||transform[3]||0));
    const top=Number(pageHeight)-baseline-height;
    const parts=text.split(/\s+/).filter(Boolean);
    const width=Math.max(0,Number(item.width||0));
    const total=Math.max(1,text.length);
    let cursor=0;
    for(const part of parts) {
      const at=text.indexOf(part,cursor);
      const start=at>=0?at:cursor;
      const x=x0+(width*(start/total));
      words.push({x,top,text:part});
      cursor=start+part.length;
    }
  }
  return words;
}

function groupYandexWords(words,tolerance=2.5) {
  const groups=[];
  for(const word of [...(words||[])].sort((a,b)=>Number(a.top)-Number(b.top)||Number(a.x)-Number(b.x))) {
    const top=Number(word.top||0);
    let group=groups.find(g=>Math.abs(top-g.top)<=tolerance);
    if(!group){group={top,words:[]};groups.push(group);}
    group.words.push({x:Number(word.x||0),text:String(word.text||'')});
  }
  for(const group of groups)group.words.sort((a,b)=>a.x-b.x);
  return groups;
}
function yandexZoneText(words,xMin,xMax) {
  return (words||[]).filter(w=>xMin<=Number(w.x)&&Number(w.x)<xMax).sort((a,b)=>a.x-b.x).map(w=>String(w.text||'')).join(' ').trim();
}
function yandexParseDate(zone) {
  const match=String(zone||'').match(YANDEX_DATE_RE); if(!match)return null;
  const [day,month,year]=match[1].split('.'); return `${year}-${month}-${day}`;
}
function yandexParseSignedMoney(zone,label) {
  const text=String(zone||'').replace(/[\u00a0\u202f]/g,' ');
  const matches=[...text.matchAll(YANDEX_MONEY_RE)];
  if(matches.length!==1)throw new Error(`Yandex ${label}: expected exactly one monetary value in the amount column, found ${matches.length}.`);
  const raw=matches[0][1].trim().replace(/[−–—]/g,'-');
  if(!/^[+\-]/.test(raw))throw new Error(`Yandex ${label}: amount has no explicit +/− sign; row was not guessed.`);
  const value=parseMoney(raw);
  if(value===null)throw new Error(`Yandex ${label}: invalid monetary value ${raw}.`);
  return value;
}
function yandexRowDescription(groups,start,end) {
  const pieces=[];
  for(const group of groups.slice(start,end)) {
    const rowWords=[];
    for(const word of group.words) {
      if(Number(word.x)>=345)continue;
      const token=String(word.text||'').trim();
      if(!token||YANDEX_DATE_RE.test(token)||YANDEX_TIME_RE.test(token))continue;
      if(YANDEX_NOISE.has(token.toLowerCase()))continue;
      rowWords.push(token);
    }
    const line=rowWords.join(' ').replace(/\s+/g,' ').replace(/^[\s,;:-]+|[\s,;:-]+$/g,'').trim();
    const folded=line.toLowerCase().replaceAll('ё','е');
    if(YANDEX_FOOTERS.some(prefix=>folded.startsWith(prefix)))break;
    if(!line)continue;
    if(['описание операции','дата операции','дата и время операции'].includes(folded))continue;
    pieces.push(line);
  }
  let description=pieces.join(' ').replace(/\s+/g,' ').trim();
  for(const marker of YANDEX_FOOTERS){const at=description.toLowerCase().indexOf(marker);if(at>=0)description=description.slice(0,at).trim();}
  return description;
}
function yandexOperationTime(groups,start,end) {
  for(const group of groups.slice(start,end)) {
    const zone=yandexZoneText(group.words,190,275); const match=zone.match(YANDEX_TIME_RE);
    if(match)return match[1];
  }
  return null;
}
function yandexTransactionType(description,amount) {
  // Use the shared Windows-compatible classifier: it folds punctuation and
  // Preserve punctuation-independent matching for bank-described SBP operations.
  if(isInternalTransfer(description))return 'internal_transfer';
  const folded=fold(description);
  if(folded.includes('отмена оплаты')||folded.includes('возврат'))return 'refund';
  return amount>0?'income':amount<0?'expense':'unknown';
}
function yandexFooterTotals(pageGroups) {
  const result={incoming:null,outgoing:null,labels:{}};
  for(const groups of pageGroups)for(const group of groups) {
    const line=group.words.map(w=>w.text).join(' ').replace(/\s+/g,' ').trim();
    const folded=line.toLowerCase().replaceAll('ё','е');
    // JS \\b is ASCII-centric and does not form a word boundary after
    // Cyrillic. Prefix checks are deliberate and work with Russian labels.
    const incoming=folded.startsWith('всего приходных операций')||folded.startsWith('итого зачислений');
    const outgoing=folded.startsWith('всего расходных операций')||folded.startsWith('итого списаний');
    if(!incoming&&!outgoing)continue;
    const matches=[...line.replace(/[\u00a0\u202f]/g,' ').matchAll(YANDEX_MONEY_RE)];
    if(!matches.length)continue;
    const amount=parseMoney(matches.at(-1)[1]);
    if(amount===null)continue;
    if(incoming&&result.incoming===null){result.incoming=Math.abs(amount);result.labels.incoming=line.slice(0,120);}
    if(outgoing&&result.outgoing===null){result.outgoing=Math.abs(amount);result.labels.outgoing=line.slice(0,120);}
  }
  return result;
}

export function parseYandexWordPages(pages,fileDigest,sourceFile='Yandex.pdf',existingLabels=new Map(),existingRules=new Map()) {
  if(!Array.isArray(pages)||!pages.length)throw new Error('Yandex PDF has no readable pages.');
  const groupedPages=pages.map(groupYandexWords);
  const firstText=(groupedPages[0]||[]).map(g=>g.words.map(w=>w.text).join(' ')).join(' ').toLowerCase().replaceAll('ё','е').replace(/\s+/g,' ');
  let layout='';
  if(firstText.includes('яндекс банк')&&firstText.includes('дата и время')&&(firstText.includes('дата обработки')||firstText.includes('операции обработки'))&&firstText.includes('сумма в валюте')&&firstText.includes('договора'))layout='dual_currency';
  else if(firstText.includes('яндекс банк')&&firstText.includes('дата операции')&&firstText.includes('сумма в валюте')&&firstText.includes('договора')&&!firstText.includes('дата и время'))layout='savings_single_currency';
  else throw new Error('Yandex Bank was identified, but this PDF does not match either verified layout (payment account or Сейв savings account).');

  const parsed=[];
  for(let pageIndex=0;pageIndex<groupedPages.length;pageIndex++) {
    const groups=groupedPages[pageIndex]; const pageNo=pageIndex+1; const events=[];
    for(let gi=0;gi<groups.length;gi++) {
      const words=groups[gi].words;
      if(layout==='dual_currency') {
        const operationDate=yandexParseDate(yandexZoneText(words,190,275));
        const postingDate=yandexParseDate(yandexZoneText(words,275,345));
        const operationAmountZone=yandexZoneText(words,395,490);
        const contractAmountZone=yandexZoneText(words,490,595);
        const hasAmount=YANDEX_MONEY_RE.test(operationAmountZone)||YANDEX_MONEY_RE.test(contractAmountZone); YANDEX_MONEY_RE.lastIndex=0;
        const hasDate=!!(operationDate||postingDate);
        if(!(hasAmount&&hasDate))continue;
        if(!operationDate||!postingDate)throw new Error(`Yandex page ${pageNo}, line ${gi+1}: date columns are incomplete for a monetary row.`);
        const operationAmount=yandexParseSignedMoney(operationAmountZone,`page ${pageNo}, operation-currency row ${events.length+1}`);
        const contractAmount=yandexParseSignedMoney(contractAmountZone,`page ${pageNo}, contract-currency row ${events.length+1}`);
        events.push({groupIndex:gi,txDate:postingDate,operationDate,postingDate,operationAmount,amount:contractAmount,signsDisagree:(operationAmount<0)!==(contractAmount<0),operationTime:yandexOperationTime(groups,gi,Math.min(gi+3,groups.length))});
      } else {
        const operationDate=yandexParseDate(yandexZoneText(words,345,445));
        const amountZone=yandexZoneText(words,480,595);
        YANDEX_MONEY_RE.lastIndex=0; const hasAmount=YANDEX_MONEY_RE.test(amountZone); YANDEX_MONEY_RE.lastIndex=0;
        if(!(operationDate&&hasAmount))continue;
        const amount=yandexParseSignedMoney(amountZone,`page ${pageNo}, savings row ${events.length+1}`);
        events.push({groupIndex:gi,txDate:operationDate,operationDate,postingDate:null,operationAmount:amount,amount,signsDisagree:false,operationTime:null});
      }
    }
    for(let idx=0;idx<events.length;idx++) {
      const event=events[idx],start=event.groupIndex,end=events[idx+1]?.groupIndex??groups.length;
      const description=yandexRowDescription(groups,start,end);
      if(!description)throw new Error(`Yandex page ${pageNo}, row ${idx+1}: transaction description is blank; import stopped.`);
      const rawLines=[];
      for(const group of groups.slice(start,end)) {
        const line=yandexZoneText(group.words,0,345);
        const folded=line.toLowerCase().replaceAll('ё','е').replace(/\s+/g,' ').trim();
        if(YANDEX_FOOTERS.some(prefix=>folded.startsWith(prefix)))break;
        rawLines.push(group.words.map(w=>w.text).join(' '));
      }
      const notes=`Yandex Bank PDF: signed amount reconstructed from the ${layout==='dual_currency'?'contract-currency column; posting date is used as the budget date.':'single contract-currency amount column.'}${event.signsDisagree?' Operation-currency and contract-currency signs differ; contract-currency movement is preserved and needs review.':''}`;
      parsed.push({tx_date:event.txDate,operation_date:event.operationDate,posting_date:event.postingDate,operation_time:event.operationTime,description,amount:event.amount,currency:'RUB',transaction_type:yandexTransactionType(description,event.amount),operation_currency_amount:event.operationAmount,contract_currency_amount:event.amount,currency_signs_disagree:event.signsDisagree,source_page:pageNo,source_row:idx+1,source_y:Number(groups[start].top.toFixed(2)),raw_block:rawLines.join('\n'),notes});
    }
  }
  if(!parsed.length)throw new Error('Yandex Bank was identified, but no complete transaction rows were reconstructed.');
  const footer=yandexFooterTotals(groupedPages);
  const incomingCents=parsed.filter(r=>r.amount>0).reduce((s,r)=>s+amountCents(r.amount),0);
  const outgoingCents=parsed.filter(r=>r.amount<0).reduce((s,r)=>s+Math.abs(amountCents(r.amount)),0);
  const expectedIncoming=footer.incoming===null?null:amountCents(footer.incoming);
  const expectedOutgoing=footer.outgoing===null?null:amountCents(footer.outgoing);
  const incomingMatch=expectedIncoming===null?null:incomingCents===expectedIncoming;
  const outgoingMatch=expectedOutgoing===null?null:outgoingCents===expectedOutgoing;
  if(incomingMatch===false||outgoingMatch===false)throw new Error(`Yandex statement reconciliation failed: extracted ${numbersValue(incomingCents)} incoming / ${numbersValue(outgoingCents)} outgoing, printed totals ${footer.incoming===null?'not found':numbersValue(expectedIncoming)} incoming / ${footer.outgoing===null?'not found':numbersValue(expectedOutgoing)} outgoing. Nothing was imported.`);
  const sourceDigest=String(fileDigest||'').slice(0,24);
  const rows=parsed.map((item,index)=>{
    const key=categoryRuleKey('yandex-pdf',item.description);
    const merchant=existingLabels.get(key)||item.description;
    const type=item.transaction_type;
    const suggested=type==='internal_transfer'||type==='transfer'?'Внутренний перевод (не расход)':type==='refund'?'Возвраты':'Не распределено';
    const category=existingRules.get(key)||suggested;
    const raw={parser:'yandex-bank-pdf-v1',operation_date:item.operation_date,posting_date:item.posting_date,operation_currency_amount:item.operation_currency_amount,contract_currency_amount:item.contract_currency_amount,operation_time:item.operation_time,source_page:item.source_page,source_row:item.source_row,source_y:item.source_y,currency_signs_disagree:item.currency_signs_disagree,raw_block:item.raw_block};
    return {tx_date:item.tx_date,description:item.description,merchant,merchant_key:key,transaction_type:type,source_ref:`bankpdf:yandex:${sourceDigest}:row:${index+1}`,amount:item.amount,currency:'RUB',category,status:'Needs review',source_file:sourceFile,source_frame:item.source_page,raw_text:JSON.stringify(raw),notes:item.notes+(existingLabels.has(key)||existingRules.has(key)?' Merchant/category suggested by a saved bank-specific PDF rule.':'')};
  });
  return {rows,bank:'YANDEX',layout,page_count:groupedPages.length,audit:{parser:`Yandex coordinate PDF.js parser / ${layout}`,transaction_count:rows.length,incoming_total:incomingCents/100,outgoing_total:outgoingCents/100,expected_incoming:footer.incoming,expected_outgoing:footer.outgoing,statement_totals_available:expectedIncoming!==null||expectedOutgoing!==null,statement_totals_match:expectedIncoming!==null||expectedOutgoing!==null?incomingMatch!==false&&outgoingMatch!==false:null,currency:'RUB',currency_sign_disagreement_count:parsed.filter(r=>r.currency_signs_disagree).length,footer_labels:footer.labels}};
}

export function parseTbankRows(rows, fileDigest, sourceFile='Tbank.xlsx', existingLabels=new Map(), existingRules=new Map()) {
  const required=['имя счета','дата операции','сумма операции','валюта операции','сумма в валюте счета','валюта счета','статус','описание','сообщение','учет в аналитике'];
  const headerIndex=rows.slice(0,20).findIndex(row=>{
    const headers=new Set(row.map(fold).filter(Boolean)); return required.filter(h=>headers.has(fold(h))).length>=8 && headers.has('дата операции')&&headers.has('сумма операции');
  });
  if(headerIndex<0)throw new Error('Could not find the supported T-Bank Excel transaction-history headers.');
  const headers=rows[headerIndex].map(fold); const idx=name=>headers.indexOf(fold(name));
  const get=(row,...names)=>{for(const name of names){const i=idx(name);if(i>=0&&i<row.length)return row[i]??'';}return '';};
  const sourceDigest=String(fileDigest||'').slice(0,24);
  const result=[],cards=new Map();
  for(let i=headerIndex+1;i<rows.length;i++){
    const row=rows[i]; if(!row.some(v=>String(v??'').trim()))continue;
    const accountName=String(get(row,'Имя счёта')).trim(), card=String(get(row,'Номер карты')).trim();
    if(card)cards.set(card.replace(/^[*•\s]+/,'').trim(),accountName||'T-Bank card');
    const date=parseDate(get(row,'Дата операции'));
    const opAmount=parseMoney(get(row,'Сумма операции')); const accAmount=parseMoney(get(row,'Сумма в валюте счёта'));
    const amount=accAmount!==null?accAmount:opAmount; if(amount===null)throw new Error(`T-Bank row ${i+1} has no readable amount.`);
    const opCurrency=String(get(row,'Валюта операции')).trim().toUpperCase(); const currency=String(get(row,'Валюта счёта')||opCurrency||'RUB').trim().toUpperCase();
    const description=String(get(row,'Описание')||get(row,'Сообщение')||get(row,'Категория по-умолчанию')||'Операция Т-Банка').trim();
    const message=String(get(row,'Сообщение')).trim(); const defaultBankCategory=String(get(row,'Категория по-умолчанию')).trim();
    const personalCategory=String(get(row,'Ваша категория')).trim(); const status=String(get(row,'Статус')).trim();
    const type=transactionType(amount,description,message,defaultBankCategory);
    const key=categoryRuleKey('tbank-xlsx',description);
    const raw={parser:'tbank-xlsx-transaction-history-web-v1',source_row:i+1,account_name:accountName,card_number:card,operation_amount:opAmount,operation_currency:opCurrency,account_amount:accAmount,account_currency:currency,bank_status:status,default_category:defaultBankCategory,personal_category:personalCategory,mcc:get(row,'MCC'),description,message,rounding:parseMoney(get(row,'Округление')),rounded_amount:parseMoney(get(row,'Сумма операции с округлением')),bonuses_cashback:parseMoney(get(row,'Бонусы (включая кэшбэк)')),included_in_analytics:get(row,'Учёт в аналитике')};
    const noteParts=[]; if(message)noteParts.push(`Комментарий банка: ${message}`); const accountDetail=[accountName,card?`карта ${card}`:''].filter(Boolean).join(' · '); if(accountDetail)noteParts.push(`Счёт/карта: ${accountDetail}`); if(status)noteParts.push(`Статус банка: ${status}`); const analytics=get(row,'Учёт в аналитике','Учет в аналитике'); if(analytics)noteParts.push(`Учёт в аналитике банка: ${analytics}`); if(defaultBankCategory)noteParts.push(`Категория банка: ${defaultBankCategory}`); if(personalCategory)noteParts.push(`Ваша категория в банке: ${personalCategory}`);
    const merchant=existingLabels.get(key)||description; const category=existingRules.get(key)||defaultCategory(description,type);
    result.push({tx_date:date,description,merchant,merchant_key:key,transaction_type:type,source_ref:`tbank-xlsx:${sourceDigest}:r${i+1}`,amount,currency,category,status:'Needs review',source_file:sourceFile,raw_text:JSON.stringify(raw),notes:noteParts.join(' · ')||'T-Bank Excel export. Verify the transaction.'});
  }
  if(!result.length)throw new Error('No T-Bank transaction rows were found.');
  return {rows:result,cards:[...cards.entries()].map(([identifier,label])=>({identifier,label})),audit:{parser:'T-Bank Excel transaction-history parser',transaction_count:result.length,incoming_total:result.filter(r=>r.amount>0).reduce((s,r)=>s+r.amount,0),outgoing_total:result.filter(r=>r.amount<0).reduce((s,r)=>s-r.amount,0),statement_totals_available:false,currency:result[0].currency}};
}

export async function decodeStatementBytes(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try { return new TextDecoder('utf-8', {fatal:true}).decode(data); }
  catch { try { return new TextDecoder('windows-1251').decode(data); }
    catch { throw new Error('Could not decode this CSV as UTF-8 or Windows-1251.'); }
  }
}

function raiffeisenNormText(value='') {
  return String(value||'').toLowerCase().replaceAll('ё','е').replace(/[^\p{L}\p{Nd}_]+/gu,' ').trim().replace(/\s+/g,' ');
}
function raiffeisenMerchantKey(description) {
  const raw=String(description||''), text=raiffeisenNormText(raw);
  if(text.includes('internal transfer'))return 'raiffeisen:internal-transfer';
  if(text.includes('transfer fee'))return 'raiffeisen:transfer-fee-card-number';
  if(text.includes('unable to transfer'))return 'raiffeisen:failed-transfer-card-number';
  if(text.includes('recipient')&&text.includes('phone number')){
    const phone=raw.match(/(?<!\d)(?:7|8)\d{10}(?!\d)/);
    const bank=raw.match(/Recipient['`’]?s bank\s+(.+?)(?:\s+SBP ID\b|$)/i);
    const bankKey=bank?raiffeisenNormText(bank[1]):'unknown-bank';
    const phoneKey=phone?phone[0].slice(-10):'unknown-phone';
    return `raiffeisen:sbp:${phoneKey}:${bankKey}`;
  }
  if(text.includes('atm')){
    const atm=raw.match(/ATM\s+(.+)$/i);
    if(atm)return `raiffeisen:atm:${raiffeisenNormText(atm[1])}`;
  }
  const cleaned=raw.replace(/SBP ID\s+[A-Z0-9]+/ig,'').replace(/(?:From|To) account:\s*\*?\d+/ig,'').replace(/(?<!\d)(?:\+?7|8)\d{10}(?!\d)/g,'<phone>');
  return 'raiffeisen:'+raiffeisenNormText(cleaned);
}
function raiffeisenMerchant(description){
  const raw=String(description||''),t=raiffeisenNormText(raw);
  if(t.includes('internal transfer'))return 'Внутренний перевод';
  if(t.includes('transfer fee'))return 'Комиссия за перевод';
  if(t.includes('unable to transfer'))return 'Неуспешный перевод';
  if(t.includes('recipient')&&t.includes('phone number')){
    const phone=raw.match(/(?<!\d)(?:7|8)\d{10}(?!\d)/);
    const bank=raw.match(/Recipient['`’]?s bank\s+(.+?)(?:\s+SBP ID\b|$)/i);
    return `Перевод СБП — ${bank?bank[1].trim():'банк не указан'}${phone?` · ***${phone[0].slice(-4)}`:''}`;
  }
  const atm=raw.match(/ATM\s+(.+)$/i);if(atm)return `Банкомат ${atm[1].trim()}`;
  return raw.replace(/\s+To account:\s*\*?\d+.*$/i,'').trim()||'Неизвестный контрагент';
}
function raiffeisenSuggestedCategory(description, type){
  const t=raiffeisenNormText(description);
  if(isInternalTransfer(description)||t.includes('internal transfer'))return 'Внутренний перевод (не расход)';
  if(t.includes('transfer fee'))return 'Не распределено';
  if(t.includes('unable to transfer'))return 'Не распределено';
  if(t.includes('atm')&&type==='expense')return 'Снятие наличных';
  if(t.includes('atm')&&type==='income')return 'Внесение наличных';
  return 'Не распределено';
}

export async function parseRaiffeisenCSV(text,fileDigest,sourceFile='Raiffeisen.csv',existingLabels=new Map(),existingRules=new Map()) {
  const rows=csvRows(text); if(!rows.length)throw new Error('The CSV appears to be empty.');
  const headers=rows[0].map(v=>String(v??'').trim().replace(/^\ufeff/,'')); const folded=headers.map(fold);
  const find=(...opts)=>{for(const o of opts){const i=folded.indexOf(fold(o));if(i>=0)return i;}return -1;};
  const dateI=find('Дата операции','Дата'),docI=find('Номер документа');
  const inOpI=find('Сумма в валюте операции (поступления)'),outOpI=find('Сумма в валюте операции (расходы)'),opCcyI=find('Валюта операции');
  const inAccI=find('Сумма в валюте счета (поступления)'),outAccI=find('Сумма в валюте счета (расходы)'),accCcyI=find('Валюта счета');
  const descI=find('Детали операции (назначение платежа)','Назначение платежа','Детали операции');
  if(dateI<0||descI<0||(inAccI<0&&inOpI<0)||(outAccI<0&&outOpI<0))throw new Error('This CSV does not match the supported Raiffeisen statement columns.');
  const out=[], seen=new Map();
  for(let i=1;i<rows.length;i++){
    const cells=rows[i]; if(!cells.some(v=>String(v??'').trim()))continue;
    const raw=Object.fromEntries(headers.map((h,j)=>[h,String(cells[j]??'').trim()]));
    const date=parseDate(cells[dateI]); const credit=parseMoney(cells[inAccI>=0?inAccI:inOpI])??0; const debit=parseMoney(cells[outAccI>=0?outAccI:outOpI])??0;
    if(credit===0&&debit===0)continue;
    const amount=Math.round((credit-debit)*100)/100; const currency=String(cells[accCcyI>=0?accCcyI:opCcyI]||'').trim().toUpperCase();
    const description=String(cells[descI]||'Без описания операции').trim(); const foldedDesc=raiffeisenNormText(description);
    let type=transactionType(amount,description);
    if(isInternalTransfer(description))type='internal_transfer';
    else if(foldedDesc.includes('internal transfer'))type='transfer';
    else if(foldedDesc.includes('transfer fee')&&amount>0)type='refund';
    else if(foldedDesc.includes('unable to transfer'))type='review';
    else type=amount>=0?'income':'expense';
    const key=raiffeisenMerchantKey(description);
    const merchant=existingLabels.get(key)||raiffeisenMerchant(description);
    const category=existingRules.get(key)||raiffeisenSuggestedCategory(description,type);
    const doc=docI>=0?String(cells[docI]||'').trim():'';
    let sourceRef;
    if(doc)sourceRef=`doc:${doc}`;
    else {
      const canonical='{'+Object.entries(raw).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')+'}';
      const rowDigest=await sha256Hex(new TextEncoder().encode(canonical).buffer);
      const occurrences=(seen.get(rowDigest)||0)+1; seen.set(rowDigest,occurrences);
      sourceRef=`row:${rowDigest}:${occurrences}`;
    }
    const remembered=existingLabels.has(key)||existingRules.has(key);
    out.push({tx_date:date,description,merchant,merchant_key:key,transaction_type:type,source_ref:sourceRef,amount,currency,category,status:'Needs review',source_file:sourceFile,raw_text:JSON.stringify(raw),notes:remembered?'Контрагент/категория предложены по сохраненному правилу точного описания':'Проверить перед подтверждением'});
  }
  if(!out.length)throw new Error('No transaction rows with non-zero amounts were found in this Raiffeisen CSV.');
  return {rows:out,audit:{parser:'Raiffeisen CSV column parser',transaction_count:out.length,incoming_total:out.filter(r=>r.amount>0).reduce((s,r)=>s+r.amount,0),outgoing_total:out.filter(r=>r.amount<0).reduce((s,r)=>s+Math.abs(r.amount),0),statement_totals_available:false}};
}
export function csvRows(text){
  const first=String(text).split(/\r?\n/,1)[0]||''; const delim=(first.match(/;/g)||[]).length >= (first.match(/,/g)||[]).length?';':',';
  const result=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}else if(c==='"')quoted=true;else if(c===delim){row.push(field);field='';}else if(c==='\n'){row.push(field.replace(/\r$/,''));if(row.some(x=>String(x).trim()))result.push(row);row=[];field='';}else field+=c;}
  row.push(field.replace(/\r$/,''));if(row.some(x=>String(x).trim()))result.push(row);return result;
}
export function inferMonth(rows){
  const counts=new Map(); for(const r of rows){const m=monthOf(r.tx_date);if(m)counts.set(m,(counts.get(m)||0)+1);}
  return [...counts.entries()].sort((a,b)=>b[1]-a[1]||b[0].localeCompare(a[0]))[0]?.[0]||monthNowPrevious();
}
export function inferAccountForBank(bank){return ({SBER:'SBER',TBANK:'TBANK',RAIFFEISEN:'RAIFFEISEN',YANDEX:'YANDEX'})[bank]||bank;}
