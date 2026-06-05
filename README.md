# 📋 Chamados por Vertical — Betha Sistemas

Painel web para consulta e monitoramento em tempo real de chamados abertos no Jira de Atendimento, com filtros combinados, múltiplos responsáveis, polling automático e notificações nativas do sistema operacional.

---

## Índice

1. [Visão geral](#visão-geral)
2. [Arquitetura](#arquitetura)
3. [Pré-requisitos](#pré-requisitos)
4. [Variáveis de ambiente](#variáveis-de-ambiente)
5. [Deploy no Vercel](#deploy-no-vercel)
6. [Desenvolvimento local](#desenvolvimento-local)
7. [Referência da API](#referência-da-api)
8. [Segurança](#segurança)
9. [Testes](#testes)
10. [Customização](#customização)

---

## Visão geral

O sistema resolve um problema recorrente de atendimento: identificar rapidamente chamados sem responsável ou atribuídos a analistas dentro de um portfólio/vertical específico, sem precisar abrir o Jira manualmente várias vezes ao dia.

**Funcionalidades:**

- Filtros por portfólio, vertical, múltiplos responsáveis, tipo de chamado e período
- Busca automática ao alterar qualquer filtro (sem botão "Buscar")
- Autocomplete de usuários integrado ao Jira, com deduplicação por e-mail (cobre contas duplicadas no Jira)
- Múltiplos responsáveis simultâneos — cada chamado exibe o nome do seu dono na tabela
- Tabela de "Sem responsável" com indicador de tempo na fila (badge colorido por urgência)
- Tabela de "Atribuídos" com coluna de responsável e ordenação por qualquer coluna
- Polling automático a cada 60 segundos com barra de progresso visual
- Notificações nativas do SO (canto da tela) ao detectar novidades no ciclo de polling:
  - Novo chamado sem responsável
  - Mudança de status em chamado atribuído
  - Movimentação (updated alterado com status igual)
  - Chamado atribuído encerrado
- Filtros persistidos via `localStorage` e restaurados com busca automática ao recarregar
- Badge no título da aba com contador de novidades não vistas

---

## Arquitetura

```
chamados-jira/
├── api/                     # Serverless functions (Vercel)
│   ├── _lib/
│   │   ├── jira.js          # Cliente HTTP para a API REST do Jira (auth, timeout, erros)
│   │   └── validate.js      # Sanitização de inputs e prevenção de JQL Injection
│   ├── chamados.js          # GET /api/chamados — busca issues (unassigned + assigned)
│   ├── tipos.js             # GET /api/tipos    — lista tipos de chamado do Jira
│   ├── issues.js            # GET /api/issues   — verifica status de tickets por chave
│   └── usuarios.js          # GET /api/usuarios — autocomplete de usuários
├── public/
│   ├── index.html           # Frontend SPA (HTML/CSS/JS puro, sem framework, sem build)
│   └── sw.js                # Service Worker — exibe notificações nativas via browser
├── test_chamados.js         # Suite de 47 testes mockados (Node.js, sem dependências)
├── package.json
├── vercel.json              # Configuração de deploy e headers de segurança
└── README.md
```

### Fluxo de dados

```
Browser
  │
  ├─ GET /api/tipos  (on load — popula multiselect, dispara busca se filtros restaurados)
  │
  ├─ GET /api/chamados?vertical=X&portfolio=Y&users=a,b&typeIds=10001,10002&days=30
  │     └─→ validate.js     (valida vertical/portfolio contra lista fechada, escapa users)
  │     └─→ buildJql()      (monta 2 JQLs: unassigned + assigned, em paralelo)
  │     └─→ jira.js         (autentica, timeout 15s, normaliza erros HTTP)
  │     └─→ mapIssue()      (DTO limpo: key, summary, status, assignee, priority…)
  │     ← JSON { ok, total, unassigned[], assigned[], totalUnassigned, totalAssigned }
  │
  ├─ GET /api/usuarios?q=jean  (autocomplete com debounce 300ms)
  │
  └─ GET /api/issues?keys=X-1,X-2  (polling: verifica se tickets sumiram e foram encerrados)
```

### Decisões de arquitetura

**Frontend sem framework:** HTML/CSS/JS puro por escolha deliberada. Para uma ferramenta interna de consulta, um framework adicionaria complexidade de build sem benefício real. O resultado é um arquivo único que funciona imediatamente ao abrir.

**Vercel Serverless Functions como proxy:** as credenciais do Jira ficam exclusivamente nas variáveis de ambiente do Vercel. O browser nunca as vê. As funções recebem a requisição, chamam o Jira autenticadas e devolvem apenas os dados necessários.

**Dois JQLs paralelos:** a busca de chamados executa duas queries independentes em `Promise.all` — uma para sem responsável, outra para os atribuídos — evitando lógica de OR no JQL e permitindo contagens separadas.

**Polling no frontend (não SW):** o polling de 60s roda no thread principal da página para ter acesso direto ao DOM (barra de progresso, banners). O Service Worker é usado exclusivamente para exibir notificações nativas, que funcionam mesmo com a aba minimizada.

---

## Pré-requisitos

- Conta gratuita no [Vercel](https://vercel.com) (login com GitHub, GitLab ou Bitbucket)
- Repositório Git (GitHub recomendado)
- Credenciais de acesso à API do Jira Server:
  - URL base da instância (ex: `https://atendimento.betha.com.br`)
  - Usuário de serviço dedicado e sua senha
- Node.js 18+ (apenas para desenvolvimento local e testes)

> **Recomendação:** use um usuário de serviço dedicado para a integração, com permissão apenas de leitura nos projetos relevantes. Nunca use uma conta pessoal em produção.

---

## Variáveis de ambiente

| Variável        | Obrigatória | Descrição                                    | Exemplo                            |
|-----------------|-------------|----------------------------------------------|------------------------------------|
| `JIRA_URL`      | ✅          | URL base da instância Jira (sem barra final) | `https://atendimento.betha.com.br` |
| `JIRA_USER`     | ✅          | Username do usuário de serviço no Jira       | `mcpintegracao`                    |
| `JIRA_PASSWORD` | ✅          | Senha do usuário de serviço                  | `*****`                            |

As variáveis são lidas em runtime pelas serverless functions e **nunca chegam ao browser**.

---

## Deploy no Vercel

### 1. Suba o código para o GitHub

```bash
cd chamados-jira
git init
git add .
git commit -m "chore: initial commit"
git remote add origin https://github.com/seu-usuario/chamados-jira.git
git push -u origin main
```

### 2. Importe no Vercel

1. Acesse [vercel.com/new](https://vercel.com/new)
2. Clique em **"Import Git Repository"** e selecione o repositório
3. Mantenha todas as configurações padrão (Framework: Other)
4. Clique em **Deploy**

### 3. Configure as variáveis de ambiente

1. No dashboard do Vercel: **Settings → Environment Variables**
2. Adicione as três variáveis da tabela acima
3. Marque os ambientes: **Production**, **Preview** e **Development**

### 4. Redeploy

Após salvar as variáveis: **Deployments → ⋯ → Redeploy**.

---

## Desenvolvimento local

```bash
# Instala a CLI do Vercel
npm install

# Cria o arquivo de variáveis locais (nunca commitar este arquivo)
cp .env.example .env.local
# Edite .env.local com suas credenciais reais

# Inicia o servidor local (emula o ambiente Vercel com hot reload)
npm run dev
# Acesse http://localhost:3000
```

Crie o arquivo `.env.example` com:

```
JIRA_URL=https://atendimento.betha.com.br
JIRA_USER=
JIRA_PASSWORD=
```

---

## Referência da API

### `GET /api/chamados`

Retorna issues abertas filtradas pelos parâmetros informados, separadas em dois grupos: sem responsável e atribuídas.

**Parâmetros de query:**

| Parâmetro  | Tipo   | Obrigatório | Descrição                                                          |
|------------|--------|-------------|--------------------------------------------------------------------|
| `vertical` | string | Não         | Nome da vertical (deve estar na lista válida em `validate.js`)     |
| `portfolio`| string | Não         | Nome do portfólio (deve estar na lista válida em `validate.js`)    |
| `users`    | string | Não         | CSV de usernames do Jira (ex: `jean.vieira,marlon.ern`), máx. 10  |
| `typeIds`  | string | Não         | CSV de IDs numéricos de tipo de issue (ex: `10001,10002`)          |
| `days`     | number | Não         | Período em dias: `0` (qualquer data), `30`, `60` ou `90`           |

Se `users` for omitido, a seção `assigned` retorna vazia. Pelo menos 2 parâmetros preenchidos são exigidos pelo frontend antes de disparar a requisição.

**Resposta de sucesso (200):**

```json
{
  "ok": true,
  "total": 51,
  "totalUnassigned": 8,
  "totalAssigned": 43,
  "unassigned": [
    {
      "key": "BTHSC-321508",
      "summary": "Empenho: Não é permitido número duplicado",
      "status": "Aguardando Manutenção",
      "priority": "High",
      "type": "Incidente",
      "assignee": null,
      "updated": "2026-06-02T08:04:49.000-0300",
      "created": "2026-06-01T11:55:53.000-0300",
      "vertical": "Contábil",
      "portfolio": "Portfólio Pequenas Contas",
      "url": "https://atendimento.betha.com.br/browse/BTHSC-321508"
    }
  ],
  "assigned": [ /* mesma estrutura, com assignee preenchido */ ]
}
```

**Respostas de erro:**

| Status | `code`               | Causa                                               |
|--------|----------------------|-----------------------------------------------------|
| 400    | `INVALID_PARAMS`     | Vertical ou portfólio fora da lista permitida       |
| 400    | `INVALID_FILTER`     | Tipo de issue não existe no Jira                    |
| 405    | `METHOD_NOT_ALLOWED` | Método HTTP diferente de GET                        |
| 500    | `CONFIG_ERROR`       | Variáveis de ambiente não configuradas              |
| 502    | `JIRA_ERROR`         | Erro retornado pela API do Jira                     |
| 504    | `TIMEOUT`            | Consulta ao Jira excedeu 15s                        |

---

### `GET /api/tipos`

Retorna os tipos de issue disponíveis na instância Jira, agrupados por nome (tipos homônimos têm múltiplos IDs consolidados). Resposta cacheada por 1 hora.

**Resposta de sucesso (200):**

```json
{
  "ok": true,
  "tipos": [
    { "name": "Dúvida",    "ids": ["10001"] },
    { "name": "Incidente", "ids": ["10002", "10015"] }
  ]
}
```

---

### `GET /api/usuarios`

Busca usuários no Jira por nome ou e-mail. Usado pelo autocomplete do frontend (debounce de 300ms, mín. 2 caracteres).

> **Nota:** o Jira pode retornar dois registros para o mesmo usuário (username e e-mail como username). O frontend deduplica automaticamente por e-mail antes de exibir na lista.

**Parâmetros de query:**

| Parâmetro | Tipo   | Obrigatório | Descrição                          |
|-----------|--------|-------------|------------------------------------|
| `q`       | string | Sim         | Texto de busca (mín. 2 caracteres) |

**Resposta de sucesso (200):**

```json
{
  "ok": true,
  "users": [
    {
      "name": "jean.vieira",
      "displayName": "Jean Vitor Vieira",
      "email": "jean.vieira@betha.com.br"
    }
  ]
}
```

---

### `GET /api/issues`

Verifica o status atual de tickets específicos por chave. Usado pelo polling para detectar chamados atribuídos que foram encerrados.

**Parâmetros de query:**

| Parâmetro | Tipo   | Obrigatório | Descrição                                  |
|-----------|--------|-------------|--------------------------------------------|
| `keys`    | string | Sim         | CSV de chaves Jira (ex: `X-1,X-2`), máx. 20 |

**Resposta de sucesso (200):**

```json
{
  "ok": true,
  "issues": [
    {
      "key": "BTHSC-321508",
      "status": "Resolvido",
      "statusCat": "done",
      "assignee": "Jean Vitor Vieira"
    }
  ]
}
```

---

## Segurança

### Proteção contra JQL Injection

Valores recebidos via query string nunca são interpolados diretamente no JQL. O módulo `validate.js` aplica duas camadas:

1. **Lista fechada** para `vertical` e `portfolio` — qualquer valor fora do Set predefinido é rejeitado com HTTP 400.
2. **Escaping** para `users` e `types` — aspas duplas e barras invertidas são escapadas antes de entrar na query JQL.
3. **Filtro por ID** para tipos — o frontend envia `typeIds` (IDs numéricos), não nomes, eliminando risco de injeção via nomes de tipo.

### Credenciais seguras

As credenciais do Jira vivem exclusivamente como variáveis de ambiente no Vercel. A função serverless as lê em runtime e nunca as repassa ao cliente.

### Headers HTTP

O `vercel.json` aplica headers de segurança em todas as respostas:

- `X-Content-Type-Options: nosniff` — evita MIME sniffing
- `X-Frame-Options: SAMEORIGIN` — previne clickjacking
- `Referrer-Policy: strict-origin-when-cross-origin` — limita vazamento de URL
- `Permissions-Policy` — desabilita câmera, microfone e geolocalização
- `Cache-Control: no-store` nas rotas de API — impede cache de dados sensíveis

### Prevenção de XSS

Todo dado externo (sumário, nome de usuário, status) é escapado via `escHtml()` antes de ser inserido no DOM. Nomes de usuário no autocomplete usam `textContent` (não `innerHTML`).

---

## Testes

O projeto inclui uma suite de 47 testes mockados em `test_chamados.js`, sem dependências externas:

```bash
node test_chamados.js
```

Cobertura:

- `validateSearchParams`, `validateDays`, `validateUsers`, `validateTypes`, `validateUserQuery`
- `buildJql` — 7 cenários incluindo múltiplos usuários, typeIds vs types, filtro de data
- `mapIssue` — campos normais e campos ausentes com fallback
- `detectarNovidades` — 7 cenários: novo sem responsável, retorno para fila, mudança de status, movimentação, sem baseline
- Dedup do autocomplete — 4 cenários incluindo o caso real Maycon/Marlon (duplicata por e-mail)
- Validação de filtros (`preenchidos`) — 5 cenários
- Alinhamento de colunas das tabelas

---

## Customização

### Adicionar uma nova vertical

Edite `api/_lib/validate.js` e adicione o valor ao Set `VERTICAIS_VALIDAS`:

```js
const VERTICAIS_VALIDAS = new Set([
  // ... valores existentes ...
  'Nova Vertical',
]);
```

Depois adicione a `<option>` correspondente no `<select id="sel-vertical">` do `public/index.html`.

### Adicionar um novo portfólio

Mesmo processo: edite `PORTFOLIOS_VALIDOS` em `validate.js` e o `<select id="sel-portfolio">` no `index.html`.

### Alterar o intervalo de polling

Em `public/index.html`, altere a constante:

```js
var REFRESH_INTERVAL = 60; // segundos — altere aqui
```

### Alterar os campos retornados por chamado

Em `api/chamados.js`, edite o array `FIELDS` com os IDs dos campos Jira desejados e atualize a função `mapIssue()` para mapeá-los no DTO de saída.

### Adicionar ou remover tipos excluídos

Em `api/tipos.js`, edite o Set `TIPOS_EXCLUIDOS` com os nomes exatos dos tipos que não devem aparecer no filtro.
