// Service Worker — responsável apenas por exibir notificações nativas
// O polling é feito diretamente pela página (que usa Wake Lock para se manter ativa).

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e  => e.waitUntil(self.clients.claim()));

// ── Exibe notificação a pedido da página ──────────────────────────────────────
self.addEventListener('message', e => {
  const { type, payload } = e.data || {};
  if (type === 'SHOW_NOTIFICATION') {
    const { title, body, tag } = payload || {};
    if (title) {
      self.registration.showNotification(title, {
        body:     body || '',
        tag:      tag  || 'chamados',
        renotify: true,
        icon:     '/favicon.ico',
        data:     { url: '/' },
      }).catch(() => {});
    }
  }
});

// ── Click na notificação → foca ou abre a aba ─────────────────────────────────
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
