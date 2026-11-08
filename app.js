import { menuHtml, menuBind, menuInit, menuSummaryHtml } from './menu/menu.js?v=a7';
import { iso, todayIso, addDays, daysBetween, upcoming, monthSummary, fuelStats, debtMonths, goalPct } from './core.js';

// ---------- помощники ----------
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const read = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const save = () => write('as.data', S);
const money = (n) => `${Math.round(Number(n) || 0).toLocaleString('ru-RU')} ${S.settings.currency}`;
const fmtDate = (s) => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}.${m}.${y}`; };
const monthName = (ym) => { const [y, m] = ym.split('-'); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }); };
const shiftMonth = (ym, k) => { const d = new Date(ym + '-01T00:00'); d.setMonth(d.getMonth() + k); return iso(d).slice(0, 7); };
const personName = (id) => (S.people.find((p) => p.id === id) || {}).name || '';
const personOpts = () => [['', 'Общее'], ...S.people.map((p) => [p.id, p.name])];
const catAll = () => [...new Set([...S.categories.expense, ...S.categories.income])].map((c) => [c, c]);
const accOpts = () => S.accounts.map((a) => [a.id, a.name]);
const need = (o, keys) => keys.every((k) => o[k] !== '' && o[k] !== undefined && !(typeof o[k] === 'number' && isNaN(o[k])));
const safeUrl = (u) => (/^https?:\/\//.test(u || '') ? esc(u) : '');

// Иконки: один набор линий, один стиль.
const ICON = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  menu: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10"/><path d="M17 21V3c-2 1-3 3-3 6s1 4 3 4"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  dots: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  car: '<path d="M5 16v-5l2-5h10l2 5v5"/><path d="M3 16h18v3H3z"/><circle cx="7.5" cy="16" r="1.5"/><circle cx="16.5" cy="16" r="1.5"/>',
  house: '<path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-5h4v5"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'
};
const svg = (name, size = 22) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;
const X = svg('x', 18);

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}

// ---------- состояние ----------
let S = null;
let ME = null;
let SEC = 'dash';
let FIN_MONTH = todayIso().slice(0, 7);
let FIN_TAB = 'ops';
let GOAL_KIND = 'long';
let HOUSE_TAB = 'tasks';
let CAR_ID = null;

// Разделы: нижняя панель (5 пунктов) и разделы внутри «Ещё».
const SECTIONS = [
  ['dash', 'Главная'], ['menu', 'Меню'], ['fin', 'Финансы'], ['goals', 'Цели'],
  ['rem', 'Напоминания'], ['car', 'Авто'], ['house', 'Дом']
];
const NAV = [
  ['dash', 'home', 'Главная'], ['menu', 'menu', 'Меню'], ['fin', 'wallet', 'Финансы'],
  ['goals', 'target', 'Цели'], ['more', 'dots', 'Ещё']
];
const MORE_SECTIONS = ['more', 'rem', 'car', 'house', 'settings'];
const MORE_ITEMS = [['rem', 'calendar', 'Напоминания', 'Свои напоминания и даты'], ['car', 'car', 'Авто', 'Машины, расходы, сроки'],
  ['house', 'house', 'Дом', 'Дела по дому и счётчики'], ['settings', 'gear', 'Настройки', 'Участники, счета, категории, данные']];

// ---------- формы ----------
function fieldHtml(f) {
  const id = 'f_' + f.k;
  const val = f.v ?? '';
  if (f.t === 'check') return `<label class="chk"><input type="checkbox" id="${id}" ${f.v ? 'checked' : ''}> ${esc(f.l)}</label>`;
  if (f.t === 'select') {
    return `<label class="field" for="${id}">${esc(f.l)}</label><select id="${id}">${f.opts.map(([v, l]) =>
      `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  }
  if (f.t === 'area') return `<label class="field" for="${id}">${esc(f.l)}</label><textarea id="${id}" rows="2">${esc(val)}</textarea>`;
  const inputmode = f.t === 'number' ? 'decimal' : '';
  return `<label class="field" for="${id}">${esc(f.l)}</label><input id="${id}" type="${f.t || 'text'}" inputmode="${inputmode}" value="${esc(val)}" placeholder="${esc(f.ph || '')}">`;
}

function openForm(title, fields, onSave) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = `<div class="form">${fields.map(fieldHtml).join('')}
    <button class="btn block" id="f-save" style="margin-top:6px">Сохранить</button></div>`;
  $('#modal').classList.remove('hidden');
  $('#f-save').onclick = () => {
    const out = {};
    for (const f of fields) {
      const el = $('#f_' + f.k);
      if (f.t === 'check') out[f.k] = el.checked;
      else if (f.t === 'number') out[f.k] = el.value === '' ? '' : parseFloat(String(el.value).replace(',', '.'));
      else out[f.k] = el.value.trim();
    }
    const err = onSave(out);
    if (err) return toast(err);
    save();
    closeModal();
    render();
  };
}
function closeModal() { $('#modal').classList.add('hidden'); }

// ---------- общие куски разметки ----------
const liUp = (x) => `<div class="li ${x.overdue ? 'overdue' : ''}">
  <span class="dot ${x.kind}"></span>
  <div class="main"><div class="t">${esc(x.title)}</div>
  <div class="s">${fmtDate(x.date)}${x.personId ? ' · ' + esc(personName(x.personId)) : ''}${x.overdue ? ' · просрочено' : ''}</div></div>
  ${x.amount ? `<div class="amt">${money(x.amount)}</div>` : ''}</div>`;

const goalRow = (g) => `<div class="li" style="display:block">
  <div class="row" style="justify-content:space-between"><span class="t">${esc(g.title)}</span><span class="note">${goalPct(g)}%</span></div>
  <div class="bar"><div style="width:${goalPct(g)}%"></div></div></div>`;

const opRow = (t) => `<div class="li">
  <div class="main"><div class="t">${esc(t.category)}${t.private ? '<span class="badge-private">личное</span>' : ''}</div>
  <div class="s">${fmtDate(t.date)}${t.note ? ' · ' + esc(t.note) : ''}${t.personId ? ' · ' + esc(personName(t.personId)) : ''}</div></div>
  <div class="amt ${t.type === 'income' ? 'inc' : 'exp'}">${t.type === 'income' ? '+' : '−'}${money(t.amount)}</div>
  <button class="icon-btn" data-act="del" data-coll="transactions" data-id="${t.id}" aria-label="Удалить">${X}</button></div>`;

const CAR_TYPES = { fuel: 'Топливо', service: 'ТО', repair: 'Ремонт', wash: 'Мойка', parking: 'Парковка', fine: 'Штраф', other: 'Прочее' };
const REPEAT = { none: 'однократно', month: 'каждый месяц', year: 'каждый год' };

// ---------- регулярные платежи: операция появляется только после подтверждения ----------
// Срок платежа в текущем месяце: день из настроек, но не позже последнего дня месяца.
function dueDateOf(r, ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${ym}-${String(Math.min(r.day, last)).padStart(2, '0')}`;
}
const payKey = (r, ym) => `${r.id}|${ym}`;

// Платежи, срок которых уже наступил в этом месяце и которые ещё не проведены и не пропущены.
function pendingPayments(today = todayIso()) {
  const ym = today.slice(0, 7);
  const done = S.confirmed || {};
  return S.recurring
    .filter((r) => r.active && dueDateOf(r, ym) <= today && !done[payKey(r, ym)])
    .map((r) => ({ r, ym, date: dueDateOf(r, ym) }));
}

function resolvePayment(rid, ym, status) {
  const r = S.recurring.find((x) => x.id === rid);
  if (!r) return;
  S.confirmed = S.confirmed || {};
  if (status === 'ok') {
    S.transactions.push({
      id: uid(), type: 'expense', amount: r.amount, date: dueDateOf(r, ym), category: r.category || 'Прочее',
      account: r.account || '', personId: r.personId || '', private: false,
      note: `Регулярный: ${r.title}`, fromRecurring: r.id
    });
  }
  S.confirmed[payKey(r, ym)] = { status, at: todayIso() };
}

function pendingHtml() {
  const list = pendingPayments();
  if (!list.length) return '';
  return `<div class="card pending">
    <div class="setting-title">К подтверждению</div>
    <p class="setting-desc">Проведите платёж, когда он действительно прошёл. Пропущенный в учёт не попадёт.</p>
    ${list.map(({ r, ym, date }) => `<div class="li">
      <div class="main"><div class="t">${esc(r.title)}</div>
      <div class="s">${fmtDate(date)} · ${esc(personName(r.personId) || 'Общее')}</div></div>
      <div class="amt exp">−${money(r.amount)}</div>
      <button class="btn soft" data-act="payOk" data-id="${r.id}" data-ym="${ym}">Провести</button>
      <button class="icon-btn" data-act="paySkip" data-id="${r.id}" data-ym="${ym}" aria-label="Пропустить">${X}</button></div>`).join('')}
  </div>`;
}

// ---------- разделы ----------
function viewDash() {
  const t = todayIso();
  const ym = t.slice(0, 7);
  const s = monthSummary(S, ym, ME);
  const up = upcoming(S, t, 14);
  return `
    ${menuSummaryHtml()}
    <div class="grid-2" style="margin-bottom:12px">
      <div class="stat"><div class="lbl">Доходы, ${monthName(ym)}</div><div class="val pos">${money(s.income)}</div></div>
      <div class="stat"><div class="lbl">Расходы</div><div class="val neg">${money(s.expense)}</div></div>
    </div>
    <div class="card"><div class="setting-title">Ближайшие 14 дней</div>
      ${up.length ? up.map(liUp).join('') : '<div class="empty">Ничего не запланировано</div>'}</div>
    <div class="card"><div class="setting-title">Цели</div>
      ${S.goals.length ? S.goals.slice(0, 3).map(goalRow).join('') : '<div class="empty">Целей пока нет</div>'}</div>
    `;
}

function viewFin() {
  const s = monthSummary(S, FIN_MONTH, ME);
  const top = `<div class="row" style="justify-content:space-between;margin-bottom:10px">
    <button class="icon-btn" data-act="finMonth" data-d="-1" aria-label="Предыдущий месяц">${svg('left', 18)}</button>
    <strong style="text-transform:capitalize">${monthName(FIN_MONTH)}</strong>
    <button class="icon-btn" data-act="finMonth" data-d="1" aria-label="Следующий месяц">${svg('right', 18)}</button></div>`;
  const stats = `<div class="grid-2" style="margin-bottom:12px">
    <div class="stat"><div class="lbl">Доходы</div><div class="val pos">${money(s.income)}</div></div>
    <div class="stat"><div class="lbl">Расходы</div><div class="val neg">${money(s.expense)}</div></div></div>`;
  const tabs = `<div class="tabline">${[['ops', 'Операции'], ['rec', 'Регулярные'], ['debt', 'Долги']]
    .map(([v, l]) => `<button class="${FIN_TAB === v ? 'active' : ''}" data-act="finTab" data-v="${v}">${l}</button>`).join('')}</div>`;

  let body = '';
  if (FIN_TAB === 'ops') {
    const cats = Object.entries(s.byCategory).sort((a, b) => b[1] - a[1]);
    const ops = S.transactions
      .filter((t) => t.date.startsWith(FIN_MONTH) && (!t.private || t.personId === ME))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    body += `<div class="card"><div class="setting-title">По категориям</div>
      ${cats.length ? cats.map(([c, v]) => `<div style="margin:8px 0">
        <div class="row" style="justify-content:space-between"><span>${esc(c)}</span><b>${money(v)}</b></div>
        <div class="bar"><div style="width:${s.expense ? Math.round((v / s.expense) * 100) : 0}%"></div></div></div>`).join('')
        : '<div class="empty">Расходов нет</div>'}</div>
      <div class="card"><div class="row" style="justify-content:space-between">
        <div class="setting-title">Операции</div><button class="btn" data-act="addOp">+ Операция</button></div>
        ${ops.length ? ops.map(opRow).join('') : '<div class="empty">Операций за месяц нет</div>'}</div>`;
  } else if (FIN_TAB === 'rec') {
    const monthly = S.recurring.filter((r) => r.active).reduce((a, r) => a + Number(r.amount), 0);
    body += pendingHtml();
    body += `<div class="card"><div class="row" style="justify-content:space-between">
      <div class="setting-title">Регулярные платежи</div><button class="btn" data-act="addRec">+ Платёж</button></div>
      ${S.recurring.length ? S.recurring.map((r) => `<div class="li">
        <div class="main"><div class="t">${esc(r.title)}${r.personId ? `<span class="badge-private">${esc(personName(r.personId))}</span>` : ''}</div>
        <div class="s">${r.day}-го числа · ${esc(r.category || '')}${r.active ? '' : ' · на паузе'}</div></div>
        <div class="amt">${money(r.amount)}</div>
        <button class="icon-btn" data-act="toggleRec" data-id="${r.id}" aria-label="${r.active ? 'Пауза' : 'Возобновить'}">${svg(r.active ? 'pause' : 'play', 18)}</button>
        <button class="icon-btn" data-act="del" data-coll="recurring" data-id="${r.id}" aria-label="Удалить">${X}</button></div>`).join('')
        : '<div class="empty">Регулярных платежей нет</div>'}
      <p class="note">Итого в месяц: ${money(monthly)}</p></div>`;
  } else {
    body += `<div class="card"><div class="row" style="justify-content:space-between">
      <div class="setting-title">Долги и кредиты</div><button class="btn" data-act="addDebt">+ Долг</button></div>
      ${S.debts.length ? S.debts.map((d) => {
        const m = debtMonths(d.remaining, d.monthly);
        const paid = d.total ? Math.round((1 - d.remaining / d.total) * 100) : 0;
        return `<div class="li" style="display:block">
          <div class="row" style="justify-content:space-between"><div class="t">${esc(d.title)}</div><b>${money(d.remaining)}</b></div>
          <div class="s">Платёж ${money(d.monthly)} · ${d.dueDay}-го числа${m ? ` · осталось около ${m} мес.` : ''}</div>
          <div class="bar"><div style="width:${paid}%"></div></div>
          <div class="row" style="margin-top:8px">
            <button class="btn soft" data-act="payDebt" data-id="${d.id}">Внести платёж</button>
            <button class="icon-btn" data-act="del" data-coll="debts" data-id="${d.id}" aria-label="Удалить">${X}</button></div></div>`;
      }).join('') : '<div class="empty">Долгов нет</div>'}</div>`;
  }
  return top + stats + tabs + body;
}

function goalCard(g) {
  const pct = goalPct(g);
  const left = Math.max(0, (g.target || 0) - (g.saved || 0));
  let perMonth = null;
  if (g.deadline) {
    const months = Math.max(1, Math.ceil(daysBetween(todayIso(), g.deadline) / 30));
    perMonth = left / months;
  }
  return `<div class="card">
    <div class="row" style="justify-content:space-between">
      <div><div class="setting-title" style="margin:0">${esc(g.title)}</div>
      <div class="note">${personName(g.personId) || 'Общая'}${g.deadline ? ' · до ' + fmtDate(g.deadline) : ''}</div></div>
      <button class="icon-btn" data-act="del" data-coll="goals" data-id="${g.id}" aria-label="Удалить">${X}</button></div>
    <div class="row" style="justify-content:space-between;margin-top:10px"><b>${money(g.saved)}</b>
      <span class="note">из ${money(g.target)} · ${pct}%</span></div>
    <div class="bar"><div style="width:${pct}%"></div></div>
    ${perMonth !== null && left > 0 ? `<div class="note" style="margin-top:6px">Откладывать около ${money(perMonth)} в месяц</div>` : ''}
    <div class="row" style="margin-top:10px"><button class="btn soft" data-act="topUp" data-id="${g.id}">Пополнить</button></div>
  </div>`;
}

function viewGoals() {
  const tabs = `<div class="tabline">
      <button class="${GOAL_KIND === 'long' ? 'active' : ''}" data-act="goalKind" data-v="long">Долгосрочные</button>
      <button class="${GOAL_KIND === 'short' ? 'active' : ''}" data-act="goalKind" data-v="short">Краткосрочные</button>
      <button class="${GOAL_KIND === 'wish' ? 'active' : ''}" data-act="goalKind" data-v="wish">Вишлист</button></div>`;
  if (GOAL_KIND === 'wish') return tabs + wishHtml();
  const list = S.goals.filter((g) => g.kind === GOAL_KIND);
  return tabs + `<div class="row" style="justify-content:flex-end;margin-bottom:8px"><button class="btn" data-act="addGoal">+ Цель</button></div>
    ${list.length ? list.map(goalCard).join('') : '<div class="card empty">Целей этого типа пока нет</div>'}`;
}

// Вишлист внутри «Целей»: желания разделены по тому, чьи они.
function wishHtml() {
  const prio = ['', 'Высокий', 'Средний', 'Низкий'];
  const sorted = (list) => [...list].sort((a, b) => (a.bought - b.bought) || (a.priority - b.priority));
  const known = (id) => S.people.some((p) => p.id === id);
  const groups = [
    ...S.people.map((p) => ({ title: p.name, list: sorted(S.wishes.filter((w) => w.personId === p.id)) })),
    { title: 'Общие', list: sorted(S.wishes.filter((w) => !known(w.personId))) }
  ];
  const row = (w) => `<div class="li">
      <button class="icon-btn" data-act="wishBought" data-id="${w.id}" aria-label="${w.bought ? 'Отметить непокупленным' : 'Отметить купленным'}">${svg(w.bought ? 'check' : 'circle', 18)}</button>
      <div class="main"><div class="t" style="${w.bought ? 'text-decoration:line-through;color:var(--done)' : ''}">${esc(w.title)}</div>
        <div class="s">${w.price ? money(w.price) + ' · ' : ''}${prio[w.priority] || ''}${safeUrl(w.url) ? ` · <a href="${safeUrl(w.url)}" target="_blank" rel="noopener">ссылка</a>` : ''}</div></div>
      <button class="icon-btn" data-act="del" data-coll="wishes" data-id="${w.id}" aria-label="Удалить">${X}</button></div>`;
  return `<div class="row" style="justify-content:flex-end;margin-bottom:8px"><button class="btn" data-act="addWish">+ Желание</button></div>
    ${groups.map((g) => `<div class="card"><div class="setting-title">${esc(g.title)}</div>
      ${g.list.length ? g.list.map(row).join('') : '<div class="empty">Желаний пока нет</div>'}</div>`).join('')}`;
}

function viewRem() {
  const up = upcoming(S, todayIso(), 60);
  return `<div class="row" style="justify-content:flex-end;margin-bottom:8px"><button class="btn" data-act="addRem">+ Напоминание</button></div>
    <div class="card"><div class="setting-title">Ближайшие 60 дней</div>
      ${up.length ? up.map(liUp).join('') : '<div class="empty">Событий нет</div>'}</div>
    <div class="card"><div class="setting-title">Свои напоминания</div>
      ${S.reminders.length ? S.reminders.map((r) => `<div class="li">
        <div class="main"><div class="t">${esc(r.title)}</div>
        <div class="s">${fmtDate(r.date)} · ${REPEAT[r.repeat] || ''}${r.personId ? ' · ' + esc(personName(r.personId)) : ''}</div></div>
        <button class="icon-btn" data-act="del" data-coll="reminders" data-id="${r.id}" aria-label="Удалить">${X}</button></div>`).join('')
        : '<div class="empty">Своих напоминаний нет</div>'}</div>`;
}

function carCard(c) {
  const open = CAR_ID === c.id;
  const exps = S.carExpenses.filter((e) => e.carId === c.id).sort((a, b) => (a.date < b.date ? 1 : -1));
  const ym = todayIso().slice(0, 7);
  const month = exps.filter((e) => e.date.startsWith(ym)).reduce((a, e) => a + Number(e.amount), 0);
  const total = exps.reduce((a, e) => a + Number(e.amount), 0);
  const fs = fuelStats(S.carExpenses, c.id);
  return `<div class="card">
    <div class="row" style="justify-content:space-between">
      <div data-act="carOpen" data-id="${c.id}" style="cursor:pointer;flex:1">
        <div class="setting-title" style="margin:0">${esc(c.make)} ${esc(c.model)} ${c.year ? `<span class="note">${esc(c.year)}</span>` : ''}</div>
        <div class="note">${esc(c.plate || '')}${c.mileage ? ' · пробег ' + Number(c.mileage).toLocaleString('ru-RU') + ' км' : ''}</div></div>
      <button class="icon-btn" data-act="del" data-coll="cars" data-id="${c.id}" aria-label="Удалить">${X}</button></div>
    <div class="grid-2" style="margin-top:10px">
      <div class="stat"><div class="lbl">За месяц</div><div class="val">${money(month)}</div></div>
      <div class="stat"><div class="lbl">Расход топлива</div><div class="val">${fs.avg ? fs.avg.toFixed(1) + ' л/100 км' : '—'}</div></div></div>
    ${c.insuranceUntil ? `<div class="note" style="margin-top:8px">Страховка до ${fmtDate(c.insuranceUntil)}</div>` : ''}
    ${c.inspectionUntil ? `<div class="note">Техосмотр до ${fmtDate(c.inspectionUntil)}</div>` : ''}
    ${open ? `<div class="sub-title">Расходы · всего ${money(total)}</div>
      <div class="row" style="justify-content:flex-end"><button class="btn" data-act="addCarExp" data-id="${c.id}">+ Расход</button></div>
      ${exps.length ? exps.map((e) => `<div class="li">
        <div class="main"><div class="t">${CAR_TYPES[e.type] || e.type}${e.liters ? ` · ${e.liters} л` : ''}</div>
        <div class="s">${fmtDate(e.date)}${e.mileage ? ' · ' + Number(e.mileage).toLocaleString('ru-RU') + ' км' : ''}${e.note ? ' · ' + esc(e.note) : ''}</div></div>
        <div class="amt exp">−${money(e.amount)}</div>
        <button class="icon-btn" data-act="del" data-coll="carExpenses" data-id="${e.id}" aria-label="Удалить">${X}</button></div>`).join('')
        : '<div class="empty">Расходов пока нет</div>'}` : ''}
  </div>`;
}

function viewCar() {
  return `<div class="row" style="justify-content:flex-end;margin-bottom:8px"><button class="btn" data-act="addCar">+ Автомобиль</button></div>
    ${S.cars.length ? S.cars.map(carCard).join('') : '<div class="card empty">Добавьте автомобиль, чтобы вести расходы и сроки</div>'}`;
}

function viewHouse() {
  const tabs = `<div class="tabline">
    <button class="${HOUSE_TAB === 'tasks' ? 'active' : ''}" data-act="houseTab" data-v="tasks">Дела</button>
    <button class="${HOUSE_TAB === 'meters' ? 'active' : ''}" data-act="houseTab" data-v="meters">Счётчики</button></div>`;
  if (HOUSE_TAB === 'tasks') {
    const t = todayIso();
    return tabs + `<div class="row" style="justify-content:flex-end;margin-bottom:8px"><button class="btn" data-act="addTask">+ Дело</button></div>
      <div class="card">${S.homeTasks.length ? S.homeTasks.map((x) => {
        const due = x.lastDone ? addDays(x.lastDone, x.everyDays) : t;
        const overdue = due < t;
        return `<div class="li ${overdue ? 'overdue' : ''}">
          <div class="main"><div class="t">${esc(x.title)}</div>
          <div class="s">Каждые ${x.everyDays} дн. · ${overdue ? 'просрочено · ' : ''}${fmtDate(due)}${personName(x.assignee) ? ' · ' + esc(personName(x.assignee)) : ''}</div></div>
          <button class="btn soft" data-act="taskDone" data-id="${x.id}">Сделано</button>
          <button class="icon-btn" data-act="del" data-coll="homeTasks" data-id="${x.id}" aria-label="Удалить">${X}</button></div>`;
      }).join('') : '<div class="empty">Дел по дому пока нет</div>'}</div>`;
  }
  return tabs + `<div class="card">${S.meters.map((m) => {
    const rs = S.meterReadings.filter((r) => r.meterId === m.id).sort((a, b) => (a.date < b.date ? 1 : -1));
    const last = rs[0];
    const prev = rs[1];
    const used = last && prev ? last.value - prev.value : null;
    return `<div class="li">
      <div class="main"><div class="t">${esc(m.name)}</div>
      <div class="s">${last ? `Последнее: ${last.value} ${esc(m.unit)} · ${fmtDate(last.date)}${used !== null ? ` · расход ${used.toFixed(1)} ${esc(m.unit)}` : ''}` : 'Показаний ещё нет'}</div></div>
      <button class="icon-btn" data-act="addReading" data-id="${m.id}" aria-label="Внести показание">${svg('plus', 18)}</button>
      <button class="icon-btn" data-act="del" data-coll="meters" data-id="${m.id}" aria-label="Удалить">${X}</button></div>`;
  }).join('') || '<div class="empty">Счётчиков нет</div>'}
  <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn soft" data-act="addMeter">+ Счётчик</button></div></div>`;
}

// Раздел «Ещё»: всё, что не поместилось в нижнюю панель.
function viewMore() {
  return `<div class="card">${MORE_ITEMS.map(([id, ic, title, sub]) => `
    <button class="more-row" data-act="sec" data-v="${id}">
      <span class="more-ico">${svg(ic, 22)}</span>
      <span class="main"><span class="t">${esc(title)}</span><span class="s">${esc(sub)}</span></span>
      <span class="more-chev">${svg('right', 18)}</span>
    </button>`).join('')}</div>`;
}

function viewPeople() {
  return `
    <div class="card"><div class="setting-title">Кто вы</div>
      <p class="setting-desc">Определяет, чьи личные операции вы видите. Это не защита данных: все данные доступны в браузере.</p>
      <select id="me-select">${S.people.map((p) => `<option value="${p.id}" ${p.id === ME ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
    <div class="card"><div class="row" style="justify-content:space-between"><div class="setting-title">Имена</div>
      <button class="btn soft" data-act="addPerson">+ Человек</button></div>
      <p class="setting-desc">Имя показывается в операциях, целях и на главной.</p>
      ${S.people.map((p) => `<div class="li"><div class="main"><label class="field" for="pn_${p.id}">Имя</label>
        <input id="pn_${p.id}" type="text" value="${esc(p.name)}"></div>
        <button class="icon-btn" data-act="del" data-coll="people" data-id="${p.id}" aria-label="Удалить">${X}</button></div>`).join('')}
      <div class="pill-row"><button class="btn" data-act="saveNames">Сохранить имена</button></div></div>
    <div class="card"><div class="row" style="justify-content:space-between"><div class="setting-title">Счета</div>
      <button class="btn soft" data-act="addAcc">+ Счёт</button></div>
      ${S.accounts.map((a) => `<div class="li"><div class="main"><div class="t">${esc(a.name)}</div>
        <div class="s">${a.owner === 'shared' ? 'общий' : esc(personName(a.owner))}</div></div>
        <button class="icon-btn" data-act="del" data-coll="accounts" data-id="${a.id}" aria-label="Удалить">${X}</button></div>`).join('')}</div>
    <div class="card"><div class="setting-title">Категории</div><p class="setting-desc">Через запятую</p>
      <label class="field" for="cat-exp">Расходы</label><textarea id="cat-exp" rows="2">${esc(S.categories.expense.join(', '))}</textarea>
      <label class="field" for="cat-inc">Доходы</label><textarea id="cat-inc" rows="2">${esc(S.categories.income.join(', '))}</textarea>
      <button class="btn soft" data-act="saveCats">Сохранить категории</button></div>
    <div class="card"><div class="setting-title">Напоминания</div>
      <p class="setting-desc">За сколько дней показывать события в колокольчике.</p>
      <label class="field" for="notify-days">Дней заранее</label><input id="notify-days" type="number" min="0" max="30" value="${S.settings.notifyDaysAhead}">
      <div class="pill-row"><button class="btn soft" data-act="saveSettings">Сохранить</button></div></div>
    <div class="card"><div class="setting-title">Данные</div>
      <p class="setting-desc">Экспорт сохраняет всё в файл. Не кладите этот файл в публичный репозиторий: в нём финансы.</p>
      <div class="pill-row"><button class="btn" data-act="exportData">Экспорт</button>
      <label class="btn soft" style="cursor:pointer">Импорт<input id="import-file" type="file" accept="application/json" class="hidden"></label>
      <button class="btn danger" data-act="resetData">Сбросить всё</button></div></div>`;
}

const TITLE = { ...Object.fromEntries(SECTIONS), settings: 'Настройки', more: 'Ещё' };

const VIEWS = { dash: viewDash, fin: viewFin, goals: viewGoals, rem: viewRem, menu: menuHtml, car: viewCar, house: viewHouse, more: viewMore, settings: viewPeople };

// ---------- колокольчик: напоминания, прочтение и платежи к подтверждению ----------
// Прочтение хранится по каждому участнику: S.reads[ключ] = [id людей, которые открыли].
const remKey = (it) => `${it.kind}|${it.title}|${it.date}`;
const isReadBy = (it, pid) => ((S.reads || {})[remKey(it)] || []).includes(pid);
const reminders = () => upcoming(S, todayIso(), S.settings.notifyDaysAhead);
const unreadCount = () => reminders().filter((it) => !isReadBy(it, ME)).length;
const bellTotal = () => unreadCount() + pendingPayments().length;

function openBell() {
  const items = reminders();
  const unreadNow = new Set(items.filter((it) => !isReadBy(it, ME)).map(remKey));
  S.reads = S.reads || {};
  for (const it of items) {
    const k = remKey(it);
    const arr = S.reads[k] || [];
    if (ME && !arr.includes(ME)) S.reads[k] = [...arr, ME];
  }
  save();
  const list = items.length
    ? items.map((it) => `<div class="li ${unreadNow.has(remKey(it)) ? 'unread' : ''}">
        <span class="dot ${it.kind}"></span>
        <div class="main"><div class="t">${esc(it.title)}${unreadNow.has(remKey(it)) ? '<span class="new-pill">новое</span>' : ''}</div>
        <div class="s">${fmtDate(it.date)}${it.personId ? ' · ' + esc(personName(it.personId)) : ''}${it.overdue ? ' · просрочено' : ''}</div></div>
        ${it.amount ? `<div class="amt">${money(it.amount)}</div>` : ''}</div>`).join('')
    : '<div class="empty">Ближайших напоминаний нет</div>';
  $('#modal-title').textContent = `Напоминания · ${personName(ME) || 'Гость'}`;
  $('#modal-body').innerHTML = `${pendingHtml()}<p class="note" style="margin:0 8px">За ${S.settings.notifyDaysAhead} дн. вперёд. Открытие списка отмечает всё как прочитанное для вас.</p>${list}`;
  $('#modal').classList.remove('hidden');
}

function refreshBellIfOpen() {
  if (!$('#modal').classList.contains('hidden') && $('#modal-title').textContent.startsWith('Напоминания')) openBell();
}

// ---------- отрисовка ----------
function render() {
  if (!S) return;
  $('#hero-title').textContent = TITLE[SEC];
  $('#hero-sub').textContent = `${fmtDate(todayIso())} · ${personName(ME) || 'Гость'}`;
  $('#sections').innerHTML = NAV.map(([id, ic, label]) => {
    const active = id === 'more' ? MORE_SECTIONS.includes(SEC) : SEC === id;
    return `<button class="${active ? 'active' : ''}" data-act="sec" data-v="${id}" aria-label="${label}"${active ? ' aria-current="page"' : ''}>${svg(ic, 24)}<span>${label}</span></button>`;
  }).join('');
  $('#main').innerHTML = VIEWS[SEC]();
  const n = bellTotal();
  const bc = $('#bell-count');
  bc.textContent = n > 9 ? '9+' : String(n);
  bc.hidden = n === 0;
  if (SEC === 'menu') menuBind();
  bindChange();
}

function bindChange() {
  const me = $('#me-select');
  if (me) me.onchange = () => { ME = me.value; write('as.me', ME); render(); };
  const imp = $('#import-file');
  if (imp) imp.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const j = JSON.parse(await file.text());
      if (!Array.isArray(j.people) || !Array.isArray(j.transactions)) throw new Error('это не файл «Ассистента»');
      S = { ...S, ...j };
      ME = S.people.some((p) => p.id === ME) ? ME : S.people[0].id;
      save();
      toast('Данные импортированы');
      render();
    } catch (err) {
      alert('Не удалось импортировать: ' + err.message);
    }
  };
}

// ---------- действия (клики) ----------
const ADD = {
  addOp: () => openForm('Новая операция', [
    { k: 'type', t: 'select', l: 'Тип', opts: [['expense', 'Расход'], ['income', 'Доход']], v: 'expense' },
    { k: 'amount', t: 'number', l: 'Сумма', ph: '0' },
    { k: 'date', t: 'date', l: 'Дата', v: todayIso() },
    { k: 'category', t: 'select', l: 'Категория', opts: catAll() },
    { k: 'account', t: 'select', l: 'Счёт', opts: accOpts() },
    { k: 'personId', t: 'select', l: 'Чей', opts: personOpts(), v: ME },
    { k: 'private', t: 'check', l: 'Личное (видите только вы)', v: false },
    { k: 'note', t: 'text', l: 'Комментарий' }
  ], (o) => {
    if (!o.amount || o.amount <= 0) return 'Введите сумму';
    if (!o.date) return 'Укажите дату';
    S.transactions.push({ id: uid(), type: o.type, amount: o.amount, date: o.date, category: o.category || 'Прочее',
      account: o.account, personId: o.personId, private: o.private, note: o.note });
    return null;
  }),
  addRec: () => openForm('Регулярный платёж', [
    { k: 'title', t: 'text', l: 'Название', ph: 'Аренда, интернет, подписка' },
    { k: 'amount', t: 'number', l: 'Сумма в месяц' },
    { k: 'day', t: 'number', l: 'День месяца (1–31)', v: 5 },
    { k: 'category', t: 'select', l: 'Категория', opts: catAll() },
    { k: 'account', t: 'select', l: 'Счёт', opts: accOpts() },
    { k: 'personId', t: 'select', l: 'Чей', opts: personOpts(), v: '' }
  ], (o) => {
    if (!o.title || !need(o, ['amount', 'day'])) return 'Заполните название, сумму и день';
    S.recurring.push({ id: uid(), title: o.title, amount: o.amount, day: Math.min(31, Math.max(1, o.day)),
      category: o.category, account: o.account, personId: o.personId, active: true });
    return null;
  }),
  addDebt: () => openForm('Долг или кредит', [
    { k: 'title', t: 'text', l: 'Название' },
    { k: 'total', t: 'number', l: 'Сумма долга' },
    { k: 'remaining', t: 'number', l: 'Остаток сейчас (если пусто, равен сумме)' },
    { k: 'monthly', t: 'number', l: 'Ежемесячный платёж' },
    { k: 'dueDay', t: 'number', l: 'День платежа (1–31)', v: 10 }
  ], (o) => {
    if (!o.title || !need(o, ['total', 'monthly'])) return 'Заполните название, сумму и платёж';
    const rem = o.remaining === '' ? o.total : o.remaining;
    S.debts.push({ id: uid(), title: o.title, total: o.total, remaining: rem, monthly: o.monthly, dueDay: o.dueDay || 10 });
    return null;
  }),
  addGoal: () => openForm('Новая цель', [
    { k: 'kind', t: 'select', l: 'Тип', opts: [['long', 'Долгосрочная'], ['short', 'Краткосрочная']], v: GOAL_KIND === 'short' ? 'short' : 'long' },
    { k: 'title', t: 'text', l: 'Название' },
    { k: 'target', t: 'number', l: 'Нужная сумма' },
    { k: 'saved', t: 'number', l: 'Уже отложено', v: 0 },
    { k: 'deadline', t: 'date', l: 'Срок (необязательно)' },
    { k: 'personId', t: 'select', l: 'Чья', opts: personOpts(), v: '' }
  ], (o) => {
    if (!o.title || !need(o, ['target'])) return 'Введите название и сумму';
    S.goals.push({ id: uid(), kind: o.kind, title: o.title, target: o.target, saved: o.saved || 0, deadline: o.deadline, personId: o.personId });
    return null;
  }),
  addWish: () => openForm('Новое желание', [
    { k: 'title', t: 'text', l: 'Что хочется' },
    { k: 'price', t: 'number', l: 'Примерная цена' },
    { k: 'url', t: 'text', l: 'Ссылка (необязательно)', ph: 'https://' },
    { k: 'priority', t: 'select', l: 'Приоритет', opts: [['1', 'Высокий'], ['2', 'Средний'], ['3', 'Низкий']], v: '2' },
    { k: 'personId', t: 'select', l: 'Для кого', opts: personOpts(), v: '' }
  ], (o) => {
    if (!o.title) return 'Введите название';
    S.wishes.push({ id: uid(), title: o.title, price: o.price || '', url: o.url, priority: Number(o.priority), personId: o.personId, bought: false });
    return null;
  }),
  addRem: () => openForm('Напоминание', [
    { k: 'title', t: 'text', l: 'Что напомнить' },
    { k: 'date', t: 'date', l: 'Дата', v: todayIso() },
    { k: 'repeat', t: 'select', l: 'Повтор', opts: Object.entries(REPEAT), v: 'none' },
    { k: 'personId', t: 'select', l: 'Для кого', opts: personOpts(), v: '' }
  ], (o) => {
    if (!o.title || !o.date) return 'Введите название и дату';
    S.reminders.push({ id: uid(), title: o.title, date: o.date, repeat: o.repeat, personId: o.personId });
    return null;
  }),
  addCar: () => openForm('Автомобиль', [
    { k: 'make', t: 'text', l: 'Марка' },
    { k: 'model', t: 'text', l: 'Модель' },
    { k: 'year', t: 'number', l: 'Год' },
    { k: 'plate', t: 'text', l: 'Госномер' },
    { k: 'mileage', t: 'number', l: 'Текущий пробег, км' },
    { k: 'insuranceUntil', t: 'date', l: 'Страховка до' },
    { k: 'inspectionUntil', t: 'date', l: 'Техосмотр до' }
  ], (o) => {
    if (!o.make || !o.model) return 'Укажите марку и модель';
    S.cars.push({ id: uid(), make: o.make, model: o.model, year: o.year || '', plate: o.plate, mileage: o.mileage || '',
      insuranceUntil: o.insuranceUntil, inspectionUntil: o.inspectionUntil });
    return null;
  }),
  addTask: () => openForm('Дело по дому', [
    { k: 'title', t: 'text', l: 'Что сделать', ph: 'Поменять фильтр, мыть холодильник' },
    { k: 'everyDays', t: 'number', l: 'Повторять каждые N дней', v: 30 },
    { k: 'assignee', t: 'select', l: 'Кто', opts: personOpts(), v: '' }
  ], (o) => {
    if (!o.title || !need(o, ['everyDays']) || o.everyDays <= 0) return 'Укажите дело и период';
    S.homeTasks.push({ id: uid(), title: o.title, everyDays: o.everyDays, lastDone: '', assignee: o.assignee });
    return null;
  }),
  addMeter: () => openForm('Счётчик', [
    { k: 'name', t: 'text', l: 'Название' },
    { k: 'unit', t: 'text', l: 'Единица', ph: 'м³, кВт·ч' }
  ], (o) => {
    if (!o.name) return 'Введите название';
    S.meters.push({ id: uid(), name: o.name, unit: o.unit || '' });
    return null;
  }),
  addPerson: () => openForm('Новый человек', [{ k: 'name', t: 'text', l: 'Имя' }], (o) => {
    if (!o.name) return 'Введите имя';
    S.people.push({ id: uid(), name: o.name });
    return null;
  }),
  addAcc: () => openForm('Счёт', [
    { k: 'name', t: 'text', l: 'Название', ph: 'Карта Сбера, наличные' },
    { k: 'owner', t: 'select', l: 'Кому принадлежит', opts: [['shared', 'Общий'], ...S.people.map((p) => [p.id, p.name])], v: 'shared' }
  ], (o) => {
    if (!o.name) return 'Введите название';
    S.accounts.push({ id: uid(), name: o.name, owner: o.owner });
    return null;
  })
};

const ACTIONS = {
  sec: (d) => { SEC = d.v; },
  finMonth: (d) => { FIN_MONTH = shiftMonth(FIN_MONTH, Number(d.d)); },
  finTab: (d) => { FIN_TAB = d.v; },
  goalKind: (d) => { GOAL_KIND = d.v; },
  houseTab: (d) => { HOUSE_TAB = d.v; },
  carOpen: (d) => { CAR_ID = CAR_ID === d.id ? null : d.id; },
  del: (d) => {
    if (!confirm('Удалить запись?')) return false;
    S[d.coll] = S[d.coll].filter((x) => x.id !== d.id);
  },
  toggleRec: (d) => { const r = S.recurring.find((x) => x.id === d.id); r.active = !r.active; },
  payOk: (d) => { resolvePayment(d.id, d.ym, 'ok'); refreshBellIfOpen(); },
  paySkip: (d) => { resolvePayment(d.id, d.ym, 'skip'); refreshBellIfOpen(); },
  wishBought: (d) => { const w = S.wishes.find((x) => x.id === d.id); w.bought = !w.bought; },
  taskDone: (d) => { const t = S.homeTasks.find((x) => x.id === d.id); t.lastDone = todayIso(); },
  topUp: (d) => {
    const g = S.goals.find((x) => x.id === d.id);
    openForm('Пополнить: ' + g.title, [{ k: 'amt', t: 'number', l: 'Сумма' }], (o) => {
      if (!o.amt || o.amt <= 0) return 'Введите сумму';
      g.saved = (g.saved || 0) + o.amt;
      return null;
    });
    return false;
  },
  payDebt: (d) => {
    const debt = S.debts.find((x) => x.id === d.id);
    openForm('Платёж: ' + debt.title, [{ k: 'amt', t: 'number', l: 'Сумма платежа', v: debt.monthly }], (o) => {
      if (!o.amt || o.amt <= 0) return 'Введите сумму';
      debt.remaining = Math.max(0, debt.remaining - o.amt);
      S.transactions.push({ id: uid(), type: 'expense', amount: o.amt, date: todayIso(), category: 'Прочее',
        account: '', personId: '', private: false, note: `Платёж по долгу: ${debt.title}` });
      return null;
    });
    return false;
  },
  addCarExp: (d) => {
    const car = S.cars.find((x) => x.id === d.id);
    openForm(`Расход: ${car.make} ${car.model}`, [
      { k: 'type', t: 'select', l: 'Вид', opts: Object.entries(CAR_TYPES), v: 'fuel' },
      { k: 'date', t: 'date', l: 'Дата', v: todayIso() },
      { k: 'amount', t: 'number', l: 'Сумма' },
      { k: 'mileage', t: 'number', l: 'Пробег, км (для расхода топлива)' },
      { k: 'liters', t: 'number', l: 'Литры (для топлива)' },
      { k: 'note', t: 'text', l: 'Комментарий' }
    ], (o) => {
      if (!need(o, ['amount'])) return 'Введите сумму';
      S.carExpenses.push({ id: uid(), carId: car.id, type: o.type, date: o.date, amount: o.amount,
        mileage: o.mileage, liters: o.liters, note: o.note });
      if (o.mileage && (!car.mileage || o.mileage > car.mileage)) car.mileage = o.mileage;
      return null;
    });
    return false;
  },
  addReading: (d) => {
    const m = S.meters.find((x) => x.id === d.id);
    openForm(`Показание: ${m.name}`, [
      { k: 'value', t: 'number', l: `Показание, ${m.unit}` },
      { k: 'date', t: 'date', l: 'Дата', v: todayIso() }
    ], (o) => {
      if (!need(o, ['value'])) return 'Введите показание';
      S.meterReadings.push({ id: uid(), meterId: m.id, value: o.value, date: o.date });
      return null;
    });
    return false;
  },
  saveNames: () => {
    let changed = 0;
    for (const p of S.people) {
      const v = $('#pn_' + p.id).value.trim();
      if (v && v !== p.name) { p.name = v; changed++; }
    }
    toast(changed ? 'Имена сохранены' : 'Имена без изменений');
  },
  saveCats: () => {
    const split = (id) => $(id).value.split(',').map((s) => s.trim()).filter(Boolean);
    S.categories.expense = split('#cat-exp');
    S.categories.income = split('#cat-inc');
  },
  saveSettings: () => {
    const n = parseInt($('#notify-days').value, 10);
    S.settings.notifyDaysAhead = isNaN(n) ? 3 : Math.min(30, Math.max(0, n));
    toast('Сохранено');
  },
  bell: () => { openBell(); },
  exportData: () => {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'assistant-data.json';
    a.click();
    URL.revokeObjectURL(a.href);
    return false;
  },
  resetData: async () => {
    if (!confirm('Удалить все данные в этом браузере и вернуть пустой шаблон?')) return false;
    localStorage.removeItem('as.data');
    S = await loadBase();
    ME = S.people[0].id;
    save();
    toast('Данные сброшены');
  }
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const name = el.dataset.act;
  let changed;
  if (ADD[name]) { ADD[name](); return; }
  if (!ACTIONS[name]) return;
  changed = ACTIONS[name](el.dataset);
  if (changed !== false) { save(); render(); }
});

// ---------- запуск ----------
async function loadBase() {
  return (await fetch('data.json', { cache: 'no-store' })).json();
}

async function init() {
  $('#modal-close').onclick = closeModal;
  $('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };
  try {
    const base = await loadBase();
    S = { ...base, ...read('as.data', {}) };
    S.settings = { ...base.settings, ...(S.settings || {}) };
    ME = read('as.me', null);
    if (!S.people.some((p) => p.id === ME)) ME = S.people[0] ? S.people[0].id : null;
    await menuInit(() => render());
    render();
  } catch (err) {
    $('#main').innerHTML = `<div class="card">Не удалось загрузить data.json. Откройте приложение по ссылке GitHub Pages или через локальный сервер.<br><span class="muted">${esc(err.message)}</span></div>`;
  }
  // Офлайн-режим и установка на экран телефона.
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
