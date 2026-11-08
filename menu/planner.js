// Планировщик меню на календарную неделю.
// Данные лежат в S.menu: dishes (библиотека с ингредиентами), weeks (планы по понедельникам),
// purchases (закупки с чеками). Всё сохраняется вместе с остальными данными семьи.
//
// Граммовки: у каждого блюда два значения на ингредиент — a для меньшей порции, b для большей.
// На приём пищи уходит a + b. Супы — на два дня: в каждый обед уже заложена половина батча.

const MEALS = [['breakfast', 'Завтрак'], ['lunch', 'Обед'], ['dinner', 'Ужин']];
const CATS = {
  meat: 'Мясо и рыба', dairy: 'Молочка и яйца', veg: 'Овощи и фрукты', grain: 'Крупы и макароны',
  bakery: 'Хлеб', pantry: 'Бакалея и специи', other: 'Прочее', unsplit: 'Без разбивки'
};
const CAT_COLOR = {
  meat: '#b5533c', dairy: '#e0a044', veg: '#4c8474', grain: '#c8a46a',
  bakery: '#9a7b5b', pantry: '#7a7fa6', other: '#8a8a8a', unsplit: '#c9c9c9'
};
const DAYS_RU = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const STATUS_RU = { draft: 'Черновик', confirmed: 'Подтверждено', bought: 'Куплено' };
const TYPE_RU = { breakfast: 'Завтрак', lunch: 'Обед', soup: 'Суп', dinner: 'Ужин' };

let ctx = null;
let TAB = 'week';
let weekStart = null;
let statsMonth = null;
let libFilter = 'all';
let libQuery = '';
let purchaseMode = 'sum';
let purchaseParsed = null;

export function plannerInit(context) {
  ctx = context;
  weekStart = mondayOf(ctx.todayIso());
  statsMonth = ctx.todayIso().slice(0, 7);
}

// ---------- даты ----------
const toDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (iso, n) => { const d = toDate(iso); d.setDate(d.getDate() + n); return toIso(d); };
const mondayOf = (iso) => addDays(iso, -((toDate(iso).getDay() + 6) % 7));
const weekDays = (mon) => Array.from({ length: 7 }, (_, i) => addDays(mon, i));
const dayLabel = (iso) => { const d = toDate(iso); return `${DAYS_RU[d.getDay()]}, ${d.getDate()} ${MONTHS_RU[d.getMonth()]}`; };
const weekLabel = (mon) => {
  const a = toDate(mon); const b = toDate(addDays(mon, 6));
  return `${a.getDate()} ${MONTHS_RU[a.getMonth()]} – ${b.getDate()} ${MONTHS_RU[b.getMonth()]}`;
};
const monthLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return `${new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { month: 'long' })} ${y}`; };
const shiftMonth = (ym, k) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + k, 1); return toIso(d).slice(0, 7); };
const esc = (s) => ctx.esc(s);
const money = (n) => ctx.money(n);

// ---------- количества ----------
function fmtQty(v, unit) {
  if (!v) return unit === 'по вкусу' ? 'по вкусу' : '';
  if (unit === 'г' && v >= 1000) return `${String((v / 1000).toFixed(2)).replace(/\.?0+$/, '').replace('.', ',')} кг`;
  if (unit === 'мл' && v >= 1000) return `${String((v / 1000).toFixed(2)).replace(/\.?0+$/, '').replace('.', ',')} л`;
  const r = Math.round(v * 10) / 10;
  return `${String(r).replace('.', ',')} ${unit}`;
}
const itemKey = (i) => `${i.name.toLowerCase()}|${i.unit}`;

// ---------- данные ----------
const M = () => ctx.S().menu;
const dishes = () => M().dishes;
const dishByName = (n) => dishes().find((d) => d.name === n);
const dishesFor = (slot) => dishes().filter((d) => (slot === 'breakfast' ? d.type === 'breakfast'
  : slot === 'dinner' ? d.type === 'dinner' : (d.type === 'lunch' || d.type === 'soup')));
const weekOf = (mon) => { M().weeks[mon] = M().weeks[mon] || { days: {}, status: 'draft' }; return M().weeks[mon]; };
const slotOf = (mon, iso, slot) => (((M().weeks[mon] || {}).days || {})[iso] || {})[slot] || '';
const lunchOn = (mon, iso) => { const d = ((M().weeks[mon] || {}).days || {})[iso] || {}; return d.lunchOn !== false; };

function setSlot(mon, iso, slot, value) {
  const w = weekOf(mon);
  w.days[iso] = w.days[iso] || {};
  w.days[iso][slot] = value || '';
  if (w.status !== 'draft') w.listDirty = true;
}

