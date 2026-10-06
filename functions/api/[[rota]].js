// API da loja
//   GET  /api/produtos            catálogo público (usado pelo site)
//   POST /api/admin/entrar        login do painel  { senha }
//   POST /api/admin/sair          logout
//   GET  /api/admin/sessao        { logado: true | false }
//   GET  /api/admin/catalogo      catálogo completo para edição
//   PUT  /api/admin/catalogo      salva o catálogo  { baseVersao, categorias, produtos }
//   POST /api/admin/imagens       envia uma foto (corpo = imagem WebP/JPEG)
import {
  json, erro, lerCatalogo, limparCatalogo, salvarCatalogo, salvarImagem,
  senhaCorreta, criarSessao, sessaoValida, cookieSessao, SEGUNDOS_SESSAO,
  bloqueado, registrarFalha, limparFalhas,
} from '../../lib/loja.js';

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const rota = url.pathname.replace(/\/+$/, '');
  try {
    if (rota === '/api/produtos' && request.method === 'GET') return await catalogoPublico(context);
    if (rota.startsWith('/api/admin/')) return await painel(context, rota.slice('/api/admin'.length), url);
    return erro(404, 'Rota não encontrada.');
  } catch (e) {
    console.error(e);
    return erro(500, 'Erro no servidor. Tente de novo em instantes.');
  }
}

async function catalogoPublico({ request, env }) {
  const catalogo = await lerCatalogo(env, request);
  const etag = `W/"v${catalogo.versao || 0}-${catalogo.atualizadoEm || ''}"`;
  const cabecalhos = { etag, 'cache-control': 'no-cache' };
  if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers: cabecalhos });
  const { atualizadoEm, categorias, produtos } = catalogo;
  return json({ atualizadoEm, categorias, produtos }, 200, cabecalhos);
}

async function painel(context, rota, url) {
  const { request, env } = context;
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) return erro(500, 'Painel não configurado: defina ADMIN_PASSWORD e SESSION_SECRET.');
  // só aceita alterações vindas do próprio site
  if (request.method !== 'GET' && request.headers.get('Origin') !== url.origin) return erro(403, 'Origem não permitida.');

  if (rota === '/entrar' && request.method === 'POST') return entrar(context);
  if (rota === '/sair' && request.method === 'POST') return json({ ok: true }, 200, { 'set-cookie': cookieSessao('', 0) });
  if (rota === '/sessao' && request.method === 'GET') return json({ logado: await sessaoValida(env, request) });

  if (!(await sessaoValida(env, request))) return erro(401, 'Sua sessão expirou. Entre novamente.');
  if (rota === '/catalogo' && request.method === 'GET') return json(await lerCatalogo(env, request));
  if (rota === '/catalogo' && request.method === 'PUT') return salvar(context);
  if (rota === '/imagens' && request.method === 'POST') return salvarImagem(env, request, url);
  return erro(404, 'Rota não encontrada.');
}

async function entrar(context) {
  const { request, env } = context;
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  if (await bloqueado(env, ip)) return erro(429, 'Muitas tentativas erradas. Aguarde 15 minutos e tente de novo.');

  let senha = '';
  try {
    senha = String((await request.json()).senha || '');
  } catch { /* corpo inválido = senha vazia */ }

  if (!(await senhaCorreta(env, senha))) {
    await registrarFalha(env, ip);
    await new Promise((r) => setTimeout(r, 700)); // atrasa quem tenta adivinhar
    return erro(401, 'Senha incorreta.');
  }
  context.waitUntil(limparFalhas(env, ip));
  return json({ ok: true }, 200, { 'set-cookie': cookieSessao(await criarSessao(env), SEGUNDOS_SESSAO) });
}

async function salvar(context) {
  const { request, env } = context;
  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return erro(400, 'Dados inválidos.');
  }
  const conflito = () => erro(409, 'O catálogo foi alterado em outro aparelho. Recarregue a página e repita a alteração.');
  const atual = await lerCatalogo(env, request);
  if (Number(corpo.baseVersao) !== Number(atual.versao || 0)) return conflito();
  const salvo = await salvarCatalogo(env, context, atual, limparCatalogo(corpo));
  return salvo ? json(salvo) : conflito();
}
