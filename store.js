// Синхронизация: состояние приложения ↔ записи таблицы Tabrica (через функцию-прокси).
// Без DOM и без сети: транспорт и хранилище передаются снаружи, поэтому модуль проверяется тестами.
//
// Как лежат данные (одна таблица records, одна строка = одна сущность):
//   tx|<id>        одна операция финансов
//   menu|<ГГГГ-ММ> меню месяца целиком (недели, статус, покупки) — JSON
//   list|<id>      один список — JSON
//   settings|main  общие настройки, люди, счета, категории — JSON
//   doc|<раздел>   остальные разделы (цели, напоминания, авто…) — JSON; doc|history_json — итоги закрытых месяцев
//
// Экономия запросов: при запуске один GET «что изменилось с прошлого раза», наверх уходят только изменённые строки.

export const CHUNK = 20000;            // длинный JSON делится на части такого размера
const OVERLAP_MS = 300000;             // запас при запросе изменений: записи с пограничным временем не теряются
const MIN_CHUNK = 2000;
const FULL_EVERY_MS = 7 * 86400000;    // полная сверка раз в неделю
const TOMB_KEEP_MS = 14 * 86400000;    // пометки об удалении живут 14 дней, потом строка удаляется совсем
const BATCH = 40;
const PAGE = 1000;
const SPECIAL = new Set(['transactions', 'lists', 'menu', 'settings', 'people', 'accounts', 'categories', 'history_json', 'updatedAt']);
const MENU_PARTS = new Set(['months', 'weeks', 'purchases', 'dishes']);
const TITLES = {
  recurring: 'Регулярные платежи', debts: 'Кредиты', goals: 'Цели', wishes: 'Вишлист', reminders: 'Напоминания',
  cars: 'Автомобили', carExpenses: 'Расходы на авто', meters: 'Счётчики', meterReadings: 'Показания счётчиков',
  homeTasks: 'Дела по дому', documents: 'Документы', incomes: 'Поступления', confirmed: 'Проведённые платежи',
  incomeConfirmed: 'Подтверждённые поступления', budgets: 'Лимиты', budgetPlans: 'Планы бюджета', cushion: 'Подушка',
  log: 'Журнал', reads: 'Прочитанное', remCats: 'Категории напоминаний', ideas: 'Идеи', gifts: 'Подарки', steps: 'Шаги',
  allowances: 'Личные лимиты'
};

// ---------- канонический JSON и хеш ----------

export function canon(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
}

export function hash(str) {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x85ebca6b) + a;
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