// Сводка продуктов на неделю: сумма a + b по каждому ингредиенту.
function aggregate(mon) {
  const w = M().weeks[mon];
  if (!w) return [];
  const map = new Map();
  for (const iso of weekDays(mon)) {
    const day = w.days[iso] || {};
    for (const [slot] of MEALS) {
      if (slot === 'lunch' && day.lunchOn === false) continue;
      const d = dishByName(day[slot]);
      if (!d) continue;
      for (const ing of d.ingredients) {
        const key = `${ing.name.toLowerCase()}|${ing.unit}`;
        const cur = map.get(key) || { name: ing.name, unit: ing.unit, cat: ing.cat, total: 0 };
        cur.total += (ing.a || 0) + (ing.b || 0);
        map.set(key, cur);
      }
    }
  }
  const order = Object.keys(CATS);
  return [...map.values()]
    .map((i) => ({ ...i, total: Math.round(i.total * 100) / 100 }))
    .sort((a, b) => (order.indexOf(a.cat) - order.indexOf(b.cat)) || a.name.localeCompare(b.name, 'ru'));
}

function mealsCount(mon) {
  const w = M().weeks[mon];
  if (!w) return 0;
  let n = 0;
  for (const iso of weekDays(mon)) for (const [slot] of MEALS) {
    if (slot === 'lunch' && (w.days[iso] || {}).lunchOn === false) continue;
    if ((w.days[iso] || {})[slot]) n++;
  }
  return n;
}

// ---------- разбор чеков ----------
const KW = [
  ['meat', /кур|говяд|свинин|фарш|мяс|рыб|форел|треск|лосос|филе|индейк|колбас|сосиск|горбуш/i],
  ['dairy', /молок|творог|сыр|йогурт|кефир|сметан|масл|яйц|сливк|ряжен|ряженк/i],
  ['bakery', /хлеб|батон|булк|лаваш|бублик|багет/i],
  ['grain', /рис|гречк|овся|макарон|лапш|круп|мюсли|горох|гранол|пшен|перлов/i],
  ['veg', /картоф|лук|морков|помидор|томат|огурц|перец|капуст|свекл|свёкл|яблок|банан|лимон|ягод|зелен|фрукт|овощ|укроп|петруш|чеснок|апельс|мандар|груш|салат|брокк|кабач|баклаж/i],
  ['pantry', /соус|специ|соль|сахар|мука|уксус|карри|паста|мёд|мед|орех|чай|кофе|какао|консерв|кокос|горчиц/i]
];
const guessCat = (name) => (KW.find(([, re]) => re.test(name)) || [null])[0] || 'other';

// Строки чека: последнее число с двумя знаками после запятой — цена позиции.
function parseReceiptLines(lines) {
  const items = [];
  let foundTotal = null;
  for (const raw of lines) {
    const line = String(raw).replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const m = line.match(/^(.*?)[\s.:;|]+(\d{1,3}(?:[  ]?\d{3})*[.,]\d{2})\s*(?:₽|р\.?|руб\.?)?$/i);
    if (!m) continue;
    const price = parseFloat(m[2].replace(/[\s ]/g, '').replace(',', '.'));
    const name = m[1].trim().replace(/[\s.:;|-]+$/, '');
    if (!name) continue;
    if (/итог|всего|к оплате/i.test(name)) { foundTotal = price; continue; }
    if (/скидк|налог|ндс|сдача|наличн|карт/i.test(name)) continue;
    items.push({ name, price, cat: guessCat(name) });
  }
  const sum = Math.round(items.reduce((a, i) => a + i.price, 0) * 100) / 100;
  return { items, sum, total: foundTotal ?? sum };
}

async function readReceiptLines(file) {
  if (/\.pdf$/i.test(file.name)) {
    const pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs';
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const lines = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const content = await (await doc.getPage(p)).getTextContent();
      const rows = new Map();
      for (const it of content.items) {
        if (!it.str) continue;
        const y = Math.round(it.transform[5]);
        rows.set(y, (rows.get(y) || '') + (rows.has(y) ? ' ' : '') + it.str);
      }
      [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, t]) => lines.push(t));
    }
    return lines;
  }
  return (await file.text()).split(/\r?\n/);
}

