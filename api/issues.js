const { searchIssues, JiraError, ConfigError } = require('./_lib/jira');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' });
  }

  const raw  = (req.query.keys || '').trim();
  if (!raw) return res.status(200).json({ ok: true, issues: [] });

  const keys = raw.split(',')
    .map(k => k.trim())
    .filter(k => /^[A-Z0-9]+-\d+$/i.test(k))
    .slice(0, 20);

  if (!keys.length) return res.status(200).json({ ok: true, issues: [] });

  const jql = `issueKey in (${keys.join(',')})`;

  try {
    const data = await searchIssues(jql, ['status', 'assignee'], 0, 20);
    const issues = (data.issues ?? []).map(issue => ({
      key:       issue.key,
      status:    issue.fields.status?.name ?? '—',
      statusCat: issue.fields.status?.statusCategory?.key ?? '',
      assignee:  issue.fields.assignee?.displayName ?? null,
    }));
    return res.status(200).json({ ok: true, issues });
  } catch (err) {
    if (err instanceof ConfigError) {
      return res.status(500).json({ ok: false, error: 'Serviço não configurado.', code: 'CONFIG_ERROR' });
    }
    if (err.name === 'AbortError') {
      return res.status(504).json({ ok: false, error: 'Timeout.', code: 'TIMEOUT' });
    }
    return res.status(502).json({ ok: false, error: 'Erro ao consultar o Jira.', code: 'JIRA_ERROR' });
  }
};
