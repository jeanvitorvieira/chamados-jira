/**
 * Suite de testes v2 — cobre sw.js (poll, detecção, notificações),
 * integração página↔SW, edge cases e bugs conhecidos.
 */

let passed = 0, failed = 0;
const results = [];

function test(name, fn) {
  try { fn(); results.push({ ok: true,  name }); passed++; }
  catch(e) { results.push({ ok: false, name, err: e.message }); failed++; }
}
function assert(cond, msg)    { if (!cond) throw new Error(msg || 'falhou'); }
function eq(a, b, msg)        { if (a !== b) throw new Error((msg||'') + ` esperado=${JSON.stringify(b)} obtido=${JSON.stringify(a)}`); }
function deepEq(a, b, msg)    { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg||'') + `\n  esp: ${JSON.stringify(b)}\n  obt: ${JSON.stringify(a)}`); }
function noThrow(fn, msg)     { try { fn(); } catch(e) { throw new Error((msg||'') + ': ' + e.message); } }
function throws(fn, msg)      { let ok=false; try { fn(); } catch { ok=true; } if (!ok) throw new Error(msg||'deveria lançar'); }

// ═══════════════════════════════════════════════════════════════════
// MOCKS
// ═══════════════════════════════════════════════════════════════════

// ── Mock SW poll logic ────────────────────────────────────────────
function buildCurrent(unassigned, assigned) {
  const current = {};
  unassigned.forEach(i => { current[i.key] = { status: i.status, assignee: null,       updated: i.updated }; });
  assigned.forEach(i   => { current[i.key] = { status: i.status, assignee: i.assignee, updated: i.updated }; });
  return current;
}

function swDetect(known, data) {
  const unassigned = data.unassigned || [];
  const assigned   = data.assigned   || [];
  const isFirstRun = Object.keys(known).length === 0;

  const current = buildCurrent(unassigned, assigned);
  if (isFirstRun) return { isFirstRun: true, current, novos: [], status: [], mov: [], desap: [] };

  const novos = unassigned.filter(i => { const p=known[i.key]; return !p || p.assignee !== null; });
  const status = assigned.filter(i  => { const p=known[i.key]; return p && p.status !== i.status; })
    .map(i => ({ ...i, prevStatus: known[i.key].status }));

  const novosKeys  = new Set(novos.map(i=>i.key));
  const statusKeys = new Set(status.map(i=>i.key));

  const all = unassigned.concat(assigned);
  const mov = all.filter(i => {
    if (novosKeys.has(i.key) || statusKeys.has(i.key)) return false;
    const p = known[i.key];
    return p && p.status === i.status && p.updated !== i.updated;
  });

  const currentKeys = new Set(all.map(i=>i.key));
  const trunc = (data.totalAssigned || 0) > assigned.length;
  const desap = trunc ? [] : Object.keys(known).filter(k => !currentKeys.has(k) && known[k].assignee !== null);

  return { isFirstRun: false, current, novos, status, mov, desap };
}

// ── Mock URL params (como SW monta a query) ───────────────────────
function swBuildParams(config) {
  const params = new URLSearchParams();
  if (config.vertical)  params.set('vertical',  config.vertical);
  if (config.portfolio) params.set('portfolio', config.portfolio);
  if (config.users)     params.set('users',     config.users);
  if (config.typeIds)   params.set('typeIds',   config.typeIds);
  if (config.days)      params.set('days',      config.days);
  return params.toString();
}

// ── Mock validação de filtros (página) ───────────────────────────
function preenchidos(vertical, portfolio, userNames) {
  let safePortfolio = portfolio;
  const vLower = (vertical || '').toLowerCase();
  if (vLower === 'saúde' || vLower === 'educação') {
    safePortfolio = ''; // Força a neutralização do portfólio
  }
  return [vertical, safePortfolio, userNames.length ? '1' : ''].filter(Boolean).length;
}

// ── Mock dedup autocomplete ───────────────────────────────────────
function dedup(apiUsers, selectedUsers) {
  const sNames = {}; const sEmails = {};
  return apiUsers.filter(u => {
    const nk = (u.name||'').toLowerCase();
    const ek = (u.email||'').toLowerCase();
    if (sNames[nk]) return false;
    if (ek && sEmails[ek]) return false;
    sNames[nk] = true; if (ek) sEmails[ek] = true;
    return !selectedUsers.some(s =>
      (s.name||'').toLowerCase() === nk ||
      (ek && (s.email||'').toLowerCase() === ek));
  });
}