// ---------- инфографика ----------
function donutSvg(byCat, total) {
  const entries = Object.entries(byCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const r = 46;
  const c = 2 * Math.PI * r;
  let off = 0;
  const arcs = entries.map(([cat, v]) => {
    const len = total ? (c * v) / total : 0;
    const s = `<circle r="${r}" cx="60" cy="60" fill="none" stroke="${CAT_COLOR[cat] || '#999'}" stroke-width="18"
      stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)"/>`;
    off += len;
    return s;
  }).join('');
  return `<svg class="donut" viewBox="0 0 120 120" width="140" height="140" role="img" aria-label="Расходы по категориям">
    <circle r="${r}" cx="60" cy="60" fill="none" stroke="var(--row-line)" stroke-width="18"/>${arcs}
    <text x="60" y="58" text-anchor="middle" font-size="12" font-weight="800" fill="currentColor">${esc(money(total))}</text>
    <text x="60" y="74" text-anchor="middle" font-size="9" fill="currentColor" opacity=".7">всего</text></svg>`;
}

function legendHtml(byCat, total) {
  return Object.entries(byCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([cat, v]) => `
    <div class="leg-row">
      <span class="leg-dot" style="background:${CAT_COLOR[cat] || '#999'}"></span>
      <span class="leg-name">${esc(CATS[cat] || cat)}</span>
      <span class="leg-val">${esc(money(v))}</span>
      <span class="leg-pct">${total ? Math.round((v / total) * 100) : 0}%</span>
    </div>`).join('');
}

function barsHtml(rows, max) {
  return rows.map((r) => `<div class="bar-row">
    <span class="bar-lbl">${esc(r.label)}</span>
    <div class="bar-track"><div class="bar-fill" style="width:${max ? Math.round((r.value / max) * 100) : 0}%"></div></div>
    <span class="bar-val">${esc(money(r.value))}</span></div>`).join('');
}

// ---------- вкладка «Неделя» ----------
function weekHtml() {
  const mon = weekStart;
  const w = weekOf(mon);
  const today = ctx.todayIso();
  const count = mealsCount(mon);
  const dirty = w.status !== 'draft' && w.listDirty;
  const days = weekDays(mon).map((iso) => {
    const on = lunchOn(mon, iso);
    const opt = (slot) => {
      const cur = slotOf(mon, iso, slot);
      if (slot !== 'lunch') {
        return `<option value="">Не выбрано</option>` + dishesFor(slot).map((d) =>
          `<option value="${esc(d.name)}" ${d.name === cur ? 'selected' : ''}>${esc(d.emoji ? d.emoji + ' ' : '')}${esc(d.name)}</option>`).join('');
      }
      const lunches = dishes().filter((d) => d.type === 'lunch');
      const soups = dishes().filter((d) => d.type === 'soup');
      const o = (d) => `<option value="${esc(d.name)}" ${d.name === cur ? 'selected' : ''}>${esc(d.emoji ? d.emoji + ' ' : '')}${esc(d.name)}</option>`;
      return `<option value="">Не выбрано</option>
        <optgroup label="Обеды">${lunches.map(o).join('')}</optgroup>
        <optgroup label="Супы (на два дня)">${soups.map(o).join('')}</optgroup>`;
    };
    return `<div class="pl-day ${iso === today ? 'is-today' : ''}">
      <div class="pl-day-head"><strong>${esc(dayLabel(iso))}</strong>${iso === today ? '<span class="today-pill">сегодня</span>' : ''}</div>
      <label class="pl-slot"><span>Завтрак</span><select data-slot="breakfast" data-day="${iso}">${opt('breakfast')}</select></label>
      <div class="pl-slot">
        <label class="pl-toggle"><input type="checkbox" data-lunch-on="${iso}" ${on ? 'checked' : ''}> Обед</label>
        ${on ? `<select data-slot="lunch" data-day="${iso}">${opt('lunch')}</select>` : '<span class="muted">без обеда</span>'}
      </div>
      <label class="pl-slot"><span>Ужин</span><select data-slot="dinner" data-day="${iso}">${opt('dinner')}</select></label>
    </div>`;
  }).join('');

  const actions = w.status === 'bought'
    ? `<p class="note">Закупка этой недели уже сохранена.</p>`
    : w.status === 'confirmed'
      ? `${dirty ? `<div class="warn-box">Меню изменили после подтверждения. Обновите список покупок.</div>
         <button class="btn soft block" data-mact="refresh">Обновить список покупок</button>` : ''}`
      : `<button class="btn block" data-mact="confirm" ${count ? '' : 'disabled'}>Подтвердить меню и создать список покупок</button>
         <button class="btn soft block" data-mact="fill">Заполнить пустые случайно</button>`;

  return `
    <div class="pl-week-nav">
      <button class="icon-btn" data-mact="wk" data-d="-7" aria-label="Прошлая неделя">‹</button>
      <div class="pl-week-title"><strong>${esc(weekLabel(mon))}</strong>
        <span class="pill pill-${w.status}">${STATUS_RU[w.status]}</span></div>
      <button class="icon-btn" data-mact="wk" data-d="7" aria-label="Следующая неделя">›</button>
    </div>
    <p class="muted" style="margin:0 0 10px">Выбрано приёмов пищи: ${count} из 21. Обед можно отключить отдельно.</p>
    ${days}
    <div class="pl-actions">${actions}</div>`;
}

// ---------- вкладка «Покупки» ----------
function shopHtml() {
  const w = M().weeks[weekStart] || { status: 'draft' };
  if (w.status === 'draft' || !w.list) {
    return `<div class="card empty">Сначала подтвердите меню на неделю во вкладке «Неделя». Тогда здесь появится список покупок.</div>`;
  }
  const checked = w.checked || {};
  const done = w.list.filter((i) => checked[itemKey(i)]).length;
  const pct = w.list.length ? Math.round((done / w.list.length) * 100) : 0;
  const groups = {};
  for (const i of w.list) (groups[i.cat] = groups[i.cat] || []).push(i);
  const dirty = w.listDirty ? `<div class="warn-box">Меню изменилось после подтверждения. Обновите список, отметки сохранятся там, где продукты совпали.</div>` : '';
  const purchase = w.status === 'bought'
    ? `<div class="card"><div class="setting-title">Закупка сохранена</div><p class="note">Операция добавлена в «Финансы». Статистика — во вкладке «Статистика».</p></div>`
    : `<button class="btn block" data-mact="buy" ${done ? '' : 'disabled'}>Закупка сделана</button>
       ${done ? '' : '<p class="note" style="text-align:center">Отметьте купленное, чтобы сохранить закупку</p>'}`;

  return `
    ${dirty}
    <div class="shop-summary">
      <div class="row" style="justify-content:space-between"><div><div class="muted">Куплено</div><div class="big">${done} из ${w.list.length}</div></div>
        ${w.status === 'confirmed' ? `<button class="btn soft" data-mact="refresh">Пересчитать</button>` : ''}</div>
      <div class="bar"><div style="width:${pct}%"></div></div>
    </div>
    ${Object.keys(CATS).filter((c) => groups[c]).map((c) => `
      <div class="shop-card"><h3><span class="leg-dot" style="background:${CAT_COLOR[c]}"></span> ${esc(CATS[c])}</h3>
        ${groups[c].map((i) => `<label class="item ${checked[itemKey(i)] ? 'done' : ''}">
          <input type="checkbox" data-mcheck="${esc(itemKey(i))}" ${checked[itemKey(i)] ? 'checked' : ''}>
          <span class="box">✓</span>
          <span class="txt"><span class="nm">${esc(i.name)}</span><div class="qty">${esc(fmtQty(i.total, i.unit))}</div></span>
        </label>`).join('')}
      </div>`).join('')}
    ${purchase}`;
}

// ---------- вкладка «Статистика» ----------
function statsHtml() {
  const ym = statsMonth;
  const list = M().purchases.filter((p) => p.date.startsWith(ym));
  const prevYm = shiftMonth(ym, -1);
  const prevTotal = M().purchases.filter((p) => p.date.startsWith(prevYm)).reduce((a, p) => a + p.total, 0);
  const total = list.reduce((a, p) => a + p.total, 0);
  const byCat = {};
  for (const p of list) {
    if (p.items && p.items.length) for (const it of p.items) byCat[it.cat] = (byCat[it.cat] || 0) + it.price;
    else byCat.unsplit = (byCat.unsplit || 0) + p.total;
  }
  const weeks = {};
  for (const p of list) weeks[p.week] = (weeks[p.week] || 0) + p.total;
  const weekRows = Object.entries(weeks).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([mon, v]) => ({ label: weekLabel(mon), value: v }));
  const maxWeek = Math.max(0, ...weekRows.map((r) => r.value));
  const itemTotals = {};
  for (const p of list) for (const it of p.items || []) itemTotals[it.name] = (itemTotals[it.name] || 0) + it.price;
  const top = Object.entries(itemTotals).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const diff = prevTotal ? Math.round(((total - prevTotal) / prevTotal) * 100) : null;

  return `
    <div class="pl-week-nav">
      <button class="icon-btn" data-mact="month" data-d="-1" aria-label="Предыдущий месяц">‹</button>
      <div class="pl-week-title"><strong style="text-transform:capitalize">${esc(monthLabel(ym))}</strong></div>
      <button class="icon-btn" data-mact="month" data-d="1" aria-label="Следующий месяц">›</button>
    </div>
    ${list.length ? `
      <div class="grid-2" style="margin-bottom:12px">
        <div class="stat"><div class="lbl">Потрачено на продукты</div><div class="val">${esc(money(total))}</div>
          ${diff !== null ? `<div class="note">${diff >= 0 ? '+' : ''}${diff}% к прошлому месяцу</div>` : ''}</div>
        <div class="stat"><div class="lbl">Закупок</div><div class="val">${list.length}</div>
          <div class="note">в среднем ${esc(money(total / list.length))}</div></div>
      </div>
      <div class="card"><div class="setting-title">На что ушли деньги</div>
        <div class="donut-wrap">${donutSvg(byCat, total)}<div class="legend">${legendHtml(byCat, total)}</div></div></div>
      <div class="card"><div class="setting-title">По неделям</div>${barsHtml(weekRows, maxWeek)}</div>
      ${top.length ? `<div class="card"><div class="setting-title">Самые дорогие продукты</div>
        ${barsHtml(top.map(([label, value]) => ({ label, value })), top[0][1])}</div>` : ''}`
      : `<div class="card empty">За ${esc(monthLabel(ym))} закупок пока нет. После первой закупки здесь появятся диаграммы.</div>`}`;
}

