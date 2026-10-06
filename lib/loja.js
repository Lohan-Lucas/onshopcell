// Servidor da loja: Cloudflare Pages Functions + D1 + KV (plano gratuito).
//
// D1 (binding "DB"), banco SQL com consistência forte:
//   catalogo       uma linha com o catálogo atual (categorias + produtos) e a versão
//   historico      as versões anteriores mais recentes (para emergências)
//   falhas_login   senhas erradas por endereço e no total (bloqueio temporário)
// KV (binding "LOJA"):
//   img:<nome>     fotos enviadas pelo painel (nome único, nunca sobrescrito)
//
// Segredos (Cloudflare → projeto → Settings → Variables and Secrets, ou .dev.vars local):
//   ADMIN_PASSWORD   senha do painel
//   SESSION_SECRET   texto aleatório longo que assina o login

const CATALOGO_INICIAL = '/data/produtos.json';
const VERSOES_GUARDADAS = 50;
const COOKIE = 'painel_sessao';
const DIAS_SESSAO = 30;
const LIMITE_IP = { max: 8, segundos: 15 * 60 };        // 8 senhas erradas a cada 15 min por endereço
const LIMITE_GERAL = { max: 100, segundos: 24 * 3600 }; // 100 erradas por dia no total
const MAX_FOTO = 2.5 * 1024 * 1024;

const encoder = new TextEncoder();

/* ---------- banco (as tabelas são criadas sozinhas na primeira vez) ---------- */
let bancoPronto = null;
function prepararBanco(env) {
  bancoPronto ??= env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS catalogo (id INTEGER PRIMARY KEY CHECK (id = 1), versao INTEGER NOT NULL, atualizado_em TEXT NOT NULL, dados TEXT NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS historico (versao INTEGER PRIMARY KEY, atualizado_em TEXT NOT NULL, dados TEXT NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS falhas_login (chave TEXT PRIMARY KEY, total INTEGER NOT NULL, expira INTEGER NOT NULL)'),
  ]).catch((e) => {
    bancoPronto = null;
    throw e;
  });
  return bancoPronto;
}

/* ---------- respostas ---------- */
export function json(dados, status = 200, cabecalhos = {}) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cabecalhos },
  });
}
export const erro = (status, mensagem) => json({ erro: mensagem }, status);

