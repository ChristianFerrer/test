// ============================================================
// sw.js - Whistle Service Worker
// Handles Web Push notifications even when browser is closed
// ============================================================

const CACHE_NAME = 'whistle-v2';

// ── Install & activate ──────────────────────────────────────
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
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

  // Show notification, then try to play whistle sound in any open app windows
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
      // If the app is already open, focus it
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
