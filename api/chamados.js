/**
 * GET /api/chamados
 *
 * Busca issues abertas no Jira com filtros opcionais de portfólio,
 * vertical, equipe responsável e responsável. Retorna chamados sem responsável 
 * e atribuídos aos usuários informados, separados por categoria.
 */

const { searchIssues, JiraError, ConfigError } = require('./_lib/jira');
const { validateSearchParams, validateTypes, validateDays, validateUsers, ValidationError } = require('./_lib/validate');

/** Campos retornados para cada issue. */
const FIELDS = [
  'summary',
  'status',
  'assignee',
  'priority',
  'issuetype',
  'created',
  'updated',
  'customfield_32400', // Portfólio de Atendimento
  'customfield_10300', // Vertical
  'customfield_21500', // Equipe Responsável (Ajuste o ID numérico conforme seu Jira)
];

module.exports = async function handler(req, res) {
  // Só aceita GET
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' });
  }

  // 1. Valida e sanitiza parâmetros de entrada (req.query contém o parâmetro 'equipe')
  let params;
  try {
    params = validateSearchParams(req.query);
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(400).json({ ok: false, error: err.message, code: 'INVALID_PARAMS' });
    }
    throw err;
  }

  // 2. Valida tipos, período e usuários
  const selectedTypeIds = (req.query.typeIds || '')
    .split(',')
    .map(s => s.trim())
    .filter(s => /^\d+$/.test(s))
    .slice(0, 50);
  const selectedTypes = validateTypes(req.query.types);
  const days          = validateDays(req.query.days);
  const users         = validateUsers(req.query.users || req.query.user || '');

  // 3. Constrói JQLs separados — um para sem responsável, outro para os usuários.
  const jqlUnassigned = buildJql(params, users, selectedTypeIds, selectedTypes, days, 'unassigned');
  const jqlAssigned   = users.length > 0
    ? buildJql(params, users, selectedTypeIds, selectedTypes, days, 'assigned')
    : null;

  // 4. Executa as queries em paralelo
  try {
    const [dataUnassigned, dataAssigned] = await Promise.all([
      searchIssues(jqlUnassigned, FIELDS),
      jqlAssigned ? searchIssues(jqlAssigned, FIELDS) : Promise.resolve({ issues: [], total: 0 }),
    ]);

    const unassigned = (dataUnassigned.issues ?? []).map(mapIssue);
    const assigned   = (dataAssigned.issues   ?? []).map(mapIssue);

    return res.status(200).json({
      ok:              true,
      totalUnassigned: dataUnassigned.total,
      totalAssigned:   dataAssigned.total,
      total:           dataUnassigned.total + dataAssigned.total,
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

// ── HELPERS ───────────────────────────────────────────────────────────────────

/**
 * Constrói JQL para uma das duas queries independentes.
 * Prefere filtrar por ID numérico (typeIds) para cobrir tipos homônimos;
 * cai no filtro por nome (types) como fallback.
 * @param {'unassigned'|'assigned'} mode
 */
function buildJql({ vertical, portfolio, equipe }, users, selectedTypeIds, selectedTypes, days, mode) {
  const clauses = ['statusCategory != Done'];

  if (selectedTypeIds && selectedTypeIds.length > 0) {
    clauses.push(`issuetype in (${selectedTypeIds.join(', ')})`);
  } else if (selectedTypes && selectedTypes.length > 0) {
    clauses.push(`issuetype in (${selectedTypes.map(t => `"${t}"`).join(', ')})`);
  }

  if (portfolio) clauses.push(`cf[32400] = "${portfolio}"`);
  if (vertical)  clauses.push(`cf[10300] = "${vertical}"`);
  if (equipe)      clauses.push(`cf[21500] = "${equipe}"`); // Equipe Responsável
  if (days > 0)  clauses.push(`updated >= -${days}d`);

  if (mode === 'assigned' && users.length > 0) {
    // Suporta múltiplos responsáveis
    clauses.push(users.length === 1
      ? `assignee = "${users[0]}"`
      : `assignee in (${users.map(u => `"${u}"`).join(', ')})`);
  } else {
    clauses.push('assignee is EMPTY');
  }

  return clauses.join(' AND ') + ' ORDER BY priority ASC, updated DESC';
}

/**
 * Transforma um objeto issue cru da API Jira em um DTO limpo.
 *
 * @param {object} raw - Issue no formato da API REST do Jira
 * @returns {object} Issue normalizada
 */
function mapIssue(raw) {
  const f = raw.fields;
  return {
    key:       raw.key,
    summary:   f.summary,
    status:    f.status?.name ?? '—',
    statusCat: f.status?.statusCategory?.name ?? '',
    priority:  f.priority?.name ?? '—',
    type:      f.issuetype?.name ?? '—',
    assignee:  f.assignee?.displayName ?? null,
    updated:   f.updated,
    created:   f.created,
    vertical:  f.customfield_10300?.value ?? null,
    portfolio: f.customfield_32400?.value ?? null,
    equipe:      f.customfield_21500?.value ?? null, // Mapeia equipe para o DTO de saída
    url:       `${process.env.JIRA_URL}/browse/${raw.key}`,
  };
}