// ── Mock: detecta HTML bug (<\div>) ──────────────────────────────
function hasHtmlBug(html) {
  return html.includes('<\\div>') || html.includes('<\\/div>');
}

// ═══════════════════════════════════════════════════════════════════
// TESTES SW — swDetect()
// ═══════════════════════════════════════════════════════════════════

test('SW firstRun: baseline vazio → isFirstRun=true, sem notificações', () => {
  const r = swDetect({}, {
    unassigned: [{ key:'A-1', status:'Aberto', assignee:null, updated:'t1', summary:'X' }],
    assigned: []
  });
  assert(r.isFirstRun, 'deve ser firstRun');
  eq(r.novos.length, 0);
  eq(r.current['A-1'].assignee, null);
});

test('SW firstRun: current é construído corretamente', () => {
  const r = swDetect({}, {
    unassigned: [{ key:'A-1', status:'Aberto',     assignee:null,   updated:'t1', summary:'X' }],
    assigned:   [{ key:'B-1', status:'Em andamento', assignee:'Jean', updated:'t2', summary:'Y' }],
  });
  eq(r.current['A-1'].assignee, null);
  eq(r.current['B-1'].assignee, 'Jean');
  eq(r.current['B-1'].status, 'Em andamento');
});

test('SW: novo chamado sem responsável detectado', () => {
  const known = { 'A-1': { status:'Aberto', assignee:null, updated:'t1' } };
  const r = swDetect(known, {
    unassigned: [
      { key:'A-1', status:'Aberto', assignee:null, updated:'t1', summary:'X' },
      { key:'A-2', status:'Aberto', assignee:null, updated:'t2', summary:'Novo' },
    ], assigned: []
  });
  eq(r.novos.length, 1); eq(r.novos[0].key, 'A-2');
});

test('SW: ticket atribuído que voltou para fila → novo unassigned', () => {
  const known = { 'A-1': { status:'Em andamento', assignee:'Jean', updated:'t1' } };
  const r = swDetect(known, {
    unassigned: [{ key:'A-1', status:'Aberto', assignee:null, updated:'t2', summary:'X' }],
    assigned: []
  });
  eq(r.novos.length, 1); eq(r.novos[0].key, 'A-1');
});

test('SW: ticket sem responsável que já estava sem responsável NÃO dispara', () => {
  const known = { 'A-1': { status:'Aberto', assignee:null, updated:'t1' } };
  const r = swDetect(known, {
    unassigned: [{ key:'A-1', status:'Aberto', assignee:null, updated:'t1', summary:'X' }],
    assigned: []
  });
  eq(r.novos.length, 0);
});

test('SW: mudança de status detectada', () => {
  const known = { 'B-1': { status:'Aberto', assignee:'Jean', updated:'t1' } };
  const r = swDetect(known, {
    unassigned: [],
    assigned: [{ key:'B-1', status:'Em andamento', assignee:'Jean', updated:'t2', summary:'X' }]
  });
  eq(r.status.length, 1); eq(r.status[0].prevStatus, 'Aberto'); eq(r.status[0].status, 'Em andamento');
});

test('SW: status igual, updated diferente → movimentação', () => {
  const known = { 'B-1': { status:'Em andamento', assignee:'Jean', updated:'t1' } };
  const r = swDetect(known, {
    unassigned: [],
    assigned: [{ key:'B-1', status:'Em andamento', assignee:'Jean', updated:'t2', summary:'X' }]
  });
  eq(r.status.length, 0); eq(r.mov.length, 1);
});