const isEmpty = (v) => v === null || v === undefined || (Array.isArray(v) ? v.length === 0 : typeof v === 'object' && Object.keys(v).length === 0);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const lastDayOf = (ym) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`; };

// ---------- состояние → логические записи ----------

export function toUnits(S) {
  const U = new Map();
  const put = (kind, key, data, extra = {}) => U.set(`${kind}|${key}`, { kind, key: String(key), title: '', date: '', amount: 0, category: '', ...extra, data });

  for (const t of S.transactions || []) {
    if (!t || !t.id) continue;
    put('tx', t.id, t, {
      date: String(t.date || ''), amount: Number(t.amount) || 0, category: String(t.category || ''),
      title: `${t.type === 'income' ? 'Доход' : 'Расход'}${t.note ? ': ' + t.note : ''}`.slice(0, 120)
    });
  }
  for (const l of S.lists || []) if (l && l.id) put('list', l.id, l, { title: String(l.title || '').slice(0, 120) });

  if (S.menu) {
    const menu = S.menu;
    const months = {};
    const rec = (ym) => (months[ym] ||= { month: null, weeks: {}, purchases: [] });
    for (const [ym, m] of Object.entries(menu.months || {})) rec(ym).month = m;
    for (const [mon, w] of Object.entries(menu.weeks || {})) rec(mon.slice(0, 7)).weeks[mon] = w;
    for (const p of menu.purchases || []) rec(String(p.date || '').slice(0, 7) || '0000-00').purchases.push(p);
    for (const [ym, d] of Object.entries(months)) put('menu', ym, d, { title: `Меню ${ym}` });
    put('doc', 'menu.dishes', { v: menu.dishes || [] }, { title: 'Библиотека блюд' });
    const meta = {};
    for (const k of Object.keys(menu)) if (!MENU_PARTS.has(k)) meta[k] = menu[k];
    put('doc', 'menu.meta', { v: meta }, { title: 'Меню: служебное' });
  }

  put('settings', 'main', { settings: S.settings || {}, people: S.people || [], accounts: S.accounts || [], categories: S.categories || {} }, { title: 'Общие настройки' });
  if (!isEmpty(S.history_json)) put('doc', 'history_json', { v: S.history_json }, { title: 'Итоги закрытых месяцев' });
  for (const k of Object.keys(S)) {
    if (SPECIAL.has(k) || S[k] === undefined) continue;
    put('doc', k, { v: S[k] }, { title: TITLES[k] || k });
  }
  return U;
}

// ---------- логические записи → состояние ----------

export function fromUnits(U, prev, rowIdOf = () => undefined) {
  const S = { ...prev };
  const tx = [];
  const lists = [];
  const menu = prev.menu ? { ...prev.menu, months: {}, weeks: {}, purchases: [] } : null;
  const prevTx = new Map((prev.transactions || []).map((t, i) => [t.id, i]));
  const prevLists = new Map((prev.lists || []).map((l, i) => [l.id, i]));

  for (const [id, u] of [...U.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const d = u.data;
    if (u.kind === 'tx') { if (d && d.id) tx.push([d, rowIdOf(id), prevTx.get(d.id)]); continue; }
    if (u.kind === 'list') { if (d && d.id) lists.push([d, rowIdOf(id), prevLists.get(d.id)]); continue; }
    if (u.kind === 'menu') {
      if (!menu || !d) continue;
      if (d.month) menu.months[u.key] = d.month;
      Object.assign(menu.weeks, d.weeks || {});
      menu.purchases.push(...(d.purchases || []));
      continue;
    }
    if (u.kind === 'settings') {
      if (!d) continue;
      for (const k of ['settings', 'people', 'accounts', 'categories']) if (d[k] !== undefined) S[k] = d[k];
      continue;
    }
    if (u.kind !== 'doc' || !d || !('v' in d)) continue;
    if (u.key === 'menu.dishes') { if (menu) menu.dishes = d.v || []; continue; }
    if (u.key === 'menu.meta') { if (menu) Object.assign(menu, d.v || {}); continue; }
    if (u.key === 'history_json') { S.history_json = d.v || {}; continue; }
    if (!SPECIAL.has(u.key)) S[u.key] = d.v;
  }

  // Порядок как при создании: сначала по номеру строки в таблице, новые (ещё не отправленные) в конце.
  const order = (a, b) => {
    const x = a[1] ?? Infinity;
    const y = b[1] ?? Infinity;
    if (x !== y) return x - y;
    return (a[2] ?? Infinity) - (b[2] ?? Infinity);
  };
  S.transactions = tx.sort(order).map((x) => x[0]);
  S.lists = lists.sort(order).map((x) => x[0]);
  if (menu) S.menu = menu;
  if (!U.has('doc|history_json') && prev.history_json) S.history_json = prev.history_json;
  return S;
}

// ---------- логические записи ↔ строки таблицы (длинный JSON режется на части) ----------

export function toRows(U, size = CHUNK) {
  const R = new Map();
  for (const [id, u] of U) {
    const s = canon(u.data);
    if (s.length <= size) { R.set(id, u); continue; }
    const parts = [];
    for (let i = 0; i < s.length; i += size) parts.push(s.slice(i, i + size));
    const v = hash(s);
    R.set(id, { ...u, data: { $chunks: parts.length, $v: v, $p: parts[0] } });
    for (let i = 1; i < parts.length; i++) {
      R.set(`${id}#${i}`, { kind: u.kind, key: `${u.key}#${i}`, title: `${u.title} (часть ${i + 1})`, date: '', amount: 0, category: '', data: { $v: v, $p: parts[i] } });
    }
  }
  return R;
}

