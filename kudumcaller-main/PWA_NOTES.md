# SoloDS KudumCaller — PWA Implementation Notes

## What changed

| File | Purpose |
|---|---|
| `client/manifest.json` | Installability metadata: real PNG icons (192/512/maskable), `portrait-primary` orientation, `standalone` display, theme/background colors, an install shortcut. |
| `client/service-worker.js` | Precaches the app shell for offline load, network-first for HTML (so fixes ship immediately), cache-first for static assets, never intercepts `/socket.io/` traffic, handles versioned updates, and is pre-wired for Web Push (`push` / `notificationclick` handlers). |
| `client/offline.html` | Fallback page shown if a navigation fails with nothing cached yet. |
| `client/index.html` | Full PWA meta tags (iOS + Android), safe-area viewport, install/update banners, rotate-device overlay, desktop keyboard-shortcut hints, desktop network-diagnostics panel. |
| `client/style.css` | `platform-desktop` / `platform-mobile` / `standalone` classes drive layout differences: 44px+ touch targets and bigger call controls on mobile, wider canvas + keyboard hints on desktop, safe-area padding for notches, animated incoming-call ring. |
| `client/app.js` | Platform detection, service worker registration + update flow, install-prompt handling, Web Audio ringtone (works offline, no audio file to host), Vibration API, Screen Wake Lock, `getStats()`-based network diagnostics, portrait orientation lock attempt + rotate overlay, keyboard shortcuts gated to desktop. |
| `client/icons/*.png` | Generated app icons (192, 512, maskable 512, Apple touch icon, favicon) — replace with your own branded artwork whenever you like, same filenames. |

The Node/Socket.io backend in `server/` is untouched — your signaling and room logic keep working exactly as before.

## Important caveat: push notifications

The service worker's `push` and `notificationclick` handlers are fully implemented and will fire the instant a push payload arrives — but nothing sends one yet. True "ring even when the app is fully closed" push requires:

1. VAPID key pair generated on the server.
2. A `/subscribe` endpoint on your Render backend that stores each user's `PushSubscription`.
3. The `web-push` npm package on the server, called when a call comes in, sending the payload to the callee's stored subscription.

Until that's wired up, `app.js`'s `notifyIncomingCallIfBackgrounded()` covers the next best thing: if the PWA tab is open but backgrounded (user switched apps) and the socket connection is still alive, it shows a local notification with Accept/Decline actions. It cannot ring after the app/tab has been fully closed or the OS has killed the background page — that gap only closes with real Web Push.

## Testing checklist

- **Desktop (Chrome/Firefox/Edge/Safari):** open the URL, create a call, confirm `Esc` ends and `M` toggles mute, click "Show network details" during a connected call to see candidate type / RTT / codec / packet loss.
- **Android Chrome:** open the URL, wait for the "Install KudumCaller" banner (or use the browser menu → Install app), confirm it opens standalone (no address bar) from the home screen, confirm the ring plays and the phone vibrates on an incoming call, confirm the screen stays awake during a call.
- **iOS Safari:** Add to Home Screen manually (Safari doesn't fire `beforeinstallprompt`), confirm standalone launch, confirm ringtone plays (note: iOS does not support the Vibration API — vibration silently no-ops there, which is expected), confirm Wake Lock keeps the screen on (iOS 16.4+; on older iOS this API doesn't exist and the screen may still sleep).
- **Offline:** after one successful load, turn on airplane mode and reload — the app shell should still load instead of showing the browser's default offline error.
- **Update flow:** bump `SW_VERSION` in `service-worker.js`, redeploy, reload an already-open tab — the "new version available" banner should appear; clicking Refresh should apply the update immediately.

## Deploying

- **Client → GitHub Pages:** push `client/` as-is; `<base href="/kudumcaller/client/">` in `index.html` and the relative paths in `manifest.json`/`service-worker.js` assume the site is served at `https://<user>.github.io/kudumcaller/client/`. If your repo/path differs, update that `base href` (and nothing else needs to change, since the manifest and service worker use relative paths).
- **Server → Render:** no changes needed; keep `CLIENT_URL` pointed at your GitHub Pages origin.
- Service workers require HTTPS (GitHub Pages provides this) — they will not register on plain HTTP except `localhost`.
