// Прокси между приложением «Ассистент» и Tabrica. Yandex Cloud Function, Node.js 22.
// Точка входа: index.handler
//
// Секреты живут только в переменных окружения функции:
//   TABRICA_TOKEN            токен Tabrica (чтение и запись)
//   TABRICA_DB_ID            ID базы
//   TABRICA_TABLE_ID_<ИМЯ>   ID таблицы; имя приходит в заголовке X-Table-Name
//   AUTH_SECRET              случайная строка от 32 символов: ею подписываются пропуска
//   AUTH_USER_1, AUTH_USER_2 …  участники в виде «логин:пароль»
//   ALLOWED_ORIGINS          адреса сайта через запятую (по умолчанию GitHub Pages проекта)
'use strict';

const crypto = require('crypto');

const API = 'https://api.tabrica.ru/public/v1';
const DEFAULT_ORIGINS = 'https://lapin143.github.io';
const TOKEN_TTL_MS = 90 * 24 * 3600 * 1000; // пропуск действует 90 дней
const MIN_SECRET = 32;
const MIN_PASSWORD = 8;
const TABRICA_TIMEOUT_MS = 8000;
const MAX_BATCH = 100;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const STAMP_FIELD = 'updated'; // время изменения ставит сервер: часы устройств могут расходиться
const PASS_PARAMS = ['offset', 'where', 'sort', 'fields'];

// ---------- общие помощники ----------

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const hmac = (secret, text) => crypto.createHmac('sha256', secret).update(text).digest();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
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

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map((s) => s.trim()).filter(Boolean);
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token, X-Table-Name',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
  const ok = !origin || allowed.includes(origin);
  if (origin && ok) h['Access-Control-Allow-Origin'] = origin;
  return { headers: h, ok };
}

const reply = (statusCode, body, cors) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors },
  body: JSON.stringify(body)
});

// ---------- вход и пропуска ----------

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

// Отпечаток пароля входит в пропуск: смена пароля отзывает пропуска этого участника.
const passwordMark = (secret, login, password) => b64u(hmac(secret, `pw:${login}:${password}`)).slice(0, 16);

function issueToken(env, login, password, now) {
  const payload = b64u(JSON.stringify({ u: login, exp: now + TOKEN_TTL_MS, pv: passwordMark(env.AUTH_SECRET, login, password) }));
  return `${payload}.${b64u(hmac(env.AUTH_SECRET, payload))}`;
}

function checkToken(env, token, now) {
  if (typeof token !== 'string' || token.length > 600) return null;
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  if (!safeEqual(sig, b64u(hmac(env.AUTH_SECRET, payload)))) return null;
  let p;
  try { p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  if (!p || typeof p.u !== 'string' || typeof p.exp !== 'number' || p.exp < now) return null;
  const password = users(env)[p.u];
  if (!password || !safeEqual(p.pv, passwordMark(env.AUTH_SECRET, p.u, password))) return null;
  return { login: p.u, exp: p.exp };
}

// Простая защита от перебора в пределах одного экземпляра функции.
const failures = new Map();
function tooManyFailures(ip, now) {
  const f = failures.get(ip);
  return Boolean(f && f.count >= 10 && now - f.at < 15 * 60 * 1000);
}
function noteFailure(ip, now) {
  const f = failures.get(ip);
  if (!f || now - f.at > 15 * 60 * 1000) failures.set(ip, { count: 1, at: now });
  else f.count += 1;
  if (failures.size > 1000) failures.clear();
}

async function login(env, body, ip, now) {
  if (tooManyFailures(ip, now)) return { status: 429, body: { error: 'too_many_attempts', message: 'Слишком много попыток. Повторите через 15 минут.' } };
  const name = String((body && body.login) || '').trim().toLowerCase();
  const password = String((body && body.password) || '');
  const expected = users(env)[name];
  // Сравниваем всегда, чтобы время ответа не выдавало, существует ли логин.
  const good = safeEqual(password, expected || `no-user:${name}`) && Boolean(expected);
  if (!good) {
    noteFailure(ip, now);
    await sleep(700);
    return { status: 401, body: { error: 'bad_credentials', message: 'Неверный логин или пароль' } };
  }
  failures.delete(ip);
  return { status: 200, body: { token: issueToken(env, name, expected, now), login: name, exp: now + TOKEN_TTL_MS, now } };
}

// ---------- запросы к Tabrica ----------

function tableUrl(env, table, id) {
  if (!/^[a-z0-9_]{1,32}$/.test(table || '')) return { error: 'Не указана таблица (X-Table-Name)' };
  const tableId = env[`TABRICA_TABLE_ID_${table.toUpperCase()}`];
  if (!tableId) return { error: `Таблица «${table}» не настроена` };
  let url = `${API}/databases/${encodeURIComponent(env.TABRICA_DB_ID)}/tables/${encodeURIComponent(tableId)}/records`;
  if (id !== undefined && id !== null && id !== '') {
    if (!/^\d{1,12}$/.test(String(id))) return { error: 'Некорректный id записи' };
    url += `/${id}`;
  }
  return { url };
}

function listQuery(q) {
  const p = new URLSearchParams();
  let limit = parseInt(q.limit, 10);
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
  p.set('limit', String(Math.min(limit, MAX_LIMIT)));
  for (const k of PASS_PARAMS) if (q[k] !== undefined && q[k] !== '') p.set(k, String(q[k]));
  p.set('response_format', 'names');
  return p;
}

const stamped = (data, now) => ({ ...(data && typeof data === 'object' ? data : {}), [STAMP_FIELD]: now });

// Одна операция: { method, table, id?, query?, data? } → { status, body }
async function tabrica(env, op, now, fetchImpl) {
  const method = String(op.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) return { status: 405, body: { error: 'method_not_allowed' } };
  if ((method === 'PATCH' || method === 'DELETE') && !op.id) return { status: 400, body: { error: 'bad_request', message: 'Нужен id записи' } };
  if (method === 'POST' && op.id) return { status: 400, body: { error: 'bad_request', message: 'При создании id не указывается' } };

  const t = tableUrl(env, op.table, op.id);
  if (t.error) return { status: 400, body: { error: 'bad_request', message: t.error } };

  let url = t.url;
  const init = { method, headers: { Authorization: `Bearer ${env.TABRICA_TOKEN}` } };
  if (method === 'GET') {
    url += op.id ? '?response_format=names' : `?${listQuery(op.query || {})}`;
  } else if (method === 'POST' || method === 'PATCH') {
    if (!op.data || typeof op.data !== 'object' || Array.isArray(op.data)) return { status: 400, body: { error: 'bad_request', message: 'Нужно тело вида {"data": {...}}' } };
    if (method === 'PATCH') url += '?response_format=names';
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify({ data: stamped(op.data, now) });
  }

  let res;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TABRICA_TIMEOUT_MS) });
  } catch (err) {
    return { status: 504, body: { error: 'upstream_unreachable', message: 'Tabrica не отвечает' } };
  }
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { message: text.slice(0, 300) }; }
  // 401 от Tabrica — это проблема токена в настройках функции, а не входа участника: приложение не должно разлогиниваться.
  if (res.status === 401 || res.status === 403) return { status: 502, body: { error: 'upstream_auth', message: 'Tabrica не приняла токен или не даёт доступа: проверьте TABRICA_TOKEN и ID базы и таблицы', upstream: res.status } };
  return { status: res.status, body: json };
}

