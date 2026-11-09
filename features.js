// Новые разделы «Ассистента»: бюджет и лимиты, прогноз, подушка безопасности,
// чеки (PDF, CSV, TXT, фото), голосовой ввод, списки, идеи и поездки, подарки, шаги, лента и отчёт.
// Модуль не знает о DOM приложения напрямую: всё нужное передаётся через featuresInit(ctx).
import { upcoming, addDays } from './core.js';
import { readReceiptLines, parseReceiptLines } from './menu/planner.js?v=b9';

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
// Лимиты, которые действуют в месяце: последний набор, чья дата начала не позже этого месяца.
function limitsFor(month) {
  const plans = (S().budgetPlans || []).slice().sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const act = plans.filter((p) => p.from <= month).pop();
  return act ? { budgets: act.budgets || {}, allowances: act.allowances || {} } : { budgets: {}, allowances: {} };
}
const nextMonthYm = () => shiftYm(today().slice(0, 7), 1);
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
  // Лимиты с датой действия: новый набор применяется с месяца, указанного в from.
  if (!s.budgetPlans) {
    const hasLegacy = Object.keys(s.budgets).length || Object.keys(s.allowances).length;
    s.budgetPlans = hasLegacy ? [{ from: '2000-01', budgets: { ...s.budgets }, allowances: { ...s.allowances } }] : [];
  }
  s.lists ||= [];
  s.ideas ||= [];
  s.gifts ||= [];
  s.steps ||= [];
  s.log ||= [];
  s.cushion ||= { months: 3, saved: 0 };
  s.confirmed ||= {};
  s.incomes ||= [];
  s.incomeConfirmed ||= {};
  s.remCats ||= REM_CATS_DEFAULT();
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
  const end = spent + unpaidRegular + dailyAvg * left;
  return `<div class="card"><div class="setting-title">Прогноз на ${monthTitle(month)}</div>
    <div class="grid-2">
      <div class="stat"><div class="lbl">Уже потрачено</div><div class="val">${money(spent)}</div></div>
      <div class="stat"><div class="lbl">Расходы к концу месяца</div><div class="val neg">≈ ${money(end)}</div></div></div>
    <p class="note" style="margin-top:8px">Доходов в месяце: ${money(income)}. Ещё запланировано: регулярные ${money(unpaidRegular)}. Остальное — среднее за 30 дней × оставшиеся дни.</p></div>`;
}