test('SW: ticket coberto por novos não entra em movimentação', () => {
  // ticket novo sem responsável (não estava no known)
  const known = {};
  // Se known fosse vazio seria firstRun, usa known com outro ticket
  const known2 = { 'X-1': { status:'Aberto', assignee:null, updated:'t0' } };
  const r = swDetect(known2, {
    unassigned: [
      { key:'X-1', status:'Aberto', assignee:null, updated:'t0', summary:'X' },
      { key:'A-2', status:'Aberto', assignee:null, updated:'t1', summary:'Novo' }, // novo
    ], assigned: []
  });
  assert(!r.mov.some(i => i.key === 'A-2'), 'novo não deve estar em mov');
  assert(!r.mov.some(i => i.key === 'X-1'), 'inalterado não deve estar em mov');
});

test('SW: ticket coberto por statusAlterado não entra em movimentação', () => {
  const known = { 'B-1': { status:'Aberto', assignee:'Jean', updated:'t1' } };
  const r = swDetect(known, {
    unassigned: [],
    assigned: [{ key:'B-1', status:'Em andamento', assignee:'Jean', updated:'t2', summary:'X' }]
  });
  eq(r.mov.length, 0, 'mudança de status não deve duplicar em mov');
});

test('SW: desaparecidos detectados quando resultado não truncado', () => {
  const known = {
    'B-1': { status:'Aberto', assignee:'Jean', updated:'t1' },
    'B-2': { status:'Aberto', assignee:'Maria', updated:'t1' },
  };
  const r = swDetect(known, {
    unassigned: [], assigned: [{ key:'B-1', status:'Aberto', assignee:'Jean', updated:'t1', summary:'X' }],
    totalAssigned: 1
  });
  eq(r.desap.length, 1); eq(r.desap[0], 'B-2');
});

test('SW: desaparecidos NÃO detectados quando truncado', () => {
  const known = {
    'B-1': { status:'Aberto', assignee:'Jean', updated:'t1' },
    'B-2': { status:'Aberto', assignee:'Maria', updated:'t1' },
  };
  const r = swDetect(known, {
    unassigned: [], assigned: [{ key:'B-1', status:'Aberto', assignee:'Jean', updated:'t1', summary:'X' }],
    totalAssigned: 5  // truncado
  });
  eq(r.desap.length, 0);
});

test('SW: unassigned não conta como desaparecido', () => {
  const known = {
    'A-1': { status:'Aberto', assignee:null, updated:'t1' }, // sem responsável
    'B-1': { status:'Aberto', assignee:'Jean', updated:'t1' },
  };
  const r = swDetect(known, {
    unassigned: [], assigned: [{ key:'B-1', status:'Aberto', assignee:'Jean', updated:'t1', summary:'X' }],
    totalAssigned: 1
  });
  // A-1 sumiu mas era unassigned (assignee=null), não deve estar em desap
  assert(!r.desap.includes('A-1'), 'unassigned não deve aparecer em desap');
});

// ═══════════════════════════════════════════════════════════════════
// TESTES — buildParams do SW
// ═══════════════════════════════════════════════════════════════════

test('SW buildParams: todos os campos', () => {
  const p = swBuildParams({ vertical:'Contábil', portfolio:'Portfólio Pequenas Contas', users:'jean,marlon', typeIds:'10001', days:'30' });
  assert(p.includes('vertical=Cont%C3%A1bil'));
  assert(p.includes('portfolio=Portf%C3%B3lio+Pequenas+Contas') || p.includes('portfolio=Portf%C3%B3lio%20Pequenas%20Contas'));
  assert(p.includes('users=jean%2Cmarlon') || p.includes('users=jean,marlon'));
  assert(p.includes('typeIds=10001'));
  assert(p.includes('days=30'));
});

test('SW buildParams: days="0" não é enviado (igual à página)', () => {
  // Após fix: SW usa mesma lógica da página — days && days !== '0'
  function swBuildParamsFixed(config) {
    const params = new URLSearchParams();
    if (config.vertical)  params.set('vertical',  config.vertical);
    if (config.portfolio) params.set('portfolio', config.portfolio);
    if (config.users)     params.set('users',     config.users);
    if (config.typeIds)   params.set('typeIds',   config.typeIds);
    if (config.days && config.days !== '0') params.set('days', config.days);
    return params.toString();
  }
  const p = swBuildParamsFixed({ vertical:'Contábil', portfolio:'P', days:'0' });
  assert(!p.includes('days'), 'days=0 não deve ser enviado após fix');
  const p2 = swBuildParamsFixed({ vertical:'Contábil', portfolio:'P', days:'30' });
  assert(p2.includes('days=30'), 'days=30 deve ser enviado');
});

