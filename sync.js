// Вход и синхронизация через Supabase.
// Вход — email и пароль. Регистрация закрыта: аккаунты создаёт владелец проекта.
// Сессия хранится на устройстве, токен продлевается автоматически.
import { SUPABASE } from './config.js';

const ROW_ID = 'family';
const SESSION_KEY = 'as.session';

export const authEnabled = () => Boolean(SUPABASE.url && SUPABASE.key);

export function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch { return null; }
}
const saveSession = (s) => localStorage.setItem(SESSION_KEY, JSON.stringify(s));
export const signOutLocal = () => localStorage.removeItem(SESSION_KEY);

async function authRequest(path, body) {
  const res = await fetch(`${SUPABASE.url}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: SUPABASE.key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error_description || j.msg || j.error || 'Не удалось войти');
  return j;
}

const toSession = (j) => ({
  access_token: j.access_token,
  refresh_token: j.refresh_token,
  expires_at: Date.now() + (j.expires_in || 3600) * 1000 - 60000,
  email: (j.user && j.user.email) || ''
});

export async function signIn(email, password) {
  saveSession(toSession(await authRequest('token?grant_type=password', { email, password })));
}

// Действующий токен или null (тогда нужен вход).
// Без сети продлить нельзя: используем текущий токен, пока он не истёк по времени.
export async function validToken() {
  const s = getSession();
  if (!s || !s.access_token) return null;
  if (Date.now() < s.expires_at) return s.access_token;
  try {
    saveSession(toSession(await authRequest('token?grant_type=refresh_token', { refresh_token: s.refresh_token })));
    return getSession().access_token;
  } catch (err) {
    if (err instanceof TypeError) return s.access_token; // нет сети
    signOutLocal();
    return null;
  }
}

const headers = (token) => ({ apikey: SUPABASE.key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

export async function pullRemote() {
  if (!authEnabled()) return null;
  const token = await validToken();
  if (!token) throw new Error('нет входа');
  const res = await fetch(`${SUPABASE.url}/rest/v1/family_data?id=eq.${ROW_ID}&select=payload,updated_at`,
    { headers: headers(token), cache: 'no-store' });
  if (!res.ok) throw new Error(`sync pull ${res.status}`);
  return (await res.json())[0] || null;
}

let timer = null;
let pending = null;

// Откладываем отправку, чтобы не слать запрос на каждое нажатие.
export function queuePush(data) {
  if (!authEnabled()) return;
  pending = data;
  clearTimeout(timer);
  timer = setTimeout(pushNow, 800);
}

async function pushNow() {
  const data = pending;
  pending = null;
  if (!data) return;
  const token = await validToken();
  if (!token) return;
  const res = await fetch(`${SUPABASE.url}/rest/v1/family_data`, {
    method: 'POST',
    headers: { ...headers(token), Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{ id: ROW_ID, payload: data, updated_at: data.updatedAt || Date.now() }])
  });
  if (!res.ok) console.warn('sync push', res.status);
}
