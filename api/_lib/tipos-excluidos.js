const NOMES_TIPOS_EXCLUIDOS = Object.freeze([
  'Sub-tarefa', 'Melhoria (sub-tarefa)', 'Serviço (sub-tarefa)',
  'Ação (sub-tarefa)', 'Pre-Condition', 'Não utilizar',
  'Suporte (NÃO USAR - Use Dúvida)',
  'Análise de dados (NÃO USAR - Use Tratamento de Dados)',
  'Alteração de dados (NÃO USAR - Use Tratamento de Dados)',
  'Migração de Dados (NÃO USAR - Use Tratamento de Dados)',
  'Fora de escopo (NÃO USAR - Use Dúvida)',
  'Treinamento de Implantação old',
]);

const TIPOS_EXCLUIDOS = new Set(NOMES_TIPOS_EXCLUIDOS);

module.exports = { NOMES_TIPOS_EXCLUIDOS, TIPOS_EXCLUIDOS };