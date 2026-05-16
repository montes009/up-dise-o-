const CACHE = "alcon-ops-v5";
const ASSETS = [
  "/",
  "/index.html",
  "/manifest.json"
];

// Instalación: cachear assets estáticos
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// Activación: limpiar caches viejos
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first para /api/chat, cache-first para el resto
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // Las llamadas a la API siempre van a la red
  if(url.pathname.startsWith("/api/")) {
    e.respondWith(fetch(e.request).catch(() =>
      new Response(JSON.stringify({ error: "Sin conexión" }), {
        headers: { "Content-Type": "application/json" }
      })
    ));
    return;
  }

  // Assets: cache-first con fallback a red
  e.respondWith(
    caches.match(e.request).then(cached => {
      if(cached) return cached;
      return fetch(e.request).then(response => {
        if(!response || response.status !== 200 || response.type !== "basic") return response;
        const clone = response.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return response;
      });
    })
  );
});
