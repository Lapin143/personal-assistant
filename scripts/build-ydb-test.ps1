param(
  [Parameter(Mandatory = $true)]
  [string]$ProxyUrl
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$target = Join-Path $repo 'ydb-test'
$assetFiles = @(
  'index.html', 'style.css', 'app.js', 'core.js', 'features.js', 'features.css',
  'api.js', 'store.js', 'data.json', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png'
)

if ($ProxyUrl -notmatch '^https://[a-zA-Z0-9.-]+(?:/[^\s]*)?$') {
  throw 'ProxyUrl must be an HTTPS Cloud Function URL.'
}

New-Item -ItemType Directory -Force -Path $target | Out-Null
foreach ($file in $assetFiles) { Copy-Item -LiteralPath (Join-Path $repo $file) -Destination (Join-Path $target $file) -Force }
Copy-Item -LiteralPath (Join-Path $repo 'menu') -Destination $target -Recurse -Force

$config = @"
// Test-only backend. This file is generated; production config.js is not changed.
export const API = {
  url: '$ProxyUrl',
  table: 'records'
};
"@
Set-Content -LiteralPath (Join-Path $target 'config.js') -Value $config -Encoding utf8

$htmlPath = Join-Path $target 'index.html'
$html = Get-Content -LiteralPath $htmlPath -Raw
$nl = [Environment]::NewLine
$html = $html.Replace('<link rel="manifest" href="manifest.webmanifest">', "<link rel=`"manifest`" href=`"manifest.webmanifest`">$nl  <script src=`"storage-isolation.js`"></script>")
$html = $html.Replace('<body>', "<body>$nl  <div class=`"test-environment-banner`" role=`"status`">ТЕСТОВАЯ БАЗА · ДАННЫЕ НЕ СИНХРОНИЗИРУЮТСЯ С Т1</div>")
$html = $html.Replace('href="style.css?v=b5"', 'href="style.css?v=ydb-test-1"')
$html = $html.Replace('href="menu/planner.css?v=b7"', 'href="menu/planner.css?v=ydb-test-1"')
$html = $html.Replace('href="features.css?v=c6"', 'href="features.css?v=ydb-test-1"')
$html = $html.Replace('src="app.js?v=c8"', 'src="app.js?v=ydb-test-1"')
Set-Content -LiteralPath $htmlPath -Value $html -Encoding utf8

$manifest = @'
{
  "name": "Семейный ассистент — тест YDB",
  "short_name": "Ассистент · тест",
  "description": "Изолированная тестовая версия семейного ассистента",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#f4f1ea",
  "theme_color": "#2f5d50",
  "lang": "ru",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "icon.svg", "sizes": "any", "type": "image/svg+xml" }
  ]
}
'@
Set-Content -LiteralPath (Join-Path $target 'manifest.webmanifest') -Value $manifest -Encoding utf8

$storage = @'
(() => {
  const storage = window.localStorage;
  const proto = Storage.prototype;
  const prefix = 'assistant-ydb-test:';
  const get = proto.getItem;
  const set = proto.setItem;
  const remove = proto.removeItem;
  const clear = proto.clear;
  const key = proto.key;
  Object.defineProperties(proto, {
    getItem: { configurable: true, value(name) { return get.call(this, prefix + name); } },
    setItem: { configurable: true, value(name, value) { return set.call(this, prefix + name, value); } },
    removeItem: { configurable: true, value(name) { return remove.call(this, prefix + name); } },
    clear: { configurable: true, value() {
      const keys = [];
      for (let i = 0; i < this.length; i++) { const k = key.call(this, i); if (k && k.startsWith(prefix)) keys.push(k); }
      for (const k of keys) remove.call(this, k);
    } },
    key: { configurable: true, value(index) {
      const keys = [];
      for (let i = 0; i < this.length; i++) { const k = key.call(this, i); if (k && k.startsWith(prefix)) keys.push(k.slice(prefix.length)); }
      return keys[index] ?? null;
    } }
  });
  void storage;
})();
'@
Set-Content -LiteralPath (Join-Path $target 'storage-isolation.js') -Value $storage -Encoding utf8

$style = @'
.test-environment-banner{position:sticky;top:0;z-index:9999;padding:7px 12px;text-align:center;background:#fff1cf;color:#7a4b00;border-bottom:1px solid #e2b452;font:700 12px/1.3 system-ui,sans-serif;letter-spacing:.04em}
'@
Add-Content -LiteralPath (Join-Path $target 'style.css') -Value $style -Encoding utf8

$sw = @'
const CACHE = 'assistant-ydb-test-v1';
const SHELL = ['./','index.html','style.css','app.js','core.js','menu/planner.js','menu/planner.css','features.js','features.css','api.js','store.js','config.js','data.json','manifest.webmanifest','storage-isolation.js','icon.svg','icon-180.png','icon-192.png','icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('assistant-ydb-test-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET'||new URL(r.url).origin!==self.location.origin)return;e.respondWith(fetch(r).then(res=>{if(res.ok)caches.open(CACHE).then(c=>c.put(r,res.clone()));return res;}).catch(()=>caches.match(r).then(x=>x||caches.match('index.html'))));});
'@
Set-Content -LiteralPath (Join-Path $target 'sw.js') -Value $sw -Encoding utf8

Write-Output "Generated isolated test app at $target"
