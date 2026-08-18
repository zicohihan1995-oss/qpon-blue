const CACHE = "qpon-project-z-v4-blue-master-fo";
const SHELL = ["./", "index.html", "styles.css?v=4-blue-master-fo", "app.js?v=4-blue-master-fo", "script-data.js", "manifest.webmanifest?v=home-icon", "QPON_LOGO.png", "zico-hihan-logo-white.png", "QPON-home-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    return response;
  })));
});
