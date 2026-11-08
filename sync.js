// Синхронизация семейных данных через Supabase (таблица family_data, одна строка id='family').
// Стратегия: побеждает более новая версия (updated_at). Без настройки config.js модуль молчит.
import { SUPABASE } from './config.js';

const ROW_ID = 'family';
const enabled = () => Boolean(SUPABASE.url && SUPABASE.key);
const headers = () => ({ apikey: SUPABASE.key, Authorization: `Bearer ${SUPABASE.key}`, 'Content-Type': 'application/json' });

export function syncEnabled() { return enabled(); }

export async function pullRemote() {
  if (!enabled()) return null;
  const res = await fetch(`${SUPABASE.url}/rest/v1/family_data?id=eq.${ROW_ID}&select=payload,updated_at`,
    { headers: headers(), cache: 'no-store' });
  if (!res.ok) throw new Error(`sync pull ${res.status}`);
  const rows = await res.json();
  return rows[0] || null;
}

let timer = null;
let pending = null;

// Откладываем отправку, чтобы не слать запрос на каждое нажатие.
export function queuePush(data) {
  if (!enabled()) return;
  pending = data;
  clearTimeout(timer);
  timer = setTimeout(pushNow, 800);
}

async function pushNow() {
  const data = pending;
  pending = null;
  if (!data) return;
  const res = await fetch(`${SUPABASE.url}/rest/v1/family_data`, {
    method: 'POST',
    headers: { ...headers(), Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{ id: ROW_ID, payload: data, updated_at: data.updatedAt || Date.now() }])
  });
  if (!res.ok) console.warn('sync push', res.status);
}
