// Связь с сервером: вход и запросы к функции-прокси в Yandex Cloud.
// Браузер не обращается к Tabrica напрямую и не знает её токена.
import { API } from './config.js?v=c2';

const SESSION_KEY = 'as.session';
const COUNT_KEY = 'as.requests';
const TARGET_KEY = 'as.storageTarget';
export const MONTH_LIMIT = 1000;   // месячный лимит этой организации по настройкам пользователя
export const DEVICE_SOFT = 400;    // бережный режим, чтобы оставить запас общему лимиту на втором устройстве

export const authEnabled = () => Boolean(API.url);
export const backupEnabled = () => Boolean(API.backupUrl);
export function storageTarget() {
  return localStorage.getItem(TARGET_KEY) === 'backup' && backupEnabled() ? 'backup' : 'primary';
}
export function setStorageTarget(target) {
  localStorage.setItem(TARGET_KEY, target === 'backup' && backupEnabled() ? 'backup' : 'primary');
}
export const storageLabel = (target = storageTarget()) => target === 'backup' ? 'резервная база' : 'основная база';
const urlFor = (target) => target === 'backup' ? API.backupUrl : API.url;
const sessionKey = (target) => target === 'backup' ? `${SESSION_KEY}.backup` : SESSION_KEY;
const countKey = (target) => target === 'backup' ? `${COUNT_KEY}.backup` : COUNT_KEY;

export function getSession(target = 'primary') {
  try { return JSON.parse(localStorage.getItem(sessionKey(target))) || null; } catch { return null; }
}
export const signOutLocal = () => { localStorage.removeItem(SESSION_KEY); localStorage.removeItem(`${SESSION_KEY}.backup`); };

// Пропуск выдаёт функция при входе; он хранится на устройстве до истечения срока или смены пароля.
export function validToken(target = 'primary') {
  const s = getSession(target);
  return s && s.token && s.exp > Date.now() ? s.token : null;
}

let onAuthLost = () => {};
export const setAuthLostHandler = (fn) => { onAuthLost = fn; };

// Счётчик запросов к базе с этого устройства за календарный месяц.
export function requestCount(target = storageTarget()) {
  const ym = new Date().toISOString().slice(0, 7);
  try {
    const c = JSON.parse(localStorage.getItem(countKey(target)));
    if (c && c.ym === ym) return c.n || 0;
  } catch { /* счётчик начнётся заново */ }
  return 0;
}
function addRequests(n, target) {
  if (!n) return;
  const ym = new Date().toISOString().slice(0, 7);
  localStorage.setItem(countKey(target), JSON.stringify({ ym, n: requestCount(target) + n }));
}
export const economyMode = (target = storageTarget()) => requestCount(target) >= DEVICE_SOFT;

async function raw(method, query, body, { target = 'primary', auth = true, timeout = 20000, keepalive = false } = {}) {
  const url = urlFor(target);
  if (!url) throw new Error('Адрес резервной базы не настроен');
  const headers = { 'X-Table-Name': API.table };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = validToken(target);
    if (!token) { const e = new Error('Нужен вход'); e.auth = true; throw e; }
    headers['X-Auth-Token'] = token;
  }
  const qs = new URLSearchParams(Object.entries(query || {}).filter(([, v]) => v !== undefined && v !== '')).toString();
  const res = await fetch(`${url}${qs ? '?' + qs : ''}`, {
    method, headers, cache: 'no-store', keepalive,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: keepalive ? undefined : AbortSignal.timeout(timeout)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(json.message || json.error || `Ошибка сервера ${res.status}`);
    e.status = res.status;
    e.code = json.error || '';
    if (res.status === 401 && auth) {
      e.auth = true;
      localStorage.removeItem(sessionKey(target));
      if (target === 'primary') onAuthLost();
    }
    throw e;
  }
  return json;
}

export async function signInTarget(target, login, password) {
  const j = await raw('POST', { action: 'login' }, { login, password }, { target, auth: false });
  localStorage.setItem(sessionKey(target), JSON.stringify({ token: j.token, login: j.login, exp: j.exp }));
  return j;
}
export async function signIn(login, password) {
  return signInTarget('primary', login, password);
}

export const api = {
  // Один запрос к Tabrica: страница записей (все или изменённые после указанного времени).
  async list({ where, limit, offset, target = 'primary' }) {
    const j = await raw('GET', { where, limit, offset: offset || undefined }, undefined, { target });
    addRequests(1, target);
    return { records: (j.data && j.data.records) || [], now: j.now };
  },
  // Несколько изменений одним вызовом функции; каждая операция — один запрос к Tabrica.
  async batch(ops, { keepalive = false, target = 'primary' } = {}) {
    const j = await raw('POST', { action: 'batch' }, { ops }, { target, timeout: 60000, keepalive });
    addRequests(j.done || 0, target);
    return { results: j.results || [], now: j.now };
  },
  forTarget(target) {
    return {
      list: (query) => api.list({ ...query, target }),
      batch: (ops, opts = {}) => api.batch(ops, { ...opts, target })
    };
  }
};
