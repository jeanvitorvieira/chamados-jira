const { searchUsers, JiraError, ConfigError } = require('./_lib/jira');
const { validateUserQuery, ValidationError } = require('./_lib/validate');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' });
  }

  let query;
  try {
    query = validateUserQuery(req.query.q);
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(400).json({ ok: false, error: err.message, code: 'INVALID_PARAMS' });
    }
    throw err;
  }

  let rawUsers;
  try {
    rawUsers = await searchUsers(query);
  } catch (err) {
    if (err instanceof ConfigError) {
      return res.status(500).json({ ok: false, error: 'Serviço não configurado.', code: 'CONFIG_ERROR' });
    }
    if (err instanceof JiraError) {
      return res.status(502).json({ ok: false, error: `Erro ao consultar o Jira: ${err.message}`, code: 'JIRA_ERROR' });
    }
    throw err;
  }

  const users = rawUsers.map(u => ({
    name:        u.emailAddress || u.name,
    displayName: u.displayName,
    email:       u.emailAddress,
  }));

  return res.status(200).json({ ok: true, users });
};