/* ---------- catálogo ---------- */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COR = /^#[0-9a-f]{6}$/;
const IMAGEM = /^(?:assets\/produtos|img)\/[a-z0-9][a-z0-9._-]{0,90}\.(?:webp|jpe?g|png)$/i;
const texto = (valor, max) => String(valor ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const dinheiro = (valor) => {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Math.round(Number(valor) * 100) / 100;
  return Number.isFinite(n) && n > 0 && n < 10_000_000 ? n : null;
};

// Aceita só o formato esperado: tudo o que chega do painel passa por aqui.
export function limparCatalogo(entrada) {
  const categorias = [];
  const idsCategoria = new Set();
  for (const c of Array.isArray(entrada?.categorias) ? entrada.categorias : []) {
    const id = texto(c?.id, 40).toLowerCase();
    const nome = texto(c?.nome, 40);
    if (SLUG.test(id) && nome && !idsCategoria.has(id)) {
      idsCategoria.add(id);
      categorias.push({ id, nome });
    }
  }
  if (!categorias.length) {
    categorias.push({ id: 'variedades', nome: 'Variedades' });
    idsCategoria.add('variedades');
  }

  const produtos = [];
  const idsProduto = new Set();
  for (const p of (Array.isArray(entrada?.produtos) ? entrada.produtos : []).slice(0, 500)) {
    const id = texto(p?.id, 60).toLowerCase();
    const titulo = texto(p?.titulo, 80);
    if (!SLUG.test(id) || !titulo || idsProduto.has(id)) continue;
    idsProduto.add(id);

    const cores = [];
    const nomesCor = new Set();
    for (const c of (Array.isArray(p.cores) ? p.cores : []).slice(0, 20)) {
      const nome = texto(c?.nome, 24);
      const hex = String(c?.hex || '').toLowerCase();
      if (nome && COR.test(hex) && !nomesCor.has(nome.toLowerCase())) {
        nomesCor.add(nome.toLowerCase());
        cores.push({ nome, hex });
      }
    }
    const imagens = [...new Set((Array.isArray(p.imagens) ? p.imagens : [])
      .filter((s) => typeof s === 'string' && IMAGEM.test(s) && !s.includes('..')))].slice(0, 8);
    const preco = dinheiro(p.preco);
    let precoAntigo = dinheiro(p.precoAntigo);
    if (precoAntigo !== null && (preco === null || precoAntigo <= preco)) precoAntigo = null;

    produtos.push({
      id,
      titulo,
      categoria: idsCategoria.has(p.categoria) ? p.categoria : categorias[0].id,
      descricao: texto(p.descricao, 160),
      preco,
      precoAntigo,
      cores,
      imagens,
      destaque: p.destaque === true,
      disponivel: p.disponivel !== false,
    });
  }
  return { categorias, produtos };
}

// Catálogo salvo no banco; antes da primeira gravação, o data/produtos.json publicado com o site.
export async function lerCatalogo(env, request) {
  await prepararBanco(env);
  const linha = await env.DB.prepare('SELECT versao, atualizado_em, dados FROM catalogo WHERE id = 1').first();
  if (linha) return { versao: linha.versao, atualizadoEm: linha.atualizado_em, ...JSON.parse(linha.dados) };
  const resposta = await env.ASSETS.fetch(new URL(CATALOGO_INICIAL, request.url));
  if (!resposta.ok) throw new Error('Catálogo inicial não encontrado');
  const inicial = await resposta.json();
  return { versao: 0, atualizadoEm: inicial.atualizadoEm || null, ...limparCatalogo(inicial) };
}

// Grava só se ninguém salvou depois de "atual": a versão é conferida e trocada
// no mesmo comando, então duas gravações simultâneas nunca se sobrescrevem.
// Devolve null quando houve conflito.
export async function salvarCatalogo(env, context, atual, novo) {
  await prepararBanco(env);
  const versao = (atual.versao || 0) + 1;
  const atualizadoEm = new Date().toISOString();
  const dados = JSON.stringify(novo);
  const resultado = atual.versao
    ? await env.DB.prepare('UPDATE catalogo SET versao = ?1, atualizado_em = ?2, dados = ?3 WHERE id = 1 AND versao = ?4')
      .bind(versao, atualizadoEm, dados, atual.versao).run()
    : await env.DB.prepare('INSERT INTO catalogo (id, versao, atualizado_em, dados) VALUES (1, ?1, ?2, ?3) ON CONFLICT (id) DO NOTHING')
      .bind(versao, atualizadoEm, dados).run();
  if (!resultado.meta.changes) return null;
  const proximo = { versao, atualizadoEm, ...novo };

  // guarda a versão anterior (para emergências) e apaga as fotos que ninguém usa mais
  if (atual.versao) {
    context.waitUntil(env.DB.batch([
      env.DB.prepare('INSERT OR REPLACE INTO historico (versao, atualizado_em, dados) VALUES (?1, ?2, ?3)')
        .bind(atual.versao, atual.atualizadoEm, JSON.stringify({ categorias: atual.categorias, produtos: atual.produtos })),
      env.DB.prepare('DELETE FROM historico WHERE versao <= ?1').bind(atual.versao - VERSOES_GUARDADAS),
    ]));
  }
  const usadas = new Set(proximo.produtos.flatMap((p) => p.imagens));
  const removidas = [...new Set(atual.produtos.flatMap((p) => p.imagens))].filter((c) => c.startsWith('img/') && !usadas.has(c));
  if (removidas.length) {
    const origem = new URL(context.request.url).origin;
    context.waitUntil(Promise.all(removidas.map((caminho) => Promise.all([
      env.LOJA.delete(`img:${caminho.slice(4)}`),
      caches.default.delete(new Request(`${origem}/${caminho}`)), // tira também do cache da borda
    ]))));
  }
  return proximo;
}

/* ---------- fotos ---------- */
export async function salvarImagem(env, request, url) {
  const tipo = (request.headers.get('content-type') || '').split(';')[0].trim();
  const extensao = { 'image/webp': 'webp', 'image/jpeg': 'jpg' }[tipo];
  if (!extensao) return erro(415, 'Envie a foto em WebP ou JPEG.');
  const dados = await request.arrayBuffer();
  if (!dados.byteLength) return erro(400, 'Foto vazia.');
  if (dados.byteLength > MAX_FOTO) return erro(413, 'Foto muito grande (máximo 2,5 MB).');
  const b = new Uint8Array(dados, 0, Math.min(12, dados.byteLength));
  const ehWebp = b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  const ehJpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if ((extensao === 'webp' && !ehWebp) || (extensao === 'jpg' && !ehJpeg)) return erro(415, 'Arquivo de imagem inválido.');

  const base = (url.searchParams.get('produto') || 'foto').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'foto';
  const nome = `${base}-${crypto.randomUUID().slice(0, 8)}.${extensao}`;
  await env.LOJA.put(`img:${nome}`, dados, { metadata: { tipo, bytes: dados.byteLength } });
  return json({ caminho: `img/${nome}` }, 201);
}

export async function servirImagem(context) {
  const { request, env } = context;
  const nome = new URL(request.url).pathname.replace(/^\/img\//, '');
  if (!/^[a-z0-9][a-z0-9._-]{0,90}\.(?:webp|jpg)$/.test(nome)) return new Response('Não encontrado', { status: 404 });

  const cache = caches.default;
  const guardada = await cache.match(request);
  if (guardada) return guardada;

  const { value, metadata } = await env.LOJA.getWithMetadata(`img:${nome}`, { type: 'arrayBuffer' });
  if (!value) return new Response('Não encontrado', { status: 404 });
  const resposta = new Response(value, {
    headers: {
      'content-type': metadata?.tipo || 'image/webp',
      'cache-control': 'public, max-age=31536000, immutable', // o nome muda a cada foto nova
      'x-content-type-options': 'nosniff',
    },
  });
  context.waitUntil(cache.put(request, resposta.clone()));
  return resposta;
}

/* ---------- login ---------- */
const digest = async (valor) => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(valor)));

