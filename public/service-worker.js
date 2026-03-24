/**
 * Service Worker for Offline AI Research Copilot
 * HACKATHON-OPTIMIZED: Aggressive caching for reliable offline behavior
 *
 * Caches app shell, models, and embeddings for fully offline operation
 */

const CACHE_VERSION = 'v2';
const CACHE_NAME = `offline-ai-copilot-${CACHE_VERSION}`;
const RUNTIME_CACHE = `runtime-cache-${CACHE_VERSION}`;
const MODEL_CACHE = `model-cache-${CACHE_VERSION}`;

// Files to cache for offline use (app shell)
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
];

// Install event - cache app shell aggressively
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker v2...');

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching app shell');
        return cache.addAll(APP_SHELL);
      })
      .then(() => {
        console.log('[SW] Skip waiting - activate immediately');
        return self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker v2...');

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => !name.includes(CACHE_VERSION))
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] Claiming clients');
        return self.clients.claim();
      })
  );
});

// Fetch event - smart caching strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Handle model downloads from HuggingFace - AGGRESSIVE CACHING
  if (url.hostname.includes('huggingface.co') || url.hostname.includes('hf.co')) {
    event.respondWith(handleModelRequest(request));
    return;
  }

  // Handle CDN resources (fonts, pdf.js worker, etc.)
  if (url.hostname.includes('cdn.jsdelivr.net') ||
      url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(handleCDNRequest(request));
    return;
  }

  // Handle same-origin requests - Cache first
  if (url.origin === location.origin) {
    event.respondWith(handleAppRequest(request));
    return;
  }
});

// Handle model downloads - cache forever (models don't change)
async function handleModelRequest(request) {
  const cached = await caches.match(request);
  if (cached) {
    console.log('[SW] Model served from cache:', request.url.slice(-50));
    return cached;
  }

  try {
    const response = await fetch(request);

    if (response.ok) {
      const cache = await caches.open(MODEL_CACHE);
      // Clone before caching
      cache.put(request, response.clone());
      console.log('[SW] Model cached for offline:', request.url.slice(-50));
    }

    return response;
  } catch (error) {
    console.error('[SW] Model fetch failed:', error);
    // Return cached version if available on network failure
    const fallback = await caches.match(request);
    if (fallback) return fallback;
    throw error;
  }
}

// Handle CDN resources - cache for performance
async function handleCDNRequest(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);

    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }

    return response;
  } catch (error) {
    // Try cache on failure
    const fallback = await caches.match(request);
    if (fallback) return fallback;
    throw error;
  }
}

// Handle app requests - Cache first, network fallback
async function handleAppRequest(request) {
  // Try cache first
  const cached = await caches.match(request);

  // For HTML/navigation requests, try network first for freshness
  if (request.mode === 'navigate' || request.destination === 'document') {
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(request, response.clone());
        return response;
      }
    } catch (e) {
      // Network failed, use cache
      if (cached) return cached;
      // Last resort - return index.html for SPA
      return caches.match('/index.html');
    }
  }

  // For other resources, use cache first
  if (cached) {
    return cached;
  }

  // Not in cache, try network
  try {
    const response = await fetch(request);

    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }

    return response;
  } catch (error) {
    // Offline fallback for documents
    if (request.destination === 'document') {
      return caches.match('/index.html');
    }
    throw error;
  }
}

// Message handler for cache management
self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    case 'CLEAR_CACHE':
      event.waitUntil(
        caches.keys()
          .then((names) => Promise.all(names.map((name) => caches.delete(name))))
          .then(() => {
            event.ports[0]?.postMessage({ success: true });
          })
      );
      break;

    case 'GET_CACHE_SIZE':
      event.waitUntil(
        getCacheSize().then((size) => {
          event.ports[0]?.postMessage({ size });
        })
      );
      break;

    case 'PRECACHE_MODELS':
      // Allow precaching model URLs
      if (payload?.urls) {
        event.waitUntil(
          precacheModels(payload.urls).then(() => {
            event.ports[0]?.postMessage({ success: true });
          })
        );
      }
      break;
  }
});

// Helper: Get total cache size
async function getCacheSize() {
  let totalSize = 0;
  const cacheNames = await caches.keys();

  for (const name of cacheNames) {
    const cache = await caches.open(name);
    const keys = await cache.keys();

    for (const request of keys) {
      const response = await cache.match(request);
      if (response) {
        const blob = await response.blob();
        totalSize += blob.size;
      }
    }
  }

  return totalSize;
}

// Helper: Precache model URLs
async function precacheModels(urls) {
  const cache = await caches.open(MODEL_CACHE);

  for (const url of urls) {
    try {
      const existing = await cache.match(url);
      if (!existing) {
        const response = await fetch(url);
        if (response.ok) {
          await cache.put(url, response);
          console.log('[SW] Precached model:', url.slice(-50));
        }
      }
    } catch (e) {
      console.warn('[SW] Failed to precache:', url, e);
    }
  }
}

console.log('[SW] Service Worker script loaded');
