// Service Worker — polling de chamados para notificações em background
// Ativado quando a aba vai para segundo plano; desativado quando volta ao foco.

const POLL_INTERVAL_MS = 60 * 1000; // 60 segundos (igual ao polling da página)

let pollTimer    = null;
self._polling    = false;
self._pollConfig = null;

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e  => e.waitUntil(self.clients.claim()));

// ── Mensagens da página ───────────────────────────────────────────────────────
self.addEventListener('message', e => {
  const { type, payload } = e.data || {};
  if (type === 'START_POLLING') startPolling(payload);
  if (type === 'STOP_POLLING')  stopPolling();
});

function startPolling(config) {
  stopPolling();
  self._polling    = true;
  self._pollConfig = config;
  // Primeira execução imediata para sincronizar baseline
  poll(config);
  pollTimer = setInterval(() => {
    if (self._polling) poll(self._pollConfig);
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  self._polling = false;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ── Poll principal ────────────────────────────────────────────────────────────
async function poll(config) {
  if (!config) return;
  try {
    const params = new URLSearchParams();
    if (config.vertical)  params.set('vertical',  config.vertical);
    if (config.portfolio) params.set('portfolio', config.portfolio);
    if (config.users)     params.set('users',     config.users);     // multi-user CSV
    if (config.typeIds)   params.set('typeIds',   config.typeIds);
    if (config.days)      params.set('days',      config.days);

    const r    = await fetch(`/api/chamados?${params}`);
    const data = await r.json();
    if (!data.ok) return;

    const unassigned = data.unassigned || [];
    const assigned   = data.assigned   || [];

    // known = { [key]: { status, assignee, updated } }
    const known      = self._pollConfig?.knownIssues || {};
    const isFirstRun = Object.keys(known).length === 0;

    // Snapshot atual
    const current = {};
    unassigned.forEach(i => { current[i.key] = { status: i.status, assignee: null,       updated: i.updated }; });
    assigned.forEach(i   => { current[i.key] = { status: i.status, assignee: i.assignee, updated: i.updated }; });

    // Atualiza baseline antes de qualquer coisa
    self._pollConfig = { ...config, knownIssues: current };

    // Na primeira execução apenas salva o baseline, sem notificar
    if (isFirstRun) return;

    // ── 1. Novos sem responsável (novo ou voltou da fila) ─────────────────────
    const novosUnassigned = unassigned.filter(i => {
      const prev = known[i.key];
      return !prev || prev.assignee !== null;
    });

    // ── 2. Mudança de status em atribuídos ────────────────────────────────────
    const statusAlterado = assigned.filter(i => {
      const prev = known[i.key];
      return prev && prev.status !== i.status;
    }).map(i => ({ ...i, prevStatus: known[i.key].status }));

    const novosKeys  = new Set(novosUnassigned.map(i => i.key));
    const statusKeys = new Set(statusAlterado.map(i => i.key));

    // ── 3. Movimentação (updated mudou, status igual) ─────────────────────────
    const all = unassigned.concat(assigned);
    const movimentados = all.filter(i => {
      if (novosKeys.has(i.key) || statusKeys.has(i.key)) return false;
      const prev = known[i.key];
      return prev && prev.status === i.status && prev.updated !== i.updated;
    });

    // ── 4. Chamados atribuídos que sumiram (possível encerramento) ────────────
    const currentKeys     = new Set(all.map(i => i.key));
    const resultTruncated = data.totalAssigned > assigned.length;
    const desaparecidos   = resultTruncated ? [] : Object.keys(known).filter(k =>
      !currentKeys.has(k) && known[k].assignee !== null
    );

    // ── Dispara notificações ──────────────────────────────────────────────────
    if (novosUnassigned.length > 0) {
      const title = novosUnassigned.length === 1
        ? `⚠️ Novo chamado sem responsável: ${novosUnassigned[0].key}`
        : `⚠️ ${novosUnassigned.length} novos chamados sem responsável`;
      const body = novosUnassigned.length === 1
        ? novosUnassigned[0].summary
        : novosUnassigned.map(i => `• ${i.key} — ${i.summary.slice(0, 55)}`).join('\n');
      await showNotif(title, body, 'unassigned');
    }

    if (statusAlterado.length > 0) {
      const title = statusAlterado.length === 1
        ? `🔄 Status alterado: ${statusAlterado[0].key}`
        : `🔄 ${statusAlterado.length} chamados com status alterado`;
      const body = statusAlterado.length === 1
        ? `${statusAlterado[0].summary}\n${statusAlterado[0].prevStatus} → ${statusAlterado[0].status}`
        : statusAlterado.map(i => `• ${i.key}: ${i.prevStatus} → ${i.status}`).join('\n');
      await showNotif(title, body, 'status');
    }

    if (movimentados.length > 0) {
      const title = movimentados.length === 1
        ? `📋 Movimentação: ${movimentados[0].key}`
        : `📋 ${movimentados.length} chamados com movimentação`;
      const body = movimentados.length === 1
        ? movimentados[0].summary
        : movimentados.map(i => `• ${i.key} — ${i.summary.slice(0, 55)}`).join('\n');
      await showNotif(title, body, 'movimentacao');
    }

    if (desaparecidos.length > 0) {
      try {
        const r2   = await fetch(`/api/issues?keys=${desaparecidos.join(',')}`);
        const d2   = await r2.json();
        const enc  = (d2.issues || []).filter(i => i.statusCat === 'done');
        if (enc.length > 0) {
          const title = enc.length === 1
            ? `✅ Chamado encerrado: ${enc[0].key}`
            : `✅ ${enc.length} chamados encerrados`;
          const body = enc.length === 1
            ? `Status: ${enc[0].status}`
            : enc.map(i => `• ${i.key} — ${i.status}`).join('\n');
          await showNotif(title, body, 'encerrado');
        }
      } catch { /* falha silenciosa */ }
    }

  } catch { /* falha silenciosa — sem internet, Jira offline, etc. */ }
}

// ── Helper de notificação ─────────────────────────────────────────────────────
async function showNotif(title, body, tag) {
  const perm = await self.registration.pushManager?.permissionState({ userVisibleOnly: true })
    .catch(() => 'unknown');
  // Tenta mostrar via registration (funciona mesmo sem Push API configurado)
  try {
    await self.registration.showNotification(title, {
      body,
      tag,
      renotify: true,
      icon:     '/favicon.ico',
      data:     { url: '/' },
    });
  } catch { /* permissão negada ou SW sem escopo */ }
}

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
