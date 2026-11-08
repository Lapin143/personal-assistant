// Общая логика «Ассистента». Без DOM: используется и в браузере, и в скрипте уведомлений.

export const iso = (d) => {
  const z = new Date(d);
  return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')}`;
};
export const todayIso = () => iso(new Date());
export const addDays = (s, n) => {
  const d = new Date(s + 'T00:00');
  d.setDate(d.getDate() + n);
  return iso(d);
};
export const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00') - new Date(a + 'T00:00')) / 86400000);

// Ближайшая дата с нужным числом месяца, не раньше from
export function nextDayOfMonth(day, from) {
  const f = new Date(from + 'T00:00');
  let y = f.getFullYear();
  let m = f.getMonth();
  const dim = (yy, mm) => new Date(yy, mm + 1, 0).getDate();
  let cand = new Date(y, m, Math.min(day, dim(y, m)));
  if (iso(cand) < from) {
    m += 1;
    if (m > 11) { m = 0; y += 1; }
    cand = new Date(y, m, Math.min(day, dim(y, m)));
  }
  return iso(cand);
}

// Все события и платежи на окно days дней вперёд (включая просроченные задачи «по дому»)
export function upcoming(data, today, days = 30) {
  const end = addDays(today, days);
  const out = [];
  const push = (date, title, kind, extra = {}) => {
    if (date && date >= today && date <= end) out.push({ date, title, kind, ...extra });
  };

  for (const r of data.reminders || []) {
    if (r.repeat === 'none') push(r.date, r.title, 'event', { personId: r.personId });
    else if (r.repeat === 'month') push(nextDayOfMonth(Number(r.date.slice(8, 10)), today), r.title, 'event', { personId: r.personId });
    else if (r.repeat === 'year') {
      let cand = `${today.slice(0, 4)}-${r.date.slice(5)}`;
      if (cand < today) cand = `${Number(today.slice(0, 4)) + 1}-${r.date.slice(5)}`;
      push(cand, r.title, 'event', { personId: r.personId });
    }
  }
  for (const p of (data.recurring || []).filter((x) => x.active)) {
    push(nextDayOfMonth(p.day, today), `Платёж: ${p.title}`, 'payment', { amount: p.amount, personId: p.personId });
  }
  for (const d of (data.debts || []).filter((x) => x.remaining > 0)) {
    push(nextDayOfMonth(d.dueDay, today), `Кредит: ${d.title}`, 'payment', { amount: d.monthly });
  }
  for (const d of data.documents || []) {
    push(d.expires, `Истекает: ${d.title}`, 'docs', { personId: d.personId });
  }
  for (const c of data.cars || []) {
    push(c.insuranceUntil, `Страховка: ${c.make} ${c.model}`, 'car');
    push(c.inspectionUntil, `Техосмотр: ${c.make} ${c.model}`, 'car');
  }
  for (const t of data.homeTasks || []) {
    const due = addDays(t.lastDone || today, t.everyDays);
    const overdue = due < today;
    out.push({ date: overdue ? today : due, title: `Дом: ${t.title}`, kind: 'home', overdue, personId: t.assignee });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// Итоги месяца; личные операции других людей не показываются
export function monthSummary(data, ym, me) {
  const tx = (data.transactions || []).filter((t) => t.date.startsWith(ym) && (!t.private || t.personId === me));
  const res = { income: 0, expense: 0, byCategory: {} };
  for (const t of tx) {
    const amt = Number(t.amount) || 0;
    if (t.type === 'income') res.income += amt;
    else {
      res.expense += amt;
      res.byCategory[t.category] = (res.byCategory[t.category] || 0) + amt;
    }
  }
  return res;
}

// Расход топлива л/100 км по заправкам: литры / пробег с прошлой заправки
export function fuelStats(carExpenses, carId) {
  const fills = (carExpenses || [])
    .filter((e) => e.carId === carId && e.type === 'fuel' && e.mileage && e.liters)
    .sort((a, b) => a.mileage - b.mileage);
  const rates = [];
  for (let i = 1; i < fills.length; i++) {
    const km = fills[i].mileage - fills[i - 1].mileage;
    if (km > 0) rates.push((fills[i].liters / km) * 100);
  }
  const avg = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
  return { avg, samples: rates.length };
}

// Сколько месяцев нужно, чтобы погасить долг
export function debtMonths(remaining, monthly) {
  if (!monthly || monthly <= 0) return null;
  return Math.ceil(remaining / monthly);
}

export function goalPct(g) {
  return g.target ? Math.min(100, Math.round(((g.saved || 0) / g.target) * 100)) : 0;
}
