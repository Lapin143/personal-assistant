// Наше меню: статическое приложение без сборки.
// Блюда и план лежат в data.json. Правки в браузере сохраняются в localStorage,
// а кнопка «Экспорт» в настройках выгружает data.json для репозитория.

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

// Описания и эмодзи для блюд из data.json (по названию).
const META = {
  'Овсянка с бананом и орехами': { e: '🥣', d: 'Тёплая овсянка на молоке, мягкий банан и хрустящие орехи. Надолго сытно и отличное начало дня.' },
  'Гречка на молоке с яблоком': { e: '🥛', d: 'Нежная гречневая каша на молоке с тёртым яблоком. По-домашнему сытно и с натуральной сладостью.' },
  'Сырники с ягодами': { e: '🥞', d: 'Золотистые сырники из творога на минимуме муки, со свежими ягодами сверху. Нежные внутри, румяные снаружи.' },
  'Яичница с овощами и хлебом': { e: '🍳', d: 'Яичница на мягко обжаренных помидорах и перце, с тающим сыром и ломтиком хлеба. Быстро и плотно.' },
  'Йогурт с мюсли и фруктами': { e: '🍨', d: 'Холодный натуральный йогурт с хрустящими мюсли и фруктами. Готов за минуту, когда времени совсем нет.' },
  'Творожная запеканка с фруктами': { e: '🍰', d: 'Воздушная запеканка из творога с фруктами, запечённая до золотистой корочки. Вкусна и тёплой, и холодной.' },
  'Омлет с творогом': { e: '🥚', d: 'Пышный омлет с творогом внутри: мягкий, лёгкий и быстрый. Зелень делает его особенно свежим.' },
  'Шакшука': { e: '🍅', d: 'Яйца, томлённые в ароматном томатном соусе с луком и перцем. Ярко, сытно и подаётся прямо со сковороды.' },
  'Яйца пашот на тосте с сыром': { e: '🥚', d: 'Яйца пашот с нежным жидким желтком на поджаренном хлебе с сыром. Выглядит ресторанно и готовится быстро.' },
  'Гранола с йогуртом и ягодами': { e: '🌾', d: 'Домашняя гранола из овсянки, орехов и мёда с йогуртом и ягодами. Хрустящая, ароматная и без лишнего сахара.' },

  'Курица с рисом': { e: '🍗', d: 'Сочная курица с луком и морковью и рассыпчатый рис. Классический домашний обед, который нравится всем.' },
  'Курица с гречкой': { e: '🍗', d: 'Курица с золотистым луком и гречка с хрустом. Простой и сытный обед, который держит энергию.' },
  'Курица с картофелем': { e: '🍗', d: 'Курица, запечённая с картофелем и луком до румяной корочки. Всё в одной форме, почти без возни.' },
  'Гуляш с картофелем': { e: '🥘', d: 'Нежная говядина, тушёная с луком, морковью и томатом, с картофелем. Густой и ароматный.' },
  'Говядина тушёная с гречкой': { e: '🥩', d: 'Говядина, долго томлённая до мягкости, с рассыпчатой гречкой. Тёплый и сытный обед на каждый день.' },
  'Говядина тушёная с рисом': { e: '🥩', d: 'Тушёная говядина в мягком соусе с овощами и рисом. Гарнир вбирает вкус мяса, очень уютно.' },
  'Бефстроганов с макаронами': { e: '🍝', d: 'Говядина полосками в луковом соусе с соевым акцентом и макаронами. Быстрый и насыщенный обед.' },
  'Форель с рисом': { e: '🐟', d: 'Запечённая форель с лимоном и рассыпчатым рисом. Лёгкий, но сытный обед с тонким вкусом рыбы.' },
  'Белая рыба с гречкой': { e: '🐟', d: 'Нежное филе белой рыбы со специями и лимоном, с гречкой. Лёгкий обед, который не утяжеляет.' },
  'Белая рыба с картофелем': { e: '🐟', d: 'Белая рыба, запечённая с картофелем и лимоном. Нежно, ароматно и без лишних хлопот.' },
  'Рагу из свинины с овощами': { e: '🍖', d: 'Сочная свинина, томлённая с картофелем и овощами. Густое рагу, которое тает во рту.' },

  'Куриный суп с лапшой': { e: '🍜', d: 'Прозрачный бульон из курицы с овощами и домашней лапшой. Классика, которая готовится сразу на два дня.' },
  'Щи из говядины': { e: '🥣', d: 'Наваристые щи из говядины с капустой и томатом. Кислинка и густой бульон, отличный выбор на выходные.' },
  'Гороховый суп с хлебом': { e: '🫕', d: 'Густой горох с картофелем и овощами, подаётся с ломтиком хлеба. Сытный, тёплый и любимый многими.' },
  'Борщ с говядиной': { e: '🍲', d: 'Яркий борщ со свёклой, капустой и говядиной в насыщенном бульоне. Со сметаной и хлебом — идеально.' },

  'Омлет с овощами и сыром': { e: '🍳', d: 'Пышный омлет с помидорами, перцем и сыром. Лёгкий ужин, который готовится за несколько минут.' },
  'Макароны с томатным соусом и сыром': { e: '🍝', d: 'Макароны в ароматном томатном соусе с луком и тающим сыром. Простой и уютный ужин.' },
  'Рис с яйцом и овощами': { e: '🍚', d: 'Жареный рис с овощами, соевым соусом и яйцом. Быстрое блюдо из вчерашнего риса, очень вкусное.' },
  'Форель с картофелем': { e: '🐟', d: 'Запечённая форель с картофелем и лимоном. Нежная рыба и румяный картофель на одном противне.' },
  'Белая рыба с овощами': { e: '🐟', d: 'Белая рыба, запечённая с овощной смесью и луком. Лёгкий ужин, полезный и красивый на тарелке.' },
  'Курица карри с рисом': { e: '🍛', d: 'Курица в мягком карри с кокосовым молоком и томатами, с рисом. Тёплые специи и нежный соус.' },
  'Курица запечённая с картофелем': { e: '🍗', d: 'Курица и картофель, запечённые со специями до хрустящей корочки. Ужин без стояния у плиты.' },
  'Говядина тушёная с картофелем': { e: '🥘', d: 'Говядина, тушёная с луком, морковью и томатной пастой, с картофелем. Густо, ароматно и по-домашнему.' },
  'Шакшука (ужин)': { e: '🍅', d: 'Яйца в томатном соусе с луком и перцем. Лёгкий вечерний вариант с ярким вкусом.' }
};

