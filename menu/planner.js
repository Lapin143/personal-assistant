// Планировщик меню: месяц вперёд, недели, списки покупок (запас на месяц и недельные), закупки, статистика, блюда.
// Данные: S.menu.dishes, S.menu.weeks[понедельник].days[дата], S.menu.months[YYYY-MM], S.menu.purchases.

const MEALS = [['breakfast', 'Завтрак'], ['lunch', 'Обед'], ['dinner', 'Ужин']];
const CATS = {
  meat: 'Мясо и рыба', dairy: 'Молочка и яйца', veg: 'Овощи и фрукты', grain: 'Крупы и макароны',
  bakery: 'Хлеб', pantry: 'Бакалея и специи', other: 'Прочее', unsplit: 'Без разбивки'
};
const CAT_COLOR = {
  meat: '#b5533c', dairy: '#e0a044', veg: '#4c8474', grain: '#c8a46a',
  bakery: '#9a7b5b', pantry: '#7a7fa6', other: '#8a8a8a', unsplit: '#c9c9c9'
};
// Товары длительного хранения покупаем один раз на месяц; остальное — еженедельно.
const LONG_CATS = ['grain', 'pantry'];
const isLong = (cat) => LONG_CATS.includes(cat);
const DAYS_RU = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const TYPE_RU = { breakfast: 'Завтрак', lunch: 'Обед', soup: 'Суп', dinner: 'Ужин' };

let ctx = null;
let TAB = 'plan';
let monthSel = '';
let statsMonth = '';
let libFilter = 'all';
let libQuery = '';
let purchaseMode = 'sum';
let purchaseParsed = null;
let PURCHASE = null;

// ---------- даты ----------
const pad = (n) => String(n).padStart(2, '0');
const toDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const toIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (iso, n) => { const d = toDate(iso); d.setDate(d.getDate() + n); return toIso(d); };
const mondayOf = (iso) => addDays(iso, -((toDate(iso).getDay() + 6) % 7));
const weekDays = (mon) => Array.from({ length: 7 }, (_, i) => addDays(mon, i));
const lastDayOf = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const monthDays = (ym) => Array.from({ length: lastDayOf(ym) }, (_, i) => `${ym}-${pad(i + 1)}`);
const monthWeeks = (ym) => {
  const out = [];
  let mon = mondayOf(`${ym}-01`);
  const end = `${ym}-${pad(lastDayOf(ym))}`;
  while (mon <= end) { out.push(mon); mon = addDays(mon, 7); }
  return out;
};
const weekDaysIn = (mon, ym) => weekDays(mon).filter((d) => d.startsWith(ym));
const shiftMonth = (ym, k) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + k, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const monthTitle = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }); };
const dayLabel = (iso) => { const d = toDate(iso); return `${DAYS_RU[d.getDay()]}, ${d.getDate()} ${MONTHS_RU[d.getMonth()]}`; };
const weekLabel = (mon) => { const a = toDate(mon); const b = toDate(addDays(mon, 6)); return `${a.getDate()} ${MONTHS_RU[a.getMonth()]} – ${b.getDate()} ${MONTHS_RU[b.getMonth()]}`; };
const esc = (s) => ctx.esc(s);
const money = (n) => ctx.money(n);

// ---------- количества ----------
function fmtQty(v, unit) {
  if (!v) return '';
  if (unit === 'г' && v >= 1000) return `${String((v / 1000).toFixed(2)).replace(/\.?0+$/, '').replace('.', ',')} кг`;
  if (unit === 'мл' && v >= 1000) return `${String((v / 1000).toFixed(2)).replace(/\.?0+$/, '').replace('.', ',')} л`;
  return `${String(Math.round(v * 10) / 10).replace('.', ',')} ${unit}`;
}
const itemKey = (i) => `${i.name.toLowerCase()}|${i.unit}`;
const packKeyOf = (name) => name.toLowerCase().trim();
const scopeObj = (scope) => (scope.startsWith('long:') ? monthRec(scope.slice(5)).long : weekOf(scope));
// Сколько упаковок купить: количество из списка переводится в единицы упаковки.
function packLine(i, q) {
  const p = (M().packs || {})[packKeyOf(i.name)];
  if (!p) return null;
  if (q <= 0) return { text: 'покупать не нужно' };
  let need = q;
  if (i.unit !== p.unit) {
    if (i.unit === 'ст. ложки' && p.gPerSpoon) need = q * p.gPerSpoon;
    else if (i.unit === 'ст. ложки') return { text: 'укажите вес одной ст. ложки', warn: true };
    else return { text: `упаковка в «${p.unit}», в меню «${i.unit}»`, warn: true };
  }
  const count = Math.ceil(need / p.size - 1e-9);
  return { text: `купить: ${count} ${p.packName} · ${fmtQty(p.size, p.unit)}` };
}
const keptQty = (old, items) => Object.fromEntries(Object.entries(old || {})
  .filter(([k]) => items.some((i) => itemKey(i) === k)));

