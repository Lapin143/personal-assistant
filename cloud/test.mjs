// Локальная проверка прокси с заглушкой Tabrica: node cloud/test.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const { handle } = createRequire(import.meta.url)('./index.js');

const env = {
  TABRICA_TOKEN: 'tab_secret_token',
  TABRICA_DB_ID: '349',
  TABRICA_TABLE_ID_RECORDS: '777',
  AUTH_SECRET: 'x'.repeat(40),
  AUTH_USER_1: 'Vlad:correct horse:battery',
  AUTH_USER_2: 'katya:another-password'
};
const ORIGIN = 'https://lapin143.github.io';
const calls = [];
const fakeFetch = async (url, init) => {
  calls.push({ url, init });
  return { status: init.method === 'POST' ? 201 : 200, text: async () => JSON.stringify({ message: 'success', data: { echo: init.body ? JSON.parse(init.body) : null } }) };
};
const ev = (method, { q = {}, headers = {}, body } = {}) => ({
  httpMethod: method, queryStringParameters: q,
  headers: { Origin: ORIGIN, ...headers },
  body: body === undefined ? '' : Buffer.from(JSON.stringify(body)).toString('base64'), isBase64Encoded: body !== undefined,
  requestContext: { identity: { sourceIp: '1.2.3.4' } }
});
const run = (e, e2 = env, now = 1_000_000) => handle(e, e2, fakeFetch, now);
const json = (r) => JSON.parse(r.body);
let n = 0;
const ok = (name) => console.log(`ok ${++n} ${name}`);

// CORS
let r = await run(ev('OPTIONS'));
assert.equal(r.statusCode, 204);
assert.equal(r.headers['Access-Control-Allow-Origin'], ORIGIN);
assert.match(r.headers['Access-Control-Allow-Headers'], /X-Auth-Token/);
ok('preflight');

r = await run(ev('GET', { headers: { Origin: 'https://evil.example' } }));
assert.equal(r.statusCode, 403);
assert.equal(r.headers['Access-Control-Allow-Origin'], undefined);
ok('чужой сайт отклонён');

// Без входа
r = await run(ev('GET', { headers: { 'X-Table-Name': 'records' } }));
assert.equal(r.statusCode, 401);
assert.equal(calls.length, 0);
ok('без пропуска запрос в Tabrica не уходит');

// Вход
r = await run(ev('POST', { q: { action: 'login' }, body: { login: 'vlad', password: 'wrong' } }));
assert.equal(r.statusCode, 401);
ok('неверный пароль');

r = await run(ev('POST', { q: { action: 'login' }, body: { login: 'nobody', password: 'no-user:nobody' } }));
assert.equal(r.statusCode, 401);
ok('несуществующий логин');

r = await run(ev('POST', { q: { action: 'login' }, body: { login: ' VLAD ', password: 'correct horse:battery' } }));
assert.equal(r.statusCode, 200);
const token = json(r).token;
assert.ok(token && !r.body.includes('correct horse') && !r.body.includes('tab_secret_token'));
ok('вход, пароль с двоеточием, логин без учёта регистра');

const auth = { 'x-auth-token': token, 'x-table-name': 'records' };

r = await run(ev('GET', { q: { action: 'ping' }, headers: auth }));
assert.equal(json(r).login, 'vlad');
ok('ping');

// Подделка и срок
r = await run(ev('GET', { headers: { ...auth, 'x-auth-token': token.slice(0, -2) + 'aa' } }));
assert.equal(r.statusCode, 401);
ok('подделанная подпись');

const forged = Buffer.from(JSON.stringify({ u: 'vlad', exp: 9e15, pv: 'x' })).toString('base64url') + '.' + token.split('.')[1];
r = await run(ev('GET', { headers: { ...auth, 'x-auth-token': forged } }));
assert.equal(r.statusCode, 401);
ok('подменённое содержимое');

r = await run(ev('GET', { headers: auth }), env, 1_000_000 + 91 * 24 * 3600 * 1000);
assert.equal(r.statusCode, 401);
ok('просроченный пропуск');

r = await run(ev('GET', { headers: auth }), { ...env, AUTH_USER_1: 'vlad:new-password-123' });
assert.equal(r.statusCode, 401);
ok('смена пароля отзывает пропуск');

r = await run(ev('GET', { headers: auth }), { ...env, AUTH_SECRET: 'y'.repeat(40) });
assert.equal(r.statusCode, 401);
ok('смена AUTH_SECRET отзывает пропуска');