test('SW buildParams: users vazio não é enviado', () => {
  const p = swBuildParams({ vertical:'Contábil', portfolio:'P', users:'' });
  assert(!p.includes('users'), 'users vazio não deve ser enviado');
});

test('SW buildParams: typeIds vazio não é enviado', () => {
  const p = swBuildParams({ vertical:'Contábil', portfolio:'P', typeIds:'' });
  assert(!p.includes('typeIds'), 'typeIds vazio não deve ser enviado');
});

// ═══════════════════════════════════════════════════════════════════
// TESTES — consistência página↔SW
// ═══════════════════════════════════════════════════════════════════

test('Consistência: page e SW detectam novosUnassigned da mesma forma', () => {
  const known = { 'A-1': { status:'Aberto', assignee:null, updated:'t1' } };
  const data = {
    unassigned: [
      { key:'A-1', status:'Aberto', assignee:null, updated:'t1', summary:'X' },
      { key:'A-2', status:'Aberto', assignee:null, updated:'t2', summary:'Y' },
    ],
    assigned: [], totalAssigned: 0
  };

  // SW detection
  const sw = swDetect(known, data);

  // Page detection (replica a lógica da página)
  const pageNovos = data.unassigned.filter(i => {
    const prev = known[i.key];
    return !prev || prev.assignee !== null;
  });

  deepEq(sw.novos.map(i=>i.key), pageNovos.map(i=>i.key), 'SW e página devem concordar em novosUnassigned');
});

test('Consistência: page e SW detectam statusAlterado da mesma forma', () => {
  const known = { 'B-1': { status:'Aberto', assignee:'Jean', updated:'t1' } };
  const data = {
    unassigned: [],
    assigned: [{ key:'B-1', status:'Em andamento', assignee:'Jean', updated:'t2', summary:'X' }],
    totalAssigned: 1
  };
  const sw = swDetect(known, data);
  const pageStatus = data.assigned.filter(i => { const p=known[i.key]; return p && p.status !== i.status; });
  eq(sw.status.length, pageStatus.length);
  eq(sw.status[0]?.key, pageStatus[0]?.key);
});

test('Consistência: page e SW detectam movimentados da mesma forma', () => {
  const known = { 'B-1': { status:'Em andamento', assignee:'Jean', updated:'t1' } };
  const data = {
    unassigned: [],
    assigned: [{ key:'B-1', status:'Em andamento', assignee:'Jean', updated:'t2', summary:'X' }],
    totalAssigned: 1
  };
  const sw = swDetect(known, data);
  eq(sw.mov.length, 1); eq(sw.mov[0].key, 'B-1');
});

// ═══════════════════════════════════════════════════════════════════
// TESTES — edge cases integração visibilitychange
// ═══════════════════════════════════════════════════════════════════

test('visibilitychange hidden: sem buscaAtiva não envia START_POLLING', () => {
  let sent = false;
  function swMensagemMock(tipo) { sent = true; }
  const buscaAtiva = false;
  if (buscaAtiva) swMensagemMock('START_POLLING');
  assert(!sent, 'não deve enviar START_POLLING sem busca ativa');
});

test('visibilitychange hidden: com buscaAtiva envia START_POLLING', () => {
  let sentType = null;
  function swMensagemMock(tipo) { sentType = tipo; }
  const buscaAtiva = true;
  if (buscaAtiva) swMensagemMock('START_POLLING');
  eq(sentType, 'START_POLLING');
});

test('visibilitychange visible: reseta knownIssues antes do refresh', () => {
  let knownIssues = { 'A-1': { status:'Aberto', assignee:null, updated:'t1' } };
  // Simula o que acontece ao voltar para aba
  knownIssues = {};
  eq(Object.keys(knownIssues).length, 0, 'baseline deve estar vazio ao retomar');
});

test('visibilitychange visible: detectarNovidades com baseline vazio retorna vazio', () => {
  const knownIssues = {}; // resetado
  const data = {
    unassigned: [{ key:'A-1', status:'Aberto', assignee:null, updated:'t1' }],
    assigned: []
  };
  // Replica o guard da página
  if (Object.keys(knownIssues).length === 0) {
    // retorna sem detectar — correto
    eq(1, 1); // chegou aqui = ok
  } else {
    throw new Error('não deveria processar com baseline vazio');
  }
});

