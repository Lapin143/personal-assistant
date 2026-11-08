// Меню на 30 дней, встроено в «Ассистент».
// Блюда и план — menu/data.json. Правки хранятся в localStorage под ключами menu.*.
// Экспорт в настройках меню выгружает data.json для замены файла в репозитории.

import { META } from './meta.js';

const KEY = {
  start: 'menu.start',
  dishes: 'menu.dishes',
  plan: 'menu.plan',
  overrides: 'menu.overrides',
  checked: 'menu.checked',
  receipts: 'menu.receipts'
};

const MEAL = {
  breakfast: { title: 'Завтрак', icon: '☀️' },
  lunch: { title: 'Обед', icon: '🍲' },
  dinner: { title: 'Ужин', icon: '🌙' }
};
const TYPE = {
  breakfast: { title: 'Завтраки', chip: 'Завтрак' },
  lunch: { title: 'Обеды', chip: 'Обед' },
  soup: { title: 'Супы', chip: 'Суп' },
  dinner: { title: 'Ужины', chip: 'Ужин' }
};
const DEFAULT_EMOJI = { breakfast: '🍳', lunch: '🍽', soup: '🥣', dinner: '🍛' };
const TABS = [['today', 'Сегодня'], ['dishes', 'Блюда'], ['shopping', 'Покупки'], ['settings', 'Ещё']];

let D = null;          // startDate, dishes, plan, bulk, weekly
let loadError = '';
let viewDay = 1;
let dishFilter = 'all';
let dishQuery = '';
let TAB = 'today';
let rerender = () => {};

const $ = (sel) => document.querySelector(sel);
const read = (k, def) => {
  try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); }
  catch { return def; }
};
const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}

// ---------- даты и план ----------
function parseDate(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
function dateOfDay(n) { const s = parseDate(D.startDate); s.setDate(s.getDate() + n - 1); return s; }
function fmtDate(dt) { return dt.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }); }
function todayDay() {
  const s = parseDate(D.startDate);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.floor((t - s) / 86400000) + 1;
}
function isWeekend(n) { const w = dateOfDay(n).getDay(); return w === 0 || w === 6; }
function planDay(n) { return D.plan.find((p) => p.day === n); }
function dishByName(name) { return D.dishes.find((x) => x.name === name); }
function dishInfo(name) {
  const d = dishByName(name) || {};
  const m = META[name] || {};
  const type = d.type || 'lunch';
  return {
    name,
    type,
    emoji: d.emoji || m.e || DEFAULT_EMOJI[type] || '🍽',
    description: d.description || m.d || '',
    composition: d.composition || '',
    steps: d.steps || ''
  };
}
function currentMeal(n, slot) {
  const ov = read(KEY.overrides, {});
  return (ov[n] && ov[n][slot]) || (planDay(n) && planDay(n)[slot]) || '';
}
function poolFor(n, slot) {
  const type = slot === 'lunch' ? (isWeekend(n) ? 'soup' : 'lunch') : slot;
  return D.dishes.filter((d) => d.type === type).map((d) => d.name);
}
function setMeal(n, slot, name) {
  const ov = read(KEY.overrides, {});
  const apply = (day, value) => {
    ov[day] = ov[day] || {};
    if (planDay(day) && planDay(day)[slot] === value) delete ov[day][slot];
    else ov[day][slot] = value;
    if (!Object.keys(ov[day]).length) delete ov[day];
  };
  apply(n, name);
  // суп варится на два дня: суббота → воскресенье
  if (slot === 'lunch' && dateOfDay(n).getDay() === 6 && planDay(n + 1)) apply(n + 1, name);
  write(KEY.overrides, ov);
}
function revertMeal(n, slot) {
  const ov = read(KEY.overrides, {});
  const clear = (day) => {
    if (ov[day]) { delete ov[day][slot]; if (!Object.keys(ov[day]).length) delete ov[day]; }
  };
  clear(n);
  if (slot === 'lunch' && dateOfDay(n).getDay() === 6) clear(n + 1);
  write(KEY.overrides, ov);
}

