# On Shop Cell: site e app do lojista

Site da **On Shop Cell** (acessórios e assistência especializada, Maracanaú/CE) com uma animação de rolagem na primeira tela e um catálogo que o dono atualiza pelo celular. HTML, CSS e JavaScript puros, sem bibliotecas. Tudo roda no plano gratuito da Cloudflare (sem cartão).

| | Endereço |
|---|---|
| Site | https://onshopcell.pages.dev/ |
| App do lojista | https://onshopcell.pages.dev/admin/ |
| Código | https://github.com/Lohan-Lucas/onshopcell |

## App do lojista (cadastro do catálogo)

App instalável no celular (PWA) para o dono cadastrar, editar e excluir produtos. As alterações aparecem no site **na hora**, sem publicar nada.

- **Fotos:** pela câmera ou galeria, até 6 por produto (a primeira é a capa). O próprio celular reduz cada foto para no máximo 1200 px e remove os dados de GPS antes de enviar.
- **Dados do produto:** nome, preço, preço antigo (aparece riscado, como promoção), categoria (dá para criar novas), descrição, cores disponíveis (16 prontas ou personalizadas), "Disponível" (desligado = "Esgotado") e "Destaque".
- **Outras funções:** reordenar os produtos, buscar, filtrar por categoria e baixar uma cópia de segurança.

**Instalar no celular**

- Android (Chrome): abra o endereço do app e toque em **Instalar o app** (ou menu ⋮ do Chrome → *Instalar app*).
- iPhone (Safari): abra o endereço, toque em **Compartilhar** e depois em **Adicionar à Tela de Início**.

**Senha e segurança**

- A senha fica guardada só na Cloudflare, criptografada, nunca no código. Para trocar (desconecta todos os aparelhos):
  ```bash
  npx wrangler pages secret put ADMIN_PASSWORD --project-name onshopcell
  ```
- O login dura 30 dias por aparelho, num cookie seguro.
- A senha é bloqueada após 8 erros em 15 minutos (100 por dia no total).
- O app só aceita alterações vindas do próprio site, carrega apenas arquivos do site e não aparece no Google.
- Duas gravações ao mesmo tempo nunca se sobrescrevem: o banco confere a versão antes de gravar.

## Estrutura

```
site-marcelo/
├── public/                    o que vai para o ar
│   ├── index.html, styles.css, script.js   site + animação + vitrine
│   ├── frames/                240 frames da animação (frame-0001.webp …)
│   ├── assets/                ícones, imagem de compartilhamento e fotos antigas
│   ├── data/produtos.json     catálogo inicial (reserva se a API falhar)
│   ├── admin/                 app do lojista
│   └── _headers, 404.html, robots.txt
├── functions/                 API (Cloudflare Pages Functions)
│   ├── api/[[rota]].js        /api/produtos e /api/admin/*
│   └── img/[[foto]].js        fotos enviadas pelo app (/img/…)
├── lib/loja.js                regras do servidor (catálogo, login, fotos)
├── wrangler.toml              configuração da Cloudflare (bancos D1 e KV)
└── .github/workflows/deploy.yml
```

## Onde ficam os dados

| O quê | Onde |
|---|---|
| Produtos e categorias | banco **D1** `loja`, tabela `catalogo` |
| Versões anteriores (últimas 50) | banco **D1** `loja`, tabela `historico` |
| Fotos enviadas pelo app | **KV** `LOJA` (endereços `/img/…`) |
| Fotos iniciais (recortes do Instagram) | `public/assets/produtos/` |

**Cópia de segurança:** no app, menu ⋮ → *Baixar cópia de segurança* (arquivo `.json`).

**Voltar uma versão anterior (emergência):**

```bash
# ver as últimas versões
npx wrangler d1 execute loja --remote --command "SELECT versao, atualizado_em FROM historico ORDER BY versao DESC LIMIT 10"
# restaurar a versão 12 (troque o número)
npx wrangler d1 execute loja --remote --command "UPDATE catalogo SET dados = (SELECT dados FROM historico WHERE versao = 12), versao = versao + 1, atualizado_em = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1"
```

## A animação (primeira tela)

