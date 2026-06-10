/**
 * validate.js — Sanitização e validação de parâmetros de entrada
 *
 * Impede JQL Injection ao garantir que valores externos nunca sejam
 * interpolados diretamente na query sem escapamento.
 *
 * Referência de risco: um valor como `" OR issueKey > 0 OR "` injetado
 * num campo JQL poderia expor chamados de outros projetos.
 */

/** Tipos de chamado — mantido para referência, mas não usado como lista fechada. */
const TIPOS_PERMITIDOS = new Set([]);

/** Verticais permitidas — valores confirmados no Jira. */
const VERTICAIS_VALIDAS = new Set([
  'Arrecadação', 'Atendimento', 'Contratos', 'Contábil',
  'Educação', 'Pessoal', 'Saúde',
]);

/** Portfólios permitidos — valores confirmados no Jira. */
const PORTFOLIOS_VALIDOS = new Set([
  'Portfólio Pequenas Contas',
  'Portfólio Médias Contas',
  'Portfólio SC/MG',
  'Portfólio SC/SP',
]);

/**
 * Escapa aspas duplas em um valor destinado a ser usado dentro de
 * aspas duplas no JQL. Ex: `cf[10300] = "valor escapado"`.
 *
 * @param {string} value
 * @returns {string}
 */
function escapeJqlValue(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Sanitiza a lista de tipos recebida como string CSV.
 * Cada valor é escapado para uso seguro no JQL.
 * Limite de 50 tipos por requisição para evitar JQL excessivamente longo.
 *
 * @param {string|undefined} typesParam - CSV ex: "Incidente,Dúvida"
 * @returns {string[]} Lista de tipos sanitizados, ou array vazio (= sem filtro)
 */
function validateTypes(typesParam) {
  if (!typesParam || !typesParam.trim()) return [];
  return typesParam.split(',')
    .map(t => t.trim())
    .filter(Boolean)
    .slice(0, 50)
    .map(t => escapeJqlValue(t));
}

/** Valores de período permitidos (em dias). 0 = sem limite. */
const DIAS_VALIDOS = new Set([0, 30, 60, 90]);

/**
 * Valida o parâmetro de período em dias.
 * @param {string|undefined} daysParam
 * @returns {number} 0 = sem filtro de data
 */
function validateDays(daysParam) {
  const n = parseInt(daysParam, 10);
  if (isNaN(n)) return 0;
  return DIAS_VALIDOS.has(n) ? n : 0;
}

/**
 * Valida e sanitiza os parâmetros de busca recebidos da query string.
 * Retorna os valores seguros ou lança ValidationError.
 *
 * @param {{ vertical?: string, portfolio?: string, user?: string }} params
 * @returns {{ vertical: string|null, portfolio: string|null, user: string|null }}
 */
function validateSearchParams({ vertical, portfolio, user }) {
  // 1. Vertical: deve estar na lista fechada
  if (vertical !== undefined && vertical !== '') {
    if (!VERTICAIS_VALIDAS.has(vertical)) {
      throw new ValidationError(`Vertical inválida: "${vertical}"`);
    }
  }

  // 2. Portfólio: deve estar na lista fechada
  if (portfolio !== undefined && portfolio !== '') {
    if (!PORTFOLIOS_VALIDOS.has(portfolio)) {
      throw new ValidationError(`Portfólio inválido: "${portfolio}"`);
    }
  }

  // ── CORREÇÃO DE SEGURANÇA NO BACK-END ──────────────────────────────────
  // Replicando a regra do Front-end: Saúde e Educação NÃO possuem portfólio.
  // Se tentarem injetar via API externa, nós limpamos/ignoramos o parâmetro.
  let safePortfolio = portfolio || null;
  const vLower = (vertical || '').toLowerCase();
  if (vLower === 'saúde' || vLower === 'educação') {
    safePortfolio = null; 
  }
  // ───────────────────────────────────────────────────────────────────────

  // 3. Usuário: aceita qualquer string, mas escapa para uso no JQL
  let safeUser = null;
  if (user && user.trim().length > 0) {
    if (user.length > 200) {
      throw new ValidationError('Parâmetro "user" excede o limite de 200 caracteres.');
    }
    safeUser = escapeJqlValue(user.trim());
  }

  return {
    vertical:  vertical || null,
    portfolio: safePortfolio, // Usa a variável tratada contra bypass
    user:      safeUser,
  };
}

/**
 * Valida o parâmetro de busca de usuários.
 *
 * @param {string|undefined} q
 * @returns {string} query sanitizada
 */
function validateUserQuery(q) {
  if (!q || q.trim().length < 2) {
    throw new ValidationError('O parâmetro "q" deve ter ao menos 2 caracteres.');
  }
  if (q.length > 100) {
    throw new ValidationError('O parâmetro "q" excede o limite de 100 caracteres.');
  }
  return q.trim();
}

/**
 * Valida e sanitiza uma lista de usuários (suporte a múltiplos responsáveis).
 * @param {string|undefined} usersParam - CSV ex: "joao.silva,maria.costa"
 * @returns {string[]} Lista de usernames escapados, ou array vazio
 */
function validateUsers(usersParam) {
  if (!usersParam || !usersParam.trim()) return [];
  return usersParam.split(',')
    .map(u => u.trim())
    .filter(Boolean)
    .slice(0, 10)
    .filter(u => u.length <= 200)
    .map(u => escapeJqlValue(u));
}

/** Erro de validação de parâmetros de entrada. */
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = {
  validateSearchParams,
  validateUserQuery,
  validateTypes,
  validateDays,
  validateUsers,
  ValidationError,
  TIPOS_PERMITIDOS,
  VERTICAIS_VALIDAS,
  PORTFOLIOS_VALIDOS,
};