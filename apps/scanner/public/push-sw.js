/*
 * Liquor Kings push service worker — PUSH ONLY (2026-07-05).
 *
 * DELIBERATELY has NO fetch handler and NO caching. This worker exists for
 * exactly two things: show a push notification, and open/focus the app when
 * it's tapped. A caching service worker can serve a stale bundle after a
 * deploy — that is the white-screen class of bug, and we are not reopening
 * that door. Never add a fetch handler here.
 *
 * Payload contract (see services/api/src/lib/run-final-push.js):
 *   { title, body, tag, url, data: { run_id, store_id, kind } }
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = null;
  try {
    payload = event.data ? event.data.json() : null;
  } catch {
    payload = null;
  }
  const title = (payload && payload.title) || "Liquor Kings";
  const options = {
    body: (payload && payload.body) || "Tap to open the app.",
    tag: (payload && payload.tag) || undefined,
    data: (payload && payload.data) || {},
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const scopeUrl = self.registration.scope; // e.g. https://liquor-kings.fly.dev/scanner/
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        if (client.url.startsWith(scopeUrl) && "focus" in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(scopeUrl);
    })(),
  );
});
