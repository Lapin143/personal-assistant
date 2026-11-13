// Сквозная проверка синхронизации: два «устройства» → настоящий код функции → имитация Tabrica.
// Запуск: node cloud/sync.test.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createSync, toUnits, fromUnits, toRows, fromRows, canon, allOps, CHUNK } from '../store.js';
import { monthSummary } from '../core.js';
import { makeTabrica } from './fake-tabrica.mjs';

const { handle } = createRequire(import.meta.url)('./index.js');
const base = JSON.parse(readFileSync(new URL('../data.json', import.meta.url), 'utf8'));

// ---------- окружение: функция + устройство ----------
const env = { TABRICA_TOKEN: 'tab_secret', TABRICA_DB_ID: '349', TABRICA_TABLE_ID_RECORDS: '513', AUTH_SECRET: 's'.repeat(40), AUTH_USER_1: 'vlad:password-one', AUTH_USER_2: 'katya:password-two' };
let clock = Date.UTC(2026, 10, 13, 12);
const tick = (ms = 1000) => { clock += ms; };

async function fn(tabrica, method, query, body, token) {
  tick(5);
  const r = await handle({
    httpMethod: method, queryStringParameters: query || {},
    headers: { Origin: 'https://lapin143.github.io', 'X-Table-Name': 'records', ...(token ? { 'X-Auth-Token': token } : {}) },
    body: body === undefined ? '' : JSON.stringify(body)
  }, env, tabrica.fetch, clock);
  return { status: r.statusCode, json: JSON.parse(r.body || '{}') };
}

async function makeDevice(tabrica, login, password, initial) {
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const lg = await fn(tabrica, 'POST', { action: 'login' }, { login, password });
  assert.equal(lg.status, 200);
  const dev = { S: structuredClone(initial), token: lg.json.token, requests: 0, storage };
  const fail = (r) => { const e = new Error(r.json.message || r.json.error || String(r.status)); e.status = r.status; e.auth = r.status === 401; return e; };
  const api = {
    async list({ where, limit, offset }) {
      const q = { limit: String(limit) };
      if (where) q.where = where;
      if (offset) q.offset = String(offset);
      const r = await fn(tabrica, 'GET', q, undefined, dev.token);
      if (r.status >= 400) throw fail(r);
      dev.requests++;
      return { records: r.json.data.records, now: r.json.now };
    },
    async batch(ops) {
      const r = await fn(tabrica, 'POST', { action: 'batch' }, { ops }, dev.token);
      if (r.status >= 400) throw fail(r);
      dev.requests += r.json.done;
      return { results: r.json.results, now: r.json.now };
    }
  };
  dev.sync = createSync({ api, storage, getState: () => dev.S, setState: (s) => { dev.S = s; }, now: () => clock });
  dev.go = async (opts) => { tick(); const before = dev.requests; const r = await dev.sync.sync(opts); r.used = dev.requests - before; return r; };
  return dev;
}

