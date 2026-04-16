// ============================================================
// service-worker.js — EST 84 PWA
// Estrategia: Network-first para HTML/JS,
//             Cache-first para CDN externos y fuentes,
//             Network-only para /api
// ============================================================

const CACHE_NAME    = 'est84-v9';
const CACHE_STATIC  = 'est84-static-v9';

// Solo se pre-cachean el manifest y los íconos PWA
// Los HTML y JS siempre se piden frescos a la red
const ASSETS_PRECACHE = [
  '/manifest.json',
];

// ── INSTALL ────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => cache.addAll(ASSETS_PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: limpiar caches viejos ────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_STATIC)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH ───────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // /api → siempre Network
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkOnly(event.request));
    return;
  }

  // Fuentes Google y CDN externos → dejar pasar sin interceptar
  if (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com' ||
    url.hostname === 'cdnjs.cloudflare.com' ||
    url.hostname === 'cdn.jsdelivr.net' ||
    url.hostname === 'cdn-icons-png.flaticon.com'
  ) {
    return; // No interceptar — el navegador los maneja directamente
  }

  // HTML y JS propios → Network-first (siempre frescos)
  if (url.pathname.endsWith('.html') || url.pathname.endsWith('.js') || url.pathname === '/') {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Resto (imágenes, íconos, etc.) → Cache-first
  event.respondWith(cacheFirst(event.request));
});

// ── HELPERS ─────────────────────────────────────────────────

async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch {
    return new Response(
      JSON.stringify({ error: 'Sin conexión a internet' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(CACHE_STATIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || caches.match('/index.html');
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.status === 200 && response.type !== 'opaque') {
      const cache = await caches.open(CACHE_STATIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Sin conexión', { status: 503 });
  }
}

// ── PUSH NOTIFICATIONS (Emergencia) ─────────────────────────
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const titulo = data.titulo || '🚨 EMERGENCIA — EST 84';
  const cuerpo = data.cuerpo || 'Se ha activado una alerta de emergencia en el plantel.';

  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: cuerpo,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      vibrate: [500, 200, 500, 200, 500],
      requireInteraction: true,
      tag: 'emergencia-est84'
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('inicio.html') && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/inicio.html');
    })
  );
});
