# 📋 Chamados por Vertical — Betha Sistemas

Painel web para consulta de chamados abertos no Jira de Atendimento, com filtros por portfólio, vertical e responsável, e alertas em tempo real via notificação do sistema operacional.

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
9. [Customização](#customização)

---

## Visão geral

O sistema resolve um problema recorrente de atendimento: identificar rapidamente chamados sem responsável ou atribuídos a um analista dentro de um portfólio/vertical específico, sem precisar abrir o Jira manualmente várias vezes ao dia.

Funcionalidades principais:

- Filtros por portfólio, vertical e responsável
- Autocomplete de usuários integrado ao Jira
- Separação visual entre chamados sem dono e atribuídos ao responsável buscado
- Alertas push via notificação do SO — dispara quando um novo chamado entra nos filtros
- Polling automático a cada 5 minutos via Service Worker (roda em background, mesmo com aba minimizada)

---

## Arquitetura

```
chamados-jira/
├── api/                     # Serverless functions (Vercel)
│   ├── _lib/
│   │   ├── jira.js          # Cliente HTTP para a API REST do Jira
│   │   └── validate.js      # Sanitização de inputs e prevenção de JQL Injection
│   ├── chamados.js          # GET /api/chamados — busca issues
│   └── usuarios.js          # GET /api/usuarios — autocomplete de usuários
├── index.html               # Frontend SPA (sem framework, sem build step)
├── sw.js                    # Service Worker — polling em background + notificações
├── package.json
├── vercel.json              # Configuração de deploy e headers de segurança
└── README.md
```

### Fluxo de dados

```
Browser → GET /api/chamados?vertical=X&user=Y
            └─→ validate.js   (valida e escapa parâmetros)
            └─→ jira.js       (autentica e chama a API REST do Jira)
            └─→ mapIssue()    (transforma resposta em DTO limpo)
         ← JSON { ok, total, issues[], jql }
```

### Por que sem framework de frontend?

O frontend é HTML/CSS/JS puro por escolha deliberada. Para uma ferramenta interna de consulta, um framework adicionaria complexidade de build sem benefício real. O resultado é um arquivo único que funciona imediatamente ao abrir.

### Por que Vercel Serverless Functions?

As credenciais do Jira ficam exclusivamente no servidor (variáveis de ambiente do Vercel). O browser nunca as vê. As funções atuam como proxy autenticado: recebem a requisição do frontend, chamam o Jira com as credenciais e devolvem apenas os dados necessários.

---

## Pré-requisitos

- Conta gratuita no [Vercel](https://vercel.com) (login com GitHub, GitLab ou Bitbucket)
- Repositório Git (GitHub recomendado)
- Credenciais de acesso à API do Jira Server:
  - URL base da instância (ex: `https://atendimento.betha.com.br`)
  - Usuário de serviço dedicado e sua senha
- Node.js 18+ (apenas para desenvolvimento local)

> **Recomendação:** use um usuário de serviço dedicado para a integração (ex: `atendimento-api`), com permissão apenas de leitura nos projetos relevantes. Nunca use uma conta pessoal em produção.

---

## Variáveis de ambiente

| Variável        | Obrigatória | Descrição                                              | Exemplo                                  |
|-----------------|-------------|--------------------------------------------------------|------------------------------------------|
| `JIRA_URL`      | ✅          | URL base da instância Jira (sem barra final)           | `https://atendimento.betha.com.br`       |
| `JIRA_USER`     | ✅          | Username do usuário de serviço no Jira                 | `mcpintegracao`                          |
| `JIRA_PASSWORD` | ✅          | Senha do usuário de serviço                            | `*****`                                  |

As variáveis são lidas em runtime pelas serverless functions. Elas **nunca chegam ao browser**.

---

## Deploy no Vercel

### 1. Suba o código para o GitHub

```bash
# Clone ou descompacte o projeto, depois:
cd chamados-jira
git init
git add .
git commit -m "chore: initial commit"
# Crie um repositório no GitHub e faça push
git remote add origin https://github.com/seu-usuario/chamados-jira.git
git push -u origin main
```

### 2. Importe no Vercel

1. Acesse [vercel.com/new](https://vercel.com/new)
2. Clique em **"Import Git Repository"** e selecione o repositório criado
3. Mantenha todas as configurações padrão (Framework: Other)
4. Clique em **Deploy** — o primeiro deploy será feito sem as variáveis; isso é esperado

### 3. Configure as variáveis de ambiente

1. No dashboard do Vercel, abra o projeto → **Settings → Environment Variables**
2. Adicione as três variáveis descritas na seção acima
3. Marque os ambientes: **Production**, **Preview** e **Development**

### 4. Redeploy

Após salvar as variáveis, vá em **Deployments → ⋯ → Redeploy**. O site estará funcional com a URL gerada pelo Vercel (ex: `chamados-jira.vercel.app`).

---

## Desenvolvimento local

```bash
# Instala a CLI do Vercel
npm install

# Cria o arquivo de variáveis locais (nunca commitar este arquivo)
cp .env.example .env.local
# Edite .env.local com suas credenciais reais

# Inicia o servidor local (emula o ambiente Vercel)
npm run dev
# Acesse http://localhost:3000
```

Crie o arquivo `.env.example` com:

```
JIRA_URL=https://atendimento.betha.com.br
JIRA_USER=
JIRA_PASSWORD=
```

> O `vercel dev` emula as serverless functions localmente com hot reload.

---

## Referência da API

### `GET /api/chamados`

Retorna issues abertas no Jira filtradas pelos parâmetros informados.

**Parâmetros de query:**

| Parâmetro   | Tipo   | Obrigatório | Descrição                                                |
|-------------|--------|-------------|----------------------------------------------------------|
| `vertical`  | string | Não         | Nome da vertical (deve estar na lista de valores válidos)|
| `portfolio` | string | Não         | Nome do portfólio (deve estar na lista de valores válidos)|
| `user`      | string | Não         | Username do Jira do responsável                          |

Se `user` for informado, retorna chamados **sem responsável OU atribuídos a esse usuário**. Se omitido, retorna apenas os sem responsável.

**Resposta de sucesso (200):**

```json
{
  "ok": true,
  "total": 51,
  "jql": "cf[32400] = \"Portfólio Pequenas Contas\" AND ...",
  "issues": [
    {
      "key": "BTHSC-321508",
      "summary": "Empenho: Não é permitido número duplicado",
      "status": "Aguardando Manutenção",
      "statusCat": "To Do",
      "priority": "1",
      "type": "Incidente",
      "assignee": "Jean Vitor Vieira",
      "updated": "2026-06-02T08:04:49.000-0300",
      "created": "2026-06-01T11:55:53.000-0300",
      "vertical": "Contábil",
      "portfolio": "Portfólio Pequenas Contas",
      "url": "https://atendimento.betha.com.br/browse/BTHSC-321508"
    }
  ]
}
```

**Respostas de erro:**

| Status | `code`              | Causa                                      |
|--------|---------------------|--------------------------------------------|
| 400    | `INVALID_PARAMS`    | Parâmetro inválido (vertical não permitida, etc.) |
| 405    | `METHOD_NOT_ALLOWED`| Método HTTP diferente de GET               |
| 500    | `CONFIG_ERROR`      | Variáveis de ambiente não configuradas     |
| 502    | `JIRA_ERROR`        | Erro retornado pela API do Jira            |

---

### `GET /api/usuarios`

Busca usuários no Jira por nome ou e-mail. Usado pelo autocomplete do frontend.

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
      "name": "jean.vieira@betha.com.br",
      "displayName": "Jean Vitor Vieira",
      "email": "jean.vieira@betha.com.br"
    }
  ]
}
```

---

## Segurança

### Proteção contra JQL Injection

Valores recebidos via query string nunca são interpolados diretamente no JQL. O módulo `validate.js` faz duas camadas de proteção:

1. **Lista fechada** para vertical e portfólio: qualquer valor fora da lista predefinida é rejeitado com HTTP 400.
2. **Escaping** para o campo `user`: aspas e barras invertidas são escapadas antes de entrar na query JQL.

### Credenciais seguras

As credenciais do Jira vivem exclusivamente como variáveis de ambiente no Vercel. A função serverless as lê em runtime e nunca as repassa ao cliente.

### Headers HTTP

O `vercel.json` aplica headers de segurança em todas as respostas:

- `X-Content-Type-Options: nosniff` — evita MIME sniffing
- `X-Frame-Options: SAMEORIGIN` — previne clickjacking
- `Referrer-Policy: strict-origin-when-cross-origin` — limita vazamento de URL
- `Permissions-Policy` — desabilita câmera, microfone e geolocalização
- `Cache-Control: no-store` nas rotas de API — impede cache de dados sensíveis

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

Depois adicione a opção correspondente no `<select>` do `index.html`.

### Adicionar um novo portfólio

Mesmo processo: edite `PORTFOLIOS_VALIDOS` em `validate.js` e o `<select>` no `index.html`.

### Alterar o intervalo de polling de notificações

Em `sw.js`, altere a constante no topo do arquivo:

```js
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos — ajuste aqui
```

### Alterar os campos retornados por chamado

Em `api/chamados.js`, edite o array `FIELDS` com os IDs dos campos Jira desejados, e atualize a função `mapIssue()` para mapeá-los no DTO de saída.
