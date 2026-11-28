// Новые разделы «Ассистента»: бюджет и лимиты, прогноз, подушка безопасности,
// чеки (PDF, CSV, TXT, фото), голосовой ввод, списки, идеи и поездки, подарки, шаги, лента и отчёт.
// Модуль не знает о DOM приложения напрямую: всё нужное передаётся через featuresInit(ctx).
import { addDays, daysBetween } from './core.js?v=c3';
import { allOps } from './store.js?v=c3';

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

// Личный лимит: операция человека, у которого на этот месяц задан личный лимит, списывает его,
// а не лимит категории. Если личного лимита у человека нет, трата остаётся в лимите категории.
const isPersonalSpend = (o, L) => o.type !== 'income' && Boolean(o.personId) && Number(L.allowances[o.personId]) > 0;
// Траты месяца, которые считаются в лимитах категорий (без личных).
export function categorySpend(ops, month) {
  const L = limitsFor(month);
  const byCat = {};
  for (const o of ops) {
    if (o.type === 'income' || isPersonalSpend(o, L)) continue;
    byCat[o.category] = (byCat[o.category] || 0) + (Number(o.amount) || 0);
  }
  return byCat;
}
// Лимит категории в месяце (0 — не задан) и сколько уже потрачено из него.
export function categoryLimitInfo(month) {
  const L = limitsFor(month);
  const ops = visible().filter((o) => o.date.startsWith(month));
  return { limits: L.budgets, spent: categorySpend(ops, month) };
}

// Средние расходы по закрытым месяцам (статус «Месяц закрыт»: есть итоги в history_json).
// Личные траты (с указанным «Чей» и личные операции) не входят: считаются только общие расходы.
// Пересчитывается сама при каждом закрытии месяца, потому что берёт данные из итогов.
export function closedAverages() {
  const hist = S().history_json || {};
  const cur = today().slice(0, 7);
  const months = Object.keys(hist).filter((ym) => /^\d{4}-\d{2}$/.test(ym) && ym <= cur && hist[ym]).sort();
  const byCat = {};
  const byPerson = {};
  let total = 0;
  for (const ym of months) {
    const h = hist[ym];
    if (Array.isArray(h.rows)) {
      for (const r of h.rows) {
        if (r.type === 'income') continue;
        const amt = Number(r.amount) || 0;
        if (r.personId) byPerson[r.personId] = (byPerson[r.personId] || 0) + amt;
        if (r.personId || r.private) continue;
        total += amt;
        byCat[r.category] = (byCat[r.category] || 0) + amt;
      }
    } else {
      total += Number(h.total_expense) || 0;
      for (const [c, v] of Object.entries(h.categories || {})) byCat[c] = (byCat[c] || 0) + (Number(v) || 0);
    }
  }
  const n = months.length;
  const avg = (v) => (n ? v / n : 0);
  return {
    months: n, total: avg(total),
    byCat: Object.fromEntries(Object.entries(byCat).map(([c, v]) => [c, avg(v)])),
    byPerson: Object.fromEntries(Object.entries(byPerson).map(([p, v]) => [p, avg(v)]))
  };
}
// Среднее, округлённое до 100 ₽, для подстановки в поле лимита.
const roundAvg = (v) => (v > 0 ? Math.max(100, Math.round(v / 100) * 100) : '');
const monthsWord = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'месяцу' : 'месяцам');
const personOptsReal = () => S().people.map((p) => [p.id, p.name]);
const catOpts = () => S().categories.expense.map((c) => [c, c]);
const sumExp = (list) => list.filter((t) => t.type !== 'income').reduce((a, t) => a + (Number(t.amount) || 0), 0);
const sumInc = (list) => list.filter((t) => t.type === 'income').reduce((a, t) => a + (Number(t.amount) || 0), 0);
// Личные операции партнёра не показываем: в расчётах видны только общие и свои.
// Операции плюс итоги закрытых месяцев (сводные строки с признаком closed).
const visible = () => allOps(S()).filter((t) => !t.private || t.personId === me());
// Средний расход в день за последние 30 дней, без регулярных платежей.
// От закрытых месяцев остались только итоги, поэтому окно начинается не раньше первого открытого дня.
function dailyAvgOf(ops, t) {
  let from = addDays(t, -30);
  const lastClosed = Object.keys(S().history_json || {}).filter((ym) => ym < t.slice(0, 7)).sort().pop();
  if (lastClosed) {
    const [y, m] = lastClosed.split('-').map(Number);
    const firstOpen = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
    if (firstOpen > from) from = firstOpen;
  }
  const days = Math.max(1, Math.min(30, daysBetween(from, t) + 1));
  return sumExp(ops.filter((o) => !o.closed && !o.fromRecurring && o.date >= from && o.date <= t)) / days;
}

