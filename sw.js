/* Service Worker — GitHub Pages のサブパス公開でも壊れないよう全て相対パスで記述 */
const CACHE = 'voicememo-v4';

// SW自身の位置を基準にした相対パス（サブパス配信でも正しく解決される）
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
].map((p) => new URL(p, self.location).toString());

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // GET 以外（POST 等）と別オリジン（= Anthropic API 等）は素通し
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  // アプリシェルは cache-first、無ければネットワーク→キャッシュ追加
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(new URL('./index.html', self.location).toString()));
    })
  );
});
