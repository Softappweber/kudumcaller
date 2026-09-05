/* =====================================================
   SOLODS KUDUMCALLER - Service Worker
   Handles: static asset caching, offline fallback,
   push notifications for incoming calls, and safe
   auto-updating between versions.
   ===================================================== */

// Bump this on every deploy so old caches get cleaned up.
const SW_VERSION = 'v1.0.0';
const STATIC_CACHE = `kudumcaller-static-${SW_VERSION}`;
const RUNTIME_CACHE = `kudumcaller-runtime-${SW_VERSION}`;

// Everything needed to boot the shell offline.
// NOTE: keep paths relative - this file is served from /kudumcaller/client/
const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './offline.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.png'
];

// Third-party script we depend on - cache it too so a cold PWA launch
// with a flaky connection can still boot far enough to show the UI.
const RUNTIME_ALLOWLIST = [
  'https://cdn.socket.io/'
];

// ===== INSTALL: pre-cache the app shell =====
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()) // activate new SW immediately
      .catch((err) => console.warn('[SW] Precache failed:', err))
  );
});

// ===== ACTIVATE: clean up old caches, take control =====
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// ===== FETCH STRATEGY =====
// - Navigation requests (HTML): network-first, falling back to cache, then offline page.
//   This ensures a signaling/room-code fix ships immediately on reload while
//   still working offline.
// - Same-origin static assets (css/js/icons/manifest): cache-first, updating in background.
// - Never cache/interfere with Socket.IO's realtime traffic (websocket/polling) -
//   those requests must always hit the network live.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never intercept realtime signaling traffic - let it go straight to network.
  if (url.pathname.includes('/socket.io/')) return;

  // Navigations -> network-first with offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('./offline.html'))
        )
    );
    return;
  }

  const isSameOrigin = url.origin === self.location.origin;
  const isAllowedRuntime = RUNTIME_ALLOWLIST.some((prefix) => request.url.startsWith(prefix));

  if (isSameOrigin || isAllowedRuntime) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetch(request)
          .then((response) => {
            if (response && response.status === 200) {
              const copy = response.clone();
              caches.open(isSameOrigin ? STATIC_CACHE : RUNTIME_CACHE)
                .then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached); // offline: fall back to whatever we have

        // Cache-first: return cached immediately if present, refresh in background.
        return cached || networkFetch;
      })
    );
  }
  // Cross-origin, non-allowlisted requests: let the browser handle normally.
});

// ===== MESSAGE: let the page force an update =====
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// =====================================================
// PUSH NOTIFICATIONS (for incoming calls when the tab
// is backgrounded or the PWA is closed).
//
// This service worker can DISPLAY a push notification the
// instant your backend sends one via the Web Push protocol.
// Wiring up the send side (VAPID keys + a push subscription
// endpoint on your Node/Render server) is a separate step -
// see the README notes shipped alongside this file. Until
// that's wired up, this handler simply won't fire, and the
// app falls back to in-tab notifications + ringtone while
// the page is open.
// =====================================================
self.addEventListener('push', (event) => {
  let data = { title: '📞 Incoming Call', body: 'Someone is calling you on KudumCaller' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) {
    // non-JSON push payload; use defaults
  }

  const options = {
    body: data.body,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    vibrate: [300, 150, 300, 150, 300],
    tag: 'kudumcaller-incoming-call',
    renotify: true,
    requireInteraction: true,
    data: { roomId: data.roomId || null, url: data.url || './' },
    actions: [
      { action: 'accept', title: '✅ Accept' },
      { action: 'decline', title: '❌ Decline' }
    ]
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// ===== NOTIFICATION CLICK: focus/open the app =====
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({ type: 'notification-action', action: event.action });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
