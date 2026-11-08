// Новые разделы «Ассистента»: бюджет и лимиты, прогноз, подушка безопасности, ежегодные платежи,
// чеки (PDF, CSV, TXT, фото), голосовой ввод, списки, идеи и поездки, подарки, шаги, лента и отчёт.
// Модуль не знает о DOM приложения напрямую: всё нужное передаётся через featuresInit(ctx).
import { upcoming, addDays } from './core.js';
import { readReceiptLines, parseReceiptLines } from './menu/planner.js?v=b2';

let F = null;
const S = () => F.S();
const me = () => F.me();
const esc = (s) => F.esc(s);
const money = (n) => F.money(n);
const uid = () => F.uid();
const today = () => F.todayIso();
const svg = (name, size = 18) => F.svg(name, size);
const X = () => svg('x', 18);
const personName = (id) => ((S().people || []).find((p) => p.id === id) || {}).name || '';
const fmtDate = (s) => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}.${m}.${y}`; };
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const monthTitle = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }); };
const shiftYm = (ym, k) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + k, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const lastDay = (y, m) => new Date(y, m, 0).getDate();
const personOptsReal = () => S().people.map((p) => [p.id, p.name]);
const catOpts = () => S().categories.expense.map((c) => [c, c]);
const sumExp = (list) => list.filter((t) => t.type !== 'income').reduce((a, t) => a + (Number(t.amount) || 0), 0);
const sumInc = (list) => list.filter((t) => t.type === 'income').reduce((a, t) => a + (Number(t.amount) || 0), 0);
// Личные операции партнёра не показываем: в расчётах видны только общие и свои.
const visible = () => S().transactions.filter((t) => !t.private || t.personId === me());

export function logEvent(text) {
  const s = S();
  s.log.unshift({ id: uid(), at: Date.now(), personId: me(), text });
  if (s.log.length > 200) s.log.length = 200;
}

export function featuresInit(ctx) { F = ctx; }

// Гарантирует наличие новых полей в данных (для старых сохранений и импорта).
export function ensureData(s) {
  s.budgets ||= {};
  s.allowances ||= {};
  s.yearly ||= [];
  s.lists ||= [];
  s.ideas ||= [];
  s.gifts ||= [];
  s.steps ||= [];
  s.log ||= [];
  s.cushion ||= { months: 3, saved: 0 };
  s.confirmed ||= {};
}

// ---------- категории из текста (голос, чеки) ----------
const HINTS = [
  [/продукт|магазин|супермаркет|пят[её]роч|перекрест|магнит|ашан|лента|вкусвилл|азбук/i, 'Продукты'],
  [/такси|бензин|топлив|метро|парковк|проезд|заправ/i, 'Транспорт'],
  [/кафе|ресторан|кино|театр|доставк|развлеч/i, 'Развлечения'],
  [/аптек|лекарств|врач|клиник|анализ/i, 'Здоровье'],
  [/одежд|обув|куртк/i, 'Одежда'],
  [/подарок|подарк/i, 'Подарки'],
  [/коммунал|квартплат|жкх|электр|водоканал|отоплен/i, 'Коммуналка'],
  [/интернет|связь|телефон|подписк|стриминг/i, 'Связь и подписки'],
  [/аренд|ипотек/i, 'Жильё']
];

export function categoryFromText(text) {
  const t = String(text || '');
  const cats = S().categories.expense;
  const hit = HINTS.find(([re]) => re.test(t));
  if (hit && cats.includes(hit[1])) return hit[1];
  return cats.find((c) => t.toLowerCase().includes(c.toLowerCase())) || 'Прочее';
}

// «потратил 850 на продукты» → сумма, категория, комментарий.
export function parseSpoken(text) {
  const t = String(text || '').replace(/ /g, ' ').trim();
  const m = t.match(/(\d[\d ]*(?:[.,]\d+)?)/);
  const amount = m ? parseFloat(m[1].replace(/ /g, '').replace(',', '.')) : '';
  return { amount: isNaN(amount) ? '' : amount, category: categoryFromText(t), note: t };
}

// ---------- прогноз, подушка, итоги недели ----------
function forecastHtml() {
  const t = today();
  const month = t.slice(0, 7);
  const s = S();
  const ops = visible();
  const spent = sumExp(ops.filter((o) => o.date.startsWith(month)));
  const income = sumInc(ops.filter((o) => o.date.startsWith(month)));
  // Среднее за 30 дней без регулярных платежей: их учитываем отдельно, чтобы не считать дважды.
  const dailyAvg = sumExp(ops.filter((o) => !o.fromRecurring && o.date > addDays(t, -31) && o.date <= t)) / 30;
  const [y, m] = month.split('-').map(Number);
  const dayNow = Number(t.slice(8));
  const left = lastDay(y, m) - dayNow;
  const unpaidRegular = s.recurring
    .filter((r) => r.active && !s.confirmed[`${r.id}|${month}`])
    .reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const yearlyLeft = s.yearly.filter((x) => x.month === m && x.day > dayNow).reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const end = spent + unpaidRegular + yearlyLeft + dailyAvg * left;
  return `<div class="card"><div class="setting-title">Прогноз на ${monthTitle(month)}</div>
    <div class="grid-2">
      <div class="stat"><div class="lbl">Уже потрачено</div><div class="val">${money(spent)}</div></div>
      <div class="stat"><div class="lbl">Расходы к концу месяца</div><div class="val neg">≈ ${money(end)}</div></div></div>
    <p class="note" style="margin-top:8px">Доходов в месяце: ${money(income)}. Ещё запланировано: регулярные ${money(unpaidRegular)}, ежегодные ${money(yearlyLeft)}. Остальное — среднее за 30 дней × оставшиеся дни.</p></div>`;
}

function liRow(x) {
  return `<div class="li"><span class="dot ${x.kind}"></span>
    <div class="main"><div class="t">${esc(x.title)}</div><div class="s">${fmtDate(x.date)}${x.personId ? ' · ' + esc(personName(x.personId)) : ''}</div></div>
    ${x.amount ? `<div class="amt">${money(x.amount)}</div>` : ''}</div>`;
}

function reviewHtml() {
  const t = today();
  const from = addDays(t, -6);
  const s = S();
  const spent = sumExp(visible().filter((o) => o.date >= from && o.date <= t));
  const tasks = s.homeTasks.filter((x) => x.lastDone && x.lastDone >= from && x.lastDone <= t).length;
  const dow = (new Date(t + 'T00:00').getDay() + 6) % 7;
  const nextMon = addDays(t, 7 - dow);
  const wk = (s.menu && s.menu.weeks[nextMon]);
  const statusRu = { draft: 'черновик', confirmed: 'подтверждено', bought: 'куплено' };
  const up = upcoming(s, t, 7);
  return `<div class="card"><div class="setting-title">Итоги недели</div>
    <div class="grid-2">
      <div class="stat"><div class="lbl">Потрачено за 7 дней</div><div class="val">${money(spent)}</div></div>
      <div class="stat"><div class="lbl">Дел по дому сделано</div><div class="val">${tasks}</div></div></div>
    <p class="note" style="margin-top:8px">Меню на ${fmtDate(nextMon)}: ${wk ? statusRu[wk.status] : 'не запланировано'}</p>
    <div class="sub-title">Ближайшие 7 дней</div>
    ${up.length ? up.map(liRow).join('') : '<div class="empty">Ничего не запланировано</div>'}</div>`;
}

function quickHtml() {
  const btn = (act, label) => `<button data-act="${act}">${label}</button>`;
  return `<div class="quick" role="group" aria-label="Быстрые действия">
    ${btn('addOp', '+ Расход')}${btn('voiceOp', 'Голосом')}${btn('receiptOp', 'Чек')}${btn('addSteps', 'Шаги')}${btn('addList', 'Список')}</div>`;
}

export function dashTop() { return quickHtml() + forecastHtml() + reviewHtml(); }

export function feedHtml() {
  const items = S().log.slice(0, 8);
  const when = (at) => new Date(at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `<div class="card"><div class="setting-title">Лента</div>
    ${items.length ? items.map((l) => `<div class="li"><div class="main"><div class="t">${esc(l.text)}</div>
      <div class="s">${esc(personName(l.personId) || 'Гость')} · ${when(l.at)}</div></div></div>`).join('')
      : '<div class="empty">Событий пока нет</div>'}</div>`;
}

// ---------- подушка безопасности (раздел «Цели») ----------
export function cushionHtml() {
  const s = S();
  const t = today();
  const prev = [1, 2, 3].map((k) => shiftYm(t.slice(0, 7), -k));
  const ops = visible();
  const total = prev.reduce((a, mth) => a + sumExp(ops.filter((o) => o.date.startsWith(mth))), 0);
  const avg = total / 3;
  const target = avg * s.cushion.months;
  const saved = Number(s.cushion.saved) || 0;
  const pct = target ? Math.min(100, Math.round((saved / target) * 100)) : 0;
  return `<div class="card">
    <div class="row" style="justify-content:space-between"><div>
      <div class="setting-title" style="margin:0">Подушка безопасности</div>
      <div class="note">${s.cushion.months} мес. расходов${avg ? ' · средний расход ' + money(avg) + ' в месяц' : ''}</div></div>
      <button class="btn soft" data-act="cushionSet">Срок</button></div>
    <div class="row" style="justify-content:space-between;margin-top:10px"><b>${money(saved)}</b>
      <span class="note">из ${money(target)} · ${pct}%</span></div>
    <div class="bar"><div style="width:${pct}%"></div></div>
    ${avg ? '' : '<div class="note" style="margin-top:6px">Цель появится, когда накопится статистика трат за 3 месяца.</div>'}
    <div class="row" style="margin-top:10px"><button class="btn soft" data-act="cushionTopUp">Пополнить</button></div></div>`;
}

// ---------- Финансы: бюджет, год, отчёт ----------
export const FIN_TABS = [['budget', 'Бюджет'], ['year', 'Год'], ['report', 'Отчёт']];
export const isFinExtraTab = (tab) => FIN_TABS.some(([v]) => v === tab);

export function finTabHtml(tab, month) {
  if (tab === 'budget') return budgetHtml(month);
  if (tab === 'year') return yearHtml(month);
  return reportHtml(month);
}

function budgetHtml(month) {
  const s = S();
  const ops = visible().filter((o) => o.date.startsWith(month) && o.type !== 'income');
  const byCat = {};
  for (const o of ops) byCat[o.category] = (byCat[o.category] || 0) + (Number(o.amount) || 0);
  const cats = s.categories.expense.map((c) => {
    const lim = Number(s.budgets[c]) || 0;
    const sp = byCat[c] || 0;
    const pct = lim ? Math.round((sp / lim) * 100) : 0;
    const cls = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : '';
    return `<div class="bud-row">
      <div class="row" style="justify-content:space-between"><span class="t">${esc(c)}</span>
        <span class="note">${money(sp)}${lim ? ' из ' + money(lim) : ''}</span></div>
      ${lim ? `<div class="bar ${cls}"><div style="width:${Math.min(100, pct)}%"></div></div>` : ''}
      <input data-bud="${esc(c)}" inputmode="decimal" placeholder="Лимит, ₽ (пусто — без лимита)" value="${lim || ''}" aria-label="Лимит: ${esc(c)}"></div>`;
  }).join('');
  const people = s.people.map((p) => {
    const sp = visible().filter((o) => o.type !== 'income' && o.personId === p.id && o.date.startsWith(month))
      .reduce((a, o) => a + (Number(o.amount) || 0), 0);
    const lim = Number(s.allowances[p.id]) || 0;
    const pct = lim ? Math.round((sp / lim) * 100) : 0;
    const cls = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : '';
    return `<div class="bud-row">
      <div class="row" style="justify-content:space-between"><span class="t">${esc(p.name)}</span>
        <span class="note">${money(sp)}${lim ? ' из ' + money(lim) : ''}</span></div>
      ${lim ? `<div class="bar ${cls}"><div style="width:${Math.min(100, pct)}%"></div></div>` : ''}
      <input data-alw="${p.id}" inputmode="decimal" placeholder="Личный лимит, ₽" value="${lim || ''}" aria-label="Личный лимит: ${esc(p.name)}"></div>`;
  }).join('');
  return `<div class="card"><div class="row" style="justify-content:space-between">
      <div class="setting-title" style="margin:0">Лимиты по категориям</div>
      <button class="btn" data-act="saveBudgets">Сохранить</button></div>
      <p class="setting-desc">Жёлтый — от 80% лимита, красный — лимит исчерпан. Пустое поле — без лимита.</p>${cats}</div>
    <div class="card"><div class="setting-title">Личные лимиты</div>
      <p class="setting-desc">Считаются только ваши и общие траты. Личные операции партнёра в расчёт не входят.</p>${people}</div>`;
}

function barRows(rows, max) {
  return rows.map((r) => `<div class="bar-row"><span class="bar-lbl">${esc(r.label)}</span>
    <div class="bar-track"><div class="bar-fill" style="width:${max ? Math.round((r.value / max) * 100) : 0}%"></div></div>
    <span class="bar-val">${money(r.value)}</span></div>`).join('');
}

function yearHtml(month) {
  const s = S();
  const y = month.slice(0, 4);
  const regular = s.recurring.filter((r) => r.active).reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const rows = MONTHS_SHORT.map((label, i) => ({
    label,
    value: regular + s.yearly.filter((x) => x.month === i + 1).reduce((a, x) => a + (Number(x.amount) || 0), 0)
  }));
  const max = Math.max(1, ...rows.map((r) => r.value));
  const list = s.yearly.slice().sort((a, b) => (a.month - b.month) || (a.day - b.day));
  return `<div class="card"><div class="setting-title">Расходы по месяцам, ${y}</div>
      <p class="setting-desc">Регулярные платежи каждый месяц плюс ежегодные, которые приходятся на этот месяц.</p>
      ${barRows(rows, max)}</div>
    <div class="card"><div class="row" style="justify-content:space-between">
      <div class="setting-title">Ежегодные платежи</div><button class="btn" data-act="addYearly">+ Платёж</button></div>
      ${list.length ? list.map((x) => `<div class="li">
        <div class="main"><div class="t">${esc(x.title)}</div>
        <div class="s">${x.day}-го ${MONTHS[x.month - 1]}${x.personId ? ' · ' + esc(personName(x.personId)) : ''}</div></div>
        <div class="amt exp">−${money(x.amount)}</div>
        <button class="icon-btn" data-act="del" data-coll="yearly" data-id="${x.id}" aria-label="Удалить">${X()}</button></div>`).join('')
        : '<div class="empty">Ежегодных платежей нет: страховка, налог, годовая подписка</div>'}</div>`;
}

function reportHtml(month) {
  const s = S();
  const ops = visible().filter((o) => o.date.startsWith(month));
  const income = sumInc(ops);
  const expense = sumExp(ops);
  const byCat = {};
  for (const o of ops.filter((x) => x.type !== 'income')) byCat[o.category] = (byCat[o.category] || 0) + (Number(o.amount) || 0);
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const purchases = ((s.menu && s.menu.purchases) || []).filter((p) => p.date.startsWith(month));
  const tasks = s.homeTasks.filter((x) => (x.lastDone || '').startsWith(month)).length;
  const stepsAvg = s.people.map((p) => {
    const e = s.steps.filter((x) => x.personId === p.id && x.date.startsWith(month));
    const avg = e.length ? Math.round(e.reduce((a, x) => a + x.steps, 0) / e.length) : null;
    return `<div class="cat-row"><span>${esc(p.name)}</span><span></span><span>${avg === null ? '—' : avg.toLocaleString('ru-RU')}</span></div>`;
  }).join('');
  return `<div class="card report">
    <div class="row" style="justify-content:space-between"><div class="setting-title" style="margin:0">Отчёт за ${monthTitle(month)}</div>
      <button class="btn soft no-print" data-act="printReport">Печать / PDF</button></div>
    <div class="grid-2" style="margin:12px 0">
      <div class="stat"><div class="lbl">Доходы</div><div class="val pos">${money(income)}</div></div>
      <div class="stat"><div class="lbl">Расходы</div><div class="val neg">${money(expense)}</div></div></div>
    <div class="sub-title">Категории</div>
    ${cats.length ? cats.map(([c, v]) => {
      const lim = Number(s.budgets[c]) || 0;
      return `<div class="cat-row"><span>${esc(c)}</span><span>${expense ? Math.round((v / expense) * 100) : 0}%${lim ? ' · лимит ' + money(lim) : ''}</span><span>${money(v)}</span></div>`;
    }).join('') : '<div class="empty">Расходов нет</div>'}
    <div class="sub-title">Продукты и дом</div>
    <div class="cat-row"><span>Закупок по меню</span><span>${purchases.length}</span><span>${money(purchases.reduce((a, p) => a + p.total, 0))}</span></div>
    <div class="cat-row"><span>Дел по дому сделано</span><span></span><span>${tasks}</span></div>
    <div class="sub-title">Шаги, в среднем в день</div>${stepsAvg}</div>`;
}

// ---------- списки, идеи, подарки, активность ----------
function checklistCard(coll, obj) {
  const done = obj.items.filter((i) => i.done).length;
  const sub = [obj.budget ? 'бюджет ' + money(obj.budget) : '', `${done} из ${obj.items.length}`].filter(Boolean).join(' · ');
  return `<div class="card">
    <div class="row" style="justify-content:space-between"><div>
      <div class="setting-title" style="margin:0">${esc(obj.title)}</div><div class="note">${sub}</div></div>
      <button class="icon-btn" data-act="del" data-coll="${coll}" data-id="${obj.id}" aria-label="Удалить">${X()}</button></div>
    ${obj.note ? `<p class="note" style="margin:6px 0 0">${esc(obj.note)}</p>` : ''}
    <div style="margin-top:6px">${obj.items.map((it) => `<div class="li">
      <button class="icon-btn" data-act="chkToggle" data-coll="${coll}" data-id="${obj.id}" data-iid="${it.id}" aria-label="${it.done ? 'Снять отметку' : 'Отметить'}">${svg(it.done ? 'check' : 'circle', 18)}</button>
      <div class="main"><div class="t" style="${it.done ? 'text-decoration:line-through;opacity:.55' : ''}">${esc(it.text)}</div>
        ${it.by ? `<div class="s">${esc(personName(it.by))}</div>` : ''}</div>
      <button class="icon-btn" data-act="chkDel" data-coll="${coll}" data-id="${obj.id}" data-iid="${it.id}" aria-label="Удалить пункт">${X()}</button></div>`).join('')}</div>
    <div class="chk-add"><input id="ci_${obj.id}" placeholder="Добавить пункт" aria-label="Новый пункт">
      <button class="btn soft" data-act="chkAdd" data-coll="${coll}" data-id="${obj.id}">Добавить</button></div></div>`;
}

export function viewLists() {
  const list = S().lists;
  return `<div class="row" style="justify-content:flex-end;margin-bottom:8px"><button class="btn" data-act="addList">+ Список</button></div>
    ${list.length ? list.map((l) => checklistCard('lists', l)).join('')
      : '<div class="card empty">Списки покупок и дел. Например: продукты, бытовая химия, аптека, ремонт.</div>'}`;
}

export function viewIdeas() {
  const list = S().ideas;
  return `<div class="row" style="justify-content:flex-end;margin-bottom:8px"><button class="btn" data-act="addIdea">+ Идея</button></div>
    ${list.length ? list.map((x) => checklistCard('ideas', x)).join('')
      : '<div class="card empty">Идеи на поездки и выходные: бюджет и чек-лист сборов.</div>'}`;
}

export function viewGifts() {
  const list = S().gifts.slice().sort((a, b) => (Number(a.done) - Number(b.done)) || (a.date < b.date ? -1 : 1));
  return `<div class="row" style="justify-content:flex-end;margin-bottom:8px"><button class="btn" data-act="addGift">+ Подарок</button></div>
    ${list.length ? list.map((g) => `<div class="card">
      <div class="row" style="justify-content:space-between"><div>
        <div class="setting-title" style="margin:0;${g.done ? 'text-decoration:line-through;opacity:.6' : ''}">${esc(g.title)}</div>
        <div class="note">${fmtDate(g.date)}${g.budget ? ' · бюджет ' + money(g.budget) : ''}${g.personId ? ' · покупает: ' + esc(personName(g.personId)) : ''}</div></div>
        <div class="row"><button class="btn soft" data-act="giftDone" data-id="${g.id}">${g.done ? 'Вернуть' : 'Готово'}</button>
        <button class="icon-btn" data-act="del" data-coll="gifts" data-id="${g.id}" aria-label="Удалить">${X()}</button></div></div>
      ${g.idea ? `<p class="note" style="margin:8px 0 0">Идеи: ${esc(g.idea)}</p>` : ''}</div>`).join('')
      : '<div class="card empty">Дни рождения и поводы. За 14 дней до даты придёт напоминание в колокольчике.</div>'}`;
}

export function viewActivity() {
  const s = S();
  const t = today();
  const days = Array.from({ length: 7 }, (_, i) => addDays(t, -i));
  const val = (pid, d) => { const e = s.steps.find((x) => x.personId === pid && x.date === d); return e ? e.steps : null; };
  const head = `<tr><th>День</th>${s.people.map((p) => `<th>${esc(p.name)}</th>`).join('')}</tr>`;
  const rows = days.map((d) => `<tr><td>${fmtDate(d).slice(0, 5)}</td>${s.people.map((p) => {
    const v = val(p.id, d);
    return `<td>${v === null ? '—' : v.toLocaleString('ru-RU')}</td>`;
  }).join('')}</tr>`).join('');
  const avgs = s.people.map((p) => {
    const vals = days.map((d) => val(p.id, d)).filter((v) => v !== null);
    const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    return `${esc(p.name)}: ${avg === null ? 'нет данных' : avg.toLocaleString('ru-RU') + ' шагов'}`;
  }).join(' · ');
  return `<div class="row" style="justify-content:flex-end;margin-bottom:8px"><button class="btn" data-act="addSteps">+ Шаги</button></div>
    <div class="card"><div class="setting-title">Шаги за 7 дней</div>
      <table class="tbl"><thead>${head}</thead><tbody>${rows}</tbody></table>
      <p class="note" style="margin-top:8px">В среднем в день · ${avgs || 'участников нет'}</p></div>
    <div class="card"><p class="setting-desc">Тренировки пока не ведём: раздел про шаги и прогулки. Расширим, когда появится регулярная активность.</p></div>`;
}

// ---------- напоминания для колокольчика ----------
const lastDayOf = (y, m) => new Date(y, m, 0).getDate();
export function extraReminders(t, days) {
  const s = S();
  const out = [];
  const [yy] = t.split('-').map(Number);
  for (const x of s.yearly) for (const yr of [yy, yy + 1]) {
    const d = Math.min(x.day, lastDayOf(yr, x.month));
    const date = `${yr}-${String(x.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (date >= t && date <= addDays(t, days)) out.push({ kind: 'pay', title: x.title, date, amount: x.amount, personId: x.personId });
  }
  const horizon = addDays(t, Math.max(days, 14));
  for (const g of s.gifts) if (!g.done && g.date >= t && g.date <= horizon) {
    out.push({ kind: 'gift', title: `Подарок: ${g.title}`, date: g.date, personId: g.personId });
  }
  return out;
}

