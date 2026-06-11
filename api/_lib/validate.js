const TIPOS_PERMITIDOS = new Set([]);

const VERTICAIS_VALIDAS = new Set([
  'Arrecadação', 'Atendimento', 'Contratos', 'Contábil',
  'Educação', 'Pessoal', 'Saúde',
]);

const PORTFOLIOS_VALIDOS = new Set([
  'Portfólio Pequenas Contas',
  'Portfólio Médias Contas',
  'Portfólio SC/MG',
  'Portfólio SC/SP',
]);

const EQUIPES_VALIDAS = new Set([
  'Suporte',
  'Serviço',
  'Produto',
]);

function escapeJqlValue(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function validateTypes(typesParam) {
  if (!typesParam || !typesParam.trim()) return [];
  return typesParam.split(',')
    .map(t => t.trim())
    .filter(Boolean)
    .slice(0, 50)
    .map(t => escapeJqlValue(t));
}

const DIAS_VALIDOS = new Set([0, 30, 60, 90]);

function validateDays(daysParam) {
  const n = parseInt(daysParam, 10);
  if (isNaN(n)) return 0;
  return DIAS_VALIDOS.has(n) ? n : 0;
}

function validateSearchParams(queryParams) {
  const vertical = queryParams.vertical;
  const portfolio = queryParams.portfolio;
  const user = queryParams.user;

  const equipe = queryParams.equipe || queryParams['cf[21500]'];

  if (vertical !== undefined && vertical !== '') {
    if (!VERTICAIS_VALIDAS.has(vertical)) {
      throw new ValidationError(`Vertical inválida: "${vertical}"`);
    }
  }

  if (portfolio !== undefined && portfolio !== '') {
    if (!PORTFOLIOS_VALIDOS.has(portfolio)) {
      throw new ValidationError(`Portfólio inválido: "${portfolio}"`);
    }
  }

  if (equipe !== undefined && equipe !== '') {
    if (!EQUIPES_VALIDAS.has(equipe)) {
      throw new ValidationError(`Equipe inválida: "${equipe}"`);
    }
  }

  let safePortfolio = portfolio || null;
  const vLower = (vertical || '').toLowerCase();
  if (vLower === 'saúde' || vLower === 'educação') {
    safePortfolio = null;
  }

  let safeUser = null;
  if (user && user.trim().length > 0) {
    if (user.length > 200) {
      throw new ValidationError('Parâmetro "user" excede o limite de 200 caracteres.');
    }
    safeUser = escapeJqlValue(user.trim());
  }

  return {
    vertical: vertical || null,
    portfolio: safePortfolio,
    user: safeUser,
    equipe: equipe || null,
  };
}

function validateUserQuery(q) {
  if (!q || q.trim().length < 2) {
    throw new ValidationError('O parâmetro "q" deve ter ao menos 2 caracteres.');
  }
  if (q.length > 100) {
    throw new ValidationError('O parâmetro "q" excede o limite de 100 caracteres.');
  }
  return q.trim();
}

function validateUsers(usersParam) {
  if (!usersParam || !usersParam.trim()) return [];
  return usersParam.split(',')
    .map(u => u.trim())
    .filter(Boolean)
    .slice(0, 10)
    .filter(u => u.length <= 200)
    .map(u => escapeJqlValue(u));
}

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
  validateDays,
  validateUsers,
  ValidationError,
  TIPOS_PERMITIDOS,
  VERTICAIS_VALIDAS,
  PORTFOLIOS_VALIDOS,
  EQUIPES_VALIDAS,
};