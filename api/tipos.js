const { get, JiraError, ConfigError } = require('./_lib/jira');
const { TIPOS_EXCLUIDOS } = require('./_lib/tipos-excluidos');


module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const data  = await get('/rest/api/2/issuetype');
    const grouped = new Map();
    data
      .filter(t => !t.subtask && !TIPOS_EXCLUIDOS.has(t.name))
      .forEach(t => {
        if (!grouped.has(t.name)) grouped.set(t.name, []);
        grouped.get(t.name).push(t.id);
      });

    const tipos = Array.from(grouped.entries())
      .map(([name, ids]) => ({ name, ids }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    return res.status(200).json({ ok: true, tipos });
  } catch (err) {
    if (err instanceof ConfigError) {
      return res.status(500).json({ ok: false, error: 'Serviço não configurado.', code: 'CONFIG_ERROR' });
    }
    return res.status(502).json({ ok: false, error: 'Não foi possível buscar os tipos.', code: 'JIRA_ERROR' });
  }
};