// ---------- формы и действия ----------
function openOperation(prefill) {
  F.openForm('Новая операция', [
    { k: 'type', t: 'select', l: 'Тип', opts: [['expense', 'Расход'], ['income', 'Доход']], v: 'expense' },
    { k: 'amount', t: 'number', l: 'Сумма', ph: '0', v: prefill.amount },
    { k: 'date', t: 'date', l: 'Дата', v: today() },
    { k: 'category', t: 'select', l: 'Категория', opts: S().categories.expense.concat(S().categories.income).map((c) => [c, c]), v: prefill.category || 'Прочее' },
    { k: 'account', t: 'select', l: 'Счёт', opts: S().accounts.map((a) => [a.id, a.name]), v: (S().accounts[0] || {}).id || '' },
    { k: 'personId', t: 'select', l: 'Чей', opts: [['', 'Общее'], ...personOptsReal()], v: me() },
    { k: 'private', t: 'check', l: 'Личное (видите только вы)', v: false },
    { k: 'note', t: 'text', l: 'Комментарий', v: prefill.note || '' }
  ], (o) => {
    if (!o.amount || o.amount <= 0) return 'Введите сумму';
    if (!o.date) return 'Укажите дату';
    S().transactions.push({ id: uid(), type: o.type, amount: o.amount, date: o.date, category: o.category || 'Прочее',
      account: o.account, personId: o.personId, private: o.private, note: o.note });
    logEvent(`${o.type === 'income' ? 'Доход' : 'Расход'} ${money(o.amount)} · ${o.category}`);
    return null;
  });
}