let D = {};        // startDate, dishes, plan, bulk, weekly
let viewDay = 1;
let dishFilter = 'all';
let dishQuery = '';

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

// ---------- модальное окно ----------
function showModal(title, html) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  $('#modal').classList.remove('hidden');
}
function hideModal() { $('#modal').classList.add('hidden'); }

// ---------- шапка ----------
function renderHero() {
  const t = todayDay();
  const max = D.plan.length;
  const shown = Math.min(Math.max(t, 1), max);
  $('#hero-title').textContent = t < 1 ? 'Меню скоро начнётся' : t > max ? 'Меню на 30 дней завершено' : 'Наше меню';
  $('#hero-sub').textContent = t >= 1 && t <= max
    ? `День ${t} из ${max} · ${fmtDate(dateOfDay(t))}`
    : `Первый день плана: ${fmtDate(parseDate(D.startDate))}`;
  $('#hero-progress').style.width = `${Math.round((shown / max) * 100)}%`;
  $('#hero-badge').textContent = t >= 1 && t <= max && isWeekend(t) ? '🥣' : '🍽';
}

// ---------- вкладка «Сегодня» ----------
function renderToday() {
  const el = $('#tab-today');
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
  el.innerHTML = html;

  $('#prev').onclick = () => { viewDay--; renderToday(); };
  $('#next').onclick = () => { viewDay++; renderToday(); };
  el.querySelectorAll('[data-replace]').forEach((b) => {
    b.onclick = () => openReplace(n, b.dataset.replace);
  });
  el.querySelectorAll('[data-revert]').forEach((a) => {
    a.onclick = (e) => { e.preventDefault(); revertMeal(n, a.dataset.revert); renderToday(); toast('План восстановлен'); };
  });
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
    b.onclick = () => { setMeal(n, slot, b.dataset.pick); hideModal(); renderToday(); toast('Блюдо заменено'); };
  });
}

// ---------- вкладка «Блюда» ----------
function renderDishes() {
  const el = $('#tab-dishes');
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
  el.innerHTML = html;

  el.querySelectorAll('[data-filter]').forEach((b) => {
    b.onclick = () => { dishFilter = b.dataset.filter; renderDishes(); };
  });
  const qi = $('#dish-q');
  qi.oninput = () => {
    dishQuery = qi.value;
    const pos = qi.selectionStart;
    renderDishes();
    const again = $('#dish-q');
    again.focus();
    again.setSelectionRange(pos, pos);
  };
  el.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = () => {
      const idx = Number(b.dataset.del);
      const dish = D.dishes[idx];
      if (!confirm(`Удалить «${dish.name}»? Из плана оно не исчезнет, но для замены будет недоступно.`)) return;
      D.dishes.splice(idx, 1);
      write(KEY.dishes, D.dishes);
      renderDishes();
      toast('Блюдо удалено');
    };
  });
  $('#d-add').onclick = () => {
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
    renderDishes();
    toast('Блюдо добавлено');
  };
}

