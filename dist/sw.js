const CACHE_VERSION = 'noise-awareness-notifications-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

function notificationOptions(payload = {}) {
  return {
    body: payload.body || 'A new sound event may need your attention.',
    icon: payload.icon || './assets/icons/notification-icon.svg',
    badge: payload.badge || './assets/icons/notification-icon.svg',
    tag: payload.tag || `noise-alert-${Date.now()}`,
    renotify: false,
    data: {
      url: payload.url || './index.html#events',
      eventId: payload.eventId || ''
    }
  };
}

self.addEventListener('message', event => {
  if (event.data?.type !== 'SHOW_NOISE_NOTIFICATION') return;
  const payload = event.data.payload || {};
  event.waitUntil(self.registration.showNotification(payload.title || 'Noise Awareness', notificationOptions(payload)));
});

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; }
  catch { payload = { body: event.data?.text() || '' }; }
  event.waitUntil(self.registration.showNotification(payload.title || 'Noise Awareness', notificationOptions(payload)));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './index.html#events', self.location.href).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        client.navigate(target);
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