function openVoice() {
  F.openModal('Голосовой ввод', `<div class="form">
    <p class="setting-desc">Скажите или напишите, например: «потратил 850 на продукты». Сумма и категория подставятся, их можно поправить.</p>
    <textarea id="vo-text" rows="2" placeholder="Потратил 850 на продукты"></textarea>
    <div class="pill-row"><button class="btn soft" id="vo-rec">${svg('mic', 18)} Говорить</button>
    <button class="btn" id="vo-go">Дальше</button></div></div>`);
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  document.getElementById('vo-rec').onclick = () => {
    if (!Rec) return F.toast('Голосовой ввод недоступен в этом браузере. Напишите текстом.');
    const r = new Rec();
    r.lang = 'ru-RU';
    r.interimResults = false;
    r.onresult = (e) => { document.getElementById('vo-text').value = e.results[0][0].transcript; };
    r.onerror = () => F.toast('Не расслышал, попробуйте ещё раз');
    r.start();
  };
  document.getElementById('vo-go').onclick = () => {
    const text = document.getElementById('vo-text').value;
    if (!text.trim()) return F.toast('Скажите или напишите операцию');
    openOperation(parseSpoken(text));
  };
}

function openReceipt() {
  F.openModal('Чек', `<div class="form">
    <p class="setting-desc">Чек: PDF с текстом, CSV, TXT или фото (JPG, PNG, WebP). Фото распознаётся на устройстве и может ошибаться, проверьте сумму.</p>
    <label class="btn soft block" style="cursor:pointer">Выбрать файл
      <input id="rc-file" type="file" accept=".pdf,.csv,.txt,.jpg,.jpeg,.png,.webp,text/plain,application/pdf,image/*" class="hidden"></label>
    <div id="rc-res"></div></div>`);
  document.getElementById('rc-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const res = document.getElementById('rc-res');
    res.innerHTML = '<p class="muted">Читаю чек…</p>';
    let parsed;
    try {
      parsed = parseReceiptLines(await readReceiptLines(file));
    } catch (err) {
      res.innerHTML = `<div class="warn-box">Не удалось прочитать файл: ${esc(err.message)}. Введите сумму вручную.</div>`;
      parsed = { items: [], total: 0 };
    }
    const cats = S().categories.expense.map((c) => `<option value="${esc(c)}" ${c === 'Продукты' ? 'selected' : ''}>${esc(c)}</option>`).join('');
    const who = [['', 'Общее'], ...personOptsReal()].map(([v, l]) => `<option value="${v}" ${v === me() ? 'selected' : ''}>${esc(l)}</option>`).join('');
    res.innerHTML = `${parsed.items.length ? `<div class="sub-title">Найдено позиций: ${parsed.items.length}</div>` : ''}
      <div class="form">
        <label class="field" for="rc-date">Дата</label><input id="rc-date" type="date" value="${today()}">
        <label class="field" for="rc-store">Магазин</label><input id="rc-store" placeholder="Например, Пятёрочка">
        <label class="field" for="rc-total">Сумма, ₽</label><input id="rc-total" inputmode="decimal" value="${parsed.total ? String(parsed.total).replace('.', ',') : ''}">
        <label class="field" for="rc-cat">Категория</label><select id="rc-cat">${cats}</select>
        <label class="field" for="rc-who">Чей</label><select id="rc-who">${who}</select>
        <button class="btn block" id="rc-save">Сохранить расход</button></div>`;
    document.getElementById('rc-save').onclick = () => {
      const total = parseFloat(String(document.getElementById('rc-total').value).replace(',', '.'));
      if (!total || total <= 0) return F.toast('Введите сумму чека');
      const store = document.getElementById('rc-store').value.trim();
      S().transactions.push({
        id: uid(), type: 'expense', amount: total, date: document.getElementById('rc-date').value || today(),
        category: document.getElementById('rc-cat').value, account: (S().accounts[0] || {}).id || '',
        personId: document.getElementById('rc-who').value, private: false,
        note: `Чек${store ? ': ' + store : ''}`, items: parsed.items
      });
      logEvent(`Чек ${money(total)}${store ? ' · ' + store : ''}`);
      F.closeModal();
      F.toast('Чек сохранён');
      F.render();
    };
  };
}

