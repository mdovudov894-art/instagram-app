// Service Worker — барои нишон додани уведомление дар production (HTTPS)
self.addEventListener('install', (e) => {
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(self.clients.claim());
});

// Паёми аз app.js гирифтан ва уведомление нишон додан
self.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.type !== 'SHOW_NOTIFICATION') return;

    const { title, body, icon, tag } = data.payload;

    self.registration.showNotification(title, {
        body,
        icon: icon || '/icon.png',
        badge: '/icon.png',
        tag,
        renotify: true,
        vibrate: [100, 50, 100]
    });
});

// Клик ба уведомление — кушодани барнома ва чат
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const tag = event.notification.tag;

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if ('focus' in client) {
                    client.postMessage({ type: 'NOTIFICATION_CLICK', sender: tag });
                    return client.focus();
                }
            }
            if (self.clients.openWindow) {
                return self.clients.openWindow('/');
            }
        })
    );
});
