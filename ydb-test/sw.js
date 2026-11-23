const CACHE = 'assistant-ydb-test-v1';
const SHELL = ['./','index.html','style.css','app.js','core.js','menu/planner.js','menu/planner.css','features.js','features.css','api.js','store.js','config.js','data.json','manifest.webmanifest','storage-isolation.js','icon.svg','icon-180.png','icon-192.png','icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('assistant-ydb-test-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET'||new URL(r.url).origin!==self.location.origin)return;e.respondWith(fetch(r).then(res=>{if(res.ok)caches.open(CACHE).then(c=>c.put(r,res.clone()));return res;}).catch(()=>caches.match(r).then(x=>x||caches.match('index.html'))));});