function liRow(x) {
  return `<div class="li"><span class="dot ${x.kind}"></span>
    <div class="main"><div class="t">${esc(x.title)}</div><div class="s">${fmtDate(x.date)}${x.personId ? ' · ' + esc(personName(x.personId)) : ''}</div></div>
    ${x.amount ? `<div class="amt">${money(x.amount)}</div>` : ''}</div>`;
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
export const FIN_TABS = [['incomes', 'Поступления'], ['budget', 'Бюджет'], ['year', 'Год']];
export const isFinExtraTab = (tab) => FIN_TABS.some(([v]) => v === tab);

export function finTabHtml(tab, month) {
  if (tab === 'incomes') return incomeTabHtml(month);
  if (tab === 'budget') return budgetHtml(month);
  if (tab === 'year') return yearHtml(month);
  return yearHtml(month);
}

function budgetHtml(month) {
  const s = S();
  const L = limitsFor(month);
  const ops = visible().filter((o) => o.date.startsWith(month));
  const spent = sumExp(ops);
  const byCat = {};
  for (const o of ops) if (o.type !== 'income') byCat[o.category] = (byCat[o.category] || 0) + (Number(o.amount) || 0);
  const unpaid = s.recurring.filter((r) => r.active && !s.confirmed[`${r.id}|${month}`]).reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const planned = spent + unpaid;
  const limitTotal = Object.values(L.budgets).reduce((a, v) => a + (Number(v) || 0), 0);
  const left = limitTotal - planned;
  const incomePlan = s.incomes.filter((i) => i.active).reduce((a, i) => a + (Number(i.amount) || 0), 0);
  const undistributed = incomePlan - limitTotal;
  const base = Math.max(limitTotal, planned, 1);
  const w = (v) => Math.max(0, Math.min(100, Math.round((v / base) * 100)));
  const tiles = `<div class="grid-2 bud-tiles">
      <div class="stat"><div class="lbl">Лимит на месяц</div><div class="val">${money(limitTotal)}</div></div>
      <div class="stat"><div class="lbl">Запланировано трат</div><div class="val">${money(planned)}</div></div>
      <div class="stat"><div class="lbl">Осталось лимита</div><div class="val ${left < 0 ? 'neg' : 'pos'}">${money(left)}</div></div>
      <div class="stat"><div class="lbl">Не распределено</div><div class="val">${incomePlan ? money(undistributed) : '—'}</div></div></div>`;
  const meter = `<div class="bm-track" role="img" aria-label="Потрачено ${money(spent)}, запланировано ещё ${money(unpaid)}">
      <div class="bm-spent" style="width:${w(spent)}%"></div><div class="bm-plan" style="width:${w(unpaid)}%"></div></div>
    <div class="bm-legend"><span><i class="lg bm-spent-c"></i>Потрачено ${money(spent)}</span><span><i class="lg bm-plan-c"></i>Ещё запланировано ${money(unpaid)}</span></div>
    <p class="note" style="margin:6px 0 0">${!incomePlan ? 'Добавьте регулярные поступления, чтобы видеть нераспределённую сумму.' : undistributed < 0 ? 'Лимиты больше плана доходов на ' + money(-undistributed) + '.' : 'Доход по плану больше лимитов: это нераспределённая сумма.'}</p>`;
  const cats = s.categories.expense.filter((c) => (Number(L.budgets[c]) || 0) > 0 || byCat[c]).map((c) => {
    const lim = Number(L.budgets[c]) || 0;
    const sp = byCat[c] || 0;
    const pct = lim ? Math.round((sp / lim) * 100) : 0;
    const cls = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : '';
    return `<div class="bud-row">
      <div class="row" style="justify-content:space-between"><span class="t">${esc(c)}</span>
        <span class="note">${money(sp)}${lim ? ' из ' + money(lim) : ' · без лимита'}</span></div>
      ${lim ? `<div class="bar ${cls}"><div style="width:${Math.min(100, pct)}%"></div></div>` : ''}</div>`;
  }).join('');
  const people = s.people.map((p) => {
    const sp = visible().filter((o) => o.type !== 'income' && o.personId === p.id && o.date.startsWith(month))
      .reduce((a, o) => a + (Number(o.amount) || 0), 0);
    const lim = Number(L.allowances[p.id]) || 0;
    if (!lim) return '';
    const pct = Math.round((sp / lim) * 100);
    const cls = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : '';
    return `<div class="bud-row">
      <div class="row" style="justify-content:space-between"><span class="t">${esc(p.name)}</span>
        <span class="note">${money(sp)} из ${money(lim)}</span></div>
      <div class="bar ${cls}"><div style="width:${Math.min(100, pct)}%"></div></div></div>`;
  }).join('');
  return `<div class="card"><div class="setting-title">Бюджет на ${monthTitle(month)}</div>
      ${tiles}
      <div class="sub-title">Расходы месяца</div>${meter}</div>
    <div class="card"><div class="setting-title">Категории</div>
      <p class="setting-desc">Жёлтый — от 80% лимита, красный — лимит исчерпан. Лимиты меняются в «Настройки → Финансы».</p>
      ${cats || '<div class="empty">Лимитов пока нет. Задайте их в настройках.</div>'}</div>
    ${people ? `<div class="card"><div class="setting-title">Личные лимиты</div>
      <p class="setting-desc">Считаются только ваши и общие траты. Личные операции партнёра в расчёт не входят.</p>${people}</div>` : ''}`;
}

// Настройки → Финансы: лимиты. Новые значения действуют с следующего месяца.
export function budgetSettingsHtml() {
  const s = S();
  const cur = limitsFor(today().slice(0, 7));
  const pend = (s.budgetPlans || []).find((p) => p.from === nextMonthYm());
  const B = pend ? pend.budgets : cur.budgets;
  const A = pend ? pend.allowances : cur.allowances;
  const rows = s.categories.expense.map((c) => `<div class="lim-row"><span>${esc(c)}</span>
      <input data-bud="${esc(c)}" inputmode="decimal" placeholder="без лимита" value="${Number(B[c]) || ''}" aria-label="Лимит: ${esc(c)}"></div>`).join('');
  const people = s.people.map((p) => `<div class="lim-row"><span>${esc(p.name)}</span>
      <input data-alw="${p.id}" inputmode="decimal" placeholder="без лимита" value="${Number(A[p.id]) || ''}" aria-label="Личный лимит: ${esc(p.name)}"></div>`).join('');
  return `<div class="card">
      <div class="row" style="justify-content:space-between"><div class="setting-title" style="margin:0">Лимиты</div>
        <button class="btn" data-act="saveBudgets">Сохранить</button></div>
      <p class="setting-desc">Новые лимиты применятся с ${esc(monthTitle(nextMonthYm()))}. Текущий месяц не меняется.${pend ? ' Уже запланированы на следующий месяц: ' + esc(monthTitle(nextMonthYm())) + '.' : ''}</p>
      <div class="sub-title">По категориям, ₽ в месяц</div>${rows}
      ${people ? `<div class="sub-title">Личные, ₽ в месяц</div>${people}` : ''}
    </div>`;
}

function barRows(rows, max) {
  return rows.map((r) => `<div class="bar-row"><span class="bar-lbl">${esc(r.label)}</span>
    <div class="bar-track"><div class="bar-fill" style="width:${max ? Math.round((r.value / max) * 100) : 0}%"></div></div>
    <span class="bar-val">${money(r.value)}</span></div>`).join('');
}

// Период отчёта на вкладке «Год»: месяц или весь год. Выбор хранится до перезагрузки.
let REPORT_PERIOD = null;

function yearHtml(month) {
  const s = S();
  const y = month.slice(0, 4);
  const curYm = today().slice(0, 7);
  const ops = visible();
  const regular = s.recurring.filter((r) => r.active).reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const incomePlan = s.incomes.filter((i) => i.active).reduce((a, i) => a + (Number(i.amount) || 0), 0);
  const rows = Array.from({ length: 12 }, (_, i) => {
    const ym = `${y}-${String(i + 1).padStart(2, '0')}`;
    const future = ym > curYm;
    return { ym, label: MONTHS_SHORT[i], future, incPlan: incomePlan, incFact: sumInc(ops.filter((o) => o.date.startsWith(ym))), exp: regular };
  });
  const yearPlan = rows.reduce((a, r) => a + r.incPlan, 0);
  const yearFact = rows.reduce((a, r) => a + (r.future ? 0 : r.incFact), 0);
  const max = Math.max(1, ...rows.flatMap((r) => [r.incPlan, r.incFact, r.exp]));
  const pct = (v) => Math.round((v / max) * 100);
  const period = REPORT_PERIOD && REPORT_PERIOD.startsWith(y) ? REPORT_PERIOD : month;
  const options = [[y, `Весь ${y} год`], ...rows.map((r) => [r.ym, monthTitle(r.ym)])]
    .map(([v, l]) => `<option value="${v}" ${v === period ? 'selected' : ''}>${esc(l)}</option>`).join('');
  return `<div class="card">
      <div class="row" style="justify-content:space-between;align-items:center">
        <button class="icon-btn" data-act="finMonth" data-d="-12" aria-label="Предыдущий год">${svg('left', 18)}</button>
        <div class="setting-title" style="margin:0">Доходы и расходы, ${y}</div>
        <button class="icon-btn" data-act="finMonth" data-d="12" aria-label="Следующий год">${svg('right', 18)}</button></div>
      <p class="setting-desc">Доходы: план — регулярные поступления, факт — все поступления в месяце. Расходы — план по регулярным платежам.</p>
      <div class="year-legend"><span><i class="lg inc plan"></i>Доход, план</span><span><i class="lg inc"></i>Доход, факт</span><span><i class="lg exp"></i>Расход, план</span></div>
      ${rows.map((r) => `<div class="year-row"><span class="ym">${r.label}</span>
        <div class="year-bars">
          <div class="yb-track"><div class="yb inc plan" style="width:${pct(r.incPlan)}%"></div>${r.future ? '' : `<div class="yb inc" style="width:${pct(r.incFact)}%"></div>`}</div>
          <div class="yb-track"><div class="yb exp" style="width:${pct(r.exp)}%"></div></div></div>
        <span class="yv"><span class="inc-t">${r.future ? '—' : money(r.incFact)}</span> <span class="plan-t">из ${money(r.incPlan)}</span><br><span class="exp-t">${money(r.exp)}</span></span></div>`).join('')}
      <div class="year-total"><span>Доходы за год</span><span><span class="inc-t">${money(yearFact)}</span> <span class="plan-t">из ${money(yearPlan)}</span></span></div>
    </div>
    <div class="card">
      <div class="setting-title">Отчёт</div>
      <p class="setting-desc">Выберите месяц или весь год и отправьте сводку.</p>
      <label class="field" for="rep-period">Период</label>
      <select id="rep-period" data-rep>${options}</select>
      ${reportHtml(period)}
    </div>`;
}

function reportHtml(period) {
  const s = S();
  const ops = visible().filter((o) => o.date.startsWith(period));
  const income = sumInc(ops);
  const expense = sumExp(ops);
  const byCat = {};
  for (const o of ops.filter((x) => x.type !== 'income')) byCat[o.category] = (byCat[o.category] || 0) + (Number(o.amount) || 0);
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const purchases = ((s.menu && s.menu.purchases) || []).filter((p) => p.date.startsWith(period));
  return `<div class="report">
    <div class="row" style="justify-content:space-between"><div class="sub-title" style="margin:0">${periodTitle(period)}</div>
      <button class="btn soft no-print" data-act="shareReport" data-month="${period}">${svg('share', 18)} Отправить</button></div>
    <div class="grid-2" style="margin:12px 0">
      <div class="stat"><div class="lbl">Доходы</div><div class="val pos">${money(income)}</div></div>
      <div class="stat"><div class="lbl">Расходы</div><div class="val neg">${money(expense)}</div></div></div>
    <div class="sub-title">Категории</div>
    ${cats.length ? cats.map(([c, v]) => {
      const lim = Number(limitsFor(period.length === 7 ? period : today().slice(0, 7)).budgets[c]) || 0;
      return `<div class="cat-row"><span>${esc(c)}</span><span>${expense ? Math.round((v / expense) * 100) : 0}%${lim ? ' · лимит ' + money(lim) : ''}</span><span>${money(v)}</span></div>`;
    }).join('') : '<div class="empty">Расходов нет</div>'}
    <div class="sub-title">Закупки по меню</div>
    <div class="cat-row"><span>Закупок</span><span>${purchases.length}</span><span>${money(purchases.reduce((a, p) => a + p.total, 0))}</span></div>
    </div>`;
}

// Название периода: «2026» → «2026 год», «2026-11» → «ноябрь 2026».
function periodTitle(period) {
  return period.length === 4 ? `Отчёт за ${period} год` : `Отчёт за ${monthTitle(period)}`;
}

// ---------- списки, идеи, подарки, активность ----------
function checklistCard(coll, obj) {
  const done = obj.items.filter((i) => i.done).length;
  const sub = [obj.budget ? 'бюджет ' + money(obj.budget) : '', `${done} из ${obj.items.length}`].filter(Boolean).join(' · ');
  return `<div class="card">
    <div class="row" style="justify-content:space-between"><div>
      <div class="setting-title" style="margin:0">${esc(obj.title)}</div><div class="note">${sub}</div></div>
      <span><button class="icon-btn" data-act="listRename" data-id="${obj.id}" aria-label="Переименовать">${svg('edit', 18)}</button>
      <button class="icon-btn" data-act="del" data-coll="${coll}" data-id="${obj.id}" aria-label="Удалить">${X()}</button></span></div>
    ${obj.note ? `<p class="note" style="margin:6px 0 0">${esc(obj.note)}</p>` : ''}
    <div style="margin-top:6px">${obj.items.map((it) => `<div class="li">
      <button class="icon-btn" data-act="chkToggle" data-coll="${coll}" data-id="${obj.id}" data-iid="${it.id}" aria-label="${it.done ? 'Снять отметку' : 'Отметить'}">${svg(it.done ? 'check' : 'circle', 18)}</button>
      <div class="main"><div class="t" style="${it.done ? 'text-decoration:line-through;opacity:.55' : ''}">${esc(it.text)}</div>
        ${it.by ? `<div class="s">${esc(personName(it.by))}</div>` : ''}</div>
      <button class="icon-btn" data-act="chkEdit" data-coll="${coll}" data-id="${obj.id}" data-iid="${it.id}" aria-label="Изменить пункт">${svg('edit', 18)}</button>
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




// ---------- напоминания для колокольчика ----------
export function extraReminders(t, days) {
  const s = S();
  const out = [];
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
  })
};

