/**
 * Service Worker for Offline AI Research Copilot
 * 
 * Caches app shell, models, and embeddings for fully offline operation
 */

const CACHE_NAME = 'offline-ai-copilot-v1';
const RUNTIME_CACHE = 'runtime-cache-v1';

// Files to cache for offline use
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
];

// Install event - cache app shell
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching app shell');
        return cache.addAll(APP_SHELL);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME && name !== RUNTIME_CACHE)
            .map((name) => caches.delete(name))
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip cross-origin requests
  if (url.origin !== location.origin) {
    // But cache HuggingFace model downloads
    if (url.hostname.includes('huggingface.co')) {
      event.respondWith(
        caches.match(request)
          .then((cached) => {
            if (cached) {
              console.log('[SW] Serving cached model:', url.pathname);
              return cached;
            }
            
            return fetch(request).then((response) => {
              // Cache successful model downloads
              if (response.ok) {
                const clone = response.clone();
                caches.open(RUNTIME_CACHE).then((cache) => {
                  cache.put(request, clone);
                });
              }
              return response;
            });
          })
      );
    }
    return;
  }
  
  // Cache-first strategy for app shell
  if (request.method === 'GET') {
    event.respondWith(
      caches.match(request)
        .then((cached) => {
          if (cached) {
            console.log('[SW] Serving from cache:', url.pathname);
            return cached;
          }
          
          return fetch(request).then((response) => {
            // Cache successful GET requests
            if (response.ok) {
              const clone = response.clone();
              caches.open(RUNTIME_CACHE).then((cache) => {
                cache.put(request, clone);
              });
            }
            return response;
          });
        })
        .catch(() => {
          // Offline fallback
          if (request.destination === 'document') {
            return caches.match('/index.html');
          }
        })
    );
  }
});

// Message handler for cache management
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((names) => Promise.all(names.map((name) => caches.delete(name))))
    );
  }
});
