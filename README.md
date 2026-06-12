# 📋 Chamados por Vertical

Painel web para consulta e monitoramento em tempo real de chamados abertos no Jira de Atendimento, com filtros combinados, múltiplos responsáveis, polling automático e notificações nativas do sistema operacional.

---

# Índice

* [Visão Geral](#visão-geral)
* [Arquitetura](#arquitetura)
* [Pré-requisitos](#pré-requisitos)
* [Variáveis de Ambiente](#variáveis-de-ambiente)
* [Deploy no Vercel](#deploy-no-vercel)
* [Desenvolvimento Local](#desenvolvimento-local)
* [Referência da API](#referência-da-api)
* [Segurança](#segurança)
* [Testes](#testes)
* [Customização](#customização)

---

# Visão Geral

O sistema resolve um problema recorrente de atendimento: identificar rapidamente chamados sem responsável ou atribuídos a analistas dentro de um portfólio/vertical específico, sem precisar abrir o Jira manualmente diversas vezes ao dia.

## Funcionalidades

* Filtros por portfólio, vertical, equipe responsável, múltiplos responsáveis, tipo de chamado e período.
* **Auto-Search Inteligente** com busca automática ao alterar qualquer filtro.
* Cancelamento de requisições concorrentes usando `AbortController`, evitando race conditions.
* Autocomplete de usuários integrado ao Jira com deduplicação por e-mail — busca simultânea por username e nome completo.
* Suporte a múltiplos responsáveis simultâneos.
* Tabela de chamados sem responsável com coluna de equipe e indicador visual de tempo em fila.
* Tabela de chamados atribuídos com coluna de responsável e ordenação.
* Polling automático a cada 60 segundos com barra de progresso visual.
* Notificações nativas do sistema operacional:

  * Novo chamado sem responsável.
  * Mudança de status em chamado atribuído.
  * Movimentação em chamado atribuído.
  * Encerramento de chamado atribuído.
* Persistência de filtros via `localStorage`.
* Badge no título da aba com contador de novidades não visualizadas.

---

# Arquitetura

```text
chamados-jira/
├── api/
│   ├── _lib/
│   │   ├── jira.js
│   │   └── validate.js
│   ├── chamados.js
│   ├── tipos.js
│   ├── issues.js
│   └── usuarios.js
├── public/
│   ├── index.html
│   ├── sw.js
│   └── timer-worker.js
├── test_chamados.js
├── package.json
├── vercel.json
└── README.md
```

## Fluxo de Dados

```text
Browser
  │
  ├─ GET /api/tipos
  │
  ├─ GET /api/chamados
  │     └─ validate.js
  │     └─ buildJql()       ← dois JQLs paralelos: unassigned + assigned
  │     └─ jira.js
  │     └─ mapIssue()
  │
  ├─ GET /api/usuarios      ← busca dupla: username + displayName
  │
  └─ GET /api/issues        ← verifica tickets desaparecidos
```

## Decisões de Arquitetura

### Frontend sem Framework

HTML, CSS e JavaScript puros por escolha deliberada. Para uma ferramenta interna de consulta, frameworks adicionariam complexidade sem ganhos significativos.

### Vercel Serverless Functions

As credenciais do Jira permanecem exclusivamente no backend. O navegador nunca recebe informações sensíveis.

### AbortController

Requisições anteriores são canceladas automaticamente quando filtros são alterados rapidamente.

### Dois JQLs Paralelos

A busca executa duas consultas independentes em paralelo:

* Chamados sem responsável (`assignee is EMPTY`).
* Chamados atribuídos (`assignee in (...)`).

Isso simplifica a lógica e permite contagens separadas.

### Identificador de Usuário via E-mail

O Jira Server desta instância usa o endereço de e-mail como identificador no campo `assignee` do JQL. Por isso, `/api/usuarios` retorna `name = emailAddress || username`, e é esse valor que vai para a query `users=` e para o JQL gerado.

### Polling com Web Worker

O timer de polling roda em um `timer-worker.js` isolado, imune ao throttling de timers que o navegador aplica em abas ocultas. A página principal recebe ticks via `postMessage` e executa a busca no DOM.

---

# Pré-requisitos

* Conta gratuita no Vercel.
* Repositório Git.
* Instância Jira acessível via API REST v2.
* Usuário de serviço com permissão de leitura.
* Node.js 18+.

> Recomenda-se utilizar um usuário de serviço dedicado e nunca uma conta pessoal em produção.

---

# Variáveis de Ambiente

| Variável      | Obrigatória | Descrição          | Exemplo                     |
| ------------- | ----------- | ------------------ | --------------------------- |
| JIRA_URL      | ✅           | URL base do Jira   | https://jira.empresa.com.br |
| JIRA_USER     | ✅           | Usuário de serviço | usuario-servico             |
| JIRA_PASSWORD | ✅           | Senha do usuário   | *****                       |

As variáveis são utilizadas apenas pelas funções serverless.

---

# Deploy no Vercel

## 1. Subir código para o GitHub

```bash
cd chamados-jira

git init
git add .
git commit -m "chore: initial commit"

git remote add origin https://github.com/seu-usuario/chamados-jira.git
git push -u origin main
```

## 2. Importar no Vercel

1. Acesse `vercel.com/new`
2. Clique em **Import Git Repository**
3. Selecione o repositório
4. Mantenha o framework como **Other**
5. Clique em **Deploy**

## 3. Configurar variáveis

Dashboard → Settings → Environment Variables

Configure para os ambientes:

* Production
* Preview
* Development

## 4. Redeploy

Após configurar as variáveis:

```text
Deployments → ⋯ → Redeploy
```

---

# Desenvolvimento Local

## Instalação

```bash
npm install
```

## Arquivo de ambiente

```bash
cp .env.example .env.local
```

Preencha:

```env
JIRA_URL=https://jira.empresa.com.br
JIRA_USER=
JIRA_PASSWORD=
```

## Executar

```bash
npm run dev
```

Acesse:

```text
http://localhost:3000
```

---

# Referência da API

## GET /api/chamados

Retorna chamados abertos agrupados em sem responsável e atribuídos.

### Query Parameters

| Parâmetro   | Tipo   | Obrigatório | Descrição                              |
| ----------- | ------ | ----------- | -------------------------------------- |
| vertical    | string | Não         | Vertical (whitelist)                   |
| portfolio   | string | Não         | Portfólio (whitelist)                  |
| cf[21500]   | string | Não         | Equipe Responsável (whitelist)         |
| users       | string | Não         | CSV de e-mails/usernames — máx. 10     |
| typeIds     | string | Não         | CSV de IDs ou nomes de tipo — máx. 150 |
| days        | number | Não         | Período: 0, 30, 60 ou 90               |

> **Nota sobre `typeIds`:** quando omitido ou quando todos os tipos estão selecionados, o filtro não é aplicado e todos os tipos são retornados. Envie apenas em seleção parcial.

### Resposta (200)

```json
{
  "ok": true,
  "total": 12,
  "totalUnassigned": 4,
  "totalAssigned": 8,
  "unassigned": [
    {
      "key": "PROJ-1001",
      "summary": "Descrição do chamado sem responsável",
      "status": "Aguardando Manutenção",
      "statusCat": "new",
      "priority": "High",
      "type": "Incidente",
      "assignee": null,
      "updated": "2026-06-01T10:00:00.000-0300",
      "created": "2026-05-30T08:00:00.000-0300",
      "vertical": "Contábil",
      "portfolio": "Portfólio Pequenas Contas",
      "equipe": "Suporte",
      "url": "https://jira.empresa.com.br/browse/PROJ-1001"
    }
  ],
  "assigned": [
    {
      "key": "PROJ-1002",
      "summary": "Descrição do chamado atribuído",
      "status": "Em andamento",
      "statusCat": "indeterminate",
      "priority": "Medium",
      "type": "Dúvida",
      "assignee": "Usuário 1",
      "updated": "2026-06-02T09:00:00.000-0300",
      "created": "2026-05-28T14:00:00.000-0300",
      "vertical": "Contábil",
      "portfolio": "Portfólio Pequenas Contas",
      "equipe": "Suporte",
      "url": "https://jira.empresa.com.br/browse/PROJ-1002"
    }
  ]
}
```

> **Nota sobre `statusCat`:** usa a chave da categoria do Jira — `"new"`, `"indeterminate"` ou `"done"` (sempre minúsculo).

### Possíveis Erros

| Status | Code               | Descrição           |
| ------ | ------------------ | ------------------- |
| 400    | INVALID_PARAMS     | Filtros inválidos   |
| 400    | INVALID_FILTER     | Tipo inexistente    |
| 405    | METHOD_NOT_ALLOWED | Método inválido     |
| 500    | CONFIG_ERROR       | Variáveis ausentes  |
| 502    | JIRA_ERROR         | Erro Jira           |
| 504    | TIMEOUT            | Timeout da consulta |

---

## GET /api/tipos

Lista tipos de chamados disponíveis, agrupados por nome com seus IDs.

### Resposta

```json
{
  "ok": true,
  "tipos": [
    {
      "name": "Dúvida",
      "ids": ["10001"]
    },
    {
      "name": "Incidente",
      "ids": ["10002", "10015"]
    }
  ]
}
```

---

## GET /api/usuarios

Autocomplete de usuários. Realiza busca simultânea por `username` e por `displayName` no Jira, deduplicando os resultados por e-mail.

### Query Parameters

| Parâmetro | Tipo   | Obrigatório | Descrição                    |
| --------- | ------ | ----------- | ---------------------------- |
| q         | string | Sim         | Texto de busca (mín. 2 chars) |

### Resposta

```json
{
  "ok": true,
  "users": [
    {
      "name": "usuario1@empresa.com.br",
      "displayName": "Usuário 1",
      "email": "usuario1@empresa.com.br"
    }
  ]
}
```

> **Importante:** o campo `name` retorna o `emailAddress` do usuário quando disponível, pois esta instância do Jira Server usa e-mail como identificador no campo `assignee` do JQL. É este valor que deve ser passado no parâmetro `users` de `/api/chamados`.

---

## GET /api/issues

Consulta o status atual de tickets específicos por chave. Usado internamente para verificar se chamados que sumiram dos resultados foram encerrados.

### Query Parameters

| Parâmetro | Tipo   | Obrigatório | Descrição                       |
| --------- | ------ | ----------- | ------------------------------- |
| keys      | string | Sim         | CSV de chaves Jira — máx. 20    |

### Resposta

```json
{
  "ok": true,
  "issues": [
    {
      "key": "PROJ-1001",
      "status": "Resolvido",
      "statusCat": "done",
      "assignee": "Usuário 1"
    }
  ]
}
```

---

# Segurança

## Proteção contra JQL Injection

### Whitelist

Verticais, portfólios e equipes são validados contra listas fechadas em `validate.js`. Qualquer valor fora da lista retorna HTTP 400.

### Higienização Cruzada

A mesma regra que neutraliza o portfólio para as verticais Saúde e Educação é aplicada tanto no frontend quanto no backend, impedindo bypass via manipulação direta da URL da API.

### Escaping

Strings livres (nomes de usuário, tipos alfanuméricos) são sanitizadas com `escapeJqlValue()` antes de serem interpoladas no JQL.

---

## Credenciais Seguras

As credenciais do Jira permanecem exclusivamente nas variáveis de ambiente do Vercel. O navegador nunca as recebe.

---

## Headers HTTP

Aplicados via `vercel.json`:

```http
X-Content-Type-Options: nosniff
X-Frame-Options: DENY (API) / SAMEORIGIN (frontend)
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cache-Control: no-store
```

---

## Prevenção de XSS

Todo conteúdo externo é escapado com `escHtml()` antes de ser inserido no DOM. Elementos interativos (tags de usuário) são criados via `createElement` + `addEventListener`, sem `innerHTML` com dados externos.

Campos escapados:

* `summary`
* `status`
* `displayName`
* `assignee`
* `equipe`
* `vertical`
* `portfolio`

---

# Testes

Executar:

```bash
node test_chamados.js
```

ou:

```bash
npm test
```

## Cobertura (57 testes)

* `swDetect` — detecção de novos, status alterado, movimentação, desaparecidos
* `buildParams` — montagem de query string com equipe, typeIds parcial/total, days
* `preenchidos` — validação mínima de filtros incluindo equipe e regras Saúde/Educação
* `mapIssue` — mapeamento de `statusCat` via `.key` (`"done"`, `"new"`, `"indeterminate"`)
* Deduplicação de usuários por e-mail (autocomplete)
* Mapeamento de `name = emailAddress` para uso no JQL
* Consistência Página ↔ Service Worker
* AbortController — abort silencioso e manual
* Timer generation — descarte de ticks de ciclos anteriores
* `sortState` — reset em busca manual, preservação em refresh silencioso
* Resiliência do baseline a exceções em `detectarNovidades`
* Integração `visibilitychange`

---

# Customização

## Adicionar Nova Vertical

Em `api/_lib/validate.js`:

```javascript
const VERTICAIS_VALIDAS = new Set([
  // ...existentes...
  'Nova Vertical'
]);
```

Adicionar também no `<select id="sel-vertical">` em `public/index.html`.

---

## Adicionar Novo Portfólio

Em `api/_lib/validate.js`:

```javascript
const PORTFOLIOS_VALIDOS = new Set([
  // ...existentes...
  'Portfólio Novo'
]);
```

Adicionar também no `<select id="sel-portfolio">` em `public/index.html`.

---

## Adicionar Nova Equipe

Em `api/_lib/validate.js`:

```javascript
const EQUIPES_VALIDAS = new Set([
  // ...existentes...
  'Nova Equipe'
]);
```

Adicionar também no `<select id="sel-equipe">` em `public/index.html`.

---

## Alterar Intervalo de Polling

Em `public/index.html`:

```javascript
var REFRESH_INTERVAL = 60; // segundos
```

Em `public/timer-worker.js` (se aplicável):

```javascript
// O intervalo é enviado pela página via postMessage — não há constante separada.
```

---

## Alterar Campos Retornados

Edite `api/chamados.js`:

* Array `FIELDS` — adicione o `customfield_XXXXX` desejado.
* Função `mapIssue()` — mapeie o novo campo no objeto retornado.

---

## Tipos Excluídos

Edite `TIPOS_EXCLUIDOS` em `api/tipos.js` para ocultar tipos do seletor sem removê-los do Jira.

---

# Scripts

```json
{
  "scripts": {
    "test": "node test_chamados.js"
  }
}
```

```bash
npm test
```
