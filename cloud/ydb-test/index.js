'use strict';

// Isolated YDB backend for the phone-test build. This function does not read
// or write Tabrica and has no connection to the production function.
const crypto = require('node:crypto');

const TABLE = 'records';
const API = '/public/v1';
const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_BATCH = 100;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const MIN_SECRET = 32;
const MIN_PASSWORD = 8;
const DEFAULT_ORIGINS = 'https://lapin143.github.io';
let driver;
let readyPromise;
const failures = new Map();

const b64u = (b) => Buffer.from(b).toString('base64url');
const hmac = (s, t) => crypto.createHmac('sha256', s).update(t).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(
  crypto.createHash('sha256').update(String(a)).digest(),
  crypto.createHash('sha256').update(String(b)).digest()
);

function users(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (!/^AUTH_USER_\w+$/.test(k) || !v) continue;
    const i = v.indexOf(':');
    if (i < 1) continue;
    const login = v.slice(0, i).trim().toLowerCase();
    const password = v.slice(i + 1);
    if (login && password.length >= MIN_PASSWORD) out[login] = password;
  }
  return out;
}
const passwordMark = (secret, login, password) => b64u(hmac(secret, `pw:${login}:${password}`)).slice(0, 16);
function issueToken(env, login, password, now) {
  const payload = b64u(JSON.stringify({ u: login, exp: now + TOKEN_TTL_MS, pv: passwordMark(env.AUTH_SECRET, login, password) }));
  return `${payload}.${b64u(hmac(env.AUTH_SECRET, payload))}`;
}
function checkToken(env, token, now) {
  if (typeof token !== 'string' || token.length > 600) return null;
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined || !safeEqual(sig, b64u(hmac(env.AUTH_SECRET, payload)))) return null;
  let p;
  try { p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  if (!p || typeof p.u !== 'string' || typeof p.exp !== 'number' || p.exp < now) return null;
  const password = users(env)[p.u];
  if (!password || !safeEqual(p.pv, passwordMark(env.AUTH_SECRET, p.u, password))) return null;
  return { login: p.u, exp: p.exp };
}
function lowerHeaders(event) {
  const out = {};
  for (const [k, v] of Object.entries(event.headers || {})) out[k.toLowerCase()] = v;
  return out;
}
function readBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch { return null; }
}
function response(statusCode, body, cors) {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors }, body: JSON.stringify(body) };
}
function corsFor(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map((s) => s.trim()).filter(Boolean);
  const ok = !origin || allowed.includes(origin);
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token, X-Table-Name, X-Seed-Key',
    'Access-Control-Max-Age': '86400', Vary: 'Origin'
  };
  if (origin && ok) headers['Access-Control-Allow-Origin'] = origin;
  return { ok, headers };
}

function sqlString(value) {
  return `'${String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}'`;
}
function sqlNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error('Invalid numeric value');
  return String(n);
}
function toRow(row) {
  let data = row.data;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { data = null; } }
  return {
    id: Number(row.record_id), kind: String(row.kind || ''), key: String(row.record_key || ''),
    title: String(row.title || ''), date: String(row.date || ''), amount: Number(row.amount) || 0,
    category: String(row.category || ''), data, deleted: Number(row.deleted) || 0, updated: Number(row.updated) || 0
  };
}
function resultRows(result) {
  const first = result && (result.resultSets?.[0] ?? result[0] ?? result);
  const rows = Array.isArray(first) ? first : first && Array.isArray(first.rows) ? first.rows : [];
  return rows.map((r) => r && r.items ? Object.fromEntries(r.items.map((x) => [x.name, x.value])) : r);
}

