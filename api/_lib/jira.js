/**
 * jira.js — Cliente HTTP para a API REST do Jira Server
 *
 * Centraliza autenticação, construção de requests e tratamento
 * de erros, evitando repetição nos handlers de cada rota.
 */

// Config cacheada no módulo — evita recriar o authHeader a cada request.
let _config = null;

/**
 * Lê e valida as variáveis de ambiente obrigatórias.
 * O resultado é cacheado na primeira chamada para evitar trabalho redundante.
 *
 * @returns {{ url: string, authHeader: string }}
 */
function getConfig() {
  if (_config) return _config;

  const missing = ['JIRA_URL', 'JIRA_USER', 'JIRA_PASSWORD'].filter(
    k => !process.env[k]
  );
  if (missing.length) {
    throw new ConfigError(`Variáveis de ambiente ausentes: ${missing.join(', ')}`);
  }

  const url        = process.env.JIRA_URL.replace(/\/$/, '');
  const authHeader = 'Basic ' + Buffer.from(
    `${process.env.JIRA_USER}:${process.env.JIRA_PASSWORD}`
  ).toString('base64');

  _config = { url, authHeader };
  return _config;
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

  // Timeout explícito de 8s via AbortController — compatível com Node 16+.
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`${url}${path}`, {
      ...options,
      signal: controller.signal,
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
  } finally {
    clearTimeout(timeoutId);
  }
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

/**
 * GET simples e autenticado — reutilizado por handlers que não precisam
 * do helper `request` completo (ex: tipos.js).
 *
 * @param {string} path - Path relativo (ex: "/rest/api/2/issuetype")
 * @returns {Promise<any>}
 */
async function get(path) {
  return request(path);
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

module.exports = { searchIssues, searchUsers, get, JiraError, ConfigError };