const sample = () => {
  const S = structuredClone(base);
  Object.assign(S, {
    lists: [{ id: 'l1', title: 'Покупки', items: [{ id: 'i1', text: 'Молоко', done: false }] }],
    goals: [{ id: 'g1', title: 'Отпуск', target: 100000, saved: 5000 }],
    recurring: [{ id: 'r1', title: 'Интернет', amount: 600, day: 25, active: true, category: 'Связь' }],
    confirmed: {}, incomes: [], ideas: [], log: [], cushion: { months: 3, saved: 0 },
    transactions: [
      { id: 't1', type: 'expense', amount: 1990, date: '2026-11-03', category: 'Продукты', account: 'a1', note: 'Лента' },
      { id: 't2', type: 'income', amount: 20000, date: '2026-11-05', category: 'Зарплата', personId: 'p1' },
      { id: 'o1', type: 'expense', amount: 500, date: '2026-10-10', category: 'Продукты' },
      { id: 'o2', type: 'expense', amount: 700, date: '2026-10-12', category: 'Транспорт', personId: 'p1', private: true },
      { id: 'o3', type: 'income', amount: 90000, date: '2026-10-15', category: 'Зарплата' }
    ]
  });
  S.menu.weeks = { '2026-11-09': { status: 'draft', days: { '2026-11-10': { breakfast: 'Овсянка' } } }, '2026-10-26': { status: 'bought', days: {} } };
  S.menu.months = { '2026-11': { status: 'draft', long: null } };
  S.menu.purchases = [{ id: 'pu1', kind: 'week', week: '2026-10-26', ym: null, date: '2026-10-27', store: 'Лента', total: 3200, method: 'manual', items: [], byCat: {} }];
  return S;
};
// Сравнение состояний по содержанию; пустые разделы не считаются (в таблицу они не отправляются).
const emptyDoc = (u) => u.kind === 'doc' && (u.data.v === null || (Array.isArray(u.data.v) ? !u.data.v.length : typeof u.data.v === 'object' && !Object.keys(u.data.v).length));
const viewMap = (S) => new Map([...toUnits(S).entries()].filter(([, u]) => !emptyDoc(u)).map(([k, u]) => [k, canon(u)]));
const view = (S) => canon([...viewMap(S).entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
function same(x, y, label = '') {
  const a = viewMap(x);
  const b = viewMap(y);
  const diff = [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k));
  if (diff.length) throw new Error(`состояния различаются ${label}: ${diff.slice(0, 6).join(', ')}`);
}
let n = 0;
const ok = (name) => console.log(`ok ${++n} ${name}`);

// 1. Разбор и сборка
{
  const S = sample();
  const U = toUnits(S);
  const back = fromUnits(U, S);
  same(back, S);
  assert.equal(view(fromUnits(toUnits(back), back)), view(S));
  const { units, broken } = fromRows(toRows(U));
  assert.equal(broken.length, 0);
  assert.equal(canon([...units]), canon([...U]));
  ok('состояние → записи → состояние без потерь');
}

// 2. Перенос данных с первого устройства
const T = makeTabrica();
const A = await makeDevice(T, 'vlad', 'password-one', sample());
let r = await A.go();
assert.ok(r.ok, r.error);
const kinds = [...T.rows.values()].reduce((a, x) => { a[x.kind] = (a[x.kind] || 0) + 1; return a; }, {});
assert.equal(kinds.tx, 5);
assert.equal(kinds.list, 1);
assert.equal(kinds.menu, 2);
assert.equal(kinds.settings, 1);
assert.ok([...T.rows.values()].every((x) => x.updated > 0 && x.deleted === 0));
assert.equal(A.sync.pendingCount(), 0);
console.log(`   строк в таблице: ${T.rows.size}, запросов на перенос: ${r.used}`);
ok('первое устройство переносит данные в пустую таблицу');

r = await A.go();
assert.equal(r.used, 1);
assert.equal(r.sent, 0);
ok('повторная синхронизация без изменений: ровно 1 запрос');

// 3. Второе устройство получает всё
const B = await makeDevice(T, 'katya', 'password-two', structuredClone(base));
r = await B.go();
assert.ok(r.ok, r.error);
same(B.S, A.S);
assert.equal(r.sent, 0);
assert.equal(B.sync.pendingCount(), 0);
assert.deepEqual(B.S.transactions.map((t) => t.id), A.S.transactions.map((t) => t.id));
ok('второе устройство получает данные и ничего не дублирует');

// 4. Добавление операций на обоих устройствах
A.S.transactions.push({ id: 't3', type: 'expense', amount: 300, date: '2026-11-13', category: 'Кафе' });
B.S.transactions.push({ id: 't4', type: 'expense', amount: 450, date: '2026-11-13', category: 'Транспорт' });
r = await A.go();
assert.equal(r.used, 2); // запрос изменений + одна новая строка
r = await B.go();
assert.equal(r.used, 2);
r = await A.go();
assert.equal(r.used, 1);
same(A.S, B.S);
assert.equal(A.S.transactions.length, 7);
ok('операции с двух устройств сходятся; новая операция = 2 запроса');

// 5. Правка списка
A.S.lists[0].items.push({ id: 'i2', text: 'Хлеб', done: false });
A.S.lists[0].items[0].done = true;
r = await A.go();
assert.equal(r.used, 2);
await B.go();
assert.equal(B.S.lists[0].items.length, 2);
assert.equal(B.S.lists[0].items[0].done, true);
ok('правка списка доходит до второго устройства одной строкой');

// 6. Нет «пинг-понга»: после схождения обмен не порождает записей
for (let i = 0; i < 3; i++) { r = await A.go(); assert.equal(r.sent, 0); r = await B.go(); assert.equal(r.sent, 0); }
ok('после схождения лишних записей нет');

// 7. Удаление операции
const rowsBefore = T.rows.size;
A.S.transactions = A.S.transactions.filter((t) => t.id !== 't3');
await A.go();
assert.equal(T.rows.size, rowsBefore);
assert.equal([...T.rows.values()].filter((x) => x.deleted === 1).length, 1);
await B.go();
assert.ok(!B.S.transactions.some((t) => t.id === 't3'));
same(A.S, B.S);
clock += 15 * 86400000;
await A.go();
assert.equal([...T.rows.values()].filter((x) => x.deleted === 1).length, 0);
assert.equal(T.rows.size, rowsBefore - 1);
await B.go();
same(A.S, B.S);
ok('удаление: пометка, второе устройство убирает запись, через 14 дней строка удаляется совсем');

// 8. Одновременная правка одного раздела: побеждает последняя отправка, ничего не ломается
A.S.goals[0].saved = 7000;
B.S.goals[0].saved = 9000;
await A.go();
await B.go();
await A.go();
assert.equal(A.S.goals[0].saved, 9000);
same(A.S, B.S);
ok('конфликт правок одного раздела разрешается без рассинхронизации');

// 9. Раздел, заполненный на двух устройствах до синхронизации, объединяется
A.S.ideas = [{ id: 'ia', text: 'Идея A' }];
B.S.ideas = [{ id: 'ib', text: 'Идея B' }];
await A.go();
await B.go();
await A.go();
assert.deepEqual(A.S.ideas.map((x) => x.id).sort(), ['ia', 'ib']);
same(A.S, B.S);
assert.equal([...T.rows.values()].filter((x) => x.key === 'ideas' && x.deleted !== 1).length, 1);
ok('новый раздел с двух устройств объединяется по id');

// 10. Длинный JSON режется на части и собирается
assert.ok(canon({ v: A.S.menu.dishes }).length > CHUNK);
const parts = [...T.rows.values()].filter((x) => x.key.startsWith('menu.dishes'));
assert.ok(parts.length >= 2);
assert.ok(parts.every((x) => JSON.stringify(x.data).length < CHUNK * 1.6));
assert.equal(B.S.menu.dishes.length, base.menu.dishes.length);
A.S.menu.dishes[A.S.menu.dishes.length - 1].name += ' (новое)';
r = await A.go();
assert.ok(r.sent <= parts.length);
await B.go();
assert.equal(B.S.menu.dishes.at(-1).name, A.S.menu.dishes.at(-1).name);
A.S.menu.dishes = A.S.menu.dishes.slice(0, 5);
await A.go();
await B.go();
assert.equal(B.S.menu.dishes.length, 5);
same(A.S, B.S);
ok(`библиотека блюд хранится частями (${parts.length} строки) и сходится после правок`);

// 11. Закрытие месяца
const before = monthSummary(A.S, '2026-10', 'p1');
const beforeOther = monthSummary(A.S, '2026-10', 'p2');
const rowsBeforeClose = T.rows.size;
r = await A.sync.closeMonth('2026-10');
assert.ok(r.ok, r.error);
assert.equal(r.count, 3);
assert.ok(!A.S.transactions.some((t) => t.date.startsWith('2026-10')));
assert.equal(A.S.history_json['2026-10'].total_income, 90000);
assert.equal(A.S.history_json['2026-10'].total_expense, 1200);
assert.deepEqual(A.S.history_json['2026-10'].categories, { Продукты: 500, Транспорт: 700 });
assert.equal(T.rows.size, rowsBeforeClose - 3 + 1);
assert.deepEqual(monthSummary(A.S, '2026-10', 'p1'), before);
assert.deepEqual(monthSummary(A.S, '2026-10', 'p2'), beforeOther); // личная операция p1 скрыта от p2 и после закрытия
const hist = [...T.rows.values()].find((x) => x.key === 'history_json');
assert.ok(hist && hist.data.v['2026-10']);
ok('закрытие месяца: итоги в history_json, строки удалены, суммы не изменились');

// Второе устройство до синхронизации успело добавить операцию в закрываемый месяц
B.S.transactions.push({ id: 'late', type: 'expense', amount: 100, date: '2026-10-30', category: 'Продукты' });
r = await B.go();
assert.ok(r.ok, r.error);
assert.ok(!B.S.transactions.some((t) => t.date.startsWith('2026-10')));
assert.equal(B.S.history_json['2026-10'].total_expense, 1300);
await A.go();
assert.equal(A.S.history_json['2026-10'].total_expense, 1300);
same(A.S, B.S);
assert.ok(![...T.rows.values()].some((x) => x.kind === 'tx' && String(x.date).startsWith('2026-10')));
assert.equal(allOps(A.S).filter((o) => o.closed).reduce((a, o) => a + (o.type === 'income' ? 0 : o.amount), 0), 1300);
ok('операция, добавленная в закрытый месяц на другом устройстве, попадает в итоги');

// Операция в закрытый месяц на том же устройстве
A.S.transactions.push({ id: 'late2', type: 'income', amount: 50, date: '2026-10-31', category: 'Прочее' });
assert.equal(A.sync.tidy(A.S), true);
assert.equal(A.S.history_json['2026-10'].total_income, 90050);
assert.ok(!A.S.transactions.some((t) => t.id === 'late2'));
await A.go();
await B.go();
same(A.S, B.S);
ok('операция в закрытый месяц сразу уходит в итоги');

// 12. Полная сверка находит строки, удалённые в самой Табрике
const victim = [...T.rows.values()].find((x) => x.kind === 'tx' && x.key === 't1');
T.rows.delete(victim.id);
r = await A.go({ full: true });
assert.ok(r.ok);
assert.ok(!A.S.transactions.some((t) => t.id === 't1'));
ok('полная сверка убирает то, что удалено в таблице вручную');

// 13. Плохой токен Tabrica: ошибка, но данные и вход на месте
T.badToken = true;
A.S.transactions.push({ id: 't9', type: 'expense', amount: 10, date: '2026-11-28', category: 'Кафе' });
r = await A.go();
assert.equal(r.ok, false);
assert.ok(!r.auth);
assert.match(r.error, /токен/i);
assert.ok(A.S.transactions.some((t) => t.id === 't9'));
T.badToken = false;
r = await A.go();
assert.ok(r.ok);
assert.ok([...T.rows.values()].some((x) => x.key === 't9'));
ok('сбой на стороне Tabrica не теряет изменения: они уходят при следующей попытке');

// 14. Неверный пропуск
const saved = A.token;
A.token = 'bad.token';
r = await A.go();
assert.equal(r.ok, false);
assert.equal(r.auth, true);
A.token = saved;
ok('недействительный пропуск распознаётся как «нужен вход»');

// 15. Лимит строк
T.rowLimit = T.rows.size;
A.S.transactions.push({ id: 't10', type: 'expense', amount: 10, date: '2026-11-28', category: 'Кафе' });
r = await A.go();
assert.equal(r.ok, false);
assert.match(r.error, /лимит записей/);
T.rowLimit = 1000;
r = await A.go();
assert.ok(r.ok);
ok('исчерпанный лимит строк даёт понятное сообщение, после освобождения места всё уходит');

// 16. Tabrica отдаёт JSON строкой / принимает только строку
for (const mode of [{ jsonAsString: true }, { rejectObjects: true, jsonAsString: true }]) {
  const T2 = makeTabrica(mode);
  const C = await makeDevice(T2, 'vlad', 'password-one', sample());
  r = await C.go();
  assert.ok(r.ok, r.error);
  const D = await makeDevice(T2, 'katya', 'password-two', structuredClone(base));
  r = await D.go();
  assert.ok(r.ok, r.error);
  same(D.S, C.S);
  r = await C.go();
  assert.equal(r.sent, 0);
}
ok('работает при любом представлении JSON-поля в Tabrica');

// 16а. Tabrica не принимает длинные значения: части JSON уменьшаются сами, второе устройство подстраивается
{
  const T4 = makeTabrica({ maxJson: 6000 });
  const E = await makeDevice(T4, 'vlad', 'password-one', sample());
  r = await E.go();
  assert.ok(r.ok, r.error);
  assert.ok([...T4.rows.values()].every((x) => JSON.stringify(x.data).length <= 6000));
  const F = await makeDevice(T4, 'katya', 'password-two', structuredClone(base));
  r = await F.go();
  assert.ok(r.ok, r.error);
  same(E.S, F.S);
  F.S.menu.dishes[0].name += ' ★';
  r = await F.go();
  assert.ok(r.ok, r.error);
  await E.go();
  assert.equal(E.S.menu.dishes[0].name, F.S.menu.dishes[0].name);
  for (let i = 0; i < 2; i++) { r = await E.go(); assert.equal(r.sent, 0); r = await F.go(); assert.equal(r.sent, 0); }
  same(E.S, F.S);
  ok('ограничение размера значения: JSON делится мельче, устройства сходятся без лишних записей');
}

// 16б. Другой формат ответа (поля вложены) и временные отказы 429
{
  const T5 = makeTabrica({ nested: true, throttleEvery: 7 });
  const G = await makeDevice(T5, 'vlad', 'password-one', sample());
  r = await G.go();
  assert.ok(r.ok, r.error);
  const H = await makeDevice(T5, 'katya', 'password-two', structuredClone(base));
  r = await H.go();
  assert.ok(r.ok, r.error);
  same(G.S, H.S);
  assert.equal(r.sent, 0);
  ok('вложенный формат записей и временные отказы 429 не мешают синхронизации');
}

// 17. Месячный бюджет запросов: 30 дней обычного использования двумя людьми
{
  const T3 = makeTabrica();
  const P = await makeDevice(T3, 'vlad', 'password-one', sample());
  const Q = await makeDevice(T3, 'katya', 'password-two', structuredClone(base));
  await P.go();
  await Q.go();
  const start = T3.requests;
  let id = 0;
  for (let day = 0; day < 30; day++) {
    for (const d of [P, Q]) {
      for (let open = 0; open < 8; open++) {           // 8 открытий приложения в день
        clock += 3600000;
        if (open < 3) d.S.transactions.push({ id: `m${id++}`, type: 'expense', amount: 100 + id, date: '2026-11-20', category: 'Продукты' }); // 3 операции
        if (open === 4) d.S.lists[0].items.push({ id: `li${id++}`, text: 'x', done: false });                                              // правка списка
        if (open === 5) (d.S.menu.weeks['2026-11-09'].days['2026-11-11'] ||= {})[`d${day}`] = 'x';                                          // правка меню
        if (open === 6) d.S.goals[0].saved += 100;                                                                                         // правка раздела
        const s = await d.go();
        assert.ok(s.ok, s.error);
      }
    }
  }
  const used = T3.requests - start;
  console.log(`   запросов к Tabrica за 30 дней (2 человека × 8 открытий и 6 изменений в день): ${used}, строк: ${T3.rows.size}`);
  assert.ok(used < 3000, `бюджет превышен: ${used}`);
  await Q.go(); await P.go(); await Q.go();
  same(P.S, Q.S);
  ok('месяц обычного использования укладывается в 3 000 запросов');
}

console.log(`\nвсе ${n} проверок пройдены`);
