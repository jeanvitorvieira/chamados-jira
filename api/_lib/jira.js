let _config = null;

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

async function request(path, options = {}) {
  const { url, authHeader } = getConfig();

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 15000);

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

async function searchIssues(jql, fields, startAt = 0, pageSize = 100) {
  return request('/rest/api/2/search', {
    method: 'POST',
    body: JSON.stringify({ jql, fields, maxResults: pageSize, startAt }),
  });
}

async function searchUsers(query, maxResults = 50) {
  const safeMax = Number.isFinite(maxResults) ? maxResults : 50;

  const [byUsername, byQuery] = await Promise.all([
    request(`/rest/api/2/user/search?${new URLSearchParams({ username: query, maxResults: safeMax })}`).catch(() => []),
    request(`/rest/api/2/user/search?${new URLSearchParams({ query: query, maxResults: safeMax })}`).catch(() => []),
  ]);

  const seen = new Set();
  return [...byUsername, ...byQuery].filter(u => {
    const key = u.emailAddress || u.name;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function get(path) {
  return request(path);
}

class JiraError extends Error {
  constructor(message, status, detail = '') {
    super(message);
    this.name   = 'JiraError';
    this.status = status;
    this.detail = detail;
  }
}

class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

module.exports = { searchIssues, searchUsers, get, JiraError, ConfigError };