export async function senhaCorreta(env, tentativa) {
  if (!env.ADMIN_PASSWORD || !tentativa) return false;
  const [a, b] = await Promise.all([digest(tentativa), digest(env.ADMIN_PASSWORD)]);
  let diferenca = 0; // comparação em tempo constante
  for (let i = 0; i < a.length; i++) diferenca |= a[i] ^ b[i];
  return diferenca === 0;
}

// A chave da sessão inclui a senha: trocar a senha desconecta todos os aparelhos.
async function chaveSessao(env) {
  const material = new Uint8Array([...encoder.encode(env.SESSION_SECRET), ...(await digest(env.ADMIN_PASSWORD))]);
  return crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

const paraBase64Url = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deBase64Url = (texto64) => Uint8Array.from(atob(texto64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export async function criarSessao(env) {
  const dados = `v1.${Math.floor(Date.now() / 1000) + DIAS_SESSAO * 86400}`;
  const assinatura = await crypto.subtle.sign('HMAC', await chaveSessao(env), encoder.encode(dados));
  return `${dados}.${paraBase64Url(assinatura)}`;
}

export async function sessaoValida(env, request) {
  const cookie = (request.headers.get('Cookie') || '').split(';').map((p) => p.trim()).find((p) => p.startsWith(`${COOKIE}=`));
  const [versao, expira, assinatura] = (cookie ? cookie.slice(COOKIE.length + 1) : '').split('.');
  if (versao !== 'v1' || !/^\d+$/.test(expira || '') || !assinatura || Number(expira) < Date.now() / 1000) return false;
  try {
    return await crypto.subtle.verify('HMAC', await chaveSessao(env), deBase64Url(assinatura), encoder.encode(`v1.${expira}`));
  } catch {
    return false;
  }
}

export const cookieSessao = (valor, segundos) =>
  `${COOKIE}=${valor}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${segundos}`;
export const SEGUNDOS_SESSAO = DIAS_SESSAO * 86400;

/* ---------- bloqueio de tentativas ---------- */
const agora = () => Math.floor(Date.now() / 1000);

export async function bloqueado(env, ip) {
  await prepararBanco(env);
  const { results } = await env.DB.prepare('SELECT chave, total FROM falhas_login WHERE chave IN (?1, ?2) AND expira > ?3')
    .bind(`ip:${ip}`, 'todas', agora()).all();
  const total = Object.fromEntries(results.map((linha) => [linha.chave, linha.total]));
  return (total[`ip:${ip}`] || 0) >= LIMITE_IP.max || (total.todas || 0) >= LIMITE_GERAL.max;
}

// Conta a senha errada; a contagem recomeça quando a janela de tempo acaba.
export async function registrarFalha(env, ip) {
  const instante = agora();
  const contar = (chave, segundos) => env.DB.prepare(
    `INSERT INTO falhas_login (chave, total, expira) VALUES (?1, 1, ?2)
     ON CONFLICT (chave) DO UPDATE SET
       total = CASE WHEN expira <= ?3 THEN 1 ELSE total + 1 END,
       expira = CASE WHEN expira <= ?3 THEN ?2 ELSE expira END`,
  ).bind(chave, instante + segundos, instante);
  await env.DB.batch([
    contar(`ip:${ip}`, LIMITE_IP.segundos),
    contar('todas', LIMITE_GERAL.segundos),
    env.DB.prepare('DELETE FROM falhas_login WHERE expira <= ?1').bind(instante),
  ]);
}

export const limparFalhas = (env, ip) => env.DB.prepare('DELETE FROM falhas_login WHERE chave = ?1').bind(`ip:${ip}`).run();