// ---------- вкладка «Блюда» ----------
function libHtml() {
  const types = ['all', 'breakfast', 'lunch', 'soup', 'dinner'];
  const names = { all: 'Все', breakfast: 'Завтраки', lunch: 'Обеды', soup: 'Супы', dinner: 'Ужины' };
  const q = libQuery.trim().toLowerCase();
  const list = dishes().filter((d) => (libFilter === 'all' || d.type === libFilter) && (!q || d.name.toLowerCase().includes(q)));
  return `
    <div class="row" style="justify-content:space-between;margin-bottom:10px">
      <input id="lib-q" class="lib-search" placeholder="Поиск блюда" value="${esc(libQuery)}">
      <button class="btn" data-mact="dish-new">+ Блюдо</button></div>
    <div class="filters">${types.map((t) => `<button class="${t === libFilter ? 'active' : ''}" data-lfilter="${t}">${names[t]}</button>`).join('')}</div>
    <div class="dish-grid">${list.map((d) => `
      <button class="dish dish-btn" data-mact="dish-edit" data-name="${esc(d.name)}">
        <div class="e">${esc(d.emoji || '🍽')}</div>
        <div class="b"><div class="nm">${esc(d.name)}</div>
          <div class="ds">${esc(d.description || '')}</div>
          <div class="meta"><span class="chip ${d.type}">${esc(TYPE_RU[d.type] || d.type)}</span>
          <span class="muted">${d.ingredients.length} продуктов</span></div></div>
      </button>`).join('') || '<div class="card empty">Ничего не найдено</div>'}</div>`;
}