// Возвращает { units, broken }: broken — записи, у которых части не сошлись (например, обновление пришло наполовину).
export function fromRows(R) {
  const units = new Map();
  const broken = [];
  for (const [id, r] of R) {
    if (r.key.includes('#')) continue;
    const d = r.data;
    if (!d || typeof d !== 'object' || !d.$chunks) { units.set(id, r); continue; }
    let s = d.$p || '';
    let ok = true;
    for (let i = 1; i < d.$chunks; i++) {
      const p = R.get(`${id}#${i}`);
      if (!p || !p.data || p.data.$v !== d.$v) { ok = false; break; }
      s += p.data.$p || '';
    }
    if (!ok || hash(s) !== d.$v) { broken.push(id); continue; }
    try { units.set(id, { ...r, data: JSON.parse(s) }); } catch { broken.push(id); }
  }
  return { units, broken };
}

export const rowHash = (r) => hash(canon([r.kind, r.key, r.title || '', r.date || '', Number(r.amount) || 0, r.category || '', r.data ?? null]));

function parseData(v) {
  if (typeof v !== 'string') return v ?? null;
  try { return JSON.parse(v); } catch { return null; }
}

// Запись из ответа Tabrica → строка в нашем виде. Чужие строки (без kind и key) пропускаются.
export function normRemote(rec) {
  if (!rec || typeof rec !== 'object') return null;
  const id = Number(rec.id ?? rec.row_id);
  if (!Number.isFinite(id)) return null;
  // Обычно поля лежат прямо в записи; на случай другого формата ответа понимаем и вложенный вид.
  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  const f = rec.kind !== undefined || rec.key !== undefined ? rec
    : isObj(rec.data) && ('kind' in rec.data || 'key' in rec.data) ? rec.data
      : isObj(rec.fields) ? rec.fields : rec;
  const kind = String(f.kind ?? '').trim();
  const key = String(f.key ?? '').trim();
  if (!kind || !key) return null;
  return {
    id, kind, key,
    title: String(f.title ?? ''), date: String(f.date ?? ''), amount: Number(f.amount) || 0, category: String(f.category ?? ''),
    data: parseData(f.data), deleted: Number(f.deleted) === 1 || f.deleted === true, updated: Number(f.updated) || 0
  };
}

// ---------- итоги закрытых месяцев ----------

export function summarize(txs) {
  const sum = { total_income: 0, total_expense: 0, categories: {}, income_categories: {}, rows: [], count: 0 };
  const idx = new Map();
  for (const t of txs) {
    const amount = Number(t.amount) || 0;
    const type = t.type === 'income' ? 'income' : 'expense';
    const category = t.category || 'Прочее';
    if (type === 'income') { sum.total_income += amount; sum.income_categories[category] = (sum.income_categories[category] || 0) + amount; }
    else { sum.total_expense += amount; sum.categories[category] = (sum.categories[category] || 0) + amount; }
    const k = canon([type, category, t.personId || '', Boolean(t.private)]);
    let row = idx.get(k);
    if (!row) { row = { type, category, personId: t.personId || '', private: Boolean(t.private), amount: 0, count: 0 }; idx.set(k, row); sum.rows.push(row); }
    row.amount += amount;
    row.count += 1;
    sum.count += 1;
  }
  return sum;
}

export function mergeSummary(a, b) {
  if (!a) return b;
  const out = clone(a);
  out.total_income = (a.total_income || 0) + b.total_income;
  out.total_expense = (a.total_expense || 0) + b.total_expense;
  out.count = (a.count || 0) + b.count;
  for (const f of ['categories', 'income_categories']) {
    out[f] ||= {};
    for (const [c, v] of Object.entries(b[f] || {})) out[f][c] = (out[f][c] || 0) + v;
  }
  out.rows ||= [];
  for (const r of b.rows) {
    const hit = out.rows.find((x) => x.type === r.type && x.category === r.category && (x.personId || '') === r.personId && Boolean(x.private) === r.private);
    if (hit) { hit.amount += r.amount; hit.count += r.count; } else out.rows.push({ ...r });
  }
  return out;
}

