// ============================================================
// sw.js — Service Worker cho Sổ Giao Hàng PWA
// Chiến lược: Network-First cho HTML, Cache-First cho assets
// ============================================================

const CACHE_VERSION = 'sgh-v1.2.1';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const FALLBACK_URL  = './index.html';

// Danh sách tài nguyên cần pre-cache khi cài đặt
const PRECACHE_URLS = [
  './index.html',
  './manifest.json',
  './icon.svg',
  // Leaflet CDN (cache khi online lần đầu)
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

// ---- INSTALL -----------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(async (cache) => {
      // Cache từng file, bỏ qua nếu lỗi (ví dụ offline khi install)
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
  // Kích hoạt ngay mà không chờ tab cũ đóng
  self.skipWaiting();
});

// ---- ACTIVATE ----------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(async (cacheNames) => {
      // Xóa các cache cũ do ứng dụng này tạo ra (prefix 'sgh-')
      const deletePromises = cacheNames
        .filter(name => name.startsWith('sgh-') && name !== STATIC_CACHE)
        .map(name => {
          console.log(`[SW] Xóa cache cũ: ${name}`);
          return caches.delete(name);
        });
      await Promise.all(deletePromises);
      // Kiểm soát tất cả client ngay lập tức
      return self.clients.claim();
    })
  );
});

// ---- FETCH -------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Bỏ qua các request không phải GET
  if (request.method !== 'GET') return;

  // Bỏ qua chrome-extension và các scheme khác
  if (!['http:', 'https:'].includes(url.protocol)) return;

  // Bỏ qua Nominatim / geocoding API — không cache dữ liệu bản đồ
  if (url.hostname.includes('nominatim.openstreetmap.org')) return;

  // --- Navigation requests (HTML pages): Network-First ---
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstWithFallback(request));
    return;
  }

  // --- Leaflet CSS/JS và tile bản đồ: Network-First với cache ---
  if (url.hostname.includes('unpkg.com') || url.hostname.includes('tile.openstreetmap.org')) {
    event.respondWith(networkFirstWithCache(request));
    return;
  }

  // --- Tài nguyên tĩnh local (css, js, svg, png, ...): Cache-First ---
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirstWithNetwork(request));
    return;
  }

  // --- Mặc định: Network only, không cache ---
  event.respondWith(fetch(request).catch(() => {
    // Nếu lỗi và là navigation, trả về fallback
    if (request.mode === 'navigate') {
      return caches.match(FALLBACK_URL);
    }
  }));
});

// ---- Chiến lược Network-First (cho navigation HTML) --------
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

// ---- Chiến lược Network-First (cho CDN assets) -------------
async function networkFirstWithCache(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    const cached = await cache.match(request);
    return cached || new Response('', { status: 503 });
  }
}

// ---- Chiến lược Cache-First (cho tài nguyên local) ---------
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

// ---- Nhận thông báo từ app (ví dụ: skipWaiting thủ công) ---
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
