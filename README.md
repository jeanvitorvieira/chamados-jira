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

* Filtros por portfólio, vertical, múltiplos responsáveis, tipo de chamado e período.
* **Auto-Search Inteligente** com busca automática ao alterar qualquer filtro.
* Cancelamento de requisições concorrentes usando `AbortController`, evitando race conditions.
* Autocomplete de usuários integrado ao Jira com deduplicação por e-mail.
* Suporte a múltiplos responsáveis simultâneos.
* Tabela de chamados sem responsável com indicador visual de tempo em fila.
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
│   └── sw.js
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
  │     └─ buildJql()
  │     └─ jira.js
  │     └─ mapIssue()
  │
  ├─ GET /api/usuarios
  │
  └─ GET /api/issues
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

* Chamados sem responsável.
* Chamados atribuídos.

Isso simplifica a lógica e permite contagens separadas.

### Polling Híbrido

#### Aba ativa

O polling roda na página principal com acesso direto ao DOM.

#### Aba em segundo plano

O Service Worker assume a responsabilidade e continua monitorando alterações, enviando notificações nativas quando necessário.

---

# Pré-requisitos

* Conta gratuita no Vercel.
* Repositório Git.
* Instância Jira acessível via API.
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

Configure:

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

Retorna chamados abertos agrupados em:

* Sem responsável
* Atribuídos

### Query Parameters

| Parâmetro | Tipo   | Obrigatório | Descrição       |
| --------- | ------ | ----------- | --------------- |
| vertical  | string | Não         | Vertical        |
| portfolio | string | Não         | Portfólio       |
| users     | string | Não         | CSV de usuários |
| typeIds   | string | Não         | CSV de tipos    |
| days      | number | Não         | 0, 30, 60 ou 90 |

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
      "priority": "High",
      "type": "Incidente",
      "assignee": null,
      "updated": "2026-06-01T10:00:00.000-0300",
      "created": "2026-05-30T08:00:00.000-0300",
      "vertical": "Contábil",
      "portfolio": "Portfólio Pequenas Contas",
      "url": "https://jira.empresa.com.br/browse/PROJ-1001"
    }
  ],
  "assigned": [
    {
      "key": "PROJ-1002",
      "summary": "Descrição do chamado atribuído",
      "status": "Em andamento",
      "priority": "Medium",
      "type": "Dúvida",
      "assignee": "Usuário 1",
      "updated": "2026-06-02T09:00:00.000-0300",
      "created": "2026-05-28T14:00:00.000-0300",
      "vertical": "Contábil",
      "portfolio": "Portfólio Pequenas Contas",
      "url": "https://jira.empresa.com.br/browse/PROJ-1002"
    }
  ]
}
```

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

Lista tipos de chamados disponíveis.

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

Autocomplete de usuários.

### Query Parameters

| Parâmetro | Tipo   | Obrigatório |
| --------- | ------ | ----------- |
| q         | string | Sim         |

### Resposta

```json
{
  "ok": true,
  "users": [
    {
      "name": "usuario1",
      "displayName": "Usuário 1",
      "email": "usuario1@empresa.com.br"
    }
  ]
}
```

---

## GET /api/issues

Consulta o status atual de tickets específicos.

### Query Parameters

| Parâmetro | Tipo   | Obrigatório |
| --------- | ------ | ----------- |
| keys      | string | Sim         |

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

Verticais e portfólios são validados contra listas fechadas.

### Higienização Cruzada

As mesmas regras do frontend são reproduzidas no backend para evitar manipulação direta da API.

### Escaping

Strings livres são sanitizadas antes da composição do JQL.

---

## Credenciais Seguras

As credenciais do Jira permanecem exclusivamente nas variáveis de ambiente do Vercel.

---

## Headers HTTP

Aplicados via `vercel.json`:

```http
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy
Cache-Control: no-store
```

---

## Prevenção de XSS

Todo conteúdo externo é escapado antes de ser inserido no DOM.

Exemplos:

* `summary`
* `status`
* `displayName`
* `assignee`

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

## Cobertura

* validateSearchParams
* validateDays
* validateUsers
* validateTypes
* validateUserQuery
* buildJql
* mapIssue
* detectarNovidades
* buildParams
* AbortController
* Consistência Página ↔ Service Worker
* Deduplicação de usuários
* Integração visibilitychange

---

# Customização

## Adicionar Nova Vertical

Em `api/_lib/validate.js`:

```javascript
const VERTICAIS_VALIDAS = new Set([
  'Nova Vertical'
]);
```

Adicionar também no:

```html
<select id="sel-vertical">
```

---

## Adicionar Novo Portfólio

Atualize:

```javascript
PORTFOLIOS_VALIDOS
```

e:

```html
<select id="sel-portfolio">
```

---

## Alterar Intervalo de Polling

### public/index.html

```javascript
var REFRESH_INTERVAL = 60;
```

### public/sw.js

```javascript
const POLL_INTERVAL_MS = 60 * 1000;
```

Mantenha ambos sincronizados.

---

## Alterar Campos Retornados

Editar:

```text
api/chamados.js
```

Atualizando:

* Array `FIELDS`
* Função `mapIssue()`

---

## Tipos Excluídos

Editar:

```javascript
TIPOS_EXCLUIDOS
```

em:

```text
api/tipos.js
```

---

# Scripts

```json
{
  "scripts": {
    "test": "node test_chamados.js"
  }
}
```

Executar:

```bash
npm test
```
