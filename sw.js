// ============================================================
// sw.js — Service Worker cho app offline riêng tư
// Không cache dữ liệu từ bên ngoài; chỉ dùng tài nguyên nội bộ
// ============================================================

const CACHE_VERSION = 'sgh-v1.3.0';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const FALLBACK_URL  = './index.html';

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './styles.css',
  './4-icon-shipper_9937d5a87ccd40c686194426bf740106_grande.webp'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const results = await Promise.allSettled(
        PRECACHE_URLS.map(url =>
          cache.add(url).catch(err => {
            console.warn(`[SW] Không cache được: ${url}`, err.message);
          })
        )
      );
      return results;
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(async (cacheNames) => {
      const deletePromises = cacheNames
        .filter(name => name.startsWith('sgh-') && name !== STATIC_CACHE)
        .map(name => caches.delete(name));
      await Promise.all(deletePromises);
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (!['http:', 'https:'].includes(url.protocol)) return;
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstWithFallback(request));
    return;
  }

  event.respondWith(cacheFirstWithNetwork(request));
});

async function networkFirstWithFallback(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    const fallback = await caches.match(FALLBACK_URL);
    return fallback || new Response('Ứng dụng đang offline. Vui lòng kết nối mạng.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function cacheFirstWithNetwork(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    return new Response('', { status: 503 });
  }
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
