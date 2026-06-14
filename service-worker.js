const CACHE_NAME = "pwa-v5";
const urlsToCache = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./style.css",
  "./nl.json",
  "./en.json"
];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
    )
  );
});

self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(r => r || fetch(event.request))
  );
});
