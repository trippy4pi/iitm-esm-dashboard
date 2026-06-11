const CACHE_NAME = "esm-viewer-v11";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./export-studio.js?v=20260612d",
  "./manifest.json",
  "./assets/favicon.png",
  "./assets/IITM_Logo.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icons/lucide-download.svg",
  "./JSONs/State_VARIABLES.json",
  "./JSONs/District_VARIABLES.json",
  "./JSONs/state_ultra_optimized.geojson",
  "./JSONs/districts_ultra_optimized.geojson",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://cdn.jsdelivr.net/npm/chart.js",
  "https://cdnjs.cloudflare.com/ajax/libs/dom-to-image/2.6.0/dom-to-image.min.js"
];

// Install Event
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("Service Worker caching assets...");
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate Event
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log("Removing old cache:", key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Event (Cache First, Network Fallback)
self.addEventListener("fetch", (e) => {
  // Ignore PHP endpoint requests (visits/heartbeat) so they aren't cached
  if (e.request.url.includes(".php")) {
    return;
  }
  
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(e.request).then((networkResponse) => {
        // Cache newly fetched assets if valid
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Return fallback if offline and cache misses
      });
    })
  );
});
