/**
 * GET /api/tipos
 *
 * Retorna os tipos de issue disponíveis na instância Jira.
 * Usado pelo frontend para popular o multi-select de tipo de chamado.
 *
 * Resposta 200:
 *   { ok: true, tipos: string[] }
 */

const { JiraError, ConfigError } = require('./_lib/jira');

// Tipos que não fazem sentido exibir no contexto de atendimento
const TIPOS_EXCLUIDOS = new Set([
  'Sub-tarefa', 'Melhoria (sub-tarefa)', 'Serviço (sub-tarefa)',
  'Ação (sub-tarefa)', 'Pre-Condition', 'Não utilizar',
  'Suporte (NÃO USAR - Use Dúvida)',
  'Análise de dados (NÃO USAR - Use Tratamento de Dados)',
  'Alteração de dados (NÃO USAR - Use Tratamento de Dados)',
  'Migração de Dados (NÃO USAR - Use Tratamento de Dados)',
  'Fora de escopo (NÃO USAR - Use Dúvida)',
  'Treinamento de Implantação old',
]);

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' });
  }

  const JIRA_URL      = process.env.JIRA_URL;
  const JIRA_USER     = process.env.JIRA_USER;
  const JIRA_PASSWORD = process.env.JIRA_PASSWORD;

  if (!JIRA_URL || !JIRA_USER || !JIRA_PASSWORD) {
    return res.status(500).json({ ok: false, error: 'Serviço não configurado.', code: 'CONFIG_ERROR' });
  }

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 8000);

  try {
    const credentials = 'Basic ' + Buffer.from(`${JIRA_USER}:${JIRA_PASSWORD}`).toString('base64');
    const r = await fetch(`${JIRA_URL}/rest/api/2/issuetype`, {
      signal: controller.signal,
      headers: { 'Authorization': credentials, 'Accept': 'application/json' },
    });

    if (!r.ok) {
      return res.status(502).json({ ok: false, error: 'Não foi possível buscar os tipos.', code: 'JIRA_ERROR' });
    }

    const data = await r.json();
    const tipos = data
      .filter(t => !t.subtask && !TIPOS_EXCLUIDOS.has(t.name))
      .map(t => t.name)
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));

    return res.status(200).json({ ok: true, tipos });
  } catch (err) {
    return res.status(502).json({ ok: false, error: 'Não foi possível buscar os tipos.', code: 'JIRA_ERROR' });
  } finally {
    clearTimeout(timeoutId);
  }
};
