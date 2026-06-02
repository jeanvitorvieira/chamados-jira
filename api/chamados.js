/**
 * GET /api/chamados
 *
 * Busca issues abertas no Jira com filtros opcionais de portfólio,
 * vertical e responsável. Retorna chamados sem responsável e atribuídos
 * ao usuário informado, separados por categoria.
 *
 * Query params:
 *   vertical  {string}  — nome da vertical (ex: "Contábil")
 *   portfolio {string}  — nome do portfólio (ex: "Portfólio Pequenas Contas")
 *   user      {string}  — username do Jira (ex: "jean.vieira@betha.com.br")
 *
 * Resposta 200:
 *   { ok: true, total, issues: Issue[], jql }
 *
 * Resposta de erro:
 *   { ok: false, error: string, code: string }
 */

const { searchIssues, JiraError, ConfigError } = require('./_lib/jira');
const { validateSearchParams, validateTypes, validateDays, ValidationError } = require('./_lib/validate');

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
];

module.exports = async function handler(req, res) {
  // Só aceita GET
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' });
  }

  // 1. Valida e sanitiza parâmetros de entrada
  let params;
  try {
    params = validateSearchParams(req.query);
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(400).json({ ok: false, error: err.message, code: 'INVALID_PARAMS' });
    }
    throw err;
  }

  // 2. Valida tipos e período
  const selectedTypes = validateTypes(req.query.types);
  const days          = validateDays(req.query.days);

  // 3. Constrói JQL
  const jql = buildJql(params, selectedTypes, days);

  // 4. Chama o Jira (uma página por vez — paginação feita no cliente)
  const startAt = Math.min(10000, Math.max(0, parseInt(req.query.startAt, 10) || 0));
  let data;
  try {
    data = await searchIssues(jql, FIELDS, startAt);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error('[chamados] Configuração inválida:', err.message);
      return res.status(500).json({ ok: false, error: 'Serviço não configurado.', code: 'CONFIG_ERROR' });
    }
    if (err instanceof JiraError) {
      console.error(`[chamados] Erro Jira ${err.status}:`, err.detail);
      // 400 geralmente significa que um valor do filtro não existe no Jira
      if (err.status === 400) {
        return res.status(400).json({ ok: false, error: 'Filtro inválido — um dos valores selecionados não existe no Jira.', code: 'INVALID_FILTER' });
      }
      return res.status(502).json({ ok: false, error: 'Não foi possível conectar ao Jira. Tente novamente.', code: 'JIRA_ERROR' });
    }
    throw err; // erro inesperado — deixa o Vercel logar
  }

  // 4. Mapeia para o formato de resposta da API
  const issues = (data.issues ?? []).map(mapIssue);

  return res.status(200).json({
    ok:    true,
    total: data.total,
    issues,
  });
};

// ── HELPERS ───────────────────────────────────────────────────────────────────

/**
 * Constrói a expressão JQL a partir dos parâmetros validados.
 * Os valores já chegam escapados de validate.js.
 */
function buildJql({ vertical, portfolio, user }, selectedTypes, days) {
  const clauses = ['statusCategory != Done'];

  // Só adiciona filtro de tipo se o usuário selecionou algum
  // Os valores já chegam escapados de validateTypes()
  if (selectedTypes && selectedTypes.length > 0) {
    clauses.push(`issuetype in (${selectedTypes.map(t => `"${t}"`).join(', ')})`);
  }

  if (portfolio) clauses.push(`cf[32400] = "${portfolio}"`);
  if (vertical)  clauses.push(`cf[10300] = "${vertical}"`);
  if (days > 0)  clauses.push(`updated >= -${days}d`);

  if (user) {
    // Traz chamados sem dono OU atribuídos ao usuário especificado
    clauses.push(`(assignee = "${user}" OR assignee is EMPTY)`);
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
    url:       `${process.env.JIRA_URL}/browse/${raw.key}`,
  };
}