// GET список
calls.length = 0;
r = await run(ev('GET', { headers: auth, q: { where: '(updated,gt,5)~and(kind,eq,tx)', limit: '5000', evil: '1', response_format: 'ids' } }));
assert.equal(r.statusCode, 200);
let u = new URL(calls[0].url);
assert.equal(u.pathname, '/public/v1/databases/349/tables/777/records');
assert.equal(u.searchParams.get('limit'), '1000');
assert.equal(u.searchParams.get('response_format'), 'names');
assert.equal(u.searchParams.get('where'), '(updated,gt,5)~and(kind,eq,tx)');
assert.equal(u.searchParams.get('evil'), null);
assert.equal(calls[0].init.headers.Authorization, 'Bearer tab_secret_token');
assert.equal(json(r).now, 1_000_000);
assert.ok(!r.body.includes('tab_secret_token'));
ok('GET: лимит, формат, фильтр, токен только в сторону Tabrica');

calls.length = 0;
await run(ev('GET', { headers: auth }));
assert.equal(new URL(calls[0].url).searchParams.get('limit'), '100');
ok('GET: лимит по умолчанию 100');

// POST / PATCH / DELETE
calls.length = 0;
r = await run(ev('POST', { headers: auth, body: { data: { key: 'a', updated: 1 } } }));
assert.equal(r.statusCode, 201);
assert.deepEqual(JSON.parse(calls[0].init.body), { data: { key: 'a', updated: 1_000_000 } });
ok('POST: время изменения ставит сервер');

calls.length = 0;
r = await run(ev('PATCH', { headers: auth, q: { id: '42' }, body: { data: { amount: 5 } } }));
assert.equal(calls[0].init.method, 'PATCH');
assert.ok(calls[0].url.endsWith('/records/42?response_format=names'));
ok('PATCH');

calls.length = 0;
r = await run(ev('DELETE', { headers: auth, q: { id: '42' } }));
assert.equal(calls[0].init.method, 'DELETE');
assert.ok(calls[0].url.endsWith('/records/42'));
ok('DELETE');

for (const [m, o] of [['PATCH', { body: { data: {} } }], ['DELETE', {}], ['DELETE', { q: { id: '4/../../x' } }], ['POST', { body: { nope: 1 } }], ['PUT', { q: { id: '1' }, body: { data: {} } }]]) {
  calls.length = 0;
  r = await run(ev(m, { headers: auth, ...o }));
  assert.ok(r.statusCode === 400 || r.statusCode === 405, `${m} → ${r.statusCode}`);
  assert.equal(calls.length, 0);
}
ok('некорректные запросы не уходят в Tabrica (в том числе PUT)');

calls.length = 0;
r = await run(ev('GET', { headers: { ...auth, 'x-table-name': 'secrets' } }));
assert.equal(r.statusCode, 400);
assert.equal(calls.length, 0);
ok('ненастроенная таблица');

// Пакет
calls.length = 0;
r = await run(ev('POST', { headers: auth, q: { action: 'batch' }, body: { ops: [
  { method: 'POST', data: { key: 'b' } }, { method: 'DELETE', id: 7 }, { method: 'PATCH', data: { a: 1 } }, { method: 'DELETE', id: 8 }
] } }));
let b = json(r);
assert.equal(b.done, 3);
assert.equal(b.results[2].status, 400);
assert.equal(calls.length, 2);
ok('пакет: по очереди, остановка на ошибке');

// Не настроено
r = await run(ev('GET', { headers: auth }), { ...env, AUTH_SECRET: 'short' });
assert.equal(r.statusCode, 500);
assert.match(json(r).message, /AUTH_SECRET/);
ok('понятная ошибка при неполной настройке');

// Tabrica недоступна
r = await handle(ev('GET', { headers: auth }), env, async () => { throw new Error('boom'); }, 1_000_000);
assert.equal(r.statusCode, 504);
ok('Tabrica не отвечает → 504');

// Плохой токен Tabrica не должен выглядеть как «нужен вход»
r = await handle(ev('GET', { headers: auth }), env, async () => ({ status: 401, text: async () => '{"message":"bad token"}' }), 1_000_000);
assert.equal(r.statusCode, 502);
assert.equal(json(r).error, 'upstream_auth');
ok('401 от Tabrica превращается в 502');

// Перебор паролей
for (let i = 0; i < 10; i++) await handle({ ...ev('POST', { q: { action: 'login' }, body: { login: 'katya', password: 'x' } }), requestContext: { identity: { sourceIp: '9.9.9.9' } } }, env, fakeFetch, 2_000_000);
r = await handle({ ...ev('POST', { q: { action: 'login' }, body: { login: 'katya', password: 'another-password' } }), requestContext: { identity: { sourceIp: '9.9.9.9' } } }, env, fakeFetch, 2_000_000);
assert.equal(r.statusCode, 429);
ok('блокировка после 10 неверных попыток');

console.log(`\nвсе ${n} проверок пройдены`);