function simpleForm(title, fields, onSave) {
  F.openForm(title, fields, onSave);
}

export const FEATURE_ADD = {
  voiceOp: () => openVoice(),
  receiptOp: () => openReceipt(),
  addList: () => simpleForm('Новый список', [{ k: 'title', t: 'text', l: 'Название', ph: 'Продукты на выходные' }], (o) => {
    if (!o.title) return 'Введите название';
    S().lists.push({ id: uid(), title: o.title, items: [] });
    return null;
  }),
  addIdea: () => simpleForm('Новая идея', [
    { k: 'title', t: 'text', l: 'Название', ph: 'Поездка на море' },
    { k: 'budget', t: 'number', l: 'Бюджет, ₽' },
    { k: 'note', t: 'area', l: 'Заметка' }
  ], (o) => {
    if (!o.title) return 'Введите название';
    S().ideas.push({ id: uid(), title: o.title, budget: o.budget || '', note: o.note, items: [] });
    return null;
  }),
  addGift: () => simpleForm('Подарок', [
    { k: 'title', t: 'text', l: 'Кому и повод', ph: 'Маме, день рождения' },
    { k: 'date', t: 'date', l: 'Дата', v: today() },
    { k: 'budget', t: 'number', l: 'Бюджет, ₽' },
    { k: 'idea', t: 'text', l: 'Идеи' },
    { k: 'personId', t: 'select', l: 'Кто покупает', opts: personOptsReal(), v: me() }
  ], (o) => {
    if (!o.title || !o.date) return 'Укажите кому и дату';
    S().gifts.push({ id: uid(), title: o.title, date: o.date, budget: o.budget || '', idea: o.idea, personId: o.personId, done: false });
    return null;
  }),
  addSteps: () => simpleForm('Шаги', [
    { k: 'personId', t: 'select', l: 'Чьи', opts: personOptsReal(), v: me() },
    { k: 'date', t: 'date', l: 'Дата', v: today() },
    { k: 'steps', t: 'number', l: 'Количество шагов' }
  ], (o) => {
    if (!o.personId) return 'Выберите человека';
    if (o.steps === '' || o.steps < 0) return 'Введите количество шагов';
    const ex = S().steps.find((x) => x.personId === o.personId && x.date === o.date);
    if (ex) ex.steps = o.steps;
    else S().steps.push({ id: uid(), personId: o.personId, date: o.date, steps: o.steps });
    return null;
  }),
  addYearly: () => simpleForm('Ежегодный платёж', [
    { k: 'title', t: 'text', l: 'Название', ph: 'Страховка, налог, подписка' },
    { k: 'amount', t: 'number', l: 'Сумма' },
    { k: 'month', t: 'select', l: 'Месяц', opts: MONTHS.map((m, i) => [String(i + 1), m]), v: String(new Date().getMonth() + 1) },
    { k: 'day', t: 'number', l: 'День (1–31)', v: 1 },
    { k: 'category', t: 'select', l: 'Категория', opts: catOpts(), v: 'Прочее' },
    { k: 'personId', t: 'select', l: 'Чей', opts: [['', 'Общее'], ...personOptsReal()], v: '' }
  ], (o) => {
    if (!o.title || o.amount === '' || o.amount <= 0) return 'Заполните название и сумму';
    S().yearly.push({ id: uid(), title: o.title, amount: o.amount, month: Number(o.month), day: Math.min(31, Math.max(1, Number(o.day) || 1)),
      category: o.category, personId: o.personId });
    return null;
  })
};