// ---------- данные ----------
const M = () => ctx.S().menu;
const dishes = () => M().dishes;
const dishByName = (n) => dishes().find((d) => d.name === n);
const dishesFor = (slot) => dishes().filter((d) => (slot === 'breakfast' ? d.type === 'breakfast'
  : slot === 'dinner' ? d.type === 'dinner' : (d.type === 'lunch' || d.type === 'soup')));
const weekOf = (mon) => { M().weeks[mon] ||= { days: {}, status: 'draft' }; return M().weeks[mon]; };
const monthRec = (ym) => { M().months ||= {}; M().months[ym] ||= { status: 'draft', long: null }; return M().months[ym]; };
const monthConfirmed = (ym) => ((M().months || {})[ym] || {}).status === 'confirmed';
const dayOf = (iso) => (((M().weeks[mondayOf(iso)] || {}).days || {})[iso]) || {};
const on = (day, slot) => day[slot + 'On'] !== false;

function setDay(iso, patch) {
  const mon = mondayOf(iso);
  const w = weekOf(mon);
  w.days[iso] = { ...(w.days[iso] || {}), ...patch };
  const m = (M().months || {})[iso.slice(0, 7)];
  if (m && m.status === 'confirmed') m.dirty = true;
}

// Сумма продуктов по дням: a + b на приём; штучные продукты округляются вверх на каждый приём.
function aggregate(days, keep = () => true) {
  const map = new Map();
  for (const iso of days) {
    const day = dayOf(iso);
    for (const [slot] of MEALS) {
      if (!on(day, slot) || !day[slot]) continue;
      const d = dishByName(day[slot]);
      if (!d) continue;
      for (const ing of d.ingredients) {
        if (!keep(ing.cat)) continue;
        const key = itemKey(ing);
        const cur = map.get(key) || { name: ing.name, unit: ing.unit, cat: ing.cat, total: 0 };
        const need = (ing.a || 0) + (ing.b || 0);
        cur.total += ing.unit === 'шт' ? Math.ceil(need - 1e-9) : need;
        map.set(key, cur);
      }
    }
  }
  const order = Object.keys(CATS);
  return [...map.values()]
    .map((i) => ({ ...i, total: Math.round(i.total * 100) / 100 }))
    .sort((a, b) => (order.indexOf(a.cat) - order.indexOf(b.cat)) || a.name.localeCompare(b.name, 'ru'));
}

function mealsCount(ym) {
  let n = 0;
  for (const iso of monthDays(ym)) { const d = dayOf(iso); for (const [slot] of MEALS) if (on(d, slot) && d[slot]) n++; }
  return n;
}
function slotsCount(ym) {
  let n = 0;
  for (const iso of monthDays(ym)) { const d = dayOf(iso); for (const [slot] of MEALS) if (on(d, slot)) n++; }
  return n;
}

// Заполняет только пустые приёмы, которые отмечены как «едим дома».
function fillEmpty(ym) {
  let filled = 0;
  for (const iso of monthDays(ym)) {
    const w = weekOf(mondayOf(iso));
    const cur = { ...(w.days[iso] || {}) };
    for (const [slot] of MEALS) {
      if (!on(cur, slot) || cur[slot]) continue;
      const pool = dishesFor(slot);
      if (!pool.length) continue;
      cur[slot] = pool[Math.floor(Math.random() * pool.length)].name;
      filled++;
    }
    w.days[iso] = cur;
  }
  return filled;
}

// Недельный список: только дни подтверждённых месяцев, без товаров длительного хранения.
function weeklyItems(mon) {
  return aggregate(weekDays(mon).filter((d) => monthConfirmed(d.slice(0, 7))), (c) => !isLong(c));
}
const keptChecks = (oldChecked, items) => Object.fromEntries(Object.keys(oldChecked || {})
  .filter((k) => items.some((i) => itemKey(i) === k)).map((k) => [k, true]));

function confirmMonth(ym) {
  const m = monthRec(ym);
  m.status = 'confirmed';
  m.dirty = false;
  m.longBought = false;
  m.long = { items: aggregate(monthDays(ym), isLong), checked: {}, qty: {} };
  for (const mon of monthWeeks(ym)) {
    const w = weekOf(mon);
    if (w.status === 'bought') continue;
    w.status = 'confirmed';
    w.listDirty = false;
    w.list = weeklyItems(mon);
    w.checked = {};
    w.qty = {};
  }
}

function refreshMonth(ym) {
  const m = monthRec(ym);
  if (m.status !== 'confirmed') return;
  const longItems = aggregate(monthDays(ym), isLong);
  m.long = { items: longItems, checked: keptChecks((m.long || {}).checked, longItems), qty: keptQty((m.long || {}).qty, longItems) };
  m.dirty = false;
  for (const mon of monthWeeks(ym)) {
    const w = weekOf(mon);
    if (w.status === 'bought') continue;
    const items = weeklyItems(mon);
    w.list = items;
    w.checked = keptChecks(w.checked, items);
    w.qty = keptQty(w.qty, items);
    w.listDirty = false;
  }
}