// ---------- обработчик ----------

function missingConfig(env) {
  const miss = [];
  if (!env.TABRICA_TOKEN) miss.push('TABRICA_TOKEN');
  if (!env.TABRICA_DB_ID) miss.push('TABRICA_DB_ID');
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < MIN_SECRET) miss.push(`AUTH_SECRET (от ${MIN_SECRET} символов)`);
  if (!Object.keys(users(env)).length) miss.push(`AUTH_USER_1 (логин:пароль, пароль от ${MIN_PASSWORD} символов)`);
  return miss;
}

async function handle(event, env = process.env, fetchImpl = fetch, now = Date.now()) {
  const headers = lowerHeaders(event);
  const { headers: cors, ok: originOk } = corsHeaders(headers.origin, env);
  const method = String(event.httpMethod || 'GET').toUpperCase();

  if (!originOk) return reply(403, { error: 'origin_not_allowed' }, cors);
  if (method === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };

  const miss = missingConfig(env);
  if (miss.length) return reply(500, { error: 'not_configured', message: `Не заданы переменные окружения: ${miss.join(', ')}` }, cors);

  const q = event.queryStringParameters || {};
  const body = readBody(event);
  if (body === null) return reply(400, { error: 'bad_json', message: 'Тело запроса не является JSON' }, cors);
  const ip = (((event.requestContext || {}).identity || {}).sourceIp) || 'unknown';

  if (q.action === 'login') {
    if (method !== 'POST') return reply(405, { error: 'method_not_allowed' }, cors);
    const r = await login(env, body, ip, now);
    return reply(r.status, r.body, cors);
  }

  const who = checkToken(env, headers['x-auth-token'], now);
  if (!who) return reply(401, { error: 'unauthorized', message: 'Нужен вход' }, cors);

  if (q.action === 'ping') return reply(200, { ok: true, login: who.login, exp: who.exp, now }, cors);

  // Несколько операций одним вызовом функции. Выполняются по очереди; после ошибки остальные не запускаются.
  if (q.action === 'batch') {
    if (method !== 'POST') return reply(405, { error: 'method_not_allowed' }, cors);
    const ops = Array.isArray(body.ops) ? body.ops : null;
    if (!ops || !ops.length || ops.length > MAX_BATCH) return reply(400, { error: 'bad_request', message: `Нужен массив ops (1–${MAX_BATCH})` }, cors);
    const results = [];
    for (const op of ops) {
      const r = await tabrica(env, { ...op, table: op.table || headers['x-table-name'] }, now, fetchImpl);
      results.push(r);
      if (r.status >= 400) break;
    }
    return reply(200, { now, done: results.length, total: ops.length, results }, cors);
  }

  const r = await tabrica(env, {
    method, table: headers['x-table-name'] || q.table, id: q.id, query: q, data: body.data
  }, now, fetchImpl);
  return reply(r.status, r.body && typeof r.body === 'object' && !Array.isArray(r.body) ? { ...r.body, now } : { data: r.body, now }, cors);
}

module.exports.handler = async (event) => {
  try {
    return await handle(event || {});
  } catch (err) {
    console.error('proxy error:', err && err.message);
    return reply(500, { error: 'internal', message: 'Внутренняя ошибка прокси' }, {});
  }
};
module.exports.handle = handle;
