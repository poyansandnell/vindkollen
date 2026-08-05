/**
 * push-sw.js — importeras av den Workbox-genererade service workern via importScripts().
 *
 * Hanterar inkommande Web Push-notiser och klick på dem.
 * Läggs automatiskt till av vite-plugin-pwa (workbox.importScripts).
 */

self.addEventListener('push', function (event) {
  if (!event.data) return;

  var data;
  try {
    data = event.data.json();
  } catch (e) {
    data = { title: 'Vindkollen', body: event.data.text(), url: '/' };
  }

  var title = data.title || 'Vindkollen';
  var options = {
    body: data.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/favicon-32.png',
    data: { url: data.url || '/' },
    tag: 'vindkollen-push',
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (clients) {
        for (var i = 0; i < clients.length; i++) {
          if ('focus' in clients[i]) return clients[i].focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
      }),
  );
});