// ---------- вкладка «Покупки» ----------
function renderShopping() {
  const el = $('#tab-shopping');
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

  el.innerHTML = `
    <div class="shop-summary">
      <div class="row" style="justify-content:space-between">
        <div><div class="muted">Отмечено</div><div class="big">${doneCount} из ${all.length}</div></div>
        <button class="btn soft" id="reset-checks">Снять отметки</button>
      </div>
      <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
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

  el.querySelectorAll('input[data-key]').forEach((cb) => {
    cb.onchange = () => {
      const c = read(KEY.checked, {});
      if (cb.checked) c[cb.dataset.key] = true; else delete c[cb.dataset.key];
      write(KEY.checked, c);
      renderShopping();
    };
  });
  $('#reset-checks').onclick = () => { write(KEY.checked, {}); renderShopping(); toast('Отметки сняты'); };
  $('#save-receipt').onclick = () => {
    const total = parseFloat(String($('#r-total').value).replace(',', '.'));
    if (!total) return toast('Введите сумму чека');
    const rs = read(KEY.receipts, []);
    rs.unshift({
      date: $('#r-date').value,
      store: $('#r-store').value.trim(),
      total,
      items: checkedNames.length,
      note: ''
    });
    write(KEY.receipts, rs);
    write(KEY.checked, {});
    renderShopping();
    toast('Чек сохранён');
  };
  el.querySelectorAll('[data-rdel]').forEach((b) => {
    b.onclick = () => {
      const rs = read(KEY.receipts, []);
      rs.splice(Number(b.dataset.rdel), 1);
      write(KEY.receipts, rs);
      renderShopping();
    };
  });
}

// ---------- вкладка «Ещё» ----------
function renderSettings() {
  const el = $('#tab-settings');
  el.innerHTML = `
    <div class="card">
      <div class="setting-title">Первый день плана</div>
      <p class="setting-desc">От этой даты считается день 1 из 30.</p>
      <input id="s-start" type="date" value="${esc(D.startDate)}">
    </div>
    <div class="card">
      <div class="setting-title">База блюд и плана</div>
      <p class="setting-desc">Изменения хранятся в этом браузере. Чтобы они попали в репозиторий, экспортируйте data.json и замените им файл в проекте.</p>
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

  $('#s-start').onchange = (e) => {
    D.startDate = e.target.value;
    write(KEY.start, D.startDate);
    viewDay = Math.min(Math.max(todayDay(), 1), D.plan.length);
    renderAll();
    toast('Дата сохранена');
  };
  $('#s-export').onclick = () => {
    const data = { startDate: D.startDate, dishes: D.dishes, plan: D.plan, bulk: D.bulk, weekly: D.weekly };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'data.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $('#s-import').onchange = async (e) => {
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
      renderAll();
    } catch (err) {
      alert('Не удалось импортировать файл: ' + err.message);
    }
  };
  $('#s-reset').onclick = async () => {
    if (!confirm('Сбросить локальные правки?')) return;
    [KEY.dishes, KEY.plan, KEY.overrides, KEY.checked, KEY.start].forEach((k) => localStorage.removeItem(k));
    await loadBase();
    renderAll();
    toast('Правки сброшены');
  };
}

// ---------- загрузка и запуск ----------
async function loadBase() {
  const base = await (await fetch('data.json', { cache: 'no-store' })).json();
  D = {
    startDate: read(KEY.start, base.startDate),
    dishes: read(KEY.dishes, base.dishes),
    plan: read(KEY.plan, base.plan),
    bulk: base.bulk,
    weekly: base.weekly
  };
  viewDay = Math.min(Math.max(todayDay(), 1), D.plan.length);
}

function renderAll() {
  renderHero();
  renderToday();
  renderDishes();
  renderShopping();
  renderSettings();
}

function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('active', s.id === 'tab-' + name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function init() {
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.onclick = () => showTab(b.dataset.tab);
  });
  $('#modal-close').onclick = hideModal;
  $('#modal').onclick = (e) => { if (e.target.id === 'modal') hideModal(); };
  try {
    await loadBase();
    renderAll();
  } catch (err) {
    document.querySelector('main').innerHTML = `<div class="card">Не удалось загрузить data.json. Откройте приложение по ссылке GitHub Pages или через локальный сервер, а не файлом.<br><span class="muted">${esc(err.message)}</span></div>`;
  }
}

init();