const TABS = [['week', 'Неделя'], ['shop', 'Покупки'], ['stats', 'Статистика'], ['lib', 'Блюда']];

export function plannerHtml() {
  if (!M()) return '<div class="card empty">Меню загружается…</div>';
  const tabs = `<div class="tabline">${TABS.map(([v, l]) => `<button class="${TAB === v ? 'active' : ''}" data-mtab="${v}">${l}</button>`).join('')}</div>`;
  const body = TAB === 'week' ? weekHtml() : TAB === 'shop' ? shopHtml() : TAB === 'stats' ? statsHtml() : libHtml();
  return tabs + body;
}

// Сводка на главной: блюда на сегодня.
export function plannerSummaryHtml() {
  if (!M()) return '';
  const today = ctx.todayIso();
  const mon = mondayOf(today);
  const w = M().weeks[mon];
  const rows = MEALS.map(([slot, title]) => {
    const name = w ? (w.days[today] || {})[slot] : '';
    if (slot === 'lunch' && w && (w.days[today] || {}).lunchOn === false) return '';
    const d = dishByName(name);
    return `<div class="li"><div class="main"><div class="t">${esc(d ? (d.emoji || '') + ' ' : '')}${esc(name || 'Не выбрано')}</div>
      <div class="s">${esc(title)}</div></div></div>`;
  }).join('');
  return `<div class="card">
    <div class="row" style="justify-content:space-between">
      <div><div class="setting-title" style="margin:0">Меню на сегодня</div>
      <div class="note">${esc(w ? STATUS_RU[w.status] : 'Неделя не запланирована')}</div></div>
      <button class="btn soft" data-act="sec" data-v="menu">Открыть меню</button></div>
    ${rows}</div>`;
}

// ---------- действия ----------
function confirmWeek() {
  const w = weekOf(weekStart);
  w.status = 'confirmed';
  w.list = aggregate(weekStart);
  w.checked = w.checked || {};
  w.listDirty = false;
  ctx.toast('Меню подтверждено, список покупок готов');
  TAB = 'shop';
}

