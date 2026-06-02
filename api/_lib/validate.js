/**
 * validate.js — Sanitização e validação de parâmetros de entrada
 *
 * Impede JQL Injection ao garantir que valores externos nunca sejam
 * interpolados diretamente na query sem escapamento.
 *
 * Referência de risco: um valor como `" OR issueKey > 0 OR "` injetado
 * num campo JQL poderia expor chamados de outros projetos.
 */

/** Tipos de chamado permitidos — lista fechada para prevenção de JQL Injection. */
const TIPOS_PERMITIDOS = new Set([
  'Incidente',
  'Dúvida',
  'Acompanhamento técnico',
  'Configuração',
  'Customização',
  'Tratamento de dados',
  'Treinamento',
  'Serviço',
  'Atualização de legislação',
  'Permissão de Acesso',
  'Comunicação ao Cliente',
]);

/** Verticais permitidas — valores confirmados no Jira. */
const VERTICAIS_VALIDAS = new Set([
  'Arrecadação', 'Atendimento', 'Compras/Contratos', 'Contábil',
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
 * Valida e sanitiza os parâmetros de busca recebidos da query string.
 * Retorna os valores seguros ou lança ValidationError.
 *
 * @param {{ vertical?: string, portfolio?: string, user?: string }} params
 * @returns {{ vertical: string|null, portfolio: string|null, user: string|null }}
 */
/**
 * Valida a lista de tipos recebida como string CSV.
 * Retorna apenas os tipos que existem em TIPOS_PERMITIDOS.
 * Tipos desconhecidos são silenciosamente ignorados (não causam 400).
 *
 * @param {string|undefined} typesParam - CSV ex: "Incidente,Dúvida"
 * @returns {string[]} Lista de tipos válidos, ou array vazio (= todos)
 */
function validateTypes(typesParam) {
  if (!typesParam || !typesParam.trim()) return [];
  return typesParam.split(',')
    .map(t => t.trim())
    .filter(t => TIPOS_PERMITIDOS.has(t));
}

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
  validateTypes,
  ValidationError,
  TIPOS_PERMITIDOS,
  VERTICAIS_VALIDAS,
  PORTFOLIOS_VALIDOS,
};
