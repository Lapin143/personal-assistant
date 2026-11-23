import assert from 'node:assert/strict';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

globalThis.localStorage = new MemoryStorage();
const calls = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(input);
  calls.push({ url: url.href, token: init.headers['X-Auth-Token'] || '' });
  if (url.searchParams.get('action') === 'login') {
    const backup = url.pathname.includes('d4eunltrtigqq970l3f8');
    return { ok: true, status: 200, json: async () => ({ token: backup ? 'backup-token' : 'primary-token', login: 'lapin', exp: Date.now() + 60_000 }) };
  }
  return { ok: true, status: 200, json: async () => ({ data: { records: [{ id: 1 }] }, now: Date.now() }) };
};

const apiModule = await import('./api.js?test=storage-targets');
const { api, signIn, signInTarget, validToken, requestCount, setStorageTarget, storageTarget, signOutLocal } = apiModule;

await signIn('lapin', 'test');
await signInTarget('backup', 'lapin', 'test');
assert.equal(validToken('primary'), 'primary-token');
assert.equal(validToken('backup'), 'backup-token');

await api.forTarget('primary').list({ limit: 1000 });
await api.forTarget('backup').list({ limit: 1000 });
assert.equal(requestCount('primary'), 1);
assert.equal(requestCount('backup'), 1);
  assert.ok(calls.some((c) => c.url.includes('d4e4m399l6s8fn9mdfbk') && c.token === 'primary-token'));
  assert.ok(calls.some((c) => c.url.includes('d4eunltrtigqq970l3f8') && c.token === 'backup-token'));

setStorageTarget('backup');
assert.equal(storageTarget(), 'backup');
setStorageTarget('primary');
assert.equal(storageTarget(), 'primary');
signOutLocal();
assert.equal(validToken('primary'), null);
assert.equal(validToken('backup'), null);

console.log('все 8 проверок API выбора хранилища пройдены');
