/**
 * validate.js — Sanitização e validação de parâmetros de entrada
 *
 * Impede JQL Injection ao garantir que valores externos nunca sejam
 * interpolados diretamente na query sem escapamento.
 *
 * Referência de risco: um valor como `" OR issueKey > 0 OR "` injetado
 * num campo JQL poderia expor chamados de outros projetos.
 */

/** Verticais permitidas — lista fechada para validação estrita. */
const VERTICAIS_VALIDAS = new Set([
  'Arrecadação', 'Beth', 'Contábil', 'Contratos', 'Educação',
  'Governo Digital', 'ISS', 'Pessoal', 'Saúde', 'Studio', 'Suite',
]);

/** Portfólios permitidos — lista fechada. */
const PORTFOLIOS_VALIDOS = new Set([
  'Portfólio Pequenas Contas',
  'Portfólio Médias Contas',
  'Portfólio Grandes Contas',
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
 * Valida e sanitiza os parâmetros de busca recebidos da query string.
 * Retorna os valores seguros ou lança ValidationError.
 *
 * @param {{ vertical?: string, portfolio?: string, user?: string }} params
 * @returns {{ vertical: string|null, portfolio: string|null, user: string|null }}
 */
function validateSearchParams({ vertical, portfolio, user }) {
  // Vertical: deve estar na lista fechada
  if (vertical !== undefined && vertical !== '') {
    if (!VERTICAIS_VALIDAS.has(vertical)) {
      throw new ValidationError(`Vertical inválida: "${vertical}"`);
    }
  }

  // Portfólio: deve estar na lista fechada
  if (portfolio !== undefined && portfolio !== '') {
    if (!PORTFOLIOS_VALIDOS.has(portfolio)) {
      throw new ValidationError(`Portfólio inválido: "${portfolio}"`);
    }
  }

  // Usuário: aceita qualquer string, mas escapa para uso no JQL
  // e limita o comprimento para evitar abuso
  let safeUser = null;
  if (user && user.trim().length > 0) {
    if (user.length > 200) {
      throw new ValidationError('Parâmetro "user" excede o limite de 200 caracteres.');
    }
    safeUser = escapeJqlValue(user.trim());
  }

  return {
    vertical:  vertical || null,
    portfolio: portfolio || null,
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
  ValidationError,
  VERTICAIS_VALIDAS,
  PORTFOLIOS_VALIDOS,
};
