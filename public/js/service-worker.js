// ============================================
// SERVICE WORKER v3 - Fast load, offline support
// ============================================

const CACHE_NAME = 'tkd-championship-v3';

// Static assets to cache on install (app shell)
const PRECACHE_URLS = [
  '/index.html',
  '/register.html',
  '/admin/dashboard.html',
  '/admin/bracket.html',
  '/admin/form-preview.html',
  '/admin/weight-categories.html',
  '/admin/championships.html',
  '/admin/standings.html',
  '/admin/Live-matches.html',
  '/team/dashboard.html',
  '/assets/css/main.css',
  '/js/modal.js',
  '/js/custom-select.js',
  '/js/auth.js',
  '/js/ui.js',
  '/js/form-config.js',
  '/js/category-logic.js',
  '/js/registration.js',
  '/js/championship-manager.js',
  '/js/bracket.js',
  '/js/performance-cache.js',
  '/js/Team-deadline-manager.js',
  '/js/admin-form-editor.js',
  '/js/admin-category-editor.js',
];

// ── Install: precache app shell ──────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Add each URL individually so one failure doesn't break everything
      return Promise.allSettled(
        PRECACHE_URLS.map(url => cache.add(url).catch(() => {}))
      );
    })
  );
  self.skipWaiting();
});

// ── Activate: delete old caches ──────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch strategy ───────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = event.request.url;
  const method = event.request.method;

  // Never intercept: Firebase, non-GET, chrome-extension
  if (
    method !== 'GET' ||
    url.includes('firebaseio.com') ||
    url.includes('firebase.googleapis.com') ||
    url.includes('googleapis.com') ||
    url.includes('gstatic.com') ||
    url.includes('chrome-extension')
  ) {
    return;
  }

  // HTML pages: Network first, fall back to cache (always get fresh page)
  if (url.endsWith('.html') || url.includes('.html?')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // JS and CSS: Cache first, update in background (stale-while-revalidate)
  if (url.endsWith('.js') || url.endsWith('.css')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request).then(cached => {
          const networkFetch = fetch(event.request).then(response => {
            if (response && response.status === 200) {
              cache.put(event.request, response.clone());
            }
            return response;
          }).catch(() => cached);
          // Return cached immediately, update in background
          return cached || networkFetch;
        })
      )
    );
    return;
  }

  // Images: Cache first, long-lived (images don't change often)
  if (url.match(/\.(png|jpg|jpeg|gif|svg|webp|ico)$/)) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return response;
        }).catch(() => new Response('', { status: 404 }));
      })
    );
    return;
  }

  // Everything else: network first with cache fallback
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});