// Возврат в черновик: меню можно снова редактировать. Записи о закупках в «Финансах» остаются,
// в меню статусы «куплено» сбрасываются.
function unlockMonth(ym) {
  const m = monthRec(ym);
  const weeks = monthWeeks(ym);
  m.status = 'draft';
  m.dirty = false;
  m.longBought = false;
  delete m.long;
  for (const mon of weeks) {
    const w = M().weeks[mon];
    if (!w || (w.status !== 'confirmed' && w.status !== 'bought')) continue;
    if (w.status === 'bought') { w.status = 'draft'; delete w.list; delete w.checked; delete w.qty; delete w.purchaseId; continue; }
    if (weekDays(mon).some((d) => monthConfirmed(d.slice(0, 7)))) { w.list = weeklyItems(mon); continue; }
    w.status = 'draft';
    delete w.list;
    delete w.checked;
    delete w.qty;
  }
  return null;
}

// ---------- разбор чеков (PDF, CSV, TXT, фото) ----------
const KW = [
  ['meat', /кур|говяд|свинин|фарш|мяс|рыб|форел|треск|лосос|филе|индейк|колбас|сосиск|горбуш/i],
  ['dairy', /молок|творог|сыр|йогурт|кефир|сметан|масл|яйц|сливк|ряжен|ряженк/i],
  ['bakery', /хлеб|батон|булк|лаваш|бублик|багет/i],
  ['grain', /рис|гречк|овся|макарон|лапш|круп|мюсли|горох|гранол|пшен|перлов/i],
  ['veg', /картоф|лук|морков|помидор|томат|огурц|перец|капуст|свекл|свёкл|яблок|банан|лимон|ягод|зелен|фрукт|овощ|укроп|петруш|чеснок|апельс|мандар|груш|салат|брокк|кабач|баклаж/i],
  ['pantry', /соус|специ|соль|сахар|мука|уксус|карри|паста|мёд|мед|орех|чай|кофе|какао|консерв|кокос|горчиц/i]
];
const guessCat = (name) => (KW.find(([, re]) => re.test(name)) || [null])[0] || 'other';

export function parseReceiptLines(lines) {
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

const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.Tesseract) return res();
    const s = document.createElement('script');
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error('не удалось загрузить распознавание'));
    document.head.appendChild(s);
  });
}
// Фото чека распознаём на устройстве (Tesseract, русский и английский).
async function ocrLines(file) {
  await loadScript(TESS_URL);
  const { data } = await window.Tesseract.recognize(file, 'rus+eng');
  return data.text.split(/\r?\n/);
}