// ---------- модальное окно (общее с «Ассистентом») ----------
function showModal(title, html) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  $('#modal').classList.remove('hidden');
}
function hideModal() { $('#modal').classList.add('hidden'); }

// ---------- шапка раздела ----------
function headHtml() {
  const t = todayDay();
  const max = D.plan.length;
  const shown = Math.min(Math.max(t, 1), max);
  const sub = t >= 1 && t <= max
    ? `День ${t} из ${max} · ${fmtDate(dateOfDay(t))}`
    : t < 1 ? `Первый день плана: ${fmtDate(parseDate(D.startDate))}` : 'План на 30 дней завершён';
  return `<div class="card">
    <div class="muted">${esc(sub)}</div>
    <div class="bar"><div style="width:${Math.round((shown / max) * 100)}%"></div></div></div>`;
}

// ---------- вкладка «Сегодня» ----------
function todayHtml() {
  const t = todayDay();
  const max = D.plan.length;
  const n = viewDay;
  const isToday = n === t;
  const weekend = isWeekend(n);

  let html = `
    <div class="day-nav">
      <button class="icon-btn" id="prev" ${n <= 1 ? 'disabled' : ''} aria-label="Предыдущий день">←</button>
      <div class="label">
        <strong>День ${n} из ${max}${isToday ? '<span class="today-pill">сегодня</span>' : ''}</strong>
        <span class="muted">${esc(fmtDate(dateOfDay(n)))}</span>
      </div>
      <button class="icon-btn" id="next" ${n >= max ? 'disabled' : ''} aria-label="Следующий день">→</button>
    </div>`;

  if (weekend) {
    html += `<div class="soup-note">🥣 На обед суп: одна кастрюля на субботу и воскресенье</div>`;
  }

  for (const slot of ['breakfast', 'lunch', 'dinner']) {
    const name = currentMeal(n, slot);
    const planName = planDay(n) ? planDay(n)[slot] : '';
    const info = dishInfo(name);
    const replaced = name !== planName;
    const label = MEAL[slot].title + (slot === 'lunch' && weekend ? ' · суп' : '');
    html += `
      <article class="meal ${slot}">
        <div class="meal-head">
          <div class="meal-emoji">${esc(info.emoji)}</div>
          <div class="meal-body">
            <span class="chip ${slot}">${MEAL[slot].icon} ${label}</span>
            <div class="meal-name">${esc(name)}</div>
          </div>
        </div>
        ${info.description ? `<p class="meal-desc">${esc(info.description)}</p>` : ''}
        <div class="meal-actions">
          <button class="btn soft" data-replace="${slot}">Заменить</button>
        </div>
        ${replaced ? `<div class="replaced-note">Заменено. По плану: ${esc(planName)} · <a href="#" data-revert="${slot}">вернуть</a></div>` : ''}
        ${info.composition || info.steps ? `
        <details class="recipe">
          <summary>Рецепт</summary>
          ${info.composition ? `<p><b>Состав:</b> ${esc(info.composition)}</p>` : ''}
          ${info.steps ? `<p><b>Как готовить:</b> ${esc(info.steps)}</p>` : ''}
        </details>` : ''}
      </article>`;
  }
  return html;
}

function openReplace(n, slot) {
  const pool = poolFor(n, slot);
  const cur = currentMeal(n, slot);
  const body = pool.length
    ? `<p class="muted" style="margin:0 0 10px">Выберите, что готовим. Блюда того же типа.</p>
       <div class="tiles">${pool.map((name) => {
         const i = dishInfo(name);
         return `<button class="tile ${name === cur ? 'current' : ''}" data-pick="${esc(name)}">
           <span class="e">${esc(i.emoji)}</span>
           <span class="n">${esc(name)}</span>
           ${name === cur ? '<span class="now">сейчас</span>' : ''}
         </button>`;
       }).join('')}</div>`
    : '<p class="muted">Нет блюд этого типа. Добавьте их на вкладке «Блюда».</p>';
  showModal(`${MEAL[slot].title}, день ${n}`, body);
  $('#modal-body').querySelectorAll('[data-pick]').forEach((b) => {
    b.onclick = () => { setMeal(n, slot, b.dataset.pick); hideModal(); rerender(); toast('Блюдо заменено'); };
  });
}

