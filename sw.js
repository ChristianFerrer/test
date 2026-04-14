// ============================================================
// sw.js - Whistle Service Worker
// Handles Web Push notifications + offline caching
// ============================================================

const CACHE_NAME = 'whistle-v3';
const PRECACHE = [
  '/',
  '/index.html',
  '/history.html',
  '/profile.html',
  '/login.html',
  '/landing.html',
  '/styles.css',
  '/app.js',
  '/history.js',
  '/profile.js',
  '/utils.js',
  '/i18n.js',
  '/auth-guard.js',
  '/whistle.png',
  '/whistle-icon.png',
  '/thief2.png',
  '/thief2-icon.png',
  '/thief_white.png',
  '/security_white.png',
  '/security_black.png',
  '/whistle2_black.png',
  '/radar.png',
  '/lib/leaflet.js',
  '/lib/leaflet.css',
  '/manifest.json',
];

// ── Install — precache shell ───────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// ── Activate — clean old caches ────────────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch — network first, fallback to cache ───────────────
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Skip non-GET and external API calls
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin && !url.href.includes('basemaps.cartocdn.com') && !url.href.includes('tile.openstreetmap.org')) return;

  // Map tiles — cache first (they rarely change)
  if (url.href.includes('tile.openstreetmap.org') || url.href.includes('basemaps.cartocdn.com')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return res;
        }).catch(() => cached);
      })
    );
    return;
  }

  // App shell — network first, fallback cache
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});

// ── Push received ───────────────────────────────────────────
self.addEventListener('push', (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    data = { title: 'Whistle', body: e.data ? e.data.text() : '¡Alerta cerca de ti!' };
  }

  const title   = data.title || '⚠️ Whistle — Carterista detectado';
  const options = {
    body:    data.body    || 'Se ha reportado un carterista cerca de tu ubicación.',
    icon:    data.icon    || '/thief2-icon.png',
    badge:   data.badge   || '/thief2-icon.png',
    tag:     data.tag     || 'whistle-alert',
    renotify: true,
    vibrate: [200, 100, 200],
    sound:   '/pickpoket.wav',
    data: {
      url: data.url || '/',
    },
    actions: [
      { action: 'open', title: 'Ver mapa' },
    ],
  };

  e.waitUntil(
    self.registration.showNotification(title, options).then(() => {
      return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'PLAY_WHISTLE' });
        });
      });
    })
  );
});

// ── Notification click ──────────────────────────────────────
self.addEventListener('notificationclick', (e) => {
  e.notification.close();

  const targetUrl = (e.notification.data && e.notification.data.url) || '/';

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