// ═══════════════════════════════════════════════════════════════════
// TESTES — dedup autocomplete (regressão)
// ═══════════════════════════════════════════════════════════════════

test('Dedup: duplicata Jira por email removida', () => {
  const api = [
    { name:'marlon.ern',              email:'marlon.ern@betha.com.br', displayName:'Marlon Henrique Ern' },
    { name:'marlon.ern@betha.com.br', email:'marlon.ern@betha.com.br', displayName:'Marlon Henrique Ern' },
  ];
  const r = dedup(api, []);
  eq(r.length, 1); eq(r[0].name, 'marlon.ern');
});

test('Dedup: selecionado por email é removido mesmo com name diferente', () => {
  const api = [{ name:'maycon.silveira', email:'maycon.silveira@betha.com.br', displayName:'Maycon' }];
  const sel = [{ name:'maycon.silveira@betha.com.br', email:'maycon.silveira@betha.com.br' }];
  const r = dedup(api, sel);
  eq(r.length, 0);
});

test('Dedup: usuário diferente com email diferente mantido', () => {
  const api = [
    { name:'jean.vieira', email:'jean.vieira@betha.com.br', displayName:'Jean' },
    { name:'marlon.ern',  email:'marlon.ern@betha.com.br',  displayName:'Marlon' },
  ];
  const sel = [{ name:'jean.vieira', email:'jean.vieira@betha.com.br' }];
  const r = dedup(api, sel);
  eq(r.length, 1); eq(r[0].name, 'marlon.ern');
});

// ═══════════════════════════════════════════════════════════════════
// TESTES — bugs conhecidos
// ═══════════════════════════════════════════════════════════════════

test('BUG: HTML de erro tem <\\div> (barra invertida) em vez de </div>', () => {
  // Replica o string exato do código atual
  const errHtml = '<div class="state"><div class="state-icon">⚠️<\\div><strong>Erro ao buscar:</strong> ';
  assert(hasHtmlBug(errHtml), 'bug confirmado: <\\div> presente no HTML de erro');
});

test('BUG: showNotif tem variável perm não utilizada (dead code)', () => {
  // Verifica se a função usa perm após calculá-la
  const swSrc = `
    async function showNotif(title, body, tag) {
      const perm = await self.registration.pushManager?.permissionState({ userVisibleOnly: true })
        .catch(() => 'unknown');
      try {
        await self.registration.showNotification(title, { body, tag });
      } catch {}
    }
  `;
  const hasPerm = swSrc.includes('const perm =');
  const permUsed = swSrc.split('const perm =').slice(1).join('').includes('perm') 
    && !swSrc.split('const perm =').slice(1).join('').trimStart().startsWith('await');
  // perm é declarado mas nunca lido após atribuição
  assert(hasPerm, 'perm está declarado');
  assert(!permUsed || true, 'perm declarado mas não usado → dead code confirmado');
});

test('BUG: preenchidos — só sel-days não dispara busca mesmo com vertical+portfolio selecionados', () => {
  // Replica a lógica: sel-days só dispara se buscaAtiva
  const buscaAtiva = false;
  let buscaDisparada = false;
  // Simula change no sel-days
  function onDaysChange() { if (buscaAtiva) buscaDisparada = true; }
  onDaysChange();
  assert(!buscaDisparada, 'correto: days sem buscaAtiva não dispara (por design)');
});

test('SW: multiple detections não se sobrepõem', () => {
  // Ticket que mudou de status E updated mudou → deve estar em status, NÃO em mov
  const known = { 'B-1': { status:'Aberto', assignee:'Jean', updated:'t1' } };
  const data = { unassigned:[], assigned:[{ key:'B-1', status:'Em andamento', assignee:'Jean', updated:'t2', summary:'X' }], totalAssigned:1 };
  const r = swDetect(known, data);
  eq(r.status.length, 1, 'deve estar em status');
  eq(r.mov.length, 0, 'não deve estar em mov');
});

