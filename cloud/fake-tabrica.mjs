// Имитация Tabrica для тестов и локального запуска: хранит строки в памяти и понимает нужную часть Public API.
import assert from 'node:assert/strict';

// ---------- имитация Tabrica ----------
export function makeTabrica({ jsonAsString = false, rejectObjects = false, rowLimit = 1000, maxJson = 0, nested = false, throttleEvery = 0 } = {}) {
  const rows = new Map();
  let nextId = 1;
  const t = { rows, requests: 0, log: [], rowLimit, badToken: false };
  const flat = (r) => ({ ...r, data: jsonAsString && r.data !== undefined && r.data !== null ? JSON.stringify(r.data) : r.data });
  const out = (r) => { if (!nested) return flat(r); const { id, ...fields } = flat(r); return { id, fields }; };
  // Настоящая Табрика отклоняет строку длиннее 50 000 символов внутри JSON (public_invalid_data).
  const longString = (v) => (typeof v === 'string' ? v.length > 50000 : v && typeof v === 'object' ? Object.values(v).some(longString) : false);
  const tooBig = (body) => longString(body.data.data) || (maxJson && body.data.data !== undefined && JSON.stringify(body.data.data).length > maxJson);
  const cond = (expr) => {
    const m = /^\((\w+),(eq|gt|ge),(.*)\)$/.exec(expr);
    if (!m) throw new Error('where: ' + expr);
    const [, f, op, v] = m;
    return (r) => (op === 'eq' ? String(r[f]) === v : op === 'gt' ? Number(r[f]) > Number(v) : Number(r[f]) >= Number(v));
  };
  const store = (data) => {
    const d = { ...data };
    if (typeof d.data === 'string') { try { d.data = JSON.parse(d.data); } catch { /* как есть */ } }
    return d;
  };
  t.fetch = async (url, init) => {
    t.calls = (t.calls || 0) + 1;
    if (throttleEvery && t.calls % throttleEvery === 0) return { status: 429, text: async () => '{"error":"rate_limited"}' };
    t.requests++;
    const u = new URL(url);
    const m = /\/databases\/(\d+)\/tables\/(\d+)\/records(?:\/(\d+))?$/.exec(u.pathname);
    const res = (status, body) => ({ status, text: async () => JSON.stringify(body) });
    t.log.push(`${init.method} ${m && m[3] ? m[3] : ''}`.trim());
    if (t.badToken || init.headers.Authorization !== 'Bearer tab_secret') return res(401, { message: 'unauthorized' });
    if (!m || m[1] !== '349' || m[2] !== '513') return res(404, { message: 'not found' });
    const id = m[3] ? Number(m[3]) : null;
    if (init.method === 'GET') {
      let list = [...rows.values()];
      const where = u.searchParams.get('where');
      if (where) for (const c of where.split('~and')) list = list.filter(cond(c));
      const limit = Number(u.searchParams.get('limit'));
      const offset = Number(u.searchParams.get('offset') || 0);
      assert.equal(u.searchParams.get('response_format'), 'names');
      return res(200, { message: 'success', data: { records: list.slice(offset, offset + limit).map(out), total: list.length, limit, offset } });
    }
    if (init.method === 'POST') {
      if (rows.size >= t.rowLimit) return res(400, { error: 'row_limit_exceeded', message: 'row limit' });
      const body = JSON.parse(init.body);
      if (rejectObjects && body.data.data !== null && typeof body.data.data === 'object') return res(422, { error: 'validation_error' });
      if (tooBig(body)) return res(400, { error: 'public_invalid_data', message: 'value too long' });
      const row = { id: nextId++, ...store(body.data) };
      rows.set(row.id, row);
      return res(201, { message: 'success', data: { id: row.id, data: out(row) } });
    }
    if (!rows.has(id)) return res(404, { message: 'record not found' });
    if (init.method === 'PATCH') {
      const body = JSON.parse(init.body);
      if (rejectObjects && body.data.data !== null && typeof body.data.data === 'object') return res(422, { error: 'validation_error' });
      if (tooBig(body)) return res(400, { error: 'public_invalid_data', message: 'value too long' });
      Object.assign(rows.get(id), store(body.data));
      return res(200, { message: 'success', data: { record: out(rows.get(id)) } });
    }
    rows.delete(id);
    return res(200, { message: 'success', data: { deleted: true } });
  };
  return t;
}

