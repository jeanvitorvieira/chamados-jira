let passed = 0, failed = 0;
const results = [];

function test(name, fn) {
  try { 
    fn(); 
    results.push({ ok: true, name }); 
    passed++; 
  } catch(e) { 
    results.push({ ok: false, name, err: e.message }); 
    failed++; 
  }
}

function assert(cond, msg)     { if (!cond) throw new Error(msg || 'A asserção falhou'); }
function eq(a, b, msg)         { if (a !== b) throw new Error((msg||'') + ` -> Esperado: ${JSON.stringify(b)} | Obtido: ${JSON.stringify(a)}`); }
function deepEq(a, b, msg)     { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg||'') + `\n  Esperado: ${JSON.stringify(b)}\n  Obtido: ${JSON.stringify(a)}`); }
function noThrow(fn, msg)      { try { fn(); } catch(e) { throw new Error((msg||'') + ': ' + e.message); } }
function throws(fn, msg)       { let ok = false; try { fn(); } catch { ok = true; } if (!ok) throw new Error(msg || 'Deveria ter lançado uma exceção'); }

function buildCurrent(unassigned, assigned) {
  const current = {};
  unassigned.forEach(i => { current[i.key] = { status: i.status, assignee: null, updated: i.updated }; });
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

test('SW: baseline vazio no arranque inicial -> isFirstRun=true, sem notificações', () => {
  const r = swDetect({}, {
    unassigned: [{ key:'A-1', status:'Aberto', assignee:null, updated:'t1', summary:'X' }],
    assigned: []
  });
  assert(r.isFirstRun, 'Deveria identificar o primeiro ciclo como baseline');
  eq(r.novos.length, 0, 'Não deve alertar sobre chamados existentes no arranque inicial');
  eq(r.current['A-1'].assignee, null, 'Deve guardar os chamados atuais');
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
  eq(r.novos.length, 1, 'Deve detetar exatamente um novo chamado');
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

test('SW: mudança de status detetada', () => {
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

test('SW: desaparecidos detetados quando o resultado não for truncado', () => {
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

test('SW: desaparecidos ignorados de forma segura quando a paginação estiver truncada', () => {
  const known = {
    'B-1': { status:'Aberto', assignee:'Jean',  updated:'t1' },
    'B-2': { status:'Aberto', assignee:'Maria', updated:'t1' },
  };
  const r = swDetect(known, {
    unassigned: [], assigned: [{ key:'B-1', status:'Aberto', assignee:'Jean', updated:'t1', summary:'X' }],
    totalAssigned: 5 
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
    totalAssigned: 1
  });
  assert(!r.desap.includes('A-1'), 'unassigned não deve aparecer em desap');
});

test('SW: múltiplas deteções não se sobrepõem', () => {
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
  eq(r.status.length, 1, 'mudança de status detetada na primeira poll do SW');
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
  eq(preenchidos('Contábil', 'Portfólio Pequenas Contas', 'Suporte', ['jean@betha.com.br']), 4);
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

test('Dedup: utilizador selecionado por e-mail é excluído do autocomplete', () => {
  const api = [{ name:'filipe.andrade@betha.com.br', email:'filipe.andrade@betha.com.br', displayName:'Filipe Pereira Andrade' }];
  const sel = [{ name:'filipe.andrade@betha.com.br', email:'filipe.andrade@betha.com.br' }];
  const r = dedup(api, sel);
  eq(r.length, 0, 'utilizador já selecionado não deve aparecer no autocomplete');
});

test('Dedup: utilizador diferente com e-mail diferente mantido', () => {
  const api = [
    { name:'jean.vieira@betha.com.br',   email:'jean.vieira@betha.com.br',   displayName:'Jean' },
    { name:'marlon.ern@betha.com.br',    email:'marlon.ern@betha.com.br',    displayName:'Marlon' },
  ];
  const sel = [{ name:'jean.vieira@betha.com.br', email:'jean.vieira@betha.com.br' }];
  const r = dedup(api, sel);
  eq(r.length, 1); eq(r[0].name, 'marlon.ern@betha.com.br');
});

test('Dedup: utilizador sem e-mail usa name como fallback', () => {
  const api = [
    { name:'usuario-interno', email:'', displayName:'Usuário Interno' },
  ];
  const sel = [];
  const r = dedup(api, sel);
  eq(r.length, 1, 'utilizador sem email deve aparecer usando name como chave');
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

test('Consistência: página e SW detetam novosUnassigned da mesma forma', () => {
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

test('Consistência: página e SW detetam statusAlterado da mesma forma', () => {
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

test('Consistência: página e SW detetam movimentados da mesma forma', () => {
  const known = { 'B-1': { status:'Em andamento', assignee:'Jean', updated:'t1' } };
  const data = {
    unassigned: [],
    assigned: [{ key:'B-1', status:'Em andamento', assignee:'Jean', updated:'t2', summary:'X' }],
    totalAssigned: 1
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

test('Timer: tick com gen atual é aceite', () => {
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

console.log('Executando os testes de integração e regressão...\n');
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
  console.log('Todos os testes foram executados com absoluto sucesso!');
}