/* ═══════════════════════════════════════════════════
   Benza Service Worker
   Strategia: Cache First per asset statici,
   Network First per API e dati live
═══════════════════════════════════════════════════ */

const CACHE_NAME = 'benza-v6';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minuti per i dati API

// Asset statici da cachare subito all'installazione
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap',
];

// ── INSTALL ──────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS.filter(url => !url.startsWith('http') || url.includes(self.location.hostname)));
    }).catch(err => {
      console.warn('Cache install parziale:', err);
    })
  );
  self.skipWaiting();
});

// ── ACTIVATE ─────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ── FETCH ─────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // API distributori → Network First, fallback cache
  if (url.hostname.includes('workers.dev') || url.hostname.includes('onrender.com')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Mapbox tiles e API → sempre network, non cachare
  if (url.hostname.includes('mapbox.com') || url.hostname.includes('mapbox.cn')) {
    event.respondWith(fetch(event.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // Font Google → Cache First
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Asset statici del sito → Cache First
  // Cartella admin → sempre dal network, mai dalla cache
if (url.pathname.startsWith('/admin/')) {
  event.respondWith(fetch(event.request));
  return;
}

// Asset statici del sito → Cache First
if (url.hostname === self.location.hostname) {
  event.respondWith(cacheFirst(event.request));
  return;
}

  // Tutto il resto → network
  event.respondWith(fetch(event.request).catch(() => caches.match('/')));
});

// ── STRATEGIE ─────────────────────────────────────────

async function cacheFirst(request) {
  // index.html sempre dal network per avere sempre la versione aggiornata
  if (request.url.endsWith('/') || request.url.endsWith('/index.html')) {
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
      }
      return response;
    } catch {
      const cached = await caches.match(request);
      return cached || new Response('Offline', { status: 503 });
    }
  }
  // Tutto il resto: cache first
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request, { signal: AbortSignal.timeout(15000) });
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