// ---------- вкладка «Блюда» ----------
function dishesHtml() {
  const types = ['all', 'breakfast', 'lunch', 'soup', 'dinner'];
  const names = { all: 'Все', breakfast: 'Завтраки', lunch: 'Обеды', soup: 'Супы', dinner: 'Ужины' };
  const q = dishQuery.trim().toLowerCase();

  const list = D.dishes
    .map((d, i) => ({ d, i, info: dishInfo(d.name) }))
    .filter(({ d, info }) => (dishFilter === 'all' || d.type === dishFilter)
      && (!q || d.name.toLowerCase().includes(q) || info.description.toLowerCase().includes(q)));

  let html = `
    <div class="search"><input id="dish-q" placeholder="Поиск блюда" value="${esc(dishQuery)}"></div>
    <div class="filters">${types.map((t) =>
      `<button class="${t === dishFilter ? 'active' : ''}" data-filter="${t}">${names[t]}</button>`).join('')}</div>
    <p class="muted" style="margin:4px 4px 10px">Показано: ${list.length} из ${D.dishes.length}</p>
    <div class="dish-grid">`;

  for (const { d, i, info } of list) {
    const used = D.plan.filter((p) => p.breakfast === d.name || p.lunch === d.name || p.dinner === d.name).length;
    html += `
      <div class="dish">
        <div class="e">${esc(info.emoji)}</div>
        <div class="b">
          <div class="nm">${esc(d.name)}</div>
          ${info.description ? `<div class="ds">${esc(info.description)}</div>` : ''}
          <div class="meta">
            <span class="chip ${d.type}">${TYPE[d.type] ? TYPE[d.type].chip : d.type}</span>
            <span class="muted">в плане: ${used}</span>
            <button class="btn danger" data-del="${i}" style="padding:5px 10px;font-size:12px">Удалить</button>
          </div>
          ${info.composition || info.steps ? `
          <details class="recipe">
            <summary>Рецепт</summary>
            ${info.composition ? `<p><b>Состав:</b> ${esc(info.composition)}</p>` : ''}
            ${info.steps ? `<p><b>Как готовить:</b> ${esc(info.steps)}</p>` : ''}
          </details>` : ''}
        </div>
      </div>`;
  }
  html += `</div>
    <div class="add-card">
      <h3>Добавить блюдо</h3>
      <label class="field">Название</label><input id="d-name">
      <label class="field">Тип</label>
      <select id="d-type">
        <option value="breakfast">Завтрак</option>
        <option value="lunch">Обед</option>
        <option value="soup">Суп (суббота и воскресенье)</option>
        <option value="dinner">Ужин</option>
      </select>
      <label class="field">Эмодзи (необязательно)</label><input id="d-emoji" maxlength="4">
      <label class="field">Описание</label><textarea id="d-desc" rows="2"></textarea>
      <label class="field">Состав (продукты и граммовки)</label><textarea id="d-comp" rows="2"></textarea>
      <label class="field">Как готовить</label><textarea id="d-steps" rows="2"></textarea>
      <button class="btn block" id="d-add">Добавить блюдо</button>
    </div>`;
  return html;
}

