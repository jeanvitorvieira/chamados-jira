self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('message', e => {
  const { type, payload } = e.data || {};
  if (type === 'SHOW_NOTIFICATION') {
    const { title, body, tag } = payload || {};
    if (title) {
      self.registration.showNotification(title, {
        body: body || '',
        tag: tag || 'chamados',
        renotify: true,
        icon: '/favicon.ico',
        data: { url: '/' },
      }).catch(() => { });
    }
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow('/');
    })
  );
});
