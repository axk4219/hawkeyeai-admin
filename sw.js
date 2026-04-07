const CACHE_NAME = 'hawkeye-capture-v4';
const ASSETS = [
  '/capture.html',
  '/css/styles.css',
  '/css/capture.css',
  '/js/auth.js',
  '/js/capture-v3.js',
  '/assets/optimized/logo-300.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).catch(() =>
      caches.match(e.request).then((cached) =>
        cached || new Response('Offline – check your connection', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' }
        })
      )
    )
  );
});