const itemOf = (coll, id) => S()[coll].find((x) => x.id === id);

export const FEATURE_ACTIONS = {
  saveBudgets: () => {
    const s = S();
    const budgets = {};
    document.querySelectorAll('[data-bud]').forEach((i) => {
      const v = parseFloat(String(i.value).replace(',', '.'));
      if (v > 0) budgets[i.dataset.bud] = v;
    });
    const allowances = {};
    document.querySelectorAll('[data-alw]').forEach((i) => {
      const v = parseFloat(String(i.value).replace(',', '.'));
      if (v > 0) allowances[i.dataset.alw] = v;
    });
    const from = nextMonthYm();
    s.budgetPlans = (s.budgetPlans || []).filter((p) => p.from !== from);
    s.budgetPlans.push({ from, budgets, allowances });
    F.toast(`Лимиты сохранены, действуют с ${monthTitle(from)}`);
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
  }
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
      if (r.date.startsWith(ym)) add(r.date, r.cat || 'rem', r.title, 0, extra);
    } else if (r.date.slice(0, 7) <= ym) {
      if (r.repeat === 'month' || (r.repeat === 'year' && rm === m)) add(at(rd), r.cat || 'rem', r.title, 0, extra);
    }
  }
  for (const x of s.recurring) if (x.active) add(at(x.day), 'pay', x.title, x.amount, { personId: x.personId });
  for (const d of s.debts) if (d.remaining > 0) add(at(d.dueDay || 10), 'pay', `Кредит: ${d.title}`, d.monthly);
  for (const i of s.incomes) if (i.active) add(at(i.day), 'income', i.title, i.amount, { id: i.id, coll: 'incomes', personId: i.personId });
  return out;
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
    { k: 'personId', t: 'select', l: 'Для кого', opts: [['', 'Общее'], ...personOptsReal()], v: '' },
    { k: 'cat', t: 'select', l: 'Категория', opts: remCatList().map((c) => [c.id, c.name]), v: 'rem' }
  ], (o) => {
    if (!o.title || !o.date) return 'Введите название и дату';
    S().reminders.push({ id: uid(), title: o.title, date: o.date, repeat: o.repeat, personId: o.personId, cat: o.cat || 'rem' });
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

// Календарь напоминаний: категории задают цвет и видимость событий.
export function remView() {
  ensureCalState();
  const cats = remCatList();
  const colorOf = (id) => (['rem', 'pay', 'income', 'bday'].includes(id) ? `cal-${id}` : 'cal-custom');
  const nameOf = (id) => (cats.find((c) => c.id === id) || {}).name || '';
  const [y, m] = REM_MONTH.split('-').map(Number);
  const dim = lastDay(y, m);
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const enabled = new Set(cats.filter((c) => c.on).map((c) => c.id));
  const byDay = {};
  for (const e of eventsOfMonth(REM_MONTH)) if (enabled.has(e.kind)) (byDay[e.date] = byDay[e.date] || []).push(e);
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="cal-cell cal-empty" aria-hidden="true"></span>');
  for (let d = 1; d <= dim; d++) {
    const date = `${REM_MONTH}-${String(d).padStart(2, '0')}`;
    const list = byDay[date] || [];
    const kinds = [...new Set(list.map((e) => e.kind))];
    cells.push(`<button class="cal-cell ${date === today() ? 'is-today' : ''} ${date === REM_DAY ? 'is-sel' : ''}" data-act="remPick" data-day="${date}"
      aria-label="${fmtDate(date)}, событий: ${list.length}"><span class="cal-num">${d}</span>
      <span class="cal-dots">${kinds.slice(0, 4).map((k) => `<i class="cal-dot ${colorOf(k)}"></i>`).join('')}</span></button>`);
  }
  const dayList = byDay[REM_DAY] || [];
  const legend = cats.filter((c) => c.on).map((c) => `<span class="cal-leg"><i class="cal-dot ${colorOf(c.id)}"></i>${esc(c.name)}</span>`).join('');
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
      ${dayList.length ? dayList.map((e) => `<div class="li"><i class="cal-dot ${colorOf(e.kind)}"></i>
        <div class="main"><div class="t">${esc(e.title)}</div>
        <div class="s">${esc(nameOf(e.kind))}${e.personId ? ' · ' + esc(personName(e.personId)) : ''}</div></div>
        ${e.amount ? `<div class="amt">${money(e.amount)}</div>` : ''}
        ${e.coll ? `<button class="icon-btn" data-act="del" data-coll="${e.coll}" data-id="${e.id}" aria-label="Удалить">${X()}</button>` : ''}</div>`).join('')
        : '<div class="empty">Событий в этот день нет</div>'}
    </div>`;
}


// ---------- категории напоминаний и итоговый блок главной ----------
const BUILTIN_CATS = ['rem', 'pay', 'income', 'bday'];
export const REM_CATS_DEFAULT = () => [
  { id: 'rem', name: 'Напоминание', on: true },
  { id: 'pay', name: 'Платежи', on: true },
  { id: 'income', name: 'Поступления', on: true },
  { id: 'bday', name: 'День рождения', on: true }
];
const remCatList = () => S().remCats || REM_CATS_DEFAULT();

// Какая категория открыта для переименования и удаления (карандашик).
let REM_CAT_EDIT = null;
export function remCatsSettingsHtml() {
  const cats = remCatList();
  return `<div class="card"><div class="setting-title">Категории напоминаний</div>
    <p class="setting-desc">Выключенная категория скрывается из календаря и колокольчика.</p>
    ${cats.map((c) => {
      const editing = REM_CAT_EDIT === c.id;
      return `<div class="li cat-li">
        <input type="checkbox" id="rco_${c.id}" ${c.on ? 'checked' : ''} aria-label="Показывать: ${esc(c.name)}">
        ${editing ? `<input id="rc_${c.id}" class="cat-name-input" value="${esc(c.name)}" aria-label="Название категории">`
                  : `<span class="t cat-name">${esc(c.name)}</span>`}
        <button class="icon-btn" data-act="remCatEdit" data-id="${c.id}" aria-label="${editing ? 'Готово' : 'Изменить категорию'}">${svg(editing ? 'check' : 'edit', 18)}</button>
        ${editing && !BUILTIN_CATS.includes(c.id) ? `<button class="icon-btn" data-act="remCatDel" data-id="${c.id}" aria-label="Удалить категорию">${X()}</button>` : ''}
      </div>`;
    }).join('')}
    <div class="row" style="margin-top:10px"><input id="rc_new" placeholder="Например, «Вывоз мусора»" aria-label="Новая категория" style="flex:1;min-width:0">
      <button class="btn soft" data-act="remCatAdd">Добавить</button></div>
    <div class="pill-row" style="margin-top:10px"><button class="btn" data-act="remCatSave">Сохранить категории</button></div></div>`;
}

export function dashTop() {
  const t = today();
  const month = t.slice(0, 7);
  const s = S();
  const monthOps = visible().filter((o) => o.date.startsWith(month));
  const income = sumInc(monthOps);
  const expense = sumExp(monthOps);
  const dailyAvg = sumExp(visible().filter((o) => !o.fromRecurring && o.date > addDays(t, -31) && o.date <= t)) / 30;
  const [y, m] = month.split('-').map(Number);
  const dayNow = Number(t.slice(8));
  const left = lastDay(y, m) - dayNow;
  const unpaid = s.recurring.filter((r) => r.active && !s.confirmed[`${r.id}|${month}`]).reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const end = expense + unpaid + dailyAvg * left;
  // Поступления, которые ещё не подтверждены в этом месяце, входят в прогноз дохода.
  const incomeLeft = s.incomes.filter((i) => i.active && !s.incomeConfirmed[`${i.id}|${month}`])
    .reduce((a, i) => a + (Number(i.amount) || 0), 0);
  const incomeEnd = income + incomeLeft;
  return `<div class="card money-main">
    <div class="row" style="justify-content:space-between"><div class="setting-title" style="margin:0">Доходы и расходы</div>
      <span class="note">${monthTitle(month)}</span></div>
    <div class="grid-2" style="margin-top:10px">
      <div class="stat"><div class="lbl">Доходы</div><div class="val pos">${money(income)}</div>
        <div class="note">≈ ${money(incomeEnd)} к концу месяца</div></div>
      <div class="stat"><div class="lbl">Расходы</div><div class="val neg">${money(expense)}</div>
        <div class="note">≈ ${money(end)} к концу месяца</div></div></div>
    <p class="note" style="margin:8px 0 0">Прогноз: запланированные платежи и поступления плюс среднее за 30 дней на ${left} дн.</p></div>`;
}

function reportText(month) {
  const ops = visible().filter((o) => o.date.startsWith(month));
  const byCat = {};
  for (const o of ops.filter((x) => x.type !== 'income')) byCat[o.category] = (byCat[o.category] || 0) + (Number(o.amount) || 0);
  const lines = Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => `• ${c}: ${money(v)}`);
  return [periodTitle(month), `Доходы: ${money(sumInc(ops))}`, `Расходы: ${money(sumExp(ops))}`, ...lines].join('\n');
}

// Берём галочки и названия из открытой формы, чтобы не потерять правки при перерисовке.
function readCatsFromDom() {
  const cats = remCatList();
  for (const c of cats) {
    const cb = document.getElementById('rco_' + c.id);
    if (cb) c.on = cb.checked;
    const nm = document.getElementById('rc_' + c.id);
    if (nm && nm.value.trim()) c.name = nm.value.trim();
  }
  return cats;
}

export const EXTRA_CATS_ACTIONS = {
  remCatSave: () => {
    const cats = remCatList();
    for (const c of cats) {
      const name = (document.getElementById('rc_' + c.id)?.value || '').trim();
      if (name) c.name = name;
      const cb = document.getElementById('rco_' + c.id);
      if (cb) c.on = cb.checked;
    }
    S().remCats = cats;
    F.toast('Категории сохранены');
  },
  remCatAdd: () => {
    const name = (document.getElementById('rc_new')?.value || '').trim();
    if (!name) return false;
    S().remCats = [...remCatList(), { id: 'c' + uid(), name, on: true }];
  },
  remCatEdit: (d) => {
    const cats = readCatsFromDom();
    REM_CAT_EDIT = REM_CAT_EDIT === d.id ? null : d.id;
    S().remCats = cats;
  },
  remCatDel: (d) => {
    S().remCats = readCatsFromDom().filter((c) => c.id !== d.id);
    REM_CAT_EDIT = null;
    for (const r of S().reminders) if (r.cat === d.id) r.cat = 'rem';
  },
  listRename: (d) => {
    const obj = itemOf('lists', d.id);
    F.openForm('Переименовать список', [{ k: 'title', t: 'text', l: 'Название', v: obj.title }], (o) => {
      if (!o.title) return 'Введите название';
      obj.title = o.title;
      return null;
    });
    return false;
  },
  chkEdit: (d) => {
    const obj = itemOf(d.coll, d.id);
    const it = obj.items.find((x) => x.id === d.iid);
    F.openForm('Изменить пункт', [{ k: 'text', t: 'text', l: 'Пункт', v: it.text }], (o) => {
      if (!o.text) return 'Введите текст';
      it.text = o.text;
      return null;
    });
    return false;
  },
  shareReport: async (d) => {
    const text = reportText(d.month);
    const title = `Отчёт ${d.month}`;
    if (navigator.share) {
      try { await navigator.share({ title, text }); } catch { /* отменено пользователем */ }
    } else {
      try { await navigator.clipboard.writeText(text); F.toast('Отчёт скопирован'); } catch { F.toast('Не удалось отправить'); }
    }
    return false;
  }
};

export const EXTRA_ACTIONS_ALL = { ...EXTRA_ACTIONS, ...EXTRA_CATS_ACTIONS };

// Выбор периода отчёта: один выпадающий список.
document.addEventListener('change', (e) => {
  const sel = e.target.closest && e.target.closest('select[data-rep]');
  if (!sel || !F) return;
  REPORT_PERIOD = sel.value;
  F.render();
});
