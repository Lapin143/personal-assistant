// Связь с сервером: вход и запросы к функции-прокси в Yandex Cloud.
// Браузер не обращается к Tabrica напрямую и не знает её токена.
import { API } from './config.js?v=c1';

const SESSION_KEY = 'as.session';
const COUNT_KEY = 'as.requests';
export const MONTH_LIMIT = 3000;   // бесплатный лимит Tabrica на организацию
export const DEVICE_SOFT = 1200;   // после этого числа запросов устройство синхронизируется реже

export const authEnabled = () => Boolean(API.url);

export function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch { return null; }
}
export const signOutLocal = () => localStorage.removeItem(SESSION_KEY);

// Пропуск выдаёт функция при входе; он хранится на устройстве до истечения срока или смены пароля.
export function validToken() {
  const s = getSession();
  return s && s.token && s.exp > Date.now() ? s.token : null;
}

let onAuthLost = () => {};
export const setAuthLostHandler = (fn) => { onAuthLost = fn; };

// Счётчик запросов к базе с этого устройства за календарный месяц.
export function requestCount() {
  const ym = new Date().toISOString().slice(0, 7);
  try {
    const c = JSON.parse(localStorage.getItem(COUNT_KEY));
    if (c && c.ym === ym) return c.n || 0;
  } catch { /* счётчик начнётся заново */ }
  return 0;
}
function addRequests(n) {
  if (!n) return;
  const ym = new Date().toISOString().slice(0, 7);
  localStorage.setItem(COUNT_KEY, JSON.stringify({ ym, n: requestCount() + n }));
}
export const economyMode = () => requestCount() >= DEVICE_SOFT;

async function raw(method, query, body, { auth = true, timeout = 20000, keepalive = false } = {}) {
  const headers = { 'X-Table-Name': API.table };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = validToken();
    if (!token) { const e = new Error('Нужен вход'); e.auth = true; throw e; }
    headers['X-Auth-Token'] = token;
  }
  const qs = new URLSearchParams(Object.entries(query || {}).filter(([, v]) => v !== undefined && v !== '')).toString();
  const res = await fetch(`${API.url}${qs ? '?' + qs : ''}`, {
    method, headers, cache: 'no-store', keepalive,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: keepalive ? undefined : AbortSignal.timeout(timeout)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(json.message || json.error || `Ошибка сервера ${res.status}`);
    e.status = res.status;
    e.code = json.error || '';
    if (res.status === 401 && auth) { e.auth = true; signOutLocal(); onAuthLost(); }
    throw e;
  }
  return json;
}

export async function signIn(login, password) {
  const j = await raw('POST', { action: 'login' }, { login, password }, { auth: false });
  localStorage.setItem(SESSION_KEY, JSON.stringify({ token: j.token, login: j.login, exp: j.exp }));
}

export const api = {
  // Один запрос к Tabrica: страница записей (все или изменённые после указанного времени).
  async list({ where, limit, offset }) {
    const j = await raw('GET', { where, limit, offset: offset || undefined });
    addRequests(1);
    return { records: (j.data && j.data.records) || [], now: j.now };
  },
  // Несколько изменений одним вызовом функции; каждая операция — один запрос к Tabrica.
  async batch(ops, { keepalive = false } = {}) {
    const j = await raw('POST', { action: 'batch' }, { ops }, { timeout: 60000, keepalive });
    addRequests(j.done || 0);
    return { results: j.results || [], now: j.now };
  }
};
