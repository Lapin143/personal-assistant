// Локальный стенд: приложение + настоящий код функции + имитация Tabrica в памяти.
// Запуск: node cloud/dev-server.mjs  →  http://localhost:8080  (логины test1 / test2, пароли в выводе консоли)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTabrica } from './fake-tabrica.mjs';

const { handle } = createRequire(import.meta.url)('./index.js');
const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT || 8080);
const tabrica = makeTabrica();
const env = {
  TABRICA_TOKEN: 'tab_secret', TABRICA_DB_ID: '349', TABRICA_TABLE_ID_RECORDS: '513',
  AUTH_SECRET: 'local-dev-secret-local-dev-secret-0000',
  AUTH_USER_1: 'test1:local-test-password-1', AUTH_USER_2: 'test2:local-test-password-2',
  ALLOWED_ORIGINS: `http://localhost:${port}`
};
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  try {
    if (url.pathname === '/fn') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const r = await handle({
        httpMethod: req.method, headers: req.headers, queryStringParameters: Object.fromEntries(url.searchParams),
        body: Buffer.concat(chunks).toString('utf8'), requestContext: { identity: { sourceIp: req.socket.remoteAddress } }
      }, env, tabrica.fetch);
      res.writeHead(r.statusCode, r.headers);
      return res.end(r.body);
    }
    if (url.pathname === '/__state') { // для тестов: что лежит в «Табрике»
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ requests: tabrica.requests, rows: [...tabrica.rows.values()] }));
    }
    if (url.pathname === '/config.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
      return res.end(`export const API = { url: 'http://localhost:${port}/fn', table: 'records' };\n`);
    }
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '') || 'index.html';
    if (rel.startsWith('..') || rel.startsWith('.git')) { res.writeHead(403); return res.end(); }
    const body = await readFile(join(root, rel));
    res.writeHead(200, { 'Content-Type': TYPES[extname(rel)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (err) {
    res.writeHead(err.code === 'ENOENT' ? 404 : 500);
    res.end(String(err.message));
  }
}).listen(port, () => console.log(`http://localhost:${port}  test1 / local-test-password-1, test2 / local-test-password-2`));