export async function readReceiptLines(file) {
  if (/\.(jpe?g|png|webp)$/i.test(file.name) || /^image\//.test(file.type)) return ocrLines(file);
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

// ---------- диаграммы ----------
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

// ---------- вкладка «План» ----------
function dishOptions(slot, cur) {
  return `<option value="">Не выбрано</option>` + dishesFor(slot).map((d) =>
    `<option value="${esc(d.name)}" ${d.name === cur ? 'selected' : ''}>${esc(d.emoji ? d.emoji + ' ' : '')}${esc(d.name)}</option>`).join('');
}
function lunchOptions(cur) {
  const o = (d) => `<option value="${esc(d.name)}" ${d.name === cur ? 'selected' : ''}>${esc(d.emoji ? d.emoji + ' ' : '')}${esc(d.name)}</option>`;
  return `<option value="">Не выбрано</option>
    <optgroup label="Обеды">${dishes().filter((d) => d.type === 'lunch').map(o).join('')}</optgroup>
    <optgroup label="Супы (на два дня)">${dishes().filter((d) => d.type === 'soup').map(o).join('')}</optgroup>`;
}

function dayRow(iso, locked) {
  const day = dayOf(iso);
  const slots = MEALS.map(([slot, title]) => {
    const isOn = on(day, slot);
    return `<div class="pl-slot">
      <label class="pl-toggle"><input type="checkbox" data-on="${slot}" data-day="${iso}" ${isOn ? 'checked' : ''}> ${title}: едим дома</label>
      ${isOn ? `<select data-slot="${slot}" data-day="${iso}">${slot === 'lunch' ? lunchOptions(day.lunch || '') : dishOptions(slot, day[slot] || '')}</select>`
        : '<span class="muted">не едим дома, продукты не считаются</span>'}</div>`;
  }).join('');
  return `<div class="pl-day ${iso === ctx.todayIso() ? 'is-today' : ''}">
    <div class="pl-day-head"><strong>${esc(dayLabel(iso))}</strong>${iso === ctx.todayIso() ? '<span class="today-pill">сегодня</span>' : ''}</div>
    ${slots}</div>`;
}

function weekDetails(mon, ym) {
  const w = M().weeks[mon] || {};
  const days = weekDaysIn(mon, ym);
  const filled = days.reduce((a, iso) => a + MEALS.filter(([s]) => on(dayOf(iso), s) && dayOf(iso)[s]).length, 0);
  const slots = days.reduce((a, iso) => a + MEALS.filter(([s]) => on(dayOf(iso), s)).length, 0);
  const open = weekDays(mon).includes(ctx.todayIso()) ? 'open' : '';
  return `<details class="pl-week" ${open}>
    <summary><span>Неделя ${esc(weekLabel(mon))}</span>
      <span class="note">${filled} из ${slots}${w.status === 'bought' ? ' · куплено' : ''}</span></summary>
    ${days.map((iso) => dayRow(iso, w.status === 'bought')).join('')}</details>`;
}

function planHtml() {
  const ym = monthSel;
  const m = monthRec(ym);
  const weeks = monthWeeks(ym);
  const filled = mealsCount(ym);
  const slots = slotsCount(ym);
  const bought = weeks.some((mon) => (M().weeks[mon] || {}).status === 'bought') || m.longBought;
  const status = m.status === 'confirmed'
    ? `<span class="pill pill-confirmed">Подтверждён</span>` : '<span class="pill pill-draft">Черновик</span>';
  const actions = m.status === 'confirmed'
    ? `${m.dirty ? `<div class="warn-box">Меню изменили после подтверждения. Обновите списки покупок.</div>
         <button class="btn soft block" data-mact="refresh" data-ym="${ym}">Обновить списки</button>` : ''}
       <p class="note">Месяц подтверждён: списки созданы во вкладке «Покупки».${bought ? ' Закупки уже учтены в «Финансах»: при возврате записи там останутся.' : ''}</p>
       <button class="btn soft block" data-mact="unlock" data-ym="${ym}">Вернуть в черновик</button>`
    : `<button class="btn soft block" data-mact="fill" data-ym="${ym}">Заполнить пустые дни</button>
       <button class="btn block" data-mact="confirm-month" data-ym="${ym}" ${filled ? '' : 'disabled'}>Подтвердить месяц и создать списки</button>
       <p class="note">Автозаполнение берёт блюда из библиотеки. Снимите «едим дома» там, где не будете есть дома, и заполните только остальное.</p>`;
  return `<div class="pl-week-nav">
      <button class="icon-btn" data-mact="month" data-d="-1" aria-label="Предыдущий месяц">‹</button>
      <div class="pl-week-title"><strong style="text-transform:capitalize">${esc(monthTitle(ym))}</strong>${status}</div>
      <button class="icon-btn" data-mact="month" data-d="1" aria-label="Следующий месяц">›</button></div>
    <p class="muted" style="margin:0 0 10px">Заполнено приёмов: ${filled} из ${slots}</p>
    ${weeks.map((mon) => weekDetails(mon, ym)).join('')}
    <div class="pl-actions">${actions}</div>`;
}

// ---------- вкладка «Покупки» ----------
function purchaseBtn(label, target) {
  return `<button class="btn block" data-mact="${target.act}" ${target.attrs}>${label}</button>`;
}

function checksList(scope, items, checked, qty = {}) {
  return items.map((i) => {
    const k = itemKey(i);
    const q = qty[k] ?? i.total;
    const done = !!checked[k];
    const pl = packLine(i, q);
    const hasPack = !!(M().packs || {})[packKeyOf(i.name)];
    return `<div class="item-row">
    <label class="item ${done ? 'done' : ''}">
      <input type="checkbox" data-mcheck="${esc(k)}" data-scope="${esc(scope)}" ${done ? 'checked' : ''}>
      <span class="box">✓</span>
      <span class="txt"><span class="nm">${esc(i.name)}</span>
        ${pl ? `<div class="qty ${pl.warn ? 'warn' : ''}">${esc(pl.text)}</div>` : ''}</span>
    </label>
    <div class="item-tools">
      <input type="number" class="qin" inputmode="decimal" step="any" min="0" value="${q}" data-qty="${esc(k)}" data-scope="${esc(scope)}" aria-label="Количество: ${esc(i.name)}">
      <span class="qunit">${esc(i.unit)}</span>
      <button class="pack-btn" data-pack="${esc(i.name)}" data-unit="${esc(i.unit)}">${hasPack ? 'упаковка' : '+ упаковка'}</button>
    </div></div>`;
  }).join('');
}

let SHOP_TAB = null;
// Закупаемся в воскресенье перед неделей меню.
const shopDayOf = (mon) => addDays(mon, -1);
const dmy = (iso) => { const [, m, d] = iso.split('-'); return `${d}.${m}`; };

function longCardHtml(ym, m) {
  const longItems = (m.long && m.long.items) || [];
  const longChecked = (m.long && m.long.checked) || {};
  const longGroups = {};
  for (const i of longItems) (longGroups[i.cat] = longGroups[i.cat] || []).push(i);
  return `<div class="shop-card">
    <h3>Запас на месяц · покупаем один раз</h3>
    ${m.dirty ? '<div class="warn-box">Меню изменили: обновите списки во вкладке «План».</div>' : ''}
    ${m.longBought ? '<p class="note">Запас куплен и сохранён в операции.</p>'
      : `${longItems.length ? Object.keys(CATS).filter((c) => longGroups[c]).map((c) => `
          <div class="sub-title"><span class="leg-dot" style="background:${CAT_COLOR[c]}"></span> ${esc(CATS[c])}</div>
          ${checksList(`long:${ym}`, longGroups[c], longChecked, (m.long && m.long.qty) || {})}`).join('')
        : '<div class="empty">В меню нет товаров длительного хранения</div>'}
      ${longItems.length ? `<div style="margin-top:12px">${purchaseBtn('Запас куплен', { act: 'buy-long', attrs: `data-ym="${ym}"` })}</div>` : ''}`}
  </div>`;
}

function weekCardHtml(mon, w) {
  const checked = w.checked || {};
  const groups = {};
  for (const i of w.list) (groups[i.cat] = groups[i.cat] || []).push(i);
  const bought = w.status === 'bought';
  return `<div class="shop-card">
      <div class="row" style="justify-content:space-between">
        <h3 style="margin:0">Неделя ${esc(weekLabel(mon))}</h3>
        <span class="pill ${bought ? 'pill-bought' : 'pill-confirmed'}">${bought ? 'Куплено' : 'Ожидает закупки'}</span></div>
      <p class="note" style="margin:4px 0 0">Закупка в воскресенье ${dmy(shopDayOf(mon))}</p>
      ${w.listDirty ? '<div class="warn-box">Меню этой недели изменили. Обновите списки во вкладке «План».</div>' : ''}
      ${w.list.length ? Object.keys(CATS).filter((c) => groups[c]).map((c) => `
        <div class="sub-title"><span class="leg-dot" style="background:${CAT_COLOR[c]}"></span> ${esc(CATS[c])}</div>
        ${checksList(mon, groups[c], checked, w.qty || {})}`).join('')
        : '<div class="empty">На эту неделю продуктов нет</div>'}
      ${bought ? '' : `<div style="margin-top:12px">${purchaseBtn('Закупка сделана', { act: 'buy-week', attrs: `data-mon="${mon}"` })}</div>`}
    </div>`;
}

// Списки покупок переключаются вкладками: запас на месяц и по одной вкладке на неделю.
function shopHtml() {
  const ym = monthSel;
  const m = monthRec(ym);
  if (m.status !== 'confirmed') {
    return `<div class="card empty">Сначала подтвердите месяц во вкладке «План». Тогда появятся списки: запас на месяц и по одному списку на каждую неделю.</div>`;
  }
  const cards = [{ id: 'long', label: 'Запас', html: longCardHtml(ym, m) }];
  for (const mon of monthWeeks(ym)) {
    const w = M().weeks[mon] || {};
    if (!w.list) continue;
    cards.push({ id: mon, label: `${w.status === 'bought' ? '✓ ' : ''}Вс ${dmy(shopDayOf(mon))}`, html: weekCardHtml(mon, w) });
  }
  const today = ctx.todayIso();
  const todayWeek = cards.find((c) => c.id !== 'long' && weekDays(c.id).includes(today));
  const activeId = cards.some((c) => c.id === SHOP_TAB) ? SHOP_TAB : (todayWeek || cards[0]).id;
  const active = cards.find((c) => c.id === activeId);
  const tabs = `<div class="shop-tabs" role="tablist">${cards.map((c) => `<button role="tab" aria-selected="${c.id === activeId}" class="${c.id === activeId ? 'active' : ''}" data-stab="${esc(c.id)}">${esc(c.label)}</button>`).join('')}</div>`;
  return tabs + '<p class="note" style="margin:8px 2px">Количество можно поправить прямо в списке. Очистите поле, чтобы вернуть расчёт по меню.</p>' + active.html;
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
  const groups = {};
  for (const p of list) {
    const key = p.kind === 'long' ? `long|${p.ym}` : p.week;
    groups[key] = (groups[key] || 0) + p.total;
  }
  const rows = Object.entries(groups).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => ({
    label: k.startsWith('long|') ? 'Запас на месяц' : weekLabel(k), value: v
  }));
  const maxRow = Math.max(0, ...rows.map((r) => r.value));
  const itemTotals = {};
  for (const p of list) for (const it of p.items || []) itemTotals[it.name] = (itemTotals[it.name] || 0) + it.price;
  const top = Object.entries(itemTotals).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const diff = prevTotal ? Math.round(((total - prevTotal) / prevTotal) * 100) : null;
  return `
    <div class="pl-week-nav">
      <button class="icon-btn" data-mact="stats-month" data-d="-1" aria-label="Предыдущий месяц">‹</button>
      <div class="pl-week-title"><strong style="text-transform:capitalize">${esc(monthTitle(ym))}</strong></div>
      <button class="icon-btn" data-mact="stats-month" data-d="1" aria-label="Следующий месяц">›</button>
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
      <div class="card"><div class="setting-title">По закупкам</div>${barsHtml(rows, maxRow)}</div>
      ${top.length ? `<div class="card"><div class="setting-title">Самые дорогие продукты</div>
        ${barsHtml(top.map(([label, value]) => ({ label, value })), top[0][1])}</div>` : ''}`
      : `<div class="card empty">За ${esc(monthTitle(ym))} закупок пока нет. После первой закупки здесь появятся диаграммы.</div>`}`;
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

const TABS = [['plan', 'План'], ['shop', 'Покупки'], ['stats', 'Статистика'], ['lib', 'Блюда']];

export function plannerHtml() {
  if (!M()) return '<div class="card empty">Меню загружается…</div>';
  const tabs = `<div class="tabline">${TABS.map(([v, l]) => `<button class="${TAB === v ? 'active' : ''}" data-mtab="${v}">${l}</button>`).join('')}</div>`;
  const body = TAB === 'plan' ? planHtml() : TAB === 'shop' ? shopHtml() : TAB === 'stats' ? statsHtml() : libHtml();
  return tabs + body;
}

// Сводка на главной: блюда на сегодня.
export function plannerSummaryHtml() {
  if (!M()) return '';
  const today = ctx.todayIso();
  const w = M().weeks[mondayOf(today)];
  const day = dayOf(today);
  const rows = MEALS.map(([slot, title]) => {
    if (!on(day, slot)) return `<div class="li"><div class="main"><div class="t muted">Дома не едим</div><div class="s">${esc(title)}</div></div></div>`;
    const d = dishByName(day[slot]);
    return `<div class="li"><div class="main"><div class="t">${esc(d ? (d.emoji || '') + ' ' : '')}${esc(day[slot] || 'Не выбрано')}</div>
      <div class="s">${esc(title)}</div></div></div>`;
  }).join('');
  return `<div class="card">
    <div class="row" style="justify-content:space-between">
      <div><div class="setting-title" style="margin:0">Меню на сегодня</div>
      <div class="note">${esc(w ? (w.status === 'confirmed' ? 'Подтверждено' : w.status === 'bought' ? 'Куплено' : 'Черновик') : 'Не запланировано')}</div></div>
      <button class="btn soft" data-act="sec" data-v="menu">Открыть меню</button></div>
    ${rows}</div>`;
}

// ---------- закупки ----------
function openPurchase(target) {
  PURCHASE = target;
  purchaseMode = 'sum';
  purchaseParsed = null;
  ctx.openModal(`Закупка · ${target.label}`, `
    <div class="tabline">
      <button class="active" data-pmode="sum">Указать сумму</button>
      <button data-pmode="file">Загрузить чек</button></div>
    <div id="p-pane"></div>`);
  bindPurchase();
}

function bindPurchase() {
  const root = document.querySelector('#modal-body');
  const today = ctx.todayIso();
  // Для недельной закупки по умолчанию — воскресенье перед неделей.
  const defDate = PURCHASE && PURCHASE.kind === 'week' ? shopDayOf(PURCHASE.mon) : today;
  root.querySelectorAll('[data-pmode]').forEach((b) => {
    b.classList.toggle('active', b.dataset.pmode === purchaseMode);
    b.onclick = () => { purchaseMode = b.dataset.pmode; purchaseParsed = null; openPurchase(PURCHASE); };
  });
  const pane = root.querySelector('#p-pane');
  if (purchaseMode === 'sum') {
    pane.innerHTML = `
      <div class="form">
        <label class="field" for="p-date">Дата</label><input id="p-date" type="date" value="${defDate}">
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
    <p class="muted" style="margin:0 0 10px">Загрузите чек: PDF с текстом, CSV, TXT или фото (JPG, PNG). Фото распознаются на устройстве и могут ошибаться.</p>
    <label class="btn soft block" style="cursor:pointer">Выбрать файл<input id="p-file" type="file" accept=".pdf,.csv,.txt,.jpg,.jpeg,.png,.webp,text/plain,application/pdf,image/*" class="hidden"></label>
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
        res.innerHTML = '<div class="warn-box">Не нашёл позиций. Попробуйте CSV или TXT, либо укажите сумму вручную.</div>';
        return;
      }
      res.innerHTML = receiptPreviewHtml(purchaseParsed, defDate);
      res.querySelector('#r-save').onclick = () => {
        const total = parseFloat(String(res.querySelector('#r-total').value).replace(',', '.'));
        if (!total || total <= 0) return ctx.toast('Введите итог чека');
        savePurchase({ date: res.querySelector('#r-date').value || today, store: res.querySelector('#r-store').value.trim(),
          total, items: purchaseParsed.items, method: 'file' });
      };
    } catch (err) {
      res.innerHTML = `<div class="warn-box">Не удалось прочитать файл: ${esc(err.message)}. Укажите сумму вручную.</div>`;
    }
  };
}