async function withSession(fn) {
  await initDb();
  return driver.tableClient.withSession(fn);
}
async function initDb() {
  if (!readyPromise) {
    if (!process.env.YDB_ENDPOINT || !process.env.YDB_DATABASE) throw new Error('YDB_ENDPOINT or YDB_DATABASE missing');
    const { Driver, MetadataAuthService } = require('ydb-sdk');
    driver = new Driver({ endpoint: process.env.YDB_ENDPOINT, database: process.env.YDB_DATABASE, authService: new MetadataAuthService() });
    readyPromise = (async () => {
      if (!(await driver.ready(10000))) throw new Error('YDB driver did not become ready');
      await driver.tableClient.withSession((s) => s.executeSchemeQuery(`
        CREATE TABLE IF NOT EXISTS ${TABLE} (
          record_id Uint64 NOT NULL,
          kind Utf8 NOT NULL,
          record_key Utf8 NOT NULL,
          title Utf8 NOT NULL,
          date Utf8 NOT NULL,
          amount Double NOT NULL,
          category Utf8 NOT NULL,
          data Utf8 NOT NULL,
          deleted Uint64 NOT NULL,
          updated Uint64 NOT NULL,
          PRIMARY KEY (record_id)
        );
      `));
    })();
  }
  await readyPromise;
}
async function allRows() {
  return withSession(async (s) => {
    const result = await s.executeQuery(`SELECT record_id, kind, record_key, title, date, amount, category, data, deleted, updated FROM ${TABLE};`);
    return resultRows(result).map(toRow);
  });
}
async function upsert(r) {
  const q = `UPSERT INTO ${TABLE} (record_id, kind, record_key, title, date, amount, category, data, deleted, updated) VALUES (` +
    [sqlNumber(r.id), sqlString(r.kind), sqlString(r.key), sqlString(r.title), sqlString(r.date), String(Number(r.amount) || 0), sqlString(r.category), sqlString(JSON.stringify(r.data ?? null)), sqlNumber(r.deleted), sqlNumber(r.updated)].join(', ') + ');';
  return withSession((s) => s.executeQuery(q));
}
async function deleteById(id) {
  return withSession((s) => s.executeQuery(`DELETE FROM ${TABLE} WHERE record_id = ${sqlNumber(id)};`));
}
function newId(now) { return now * 1000 + crypto.randomInt(0, 1000); }
function validateRecord(r) {
  return r && typeof r === 'object' && /^[a-z0-9_]{1,32}$/.test(String(r.kind || '')) &&
    typeof r.key === 'string' && r.key.length > 0 && r.key.length <= 256;
}
async function runOp(op, now) {
  const method = String(op.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) return { status: 405, body: { error: 'method_not_allowed' } };
  const rows = await allRows();
  if (method === 'GET') {
    if (op.id) {
      const found = rows.find((r) => r.id === Number(op.id));
      return found ? { status: 200, body: { data: { record: found } } } : { status: 404, body: { error: 'not_found' } };
    }
    const query = op.query || {};
    let list = rows;
    const m = String(query.where || '').match(/^\(updated,gt,(\d+)\)$/);
    if (m) list = list.filter((r) => r.updated > Number(m[1]));
    list.sort((a, b) => a.id - b.id);
    let limit = parseInt(query.limit, 10);
    if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
    const offset = Math.max(0, parseInt(query.offset, 10) || 0);
    return { status: 200, body: { data: { records: list.slice(offset, offset + Math.min(limit, MAX_LIMIT)) } } };
  }
  if (method === 'POST') {
    if (!validateRecord(op.data)) return { status: 400, body: { error: 'bad_request', message: 'Некорректная запись' } };
    if (rows.some((r) => r.kind === op.data.kind && r.key === op.data.key && !r.deleted)) return { status: 409, body: { error: 'duplicate_key' } };
    const r = { id: newId(now), ...op.data, title: String(op.data.title || ''), date: String(op.data.date || ''), amount: Number(op.data.amount) || 0, category: String(op.data.category || ''), data: op.data.data ?? null, deleted: 0, updated: now };
    await upsert(r);
    return { status: 201, body: { data: { record: r } } };
  }
  const current = rows.find((r) => r.id === Number(op.id));
  if (!current) return { status: 404, body: { error: 'not_found' } };
  if (method === 'DELETE') {
    await deleteById(current.id);
    return { status: 200, body: { data: { record: current } } };
  }
  if (!op.data || typeof op.data !== 'object' || Array.isArray(op.data)) return { status: 400, body: { error: 'bad_request', message: 'Некорректные данные PATCH' } };
  const next = { ...current, ...op.data, id: current.id, updated: now };
  await upsert(next);
  return { status: 200, body: { data: { record: next } } };
}

function normalizeSeedItem(x, index, now) {
  if (!validateRecord(x)) throw new Error(`Invalid seed row ${index + 1}`);
  return {
    id: index + 1, kind: x.kind, key: x.key, title: String(x.title || ''), date: String(x.date || ''),
    amount: Number(x.amount) || 0, category: String(x.category || ''), data: x.data ?? null,
    deleted: Number(x.deleted) ? 1 : 0, updated: Number(x.updated) || now
  };
}
async function seed(records, env, headers, now) {
  if (!env.SEED_SECRET || !safeEqual(headers['x-seed-key'], env.SEED_SECRET)) return { statusCode: 403, body: { error: 'seed_forbidden' } };
  let stage = 'validate';
  try {
    if (!Array.isArray(records) || records.length < 1 || records.length > 500) return { statusCode: 400, body: { error: 'bad_seed', message: 'Ожидается массив до 500 записей' } };
    const normalized = records.map((r, i) => normalizeSeedItem(r, i, now));
    const keys = new Set();
    for (const r of normalized) {
      const k = `${r.kind}|${r.key}`;
      if (keys.has(k)) return { statusCode: 400, body: { error: 'duplicate_seed_key', key: k } };
      keys.add(k);
    }
    stage = 'connect';
    await initDb();
    stage = 'read';
    const existing = await driver.tableClient.withSession(async (s) => {
      const result = await s.executeQuery(`SELECT record_id FROM ${TABLE};`);
      return resultRows(result);
    });
    if (existing.length) return { statusCode: 409, body: { error: 'seed_target_not_empty', count: existing.length } };
    const values = normalized.map((r) => `(${[sqlNumber(r.id), sqlString(r.kind), sqlString(r.key), sqlString(r.title), sqlString(r.date), String(r.amount), sqlString(r.category), sqlString(JSON.stringify(r.data)), sqlNumber(r.deleted), sqlNumber(r.updated)].join(', ')})`).join(',\n');
    stage = 'write';
    await driver.tableClient.withSession((s) => s.executeQuery(`UPSERT INTO ${TABLE} (record_id, kind, record_key, title, date, amount, category, data, deleted, updated) VALUES ${values};`));
    const kinds = normalized.reduce((a, r) => (a[r.kind] = (a[r.kind] || 0) + 1, a), {});
    const tombstones = normalized.filter((r) => r.deleted).length;
    return { statusCode: 200, body: { ok: true, imported: normalized.length, active: normalized.length - tombstones, tombstones, kinds } };
  } catch (err) {
    console.error('YDB test seed failed:', stage, err && err.message);
    const detail = String((err && err.message) || err || 'unknown error')
      .replace(/(token|password|secret)\s*[:=]\s*\S+/gi, '$1=[redacted]')
      .slice(0, 240);
    return { statusCode: 500, body: { error: 'seed_failed', stage, detail } };
  }
}