// ---------- вкладка «Покупки» ----------
function shoppingHtml() {
  const checked = read(KEY.checked, {});
  const all = [...D.bulk, ...D.weekly];
  const keyOf = (idx) => (idx < D.bulk.length ? 'b' + idx : 'w' + (idx - D.bulk.length));
  const doneCount = all.reduce((a, _, idx) => a + (checked[keyOf(idx)] ? 1 : 0), 0);
  const checkedNames = all.filter((_, idx) => checked[keyOf(idx)]).map((it) => it.name);

  const section = (title, sub, list, prefix) => {
    let s = `<div class="shop-card"><h3>${esc(title)}</h3><div class="muted">${esc(sub)}</div>`;
    let group = '';
    list.forEach((item, i) => {
      if (item.group !== group) { group = item.group; s += `<div class="group-title">${esc(group)}</div>`; }
      const key = prefix + i;
      const done = !!checked[key];
      s += `<label class="item ${done ? 'done' : ''}">
        <input type="checkbox" data-key="${key}" ${done ? 'checked' : ''}>
        <span class="box">✓</span>
        <span class="txt"><span class="nm">${esc(item.name)}</span><div class="qty">${esc(item.qty)}</div></span>
      </label>`;
    });
    return s + '</div>';
  };

  const receipts = read(KEY.receipts, []);
  const sum = receipts.reduce((a, r) => a + Number(r.total || 0), 0);
  const pct = all.length ? Math.round((doneCount / all.length) * 100) : 0;

  return `
    <div class="shop-summary">
      <div class="row" style="justify-content:space-between">
        <div><div class="muted">Отмечено</div><div class="big">${doneCount} из ${all.length}</div></div>
        <button class="btn soft" id="reset-checks">Снять отметки</button>
      </div>
      <div class="bar"><div style="width:${pct}%"></div></div>
    </div>
    ${section('Закупка на месяц', 'Покупаем один раз, потом берём только скоропортящееся', D.bulk, 'b')}
    ${section('Каждую неделю', 'Хлеб, зелень, фрукты и овощи для салатов', D.weekly, 'w')}

    <div class="shop-card">
      <h3>Чек закупки</h3>
      <div class="muted">${checkedNames.length ? `Отмечено позиций: ${checkedNames.length}` : 'Отметьте купленное выше и введите сумму'}</div>
      <label class="field" style="margin-top:10px">Магазин</label><input id="r-store" placeholder="Например, Пятёрочка">
      <label class="field">Дата</label><input id="r-date" type="date" value="${new Date().toISOString().slice(0, 10)}">
      <label class="field">Сумма, ₽</label><input id="r-total" inputmode="decimal" placeholder="0">
      <button class="btn block" id="save-receipt">Сохранить чек</button>
    </div>

    <div class="shop-card">
      <h3>История чеков</h3>
      ${receipts.length ? receipts.map((r, i) => `
        <div class="receipt-row">
          <div><div style="font-weight:700">${esc(r.store || 'Магазин')}</div><div class="muted">${esc(r.date)} · позиций: ${r.items || 0}</div></div>
          <div class="row"><span class="sum">${Number(r.total).toLocaleString('ru-RU')} ₽</span>
          <button class="icon-btn" data-rdel="${i}" aria-label="Удалить чек">✕</button></div>
        </div>`).join('') : '<div class="empty">Чеков пока нет</div>'}
      ${receipts.length ? `<div class="total-line"><span>Всего потрачено</span><span>${sum.toLocaleString('ru-RU')} ₽</span></div>` : ''}
    </div>`;
}

// ---------- вкладка «Ещё» ----------
function settingsHtml() {
  return `
    <div class="card">
      <div class="setting-title">Первый день плана</div>
      <p class="setting-desc">От этой даты считается день 1 из 30.</p>
      <input id="s-start" type="date" value="${esc(D.startDate)}">
    </div>
    <div class="card">
      <div class="setting-title">База блюд и плана</div>
      <p class="setting-desc">Изменения хранятся в этом браузере. Экспорт сохраняет data.json меню.</p>
      <div class="row">
        <button class="btn" id="s-export">Экспорт data.json</button>
        <label class="btn soft" style="cursor:pointer">Импорт<input id="s-import" type="file" accept="application/json" class="hidden"></label>
      </div>
    </div>
    <div class="card">
      <div class="setting-title">Сброс</div>
      <p class="setting-desc">Удаляет локальные правки блюд, плана, замены и отметки покупок. Чеки сохраняются.</p>
      <button class="btn danger" id="s-reset">Сбросить правки</button>
    </div>`;
}