function receiptPreviewHtml(p, defDate) {
  const byCat = {};
  for (const it of p.items) byCat[it.cat] = (byCat[it.cat] || 0) + it.price;
  return `
    <div class="receipt-preview">
      <div class="donut-wrap">${donutSvg(byCat, p.total)}<div class="legend">${legendHtml(byCat, p.total)}</div></div>
      <div class="form" style="margin-top:12px">
        <label class="field" for="r-date">Дата</label><input id="r-date" type="date" value="${defDate}">
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

function savePurchase({ date, store, total, items, method }) {
  const t = PURCHASE;
  const id = ctx.uid();
  const byCat = {};
  for (const it of items) byCat[it.cat] = (byCat[it.cat] || 0) + it.price;
  const week = t.kind === 'week' ? t.mon : mondayOf(`${t.ym}-01`);
  M().purchases ||= [];
  M().purchases.push({ id, kind: t.kind, week, ym: t.kind === 'long' ? t.ym : null, date, store, total, method, items, byCat });
  if (t.kind === 'week') {
    const w = weekOf(t.mon);
    w.status = 'bought';
    w.purchaseId = id;
  } else {
    monthRec(t.ym).longBought = true;
  }
  ctx.addTransaction({
    type: 'expense', amount: total, date, category: 'Продукты', account: '', personId: '', private: false,
    note: `Закупка: ${t.label}${store ? ' · ' + store : ''}`, fromPurchase: id
  });
  ctx.log?.(`Закупка ${money(total)}${store ? ' · ' + store : ''}`);
  ctx.closeModal();
  ctx.toast('Закупка сохранена, операция добавлена');
  TAB = 'stats';
  statsMonth = date.slice(0, 7);
  ctx.render();
}

// ---------- упаковки ----------
function openPackForm(name, unit) {
  const key = packKeyOf(name);
  const p = (M().packs || {})[key] || {};
  const units = [...new Set(['г', 'мл', 'шт', unit, p.unit].filter(Boolean))];
  ctx.openModal(`Упаковка · ${name}`, `
    <p class="setting-desc">Продукты покупаем упаковками. Список покажет, сколько упаковок купить.</p>
    <div class="pk-field"><span>Название упаковки</span>
      <input id="pk-name" value="${esc(p.packName || 'упаковка')}"></div>
    <div class="pk-field"><span>Вес или объём одной упаковки</span>
      <div class="pk-row"><input id="pk-size" inputmode="decimal" placeholder="например 1000" value="${p.size ?? ''}">
      <select id="pk-unit">${units.map((u) => `<option value="${esc(u)}" ${(p.unit || unit) === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></div></div>
    <div class="pk-field"><span>Вес одной ст. ложки, г (нужен, если в рецепте ложки)</span>
      <input id="pk-spoon" inputmode="decimal" placeholder="например 15" value="${p.gPerSpoon ?? ''}"></div>
    <p class="setting-desc">Оставьте вес пустым, чтобы убрать упаковку.</p>
    <div style="margin-top:12px"><button class="btn block" id="pk-save">Сохранить</button></div>`);
  document.querySelector('#pk-save').onclick = () => {
    const num = (v) => { const x = parseFloat(String(v).replace(',', '.')); return isNaN(x) ? 0 : x; };
    const size = num(document.querySelector('#pk-size').value);
    M().packs ||= {};
    if (size <= 0) delete M().packs[key];
    else {
      M().packs[key] = {
        packName: document.querySelector('#pk-name').value.trim() || 'упаковка',
        size,
        unit: document.querySelector('#pk-unit').value,
        gPerSpoon: num(document.querySelector('#pk-spoon').value) || null
      };
    }
    ctx.closeModal();
    ctx.toast('Упаковка сохранена');
    ctx.render();
  };
}

// ---------- библиотека блюд ----------
function dishFormHtml(d) {
  const ing = d ? d.ingredients : [];
  const catOpts = (cur) => Object.keys(CATS).filter((c) => c !== 'unsplit')
    .map((c) => `<option value="${c}" ${c === cur ? 'selected' : ''}>${esc(CATS[c])}</option>`).join('');
  const row = (i) => `
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
      <p class="setting-desc">«мен.» и «бол.» — количество для меньшей и большей порции. Штучные продукты («шт») не переносятся на следующий день: половинки в одном приёме округляются до целой штуки.</p>
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
  const bindRm = () => list.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => b.closest('.ing-row').remove(); });
  bindRm();
  root.querySelector('#ing-add').onclick = () => {
    const tmp = document.createElement('div');
    tmp.innerHTML = `<div class="ing-row">
      <input data-f="name" placeholder="Продукт"><input data-f="a" inputmode="decimal" placeholder="мен.">
      <input data-f="b" inputmode="decimal" placeholder="бол."><input data-f="unit" placeholder="ед." value="г">
      <select data-f="cat">${Object.keys(CATS).filter((c) => c !== 'unsplit').map((c) => `<option value="${c}">${esc(CATS[c])}</option>`).join('')}</select>
      <button class="icon-btn" data-rm aria-label="Убрать продукт">✕</button></div>`;
    list.appendChild(tmp.firstElementChild);
    bindRm();
  };
  root.querySelector('#d-save').onclick = () => {
    const nm = root.querySelector('#d-name').value.trim();
    if (!nm) return ctx.toast('Введите название');
    const clash = dishByName(nm);
    if (clash && clash !== d) return ctx.toast('Блюдо с таким названием уже есть');
    const num = (v) => { const x = parseFloat(String(v).replace(',', '.')); return isNaN(x) ? 0 : x; };
    const ingredients = [...list.querySelectorAll('.ing-row')].map((r) => {
      const g = (f) => r.querySelector(`[data-f="${f}"]`).value;
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

// ---------- инициализация и обработчики ----------
export function plannerInit(context) {
  ctx = context;
  monthSel = ctx.todayIso().slice(0, 7);
  statsMonth = monthSel;
  if (M()) M().months ||= {};
}

function act(b) {
  const a = b.dataset.mact;
  const ym = b.dataset.ym;
  if (a === 'month') monthSel = shiftMonth(monthSel, Number(b.dataset.d));
  else if (a === 'stats-month') statsMonth = shiftMonth(statsMonth, Number(b.dataset.d));
  else if (a === 'fill') {
    const n = fillEmpty(ym);
    ctx.toast(n ? `Заполнено мест: ${n}` : 'Все места уже заполнены');
  }
  else if (a === 'confirm-month') { confirmMonth(ym); ctx.toast('Месяц подтверждён, списки созданы'); TAB = 'shop'; }
  else if (a === 'refresh') { refreshMonth(ym); ctx.toast('Списки обновлены'); }
  else if (a === 'unlock') { const err = unlockMonth(ym); ctx.toast(err || 'Месяц снова в черновике: можно редактировать'); }
  else if (a === 'buy-week') { openPurchase({ kind: 'week', mon: b.dataset.mon, label: weekLabel(b.dataset.mon) }); return; }
  else if (a === 'buy-long') { openPurchase({ kind: 'long', ym, label: `запас на ${monthTitle(ym)}` }); return; }
  else if (a === 'dish-new') { openDishForm(null); return; }
  else if (a === 'dish-edit') { openDishForm(b.dataset.name); return; }
  ctx.render();
}

export function plannerBind() {
  if (!M()) return;
  const root = document.querySelector('#main');
  root.querySelectorAll('[data-mtab]').forEach((b) => { b.onclick = () => { TAB = b.dataset.mtab; ctx.render(); }; });
  root.querySelectorAll('[data-mact]').forEach((b) => { b.onclick = () => act(b); });
  root.querySelectorAll('[data-stab]').forEach((b) => { b.onclick = () => { SHOP_TAB = b.dataset.stab; ctx.render(); }; });
  root.querySelectorAll('select[data-slot]').forEach((s) => {
    s.onchange = () => { setDay(s.dataset.day, { [s.dataset.slot]: s.value }); ctx.render(); };
  });
  root.querySelectorAll('input[data-on]').forEach((c) => {
    c.onchange = () => {
      const slot = c.dataset.on;
      setDay(c.dataset.day, c.checked ? { [slot + 'On']: true } : { [slot]: '', [slot + 'On']: false });
      ctx.render();
    };
  });
  root.querySelectorAll('[data-mcheck]').forEach((c) => {
    c.onchange = () => {
      const scope = c.dataset.scope;
      const obj = scopeObj(scope);
      obj.checked = obj.checked || {};
      if (c.checked) obj.checked[c.dataset.mcheck] = true; else delete obj.checked[c.dataset.mcheck];
      ctx.render();
    };
  });
  root.querySelectorAll('[data-qty]').forEach((inp) => {
    inp.onchange = () => {
      const obj = scopeObj(inp.dataset.scope);
      obj.qty = obj.qty || {};
      const v = parseFloat(String(inp.value).replace(',', '.'));
      if (inp.value.trim() === '' || isNaN(v)) delete obj.qty[inp.dataset.qty];
      else obj.qty[inp.dataset.qty] = Math.max(0, Math.round(v * 100) / 100);
      ctx.render();
    };
  });
  root.querySelectorAll('[data-pack]').forEach((b) => { b.onclick = () => openPackForm(b.dataset.pack, b.dataset.unit); });
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