function refreshList() {
  const w = weekOf(weekStart);
  const fresh = aggregate(weekStart);
  const keep = w.checked || {};
  w.list = fresh;
  w.checked = Object.fromEntries(fresh.filter((i) => keep[itemKey(i)]).map((i) => [itemKey(i), true]));
  w.listDirty = false;
  ctx.toast('Список обновлён');
}

function fillRandom() {
  const w = weekOf(weekStart);
  let filled = 0;
  for (const iso of weekDays(weekStart)) {
    w.days[iso] = w.days[iso] || {};
    for (const [slot] of MEALS) {
      if (slot === 'lunch' && w.days[iso].lunchOn === false) continue;
      if (w.days[iso][slot]) continue;
      const pool = dishesFor(slot);
      if (!pool.length) continue;
      w.days[iso][slot] = pool[Math.floor(Math.random() * pool.length)].name;
      filled++;
    }
  }
  ctx.toast(filled ? `Заполнено пустых мест: ${filled}` : 'Все места уже заполнены');
}

function openPurchase() {
  purchaseMode = 'sum';
  purchaseParsed = null;
  ctx.openModal(`Закупка · ${weekLabel(weekStart)}`, `
    <div class="tabline">
      <button class="active" data-pmode="sum">Указать сумму</button>
      <button data-pmode="file">Загрузить чек</button></div>
    <div id="p-pane"></div>`);
  bindPurchase();
}

function bindPurchase() {
  const root = document.querySelector('#modal-body');
  root.querySelectorAll('[data-pmode]').forEach((b) => {
    b.onclick = () => { purchaseMode = b.dataset.pmode; purchaseParsed = null; openPurchase(); };
  });
  root.querySelectorAll('[data-pmode]').forEach((b) => b.classList.toggle('active', b.dataset.pmode === purchaseMode));
  const pane = root.querySelector('#p-pane');
  const today = ctx.todayIso();
  if (purchaseMode === 'sum') {
    pane.innerHTML = `
      <div class="form">
        <label class="field" for="p-date">Дата</label><input id="p-date" type="date" value="${today}">
        <label class="field" for="p-store">Магазин</label><input id="p-store" placeholder="Например, Пятёрочка">
        <label class="field" for="p-total">Сумма, ₽</label><input id="p-total" inputmode="decimal" placeholder="0">
        <button class="btn block" id="p-save">Сохранить закупку</button>
      </div>`;
    pane.querySelector('#p-save').onclick = () => {
      const total = parseFloat(String(pane.querySelector('#p-total').value).replace(',', '.'));
      if (!total || total <= 0) return ctx.toast('Введите сумму');
      savePurchase({ date: pane.querySelector('#p-date').value || today, store: pane.querySelector('#p-store').value.trim(), total, items: [], method: 'sum' });
    };
    return;
  }
  pane.innerHTML = `
    <p class="muted" style="margin:0 0 10px">Загрузите чек файлом: PDF с текстом, CSV или TXT. Фото пока не распознаём.</p>
    <label class="btn soft block" style="cursor:pointer">Выбрать файл<input id="p-file" type="file" accept=".pdf,.csv,.txt,text/plain,application/pdf" class="hidden"></label>
    <div id="p-result"></div>`;
  pane.querySelector('#p-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const res = pane.querySelector('#p-result');
    res.innerHTML = '<p class="muted">Читаю чек…</p>';
    try {
      const lines = await readReceiptLines(file);
      purchaseParsed = parseReceiptLines(lines);
      if (!purchaseParsed.items.length) {
        res.innerHTML = '<div class="warn-box">Не нашёл позиций в файле. Попробуйте CSV или TXT, либо укажите сумму вручную.</div>';
        return;
      }
      res.innerHTML = receiptPreviewHtml(purchaseParsed, today);
      bindReceiptSave(res, today);
    } catch (err) {
      res.innerHTML = `<div class="warn-box">Не удалось прочитать файл: ${esc(err.message)}. Укажите сумму вручную.</div>`;
    }
  };
}

function receiptPreviewHtml(p, today) {
  const byCat = {};
  for (const it of p.items) byCat[it.cat] = (byCat[it.cat] || 0) + it.price;
  return `
    <div class="receipt-preview">
      <div class="donut-wrap">${donutSvg(byCat, p.total)}<div class="legend">${legendHtml(byCat, p.total)}</div></div>
      <div class="form" style="margin-top:12px">
        <label class="field" for="r-date">Дата</label><input id="r-date" type="date" value="${today}">
        <label class="field" for="r-store">Магазин</label><input id="r-store" placeholder="Например, Пятёрочка">
        <label class="field" for="r-total">Итог чека, ₽</label><input id="r-total" inputmode="decimal" value="${String(p.total).replace('.', ',')}">
      </div>
      <div class="sub-title">Позиции (${p.items.length})</div>
      <div class="receipt-items">${p.items.map((i) => `<div class="li">
        <div class="main"><div class="t">${esc(i.name)}</div><div class="s">${esc(CATS[i.cat] || i.cat)}</div></div>
        <div class="amt">${esc(money(i.price))}</div></div>`).join('')}</div>
      <button class="btn block" id="r-save">Сохранить закупку</button>
    </div>`;
}

