/**
 * GET /api/tipos
 *
 * Retorna os tipos de issue disponíveis na instância Jira.
 * Usado pelo frontend para popular o multi-select de tipo de chamado.
 *
 * Resposta 200:
 *   { ok: true, tipos: string[] }
 */

const { get, JiraError, ConfigError } = require('./_lib/jira');

// Tipos sem sentido no contexto de atendimento ao cliente
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

  try {
    const data  = await get('/rest/api/2/issuetype');
    // Agrupa por nome — coleta todos os IDs de tipos homônimos (ex: dois "Incidente")
    // Filtrar por ID no JQL garante que TODOS os chamados do tipo sejam retornados
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

    // Cache de 1h — tipos mudam raramente
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    return res.status(200).json({ ok: true, tipos });
  } catch (err) {
    if (err instanceof ConfigError) {
      return res.status(500).json({ ok: false, error: 'Serviço não configurado.', code: 'CONFIG_ERROR' });
    }
    return res.status(502).json({ ok: false, error: 'Não foi possível buscar os tipos.', code: 'JIRA_ERROR' });
  }
};