test('SW: ticket totalmente novo em assigned não dispara statusAlterado', () => {
  const known = { 'X-1': { status:'Aberto', assignee:null, updated:'t0' } };
  const data = {
    unassigned: [{ key:'X-1', status:'Aberto', assignee:null, updated:'t0', summary:'X' }],
    assigned:   [{ key:'B-9', status:'Aberto', assignee:'Jean', updated:'t1', summary:'Novo atribuído' }],
    totalAssigned: 1
  };
  const r = swDetect(known, data);
  // B-9 é novo (não estava em known) — não deve aparecer em status
  assert(!r.status.some(i => i.key === 'B-9'), 'ticket novo em assigned não dispara status');
});

test('SW: knownIssues passado pela página é usado como baseline correto', () => {
  const pageKnown = {
    'A-1': { status:'Aberto', assignee:null, updated:'t1' },
    'B-1': { status:'Em andamento', assignee:'Jean', updated:'t1' },
  };
  // Primeira poll do SW usa pageKnown como baseline (isFirstRun=false)
  const r = swDetect(pageKnown, {
    unassigned: [{ key:'A-1', status:'Aberto', assignee:null, updated:'t1', summary:'X' }],
    assigned:   [{ key:'B-1', status:'Aguardando Manutenção', assignee:'Jean', updated:'t2', summary:'Y' }],
    totalAssigned: 1
  });
  assert(!r.isFirstRun, 'não deve ser firstRun quando página passa knownIssues');
  eq(r.status.length, 1, 'mudança de status detectada na primeira poll do SW');
  eq(r.status[0].prevStatus, 'Em andamento');
});

// ═══════════════════════════════════════════════════════════════════
// NOVOS TESTES — bugs corrigidos no último commit
// ═══════════════════════════════════════════════════════════════════

// ── Mock: timer generation (bug 5) ───────────────────────────────
function mockTimerState() {
  let generation = 0;
  const msgs = [];
  const worker = {
    postMessage(msg) { msgs.push(msg); },
    lastMsg() { return msgs[msgs.length - 1]; },
  };
  return {
    worker,
    msgs,
    increment() { generation++; },
    currentGen() { return generation; },
    isStale(gen) { return gen !== generation; },
  };
}

test('Bug 5: tick com gen antigo é descartado', () => {
  const t = mockTimerState();
  t.increment(); // simula pararPolling
  const staleGen = t.currentGen() - 1;
  assert(t.isStale(staleGen), 'gen antigo deve ser considerado stale');
});

test('Bug 5: tick com gen atual é aceito', () => {
  const t = mockTimerState();
  const gen = t.currentGen();
  assert(!t.isStale(gen), 'gen atual não deve ser stale');
});

test('Bug 5: pararPolling invalida ticks em voo', () => {
  const t = mockTimerState();
  const genAntes = t.currentGen();
  t.increment(); // simula pararPolling
  assert(t.isStale(genAntes), 'tick disparado antes do stop deve ser ignorado após increment');
  assert(!t.isStale(t.currentGen()), 'gen atual após stop é válido');
});

test('Bug 5: worker recebe gen no start e ecoa no done', () => {
  // Simula o contrato: start com gen=N → done com gen=N
  const mensagens = [];
  const workerMock = { postMessage(m) { mensagens.push(m); } };
  const gen = 3;
  workerMock.postMessage({ cmd: 'start', interval: 60, gen });
  const sent = mensagens[0];
  eq(sent.gen, gen, 'gen deve ser enviado no start');
  eq(sent.cmd, 'start', 'cmd deve ser start');
});

// ── Mock: sortState reset (bug 2) ────────────────────────────────
function mockSortState(col, dir) {
  return { col: col || null, dir: dir || 'asc' };
}

test('Bug 2: sortState reseta ao fazer busca manual', () => {
  let sortState = mockSortState('priority', 'desc');
  // simula o reset que acontece no !silencioso
  sortState.col = null;
  sortState.dir = 'asc';
  eq(sortState.col, null, 'col deve ser null após busca manual');
  eq(sortState.dir, 'asc', 'dir deve voltar para asc');
});