const itemOf = (coll, id) => S()[coll].find((x) => x.id === id);

export const FEATURE_ACTIONS = {
  saveBudgets: () => {
    const s = S();
    document.querySelectorAll('[data-bud]').forEach((i) => {
      const v = parseFloat(String(i.value).replace(',', '.'));
      if (v > 0) s.budgets[i.dataset.bud] = v; else delete s.budgets[i.dataset.bud];
    });
    document.querySelectorAll('[data-alw]').forEach((i) => {
      const v = parseFloat(String(i.value).replace(',', '.'));
      if (v > 0) s.allowances[i.dataset.alw] = v; else delete s.allowances[i.dataset.alw];
    });
    F.toast('Лимиты сохранены');
  },
  cushionTopUp: () => {
    F.openForm('Подушка: пополнить', [{ k: 'amt', t: 'number', l: 'Сумма' }], (o) => {
      if (!o.amt || o.amt <= 0) return 'Введите сумму';
      S().cushion.saved = (Number(S().cushion.saved) || 0) + o.amt;
      logEvent(`Подушка безопасности +${money(o.amt)}`);
      return null;
    });
    return false;
  },
  cushionSet: () => {
    F.openForm('Срок подушки', [{ k: 'months', t: 'number', l: 'Сколько месяцев расходов откладывать', v: S().cushion.months }], (o) => {
      if (!o.months || o.months <= 0) return 'Введите число месяцев';
      S().cushion.months = o.months;
      return null;
    });
    return false;
  },
  chkAdd: (d) => {
    const text = (document.getElementById('ci_' + d.id).value || '').trim();
    if (!text) return false;
    const obj = itemOf(d.coll, d.id);
    obj.items.push({ id: uid(), text, done: false, by: '' });
  },
  chkToggle: (d) => {
    const obj = itemOf(d.coll, d.id);
    const it = obj.items.find((x) => x.id === d.iid);
    it.done = !it.done;
    it.by = it.done ? me() : '';
    if (it.done && d.coll === 'lists') logEvent(`Куплено: ${it.text}`);
  },
  chkDel: (d) => {
    const obj = itemOf(d.coll, d.id);
    obj.items = obj.items.filter((x) => x.id !== d.iid);
  },
  giftDone: (d) => {
    const g = S().gifts.find((x) => x.id === d.id);
    g.done = !g.done;
    if (g.done) logEvent(`Подарок готов: ${g.title}`);
  },
  printReport: () => { window.print(); return false; }
};

