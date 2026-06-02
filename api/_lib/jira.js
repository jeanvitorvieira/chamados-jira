/**
 * jira.js — Cliente HTTP para a API REST do Jira Server
 *
 * Centraliza autenticação, construção de requests e tratamento
 * de erros, evitando repetição nos handlers de cada rota.
 */

/**
 * Lê e valida as variáveis de ambiente obrigatórias.
 * Lança um erro descritivo se alguma estiver ausente,
 * impedindo que requests cheguem ao Jira sem credenciais.
 *
 * @returns {{ url: string, authHeader: string }}
 */
function getConfig() {
  const url      = process.env.JIRA_URL?.replace(/\/$/, ''); // remove trailing slash
  const user     = process.env.JIRA_USER;
  const password = process.env.JIRA_PASSWORD;

  const missing = ['JIRA_URL', 'JIRA_USER', 'JIRA_PASSWORD'].filter(
    k => !process.env[k]
  );
  if (missing.length) {
    throw new ConfigError(`Variáveis de ambiente ausentes: ${missing.join(', ')}`);
  }

  const authHeader = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
  return { url, authHeader };
}

/**
 * Wrapper genérico sobre fetch para a API REST do Jira.
 * Faz o parse do JSON de resposta e normaliza erros HTTP
 * em instâncias de JiraError.
 *
 * @param {string} path   - Path relativo (ex: "/rest/api/2/search")
 * @param {RequestInit} [options] - Opções do fetch (method, body, etc.)
 * @returns {Promise<any>} JSON da resposta
 * @throws {JiraError} em caso de resposta HTTP não-ok
 * @throws {ConfigError} se as variáveis de ambiente não estiverem configuradas
 */
async function request(path, options = {}) {
  const { url, authHeader } = getConfig();

  const response = await fetch(`${url}${path}`, {
    ...options,
    headers: {
      'Authorization': authHeader,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    let detail = '';
    try { detail = await response.text(); } catch { /* ignore */ }
    throw new JiraError(`HTTP ${response.status}`, response.status, detail);
  }

  return response.json();
}

// ── MÉTODOS DE DOMÍNIO ────────────────────────────────────────────────────────

/**
 * Busca uma página de issues via JQL.
 * A paginação é feita no cliente: cada chamada retorna até PAGE_SIZE registros
 * a partir de startAt, mantendo cada invocação da serverless function dentro
 * do timeout de 10s do Vercel (plano gratuito).
 *
 * @param {string}   jql
 * @param {string[]} fields
 * @param {number}   [startAt=0]
 * @param {number}   [pageSize=100]
 * @returns {Promise<{ issues: any[], total: number }>}
 */
async function searchIssues(jql, fields, startAt = 0, pageSize = 100) {
  return request('/rest/api/2/search', {
    method: 'POST',
    body: JSON.stringify({ jql, fields, maxResults: pageSize, startAt }),
  });
}

/**
 * Busca usuários pelo nome ou e-mail.
 *
 * @param {string} query
 * @param {number} [maxResults=10]
 * @returns {Promise<any[]>}
 */
async function searchUsers(query, maxResults = 10) {
  const qs = new URLSearchParams({ username: query, maxResults });
  return request(`/rest/api/2/user/search?${qs}`);
}

// ── CLASSES DE ERRO ────────────────────────────────────────────────────────────

/** Erro originado da API do Jira (resposta HTTP não-ok). */
class JiraError extends Error {
  constructor(message, status, detail = '') {
    super(message);
    this.name   = 'JiraError';
    this.status = status;
    this.detail = detail;
  }
}

/** Erro de configuração (variáveis de ambiente ausentes). */
class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

module.exports = { searchIssues, searchUsers, JiraError, ConfigError };
