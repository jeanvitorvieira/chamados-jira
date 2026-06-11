/**
 * validate.js — Sanitização e validação de parâmetros de entrada
 *
 * Impede JQL Injection ao garantir que valores externos nunca sejam
 * interpolados diretamente na query sem escapamento.
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

/** Equipes permitidas — Sincronizadas exatamente com as <option> do frontend. */
const EQUIPES_VALIDAS = new Set([
  'Suporte',
  'Serviço',
  'Produto',
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
 */
function validateTypes(typesParam) {
  if (!typesParam || !typesParam.trim()) return [];
  return typesParam.split(',')
    .map(t => t.trim())
    .filter(Boolean)
    .slice(0, 50)
    .map(t => escapeJqlValue(t));
}

/** Valores de período permitidos (em dias). */
const DIAS_VALIDOS = new Set([0, 30, 60, 90]);

/**
 * Valida o parâmetro de período em dias.
 */
function validateDays(daysParam) {
  const n = parseInt(daysParam, 10);
  if (isNaN(n)) return 0;
  return DIAS_VALIDOS.has(n) ? n : 0;
}

/**
 * Valida e sanitiza os parâmetros de busca recebidos da query string.
 * Suporta o parâmetro 'cf[21500]' enviado diretamente do frontend.
 *
 * @param {object} queryParams - Objeto contendo os parâmetros da query string
 * @returns {{ vertical: string|null, portfolio: string|null, user: string|null, equipe: string|null }}
 */
function validateSearchParams(queryParams) {
  const vertical = queryParams.vertical;
  const portfolio = queryParams.portfolio;
  const user = queryParams.user;
  
  // Aceita tanto o parâmetro legível 'equipe' como o parâmetro literal 'cf[21500]'
  const equipe = queryParams.equipe || queryParams['cf[21500]'];

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

  // 3. Equipa Responsável: deve estar na lista fechada
  if (equipe !== undefined && equipe !== '') {
    if (!EQUIPES_VALIDAS.has(equipe)) {
      throw new ValidationError(`Equipe inválida: "${equipe}"`);
    }
  }

  // ── REGRA DE SEGURANÇA: Saúde e Educação NÃO possuem portfólio ─────────
  let safePortfolio = portfolio || null;
  const vLower = (vertical || '').toLowerCase();
  if (vLower === 'saúde' || vLower === 'educação') {
    safePortfolio = null; 
  }

  // 4. Usuário: aceita qualquer string, mas escapa para uso no JQL
  let safeUser = null;
  if (user && user.trim().length > 0) {
    if (user.length > 200) {
      throw new ValidationError('Parâmetro "user" excede o limite de 200 caracteres.');
    }
    safeUser = escapeJqlValue(user.trim());
  }

  return {
    vertical:  vertical || null,
    portfolio: safePortfolio,
    user:      safeUser,
    equipe:    equipe || null,
  };
}

/**
 * Valida o parâmetro de busca de usuários.
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
 * Valida e sanitiza uma lista de usuários.
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
  EQUIPES_VALIDAS,
};