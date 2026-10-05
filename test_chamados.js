const fs   = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const results = [];

// ─────────────────────────────────────────────────────────────────────────────
// Harness
//
// `test()` agora apenas ENFILEIRA o teste e `main()` (no final do arquivo) os
// executa em sequência, aguardando cada um. Isso permite testes assíncronos
// (handlers da API com Jira simulado) sem quebrar os testes síncronos antigos.
// ─────────────────────────────────────────────────────────────────────────────
const queue = [];
function test(name, fn) { queue.push({ name, fn }); }

function assert(cond, msg)     { if (!cond) throw new Error(msg || 'A asserção falhou'); }
function eq(a, b, msg)         { if (a !== b) throw new Error((msg||'') + ` -> Esperado: ${JSON.stringify(b)} | Obtido: ${JSON.stringify(a)}`); }
function deepEq(a, b, msg)     { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg||'') + `\n  Esperado: ${JSON.stringify(b)}\n  Obtido: ${JSON.stringify(a)}`); }
function noThrow(fn, msg)      { try { fn(); } catch(e) { throw new Error((msg||'') + ': ' + e.message); } }
function throws(fn, msg)       { let ok = false; try { fn(); } catch { ok = true; } if (!ok) throw new Error(msg || 'Deveria ter lançado uma exceção'); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

function buildCurrent(unassigned, assigned) {
  const current = {};
  unassigned.forEach(i => { current[i.key] = { status: i.status, assignee: null, updated: i.updated }; });
  assigned.forEach(i   => { current[i.key] = { status: i.status, assignee: i.assignee, updated: i.updated }; });
  return current;
}

// Espelho de detectarNovidades (index.html).
// MUDANÇA: a truncagem agora vem do backend (`data.truncated`, baseado no total
// REAL do Jira) em vez de `totalAssigned > assigned.length`, que comparava
// contagens já filtradas e nunca refletia a paginação.
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
  const trunc = data.truncated === true;
  const desap = trunc ? [] : Object.keys(known).filter(k => !currentKeys.has(k) && known[k].assignee !== null);

  return { isFirstRun: false, current, novos, status, mov, desap };
}

// Espelho de buscar() (index.html).
// NOVO: buscas manuais (silencioso falso) enviam fresh=1 para furar o cache do
// servidor; o polling silencioso não envia.
function buildParams(config) {
  const params = new URLSearchParams();
  if (config.vertical)                    params.set('vertical',  config.vertical);
  if (config.portfolio)                   params.set('portfolio', config.portfolio);
  if (config.equipe)                      params.set('cf[21500]', config.equipe);
  if (config.users)                       params.set('users',     config.users);
  if (config.days && config.days !== '0') params.set('days',      config.days);

  const arrTypeKeys = config.typeIds ? config.typeIds.split(',').filter(Boolean) : [];
  const totalDisponivel = config.totalTiposDisponiveis || 0;
  const todosSelecionados = arrTypeKeys.length >= totalDisponivel && totalDisponivel > 0;
  
  if (arrTypeKeys.length > 0 && !todosSelecionados) {
    params.set('typeIds', arrTypeKeys.join(','));
  }

  if (!config.silencioso) params.set('fresh', '1');

  return params.toString();
}

function preenchidos(vertical, portfolio, equipe, userNames) {
  let safePortfolio = portfolio;
  const vLower = (vertical || '').toLowerCase();
  if (vLower === 'saúde' || vLower === 'educação') {
    safePortfolio = '';
  }
  return [vertical, safePortfolio, equipe, userNames.length ? '1' : ''].filter(Boolean).length;
}

function dedup(apiUsers, selectedUsers) {
  const sNames = {}; const sEmails = {};
  return apiUsers.filter(u => {
    const nk = (u.name  || '').toLowerCase();
    const ek = (u.email || '').toLowerCase();
    if (sNames[nk])                      return false;
    if (ek && sEmails[ek])               return false;
    sNames[nk] = true;
    if (ek) sEmails[ek] = true;
    return !selectedUsers.some(s =>
      (s.name  || '').toLowerCase() === nk ||
      (ek && (s.email || '').toLowerCase() === ek));
  });
}

function mapIssue(raw) {
  const f = raw.fields;
  return {
    key:       raw.key,
    status:    f.status?.name ?? '—',
    statusCat: f.status?.statusCategory?.key ?? '', 
    assignee:  f.assignee?.displayName ?? null,
    sistema:   f.customfield_10132?.value ?? null, 
  };
}

