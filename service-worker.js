// ============================================================
// service-worker.js — EST 84 PWA
// Estrategia: Cache-first para assets estáticos,
//             Network-first para llamadas a /api
// ============================================================

const CACHE_NAME    = 'est84-v2';
const CACHE_STATIC  = 'est84-static-v2';

// Assets que se cachean al instalar el SW
const ASSETS_PRECACHE = [
  '/',
  '/index.html',
  '/inicio.html',
  '/dashboard.html',
  '/buscador.html',
  '/expediente.html',
  '/captura_reporte.html',
  '/captura_ficha.html',
  '/tool_fichas.html',
  '/tool_fotos.html',
  '/tool_calificaciones.html',
  '/tool_usuarios.html',
  '/tool_logs.html',
  '/tool_ciclo.html',
  '/aviso-privacidad.html',
  '/auth-helper.js',
  '/manifest.json',
  // Fuente Outfit (se cachea después del primer uso)
];

// ── INSTALL: cachear assets estáticos ──────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then(cache => {
      return cache.addAll(ASSETS_PRECACHE);
    }).then(() => self.skipWaiting())
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

// ── FETCH: estrategia según tipo de request ─────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Llamadas a /api → siempre Network (nunca cachear datos)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkOnly(event.request));
    return;
  }

  // Fuentes de Google → Cache-first
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // CDN externos (Chart.js, html2pdf, xlsx, etc.) → Cache-first
  if (url.hostname === 'cdnjs.cloudflare.com' || url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Todo lo demás (HTML, JS, CSS, imágenes) → Cache-first con fallback a network
  event.respondWith(cacheFirst(event.request));
});

// ── HELPERS ─────────────────────────────────────────────────

// Network only — para APIs (datos siempre frescos)
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

// Cache first — para assets estáticos
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    // Solo cachear respuestas válidas
    if (response && response.status === 200 && response.type !== 'opaque') {
      const cache = await caches.open(CACHE_STATIC);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Si falla y hay algo en cache, devolver eso
    const fallback = await caches.match('/index.html');
    return fallback || new Response('Sin conexión', { status: 503 });
  }
}