// Итоги закрытых месяцев в виде «сводных операций»: так их учитывают все графики и суммы.
export function historyOps(S) {
  const out = [];
  for (const [ym, h] of Object.entries((S && S.history_json) || {})) {
    if (!/^\d{4}-\d{2}$/.test(ym) || !h) continue;
    (h.rows || []).forEach((r, i) => out.push({
      id: `h|${ym}|${i}`, closed: true, type: r.type, amount: r.amount, category: r.category, date: lastDayOf(ym),
      personId: r.personId || '', private: Boolean(r.private), note: `Итог месяца, операций: ${r.count}`
    }));
  }
  return out;
}
export const allOps = (S) => [...((S && S.transactions) || []), ...historyOps(S)];
export const isClosed = (S, ym) => Boolean(S && S.history_json && S.history_json[ym]);

function mergeLists(local, remote) {
  if (local.kind !== 'doc' || local.key.includes('#')) return null;
  const a = local.data && local.data.v;
  const b = remote.data && remote.data.v;
  const withIds = (x) => Array.isArray(x) && x.length > 0 && x.every((i) => i && typeof i === 'object' && i.id !== undefined);
  if (!withIds(a) || !withIds(b)) return null;
  const have = new Set(b.map((i) => i.id));
  const extra = a.filter((i) => !have.has(i.id));
  return extra.length ? { ...remote, data: { v: [...b, ...extra] } } : null;
}

// ---------- движок синхронизации ----------

