// Ежедневная рассылка напоминаний в Telegram.
// Запускается GitHub Actions (см. .github/workflows/notify.yml).
// Читает data.json из корня репозитория — поэтому данные нужно выгружать
// из приложения (Люди → Данные → Экспорт) и класть в data.json.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { upcoming, todayIso } from '../core.js';

const fmtDate = (s) => {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${d}.${m}.${y}`;
};

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

if (!token || !chatId) {
  console.error('Нужны переменные TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID');
  process.exit(1);
}

const dataPath = fileURLToPath(new URL('../data.json', import.meta.url));
const data = JSON.parse(await readFile(dataPath, 'utf8'));
const days = Number(data.settings?.notifyDaysAhead ?? 3);
const today = todayIso();
const items = upcoming(data, today, days);

if (!items.length) {
  console.log('Ближайших событий нет, сообщение не отправляем.');
  process.exit(0);
}

const lines = items.map((it) => {
  const who = it.personId ? (data.people.find((p) => p.id === it.personId)?.name ?? '') : '';
  const sum = it.amount ? ` · ${Math.round(it.amount)} ${data.settings?.currency ?? ''}` : '';
  const flag = it.overdue ? ' (просрочено)' : '';
  return `• ${fmtDate(it.date)} — ${it.title}${sum}${who ? ` · ${who}` : ''}${flag}`;
});

const text = `Ассистент: ближайшие события (до ${days} дн.)\n\n${lines.join('\n')}`;

const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chat_id: chatId, text })
});

if (!res.ok) {
  console.error('Telegram ответил ошибкой:', res.status, await res.text());
  process.exit(1);
}
console.log(`Отправлено событий: ${items.length}`);
