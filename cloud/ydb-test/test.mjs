import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { _test } = require('./index.js');
const { handle } = require('./index.js');

test('YDB SQL string values preserve quotes and line breaks safely', () => {
  const encoded = _test.sqlString("it's\nOK");
  assert.equal(encoded, "'it\\'s\\nOK'");
});

test('seed import assigns stable sequential row ids and retains tombstones', () => {
  const row = _test.normalizeSeedItem({ kind: 'tx', key: 'abc', deleted: 1, updated: 123, data: { id: 'abc' } }, 4, 999);
  assert.equal(row.id, 5);
  assert.equal(row.deleted, 1);
  assert.equal(row.updated, 123);
  assert.deepEqual(row.data, { id: 'abc' });
});

test('seed import rejects an invalid row shape', () => {
  assert.throws(() => _test.normalizeSeedItem({ kind: '../bad', key: 'x' }, 0, 1), /Invalid seed row/);
});

test('YDB SDK result rows can be read from resultSets and direct arrays', () => {
  assert.deepEqual(_test.resultRows({ resultSets: [{ rows: [{ id: 1 }] }] }), [{ id: 1 }]);
  assert.deepEqual(_test.resultRows([[{ id: 2 }]]), [{ id: 2 }]);
});

test('login issues a token for the configured test user', async () => {
  const env = { YDB_ENDPOINT: 'grpcs://example:2135', YDB_DATABASE: '/test', AUTH_SECRET: 'a'.repeat(40), AUTH_USER_1: 'lapin:example-test-password' };
  const res = await handle({ httpMethod: 'POST', headers: { origin: 'https://lapin143.github.io' }, queryStringParameters: { action: 'login' }, body: JSON.stringify({ login: 'lapin', password: 'example-test-password' }) }, env, 1000);
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(body.login, 'lapin');
  assert.equal(_test.checkToken(env, body.token, 1001).login, 'lapin');
});

test('login rejects bad credentials and origin outside the allowlist', async () => {
  const env = { YDB_ENDPOINT: 'grpcs://example:2135', YDB_DATABASE: '/test', AUTH_SECRET: 'b'.repeat(40), AUTH_USER_1: 'lapin:example-test-password' };
  const badPass = await handle({ httpMethod: 'POST', headers: {}, queryStringParameters: { action: 'login' }, body: JSON.stringify({ login: 'lapin', password: 'wrong' }) }, env, 1000);
  const badOrigin = await handle({ httpMethod: 'POST', headers: { origin: 'https://evil.invalid' }, queryStringParameters: { action: 'login' }, body: '{}' }, env, 1000);
  assert.equal(badPass.statusCode, 401);
  assert.equal(badOrigin.statusCode, 403);
});