function bindReceiptSave(res, today) {
  res.querySelector('#r-save').onclick = () => {
    const total = parseFloat(String(res.querySelector('#r-total').value).replace(',', '.'));
    if (!total || total <= 0) return ctx.toast('Введите итог чека');
    savePurchase({
      date: res.querySelector('#r-date').value || today,
      store: res.querySelector('#r-store').value.trim(),
      total, items: purchaseParsed.items, method: 'file'
    });
  };
}

function savePurchase({ date, store, total, items, method }) {
  const id = ctx.uid();
  const byCat = {};
  for (const it of items) byCat[it.cat] = (byCat[it.cat] || 0) + it.price;
  M().purchases.push({ id, week: weekStart, date, store, total, method, items, byCat });
  const w = weekOf(weekStart);
  w.status = 'bought';
  w.purchaseId = id;
  ctx.addTransaction({
    type: 'expense', amount: total, date, category: 'Продукты', account: '', personId: '', private: false,
    note: `Закупка: ${weekLabel(weekStart)}${store ? ' · ' + store : ''}`, fromPurchase: id
  });
  ctx.closeModal();
  ctx.toast('Закупка сохранена, операция добавлена');
  TAB = 'stats';
  statsMonth = date.slice(0, 7);
  ctx.render();
}

// ---------- библиотека блюд ----------
function dishFormHtml(d) {
  const ing = d ? d.ingredients : [];
  const catOpts = (cur) => Object.keys(CATS).filter((c) => c !== 'unsplit')
    .map((c) => `<option value="${c}" ${c === cur ? 'selected' : ''}>${esc(CATS[c])}</option>`).join('');
  const row = (i = { name: '', a: '', b: '', unit: 'г', cat: 'other' }) => `
    <div class="ing-row">
      <input data-f="name" placeholder="Продукт" value="${esc(i.name)}">
      <input data-f="a" inputmode="decimal" placeholder="мен." value="${i.a ?? ''}">
      <input data-f="b" inputmode="decimal" placeholder="бол." value="${i.b ?? ''}">
      <input data-f="unit" placeholder="ед." value="${esc(i.unit)}">
      <select data-f="cat">${catOpts(i.cat)}</select>
      <button class="icon-btn" data-rm aria-label="Убрать продукт">✕</button>
    </div>`;
  return `
    <div class="form">
      <label class="field" for="d-name">Название</label><input id="d-name" value="${esc(d ? d.name : '')}">
      <label class="field" for="d-type">Тип</label>
      <select id="d-type">${Object.entries(TYPE_RU).map(([v, l]) => `<option value="${v}" ${d && d.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label class="field" for="d-emoji">Эмодзи</label><input id="d-emoji" maxlength="4" value="${esc(d ? d.emoji || '' : '')}">
      <label class="field" for="d-desc">Описание</label><textarea id="d-desc" rows="2">${esc(d ? d.description || '' : '')}</textarea>
      <div class="sub-title">Продукты</div>
      <p class="setting-desc">«мен.» и «бол.» — количество для меньшей и большей порции. Если продукт на двоих, укажите половину в каждом поле.</p>
      <div id="ing-list">${ing.map((i) => row(i)).join('')}</div>
      <button class="btn soft" id="ing-add">+ Продукт</button>
      <div class="pill-row" style="margin-top:12px">
        <button class="btn block" id="d-save">Сохранить блюдо</button>
        ${d ? '<button class="btn danger" id="d-del">Удалить</button>' : ''}
      </div>
    </div>`;
}

function openDishForm(name) {
  const d = name ? dishByName(name) : null;
  ctx.openModal(d ? d.name : 'Новое блюдо', dishFormHtml(d));
  const root = document.querySelector('#modal-body');
  const list = root.querySelector('#ing-list');
  const newRow = () => {
    const tmp = document.createElement('div');
    tmp.innerHTML = `<div class="ing-row">
      <input data-f="name" placeholder="Продукт"><input data-f="a" inputmode="decimal" placeholder="мен.">
      <input data-f="b" inputmode="decimal" placeholder="бол."><input data-f="unit" placeholder="ед." value="г">
      <select data-f="cat">${Object.keys(CATS).filter((c) => c !== 'unsplit').map((c) => `<option value="${c}">${esc(CATS[c])}</option>`).join('')}</select>
      <button class="icon-btn" data-rm aria-label="Убрать продукт">✕</button></div>`;
    list.appendChild(tmp.firstElementChild);
    bindRm();
  };
  const bindRm = () => list.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => b.closest('.ing-row').remove(); });
  bindRm();
  root.querySelector('#ing-add').onclick = newRow;

  root.querySelector('#d-save').onclick = () => {
    const nm = root.querySelector('#d-name').value.trim();
    if (!nm) return ctx.toast('Введите название');
    const clash = dishByName(nm);
    if (clash && clash !== d) return ctx.toast('Блюдо с таким названием уже есть');
    const ingredients = [...list.querySelectorAll('.ing-row')].map((r) => {
      const g = (f) => r.querySelector(`[data-f="${f}"]`).value;
      const num = (v) => { const x = parseFloat(String(v).replace(',', '.')); return isNaN(x) ? 0 : x; };
      return { name: g('name').trim(), a: num(g('a')), b: num(g('b')), unit: g('unit').trim() || 'г', cat: g('cat') };
    }).filter((i) => i.name);
    const dish = {
      name: nm,
      type: root.querySelector('#d-type').value,
      emoji: root.querySelector('#d-emoji').value.trim(),
      description: root.querySelector('#d-desc').value.trim(),
      composition: d ? d.composition || '' : '',
      ingredients
    };
    if (d) Object.assign(d, dish); else dishes().push(dish);
    ctx.closeModal();
    ctx.toast('Блюдо сохранено');
    ctx.render();
  };
  const del = root.querySelector('#d-del');
  if (del) del.onclick = () => {
    if (!confirm(`Удалить «${d.name}»? Из запланированных дней оно пропадёт.`)) return;
    M().dishes = dishes().filter((x) => x !== d);
    for (const w of Object.values(M().weeks)) for (const day of Object.values(w.days || {})) {
      for (const k of Object.keys(day)) if (day[k] === d.name) day[k] = '';
    }
    ctx.closeModal();
    ctx.toast('Блюдо удалено');
    ctx.render();
  };
}

// ---------- привязка обработчиков ----------
export function plannerBind() {
  if (!M()) return;
  const root = document.querySelector('#main');
  root.querySelectorAll('[data-mtab]').forEach((b) => { b.onclick = () => { TAB = b.dataset.mtab; ctx.render(); }; });
  root.querySelectorAll('[data-mact]').forEach((b) => {
    b.onclick = () => {
      const a = b.dataset.mact;
      if (a === 'wk') { weekStart = addDays(weekStart, Number(b.dataset.d)); ctx.render(); }
      else if (a === 'confirm') { confirmWeek(); ctx.render(); }
      else if (a === 'refresh') { refreshList(); ctx.render(); }
      else if (a === 'fill') { fillRandom(); ctx.render(); }
      else if (a === 'buy') openPurchase();
      else if (a === 'month') { statsMonth = shiftMonth(statsMonth, Number(b.dataset.d)); ctx.render(); }
      else if (a === 'dish-new') openDishForm(null);
      else if (a === 'dish-edit') openDishForm(b.dataset.name);
    };
  });
  root.querySelectorAll('select[data-slot]').forEach((s) => {
    s.onchange = () => { setSlot(weekStart, s.dataset.day, s.dataset.slot, s.value); ctx.save(); ctx.render(); };
  });
  root.querySelectorAll('[data-lunch-on]').forEach((c) => {
    c.onchange = () => {
      const iso = c.dataset.lunchOn;
      const w = weekOf(weekStart);
      w.days[iso] = w.days[iso] || {};
      w.days[iso].lunchOn = c.checked;
      if (!c.checked) w.days[iso].lunch = '';
      if (w.status !== 'draft') w.listDirty = true;
      ctx.save(); ctx.render();
    };
  });
  root.querySelectorAll('[data-mcheck]').forEach((c) => {
    c.onchange = () => {
      const w = weekOf(weekStart);
      w.checked = w.checked || {};
      if (c.checked) w.checked[c.dataset.mcheck] = true; else delete w.checked[c.dataset.mcheck];
      ctx.save(); ctx.render();
    };
  });
  root.querySelectorAll('[data-lfilter]').forEach((b) => { b.onclick = () => { libFilter = b.dataset.lfilter; ctx.render(); }; });
  const q = root.querySelector('#lib-q');
  if (q) q.oninput = () => {
    libQuery = q.value;
    const pos = q.selectionStart;
    ctx.render();
    const again = document.querySelector('#lib-q');
    if (again) { again.focus(); again.setSelectionRange(pos, pos); }
  };
}
