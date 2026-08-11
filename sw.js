// sw.js — Herbal | قانونِ مفرد اعضاء
// مقصد: سائٹ کو آف لائن اور ایپ کی طرح انسٹال کے قابل بنانا

const CACHE_NAME = 'herbal-cache-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-512-maskable.png'
];

// انسٹال: بنیادی فائلیں کیش کریں
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch(() => {
        // اگر کوئی فائل نہ ملے تو باقی فائلیں پھر بھی کیش ہو جائیں
      });
    })
  );
  self.skipWaiting();
});

// ایکٹیویٹ: پرانے کیش صاف کریں
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// فیچ: پہلے کیش سے دیں (آف لائن کام کرے)، ساتھ ساتھ نیٹ ورک سے تازہ کاپی بھی لے کر کیش اپڈیٹ کریں
// نوٹ: /api/ کالز کبھی کیش نہ کریں (دوا کا جواب ہمیشہ تازہ ہونا چاہیے)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request).catch(() => new Response(
      JSON.stringify({ error: 'آف لائن ہیں — انٹرنیٹ سے جڑیں۔' }),
      { headers: { 'Content-Type': 'application/json' } }
    )));
    return;
  }

  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const networkFetch = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || networkFetch;
    })
  );
});
