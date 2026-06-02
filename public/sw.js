// Service Worker — polling de chamados em background
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos
let pollTimer = null;

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Recebe mensagens da página principal
self.addEventListener('message', e => {
  if (e.data?.type === 'START_POLLING') {
    startPolling(e.data.payload);
  }
  if (e.data?.type === 'STOP_POLLING') {
    stopPolling();
  }
});

function startPolling(config) {
  stopPolling();
  // Guarda configuração no SW
  self._pollConfig = config;
  poll(config); // primeira checagem imediata
  pollTimer = setInterval(() => poll(self._pollConfig), POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function poll(config) {
  if (!config) return;
  try {
    const params = new URLSearchParams();
    if (config.vertical)  params.set('vertical',  config.vertical);
    if (config.portfolio) params.set('portfolio', config.portfolio);
    if (config.user)      params.set('user',       config.user);

    const r    = await fetch(`/api/chamados?${params}`);
    const data = await r.json();
    if (!data.ok || !data.issues) return;

    const currentKeys = new Set(data.issues.map(i => i.key));
    const knownKeys   = new Set(config.knownKeys || []);

    // Novos chamados = aparecem agora mas não estavam na última checagem
    const novos = data.issues.filter(i => !knownKeys.has(i.key));

    if (novos.length > 0) {
      // Atualiza knownKeys e notifica a página
      const allKeys = [...currentKeys];
      notifyClients({ type: 'NEW_ISSUES', issues: novos, allKeys });

      // Notificação do sistema
      const title = novos.length === 1
        ? `📋 Novo chamado: ${novos[0].key}`
        : `📋 ${novos.length} novos chamados`;
      const body = novos.length === 1
        ? novos[0].summary
        : novos.map(i => `• ${i.key} — ${i.summary.slice(0, 60)}`).join('\n');

      self.registration.showNotification(title, {
        body,
        icon: '/icon.png',
        badge: '/icon.png',
        tag: 'chamados-update',
        renotify: true,
        data: { url: '/' },
      });

      // Atualiza knownKeys no config do SW para a próxima checagem
      self._pollConfig = { ...config, knownKeys: allKeys };
    }
  } catch { /* falha silenciosa */ }
}

async function notifyClients(msg) {
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(c => c.postMessage(msg));
}

// Clique na notificação abre/foca a aba
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      const existing = clients.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow('/');
    })
  );
});
