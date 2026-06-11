const { searchIssues, JiraError, ConfigError } = require('./_lib/jira');
const { validateSearchParams, validateTypes, validateDays, validateUsers, ValidationError } = require('./_lib/validate');

const FIELDS = [
  'summary',
  'status',
  'assignee',
  'priority',
  'issuetype',
  'created',
  'updated',
  'customfield_32400',
  'customfield_10300',
  'customfield_10132',
  'customfield_21500',
];

const NOMES_TIPOS_EXCLUIDOS = [
  'Sub-tarefa', 'Melhoria (sub-tarefa)', 'Serviço (sub-tarefa)',
  'Ação (sub-tarefa)', 'Pre-Condition', 'Não utilizar',
  'Suporte (NÃO USAR - Use Dúvida)',
  'Análise de dados (NÃO USAR - Use Tratamento de Dados)',
  'Alteração de dados (NÃO USAR - Use Tratamento de Dados)',
  'Migração de Dados (NÃO USAR - Use Tratamento de Dados)',
  'Fora de escopo (NÃO USAR - Use Dúvida)',
  'Treinamento de Implantação old',
];

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' });
  }

  let params;
  try {
    params = validateSearchParams(req.query);
  } catch (err) {
    if (err instanceof ValidationError || err.name === 'ValidationError') {
      return res.status(400).json({ ok: false, error: err.message, code: 'INVALID_PARAMS' });
    }
    throw err;
  }

  const rawTypes = (req.query.typeIds || req.query.types || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 50);

  const selectedTypeIds = rawTypes.filter(s => /^\d+$/.test(s));
  const selectedTypes   = rawTypes.filter(s => !/^\d+$/.test(s)).map(t => validateTypes(t)[0]).filter(Boolean);
  
  const days            = validateDays(req.query.days);
  const users           = validateUsers(req.query.users || req.query.user || '');

  const jqlUnassigned = buildJql(params, users, selectedTypeIds, selectedTypes, days, 'unassigned');
  const jqlAssigned   = users.length > 0
    ? buildJql(params, users, selectedTypeIds, selectedTypes, days, 'assigned')
    : null;

  try {
    const [dataUnassigned, dataAssigned] = await Promise.all([
      searchIssues(jqlUnassigned, FIELDS),
      jqlAssigned ? searchIssues(jqlAssigned, FIELDS) : Promise.resolve({ issues: [], total: 0 }),
    ]);

    const unassigned = (dataUnassigned.issues ?? [])
      .map(mapIssue)
      .filter(i => !NOMES_TIPOS_EXCLUIDOS.includes(i.type));

    const assigned = (dataAssigned.issues ?? [])
      .map(mapIssue)
      .filter(i => !NOMES_TIPOS_EXCLUIDOS.includes(i.type));

    return res.status(200).json({
      ok:              true,
      totalUnassigned: unassigned.length,
      totalAssigned:   assigned.length,
      total:           unassigned.length + assigned.length,
      unassigned,
      assigned,
    });
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error('[chamados] Configuração inválida:', err.message);
      return res.status(500).json({ ok: false, error: 'Serviço não configurado.', code: 'CONFIG_ERROR' });
    }
    if (err instanceof JiraError) {
      console.error(`[chamados] Erro Jira ${err.status}:`, err.detail);
      if (err.status === 400) {
        return res.status(400).json({ ok: false, error: 'Filtro inválido — um dos valores selecionados não existe no Jira.', code: 'INVALID_FILTER' });
      }
      return res.status(502).json({ ok: false, error: 'Não foi possível conectar ao Jira. Tente novamente.', code: 'JIRA_ERROR' });
    }
    if (err.name === 'AbortError') {
      console.error('[chamados] Timeout na consulta ao Jira');
      return res.status(504).json({ ok: false, error: 'Consulta ao Jira excedeu o tempo limite. Tente novamente.', code: 'TIMEOUT' });
    }
    console.error('[chamados] Erro inesperado:', err);
    return res.status(500).json({ ok: false, error: 'Erro interno. Tente novamente.', code: 'INTERNAL_ERROR' });
  }
};

function buildJql({ vertical, portfolio, equipe }, users, selectedTypeIds, selectedTypes, days, mode) {
  const clauses = ['statusCategory != Done'];

  const typeClauses = [];
  if (selectedTypeIds && selectedTypeIds.length > 0) {
    typeClauses.push(...selectedTypeIds);
  }
  if (selectedTypes && selectedTypes.length > 0) {
    typeClauses.push(...selectedTypes.map(t => `"${t}"`));
  }

  if (typeClauses.length > 0) {
    clauses.push(`issuetype in (${typeClauses.join(', ')})`);
  } else {
    clauses.push('issuetype not in subTaskIssueTypes()');
  }

  if (portfolio) clauses.push(`cf[32400] = "${portfolio}"`);
  if (vertical)  clauses.push(`cf[10300] = "${vertical}"`);
  if (equipe)    clauses.push(`cf[21500] = "${equipe}"`); 
  if (days > 0)  clauses.push(`updated >= -${days}d`);

  if (mode === 'assigned' && users.length > 0) {
    clauses.push(users.length === 1
      ? `assignee = "${users[0]}"`
      : `assignee in (${users.map(u => `"${u}"`).join(', ')})`);
  } else {
    clauses.push('assignee is EMPTY');
  }

  return clauses.join(' AND ') + ' ORDER BY priority ASC, updated DESC';
}

function mapIssue(raw) {
  const f = raw.fields;
  return {
    key:       raw.key,
    summary:   f.summary,
    status:    f.status?.name ?? '—',
    statusCat: f.status?.statusCategory?.key ?? '',
    priority:  f.priority?.name ?? '—',
    type:      f.issuetype?.name ?? '—',
    assignee:  f.assignee?.displayName ?? null,
    updated:   f.updated,
    created:   f.created,
    sistema:   f.customfield_10132?.value ?? null,
    portfolio: f.customfield_32400?.value ?? null,
    equipe:    f.customfield_21500?.value ?? null, 
    url:       `${process.env.JIRA_URL}/browse/${raw.key}`,
  };
}