// ---------- публичное API для «Ассистента» ----------
export function menuHtml() {
  if (loadError) return `<div class="card">Не удалось загрузить меню: <span class="muted">${esc(loadError)}</span></div>`;
  if (!D) return '<div class="card empty">Загрузка меню…</div>';
  const tabs = `<div class="tabline">${TABS.map(([v, l]) =>
    `<button class="${TAB === v ? 'active' : ''}" data-mtab="${v}">${l}</button>`).join('')}</div>`;
  const body = TAB === 'today' ? todayHtml()
    : TAB === 'dishes' ? dishesHtml()
    : TAB === 'shopping' ? shoppingHtml()
    : settingsHtml();
  return headHtml() + tabs + body;
}

// Краткая сводка на главной: блюда на сегодня и переход в раздел.
export function menuSummaryHtml() {
  if (!D || loadError) return '';
  const t = todayDay();
  const max = D.plan.length;
  const n = Math.min(Math.max(t, 1), max);
  const status = t < 1 ? 'План ещё не начался' : t > max ? 'План завершён' : `День ${n} из ${max}`;
  const inPlan = t >= 1 && t <= max;
  const rows = !inPlan ? '' : ['breakfast', 'lunch', 'dinner'].map((slot) => {
    const name = currentMeal(n, slot);
    const info = dishInfo(name);
    return `<div class="li">
      <div class="main"><div class="t">${esc(info.emoji)} ${esc(name)}</div>
      <div class="s">${MEAL[slot].icon} ${MEAL[slot].title}${isWeekend(n) && slot === 'lunch' ? ' · суп' : ''}</div></div></div>`;
  }).join('');
  return `<div class="card">
    <div class="row" style="justify-content:space-between">
      <div><div class="setting-title" style="margin:0">Меню на сегодня</div><div class="note">${esc(status)}</div></div>
      <button class="btn soft" data-act="sec" data-v="menu">Открыть меню</button></div>
    ${rows}</div>`;
}