export function createSync({ api, storage, getState, setState, now = () => Date.now(), onStatus = () => {}, metaKey = 'as.sync' }) {
  const blank = () => ({ rows: {}, last: 0, lastFull: 0, tombs: {}, kill: [], jsonStr: false, needFull: false, lastOk: 0, chunk: CHUNK });
  let meta = blank();
  try { meta = { ...blank(), ...(JSON.parse(storage.getItem(metaKey)) || {}) }; } catch { meta = blank(); }
  const saveMeta = () => storage.setItem(metaKey, JSON.stringify(meta));
  let running = null;
  let lastError = '';

  const rowIdOf = (rk) => (meta.rows[rk] ? meta.rows[rk].id : undefined);
  const localRows = () => toRows(toUnits(getState()), meta.chunk || CHUNK);

  function pendingCount() {
    const S = getState();
    if (!S) return 0;
    let n = meta.kill.length;
    const desired = localRows();
    for (const [rk, row] of desired) {
      const m = meta.rows[rk];
      if (!m) { if (!skipNew(row)) n++; } else if (m.h !== rowHash(row)) n++;
    }
    for (const rk of Object.keys(meta.rows)) if (!desired.has(rk)) n++;
    return n;
  }

  // Пустые разделы, которых ещё нет в таблице, не создаются: строка появится, когда в разделе будут данные.
  const skipNew = (row) => row.kind === 'doc' && !row.key.includes('#') && !(row.data && row.data.$chunks) && isEmpty(row.data && row.data.v);

  // Операции закрытых месяцев: отправленные раньше просто убираются (они уже в итогах), новые добавляются в итоги.
  function foldClosed(S) {
    const closed = S.history_json || {};
    if (!Object.keys(closed).length || !(S.transactions || []).length) return false;
    const fold = {};
    const keep = [];
    let changed = false;
    for (const t of S.transactions) {
      const ym = String(t.date || '').slice(0, 7);
      if (!closed[ym]) { keep.push(t); continue; }
      changed = true;
      const rk = `tx|${t.id}`;
      if (meta.rows[rk]) delete meta.rows[rk]; // строку в таблице удаляет устройство, закрывшее месяц
      else (fold[ym] ||= []).push(t);
    }
    if (!changed) return false;
    S.transactions = keep;
    if (Object.keys(fold).length) {
      S.history_json = { ...closed };
      for (const [ym, txs] of Object.entries(fold)) S.history_json[ym] = mergeSummary(closed[ym], summarize(txs));
    }
    return true;
  }

  async function pull(full) {
    const records = [];
    let serverNow = 0;
    let requests = 0;
    const where = full || !meta.last ? undefined : `(updated,gt,${Math.max(0, meta.last - OVERLAP_MS)})`;
    for (let offset = 0; ; offset += PAGE) {
      const res = await api.list({ where, limit: PAGE, offset });
      requests++;
      serverNow = serverNow || res.now || now();
      records.push(...(res.records || []));
      if ((res.records || []).length < PAGE) break;
    }
    return { records, serverNow, full: !where, requests };
  }

  function apply(pulled) {
    const S = getState();
    const rows = localRows();
    const remoteIds = new Set();
    let changed = false;
    const t = now();

    const incoming = pulled.records.map(normRemote).filter(Boolean)
      .sort((a, b) => (a.deleted === b.deleted ? a.id - b.id : a.deleted ? -1 : 1)); // сначала пометки об удалении
    // Размер частей длинного JSON должен быть одинаковым на всех устройствах: берём тот, которым записана самая свежая строка.
    const newest = incoming.filter((r) => !r.deleted && r.data && r.data.$chunks > 1 && typeof r.data.$p === 'string').sort((a, b) => b.updated - a.updated)[0];
    const learned = newest && newest.data.$p.length >= MIN_CHUNK ? newest.data.$p.length : 0;
    for (const r of incoming) {
      remoteIds.add(r.id);
      const rk = `${r.kind}|${r.key}`;
      const m = meta.rows[rk];

      if (r.deleted) {
        meta.tombs[r.id] = meta.tombs[r.id] || r.updated || t;
        if (m && m.id === r.id) {
          delete meta.rows[rk];
          if (rows.delete(rk)) changed = true;
        }
        continue;
      }
      // Две строки с одним ключом (два устройства создали раздел одновременно): остаётся строка с меньшим номером.
      if (m && m.id !== r.id) {
        const drop = Math.max(m.id, r.id);
        if (!meta.kill.includes(drop)) meta.kill.push(drop);
        if (r.id > m.id) continue;
        m.id = r.id;
      }
      const content = { kind: r.kind, key: r.key, title: r.title, date: r.date, amount: r.amount, category: r.category, data: r.data };
      const rh = rowHash(content);
      if (m && m.h === rh) continue;
      const local = rows.get(rk);
      const dirty = Boolean(m && local && rowHash(local) !== m.h) || Boolean(m && !local);
      if (dirty) { m.id = r.id; continue; } // правили здесь после последней отправки: уйдёт наша версия
      meta.rows[rk] = { id: r.id, h: rh };
      if (!local || rowHash(local) !== rh) {
        // Раздел заполнили на двух устройствах до первой синхронизации: объединяем элементы по id, ничего не теряя.
        const merged = !m && local ? mergeLists(local, content) : null;
        rows.set(rk, merged || content);
        changed = true;
      }
    }

    // Полная сверка: строки, которых в таблице больше нет, удалены на другом устройстве.
    if (pulled.full) {
      for (const [rk, m] of Object.entries(meta.rows)) {
        if (remoteIds.has(m.id)) continue;
        delete meta.rows[rk];
        if (rows.delete(rk)) changed = true;
      }
      for (const id of Object.keys(meta.tombs)) if (!remoteIds.has(Number(id))) delete meta.tombs[id];
      meta.kill = meta.kill.filter((id) => remoteIds.has(id));
      meta.lastFull = t;
      meta.needFull = false;
    }

    let next = S;
    if (changed) {
      const { units, broken } = fromRows(rows);
      if (broken.length) {
        meta.needFull = true;
        const mine = toUnits(S);
        for (const id of broken) if (mine.has(id)) units.set(id, mine.get(id));
      }
      next = fromUnits(units, S, rowIdOf);
    }
    if (foldClosed(next)) changed = true;
    if (changed) { next.updatedAt = t; setState(next); }
    if (learned && learned !== meta.chunk) meta.chunk = learned;
    return changed;
  }

  function buildOps() {
    const t = now();
    const ops = [];
    const desired = localRows();
    for (const [rk, row] of desired) {
      const h = rowHash(row);
      const m = meta.rows[rk];
      const data = { key: row.key, kind: row.kind, title: row.title || '', date: row.date || '', amount: Number(row.amount) || 0, category: row.category || '', data: meta.jsonStr ? JSON.stringify(row.data) : row.data, deleted: 0 };
      if (!m) { if (!skipNew(row)) ops.push({ rk, h, method: 'POST', data }); }
      else if (m.h !== h) ops.push({ rk, h, method: 'PATCH', id: m.id, data });
    }
    // Удалённое здесь помечается в таблице: так второе устройство узнаёт об удалении одним запросом изменений.
    for (const [rk, m] of Object.entries(meta.rows)) {
      if (!desired.has(rk)) ops.push({ rk, method: 'PATCH', id: m.id, tomb: true, data: { deleted: 1, title: '', amount: 0, category: '', date: '', data: meta.jsonStr ? '{}' : {} } });
    }
    for (const id of meta.kill) ops.push({ method: 'DELETE', id, kill: true });
    for (const [id, at] of Object.entries(meta.tombs)) if (t - at > TOMB_KEEP_MS) ops.push({ method: 'DELETE', id: Number(id), purge: true });
    return ops;
  }

  function settle(op, res, serverNow) {
    const ok = res.status >= 200 && res.status < 300;
    const gone = res.status === 404;
    if (op.method === 'DELETE') {
      if (!ok && !gone) return false;
      meta.kill = meta.kill.filter((id) => id !== op.id);
      delete meta.tombs[op.id];
      return true;
    }
    if (op.tomb) {
      if (!ok && !gone) return false;
      delete meta.rows[op.rk];
      if (ok) meta.tombs[op.id] = serverNow || now();
      return true;
    }
    if (op.method === 'PATCH' && gone) { delete meta.rows[op.rk]; return true; } // строки уже нет: создадим заново при следующей отправке
    if (!ok) return false;
    if (op.method === 'POST') {
      const d = (res.body && res.body.data) || {};
      const id = Number(d.id ?? (d.record && d.record.id));
      if (!Number.isFinite(id)) return false;
      meta.rows[op.rk] = { id, h: op.h };
    } else meta.rows[op.rk] = { id: op.id, h: op.h };
    return true;
  }

  const errorText = (res) => {
    const b = (res && res.body) || {};
    const code = String(b.error || b.code || (b.detail && b.detail.code) || '');
    const msg = String(b.message || (typeof b.detail === 'string' ? b.detail : '') || '');
    if (/row_limit_exceeded/.test(code + msg)) return 'В Табрике закончился лимит записей. Закройте старые месяцы в Финансах.';
    if (/tabular_data_limit_exceeded/.test(code + msg)) return 'В Табрике закончился объём данных.';
    if (res && res.status === 429) return 'Лимит запросов исчерпан. Синхронизация возобновится в новом расчётном периоде.';
    return `Ошибка сервера ${res ? res.status : ''}${msg ? ': ' + msg : code ? ': ' + code : ''}`.trim();
  };

  async function push(opts = {}) {
    let sent = 0;
    let requests = 0;
    let triedStr = false;
    let sentBeforeStr = 0;
    for (let guard = 0; guard < 80; guard++) {
      if (!triedStr) sentBeforeStr = sent;
      const ops = buildOps();
      if (!ops.length) break;
      const chunk = ops.slice(0, BATCH);
      const res = await api.batch(chunk.map((o) => ({ method: o.method, id: o.id, data: o.data })), opts);
      const results = res.results || [];
      let failed = null;
      for (let i = 0; i < results.length; i++) {
        requests++;
        if (settle(chunk[i], results[i], res.now)) sent++;
        else { failed = results[i]; break; }
      }
      saveMeta();
      if (failed) {
        // Tabrica не приняла JSON объектом: один раз пробуем отправить его строкой.
        const text = JSON.stringify(failed.body || '');
        const limit = /row_limit_exceeded|tabular_data_limit_exceeded/.test(text);
        const bad = [400, 413, 422].includes(failed.status) && !limit;
        const op = chunk[results.length - 1] || {};
        const size = op.data && op.data.data !== undefined ? JSON.stringify(op.data.data).length : 0;
        // Запись не принята из-за размера: делим длинный JSON на более мелкие части и пробуем снова.
        if (bad && size > MIN_CHUNK && (meta.chunk || CHUNK) > MIN_CHUNK && (failed.status === 413 || /too_large|invalid_data|validation/.test(text) || size > (meta.chunk || CHUNK) / 2)) {
          meta.chunk = Math.max(MIN_CHUNK, Math.floor(Math.min(meta.chunk || CHUNK, size) / 2));
          saveMeta();
          continue;
        }
        if (!meta.jsonStr && !triedStr && bad && failed.status !== 413) { meta.jsonStr = true; triedStr = true; saveMeta(); continue; }
        if (triedStr && sent === sentBeforeStr) { meta.jsonStr = false; saveMeta(); } // строкой тоже не принято: дело не в формате
        const err = new Error(errorText(failed));
        err.requests = requests;
        throw err;
      }
      if (!results.length) throw new Error('Сервер не выполнил ни одной операции');
    }
    return { sent, requests };
  }

  async function run(opts = {}) {
    const stats = { ok: false, changed: false, sent: 0, requests: 0, error: '' };
    onStatus({ busy: true });
    try {
      if (!getState()) throw new Error('нет данных');
      const full = Boolean(opts.full || meta.needFull || !meta.last || now() - (meta.lastFull || 0) > FULL_EVERY_MS);
      const pulled = await pull(full);
      stats.requests += pulled.requests;
      stats.changed = apply(pulled);
      saveMeta();
      const pushed = await push(opts);
      stats.sent = pushed.sent;
      stats.requests += pushed.requests;
      meta.last = pulled.serverNow;
      meta.lastOk = now();
      saveMeta();
      stats.ok = true;
      lastError = '';
    } catch (err) {
      stats.requests += err.requests || 0;
      stats.error = err.message || String(err);
      stats.auth = Boolean(err.auth);
      lastError = stats.error;
      saveMeta();
    }
    onStatus({ busy: false, ...stats });
    return stats;
  }

  function sync(opts) {
    if (!running) running = run(opts).finally(() => { running = null; });
    return running;
  }

  // Закрытие месяца: итоги уходят в history_json, затем исходные операции удаляются из таблицы.
  // Порядок важен: сначала сохраняются итоги; если это не удалось, удаление не начинается.
  async function closeMonth(ym) {
    const S0 = getState();
    if (!/^\d{4}-\d{2}$/.test(ym)) return { ok: false, error: 'Некорректный месяц' };
    const first = await sync();
    if (!first.ok) return { ok: false, error: first.error || 'Нет связи с сервером' };
    const S = getState() || S0;
    const txs = (S.transactions || []).filter((t) => String(t.date || '').startsWith(ym));
    if (!txs.length && !isClosed(S, ym)) return { ok: false, error: 'В этом месяце нет операций' };
    const next = { ...S };
    next.history_json = { ...(S.history_json || {}) };
    next.history_json[ym] = { ...mergeSummary(S.history_json && S.history_json[ym], summarize(txs)), closed_at: new Date(now()).toISOString() };
    next.transactions = (S.transactions || []).filter((t) => !String(t.date || '').startsWith(ym));
    for (const t of txs) {
      const rk = `tx|${t.id}`;
      if (meta.rows[rk]) { if (!meta.kill.includes(meta.rows[rk].id)) meta.kill.push(meta.rows[rk].id); delete meta.rows[rk]; }
    }
    next.updatedAt = now();
    setState(next);
    saveMeta();
    const second = await sync();
    return { ok: second.ok, error: second.error, count: txs.length, requests: first.requests + second.requests, summary: next.history_json[ym] };
  }

  return {
    sync, closeMonth, pendingCount,
    // Вызывается перед сохранением: операция, добавленная в закрытый месяц, сразу уходит в его итоги.
    tidy: (S) => { const c = foldClosed(S); if (c) saveMeta(); return c; },
    busy: () => Boolean(running),
    info: () => ({ last: meta.lastOk, lastFull: meta.lastFull, rows: Object.keys(meta.rows).length, error: lastError }),
    reset: () => { meta = blank(); storage.removeItem(metaKey); }
  };
}
