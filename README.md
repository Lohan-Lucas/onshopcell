# On Shop Cell: site

Site da **On Shop Cell** (acessórios e assistência especializada, Maracanaú/CE), feito em HTML, CSS e JavaScript puros, sem bibliotecas e sem etapa de build. Todas as ferramentas usadas para manter o site no ar são gratuitas.

- **Site:** https://lohan-lucas.github.io/onshopcell/
- **Repositório:** https://github.com/Lohan-Lucas/onshopcell
- **Publicação:** automática pelo GitHub Actions, a cada `git push` na branch `main` (cerca de 1 minuto; acompanhe na aba **Actions**).

## Estrutura

```
site-marcelo/
├── index.html        página completa (animação, produtos, assistência, contato)
├── styles.css        visual (cores do logo: preto, azul #0A6CF5 e prata)
├── script.js         animação de rolagem + menu, filtros e links do WhatsApp
├── frames/           frame-0001.webp … frame-0240.webp (a animação)
├── assets/
│   ├── produtos/     fotos dos produtos
│   ├── og-image.jpg  imagem que aparece ao compartilhar o link (WhatsApp, Instagram...)
│   └── favicon.svg, favicon-32.png, apple-touch-icon.png, icon-512.png
├── .github/workflows/deploy.yml   publicação automática no GitHub Pages
├── _headers          cache e segurança (usado só se migrar para a Cloudflare)
└── robots.txt
```

## A animação (primeira tela)

- Os frames ficam em **`frames/`**, ao lado do `index.html`, com os nomes `frame-0001.webp` até `frame-0240.webp`.
- Se mudar a quantidade de frames, ajuste `CONFIG.frames.count` em `script.js`.
- **Trocou os frames depois de publicar?** Mude `CONFIG.frames.version` em `script.js` (`'1'` → `'2'`). Assim os visitantes baixam os novos e não ficam com a versão antiga em cache.
- **Duração:** a altura de `.hero` em `styles.css` (`500vh`). Um valor maior deixa a animação mais lenta.
- **Enquadramento:** o frame sempre preenche a tela mantendo a proporção. No celular em pé, ele corta no máximo 25% (`CONFIG.maxCrop`) e completa o resto esticando as bordas do próprio frame, para que o aparelho nunca fique cortado.
- **Textos sobre a animação:** são os blocos `data-beat="início,fim"` no `index.html` (0 = começo da rolagem, 1 = fim).

Como funciona: os frames são pré-carregados em ordem progressiva (primeiro, último, depois a cada 128, 64, 32... frames). A tela de carregamento espera no máximo 5 s e o restante continua baixando em segundo plano. Durante a rolagem o canvas mostra o frame correspondente com suavização e fusão entre frames vizinhos.

Com **"reduzir movimento"** ligado no sistema, ou em modo de **economia de dados**, a primeira tela vira uma capa estática com um único frame (`CONFIG.staticFrame`) e os outros 239 nem são baixados. Se a pasta `frames/` estiver vazia, aparece uma capa com o logo.

## Testar no computador

O jeito mais fiel é servir a pasta por HTTP (abrir o `index.html` com dois cliques também funciona, só que sem cache):

```bash
python -m http.server 8080
# abra http://localhost:8080
```

No VS Code, a extensão gratuita **Live Server** faz o mesmo com um clique.

## Publicar e atualizar (GitHub Pages + GitHub Actions)

Para colocar uma alteração no ar:

```bash
git add -A
git commit -m "Atualiza produtos"
git push
```

O workflow `.github/workflows/deploy.yml` monta uma pasta só com os arquivos do site (o README e as configurações ficam de fora) e publica no GitHub Pages. Também dá para editar um arquivo direto no github.com (ícone de lápis), e a publicação roda do mesmo jeito. Para publicar de novo sem mudar nada: aba **Actions** → **Publicar site** → **Run workflow**.

Como está configurado, caso precise refazer em outra conta:

1. Repositório **público**: o GitHub Pages gratuito exige.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Enviar o código para a branch `main`.

Limites do plano gratuito: site de até 1 GB e cerca de 100 GB de tráfego por mês. A animação pesa ~12 MB na primeira visita (nas seguintes vem do cache), o que dá algo como 8 mil visitantes novos por mês.

> **Atenção aos termos de uso:** o GitHub Pages não pode ser usado como hospedagem de loja/e-commerce ("sites voltados principalmente a transações comerciais"). Uma vitrine que encaminha pedidos para o WhatsApp fica numa zona cinzenta. Para eliminar esse risco, ou se precisar de mais tráfego, mude para a Cloudflare Pages (abaixo): também é grátis, permite uso comercial e não limita o tráfego de sites estáticos.

### Domínio próprio (opcional, pago)

Um endereço como `onshopcell.com.br` custa cerca de R$ 40/ano no [registro.br](https://registro.br). Configure em **Settings → Pages → Custom domain** (o HTTPS continua grátis) e troque o endereço no `index.html`: procure `lohan-lucas.github.io` (canonical, `og:url`, `og:image` e o bloco JSON-LD). É isso que faz a prévia do link aparecer certinha no WhatsApp.

### Alternativa: Cloudflare Pages

1. Crie uma conta grátis na [Cloudflare](https://dash.cloudflare.com/sign-up) → **Workers & Pages** → **Create** → aba **Pages** → **Connect to Git** → escolha `Lohan-Lucas/onshopcell`.
2. Configuração: *Framework preset* **None** · *Build command* **(vazio)** · *Build output directory* **`/`** → **Save and Deploy**.
3. Troque o endereço no `index.html` pelo novo (`*.pages.dev` ou domínio próprio) e, se quiser, desligue o GitHub Pages em **Settings → Pages**.

O arquivo `_headers` já traz as regras de cache (frames guardados por 30 dias) para a Cloudflare. Sem GitHub, também dá para publicar pelo terminal com [Node.js](https://nodejs.org):

```bash
npx wrangler login                                                     # abre o navegador para entrar na conta Cloudflare
npx wrangler pages project create onshopcell --production-branch=main  # só na primeira vez
npx wrangler pages deploy . --project-name=onshopcell --branch=main    # publica (repita a cada atualização)
```

## Como editar o conteúdo

| O quê | Onde |
|---|---|
| Número do WhatsApp | `CONFIG.whatsapp` em `script.js` **e** os links no `index.html` (procure `5585998033405`) |
| Produto novo | copie um bloco `<li class="product">` inteiro no `index.html` e troque foto, nome, descrição, `data-category` e `data-product` (o nome que vai na mensagem do WhatsApp) |
| Fotos dos produtos | `assets/produtos/` (proporção 3:4 ou 4:5, cerca de 800 px de largura, de preferência `.webp`) |
| Categorias do filtro | os botões `data-filter` no `index.html` precisam bater com o `data-category` dos produtos |
| Serviços da assistência | seção `#assistencia` no `index.html` |
| Cores e fontes | variáveis no topo do `styles.css` (`:root`) |

> As fotos atuais foram recortadas dos posts do Instagram (baixa resolução). Para melhor qualidade, troque-as pelas fotos originais com os mesmos nomes de arquivo.

## Dicas

- **Dados no celular:** dá para criar uma versão menor dos frames só para celular (ex.: 960×540) numa pasta `frames/mobile/` e ativar `CONFIG.frames.mobileFolder: 'frames/mobile/'`.
- **Frames repetidos:** a sequência atual tem 48 frames idênticos ao anterior (vídeo de 24 fps exportado a 30 fps). Ao gerar os frames de novo, exportar na taxa original do vídeo deixa a animação um pouco mais leve e mais uniforme.
- **OneDrive:** esta pasta está dentro do OneDrive. Se o Git reclamar de arquivos bloqueados, pause a sincronização durante o `git push` ou mova o projeto para uma pasta fora do OneDrive.