// Вешает обработчики на элементы, которые только что отрисованы.
export function menuBind() {
  if (!D) return;
  document.querySelectorAll('[data-mtab]').forEach((b) => {
    b.onclick = () => { TAB = b.dataset.mtab; rerender(); };
  });

  if (TAB === 'today') {
    const n = viewDay;
    const prev = $('#prev'); const next = $('#next');
    if (prev) prev.onclick = () => { viewDay--; rerender(); };
    if (next) next.onclick = () => { viewDay++; rerender(); };
    document.querySelectorAll('[data-replace]').forEach((b) => {
      b.onclick = () => openReplace(n, b.dataset.replace);
    });
    document.querySelectorAll('[data-revert]').forEach((a) => {
      a.onclick = (e) => { e.preventDefault(); revertMeal(n, a.dataset.revert); rerender(); toast('План восстановлен'); };
    });
    return;
  }

  if (TAB === 'dishes') {
    document.querySelectorAll('[data-filter]').forEach((b) => {
      b.onclick = () => { dishFilter = b.dataset.filter; rerender(); };
    });
    const qi = $('#dish-q');
    if (qi) qi.oninput = () => {
      dishQuery = qi.value;
      const pos = qi.selectionStart;
      rerender();
      const again = $('#dish-q');
      if (again) { again.focus(); again.setSelectionRange(pos, pos); }
    };
    document.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = () => {
        const idx = Number(b.dataset.del);
        const dish = D.dishes[idx];
        if (!confirm(`Удалить «${dish.name}»? Из плана оно не исчезнет, но для замены будет недоступно.`)) return;
        D.dishes.splice(idx, 1);
        write(KEY.dishes, D.dishes);
        rerender();
        toast('Блюдо удалено');
      };
    });
    const add = $('#d-add');
    if (add) add.onclick = () => {
      const name = $('#d-name').value.trim();
      if (!name) return toast('Введите название');
      if (dishByName(name)) return toast('Такое блюдо уже есть');
      D.dishes.push({
        name,
        type: $('#d-type').value,
        emoji: $('#d-emoji').value.trim() || undefined,
        description: $('#d-desc').value.trim() || undefined,
        composition: $('#d-comp').value.trim(),
        steps: $('#d-steps').value.trim()
      });
      write(KEY.dishes, D.dishes);
      rerender();
      toast('Блюдо добавлено');
    };
    return;
  }

  if (TAB === 'shopping') {
    document.querySelectorAll('input[data-key]').forEach((cb) => {
      cb.onchange = () => {
        const c = read(KEY.checked, {});
        if (cb.checked) c[cb.dataset.key] = true; else delete c[cb.dataset.key];
        write(KEY.checked, c);
        rerender();
      };
    });
    const reset = $('#reset-checks');
    if (reset) reset.onclick = () => { write(KEY.checked, {}); rerender(); toast('Отметки сняты'); };
    const save = $('#save-receipt');
    if (save) save.onclick = () => {
      const total = parseFloat(String($('#r-total').value).replace(',', '.'));
      if (!total) return toast('Введите сумму чека');
      const checked = read(KEY.checked, {});
      const count = Object.keys(checked).filter((k) => checked[k]).length;
      const rs = read(KEY.receipts, []);
      rs.unshift({ date: $('#r-date').value, store: $('#r-store').value.trim(), total, items: count, note: '' });
      write(KEY.receipts, rs);
      write(KEY.checked, {});
      rerender();
      toast('Чек сохранён');
    };
    document.querySelectorAll('[data-rdel]').forEach((b) => {
      b.onclick = () => {
        const rs = read(KEY.receipts, []);
        rs.splice(Number(b.dataset.rdel), 1);
        write(KEY.receipts, rs);
        rerender();
      };
    });
    return;
  }

  // настройки
  const start = $('#s-start');
  if (start) start.onchange = (e) => {
    D.startDate = e.target.value;
    write(KEY.start, D.startDate);
    viewDay = Math.min(Math.max(todayDay(), 1), D.plan.length);
    rerender();
    toast('Дата сохранена');
  };
  const exp = $('#s-export');
  if (exp) exp.onclick = () => {
    const data = { startDate: D.startDate, dishes: D.dishes, plan: D.plan, bulk: D.bulk, weekly: D.weekly };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'data.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const imp = $('#s-import');
  if (imp) imp.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const j = JSON.parse(await file.text());
      if (!Array.isArray(j.dishes) || !Array.isArray(j.plan)) throw new Error('нет dishes или plan');
      D.dishes = j.dishes; D.plan = j.plan;
      if (j.startDate) { D.startDate = j.startDate; write(KEY.start, j.startDate); }
      if (Array.isArray(j.bulk)) D.bulk = j.bulk;
      if (Array.isArray(j.weekly)) D.weekly = j.weekly;
      write(KEY.dishes, D.dishes);
      write(KEY.plan, D.plan);
      toast('Данные импортированы');
      rerender();
    } catch (err) {
      alert('Не удалось импортировать файл: ' + err.message);
    }
  };
  const reset = $('#s-reset');
  if (reset) reset.onclick = async () => {
    if (!confirm('Сбросить локальные правки меню?')) return;
    [KEY.dishes, KEY.plan, KEY.overrides, KEY.checked, KEY.start].forEach((k) => localStorage.removeItem(k));
    await loadBase();
    rerender();
    toast('Правки сброшены');
  };
}

// ---------- загрузка ----------
async function loadBase() {
  const base = await (await fetch('menu/data.json', { cache: 'no-store' })).json();
  D = {
    startDate: read(KEY.start, base.startDate),
    dishes: read(KEY.dishes, base.dishes),
    plan: read(KEY.plan, base.plan),
    bulk: base.bulk,
    weekly: base.weekly
  };
  viewDay = Math.min(Math.max(todayDay(), 1), D.plan.length);
}

export async function menuInit(rerenderFn) {
  rerender = rerenderFn;
  try {
    await loadBase();
  } catch (err) {
    loadError = err.message;
  }
}
