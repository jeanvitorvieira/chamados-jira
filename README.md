# 📋 Chamados por Vertical

Painel web para consulta e monitoramento em tempo real de chamados abertos no Jira de Atendimento, com filtros combinados, múltiplos responsáveis, polling automático e notificações nativas do sistema operacional.

---

# Índice

* [Visão Geral](#visão-geral)
* [Arquitetura](#arquitetura)
* [Performance](#performance)
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
* Tabela de chamados sem responsável com coluna de equipe e indicador visual de tempo em fila (atualizado automaticamente, sem recarregar a tabela).
* Tabela de chamados atribuídos com coluna de responsável e ordenação.
* Polling automático a cada 60 segundos com barra de progresso visual.
* **Paginação automática** das consultas ao Jira (até 300 chamados por lista) e **aviso de resultados incompletos** com o total real do Jira.
* **Cache de curta duração no servidor** com deduplicação de consultas simultâneas.
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
  │     └─ getExcludedTypeIds()   ← IDs dos tipos obsoletos (cache de 1h)
  │     └─ buildJql()             ← dois JQLs paralelos: unassigned + assigned
  │     └─ cachedSearch()         ← cache (TTL 30s) + deduplicação de consultas
  │           └─ jira.js → searchAllIssues()   ← 1ª página + demais em paralelo
  │     └─ mapIssue()             ← + filtros de parceiros / prestação de contas
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

Isso simplifica a lógica e permite contagens e truncagem separadas por lista.

### Identificador de Usuário via E-mail

O Jira Server desta instância usa o endereço de e-mail como identificador no campo `assignee` do JQL. Por isso, `/api/usuarios` retorna `name = emailAddress || username`, e é esse valor que vai para a query `users=` e para o JQL gerado.

### Polling com Web Worker

O timer de polling roda em um `timer-worker.js` isolado, imune ao throttling de timers que o navegador aplica em abas ocultas. A página principal recebe ticks via `postMessage` e executa a busca no DOM.

### Cache e Deduplicação no Servidor

`api/chamados.js` guarda a *promise* de cada consulta ao Jira, indexada pelo JQL completo:

* **Cache:** a mesma consulta dentro do TTL (30s por padrão) é respondida da memória.
* **Deduplicação:** se várias pessoas pedirem a mesma consulta ao mesmo tempo, só uma chamada vai ao Jira.
* **Falhas não são cacheadas:** um timeout ou 502 não "gruda" para os próximos usuários.
* **Busca manual fura o cache:** o front envia `fresh=1` quando o usuário clica em buscar ou muda um filtro; o resultado novo realimenta o cache. O polling automático não envia `fresh` e aproveita o cache.
* O cache vive na memória da instância serverless. Em instância fria ele começa vazio; isso nunca piora o comportamento, apenas deixa de ajudar.
* O header de resposta `X-Cache: HIT|MISS` indica se a resposta veio do cache (útil na aba Network do navegador).

### Paginação e Total Real

`searchAllIssues` (em `api/_lib/jira.js`) busca a primeira página, descobre o `total` real do Jira e busca as demais em paralelo, respeitando um teto (`JIRA_MAX_ISSUES`, padrão 300) e o `maxResults` que o servidor realmente aplicou. A resposta de `/api/chamados` informa quantos chamados existem no Jira (`jiraTotal*`), quantos foram carregados (`loaded*`) e se a lista foi truncada (`truncated*`), e o front exibe o aviso de "Resultados incompletos". O `ORDER BY` tem `key ASC` como desempate para a paginação ser estável.

### Quais Filtros Rodam no JQL e Quais no Node

| Filtro | Onde roda | Motivo |
| ------ | --------- | ------ |
| Vertical, portfólio, equipe, período, responsável | JQL | Campos com valores exatos |
| Tipos obsoletos ("NÃO USAR", "Pre-Condition"...) | JQL (por ID) + Node (rede de segurança) | IDs resolvidos via `/issuetype`; um nome inexistente no JQL derrubaria a consulta inteira com HTTP 400 |
| Parceiros (`security`) | Node | O JQL só compara o nível de segurança por nome exato e não existe "contém" |
| Prestação de contas (`customfield_10335`) | Node | A regra é "texto contém rótulo"; o operador `~` do JQL é busca de texto tokenizada, com semântica diferente, e poderia esconder chamados válidos |

Como parceiros e prestação de contas são filtrados *depois* do cache, alternar esses filtros não gera nova consulta ao Jira.

### Renderização Incremental no Front

A cada ciclo de polling, `renderResults` compara uma *assinatura* dos dados exibidos (campos visíveis na tabela + flags dos banners) com a da última renderização. Se nada mudou, o DOM não é tocado. A assinatura é zerada sempre que a área de resultados é substituída por spinner, erro ou aviso, para que o próximo polling idêntico não deixe a tela presa nessa mensagem. Como a tabela deixa de ser refeita, os badges de "tempo na fila" (`data-iso`) são atualizados por um intervalo de 30s, que fica parado com a aba oculta e roda de novo ao voltar a ela.

---

# Performance

Resumo das otimizações e onde cada uma vive:

| Otimização | Arquivo | Efeito |
| ---------- | ------- | ------ |
| Cache + deduplicação de consultas (TTL 30s) | `api/chamados.js` | Menos chamadas ao Jira com vários analistas usando os mesmos filtros |
| Cache da lista de tipos excluídos (1h) | `api/chamados.js` | 1 chamada a `/issuetype` por hora, não por busca |
| Paginação paralela com teto | `api/_lib/jira.js` | Carrega mais de 100 chamados sem requisições sequenciais |
| Tipos obsoletos filtrados no JQL | `api/chamados.js` | O limite de resultados não é gasto com chamados descartados depois |
| Render pulado quando nada mudou | `public/index.html` | Sem reconstruir as tabelas a cada 60s |
| Badges de tempo por intervalo | `public/index.html` | Tempo na fila continua correto sem re-render |
| `tipos.js` com `Cache-Control` | `api/tipos.js` | Lista de tipos cacheada pelo navegador/CDN |

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

| Variável                  | Obrigatória | Descrição                                                        | Exemplo                     |
| ------------------------- | ----------- | ---------------------------------------------------------------- | --------------------------- |
| JIRA_URL                  | ✅           | URL base do Jira                                                 | https://jira.empresa.com.br |
| JIRA_USER                 | ✅           | Usuário de serviço                                               | usuario-servico             |
| JIRA_PASSWORD             | ✅           | Senha do usuário                                                 | *****                       |
| CHAMADOS_CACHE_TTL_MS     | Não         | Validade do cache de consultas, em ms (padrão `30000`)           | 20000                       |
| JIRA_MAX_ISSUES           | Não         | Teto de chamados carregados por lista (padrão `300`)             | 500                         |

As variáveis são utilizadas apenas pelas funções serverless. As duas últimas são lidas na inicialização do módulo: alterá-las exige novo deploy (ou reinício do `npm run dev`).

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
# Opcionais
# CHAMADOS_CACHE_TTL_MS=30000
# JIRA_MAX_ISSUES=300
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

| Parâmetro        | Tipo    | Obrigatório | Descrição                                                                                         |
| ---------------- | ------- | ----------- | ------------------------------------------------------------------------------------------------- |
| vertical         | string  | Não         | CSV de verticais (whitelist)                                                                      |
| portfolio        | string  | Não         | CSV de portfólios (whitelist)                                                                     |
| cf[21500]        | string  | Não         | CSV de equipes responsáveis (whitelist)                                                           |
| users            | string  | Não         | CSV de e-mails/usernames — máx. 10                                                                |
| typeIds          | string  | Não         | CSV de IDs ou nomes de tipo — máx. 150                                                            |
| days             | number  | Não         | Período: 0, 30, 60 ou 90                                                                          |
| mostrarParceiros | boolean | Não         | `true` inclui chamados de nível de segurança "parceiro" (padrão: ocultos)                         |
| prestacaoContas  | string  | Não         | `incluir` (padrão), `excluir` ou `apenas` — filtra chamados de prestação de contas                |
| fresh            | string  | Não         | `1` ignora o cache do servidor (usado pelas buscas manuais; o polling não envia)                  |

> **Nota sobre `typeIds`:** quando omitido ou quando todos os tipos estão selecionados, o filtro não é aplicado e todos os tipos *não obsoletos* são retornados. Envie apenas em seleção parcial.

### Resposta (200)

```json
{
  "ok": true,
  "total": 12,
  "totalUnassigned": 4,
  "totalAssigned": 8,
  "prestacaoContasAtivo": false,
  "jiraTotalUnassigned": 4,
  "jiraTotalAssigned": 8,
  "loadedUnassigned": 4,
  "loadedAssigned": 8,
  "truncatedUnassigned": false,
  "truncatedAssigned": false,
  "truncated": false,
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
      "sistema": "Contabilidade Cloud",
      "portfolio": "Portfólio Pequenas Contas",
      "equipe": "Suporte",
      "isParceiro": false,
      "isPrestacaoContas": false,
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
      "sistema": "Contabilidade Cloud",
      "portfolio": "Portfólio Pequenas Contas",
      "equipe": "Suporte",
      "isParceiro": false,
      "isPrestacaoContas": false,
      "url": "https://jira.empresa.com.br/browse/PROJ-1002"
    }
  ]
}
```

> **Nota sobre `statusCat`:** usa a chave da categoria do Jira — `"new"`, `"indeterminate"` ou `"done"` (sempre minúsculo).

### Contagens e Truncagem

| Campo                                  | Significado                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `totalUnassigned` / `totalAssigned`    | Chamados que sobraram após os filtros de tipo e parceiros feitos no Node (antes do filtro de prestação) |
| `total`                                | Soma dos dois campos acima                                                                              |
| `jiraTotalUnassigned` / `jiraTotalAssigned` | Total **real** que o Jira informa para a consulta                                                  |
| `loadedUnassigned` / `loadedAssigned`  | Quantos chamados foram efetivamente carregados do Jira (limitado por `JIRA_MAX_ISSUES`)                 |
| `truncatedUnassigned` / `truncatedAssigned` | `true` quando `loaded < jiraTotal`: a lista está incompleta                                        |
| `truncated`                            | `true` se qualquer uma das listas está incompleta                                                       |

Quando `truncated` é `true`, o front exibe o banner "Resultados incompletos" e deixa de afirmar que chamados sumidos foram encerrados (eles podem apenas ter ficado fora do limite).

### Headers de Resposta

| Header    | Valores        | Descrição                                                                    |
| --------- | -------------- | ---------------------------------------------------------------------------- |
| X-Cache   | `HIT` / `MISS` | `HIT` somente se todas as consultas da resposta vieram do cache do servidor  |

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

Strings livres (nomes de usuário, tipos alfanuméricos) são sanitizadas com `escapeJqlValue()` antes de serem interpoladas no JQL. Os IDs dos tipos excluídos, resolvidos via API, só entram no JQL depois de validados como numéricos (`/^\d+$/`).

---

## Credenciais Seguras

As credenciais do Jira permanecem exclusivamente nas variáveis de ambiente do Vercel. O navegador nunca as recebe.

---

## Cache no Servidor

O cache é indexado pelo JQL completo (que já embute todos os filtros validados) e guarda apenas dados que o usuário de serviço já pode ver. Como a API não distingue permissões por usuário final (todas as consultas usam o mesmo usuário de serviço), o cache não altera quem pode ver o quê. Ele é limitado a 100 entradas e expira por TTL, sem persistência em disco.

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

Todo conteúdo externo é escapado com `escHtml()` antes de ser inserido no DOM (inclusive o atributo `data-iso` dos badges de tempo na fila). Elementos interativos (tags de usuário) são criados via `createElement` + `addEventListener`, sem `innerHTML` com dados externos.

Campos escapados:

* `summary`
* `status`
* `displayName`
* `assignee`
* `equipe`
* `sistema`
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

O arquivo precisa ser executado a partir da raiz do projeto: ele carrega `api/chamados.js` e `public/index.html` pelo caminho relativo a si mesmo.

## Tipos de teste

* **Testes de lógica espelhada:** reproduzem no arquivo a lógica do front (`swDetect`, `buildParams`, `preenchidos`...). Cobrem regras de negócio, mas precisam ser atualizados à mão se a regra mudar no `index.html`.
* **Testes do backend real:** executam o handler verdadeiro de `api/chamados.js` (com `api/_lib/jira.js` e `api/_lib/validate.js`) contra um Jira simulado, substituindo `global.fetch`. Cada teste recarrega os módulos para zerar os caches em memória.
* **Testes do front real:** extraem funções puras diretamente de `public/index.html` (`assinaturaDados`, `classeTempoFila`, `tempoFilaBadge`, `tempoRelativo`, `escHtml`) e as executam. Se a regra mudar no front, o teste detecta.

O runner é assíncrono: `test()` enfileira e `main()` executa em sequência, aguardando cada teste.

## Cobertura (106 testes)

**Lógica espelhada do front**

* `swDetect` — detecção de novos, status alterado, movimentação, desaparecidos; truncagem vinda de `data.truncated`; filtro de prestação de contas não suprime desaparecidos; truncagem em só uma das listas
* `buildParams` — montagem de query string com equipe, typeIds parcial/total, days; `fresh=1` somente em busca manual
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

**Backend real (`api/chamados.js`)**

* Paginação: várias páginas, teto de chamados, `JIRA_MAX_ISSUES`, `maxResults` reduzido pelo servidor, lista vazia, chaves repetidas entre páginas
* Contagens: totais reais do Jira (`jiraTotal*`), carregados (`loaded*`) e flags de truncagem por lista
* Cache: `HIT`/`MISS`, filtros diferentes, `fresh=1` (fura o cache e realimenta), expiração por TTL, falhas não cacheadas
* Deduplicação de requisições simultâneas (3 chamadas → 1 consulta ao Jira)
* JQL: tipos obsoletos por ID (só os existentes), `typeIds` explícito, `ORDER BY ... key ASC`, cache da lista de tipos, fallback quando `/issuetype` falha
* Filtros pós-cache: parceiros e prestação de contas sem nova consulta
* Erros da API: 405, 400 `INVALID_PARAMS`, 400 `INVALID_FILTER`, 502 `JIRA_ERROR`

**Front real (`public/index.html`)**

* Assinatura dos dados: igualdade, sensibilidade a mudanças visíveis, ordem, flags de banner, insensibilidade a campos não exibidos
* Portão de renderização: polling idêntico não redesenha, dado alterado redesenha, busca manual e ordenação sempre redesenham, invalidação após spinner/erro/aviso
* Tempo na fila: faixas `ok`/`avg`/`bad`, data futura, `data-iso`, escape de XSS, evolução do texto ao longo do tempo

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

> Com o cache de 30s no servidor, intervalos de polling menores que o TTL fazem a maioria das consultas automáticas serem respondidas do cache.

---

## Ajustar Cache e Limite de Chamados

* **TTL do cache:** variável `CHAMADOS_CACHE_TTL_MS` (padrão 30000 ms). Valores maiores reduzem a carga no Jira, mas deixam o polling mais defasado; a busca manual sempre ignora o cache.
* **Teto de chamados por lista:** variável `JIRA_MAX_ISSUES` (padrão 300). Aumentar carrega mais chamados, com respostas maiores e mais páginas por consulta.
* **Quantidade de entradas do cache:** constante `CACHE_MAX_ENTRIES` em `api/chamados.js` (padrão 100).
* **Intervalo de atualização dos badges de tempo na fila:** `setInterval(atualizarTempoFila, 30000)` em `public/index.html`.

---

## Alterar Campos Retornados

Edite `api/chamados.js`:

* Array `FIELDS` — adicione o `customfield_XXXXX` desejado.
* Função `mapIssue()` — mapeie o novo campo no objeto retornado.

> Se o novo campo aparecer na tabela, inclua-o também em `assinaturaDados()` (`public/index.html`). Caso contrário, mudanças nesse campo não disparam nova renderização durante o polling.

---

## Tipos Excluídos

A lista de tipos obsoletos existe em **dois lugares** e deve ser mantida igual:

* `TIPOS_EXCLUIDOS` em `api/tipos.js` — oculta os tipos do seletor.
* `NOMES_TIPOS_EXCLUIDOS` em `api/chamados.js` — exclui os tipos das consultas (por ID, no JQL) e funciona como rede de segurança por nome no Node.

---

## Mover um Filtro do Node para o JQL

Parceiros e prestação de contas são filtrados no Node de propósito (veja a tabela em [Decisões de Arquitetura](#quais-filtros-rodam-no-jql-e-quais-no-node)). Antes de movê-los para o JQL, confirme o tipo do campo no Jira:

* Se `customfield_10335` for lista de seleção, um `in (...)` com os valores exatos preserva a regra.
* Se for texto, o operador `~` tem semântica diferente de "contém" e pode esconder chamados.

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