function missingConfig(env) {
  const missing = [];
  if (!env.YDB_ENDPOINT) missing.push('YDB_ENDPOINT');
  if (!env.YDB_DATABASE) missing.push('YDB_DATABASE');
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < MIN_SECRET) missing.push('AUTH_SECRET');
  if (!Object.keys(users(env)).length) missing.push('AUTH_USER_1');
  return missing;
}
async function handle(event, env = process.env, now = Date.now()) {
  const headers = lowerHeaders(event);
  const { headers: cors, ok } = corsFor(headers.origin, env);
  const method = String(event.httpMethod || 'GET').toUpperCase();
  if (!ok) return response(403, { error: 'origin_not_allowed' }, cors);
  if (method === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  const missing = missingConfig(env);
  if (missing.length) return response(500, { error: 'not_configured', message: `Missing: ${missing.join(', ')}` }, cors);
  const q = event.queryStringParameters || {};
  const body = readBody(event);
  if (body === null) return response(400, { error: 'bad_json' }, cors);
  if (q.action === 'seed') {
    if (method !== 'POST') return response(405, { error: 'method_not_allowed' }, cors);
    const result = await seed(body.records, env, headers, now);
    return response(result.statusCode, result.body, cors);
  }
  if (q.action === 'login') {
    if (method !== 'POST') return response(405, { error: 'method_not_allowed' }, cors);
    const name = String(body.login || '').trim().toLowerCase();
    const pass = String(body.password || '');
    const expected = users(env)[name];
    const ip = (((event.requestContext || {}).identity || {}).sourceIp) || 'unknown';
    const failed = failures.get(ip);
    if (failed && failed.count >= 10 && now - failed.at < 15 * 60 * 1000) return response(429, { error: 'too_many_attempts', message: 'Слишком много попыток. Повторите позже.' }, cors);
    const valid = safeEqual(pass, expected || `no-user:${name}`) && Boolean(expected);
    if (!valid) {
      if (!failed || now - failed.at > 15 * 60 * 1000) failures.set(ip, { count: 1, at: now });
      else failed.count++;
      await new Promise((r) => setTimeout(r, 700));
      return response(401, { error: 'bad_credentials', message: 'Неверный логин или пароль' }, cors);
    }
    failures.delete(ip);
    return response(200, { token: issueToken(env, name, expected, now), login: name, exp: now + TOKEN_TTL_MS, now }, cors);
  }
  const who = checkToken(env, headers['x-auth-token'], now);
  if (!who) return response(401, { error: 'unauthorized', message: 'Нужен вход' }, cors);
  try {
    if (q.action === 'ping') return response(200, { ok: true, login: who.login, exp: who.exp, now }, cors);
    if (q.action === 'batch') {
      if (method !== 'POST' || !Array.isArray(body.ops) || body.ops.length < 1 || body.ops.length > MAX_BATCH) return response(400, { error: 'bad_request' }, cors);
      const results = [];
      for (const op of body.ops) {
        if (op.table && op.table !== TABLE) { results.push({ status: 400, body: { error: 'unknown_table' } }); break; }
        const r = await runOp(op, now);
        results.push(r);
        if (r.status >= 400) break;
      }
      return response(200, { now, done: results.length, total: body.ops.length, results }, cors);
    }
    if (headers['x-table-name'] && headers['x-table-name'] !== TABLE) return response(400, { error: 'unknown_table' }, cors);
    const op = { method, id: q.id, query: q, data: body.data };
    const r = await runOp(op, now);
    return response(r.status, { ...r.body, now }, cors);
  } catch (err) {
    console.error('YDB test proxy error:', err && err.message);
    return response(500, { error: 'database_error', message: 'Ошибка тестовой базы YDB' }, cors);
  }
}

module.exports.handler = async (event) => {
  try { return await handle(event || {}); }
  catch (err) {
    console.error('YDB test proxy error:', err && err.message);
    return response(500, { error: 'internal', message: 'Внутренняя ошибка прокси' }, {});
  }
};
module.exports.handle = handle;
module.exports._test = { checkToken, issueToken, normalizeSeedItem, resultRows, sqlString };