function validateTypesMock(typesParam) {
  if (!typesParam || !typesParam.trim()) return [];
  return typesParam.split(',')
    .map(t => t.trim())
    .filter(Boolean)
    .slice(0, 150)
    .map(t => t.replace(/\\/g, '\\\\').replace(/"/g, '\\"'));
}

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

function detectarNovidadesSafe(knownIssues, data, detectFn) {
  let detectOk = false;
  let baseline = {};
  try {
    detectFn(knownIssues, data);
    detectOk = true;
  } catch(e) {}
  (data.unassigned || []).concat(data.assigned || []).forEach(i => {
    baseline[i.key] = { status: i.status, assignee: i.assignee || null, updated: i.updated };
  });
  return { detectOk, baseline };
}

// ═════════════════════════════════════════════════════════════════════════════
// TESTES EXISTENTES (lógica espelhada do front)
// ═════════════════════════════════════════════════════════════════════════════

test('SW: baseline vazio na execução inicial -> isFirstRun=true, sem notificações', () => {
  const r = swDetect({}, {
    unassigned: [{ key:'A-1', status:'Aberto', assignee:null, updated:'t1', summary:'X' }],
    assigned: []
  });
  assert(r.isFirstRun, 'Deveria identificar o primeiro ciclo como baseline');
  eq(r.novos.length, 0, 'Não deve alertar sobre chamados existentes na execução inicial');
  eq(r.current['A-1'].assignee, null, 'Deve salvar os chamados atuais');
});

test('SW: baseline inicial preenche o estado current corretamente', () => {
  const r = swDetect({}, {
    unassigned: [{ key:'A-1', status:'Aberto',      assignee:null,   updated:'t1', summary:'X' }],
    assigned:   [{ key:'B-1', status:'Em andamento', assignee:'Jean', updated:'t2', summary:'Y' }],
  });
  eq(r.current['A-1'].assignee, null, 'Jean não deve estar atribuído a A-1');
  eq(r.current['B-1'].assignee, 'Jean', 'Jean deve ser o analista de B-1');
  eq(r.current['B-1'].status, 'Em andamento', 'Status do baseline deve persistir');
});

test('SW: novo chamado sem responsável é devidamente sinalizado', () => {
  const known = { 'A-1': { status:'Aberto', assignee:null, updated:'t1' } };
  const r = swDetect(known, {
    unassigned: [
      { key:'A-1', status:'Aberto', assignee:null, updated:'t1', summary:'X' },
      { key:'A-2', status:'Aberto', assignee:null, updated:'t2', summary:'Novo' },
    ], assigned: []
  });
  eq(r.novos.length, 1, 'Deve detectar exatamente um novo chamado');
  eq(r.novos[0].key, 'A-2', 'O chamado A-2 é o novo chamado sem responsável');
});

test('SW: chamado atribuído que foi devolvido para a fila -> unassigned de volta', () => {
  const known = { 'A-1': { status:'Em andamento', assignee:'Jean', updated:'t1' } };
  const r = swDetect(known, {
    unassigned: [{ key:'A-1', status:'Aberto', assignee:null, updated:'t2', summary:'X' }],
    assigned: []
  });
  eq(r.novos.length, 1, 'Chamados devolvidos para a fila contam como novos unassigned');
  eq(r.novos[0].key, 'A-1', 'A-1 deve acionar alerta de chamado desalocado');
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
  eq(r.status.length, 1, 'Deve disparar mudança de status');
  eq(r.status[0].prevStatus, 'Aberto', 'O status anterior deve ser Aberto');
  eq(r.status[0].status, 'Em andamento', 'O status atualizado deve ser Em andamento');
});

test('SW: status idêntico com updated alterado -> movimentação', () => {
  const known = { 'B-1': { status:'Em andamento', assignee:'Jean', updated:'t1' } };
  const r = swDetect(known, {
    unassigned: [],
    assigned: [{ key:'B-1', status:'Em andamento', assignee:'Jean', updated:'t2', summary:'X' }]
  });
  eq(r.status.length, 0, 'Não deve reportar mudança de status');
  eq(r.mov.length, 1, 'Modificações no ticket contam como movimentação recente');
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

test('SW: desaparecidos detectados quando o resultado não for truncado', () => {
  const known = {
    'B-1': { status:'Aberto', assignee:'Jean',  updated:'t1' },
    'B-2': { status:'Aberto', assignee:'Maria', updated:'t1' },
  };
  const r = swDetect(known, {
    unassigned: [], assigned: [{ key:'B-1', status:'Aberto', assignee:'Jean', updated:'t1', summary:'X' }],
    truncated: false
  });
  eq(r.desap.length, 1); eq(r.desap[0], 'B-2');
});

test('SW: desaparecidos ignorados de forma segura quando a paginação estiver truncada', () => {
  const known = {
    'B-1': { status:'Aberto', assignee:'Jean',  updated:'t1' },
    'B-2': { status:'Aberto', assignee:'Maria', updated:'t1' },
  };
  const r = swDetect(known, {
    unassigned: [], assigned: [{ key:'B-1', status:'Aberto', assignee:'Jean', updated:'t1', summary:'X' }],
    truncated: true
  });
  eq(r.desap.length, 0, 'Para evitar falsos alertas de encerramento, o SW ignora desaparecidos se truncado');
});

test('SW: unassigned não conta como desaparecido', () => {
  const known = {
    'A-1': { status:'Aberto', assignee:null,   updated:'t1' },
    'B-1': { status:'Aberto', assignee:'Jean', updated:'t1' },
  };
  const r = swDetect(known, {
    unassigned: [], assigned: [{ key:'B-1', status:'Aberto', assignee:'Jean', updated:'t1', summary:'X' }],
    truncated: false
  });
  assert(!r.desap.includes('A-1'), 'unassigned não deve aparecer em desap');
});

test('SW: múltiplas detecções não se sobrepõem', () => {
  const known = { 'B-1': { status:'Aberto', assignee:'Jean', updated:'t1' } };
  const data = { unassigned:[], assigned:[{ key:'B-1', status:'Em andamento', assignee:'Jean', updated:'t2', summary:'X' }], truncated:false };
  const r = swDetect(known, data);
  eq(r.status.length, 1, 'deve estar em status');
  eq(r.mov.length, 0, 'não deve estar em mov');
});

test('SW: ticket totalmente novo em assigned não dispara statusAlterado', () => {
  const known = { 'X-1': { status:'Aberto', assignee:null, updated:'t0' } };
  const data = {
    unassigned: [{ key:'X-1', status:'Aberto', assignee:null, updated:'t0', summary:'X' }],
    assigned:   [{ key:'B-9', status:'Aberto', assignee:'Jean', updated:'t1', summary:'Novo atribuído' }],
    truncated: false
  };
  const r = swDetect(known, data);
  assert(!r.status.some(i => i.key === 'B-9'), 'ticket novo in assigned não dispara status');
});

test('SW: knownIssues passado pela página é usado como baseline correto', () => {
  const pageKnown = {
    'A-1': { status:'Aberto',       assignee:null,   updated:'t1' },
    'B-1': { status:'Em andamento', assignee:'Jean', updated:'t1' },
  };
  const r = swDetect(pageKnown, {
    unassigned: [{ key:'A-1', status:'Aberto', assignee:null, updated:'t1', summary:'X' }],
    assigned:   [{ key:'B-1', status:'Aguardando Manutenção', assignee:'Jean', updated:'t2', summary:'Y' }],
    truncated: false
  });
  assert(!r.isFirstRun, 'não deve ser firstRun quando página passa knownIssues');
  eq(r.status.length, 1, 'mudança de status detectada na primeira poll do SW');
  eq(r.status[0].prevStatus, 'Em andamento');
});

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
  assert(p.includes('vertical=Cont%C3%A1bil'), 'A vertical deve vir corretamente codificada');
  assert(p.includes('portfolio='), 'portfolio presente');
  assert(p.includes('cf%5B21500%5D=Suporte') || p.includes('cf[21500]=Suporte'), 'Equipe deve usar a chave literal cf[21500]');
  assert(p.includes('users='), 'users presente');
  assert(p.includes('typeIds=10001'), 'Filtro parcial de typeIds deve ser mantido');
  assert(p.includes('days=30'), 'Período de dias deve constar nos parâmetros');
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

test('buildParams: typeIds OMITIDO se todos os tipos estiverem selecionados (Proteção de URL Gigante)', () => {
  const p = buildParams({
    vertical: 'Contábil',
    portfolio: 'Portfólio SC/MG',
    typeIds: '10001,10002,10003',
    totalTiposDisponiveis: 3
  });
  assert(!p.includes('typeIds'), 'Para evitar estouro de URL (HTTP 414), o typeIds é omitido se todos estiverem marcados');
});

test('buildParams: typeIds NÃO enviado quando nenhum selecionado', () => {
  const p = buildParams({
    vertical: 'Contábil',
    portfolio: 'Portfólio SC/SP',
    typeIds: '',
    totalTiposDisponiveis: 10
  });
  assert(!p.includes('typeIds'), 'typeIds não deve ser enviado quando vazio');
});

test('buildParams: typeIds enviado quando seleção é parcial', () => {
  const p = buildParams({
    vertical: 'Contábil',
    portfolio: 'Portfólio SC/SP',
    typeIds: '10001,10002',
    totalTiposDisponiveis: 10
  });
  assert(p.includes('typeIds=10001%2C10002') || p.includes('typeIds=10001,10002'), 'typeIds parcial deve ser enviado');
});

test('buildParams: equipe não enviada quando vazia', () => {
  const p = buildParams({ vertical:'Contábil', portfolio:'P', equipe:'', totalTiposDisponiveis: 0 });
  assert(!p.includes('cf%5B21500%5D') && !p.includes('cf[21500]'), 'equipe vazia não deve ser enviada');
});

test('buildParams: busca manual envia fresh=1 (fura o cache do servidor)', () => {
  const p = buildParams({ vertical:'Contábil', portfolio:'P', silencioso:false, totalTiposDisponiveis: 0 });
  assert(p.includes('fresh=1'), 'busca manual deve pedir dado fresco');
});

test('buildParams: polling silencioso NÃO envia fresh (aproveita o cache)', () => {
  const p = buildParams({ vertical:'Contábil', portfolio:'P', silencioso:true, totalTiposDisponiveis: 0 });
  assert(!p.includes('fresh'), 'polling automático deve aproveitar o cache do servidor');
});

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

test('preenchidos: vertical + portfolio + equipe + responsável = 4', () => {
  eq(preenchidos('Contábil', 'Portfólio Pequenas Contas', 'Suporte', ['jean.vieira@betha.com.br']), 4);
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

test('mapIssue: mapeamento da nova coluna de Sistema cf[10132]', () => {
  const raw = {
    key: 'BTHSC-999',
    fields: {
      status: { name: 'Aberto', statusCategory: { key: 'new', name: 'To Do' } },
      assignee: null,
      customfield_10132: { value: 'Contabilidade Cloud' }
    }
  };
  const mapped = mapIssue(raw);
  eq(mapped.sistema, 'Contabilidade Cloud', 'O campo cf[10132] deve ser extraído e mapeado para a propriedade sistema');
});

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
  const issues = [
    { key: 'B-1', statusCat: 'done',           status: 'Resolvido' },
    { key: 'B-2', statusCat: 'indeterminate', status: 'Em andamento' },
    { key: 'B-3', statusCat: 'new',            status: 'Aberto' },
  ];
  const encerrados = issues.filter(i => i.statusCat === 'done');
  eq(encerrados.length, 1);
  eq(encerrados[0].key, 'B-1');
});

test('Dedup: duplicado por e-mail removido (name é e-mail no estado atual)', () => {
  const api = [
    { name:'marlon.ern@betha.com.br', email:'marlon.ern@betha.com.br', displayName:'Marlon Henrique Ern' },
    { name:'marlon.ern@betha.com.br', email:'marlon.ern@betha.com.br', displayName:'Marlon Henrique Ern' },
  ];
  const r = dedup(api, []);
  eq(r.length, 1);
});

test('Dedup: usuário selecionado por e-mail é excluído do autocomplete', () => {
  const api = [{ name:'filipe.andrade@betha.com.br', email:'filipe.andrade@betha.com.br', displayName:'Filipe Pereira Andrade' }];
  const sel = [{ name:'filipe.andrade@betha.com.br', email:'filipe.andrade@betha.com.br' }];
  const r = dedup(api, sel);
  eq(r.length, 0, 'usuário já selecionado não deve aparecer no autocomplete');
});

test('Dedup: usuário diferente com e-mail diferente mantido', () => {
  const api = [
    { name:'jean.vieira@betha.com.br',   email:'jean.vieira@betha.com.br',   displayName:'Jean' },
    { name:'marlon.ern@betha.com.br',    email:'marlon.ern@betha.com.br',    displayName:'Marlon' },
  ];
  const sel = [{ name:'jean.vieira@betha.com.br', email:'jean.vieira@betha.com.br' }];
  const r = dedup(api, sel);
  eq(r.length, 1); eq(r[0].name, 'marlon.ern@betha.com.br');
});

test('Dedup: usuário sem e-mail usa name como fallback', () => {
  const api = [
    { name:'usuario-interno', email:'', displayName:'Usuário Interno' },
  ];
  const sel = [];
  const r = dedup(api, sel);
  eq(r.length, 1, 'usuário sem email deve aparecer usando name como chave');
});

test('Dedup: JQL usa e-mail como assignee (name = e-mail)', () => {
  const rawUser = { name: 'filipe.andrade', emailAddress: 'filipe.andrade@betha.com.br', displayName: 'Filipe Pereira Andrade' };
  const mapped = {
    name:        rawUser.emailAddress || rawUser.name,
    displayName: rawUser.displayName,
    email:       rawUser.emailAddress,
  };
  eq(mapped.name, 'filipe.andrade@betha.com.br', 'name deve ser o email para uso no JQL');
});

test('Consistência: página e SW detectam novosUnassigned da mesma forma', () => {
  const known = { 'A-1': { status:'Aberto', assignee:null, updated:'t1' } };
  const data = {
    unassigned: [
      { key:'A-1', status:'Aberto', assignee:null, updated:'t1', summary:'X' },
      { key:'A-2', status:'Aberto', assignee:null, updated:'t2', summary:'Y' },
    ],
    assigned: [], truncated: false
  };
  const sw = swDetect(known, data);
  const pageNovos = data.unassigned.filter(i => {
    const prev = known[i.key];
    return !prev || prev.assignee !== null;
  });
  deepEq(sw.novos.map(i=>i.key), pageNovos.map(i=>i.key), 'SW e página devem concordar em novosUnassigned');
});

test('Consistência: página e SW detectam statusAlterado da mesma forma', () => {
  const known = { 'B-1': { status:'Aberto', assignee:'Jean', updated:'t1' } };
  const data = {
    unassigned: [],
    assigned: [{ key:'B-1', status:'Em andamento', assignee:'Jean', updated:'t2', summary:'X' }],
    truncated: false
  };
  const sw = swDetect(known, data);
  const pageStatus = data.assigned.filter(i => { const p=known[i.key]; return p && p.status !== i.status; });
  eq(sw.status.length, pageStatus.length);
  eq(sw.status[0]?.key, pageStatus[0]?.key);
});

test('Consistência: página e SW detectam movimentados da mesma forma', () => {
  const known = { 'B-1': { status:'Em andamento', assignee:'Jean', updated:'t1' } };
  const data = {
    unassigned: [],
    assigned: [{ key:'B-1', status:'Em andamento', assignee:'Jean', updated:'t2', summary:'X' }],
    truncated: false
  };
  const sw = swDetect(known, data);
  eq(sw.mov.length, 1); eq(sw.mov[0].key, 'B-1');
});

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
  } else {
    processou = true;
  }
  assert(!processou, 'não deve processar com baseline vazio');
});

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

test('sortState: limpa ao fazer busca manual', () => {
  let sortState = { col: 'priority', dir: 'desc' };
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

test('Filtragem em memória: tipos excluídos indesejados são expurgados com sucesso', () => {
  const rawIssues = [
    { key: 'CH-1', fields: { status: { name: 'Aberto' }, issuetype: { name: 'Incidente' } } },
    { key: 'CH-2', fields: { status: { name: 'Aberto' }, issuetype: { name: 'Sub-tarefa' } } },
  ];
  
  const NOMES_TIPOS_EXCLUIDOS = ['Sub-tarefa', 'Ação (sub-tarefa)'];
  
  const filtrados = rawIssues
    .map(i => ({ key: i.key, type: i.fields.issuetype.name }))
    .filter(i => !NOMES_TIPOS_EXCLUIDOS.includes(i.type));

  eq(filtrados.length, 1, 'Apenas o chamado legítimo deve ser retornado');
  eq(filtrados[0].key, 'CH-1', 'O tipo indesejado Sub-tarefa deve ser expurgado com segurança');
});

test('Filtro de Tipos: validação permite até 150 tipos (Prevenção do bug do corte alfabético)', () => {
  const muitosTipos = Array.from({ length: 160 }, (_, i) => `Tipo${i}`).join(',');
  const resultado = validateTypesMock(muitosTipos);
  
  eq(resultado.length, 150, 'A validação deve limitar e processar no máximo 150 tipos (antigo limite de 50)');
  eq(resultado[0], 'Tipo0', 'O primeiro tipo deve ser o Tipo0');
  eq(resultado[149], 'Tipo149', 'O 150º tipo deve ser mantido antes do corte limítrofe');
});

test('SW: filtro de prestação de contas ativo NÃO suprime desaparecidos (regressão)', () => {
  // Antes: truncagem era inferida por totalAssigned > assigned.length, o que ficava
  // verdadeiro sempre que o filtro de prestação de contas escondia itens, e os
  // chamados encerrados deixavam de ser detectados. Agora só `truncated` conta.
  const known = {
    'B-1': { status:'Aberto', assignee:'Jean',  updated:'t1' },
    'B-2': { status:'Aberto', assignee:'Maria', updated:'t1' },
  };
  const r = swDetect(known, {
    unassigned: [],
    assigned: [{ key:'B-1', status:'Aberto', assignee:'Jean', updated:'t1', summary:'X' }],
    totalAssigned: 5, prestacaoContasAtivo: true, truncated: false
  });
  eq(r.desap.length, 1, 'sem truncagem real, o chamado sumido deve ser detectado');
  eq(r.desap[0], 'B-2');
});

test('SW: truncagem só na lista sem responsável também suprime desaparecidos', () => {
  // Um chamado atribuído pode ter voltado para a fila e ficado fora do limite da
  // lista sem responsável: não dá para afirmar que foi encerrado.
  const known = { 'B-2': { status:'Aberto', assignee:'Maria', updated:'t1' } };
  const r = swDetect(known, {
    unassigned: [], assigned: [],
    truncatedUnassigned: true, truncatedAssigned: false, truncated: true
  });
  eq(r.desap.length, 0);
});

// ═════════════════════════════════════════════════════════════════════════════
// NOVOS TESTES — Backend REAL (api/chamados.js + api/_lib/jira.js)
//
// Aqui NÃO há espelhos: o handler verdadeiro roda contra um Jira simulado
// (global.fetch substituído). Assim os testes quebram se o código de produção
// quebrar. Cada teste recarrega os módulos (loadHandler) para zerar os caches
// em memória (cache de consultas e cache de tipos) e não haver vazamento de
// estado entre testes.
// ═════════════════════════════════════════════════════════════════════════════

const API_DIR = path.join(__dirname, 'api');
process.env.JIRA_URL      = 'https://jira.test';
process.env.JIRA_USER     = 'svc';
process.env.JIRA_PASSWORD = 'pwd';

// O handler registra erros esperados (Jira 500/400 simulados) com console.error.
// Silenciamos para não poluir a saída dos testes; falhas reais aparecem no relatório.
console.error = () => {};

// Recarrega o handler com módulos "limpos". `env` vale só durante o require,
// pois TTL do cache e teto de chamados são lidos no carregamento do módulo.
function loadHandler(env = {}) {
  Object.keys(require.cache).forEach(k => { if (k.startsWith(API_DIR)) delete require.cache[k]; });
  const antigo = {};
  Object.keys(env).forEach(k => { antigo[k] = process.env[k]; process.env[k] = env[k]; });
  try {
    return require(path.join(API_DIR, 'chamados.js'));
  } finally {
    Object.keys(env).forEach(k => { if (antigo[k] === undefined) delete process.env[k]; else process.env[k] = antigo[k]; });
  }
}

function resp(status, text) {
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

function makeRaw(kind, n, unassigned) {
  return {
    key: `${kind}-${n}`,
    fields: {
      summary:   `Chamado ${n}`,
      status:    { name: 'Aberto', statusCategory: { key: 'new' } },
      priority:  { name: 'High' },
      issuetype: { name: 'Dúvida' },
      assignee:  unassigned ? null : { displayName: 'Jean' },
      updated:   '2026-10-01T10:00:00.000-0300',
      created:   '2026-09-30T10:00:00.000-0300',
      customfield_10132: { value: 'Contábil Cloud' },
      customfield_32400: { value: 'Portfólio SC/MG' },
      customfield_21500: { value: 'Suporte' },
      customfield_10335: '',
      security:  null,
    },
  };
}

// Instala um Jira falso em global.fetch e devolve o log de chamadas.
// cfg: unassignedTotal, assignedTotal, pageCap (limite de maxResults do servidor),
//      types (resposta de /issuetype), failTypes, failSearch(nº da chamada)->status,
//      delayMs, issueOverride(kind, n, raw)->raw
function installFakeJira(cfg = {}) {
  const c = Object.assign({
    unassignedTotal: 0, assignedTotal: 0, pageCap: null,
    types: [
      { id: '10', name: 'Pre-Condition' },
      { id: '11', name: 'Não utilizar' },
      { id: '20', name: 'Dúvida' },
    ],
    failTypes: false, failSearch: null, delayMs: 0, issueOverride: null,
  }, cfg);

  const log = { searches: [], typeCalls: 0, cfg: c };

  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.endsWith('/rest/api/2/issuetype')) {
      log.typeCalls++;
      return c.failTypes ? resp(500, 'erro') : resp(200, JSON.stringify(c.types));
    }
    if (u.endsWith('/rest/api/2/search')) {
      const body = JSON.parse(opts.body);
      log.searches.push(body);
      if (c.delayMs) await sleep(c.delayMs);
      if (c.failSearch) {
        const st = c.failSearch(log.searches.length);
        if (st) return resp(st, 'erro simulado');
      }
      const unassigned = body.jql.includes('assignee is EMPTY');
      const total = unassigned ? c.unassignedTotal : c.assignedTotal;
      const size  = c.pageCap ? Math.min(body.maxResults, c.pageCap) : body.maxResults;
      const n     = Math.max(0, Math.min(size, total - body.startAt));
      const issues = Array.from({ length: n }, (_, i) => {
        const raw = makeRaw(unassigned ? 'UN' : 'AS', body.startAt + i, unassigned);
        return c.issueOverride ? c.issueOverride(unassigned ? 'UN' : 'AS', body.startAt + i, raw) : raw;
      });
      return resp(200, JSON.stringify({ issues, total, maxResults: size, startAt: body.startAt }));
    }
    return resp(404, 'não encontrado');
  };
  return log;
}

async function call(handler, query, method = 'GET') {
  const res = {
    headers: {}, code: null, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c)       { this.code = c; return this; },
    json(b)         { this.body = b; return this; },
  };
  await handler({ method, query }, res);
  return res;
}

const Q = { vertical: 'Contábil', portfolio: 'Portfólio SC/MG' };
const offsets = log => log.searches.map(s => s.startAt).sort((a, b) => a - b);

// ── Paginação ────────────────────────────────────────────────────────────────

test('Paginação: 250 chamados -> 3 páginas (0, 100, 200), todos carregados', async () => {
  const log = installFakeJira({ unassignedTotal: 250 });
  const r = await call(loadHandler(), Q);
  eq(r.code, 200);
  deepEq(offsets(log), [0, 100, 200], 'deve buscar as 3 páginas');
  eq(r.body.unassigned.length, 250);
  eq(r.body.loadedUnassigned, 250);
  eq(r.body.jiraTotalUnassigned, 250);
  eq(r.body.truncatedUnassigned, false);
  eq(r.body.truncated, false);
});

test('Paginação: teto de 300 -> 450 chamados vêm truncados e o front é avisado', async () => {
  const log = installFakeJira({ unassignedTotal: 450 });
  const r = await call(loadHandler(), Q);
  deepEq(offsets(log), [0, 100, 200], 'não deve pedir páginas além do teto');
  eq(r.body.unassigned.length, 300);
  eq(r.body.loadedUnassigned, 300);
  eq(r.body.jiraTotalUnassigned, 450, 'deve informar o total REAL do Jira');
  eq(r.body.truncatedUnassigned, true);
  eq(r.body.truncated, true);
});

test('Paginação: JIRA_MAX_ISSUES customiza o teto', async () => {
  const log = installFakeJira({ unassignedTotal: 400 });
  const r = await call(loadHandler({ JIRA_MAX_ISSUES: '150' }), Q);
  deepEq(offsets(log), [0, 100], 'com teto 150 bastam 2 páginas');
  eq(r.body.unassigned.length, 150);
  eq(r.body.truncated, true);
});

test('Paginação: respeita o maxResults reduzido pelo servidor (cap de 50)', async () => {
  const log = installFakeJira({ unassignedTotal: 120, pageCap: 50 });
  const r = await call(loadHandler(), Q);
  deepEq(offsets(log), [0, 50, 100], 'offsets devem usar o tamanho de página aplicado pelo Jira');
  eq(r.body.unassigned.length, 120);
  eq(r.body.truncated, false);
});

test('Paginação: sem chamados -> 1 requisição, lista vazia, não truncado', async () => {
  const log = installFakeJira({ unassignedTotal: 0 });
  const r = await call(loadHandler(), Q);
  eq(log.searches.length, 1);
  eq(r.body.unassigned.length, 0);
  eq(r.body.truncated, false);
});

test('Paginação: chave repetida entre páginas não gera duplicata na lista', async () => {
  installFakeJira({
    unassignedTotal: 150,
    // o chamado 100 (1º da 2ª página) repete a chave do 99 (último da 1ª página)
    issueOverride: (kind, n, raw) => { if (n === 100) raw.key = 'UN-99'; return raw; },
  });
  const r = await call(loadHandler(), Q);
  const keys = r.body.unassigned.map(i => i.key);
  eq(new Set(keys).size, keys.length, 'não pode haver chaves duplicadas');
});

test('Contagens: unassigned e assigned vêm separados, cada um com seu total do Jira', async () => {
  const log = installFakeJira({ unassignedTotal: 3, assignedTotal: 2 });
  const r = await call(loadHandler(), { ...Q, users: 'jean@betha.com.br' });
  eq(log.searches.length, 2, 'duas consultas: sem responsável + atribuídos');
  eq(r.body.totalUnassigned, 3);
  eq(r.body.totalAssigned, 2);
  eq(r.body.total, 5);
  eq(r.body.jiraTotalUnassigned, 3);
  eq(r.body.jiraTotalAssigned, 2);
  assert(log.searches.some(s => s.jql.includes('assignee is EMPTY')), 'JQL de sem responsável');
  assert(log.searches.some(s => s.jql.includes('assignee = "jean@betha.com.br"')), 'JQL de atribuídos por e-mail');
});

test('Contagens: truncagem em apenas uma das listas é reportada separadamente', async () => {
  installFakeJira({ unassignedTotal: 10, assignedTotal: 450 });
  const r = await call(loadHandler(), { ...Q, users: 'jean@betha.com.br' });
  eq(r.body.truncatedUnassigned, false);
  eq(r.body.truncatedAssigned, true);
  eq(r.body.truncated, true, 'truncated geral é verdadeiro se qualquer lista truncou');
  eq(r.body.jiraTotalAssigned, 450);
});

// ── Cache e deduplicação ─────────────────────────────────────────────────────

test('Cache: segunda chamada idêntica vem do cache (X-Cache: HIT) sem ir ao Jira', async () => {
  const log = installFakeJira({ unassignedTotal: 5 });
  const h = loadHandler();
  const r1 = await call(h, Q);
  eq(r1.headers['X-Cache'], 'MISS');
  const antes = log.searches.length;
  const r2 = await call(h, Q);
  eq(r2.headers['X-Cache'], 'HIT');
  eq(log.searches.length, antes, 'nenhuma nova consulta ao Jira');
  eq(r2.body.unassigned.length, 5, 'o conteúdo servido do cache é o mesmo');
});

test('Cache: filtros diferentes não compartilham cache', async () => {
  const log = installFakeJira({ unassignedTotal: 2 });
  const h = loadHandler();
  await call(h, { vertical: 'Contábil', portfolio: 'Portfólio SC/MG' });
  const r2 = await call(h, { vertical: 'Pessoal', portfolio: 'Portfólio SC/MG' });
  eq(r2.headers['X-Cache'], 'MISS');
  eq(log.searches.length, 2);
});

test('Cache: fresh=1 ignora o cache, mas o resultado novo realimenta o cache', async () => {
  const log = installFakeJira({ unassignedTotal: 2 });
  const h = loadHandler();
  await call(h, Q);
  const r2 = await call(h, { ...Q, fresh: '1' });
  eq(r2.headers['X-Cache'], 'MISS', 'busca manual deve consultar o Jira de novo');
  eq(log.searches.length, 2);
  const r3 = await call(h, Q);
  eq(r3.headers['X-Cache'], 'HIT', 'polling seguinte aproveita o resultado da busca fresca');
  eq(log.searches.length, 2);
});

test('Cache: TTL expira e a consulta volta ao Jira', async () => {
  const log = installFakeJira({ unassignedTotal: 2 });
  const h = loadHandler({ CHAMADOS_CACHE_TTL_MS: '30' });
  await call(h, Q);
  await sleep(70);
  const r2 = await call(h, Q);
  eq(r2.headers['X-Cache'], 'MISS');
  eq(log.searches.length, 2);
});

test('Deduplicação: 3 requisições simultâneas geram UMA consulta ao Jira', async () => {
  const log = installFakeJira({ unassignedTotal: 5, delayMs: 25 });
  const h = loadHandler();
  const rs = await Promise.all([call(h, Q), call(h, Q), call(h, Q)]);
  eq(log.searches.length, 1, 'só uma chamada deve chegar ao Jira');
  rs.forEach(r => { eq(r.code, 200); eq(r.body.unassigned.length, 5); });
});

test('Cache: falha do Jira NÃO fica em cache — próxima tentativa consulta de novo', async () => {
  const log = installFakeJira({ unassignedTotal: 4, failSearch: n => (n === 1 ? 500 : null) });
  const h = loadHandler();
  const r1 = await call(h, Q);
  eq(r1.code, 502);
  eq(r1.body.code, 'JIRA_ERROR');
  const r2 = await call(h, Q);
  eq(r2.code, 200, 'a segunda chamada não pode herdar o erro');
  eq(r2.headers['X-Cache'], 'MISS');
  eq(log.searches.length, 2);
});

// ── Filtros no JQL ───────────────────────────────────────────────────────────

test('JQL: tipos obsoletos são excluídos por ID (só os que existem no Jira)', async () => {
  const log = installFakeJira({ unassignedTotal: 1 });
  await call(loadHandler(), Q);
  const jql = log.searches[0].jql;
  assert(jql.includes('issuetype not in (10, 11)'), 'deve excluir os IDs 10 e 11. JQL: ' + jql);
  assert(!jql.includes('20'), 'o tipo legítimo (id 20) não pode ser excluído');
  assert(jql.includes('issuetype not in subTaskIssueTypes()'), 'subtarefas continuam excluídas');
});

test('JQL: nome de tipo inexistente no Jira não entra na consulta (evita HTTP 400)', async () => {
  const log = installFakeJira({ unassignedTotal: 1, types: [{ id: '20', name: 'Dúvida' }] });
  await call(loadHandler(), Q);
  assert(!/issuetype not in \(/.test(log.searches[0].jql), 'sem tipos excluídos existentes, não deve haver a cláusula');
});

test('JQL: com typeIds explícito usa "issuetype in" e não repete a exclusão', async () => {
  const log = installFakeJira({ unassignedTotal: 1 });
  await call(loadHandler(), { ...Q, typeIds: '20' });
  const jql = log.searches[0].jql;
  assert(jql.includes('issuetype in (20)'), 'JQL: ' + jql);
  assert(!/issuetype not in \(/.test(jql), 'a exclusão só vale quando nenhum tipo foi escolhido');
});

test('JQL: ORDER BY tem desempate por key (paginação estável)', async () => {
  const log = installFakeJira({ unassignedTotal: 1 });
  await call(loadHandler(), Q);
  assert(log.searches[0].jql.endsWith('ORDER BY priority ASC, updated DESC, key ASC'), 'JQL: ' + log.searches[0].jql);
});

test('Tipos excluídos: lista de IDs é cacheada (1 chamada a /issuetype para várias buscas)', async () => {
  const log = installFakeJira({ unassignedTotal: 1 });
  const h = loadHandler();
  await call(h, { vertical: 'Contábil', portfolio: 'Portfólio SC/MG' });
  await call(h, { vertical: 'Pessoal', portfolio: 'Portfólio SC/MG' });
  await call(h, { vertical: 'Contratos', portfolio: 'Portfólio SC/MG' });
  eq(log.typeCalls, 1);
});

test('Tipos excluídos: falha em /issuetype não derruba a busca; filtro por nome no Node segura', async () => {
  const log = installFakeJira({
    unassignedTotal: 5, failTypes: true,
    issueOverride: (kind, n, raw) => { if (n === 0) raw.fields.issuetype.name = 'Pre-Condition'; return raw; },
  });
  const r = await call(loadHandler(), Q);
  eq(r.code, 200, 'a busca deve funcionar mesmo sem a lista de IDs');
  assert(!/issuetype not in \(/.test(log.searches[0].jql), 'sem IDs, sem a cláusula extra');
  eq(r.body.unassigned.length, 4, 'o tipo excluído que veio do Jira é removido no Node');
  assert(!r.body.unassigned.some(i => i.type === 'Pre-Condition'));
});

// ── Filtros que continuam no Node ────────────────────────────────────────────

test('Parceiros: ocultos por padrão e exibidos com mostrarParceiros=true (mesma consulta em cache)', async () => {
  const log = installFakeJira({
    unassignedTotal: 10,
    issueOverride: (kind, n, raw) => { if (n % 2 === 0) raw.fields.security = { name: 'Parceiro X' }; return raw; },
  });
  const h = loadHandler();
  const r1 = await call(h, Q);
  eq(r1.body.unassigned.length, 5);
  const r2 = await call(h, { ...Q, mostrarParceiros: 'true' });
  eq(r2.body.unassigned.length, 10);
  eq(r2.headers['X-Cache'], 'HIT', 'o filtro é pós-cache: não gera nova consulta ao Jira');
  eq(log.searches.length, 1);
});

test('Prestação de contas: excluir/apenas filtram no Node sem nova consulta ao Jira', async () => {
  const log = installFakeJira({
    unassignedTotal: 10,
    issueOverride: (kind, n, raw) => { if (n < 3) raw.fields.customfield_10335 = 'SIOPE, Outra coisa'; return raw; },
  });
  const h = loadHandler();
  const todos   = await call(h, Q);
  const excluir = await call(h, { ...Q, prestacaoContas: 'excluir' });
  const apenas  = await call(h, { ...Q, prestacaoContas: 'apenas' });
  eq(todos.body.unassigned.length, 10);
  eq(excluir.body.unassigned.length, 7);
  eq(apenas.body.unassigned.length, 3);
  eq(excluir.body.prestacaoContasAtivo, true);
  eq(todos.body.prestacaoContasAtivo, false);
  eq(excluir.body.totalUnassigned, 10, 'totalUnassigned é a contagem antes do filtro de prestação');
  eq(log.searches.length, 1, 'os três modos reaproveitam a mesma consulta em cache');
});

// ── Erros da API ─────────────────────────────────────────────────────────────

test('API: método diferente de GET retorna 405', async () => {
  installFakeJira();
  const r = await call(loadHandler(), Q, 'POST');
  eq(r.code, 405);
  eq(r.body.code, 'METHOD_NOT_ALLOWED');
});

test('API: vertical fora da whitelist retorna 400 INVALID_PARAMS', async () => {
  installFakeJira();
  const r = await call(loadHandler(), { vertical: 'Inexistente' });
  eq(r.code, 400);
  eq(r.body.code, 'INVALID_PARAMS');
});

test('API: Jira respondendo 400 vira INVALID_FILTER e não é cacheado', async () => {
  const log = installFakeJira({ unassignedTotal: 1, failSearch: () => 400 });
  const h = loadHandler();
  const r = await call(h, Q);
  eq(r.code, 400);
  eq(r.body.code, 'INVALID_FILTER');
  log.cfg.failSearch = null;
  const r2 = await call(h, Q);
  eq(r2.code, 200);
});

// ═════════════════════════════════════════════════════════════════════════════
// NOVOS TESTES — Frontend REAL (public/index.html)
//
// As funções puras abaixo são EXTRAÍDAS do próprio index.html e executadas,
// em vez de copiadas para cá: se alguém alterar a regra no front, o teste vê.
// O que depende de DOM (renderResults) é coberto por um espelho mínimo do
// "portão" de renderização, usando a assinatura real.
// ═════════════════════════════════════════════════════════════════════════════

const HTML_SRC = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

function extractFunction(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('Função não encontrada no index.html: ' + name);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('Chaves desbalanceadas em ' + name);
}

const FRONT = new Function(
  ['escHtml', 'tempoRelativo', 'classeTempoFila', 'tempoFilaBadge', 'assinaturaDados']
    .map(n => extractFunction(HTML_SRC, n)).join('\n') +
  '\nreturn { escHtml, tempoRelativo, classeTempoFila, tempoFilaBadge, assinaturaDados };'
)();

const issue = o => Object.assign({
  key: 'A-1', summary: 'S', portfolio: 'P', sistema: 'Sis', equipe: 'Suporte',
  assignee: null, status: 'Aberto', priority: 'High', type: 'Dúvida', updated: 't1',
}, o);
const dados = (u, a, extra) => Object.assign({
  unassigned: u, assigned: a, prestacaoContasAtivo: false,
  truncatedUnassigned: false, truncatedAssigned: false,
  jiraTotalUnassigned: u.length, jiraTotalAssigned: a.length,
}, extra);
const clone = o => JSON.parse(JSON.stringify(o));
const sig = FRONT.assinaturaDados;

// Espelho do portão de renderização de renderResults():
//   skipIfUnchanged && assinatura igual -> não mexe no DOM
let _renders = 0;
function novoPortao() {
  let ultima = null; _renders = 0;
  return {
    render(data, opts) {
      const s = sig(data);
      if (opts && opts.skipIfUnchanged && s === ultima) return false;
      ultima = s; _renders++; return true;
    },
    invalidar() { ultima = null; },   // DOM trocado por spinner/erro/aviso
  };
}

test('Assinatura: dados idênticos (objetos distintos) geram a mesma assinatura', () => {
  const d = dados([issue({ key: 'A-1' })], [issue({ key: 'B-1', assignee: 'Jean' })]);
  eq(sig(d), sig(clone(d)));
});

test('Assinatura: muda quando status, updated, prioridade ou responsável mudam', () => {
  const base = dados([issue()], [issue({ key: 'B-1', assignee: 'Jean' })]);
  const mutacoes = [
    d => { d.unassigned[0].status = 'Em andamento'; },
    d => { d.unassigned[0].updated = 't2'; },
    d => { d.unassigned[0].priority = 'Low'; },
    d => { d.assigned[0].assignee = 'Maria'; },
    d => { d.assigned[0].summary = 'outro resumo'; },
  ];
  mutacoes.forEach((m, idx) => {
    const d = clone(base); m(d);
    assert(sig(d) !== sig(base), 'mutação #' + idx + ' deveria alterar a assinatura');
  });
});

test('Assinatura: muda quando um chamado entra, sai ou troca de lista', () => {
  const base = dados([issue({ key: 'A-1' })], [issue({ key: 'B-1', assignee: 'Jean' })]);
  assert(sig(dados([issue({ key: 'A-1' }), issue({ key: 'A-2' })], base.assigned)) !== sig(base), 'entrou');
  assert(sig(dados([], base.assigned)) !== sig(base), 'saiu');
  assert(sig(dados([issue({ key: 'B-1' })], [issue({ key: 'A-1', assignee: 'Jean' })])) !== sig(base), 'trocou de lista');
});

test('Assinatura: muda quando a ordem dos chamados muda', () => {
  const a = issue({ key: 'A-1' }), b = issue({ key: 'A-2' });
  assert(sig(dados([a, b], [])) !== sig(dados([b, a], [])));
});

test('Assinatura: muda com flags de truncagem e de prestação de contas (banners)', () => {
  const base = dados([issue()], []);
  assert(sig(dados(base.unassigned, [], { truncatedUnassigned: true })) !== sig(base), 'truncatedUnassigned');
  assert(sig(dados(base.unassigned, [], { truncatedAssigned: true })) !== sig(base), 'truncatedAssigned');
  assert(sig(dados(base.unassigned, [], { prestacaoContasAtivo: true })) !== sig(base), 'prestacaoContasAtivo');
  assert(sig(dados(base.unassigned, [], { jiraTotalUnassigned: 999 })) !== sig(base), 'jiraTotal');
});

test('Assinatura: campos que não aparecem na tabela (created) não forçam re-render', () => {
  const a = dados([issue({ created: 'c1' })], []);
  const b = dados([issue({ created: 'c2' })], []);
  eq(sig(a), sig(b));
});

test('Assinatura: tolera resposta sem listas', () => {
  noThrow(() => sig({}), 'assinaturaDados({}) não deve lançar');
  eq(typeof sig({}), 'string');
  eq(sig({}), sig({ unassigned: [], assigned: [] }), 'ausência de listas equivale a listas vazias');
});

test('Render: polling com dados idênticos NÃO redesenha as tabelas', () => {
  const p = novoPortao();
  const d = dados([issue()], []);
  eq(p.render(d), true, 'primeira renderização sempre acontece');
  eq(p.render(clone(d), { skipIfUnchanged: true }), false, 'polling idêntico deve ser pulado');
  eq(p.render(clone(d), { skipIfUnchanged: true }), false);
  eq(_renders, 1);
});

test('Render: polling com dados alterados redesenha', () => {
  const p = novoPortao();
  const d = dados([issue()], []);
  p.render(d);
  const novo = clone(d); novo.unassigned[0].status = 'Em andamento';
  eq(p.render(novo, { skipIfUnchanged: true }), true);
  eq(_renders, 2);
});

test('Render: busca manual (sem skipIfUnchanged) sempre redesenha, mesmo com dados idênticos', () => {
  const p = novoPortao();
  const d = dados([issue()], []);
  p.render(d);
  eq(p.render(clone(d)), true);
  eq(_renders, 2);
});

test('Render: ordenar por coluna (re-render sem skip) redesenha mesmo sem dado novo', () => {
  const p = novoPortao();
  const d = dados([issue()], []);
  p.render(d);
  eq(p.render(d), true, 'onSort chama renderResults sem skipIfUnchanged');
});

test('Render: após o DOM virar spinner/erro/aviso, o próximo polling idêntico REDESENHA (regressão)', () => {
  // Cenário: busca ok -> nova busca manual falha e mostra erro -> polling volta
  // com dados iguais aos de antes. Sem invalidar a assinatura o erro ficaria na tela.
  const p = novoPortao();
  const d = dados([issue()], []);
  p.render(d);
  p.invalidar();
  eq(p.render(clone(d), { skipIfUnchanged: true }), true, 'a tela precisa voltar para as tabelas');
});

test('Tempo na fila: classe por faixa (<2h ok, <8h avg, >=8h bad)', () => {
  const real = Date.now, AGORA = real.call(Date);
  Date.now = () => AGORA;
  try {
    const ha = h => new Date(AGORA - h * 3600000).toISOString();
    eq(FRONT.classeTempoFila(ha(0.5)), 'ok');
    eq(FRONT.classeTempoFila(ha(1.99)), 'ok');
    eq(FRONT.classeTempoFila(ha(2)), 'avg');
    eq(FRONT.classeTempoFila(ha(7.9)), 'avg');
    eq(FRONT.classeTempoFila(ha(8)), 'bad');
    eq(FRONT.classeTempoFila(ha(72)), 'bad');
  } finally { Date.now = real; }
});

test('Tempo na fila: data no futuro (relógio dessincronizado) é tratada como "ok"', () => {
  const real = Date.now, AGORA = real.call(Date);
  Date.now = () => AGORA;
  try {
    eq(FRONT.classeTempoFila(new Date(AGORA + 3600000).toISOString()), 'ok');
  } finally { Date.now = real; }
});

test('Tempo na fila: badge guarda data-iso (necessário para atualizar sem re-render)', () => {
  const real = Date.now, AGORA = real.call(Date);
  Date.now = () => AGORA;
  try {
    const iso = new Date(AGORA - 30 * 60000).toISOString();
    const html = FRONT.tempoFilaBadge(iso);
    assert(html.includes('data-iso="' + iso + '"'), 'badge sem data-iso: ' + html);
    assert(html.includes('class="tempo-fila ok"'), 'classe inicial incorreta: ' + html);
    assert(html.includes('há 30min'), 'texto inicial incorreto: ' + html);
  } finally { Date.now = real; }
});

test('Tempo na fila: badge sem data retorna string vazia e data-iso é escapado (XSS)', () => {
  eq(FRONT.tempoFilaBadge(''), '');
  eq(FRONT.tempoFilaBadge(null), '');
  const html = FRONT.tempoFilaBadge('2026-01-01"><img src=x onerror=alert(1)>');
  assert(!html.includes('"><img'), 'atributo data-iso deve ser escapado: ' + html);
});

test('Tempo relativo: atualização por intervalo muda o texto conforme o tempo passa', () => {
  const real = Date.now, AGORA = real.call(Date);
  try {
    const iso = new Date(AGORA - 59 * 60000).toISOString();
    Date.now = () => AGORA;
    eq(FRONT.tempoRelativo(iso), '59min');
    Date.now = () => AGORA + 2 * 60000;          // 2 minutos depois (sem nenhum fetch)
    eq(FRONT.tempoRelativo(iso), '1h', 'o badge deve evoluir sozinho para "1h"');
  } finally { Date.now = real; }
});

// ─────────────────────────────────────────────────────────────────────────────
// Execução
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Executando os testes de integração e regressão...\n');
  for (const t of queue) {
    try {
      await t.fn();
      results.push({ ok: true, name: t.name });
      passed++;
    } catch (e) {
      results.push({ ok: false, name: t.name, err: e.message });
      failed++;
    }
  }

  results.forEach(r => {
    if (r.ok) console.log(`  ✅ [Passou] ${r.name}`);
    else {
      console.log(`  ❌ [Falhou] ${r.name}`);
      console.log(`     -> Erro: ${r.err}`);
    }
  });

  console.log(`\n${'─'.repeat(62)}`);
  console.log(`Total: ${passed + failed} | ✅ ${passed} passaram | ❌ ${failed} falharam`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('Todos os testes foram executados com absoluto sucesso em pt-BR!');
  }
}

main();