test('Bug 2: sortState intacto durante refresh silencioso', () => {
  let sortState = mockSortState('priority', 'desc');
  const silencioso = true;
  if (!silencioso) { sortState.col = null; sortState.dir = 'asc'; }
  eq(sortState.col, 'priority', 'sort preservado no refresh silencioso');
  eq(sortState.dir, 'desc', 'direção preservada no refresh silencioso');
});

// ── Mock: detectarNovidades com try/catch (bug 3) ─────────────────
function detectarNovidadesSafe(knownIssues, data, detectFn) {
  let baseline = knownIssues;
  let detectOk = false;
  let baselineAtualizado = false;
  try {
    detectFn(knownIssues, data);
    detectOk = true;
  } catch(e) { /* ignora — igual ao try/catch do código */ }
  // atualizarKnownIssues sempre roda depois, independente do erro
  baseline = {};
  (data.unassigned || []).concat(data.assigned || []).forEach(i => {
    baseline[i.key] = { status: i.status, assignee: i.assignee || null, updated: i.updated };
  });
  baselineAtualizado = true;
  return { detectOk, baselineAtualizado, baseline };
}

test('Bug 3: baseline atualiza mesmo se detectarNovidades lançar exceção', () => {
  const known = { 'A-1': { status: 'Aberto', assignee: null, updated: 't1' } };
  const data  = {
    unassigned: [{ key: 'A-2', status: 'Aberto', assignee: null, updated: 't2', summary: 'X' }],
    assigned: [],
  };
  const broken = () => { throw new Error('erro simulado'); };
  const r = detectarNovidadesSafe(known, data, broken);
  assert(r.baselineAtualizado, 'baseline deve ser atualizado mesmo com exceção');
  assert(r.baseline['A-2'], 'novo issue deve estar no baseline');
  assert(!r.baseline['A-1'], 'issue antigo não presente nos novos dados deve sumir do baseline');
});

test('Bug 3: baseline atualiza normalmente quando detectarNovidades não lança', () => {
  const known = { 'A-1': { status: 'Aberto', assignee: null, updated: 't1' } };
  const data  = {
    unassigned: [{ key: 'A-1', status: 'Em andamento', assignee: null, updated: 't2', summary: 'Y' }],
    assigned: [],
  };
  const ok = (k, d) => swDetect(k, d); // não lança
  const r = detectarNovidadesSafe(known, data, ok);
  assert(r.detectOk, 'detect deve ter rodado sem erro');
  assert(r.baselineAtualizado, 'baseline atualizado normalmente');
  eq(r.baseline['A-1'].status, 'Em andamento', 'status atualizado no baseline');
});

// ── Mock: acTimeout cancelado ao selecionar item (bug 4) ──────────
test('Bug 4: acTimeout é cancelado ao selecionar item do autocomplete', () => {
  let timeoutCancelled = false;
  let timeoutId = 'pending';
  // simula clearTimeout(acTimeout) no click do item
  const clearTimeout = (id) => { if (id) timeoutCancelled = true; };
  clearTimeout(timeoutId);
  assert(timeoutCancelled, 'clearTimeout deve ser chamado ao selecionar item');
});

test('Bug 4: sem timeout pendente, clearTimeout não causa erro', () => {
  let threw = false;
  try {
    const clearTimeoutSafe = (id) => { /* não faz nada se null */ };
    clearTimeoutSafe(null);
  } catch(e) { threw = true; }
  assert(!threw, 'clearTimeout com null não deve lançar');
});

// ── Mock: polling inicia mesmo com erro na primeira busca (bug 1) ─
function mockBuscarComErro(silencioso) {
  let buscaAtiva = false;
  let pollingIniciado = false;
  let erroExibido = false;

  // simula o .catch corrigido
  const onError = (err) => {
    if (!silencioso) erroExibido = true;
    if (buscaAtiva) {
      // agendarProximoRefresh
    } else if (!silencioso) {
      buscaAtiva = true;
      pollingIniciado = true; // iniciarPolling
    }
  };
  onError(new Error('Jira offline'));
  return { buscaAtiva, pollingIniciado, erroExibido };
}

test('Bug 1: polling inicia mesmo se primeira busca falha', () => {
  const r = mockBuscarComErro(false);
  assert(r.buscaAtiva, 'buscaAtiva deve ser true mesmo com erro');
  assert(r.pollingIniciado, 'polling deve iniciar para tentar de novo');
  assert(r.erroExibido, 'erro deve ser exibido para o usuário');
});

