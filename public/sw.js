// Service Worker — polling de notificações push em background
// O polling de UI (atualização da tabela) é feito diretamente na página (30s).
// Este SW cuida apenas de notificações push (5 min), úteis quando a aba está em background.
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos
let pollTimer = null;

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('message', e => {
  if (e.data?.type === 'START_POLLING') startPolling(e.data.payload);
  if (e.data?.type === 'STOP_POLLING')  stopPolling();
});

function startPolling(config) {
  stopPolling();
  self._pollConfig = config;
  poll(config);
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
    if (config.user)      params.set('user',      config.user);

    const r    = await fetch(`/api/chamados?${params}`);
    const data = await r.json();
    if (!data.ok) return;

    // A API retorna data.issues (array flat) — separamos aqui
    const issues     = data.issues || [];
    const unassigned = issues.filter(i => !i.assignee);
    const assigned   = issues.filter(i =>  !!i.assignee);

    // knownIssues = { [key]: { status, assignee } }
    const known      = config.knownIssues || {};
    const isFirstRun = Object.keys(known).length === 0;

    // Snapshot atual
    const current = {};
    issues.forEach(i => { current[i.key] = { status: i.status, assignee: i.assignee || null }; });

    // Na primeira execução, salva baseline e notifica a página
    if (isFirstRun) {
      self._pollConfig = { ...config, knownIssues: current };
      notifyClients({ type: 'BASELINE_SET', knownIssues: current });
      return;
    }

    // ── Novos chamados sem responsável ────────────────────────────────────────
    const novosUnassigned = unassigned.filter(i => !known[i.key]);

    // ── Mudanças de status em chamados atribuídos ─────────────────────────────
    const statusChanged = assigned
      .filter(i => known[i.key] && known[i.key].status !== i.status)
      .map(i => ({ ...i, prevStatus: known[i.key].status }));

    // Atualiza baseline
    self._pollConfig = { ...config, knownIssues: current };

    // ── Push notifications ────────────────────────────────────────────────────
    if (novosUnassigned.length > 0) {
      const title = novosUnassigned.length === 1
        ? `⚠️ Novo chamado sem responsável: ${novosUnassigned[0].key}`
        : `⚠️ ${novosUnassigned.length} novos chamados sem responsável`;
      const body = novosUnassigned.length === 1
        ? novosUnassigned[0].summary
        : novosUnassigned.map(i => `• ${i.key} — ${i.summary.slice(0, 55)}`).join('\n');

      self.registration.showNotification(title, {
        body, tag: 'novos-unassigned', renotify: true, data: { url: '/' },
      });
      notifyClients({ type: 'NEW_UNASSIGNED', issues: novosUnassigned, knownIssues: current });
    }

    if (statusChanged.length > 0) {
      const title = statusChanged.length === 1
        ? `🔄 Status alterado: ${statusChanged[0].key}`
        : `🔄 ${statusChanged.length} chamados com status alterado`;
      const body = statusChanged.length === 1
        ? `${statusChanged[0].summary}\n${statusChanged[0].prevStatus} → ${statusChanged[0].status}`
        : statusChanged.map(i => `• ${i.key}: ${i.prevStatus} → ${i.status}`).join('\n');

      self.registration.showNotification(title, {
        body, tag: 'status-changed', renotify: true, data: { url: '/' },
      });
      notifyClients({ type: 'STATUS_CHANGED', issues: statusChanged, knownIssues: current });
    }

    notifyClients({ type: 'POLL_DONE', knownIssues: current });

  } catch { /* falha silenciosa */ }
}

async function notifyClients(msg) {
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(c => c.postMessage(msg));
}

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
