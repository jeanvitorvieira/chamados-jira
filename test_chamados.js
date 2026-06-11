/**
 * Suite de testes v3 — atualizada para refletir o estado atual do código.
 *
 * Mudanças em relação à v2:
 * - dedup agora usa emailAddress || name como chave (usuarios.js retorna email como name)
 * - buildParams não envia typeIds quando todos os tipos estão selecionados
 * - preenchidos() inclui o filtro de equipe
 * - statusCat usa .key (minúsculo: 'done', 'new', 'indeterminate')
 * - removido teste de bug <\div> (corrigido)
 * - removido teste de dead code perm no SW (sw.js reescrito)
 * - renderUserTags usa addEventListener em vez de onclick inline
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

// ── buildParams — replica lógica atual da função buscar() ────────
// Inclui: equipe, lógica de typeIds (não envia se todos selecionados)
function buildParams(config) {
  const params = new URLSearchParams();
  if (config.vertical)           params.set('vertical',  config.vertical);
  if (config.portfolio)          params.set('portfolio', config.portfolio);
  if (config.equipe)             params.set('cf[21500]', config.equipe);
  if (config.users)              params.set('users',     config.users);
  if (config.days && config.days !== '0') params.set('days', config.days);

  // Só envia typeIds se houver seleção PARCIAL
  const arrTypeKeys = config.typeIds ? config.typeIds.split(',').filter(Boolean) : [];
  const totalDisponivel = config.totalTiposDisponiveis || 0;
  const todosSelecionados = arrTypeKeys.length >= totalDisponivel && totalDisponivel > 0;
  if (arrTypeKeys.length > 0 && !todosSelecionados) {
    params.set('typeIds', arrTypeKeys.join(','));
  }

  return params.toString();
}

// ── preenchidos — replica lógica atual (inclui equipe) ───────────
function preenchidos(vertical, portfolio, equipe, userNames) {
  let safePortfolio = portfolio;
  const vLower = (vertical || '').toLowerCase();
  if (vLower === 'saúde' || vLower === 'educação') {
    safePortfolio = '';
  }
  return [vertical, safePortfolio, equipe, userNames.length ? '1' : ''].filter(Boolean).length;
}

// ── dedup — replica lógica atual do frontend (usa email como name) 
// usuarios.js agora retorna: name = emailAddress || name
function dedup(apiUsers, selectedUsers) {
  const sNames = {}; const sEmails = {};
  return apiUsers.filter(u => {
    const nk = (u.name  || '').toLowerCase(); // agora pode ser o email
    const ek = (u.email || '').toLowerCase();
    if (sNames[nk])              return false;
    if (ek && sEmails[ek])       return false;
    sNames[nk] = true;
    if (ek) sEmails[ek] = true;
    return !selectedUsers.some(s =>
      (s.name  || '').toLowerCase() === nk ||
      (ek && (s.email || '').toLowerCase() === ek));
  });
}

// ── mapIssue — replica lógica atual (statusCat usa .key) ─────────
function mapIssue(raw) {
  const f = raw.fields;
  return {
    key:       raw.key,
    status:    f.status?.name ?? '—',
    statusCat: f.status?.statusCategory?.key ?? '',  // .key → 'done' | 'new' | 'indeterminate'
    assignee:  f.assignee?.displayName ?? null,
  };
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
    unassigned: [{ key:'A-1', status:'Aberto',      assignee:null,   updated:'t1', summary:'X' }],
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

test('SW: ticket sem responsável inalterado NÃO dispara', () => {
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
  const known2 = { 'X-1': { status:'Aberto', assignee:null, updated:'t0' } };
  const r = swDetect(known2, {
    unassigned: [
      { key:'X-1', status:'Aberto', assignee:null, updated:'t0', summary:'X' },
      { key:'A-2', status:'Aberto', assignee:null, updated:'t1', summary:'Novo' },
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
    'B-1': { status:'Aberto', assignee:'Jean',  updated:'t1' },
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
    'B-1': { status:'Aberto', assignee:'Jean',  updated:'t1' },
    'B-2': { status:'Aberto', assignee:'Maria', updated:'t1' },
  };
  const r = swDetect(known, {
    unassigned: [], assigned: [{ key:'B-1', status:'Aberto', assignee:'Jean', updated:'t1', summary:'X' }],
    totalAssigned: 5
  });
  eq(r.desap.length, 0);
});

test('SW: unassigned não conta como desaparecido', () => {
  const known = {
    'A-1': { status:'Aberto', assignee:null,   updated:'t1' },
    'B-1': { status:'Aberto', assignee:'Jean', updated:'t1' },
  };
  const r = swDetect(known, {
    unassigned: [], assigned: [{ key:'B-1', status:'Aberto', assignee:'Jean', updated:'t1', summary:'X' }],
    totalAssigned: 1
  });
  assert(!r.desap.includes('A-1'), 'unassigned não deve aparecer em desap');
});

test('SW: multiple detections não se sobrepõem', () => {
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
  assert(!r.status.some(i => i.key === 'B-9'), 'ticket novo em assigned não dispara status');
});

test('SW: knownIssues passado pela página é usado como baseline correto', () => {
  const pageKnown = {
    'A-1': { status:'Aberto',       assignee:null,   updated:'t1' },
    'B-1': { status:'Em andamento', assignee:'Jean', updated:'t1' },
  };
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
// TESTES — buildParams (inclui equipe + lógica typeIds atualizada)
// ═══════════════════════════════════════════════════════════════════

test('buildParams: todos os campos enviados corretamente', () => {
  const p = buildParams({
    vertical: 'Contábil',
    portfolio: 'Portfólio Pequenas Contas',
    equipe: 'Suporte',
    users: 'jean.vieira@betha.com.br,marlon@betha.com.br',
    typeIds: '10001',
    totalTiposDisponiveis: 10,
    days: '30'
  });
  assert(p.includes('vertical=Cont%C3%A1bil'), 'vertical codificado');
  assert(p.includes('portfolio='), 'portfolio presente');
  assert(p.includes('cf%5B21500%5D=Suporte') || p.includes('cf[21500]=Suporte'), 'equipe presente');
  assert(p.includes('users='), 'users presente');
  assert(p.includes('typeIds=10001'), 'typeIds parcial enviado');
  assert(p.includes('days=30'), 'days presente');
});

test('buildParams: days="0" não é enviado', () => {
  const p = buildParams({ vertical:'Contábil', portfolio:'P', days:'0', totalTiposDisponiveis: 0 });
  assert(!p.includes('days'), 'days=0 não deve ser enviado');
});

test('buildParams: days="30" é enviado', () => {
  const p = buildParams({ vertical:'Contábil', portfolio:'P', days:'30', totalTiposDisponiveis: 0 });
  assert(p.includes('days=30'), 'days=30 deve ser enviado');
});

test('buildParams: users vazio não é enviado', () => {
  const p = buildParams({ vertical:'Contábil', portfolio:'P', users:'', totalTiposDisponiveis: 0 });
  assert(!p.includes('users'), 'users vazio não deve ser enviado');
});

test('buildParams: typeIds NÃO enviado quando todos selecionados', () => {
  // 3 tipos disponíveis, 3 selecionados → todos → não envia
  const p = buildParams({
    vertical: 'Contábil', portfolio: 'P',
    typeIds: '10001,10002,10003',
    totalTiposDisponiveis: 3
  });
  assert(!p.includes('typeIds'), 'typeIds não deve ser enviado quando todos selecionados');
});

test('buildParams: typeIds NÃO enviado quando nenhum selecionado', () => {
  const p = buildParams({
    vertical: 'Contábil', portfolio: 'P',
    typeIds: '',
    totalTiposDisponiveis: 10
  });
  assert(!p.includes('typeIds'), 'typeIds não deve ser enviado quando vazio');
});

test('buildParams: typeIds enviado quando seleção é parcial', () => {
  // 2 de 10 selecionados → parcial → envia
  const p = buildParams({
    vertical: 'Contábil', portfolio: 'P',
    typeIds: '10001,10002',
    totalTiposDisponiveis: 10
  });
  assert(p.includes('typeIds=10001%2C10002') || p.includes('typeIds=10001,10002'), 'typeIds parcial deve ser enviado');
});

test('buildParams: equipe não enviada quando vazia', () => {
  const p = buildParams({ vertical:'Contábil', portfolio:'P', equipe:'', totalTiposDisponiveis: 0 });
  assert(!p.includes('cf%5B21500%5D') && !p.includes('cf[21500]'), 'equipe vazia não deve ser enviada');
});

// ═══════════════════════════════════════════════════════════════════
// TESTES — preenchidos() (agora inclui equipe)
// ═══════════════════════════════════════════════════════════════════

test('preenchidos: vertical + portfolio = 2', () => {
  eq(preenchidos('Contábil', 'Portfólio Pequenas Contas', '', []), 2);
});

test('preenchidos: vertical + equipe = 2', () => {
  eq(preenchidos('Arrecadação', '', 'Suporte', []), 2);
});

test('preenchidos: vertical + responsável = 2', () => {
  eq(preenchidos('Contábil', '', '', ['jean.vieira@betha.com.br']), 2);
});

test('preenchidos: portfolio + equipe = 2', () => {
  eq(preenchidos('', 'Portfólio Pequenas Contas', 'Suporte', []), 2);
});

test('preenchidos: só vertical = 1 (insuficiente)', () => {
  eq(preenchidos('Contábil', '', '', []), 1);
});

test('Segurança: Saúde força portfólio vazio, conta apenas 1 sem responsável', () => {
  eq(preenchidos('Saúde', 'Portfólio Pequenas Contas', '', []), 1);
});

test('Segurança: Educação força portfólio vazio, com responsável conta 2', () => {
  eq(preenchidos('Educação', 'Portfólio SC/MG', '', ['filipe.andrade@betha.com.br']), 2);
});

test('Segurança: Saúde com equipe conta 2 (vertical + equipe)', () => {
  eq(preenchidos('Saúde', 'Portfólio Pequenas Contas', 'Suporte', []), 2);
});

test('preenchidos: vertical + portfolio + equipe + responsável = 4', () => {
  eq(preenchidos('Contábil', 'Portfólio Pequenas Contas', 'Suporte', ['jean@betha.com.br']), 4);
});

// ═══════════════════════════════════════════════════════════════════
// TESTES — statusCat usa .key (minúsculo)
// ═══════════════════════════════════════════════════════════════════

test('mapIssue: statusCat retorna key minúsculo "done"', () => {
  const raw = {
    key: 'BTHSC-001',
    fields: {
      status: {
        name: 'Resolvido',
        statusCategory: { key: 'done', name: 'Done' }
      },
      assignee: { displayName: 'Jean' }
    }
  };
  const issue = mapIssue(raw);
  eq(issue.statusCat, 'done', 'statusCat deve ser "done" (key), não "Done" (name)');
});

test('mapIssue: statusCat "new" para chamados em aberto', () => {
  const raw = {
    key: 'BTHSC-002',
    fields: {
      status: {
        name: 'Aberto',
        statusCategory: { key: 'new', name: 'To Do' }
      },
      assignee: null
    }
  };
  const issue = mapIssue(raw);
  eq(issue.statusCat, 'new');
  eq(issue.assignee, null);
});

test('mapIssue: statusCat "indeterminate" para em andamento', () => {
  const raw = {
    key: 'BTHSC-003',
    fields: {
      status: {
        name: 'Em andamento',
        statusCategory: { key: 'indeterminate', name: 'In Progress' }
      },
      assignee: { displayName: 'Filipe Andrade' }
    }
  };
  const issue = mapIssue(raw);
  eq(issue.statusCat, 'indeterminate');
});

test('detectarNovidades: usa statusCat "done" (key) para detectar encerrados', () => {
  // Simula o filtro do frontend em detectarNovidades
  const issues = [
    { key: 'B-1', statusCat: 'done',          status: 'Resolvido' },
    { key: 'B-2', statusCat: 'indeterminate', status: 'Em andamento' },
    { key: 'B-3', statusCat: 'new',           status: 'Aberto' },
  ];
  const encerrados = issues.filter(i => i.statusCat === 'done');
  eq(encerrados.length, 1);
  eq(encerrados[0].key, 'B-1');
});

// ═══════════════════════════════════════════════════════════════════
// TESTES — dedup autocomplete (name agora é emailAddress)
// ═══════════════════════════════════════════════════════════════════

test('Dedup: duplicata por email removida (name é email no estado atual)', () => {
  // usuarios.js retorna name = emailAddress || name
  // Então dois registros com mesmo email são deduplicados
  const api = [
    { name:'marlon.ern@betha.com.br', email:'marlon.ern@betha.com.br', displayName:'Marlon Henrique Ern' },
    { name:'marlon.ern@betha.com.br', email:'marlon.ern@betha.com.br', displayName:'Marlon Henrique Ern' },
  ];
  const r = dedup(api, []);
  eq(r.length, 1);
});

test('Dedup: usuário selecionado por email é excluído do autocomplete', () => {
  const api = [{ name:'filipe.andrade@betha.com.br', email:'filipe.andrade@betha.com.br', displayName:'Filipe Pereira Andrade' }];
  const sel = [{ name:'filipe.andrade@betha.com.br', email:'filipe.andrade@betha.com.br' }];
  const r = dedup(api, sel);
  eq(r.length, 0, 'usuário já selecionado não deve aparecer no autocomplete');
});

test('Dedup: usuário diferente com email diferente mantido', () => {
  const api = [
    { name:'jean.vieira@betha.com.br',   email:'jean.vieira@betha.com.br',   displayName:'Jean' },
    { name:'marlon.ern@betha.com.br',    email:'marlon.ern@betha.com.br',    displayName:'Marlon' },
  ];
  const sel = [{ name:'jean.vieira@betha.com.br', email:'jean.vieira@betha.com.br' }];
  const r = dedup(api, sel);
  eq(r.length, 1); eq(r[0].name, 'marlon.ern@betha.com.br');
});

test('Dedup: usuário sem email usa name como fallback', () => {
  const api = [
    { name:'usuario-interno', email:'', displayName:'Usuário Interno' },
  ];
  const sel = [];
  const r = dedup(api, sel);
  eq(r.length, 1, 'usuário sem email deve aparecer usando name como chave');
});

test('Dedup: JQL usa email como assignee (name = email)', () => {
  // Garante que o name salvo em selectedUsers é o email,
  // que é o que vai para users= na query string e para assignee no JQL
  const rawUser = { name: 'filipe.andrade', emailAddress: 'filipe.andrade@betha.com.br', displayName: 'Filipe Pereira Andrade' };
  // Simula o mapeamento de usuarios.js
  const mapped = {
    name:        rawUser.emailAddress || rawUser.name,
    displayName: rawUser.displayName,
    email:       rawUser.emailAddress,
  };
  eq(mapped.name, 'filipe.andrade@betha.com.br', 'name deve ser o email para uso no JQL');
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
  const sw = swDetect(known, data);
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
// TESTES — edge cases visibilitychange
// ═══════════════════════════════════════════════════════════════════

test('visibilitychange hidden: sem buscaAtiva não envia START_POLLING', () => {
  let sent = false;
  const buscaAtiva = false;
  if (buscaAtiva) sent = true;
  assert(!sent, 'não deve enviar START_POLLING sem busca ativa');
});

test('visibilitychange visible: detectarNovidades com baseline vazio retorna sem processar', () => {
  const knownIssues = {};
  let processou = false;
  if (Object.keys(knownIssues).length === 0) {
    // guard — retorna imediatamente
  } else {
    processou = true;
  }
  assert(!processou, 'não deve processar com baseline vazio');
});

// ═══════════════════════════════════════════════════════════════════
// TESTES — timer generation (AbortController + polling)
// ═══════════════════════════════════════════════════════════════════

function mockTimerState() {
  let generation = 0;
  const msgs = [];
  const worker = { postMessage(msg) { msgs.push(msg); } };
  return {
    worker, msgs,
    increment() { generation++; },
    currentGen() { return generation; },
    isStale(gen) { return gen !== generation; },
  };
}

test('Timer: tick com gen antigo é descartado', () => {
  const t = mockTimerState();
  t.increment();
  const staleGen = t.currentGen() - 1;
  assert(t.isStale(staleGen), 'gen antigo deve ser stale');
});

test('Timer: tick com gen atual é aceito', () => {
  const t = mockTimerState();
  const gen = t.currentGen();
  assert(!t.isStale(gen), 'gen atual não deve ser stale');
});

test('Timer: pararPolling invalida ticks em voo', () => {
  const t = mockTimerState();
  const genAntes = t.currentGen();
  t.increment();
  assert(t.isStale(genAntes), 'tick disparado antes do stop deve ser ignorado');
  assert(!t.isStale(t.currentGen()), 'gen atual após stop é válido');
});

test('Timer: worker recebe gen no start', () => {
  const msgs = [];
  const worker = { postMessage(m) { msgs.push(m); } };
  worker.postMessage({ cmd: 'start', interval: 60, gen: 3 });
  eq(msgs[0].gen, 3);
  eq(msgs[0].cmd, 'start');
});

// ═══════════════════════════════════════════════════════════════════
// TESTES — sortState
// ═══════════════════════════════════════════════════════════════════

test('sortState: reseta ao fazer busca manual', () => {
  let sortState = { col: 'priority', dir: 'desc' };
  // simula !silencioso
  sortState.col = null; sortState.dir = 'asc';
  eq(sortState.col, null);
  eq(sortState.dir, 'asc');
});

test('sortState: preservado durante refresh silencioso', () => {
  let sortState = { col: 'priority', dir: 'desc' };
  const silencioso = true;
  if (!silencioso) { sortState.col = null; sortState.dir = 'asc'; }
  eq(sortState.col, 'priority');
  eq(sortState.dir, 'desc');
});

// ═══════════════════════════════════════════════════════════════════
// TESTES — baseline resiliente a erros em detectarNovidades
// ═══════════════════════════════════════════════════════════════════

function detectarNovidadesSafe(knownIssues, data, detectFn) {
  let detectOk = false;
  let baseline = {};
  try {
    detectFn(knownIssues, data);
    detectOk = true;
  } catch(e) { /* ignora */ }
  (data.unassigned || []).concat(data.assigned || []).forEach(i => {
    baseline[i.key] = { status: i.status, assignee: i.assignee || null, updated: i.updated };
  });
  return { detectOk, baseline };
}

