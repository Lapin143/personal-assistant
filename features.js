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
  s.incomes ||= [];
  s.incomeConfirmed ||= {};
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
export const FIN_TABS = [['incomes', 'Поступления'], ['budget', 'Бюджет'], ['year', 'Год'], ['report', 'Отчёт']];
export const isFinExtraTab = (tab) => FIN_TABS.some(([v]) => v === tab);

export function finTabHtml(tab, month) {
  if (tab === 'incomes') return incomeTabHtml(month);
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


// ---------- календарь напоминаний ----------
let REM_MONTH = null;
let REM_DAY = null;
const KIND_TITLE = { rem: 'Напоминание', pay: 'Платёж', gift: 'Подарок', income: 'Поступление' };
const CAL_DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function ensureCalState() {
  if (!REM_DAY) { REM_DAY = today(); REM_MONTH = today().slice(0, 7); }
}

// Все события месяца: собственные напоминания (с повтором), платежи, подарки, поступления.
function eventsOfMonth(ym) {
  const s = S();
  const out = [];
  const [y, m] = ym.split('-').map(Number);
  const dim = lastDay(y, m);
  const at = (d) => `${ym}-${String(Math.min(d, dim)).padStart(2, '0')}`;
  const add = (date, kind, title, amount, extra = {}) => out.push({ date, kind, title, amount, ...extra });
  for (const r of s.reminders) {
    const rd = Number(r.date.slice(8, 10));
    const rm = Number(r.date.slice(5, 7));
    const extra = { id: r.id, coll: 'reminders', personId: r.personId };
    if (r.repeat === 'none') {
      if (r.date.startsWith(ym)) add(r.date, 'rem', r.title, 0, extra);
    } else if (r.date.slice(0, 7) <= ym) {
      if (r.repeat === 'month' || (r.repeat === 'year' && rm === m)) add(at(rd), 'rem', r.title, 0, extra);
    }
  }
  for (const x of s.recurring) if (x.active) add(at(x.day), 'pay', x.title, x.amount, { personId: x.personId });
  for (const x of s.yearly) if (x.month === m) add(at(x.day), 'pay', x.title, x.amount, { personId: x.personId });
  for (const d of s.debts) if (d.remaining > 0) add(at(d.dueDay || 10), 'pay', `Долг: ${d.title}`, d.monthly);
  for (const g of s.gifts) if (!g.done && g.date.startsWith(ym)) add(g.date, 'gift', g.title, g.budget || 0, { personId: g.personId });
  for (const i of s.incomes) if (i.active) add(at(i.day), 'income', i.title, i.amount, { id: i.id, coll: 'incomes', personId: i.personId });
  return out;
}

export function remView() {
  ensureCalState();
  const [y, m] = REM_MONTH.split('-').map(Number);
  const dim = lastDay(y, m);
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const byDay = {};
  for (const e of eventsOfMonth(REM_MONTH)) (byDay[e.date] = byDay[e.date] || []).push(e);
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="cal-cell cal-empty" aria-hidden="true"></span>');
  for (let d = 1; d <= dim; d++) {
    const date = `${REM_MONTH}-${String(d).padStart(2, '0')}`;
    const list = byDay[date] || [];
    const kinds = [...new Set(list.map((e) => e.kind))];
    cells.push(`<button class="cal-cell ${date === today() ? 'is-today' : ''} ${date === REM_DAY ? 'is-sel' : ''}" data-act="remPick" data-day="${date}"
      aria-label="${fmtDate(date)}, событий: ${list.length}"><span class="cal-num">${d}</span>
      <span class="cal-dots">${kinds.slice(0, 4).map((k) => `<i class="cal-dot cal-${k}"></i>`).join('')}</span></button>`);
  }
  const dayList = byDay[REM_DAY] || [];
  const legend = Object.entries(KIND_TITLE).map(([k, t]) => `<span class="cal-leg"><i class="cal-dot cal-${k}"></i>${t}</span>`).join('');
  return `<div class="pl-week-nav">
      <button class="icon-btn" data-act="remNav" data-d="-1" aria-label="Предыдущий месяц">‹</button>
      <div class="pl-week-title"><strong style="text-transform:capitalize">${monthTitle(REM_MONTH)}</strong></div>
      <button class="icon-btn" data-act="remNav" data-d="1" aria-label="Следующий месяц">›</button></div>
    <div class="cal-legend">${legend}</div>
    <div class="cal-grid cal-head">${CAL_DOW.map((d) => `<span>${d}</span>`).join('')}</div>
    <div class="cal-grid">${cells.join('')}</div>
    <div class="card" style="margin-top:12px">
      <div class="row" style="justify-content:space-between"><div class="setting-title" style="margin:0">${fmtDate(REM_DAY)}</div>
        <button class="btn" data-act="remNew">+ Событие</button></div>
      ${dayList.length ? dayList.map((e) => `<div class="li"><i class="cal-dot cal-${e.kind}"></i>
        <div class="main"><div class="t">${esc(e.title)}</div>
        <div class="s">${KIND_TITLE[e.kind]}${e.personId ? ' · ' + esc(personName(e.personId)) : ''}</div></div>
        ${e.amount ? `<div class="amt">${money(e.amount)}</div>` : ''}
        ${e.coll ? `<button class="icon-btn" data-act="del" data-coll="${e.coll}" data-id="${e.id}" aria-label="Удалить">${X()}</button>` : ''}</div>`).join('')
        : '<div class="empty">Событий в этот день нет</div>'}
    </div>`;
}

// ---------- регулярные поступления (зарплата и т.п.) ----------
export function incomeTabHtml(month) {
  const s = S();
  const list = s.incomes.slice().sort((a, b) => a.day - b.day);
  const plan = list.filter((i) => i.active).reduce((a, i) => a + (Number(i.amount) || 0), 0);
  const got = sumInc(visible().filter((o) => o.date.startsWith(month)));
  return `<div class="card"><div class="row" style="justify-content:space-between">
      <div class="setting-title" style="margin:0">Регулярные поступления</div>
      <button class="btn" data-act="addIncome">+ Поступление</button></div>
    <p class="setting-desc">В день прихода появится запрос на подтверждение. Сумму можно поправить: зарплата иногда меняется.</p>
    ${list.length ? list.map((i) => `<div class="li">
      <div class="main"><div class="t">${esc(i.title)}${i.active ? '' : ' · на паузе'}</div>
      <div class="s">${i.day}-го числа${i.personId ? ' · ' + esc(personName(i.personId)) : ''}</div></div>
      <div class="amt inc">+${money(i.amount)}</div>
      <button class="icon-btn" data-act="incToggle" data-id="${i.id}" aria-label="${i.active ? 'Пауза' : 'Возобновить'}">${svg(i.active ? 'pause' : 'play', 18)}</button>
      <button class="icon-btn" data-act="del" data-coll="incomes" data-id="${i.id}" aria-label="Удалить">${X()}</button></div>`).join('')
      : '<div class="empty">Поступлений пока нет</div>'}
    <p class="note">План в месяц: ${money(plan)} · пришло в этом месяце: ${money(got)}</p></div>`;
}

// Поступления, которые уже должны были прийти и не подтверждены.
export function pendingIncomes(t = today()) {
  const s = S();
  const ym = t.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const dayNow = Number(t.slice(8));
  return s.incomes
    .filter((i) => i.active && i.day <= dayNow && !s.incomeConfirmed[`${i.id}|${ym}`])
    .map((i) => ({ i, ym, date: `${ym}-${String(Math.min(i.day, lastDay(y, m))).padStart(2, '0')}` }));
}

export function pendingIncomeHtml() {
  const list = pendingIncomes();
  if (!list.length) return '';
  return `<div class="card pending"><div class="setting-title">Поступления: подтвердите</div>
    <p class="setting-desc">Проверьте сумму и подтвердите, когда деньги пришли. Если не пришли, отметьте «Не пришло».</p>
    ${list.map(({ i, ym, date }) => `<div class="li">
      <div class="main"><div class="t">${esc(i.title)}</div>
      <div class="s">${fmtDate(date)} · ${esc(personName(i.personId) || 'Общее')}</div></div>
      <div class="amt inc">+${money(i.amount)}</div>
      <button class="btn soft" data-act="incConfirm" data-id="${i.id}" data-ym="${ym}">Подтвердить</button>
      <button class="icon-btn" data-act="incSkip" data-id="${i.id}" data-ym="${ym}" aria-label="Не пришло">${X()}</button></div>`).join('')}</div>`;
}

export const EXTRA_ADD = {
  remNew: () => simpleForm('Событие', [
    { k: 'title', t: 'text', l: 'Что напомнить' },
    { k: 'date', t: 'date', l: 'Дата', v: REM_DAY || today() },
    { k: 'repeat', t: 'select', l: 'Повтор', opts: [['none', 'однократно'], ['month', 'каждый месяц'], ['year', 'каждый год']], v: 'none' },
    { k: 'personId', t: 'select', l: 'Для кого', opts: [['', 'Общее'], ...personOptsReal()], v: '' }
  ], (o) => {
    if (!o.title || !o.date) return 'Введите название и дату';
    S().reminders.push({ id: uid(), title: o.title, date: o.date, repeat: o.repeat, personId: o.personId });
    REM_DAY = o.date;
    REM_MONTH = o.date.slice(0, 7);
    return null;
  }),
  addIncome: () => simpleForm('Регулярное поступление', [
    { k: 'title', t: 'text', l: 'Название', ph: 'Зарплата' },
    { k: 'amount', t: 'number', l: 'Сумма' },
    { k: 'day', t: 'number', l: 'День месяца (1–31)', v: 10 },
    { k: 'category', t: 'select', l: 'Категория', opts: S().categories.income.map((c) => [c, c]), v: 'Зарплата' },
    { k: 'account', t: 'select', l: 'Счёт', opts: S().accounts.map((a) => [a.id, a.name]), v: (S().accounts[0] || {}).id || '' },
    { k: 'personId', t: 'select', l: 'Чьё', opts: personOptsReal(), v: me() }
  ], (o) => {
    if (!o.title || o.amount === '' || o.amount <= 0) return 'Заполните название и сумму';
    S().incomes.push({ id: uid(), title: o.title, amount: o.amount, day: Math.min(31, Math.max(1, Number(o.day) || 1)),
      category: o.category, account: o.account, personId: o.personId, active: true });
    return null;
  })
};

export const EXTRA_ACTIONS = {
  remNav: (d) => { ensureCalState(); REM_MONTH = shiftYm(REM_MONTH, Number(d.d)); },
  remPick: (d) => { REM_DAY = d.day; REM_MONTH = d.day.slice(0, 7); },
  incToggle: (d) => { const i = S().incomes.find((x) => x.id === d.id); i.active = !i.active; },
  incConfirm: (d) => {
    const i = S().incomes.find((x) => x.id === d.id);
    F.openForm(`Поступление: ${i.title}`, [
      { k: 'amt', t: 'number', l: 'Сумма, которая пришла', v: i.amount },
      { k: 'date', t: 'date', l: 'Дата прихода', v: today() }
    ], (o) => {
      if (!o.amt || o.amt <= 0) return 'Введите сумму';
      S().transactions.push({ id: uid(), type: 'income', amount: o.amt, date: o.date || today(), category: i.category || 'Зарплата',
        account: i.account || (S().accounts[0] || {}).id || '', personId: i.personId || '', private: false,
        note: i.title, fromIncome: i.id });
      S().incomeConfirmed[`${i.id}|${d.ym}`] = { status: 'ok', at: today(), amount: o.amt };
      logEvent(`Поступление ${money(o.amt)} · ${i.title}`);
      return null;
    });
    return false;
  },
  incSkip: (d) => { S().incomeConfirmed[`${d.id}|${d.ym}`] = { status: 'skip', at: today() }; }
};