- Os frames ficam em **`public/frames/`**: `frame-0001.webp` até `frame-0240.webp`. Se mudar a quantidade, ajuste `CONFIG.frames.count` em `public/script.js`.
- **Trocou os frames?** Aumente `CONFIG.frames.version` em `public/script.js` (ex.: `'2'` → `'3'`) para os visitantes baixarem os novos.
- **Duração:** altura de `.hero` em `public/styles.css` (`500vh`). Um valor maior deixa a animação mais lenta.
- **Enquadramento:** o frame sempre preenche a tela mantendo a proporção. No celular em pé, ele corta no máximo 25% (`CONFIG.maxCrop`) e completa o resto esticando as bordas do próprio frame.
- **Textos sobre a animação:** blocos `data-beat="início,fim"` no `public/index.html`.

**Como funciona por baixo:**

- **Carregamento:** os frames são pré-carregados em ordem progressiva. A tela de carregamento espera no máximo 5 s e o restante continua baixando em segundo plano.
- **Movimentos reduzidos:** com "reduzir movimento" ligado no sistema, ou em economia de dados, a primeira tela vira uma imagem fixa e só 1 frame é baixado.

## Testar no computador

Crie um arquivo `.dev.vars` na pasta do projeto. Ele já está no `.gitignore` e nunca vai para o GitHub:

```
ADMIN_PASSWORD=uma-senha-de-teste
SESSION_SECRET=um-texto-aleatorio-bem-longo
```

Depois rode `npx wrangler pages dev` e abra http://127.0.0.1:8788/ (site) e http://127.0.0.1:8788/admin/ (app). Os bancos locais são separados dos de produção.

## Publicar mudanças no código

Os **produtos** não precisam de publicação: o app grava direto no banco. Só mudanças em arquivos (textos fixos, visual, animação) precisam ser publicadas.

- **Pelo computador** (já logado com `npx wrangler login`):
  ```bash
  npx wrangler pages deploy
  ```
- **Automático a cada `git push` (opcional):**
  1. Crie um token em Cloudflare → *My Profile* → *API Tokens* → *Create Token* → *Custom token*, com as permissões de conta **Cloudflare Pages: Edit**, **D1: Edit** e **Workers KV Storage: Edit**.
  2. No GitHub, vá em *Settings* → *Secrets and variables* → *Actions* e cadastre `CLOUDFLARE_API_TOKEN` (o token) e `CLOUDFLARE_ACCOUNT_ID` (o id da conta, que aparece em `npx wrangler whoami`).

  Sem esses segredos, o workflow só avisa e segue.

O endereço antigo (`lohan-lucas.github.io/onshopcell`) redireciona para o novo pelo mesmo workflow.

**Domínio próprio (opcional, pago):** um endereço como `onshopcell.com.br` custa cerca de R$ 40/ano no [registro.br](https://registro.br). Configure em Cloudflare → *Workers & Pages* → *onshopcell* → *Custom domains* (o HTTPS continua grátis). Depois troque `onshopcell.pages.dev` no `public/index.html` (canonical, `og:url`, `og:image` e o JSON-LD).

## Limites do plano gratuito

| Serviço | Limite | Na prática |
|---|---|---|
| Site (arquivos) | tráfego ilimitado | animação, fotos antigas e páginas |
| Funções (API e fotos do app) | 100 mil requisições/dia | milhares de visitas por dia |
| D1 (catálogo) | 5 milhões de leituras e 100 mil gravações/dia | uma leitura por visita |
| KV (fotos do app) | 1 GB e 1 mil gravações/dia | milhares de fotos guardadas |

## Editar textos fixos do site

| O quê | Onde |
|---|---|
| Número do WhatsApp | `CONFIG.whatsapp` em `public/script.js` **e** os links no `public/index.html` (procure `5585998033405`) |
| Serviços da assistência, "como comprar", contato | seções do `public/index.html` |
| Cores e fontes | variáveis no topo do `public/styles.css` (`:root`) |

## Dicas

- **Dados no celular:** dá para criar uma versão menor dos frames só para celular (ex.: 960×540) numa pasta `public/frames/mobile/` e ativar `CONFIG.frames.mobileFolder: 'frames/mobile/'`.
- **Frames repetidos:** a sequência atual tem 48 frames idênticos ao anterior (vídeo de 24 fps exportado a 30 fps). Exportar de novo na taxa original deixa a animação mais leve e mais uniforme.
- **OneDrive:** a pasta do projeto está dentro do OneDrive. Se o Git reclamar de arquivos bloqueados, pause a sincronização durante o `git push`.