test('baseline atualiza mesmo se detectarNovidades lançar exceção', () => {
  const known = { 'A-1': { status:'Aberto', assignee:null, updated:'t1' } };
  const data  = { unassigned: [{ key:'A-2', status:'Aberto', assignee:null, updated:'t2', summary:'X' }], assigned: [] };
  const r = detectarNovidadesSafe(known, data, () => { throw new Error('erro simulado'); });
  assert(r.baseline['A-2'], 'novo issue deve estar no baseline');
  assert(!r.baseline['A-1'], 'issue antigo não deve persistir');
});

test('baseline atualiza normalmente sem exceção', () => {
  const known = { 'A-1': { status:'Aberto', assignee:null, updated:'t1' } };
  const data  = { unassigned: [{ key:'A-1', status:'Em andamento', assignee:null, updated:'t2', summary:'Y' }], assigned: [] };
  const r = detectarNovidadesSafe(known, data, (k, d) => swDetect(k, d));
  assert(r.detectOk, 'detect deve ter rodado sem erro');
  eq(r.baseline['A-1'].status, 'Em andamento');
});

// ═══════════════════════════════════════════════════════════════════
// TESTES — AbortController
// ═══════════════════════════════════════════════════════════════════

function mockCatch(err, silencioso, buscaAtiva) {
  let reagendado = false;
  let erroExibido = false;
  if (err.name === 'AbortError') {
    if (silencioso && buscaAtiva) reagendado = true;
    return { reagendado, erroExibido };
  }
  if (!silencioso) erroExibido = true;
  if (buscaAtiva) reagendado = true;
  return { reagendado, erroExibido };
}

test('AbortController: AbortError silencioso com busca ativa mantém polling', () => {
  const r = mockCatch({ name:'AbortError' }, true, true);
  assert(r.reagendado, 'deve reagendar');
  assert(!r.erroExibido, 'não deve exibir erro');
});

test('AbortController: AbortError em busca manual não exibe erro', () => {
  const r = mockCatch({ name:'AbortError' }, false, true);
  assert(!r.erroExibido, 'busca manual abortada não exibe banner de erro');
});

test('AbortController: erro real (não abort) exibe mensagem', () => {
  const r = mockCatch({ name:'Error', message:'timeout' }, false, false);
  assert(r.erroExibido, 'erro real deve ser exibido');
});

// ─── Executa ────────────────────────────────────────────────────────
results.forEach(r => {
  if (r.ok) console.log(`  ✅ ${r.name}`);
  else { console.log(`  ❌ ${r.name}`); console.log(`     → ${r.err}`); }
});
console.log(`\n${'─'.repeat(62)}`);
console.log(`Total: ${passed+failed} | ✅ ${passed} passou | ❌ ${failed} falhou`);
if (failed > 0) process.exit(1);
