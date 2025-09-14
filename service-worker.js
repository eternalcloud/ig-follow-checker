// service-worker.js
const CACHE = 'ig-follow-tracker-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname === '/share-target' && e.request.method === 'POST') {
    e.respondWith((async () => {
      const form = await e.request.formData();
      const file = form.get('file');
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const target = allClients[0];
      if (target) {
        const blob = file instanceof File ? file : new File([file], 'instagram.zip', { type: 'application/zip' });
        target.postMessage({ type: 'SHARE_TARGET_ZIP', file: blob });
        target.focus();
      }
      return Response.redirect('./', 303);
    })());
    return;
  }

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(e.request, { ignoreVary: true });
    if (cached) return cached;
    try {
      const res = await fetch(e.request);
      if (e.request.method === 'GET' && res.ok && (url.origin === location.origin || url.hostname.includes('jsdelivr'))) {
        cache.put(e.request, res.clone());
      }
      return res;
    } catch (err) {
      return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