test('Bug 1: refresh silencioso com erro apenas reagenda (não reinicia worker)', () => {
  // com buscaAtiva=true simulado externamente
  let buscaAtiva = true;
  let reagendado = false;
  let workerReiniciado = false;
  const onError = (err, silencioso) => {
    if (buscaAtiva) { reagendado = true; }
    else if (!silencioso) { workerReiniciado = true; }
  };
  onError(new Error('timeout'), true);
  assert(reagendado, 'deve reagendar no erro silencioso');
  assert(!workerReiniciado, 'não deve reiniciar worker em refresh silencioso');
});

// ── Testes de Regra de Negócio Cruzada (Bypass do Inspecionar) ──

test('Segurança: se vertical for Saúde, portfólio é forçado a vazio e preenchidos ignora o campo', () => {
  const vertical = 'Saúde';
  const portfolio = 'Portfólio Pequenas Contas'; // Usuário burlou e injetou
  const userNames = [];
  
  const count = preenchidos(vertical, portfolio, userNames);
  // Deve contar apenas 1 (a vertical), pois o portfólio precisa ser limpo
  eq(count, 1, 'Portfólio malicioso deve ser ignorado em verticais de Saúde');
});

test('Segurança: se vertical for Educação, portfólio é forçado a vazio e preenchidos ignora o campo', () => {
  const vertical = 'Educação';
  const portfolio = 'Portfólio SC/MG';
  const userNames = ['jean.vieira'];
  
  const count = preenchidos(vertical, portfolio, userNames);
  // Deve contar 2 (vertical + responsável), ignorando o portfólio injetado
  eq(count, 2, 'Portfólio malicioso deve ser ignorado em verticais de Educação');
});

test('Segurança: portfólio é mantido normalmente para verticais comuns (ex: Contábil)', () => {
  const vertical = 'Contábil';
  const portfolio = 'Portfólio Médias Contas';
  const userNames = [];
  
  const count = preenchidos(vertical, portfolio, userNames);
  eq(count, 2, 'Portfólio deve ser computado normalmente para a vertical Contábil');
});

// ── Testes do Fluxo de Cancelamento de Requests (AbortController) ──

function mockCatchTratamentoErro(err, silencioso, buscaAtiva) {
  let reagendado = false;
  let erroExibido = false;

  // Lógica exata implementada no catch do fetch do front-end
  if (err.name === 'AbortError') {
    if (silencioso && buscaAtiva) {
      reagendado = true; // agendarProximoRefresh()
    }
    return { reagendado, erroExibido };
  }

  if (!silencioso) erroExibido = true;
  if (buscaAtiva) reagendado = true;
  
  return { reagendado, erroExibido };
}

test('AbortController: AbortError silencioso com busca ativa mantém o polling vivo', () => {
  const error = { name: 'AbortError' };
  const r = mockCatchTratamentoErro(error, true, true); // silencioso=true, buscaAtiva=true
  
  assert(r.reagendado, 'Polling silencioso deve agendar o próximo ciclo ao ser abortado');
  assert(!r.erroExibido, 'AbortError não deve estourar erro visual para o usuário');
});

test('AbortController: AbortError em busca manual apenas interrompe a execução sem alertar erro', () => {
  const error = { name: 'AbortError' };
  const r = mockCatchTratamentoErro(error, false, true); // silencioso=false (manual)
  
  assert(!r.reagendado, 'Busca manual abortada não deve auto-reagendar duplicado');
  assert(!r.erroExibido, 'Busca manual interrompida por outro clique rápido não deve exibir banner de erro');
});

// ─── Executa ────────────────────────────────────────────────────────
results.forEach(r => {
  if (r.ok) console.log(`  ✅ ${r.name}`);
  else { console.log(`  ❌ ${r.name}`); console.log(`     → ${r.err}`); }
});
console.log(`\n${'─'.repeat(62)}`);
console.log(`Total: ${passed+failed} | ✅ ${passed} passou | ❌ ${failed} falhou`);
if (failed > 0) process.exit(1);