export function logEvent(text) {
  const s = S();
  s.log.unshift({ id: uid(), at: Date.now(), personId: me(), text });
  if (s.log.length > 200) s.log.length = 200;
}

export function featuresInit(ctx) { F = ctx; }

// Если автомобиль один, все операции категории «Авто» принадлежат ему: и обычные, и итоги закрытых месяцев.
// Проверка безопасная и повторяемая: уже привязанные операции не трогаются.
export const CAR_CATEGORY = 'Авто';
export function linkCarOps(s) {
  if (!s || !Array.isArray(s.cars) || s.cars.length !== 1) return 0;
  const id = s.cars[0].id;
  let n = 0;
  for (const t of s.transactions || []) if (t.category === CAR_CATEGORY && t.type !== 'income' && !t.carId) { t.carId = id; n++; }
  for (const h of Object.values(s.history_json || {})) {
    for (const r of (h && h.rows) || []) if (r.category === CAR_CATEGORY && r.type !== 'income' && !r.carId) { r.carId = id; n++; }
  }
  return n;
}

// Гарантирует наличие новых полей в данных (для старых сохранений и импорта).
export function ensureData(s) {
  linkCarOps(s);
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





// ---------- подушка безопасности (раздел «Цели») ----------
// Подушка = средний общий расход за закрытые месяцы (без личных трат) × выбранное число месяцев.
function cushionState() {
  const s = S();
  const a = closedAverages();
  const target = a.total * s.cushion.months;
  const saved = Number(s.cushion.saved) || 0;
  const pct = target ? Math.min(100, Math.round((saved / target) * 100)) : 0;
  return { a, target, saved, pct, months: s.cushion.months };
}

// Строка подушки для главной: показывается как обычная цель.
export function cushionGoalRow() {
  const c = cushionState();
  return `<div class="li" style="display:block">
    <div class="row" style="justify-content:space-between"><span class="t">Подушка безопасности</span><span class="note">${c.target ? c.pct + '%' : money(c.saved)}</span></div>
    <div class="bar"><div style="width:${c.pct}%"></div></div>
    <div class="note" style="margin-top:4px">${c.target ? `${money(c.saved)} из ${money(c.target)}` : 'Цель появится после закрытия первого месяца'}</div></div>`;
}

export function cushionHtml() {
  const c = cushionState();
  return `<section class="cushion-card card">
    <div class="cushion-head"><div><div class="eyebrow">Финансовая опора</div><div class="setting-title">Подушка безопасности</div></div>
      <button class="icon-btn" data-act="cushionSet" aria-label="Настроить срок">⚙</button></div>
    <div class="cushion-total">${money(c.saved)} <span>из ${money(c.target)}</span></div>
    <div class="goal-track"><i style="width:${c.pct}%"></i></div>
    <div class="cushion-caption">${c.months} мес. расходов · ${c.pct}% накоплено${c.a.total ? ' · средний расход ' + money(c.a.total) + '/мес.' : ''}</div>
    <div class="note" style="margin-top:6px">${c.a.months
      ? `Расчёт по ${c.a.months} закрытым ${monthsWord(c.a.months)}: среднемесячные общие расходы без личных трат. Обновляется при закрытии месяца.`
      : 'Цель появится после того, как вы закроете первый месяц в «Финансах». Считаются средние расходы закрытых месяцев без личных трат.'}</div>
    <button class="btn" data-act="cushionTopUp">Пополнить подушку&nbsp; +</button></section>`;
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
  const byCat = categorySpend(ops, month);
  const spentCat = Object.values(byCat).reduce((a, v) => a + v, 0);
  const unpaid = s.recurring.filter((r) => r.active && !s.confirmed[`${r.id}|${month}`]).reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const limitTotal = Object.values(L.budgets).reduce((a, v) => a + (Number(v) || 0), 0);
  const left = limitTotal - spentCat;
  const forecastLeft = left - unpaid;
  const percent = limitTotal ? Math.round((spentCat / limitTotal) * 100) : 0;
  const status = percent >= 100 ? 'over' : percent >= 80 || forecastLeft < 0 ? 'warn' : '';
  const categories = [...new Set([...s.categories.expense, ...Object.keys(byCat)])]
    .filter((c) => (Number(L.budgets[c]) || 0) > 0 || byCat[c]);
  const sortedCats = categories.sort((a, b) => {
    const la = Number(L.budgets[a]) || 0; const lb = Number(L.budgets[b]) || 0;
    const pa = la ? (byCat[a] || 0) / la : -1; const pb = lb ? (byCat[b] || 0) / lb : -1;
    return pb - pa || (byCat[b] || 0) - (byCat[a] || 0);
  });
  const categoryRows = sortedCats.map((c) => {
    const lim = Number(L.budgets[c]) || 0; const sp = byCat[c] || 0; const pct = lim ? Math.round((sp / lim) * 100) : 0;
    const cls = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : '';
    return `<div class="bud-row"><div class="budget-category-top"><span class="t">${esc(c)}</span>
      <span class="budget-category-value">${money(sp)}${lim ? ` <span>из ${money(lim)}</span>` : ' <span>без лимита</span>'}</span></div>
      ${lim ? `<div class="bar ${cls}" role="progressbar" aria-label="${esc(c)}: потрачено ${money(sp)} из ${money(lim)}" aria-valuemin="0" aria-valuemax="${lim}" aria-valuenow="${Math.min(sp, lim)}"><div style="width:${Math.min(100, pct)}%"></div></div>
      <div class="budget-category-note">${pct >= 100 ? `Превышение ${money(sp - lim)}` : `Осталось ${money(lim - sp)}`}</div>` : ''}</div>`;
  }).join('');
  const people = s.people.map((p) => {
    const sp = visible().filter((o) => o.type !== 'income' && o.personId === p.id && o.date.startsWith(month))
      .reduce((a, o) => a + (Number(o.amount) || 0), 0);
    const lim = Number(L.allowances[p.id]) || 0;
    if (!lim) return '';
    const pct = Math.round((sp / lim) * 100);
    const cls = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : '';
    return `<div class="bud-row">
      <div class="budget-category-top"><span class="t">${esc(p.name)}</span>
        <span class="budget-category-value">${money(sp)} <span>из ${money(lim)}</span></span></div>
      <div class="bar ${cls}" role="progressbar" aria-label="${esc(p.name)}: потрачено ${money(sp)} из ${money(lim)}" aria-valuemin="0" aria-valuemax="${lim}" aria-valuenow="${Math.min(sp, lim)}"><div style="width:${Math.min(100, pct)}%"></div></div>
      <div class="budget-category-note">${pct >= 100 ? `Превышение ${money(sp - lim)}` : `Осталось ${money(lim - sp)}`}</div></div>`;
  }).join('');
  const main = limitTotal ? `<div class="budget-main-numbers"><div><span>Потрачено</span><strong>${money(spentCat)}</strong></div>
      <div class="budget-main-limit"><span>из лимита</span><strong>${money(limitTotal)}</strong></div></div>
    <div class="budget-main-track ${status}" role="progressbar" aria-label="Потрачено ${money(spentCat)} из лимита ${money(limitTotal)}" aria-valuemin="0" aria-valuemax="${limitTotal}" aria-valuenow="${Math.min(spentCat, limitTotal)}"><i style="width:${Math.min(100, percent)}%"></i></div>
    <div class="budget-main-caption">${percent >= 100 ? `Лимит превышен на ${money(spentCat - limitTotal)}` : `${percent}% лимита · осталось ${money(left)}`}</div>`
    : `<div class="budget-no-limit"><strong>Лимит расходов не задан</strong><span>Фактически потрачено ${money(spent)}. Задайте лимиты, чтобы видеть остаток бюджета.</span>
      <button class="btn soft" data-act="limEdit">Задать лимиты</button></div>`;
  const stats = limitTotal ? `<div class="budget-facts"><div><span>Остаток лимита</span><b class="${left < 0 ? 'neg' : 'pos'}">${money(left)}</b></div>
      <div><span>Предстоит платежей</span><b>${money(unpaid)}</b></div>
      <div><span>Останется после платежей</span><b class="${forecastLeft < 0 ? 'neg' : ''}">${money(forecastLeft)}</b></div></div>`
    : `<div class="budget-facts budget-facts-unlimited"><div><span>Предстоит платежей</span><b>${money(unpaid)}</b></div></div>`;
  return `<div class="card budget-overview"><div class="budget-overview-head"><div><div class="eyebrow">${esc(monthTitle(month))}</div><div class="setting-title">Расходы месяца</div></div>
      ${limitTotal ? `<span class="budget-status ${status}">${percent >= 100 ? 'Лимит превышен' : forecastLeft < 0 ? 'Риск превышения' : percent >= 80 ? 'Лимит почти исчерпан' : 'В пределах лимита'}</span>` : ''}</div>
      ${main}${stats}<p class="budget-footnote">Предстоящие платежи не включены в уже потраченные суммы. Траты с отметкой «Чей» при заданном личном лимите списываются с него, а не с лимита категории.</p></div>
    <div class="card"><div class="setting-title">Расходы по категориям</div>
      <p class="setting-desc">Категории с наибольшей долей лимита показаны первыми. Жёлтый индикатор — от 80%, красный — лимит исчерпан.</p>
      ${categoryRows || '<div class="empty">Операций за этот месяц пока нет.</div>'}</div>
    ${people ? `<div class="card"><div class="setting-title">Личные лимиты</div>
      <p class="setting-desc">Учитываются траты участника семьи; личные операции другого участника не входят в расчёт.</p>${people}</div>` : ''}
    ${budgetSettingsHtml()}`;
}

// Настройки → Финансы: лимиты по тратам. Инфографика по категориям; шестерёнка открывает все категории.
// Новые значения действуют с следующего месяца.
export function budgetSettingsHtml() {
  const s = S();
  const curYm = today().slice(0, 7);
  const cur = limitsFor(curYm);
  const nxt = nextMonthYm();
  const pend = (s.budgetPlans || []).find((p) => p.from === nxt);
  const L = pend ? pend.budgets : cur.budgets;
  const cats = s.categories.expense.filter((c) => Number(L[c]) > 0).length;
  const people = Object.values(pend ? pend.allowances || {} : cur.allowances || {}).filter((v) => Number(v) > 0).length;
  const total = Object.values(L || {}).reduce((a, v) => a + (Number(v) || 0), 0);
  return `<div class="card budget-settings">
      <div class="budget-config-head"><div><div class="eyebrow">Планирование</div><div class="setting-title">Лимиты бюджета</div></div>
        <button class="btn soft" data-act="limEdit">Настроить</button></div>
      <p class="setting-desc">${pend ? 'План лимитов на следующий месяц уже подготовлен.' : 'Новые значения начнут действовать со следующего месяца и не изменят прошлые расходы.'}</p>
      <div class="budget-config-grid"><div><b>${money(total)}</b><span>лимиты по категориям в месяц</span></div>
        <div><b>${cats}</b><span>${cats === 1 ? 'категория с лимитом' : 'категорий с лимитами'}</span></div>
        <div><b>${people}</b><span>${people === 1 ? 'личный лимит' : 'личных лимитов'}</span></div></div>
      ${cats ? '' : '<div class="empty">Лимиты пока не заданы. Можно планировать бюджет по категориям и участникам семьи.</div>'}
    </div>`;
}

// Шестерёнка: все категории и личные лимиты в одном окне.
function limEditHtml() {
  const s = S();
  const curYm = today().slice(0, 7);
  const nxt = nextMonthYm();
  const pend = (s.budgetPlans || []).find((p) => p.from === nxt);
  const cur = limitsFor(curYm);
  const B = pend ? pend.budgets : cur.budgets;
  const A = pend ? pend.allowances : cur.allowances;
  const av = closedAverages();
  const avgNote = (v) => (v > 0 ? `<small class="lim-avg">в среднем ${money(Math.round(v))}</small>` : '');
  const rows = s.categories.expense.map((c) => `<div class="lim-row"><span>${esc(c)}${avgNote(av.byCat[c])}</span>
      <input data-bud="${esc(c)}" data-avg="${roundAvg(av.byCat[c])}" inputmode="decimal" placeholder="без лимита" value="${Number(B[c]) || ''}" aria-label="Лимит: ${esc(c)}"></div>`).join('');
  const people = s.people.map((p) => `<div class="lim-row"><span>${esc(p.name)}${avgNote(av.byPerson[p.id])}</span>
      <input data-alw="${p.id}" data-avg="${roundAvg(av.byPerson[p.id])}" inputmode="decimal" placeholder="без лимита" value="${Number(A[p.id]) || ''}" aria-label="Личный лимит: ${esc(p.name)}"></div>`).join('');
  const avgBlock = av.months
    ? `<div class="lim-avg-box"><span>Средние расходы посчитаны по ${av.months} закрытым ${monthsWord(av.months)}; обновляются при закрытии месяца.</span>
        <button class="btn soft" type="button" data-act="limFillAvg">Подставить средние в пустые поля</button></div>`
    : '<p class="note">Подсказки со средними расходами появятся после закрытия первого месяца в «Финансах».</p>';
  return `<p class="setting-desc">Новые лимиты действуют с ${esc(monthTitle(nxt))}. Пустое поле — без лимита.</p>
    ${avgBlock}
    <div class="sub-title">По категориям, ₽ в месяц</div>${rows}
    ${people ? `<div class="sub-title">Личные, ₽ в месяц</div>${people}` : ''}
    <div style="margin-top:12px"><button class="btn block" id="lim-save">Сохранить</button></div>`;
}

// Период отчёта на вкладке «Год»: месяц или весь год. Выбор хранится до перезагрузки.
let REPORT_PERIOD = null;

function yearHtml(month) {
  const s = S();
  const y = month.slice(0, 4);
  const curYm = today().slice(0, 7);
  const ops = visible();
  const rows = Array.from({ length: 12 }, (_, i) => {
    const ym = `${y}-${String(i + 1).padStart(2, '0')}`;
    const future = ym > curYm;
    const hist = s.history_json && s.history_json[ym];
    const monthOps = ops.filter((o) => o.date.startsWith(ym));
    const planVisible = !hist && ym >= curYm;
    return { ym, label: MONTHS_SHORT[i], future, closed: Boolean(hist),
      incPlan: planVisible ? s.incomes.filter((x) => x.active).reduce((a, x) => a + (Number(x.amount) || 0), 0) : 0,
      incFact: hist ? Number(hist.total_income) || 0 : sumInc(monthOps),
      exp: planVisible ? s.recurring.filter((x) => x.active).reduce((a, x) => a + (Number(x.amount) || 0), 0) : 0,
      expenseFact: hist ? Number(hist.total_expense) || 0 : sumExp(monthOps) };
  });
  const yearPlan = rows.reduce((a, r) => a + r.incPlan, 0);
  const yearFact = rows.reduce((a, r) => a + (r.future ? 0 : r.incFact), 0);
  const max = Math.max(1, ...rows.flatMap((r) => [r.incPlan, r.incFact, r.exp, r.expenseFact]));
  const pct = (v) => Math.round((v / max) * 100);
  const period = REPORT_PERIOD && REPORT_PERIOD.startsWith(y) ? REPORT_PERIOD : month;
  const options = [[y, `Весь ${y} год`], ...rows.map((r) => [r.ym, monthTitle(r.ym)])]
    .map(([v, l]) => `<option value="${v}" ${v === period ? 'selected' : ''}>${esc(l)}</option>`).join('');
  return `<div class="card">
      <div class="row" style="justify-content:space-between;align-items:center">
        <button class="icon-btn" data-act="finMonth" data-d="-12" aria-label="Предыдущий год">${svg('left', 18)}</button>
        <div class="setting-title" style="margin:0">Доходы и расходы, ${y}</div>
        <button class="icon-btn" data-act="finMonth" data-d="12" aria-label="Следующий год">${svg('right', 18)}</button></div>
      <p class="setting-desc">Закрытые месяцы показывают фактические итоги. План отображается для текущего и будущих месяцев.</p>
      <div class="year-legend"><span><i class="lg inc plan"></i>Доход, план</span><span><i class="lg inc"></i>Доход, факт</span><span><i class="lg exp"></i>Расход, план или факт</span></div>
      ${rows.map((r) => `<div class="year-row"><span class="ym">${r.label}</span>
        <div class="year-bars">
          <div class="yb-track"><div class="yb inc plan" style="width:${pct(r.incPlan)}%"></div>${r.future ? '' : `<div class="yb inc" style="width:${pct(r.incFact)}%"></div>`}</div>
          <div class="yb-track"><div class="yb exp" style="width:${pct(r.closed ? r.expenseFact : r.exp)}%"></div></div></div>
        <span class="yv"><span class="inc-t">${r.future ? '—' : money(r.incFact)}</span> <span class="plan-t">${r.incPlan ? 'из ' + money(r.incPlan) : (r.closed ? '· факт' : '')}</span><br><span class="exp-t">${money(r.closed ? r.expenseFact : r.exp)}${r.closed ? ' · факт' : ''}</span></span></div>`).join('')}
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
  const balance = income - expense;
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
    <div class="stat"><div class="lbl">Разница доходов и расходов</div><div class="val ${balance >= 0 ? 'pos' : 'neg'}">${balance >= 0 ? '+' : '−'}${money(Math.abs(balance))}</div><div class="note">${income ? `Сбережено ${Math.round(balance / income * 100)}% дохода` : 'Доходов за период нет'}</div></div>
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

function simpleForm(title, fields, onSave) {
  F.openForm(title, fields, onSave);
}

export const FEATURE_ADD = {
  addList: () => simpleForm('Новый список', [{ k: 'title', t: 'text', l: 'Название', ph: 'Продукты на выходные' }], (o) => {
    if (!o.title) return 'Введите название';
    S().lists.push({ id: uid(), title: o.title, items: [] });
    return null;
  })
};

const itemOf = (coll, id) => S()[coll].find((x) => x.id === id);

export const FEATURE_ACTIONS = {
  limEdit: () => {
    F.openModal('Лимиты по тратам', limEditHtml());
    document.querySelector('#lim-save').onclick = () => {
      FEATURE_ACTIONS.saveBudgets();
      F.closeModal();
      F.render();
    };
    return false;
  },
  limFillAvg: () => {
    let n = 0;
    document.querySelectorAll('[data-bud],[data-alw]').forEach((i) => {
      if (String(i.value).trim() === '' && i.dataset.avg) { i.value = i.dataset.avg; n += 1; }
    });
    F.toast(n ? `Подставлено значений: ${n}. Проверьте и нажмите «Сохранить»` : 'Пустых полей со средним нет');
    return false;
  },
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
      <button class="icon-btn" data-act="editInc" data-id="${i.id}" aria-label="Изменить">${svg('edit', 18)}</button>
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
    { k: 'personId', t: 'select', l: 'Чьё', opts: personOptsReal(), v: me() }
  ], (o) => {
    if (!o.title || o.amount === '' || o.amount <= 0) return 'Заполните название и сумму';
    S().incomes.push({ id: uid(), title: o.title, amount: o.amount, day: Math.min(31, Math.max(1, Number(o.day) || 1)),
      category: o.category, personId: o.personId, active: true });
    return null;
  })
};

export const EXTRA_ACTIONS = {
  remNav: (d) => { ensureCalState(); REM_MONTH = shiftYm(REM_MONTH, Number(d.d)); },
  remPick: (d) => { REM_DAY = d.day; REM_MONTH = d.day.slice(0, 7); },
  incToggle: (d) => { const i = S().incomes.find((x) => x.id === d.id); i.active = !i.active; },
  editInc: (d) => {
    const i = S().incomes.find((x) => x.id === d.id);
    if (!i) return false;
    F.openForm('Регулярное поступление', [
      { k: 'title', t: 'text', l: 'Название', v: i.title },
      { k: 'amount', t: 'number', l: 'Сумма', v: i.amount },
      { k: 'day', t: 'number', l: 'День месяца (1–31)', v: i.day },
      { k: 'category', t: 'select', l: 'Категория', opts: S().categories.income.map((c) => [c, c]), v: i.category },
      { k: 'personId', t: 'select', l: 'Чьё', opts: personOptsReal(), v: i.personId || '' }
    ], (o) => {
      if (!o.title || o.amount === '' || o.amount <= 0) return 'Заполните название и сумму';
      Object.assign(i, { title: o.title, amount: o.amount, day: Math.min(31, Math.max(1, Number(o.day) || 1)),
        category: o.category, personId: o.personId });
      return null;
    });
    return false;
  },
  incConfirm: (d) => {
    const i = S().incomes.find((x) => x.id === d.id);
    F.openForm(`Поступление: ${i.title}`, [
      { k: 'amt', t: 'number', l: 'Сумма, которая пришла', v: i.amount },
      { k: 'date', t: 'date', l: 'Дата прихода', v: today() }
    ], (o) => {
      if (!o.amt || o.amt <= 0) return 'Введите сумму';
      S().transactions.push({ id: uid(), type: 'income', amount: o.amt, date: o.date || today(), category: i.category || 'Зарплата',
        personId: i.personId || '', private: false,
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
    <div class="cal-legend-row"><div class="cal-legend">${legend}</div>
      <button class="icon-btn" data-act="remCatsOpen" aria-label="Категории напоминаний">⚙</button></div>
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
const catColor = (id) => (BUILTIN_CATS.includes(id) ? `cal-${id}` : 'cal-custom');
// Окно «Категории напоминаний» открывается шестерёнкой в календаре.
function remCatsModalHtml() {
  const cats = remCatList();
  const rows = cats.map((c) => {
    const editing = REM_CAT_EDIT === c.id;
    return `<div class="rc-row ${c.on ? '' : 'is-off'}">
      <i class="cal-dot ${catColor(c.id)}"></i>
      ${editing ? `<input id="rc_${c.id}" class="rc-input" value="${esc(c.name)}" aria-label="Название категории" maxlength="40">`
                : `<span class="rc-name">${esc(c.name)}</span>`}
      <button class="icon-btn" data-act="remCatEdit" data-id="${c.id}" aria-label="${editing ? 'Готово' : 'Переименовать'}">${svg(editing ? 'check' : 'edit', 18)}</button>
      ${editing && !BUILTIN_CATS.includes(c.id) ? `<button class="icon-btn" data-act="remCatDel" data-id="${c.id}" aria-label="Удалить категорию">${X()}</button>` : ''}
      <button class="rc-switch" role="switch" aria-checked="${c.on}" data-act="remCatToggle" data-id="${c.id}" aria-label="Показывать: ${esc(c.name)}"><i></i></button>
    </div>`;
  }).join('');
  return `<p class="setting-desc">Выключенная категория скрывается из календаря и колокольчика.</p>
    <div class="rc-list">${rows}</div>
    <div class="rc-add"><input id="rc_new" placeholder="Новая категория, например «Вывоз мусора»" aria-label="Новая категория" maxlength="40">
      <button class="btn" data-act="remCatAdd">Добавить</button></div>`;
}
const refreshCatsModal = () => F.openModal('Категории напоминаний', remCatsModalHtml());

export function dashTop() {
  const t = today();
  const month = t.slice(0, 7);
  const s = S();
  const monthOps = visible().filter((o) => o.date.startsWith(month));
  const income = sumInc(monthOps);
  const expense = sumExp(monthOps);
  const dailyAvg = dailyAvgOf(visible(), t);
  const [y, m] = month.split('-').map(Number);
  const dayNow = Number(t.slice(8));
  const left = lastDay(y, m) - dayNow;
  const unpaid = s.recurring.filter((r) => r.active && !s.confirmed[`${r.id}|${month}`]).reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const end = expense + unpaid + dailyAvg * left;
  // Поступления, которые ещё не подтверждены в этом месяце, входят в прогноз дохода.
  const incomeLeft = s.incomes.filter((i) => i.active && !s.incomeConfirmed[`${i.id}|${month}`])
    .reduce((a, i) => a + (Number(i.amount) || 0), 0);
  const incomeEnd = income + incomeLeft;
  const balance = income - expense;
  const spendPct = income ? Math.min(100, Math.max(0, Math.round(expense / income * 100))) : 0;
  return `<section class="home-finance card">
    <div class="home-finance-head"><div><div class="eyebrow">Финансы</div><div class="setting-title" style="margin:2px 0 0">${esc(monthTitle(month))}</div></div>
      <button class="btn soft" data-act="sec" data-v="fin">Обзор →</button></div>
    <div class="home-balance"><span>Разница доходов и расходов</span><strong class="${balance >= 0 ? 'pos' : 'neg'}">${balance >= 0 ? '+' : '−'}${money(Math.abs(balance))}</strong></div>
    <div class="home-flow"><div><span>Пришло</span><b>${money(income)}</b><small>≈ ${money(incomeEnd)} к концу месяца</small></div>
      <div><span>Потрачено</span><b>${money(expense)}</b><small>≈ ${money(end)} к концу месяца</small></div></div>
    <div class="home-spend-track"><i style="width:${spendPct}%"></i></div>
    <div class="note">${left ? `Прогноз учитывает платежи и поступления; до конца месяца ${left} дн.` : 'Итог за текущий месяц'}</div>
  </section>`;
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
    const nm = document.getElementById('rc_' + c.id);
    if (nm && nm.value.trim()) c.name = nm.value.trim();
  }
  return cats;
}

export const EXTRA_CATS_ACTIONS = {
  remCatsOpen: () => { refreshCatsModal(); return false; },
  remCatToggle: (d) => {
    const cats = readCatsFromDom();
    const c = cats.find((x) => x.id === d.id);
    if (c) c.on = !c.on;
    S().remCats = cats;
    refreshCatsModal();
  },
  remCatAdd: () => {
    const name = (document.getElementById('rc_new')?.value || '').trim();
    if (!name) return false;
    S().remCats = [...readCatsFromDom(), { id: 'c' + uid(), name, on: true }];
    refreshCatsModal();
  },
  remCatEdit: (d) => {
    const cats = readCatsFromDom();
    REM_CAT_EDIT = REM_CAT_EDIT === d.id ? null : d.id;
    S().remCats = cats;
    refreshCatsModal();
  },
  remCatDel: (d) => {
    S().remCats = readCatsFromDom().filter((c) => c.id !== d.id);
    REM_CAT_EDIT = null;
    for (const r of S().reminders) if (r.cat === d.id) r.cat = 'rem';
    refreshCatsModal();
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
