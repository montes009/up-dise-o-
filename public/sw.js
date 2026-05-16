const CACHE = "alcon-ops-v11";
const ASSETS = [
  "/manifest.json"
  // index.html excluido a propósito: siempre se sirve desde la red
];

// Instalación: cachear solo assets estáticos (no index.html)
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting()) // toma control sin esperar cierre de tabs
  );
});

// Activación: limpiar TODOS los caches anteriores y reclamar clientes
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Mensaje desde el cliente para forzar skip waiting
self.addEventListener("message", e => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

// Fetch: estrategia según tipo de recurso
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // ── 1. API: siempre red, nunca caché ──────────────────────────────────────
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: "Sin conexión" }), {
          headers: { "Content-Type": "application/json" }
        })
      )
    );
    return;
  }

  // ── 2. HTML: network-first → nunca sirve HTML obsoleto ───────────────────
  if (url.pathname === "/" || url.pathname.endsWith(".html")) {
    e.respondWith(
      fetch(e.request)
        .then(response => response) // siempre la versión fresca
        .catch(() => caches.match(e.request)) // offline: usar caché si existe
    );
    return;
  }

  // ── 3. Resto de assets: cache-first con fallback a red ───────────────────
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (!response || response.status !== 200 || response.type !== "basic") return response;
        const clone = response.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return response;
      });
    })
  );
});
