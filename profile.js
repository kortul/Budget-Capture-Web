export const PROFILE_SCHEMA_VERSION = 1;
export const PROFILE_STORAGE_KEY = 'budget_profile_v1';

export const SAFE_DEFAULT_PROFILE = {
  schemaVersion: PROFILE_SCHEMA_VERSION,
  categories: [
    { name: 'Не распределено', kind: 'other' },
    { name: 'Внутренний перевод (не расход)', kind: 'other' },
    { name: 'Еда', kind: 'expense' },
    { name: 'Транспорт', kind: 'expense' },
    { name: 'Жильё', kind: 'expense' },
    { name: 'Коммунальные услуги', kind: 'expense' },
    { name: 'Снятие наличных', kind: 'expense' },
    { name: 'Возвраты', kind: 'income' },
    { name: 'Внесение наличных', kind: 'income' },
    { name: 'Зарплата', kind: 'income' }
  ],
  numbers: {
    expenseTitle: 'РАСХОДЫ',
    incomeTitle: 'ДОХОДЫ',
    specialInput: { category: '', title: 'Дополнительные поступления' },
    specialOutput: { category: '', title: 'Дополнительные списания' },
    highlightedTitle: 'Отмеченные расходы'
  }
};

const CATEGORY_KINDS = new Set(['expense', 'income', 'other', 'special_input', 'special_output']);

function cleanText(value, fallback = '', limit = 120) {
  const result = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limit);
  return result || fallback;
}

function legacyCategoryName(value) {
  const name=cleanText(value,'',100);
  if(!name||name.toLowerCase()==='uncategorized')return 'Не распределено';
  return name;
}

function uniqueCategories(input) {
  const result = [];
  const seen = new Set();
  for (const item of Array.isArray(input) ? input : []) {
    const name = cleanText(typeof item === 'string' ? item : item?.name, '', 100);
    if (!name || seen.has(name)) continue;
    const kind = typeof item === 'object' && CATEGORY_KINDS.has(item?.kind) ? item.kind : 'other';
    result.push({ name, kind });
    seen.add(name);
    if (result.length >= 500) break;
  }
  return result;
}

export function normalizeProfile(input) {
  const source = input && typeof input === 'object' ? input : {};
  const sourceNumbers = source.numbers && typeof source.numbers === 'object' ? source.numbers : {};
  const defaults = SAFE_DEFAULT_PROFILE;
  const categories = uniqueCategories(source.categories);
  if (!categories.length) categories.push(...defaults.categories.map(item => ({ ...item })));

  const specialInput = sourceNumbers.specialInput && typeof sourceNumbers.specialInput === 'object' ? sourceNumbers.specialInput : {};
  const specialOutput = sourceNumbers.specialOutput && typeof sourceNumbers.specialOutput === 'object' ? sourceNumbers.specialOutput : {};
  const inputCategory = cleanText(specialInput.category, '', 100);
  const outputCategory = cleanText(specialOutput.category, '', 100);

  const setSpecialKind = (name, kind) => {
    if (!name) return;
    const existing = categories.find(item => item.name === name);
    if (existing) existing.kind = kind;
    else categories.push({ name, kind });
  };
  setSpecialKind(inputCategory, 'special_input');
  setSpecialKind(outputCategory, 'special_output');

  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    categories,
    numbers: {
      expenseTitle: cleanText(sourceNumbers.expenseTitle, defaults.numbers.expenseTitle, 80),
      incomeTitle: cleanText(sourceNumbers.incomeTitle, defaults.numbers.incomeTitle, 80),
      specialInput: {
        category: inputCategory,
        title: cleanText(specialInput.title, inputCategory || defaults.numbers.specialInput.title, 100)
      },
      specialOutput: {
        category: outputCategory,
        title: cleanText(specialOutput.title, outputCategory || defaults.numbers.specialOutput.title, 100)
      },
      highlightedTitle: cleanText(sourceNumbers.highlightedTitle, defaults.numbers.highlightedTitle, 100)
    }
  };
}

export function inferLegacyProfile(categoryRows = [], transactionRows = []) {
  const names = [];
  const seen = new Set();
  for (const row of categoryRows) {
    const name = legacyCategoryName(typeof row === 'string' ? row : row?.name);
    if (name && !seen.has(name)) {
      names.push(name);
      seen.add(name);
    }
  }
  for (const row of transactionRows) {
    const name = legacyCategoryName(row?.category);
    if (name && !seen.has(name)) {
      names.push(name);
      seen.add(name);
    }
  }
  if (!names.length) return normalizeProfile(SAFE_DEFAULT_PROFILE);

  const totals = new Map(names.map(name => [name, { expense: 0, income: 0 }]));
  for (const row of transactionRows) {
    const name = legacyCategoryName(row?.category);
    const tally = totals.get(name);
    const amount = Number(row?.amount);
    if (!tally || !Number.isFinite(amount)) continue;
    if (amount < 0) tally.expense += 1;
    if (amount > 0) tally.income += 1;
  }

  const inputName = names.find(name => /^(?:вводы|поступления)(?:\s|$).*спец/i.test(name)) || '';
  const outputName = names.find(name => /^(?:выводы|списания)(?:\s|$).*спец/i.test(name)) || '';
  const categories = names.map(name => {
    if (name === inputName) return { name, kind: 'special_input' };
    if (name === outputName) return { name, kind: 'special_output' };
    if (/^(?:не распределено|внутренний перевод)/i.test(name)) return { name, kind: 'other' };
    const tally = totals.get(name);
    if (tally.expense > tally.income) return { name, kind: 'expense' };
    if (tally.income > tally.expense) return { name, kind: 'income' };
    return { name, kind: 'other' };
  });

  return normalizeProfile({
    schemaVersion: PROFILE_SCHEMA_VERSION,
    categories,
    numbers: {
      expenseTitle: SAFE_DEFAULT_PROFILE.numbers.expenseTitle,
      incomeTitle: SAFE_DEFAULT_PROFILE.numbers.incomeTitle,
      specialInput: { category: inputName, title: inputName || SAFE_DEFAULT_PROFILE.numbers.specialInput.title },
      specialOutput: { category: outputName, title: outputName || SAFE_DEFAULT_PROFILE.numbers.specialOutput.title },
      highlightedTitle: SAFE_DEFAULT_PROFILE.numbers.highlightedTitle
    }
  });
}

export function profileKind(profile, category) {
  return normalizeProfile(profile).categories.find(item => item.name === category)?.kind || 'other';
}
