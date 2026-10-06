// Testes de segurança da loja (API, banco, login, uploads e cabeçalhos).
//
//   node testes/seguranca.mjs                         modo completo contra o servidor LOCAL
//                                                     (rode antes: npx wrangler pages dev)
//   node testes/seguranca.mjs https://onshopcell.pages.dev --producao
//                                                     só verificações que não gravam nada
//
// O modo completo faz ataques de verdade (SQL injection, força bruta, uploads
// maliciosos, XSS armazenado...) e por isso SÓ roda contra 127.0.0.1/localhost.
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { webcrypto as crypto } from 'node:crypto';

const BASE = (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://127.0.0.1:8788').replace(/\/$/, '');
const PRODUCAO = process.argv.includes('--producao');
const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE);
if (!LOCAL && !PRODUCAO) {
  console.error('Contra um servidor que não é local, use --producao (só testes que não alteram nada).');
  process.exit(2);
}

const vars = LOCAL ? Object.fromEntries(readFileSync('.dev.vars', 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : {};
const SENHA = vars.ADMIN_PASSWORD;
const resultados = [];
let grupo = '';
const secao = (nome) => { grupo = nome; console.log(`\n== ${nome}`); };
const check = (ok, nome, detalhe = '') => {
  resultados.push({ grupo, ok, nome, detalhe });
  console.log(`${ok ? '  OK    ' : '  FALHOU'} ${nome}${detalhe ? `  (${detalhe})` : ''}`);
};

let ipSeq = 0;
const ipNovo = () => `10.99.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`; // em produção a Cloudflare ignora este cabeçalho
async function req(caminho, { metodo = 'GET', corpo, cabecalhos = {}, cookie, origem = BASE, ip } = {}) {
  const headers = { ...cabecalhos };
  if (origem) headers.Origin = origem;
  if (cookie) headers.Cookie = cookie;
  if (ip) headers['CF-Connecting-IP'] = ip;
  let body = corpo;
  if (corpo !== undefined && !(corpo instanceof Uint8Array) && typeof corpo !== 'string') {
    body = JSON.stringify(corpo);
    headers['Content-Type'] ??= 'application/json';
  }
  const r = await fetch(BASE + caminho, { method: metodo, headers, body, redirect: 'manual' });
  const texto = await r.text();
  let dados = null;
  try { dados = JSON.parse(texto); } catch { /* não é JSON */ }
  return { status: r.status, headers: r.headers, texto, dados };
}

// lê direto o banco D1 local (arquivo SQLite do wrangler pages dev), só para conferir o estado
function d1(sql) {
  const pasta = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
  const arquivo = readdirSync(pasta).find((nome) => nome.endsWith('.sqlite') && nome !== 'metadata.sqlite');
  const banco = new DatabaseSync(`${pasta}/${arquivo}`, { readOnly: true });
  try {
    return banco.prepare(sql).all();
  } finally {
    banco.close();
  }
}

async function entrar(ip = ipNovo()) {
  const r = await req('/api/admin/entrar', { metodo: 'POST', corpo: { senha: SENHA }, ip });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  return { r, cookie };
}

// token assinado igual ao servidor (só no modo local, que conhece os segredos de teste)
const b64url = (buf) => Buffer.from(buf).toString('base64url');
async function assinar(dados, senha = SENHA) {
  const enc = new TextEncoder();
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(senha)));
  const chave = await crypto.subtle.importKey('raw', new Uint8Array([...enc.encode(vars.SESSION_SECRET), ...hash]), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `${dados}.${b64url(await crypto.subtle.sign('HMAC', chave, enc.encode(dados)))}`;
}

const SQLI = [
  "' OR '1'='1", "' OR 1=1 --", "admin'--", "'; DROP TABLE catalogo; --", "\"; DROP TABLE falhas_login; --",
  "1); DELETE FROM catalogo; --", "' UNION SELECT dados, 1, 1 FROM catalogo --", "%27%20OR%201%3D1", "\\'; SELECT sqlite_version(); --",
  "'||(SELECT name FROM sqlite_master)||'",
];

/* =========================================================== */
secao('Arquivos internos e rotas');
for (const caminho of ['/.dev.vars', '/wrangler.toml', '/lib/loja.js', '/functions/api/%5B%5Brota%5D%5D.js', '/.git/config', '/package.json', '/README.md']) {
  const r = await req(caminho);
  check(r.status === 404, `não expõe ${caminho}`, `HTTP ${r.status}`);
}
for (const [metodo, caminho] of [['DELETE', '/api/produtos'], ['PUT', '/api/produtos'], ['PATCH', '/api/admin/catalogo'], ['DELETE', '/api/admin/catalogo'], ['GET', '/api/admin/nada']]) {
  const r = await req(caminho, { metodo });
  check([401, 403, 404, 405].includes(r.status), `${metodo} ${caminho} não faz nada`, `HTTP ${r.status}`);
}

secao('Cabeçalhos de segurança');
const site = await req('/', { origem: null });
const admin = await req('/admin/', { origem: null });
const apiPub = await req('/api/produtos', { origem: null });
check(site.headers.get('x-content-type-options') === 'nosniff', 'site: X-Content-Type-Options');
check(/max-age=\d{7,}/.test(site.headers.get('strict-transport-security') || ''), 'site: HSTS (só HTTPS)');
check(!!site.headers.get('content-security-policy'), 'site: Content-Security-Policy', site.headers.get('content-security-policy')?.slice(0, 60));
check(/frame-ancestors 'none'/.test(admin.headers.get('content-security-policy') || ''), 'app: bloqueia ser embutido (clickjacking)');
check(/noindex/.test(admin.headers.get('x-robots-tag') || ''), 'app: fora dos buscadores');
check(apiPub.headers.get('x-content-type-options') === 'nosniff', 'API: X-Content-Type-Options');
check(!apiPub.headers.get('access-control-allow-origin'), 'API: sem CORS liberado para outros sites');

secao('Acesso sem login');
for (const [metodo, caminho] of [['GET', '/api/admin/catalogo'], ['PUT', '/api/admin/catalogo'], ['POST', '/api/admin/imagens']]) {
  const r = await req(caminho, { metodo, corpo: metodo === 'GET' ? undefined : {} });
  check(r.status === 401, `${metodo} ${caminho} exige login`, `HTTP ${r.status}`);
}
for (const [nome, cookie] of [
  ['cookie inventado', 'painel_sessao=abc'],
  ['token com assinatura falsa', 'painel_sessao=v1.9999999999.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
  ['token sem assinatura', 'painel_sessao=v1.9999999999.'],
  ['injeção no cookie', "painel_sessao=v1.1' OR '1'='1.x"],
  ['versão desconhecida', 'painel_sessao=v9.9999999999.abc'],
]) {
  const r = await req('/api/admin/catalogo', { cookie });
  check(r.status === 401, `recusa ${nome}`, `HTTP ${r.status}`);
}

secao('CSRF e origem');
{
  const semOrigem = await req('/api/admin/entrar', { metodo: 'POST', corpo: { senha: 'x' }, origem: null, ip: ipNovo() });
  check(semOrigem.status === 403, 'login sem cabeçalho Origin é recusado', `HTTP ${semOrigem.status}`);
  const outra = await req('/api/admin/entrar', { metodo: 'POST', corpo: { senha: 'x' }, origem: 'https://site-malicioso.com', ip: ipNovo() });
  check(outra.status === 403, 'login vindo de outro site é recusado', `HTTP ${outra.status}`);
  const preflight = await fetch(`${BASE}/api/admin/catalogo`, { method: 'OPTIONS', headers: { Origin: 'https://site-malicioso.com', 'Access-Control-Request-Method': 'PUT' } });
  check(!preflight.headers.get('access-control-allow-origin'), 'preflight de outro site não recebe permissão CORS');
}

secao('Rotas de foto (path traversal)');
for (const caminho of ['/img/..%2f..%2fwrangler.toml', '/img/../lib/loja.js', "/img/x'%20OR%201=1.webp", '/img/%00.webp', '/img/a.svg', '/img/a.html', '/img/IMG.WEBP']) {
  const r = await req(caminho, { origem: null });
  check([400, 404].includes(r.status) && !/ADMIN_PASSWORD|kv_namespaces|export /.test(r.texto), `bloqueia ${caminho}`, `HTTP ${r.status}`);
}

if (PRODUCAO) {
  secao('Produção: login com SQL injection (só 1 tentativa, sem gravar nada)');
  const r = await req('/api/admin/entrar', { metodo: 'POST', corpo: { senha: SQLI[0] } });
  check(r.status === 401, 'senha com SQL injection é recusada', `HTTP ${r.status}`);
} else {
  /* =================== só no servidor local =================== */
  secao('SQL injection: campo de senha');
  for (const payload of SQLI) {
    const r = await req('/api/admin/entrar', { metodo: 'POST', corpo: { senha: payload }, ip: ipNovo() });
    check(r.status === 401 && !/sqlite|SQL|syntax/i.test(r.texto), `senha ${JSON.stringify(payload)}`, `HTTP ${r.status}`);
  }

  secao('SQL injection: endereço IP (usado nas consultas do bloqueio de login)');
  for (const payload of SQLI.slice(0, 6)) {
    const r = await req('/api/admin/entrar', { metodo: 'POST', corpo: { senha: 'errada' }, ip: payload });
    check(r.status === 401, `IP ${JSON.stringify(payload)}`, `HTTP ${r.status}`);
  }
  const chaves = d1('SELECT chave FROM falhas_login').map((l) => l.chave);
  check(chaves.includes(`ip:${SQLI[3]}`), 'o texto malicioso foi guardado como dado comum, sem executar SQL');
  const tabelas = d1("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((l) => l.name);
  check(['catalogo', 'falhas_login', 'historico'].every((t) => tabelas.includes(t)), 'tabelas continuam intactas', tabelas.join(', '));

  secao('Sessão');
  const { r: login, cookie } = await entrar();
  const setCookie = login.headers.get('set-cookie') || '';
  check(login.status === 200, 'login com a senha certa');
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api/admin']) check(setCookie.includes(flag), `cookie com ${flag}`);
  const [versao, id, expira, assinatura] = cookie.split('=')[1].split('.');
  const futuro = Math.floor(Date.now() / 1000) + 3600;
  const vencido = await assinar(`${versao}.${id}.${Math.floor(Date.now() / 1000) - 60}`);
  check((await req('/api/admin/catalogo', { cookie: `painel_sessao=${vencido}` })).status === 401, 'recusa token vencido (mesmo com assinatura certa)');
  const outraSenha = await assinar(`${versao}.${id}.${futuro}`, 'senha-antiga');
  check((await req('/api/admin/catalogo', { cookie: `painel_sessao=${outraSenha}` })).status === 401, 'recusa token assinado com outra senha (troca de senha desconecta)');
  check((await req('/api/admin/catalogo', { cookie: `painel_sessao=${versao}.${id}.9999999999.${assinatura}` })).status === 401, 'recusa token com validade adulterada');
  const inexistente = await assinar(`${versao}.${'A'.repeat(32)}.${futuro}`);
  check((await req('/api/admin/catalogo', { cookie: `painel_sessao=${inexistente}` })).status === 401, 'recusa sessão com assinatura certa mas que não existe no banco');
  check((await req('/api/admin/catalogo', { cookie })).status === 200, 'token legítimo funciona', `expira em ${Math.round((expira - Date.now() / 1000) / 86400)} dias`);
  await req('/api/admin/sair', { metodo: 'POST', cookie });
  const depoisDeSair = await req('/api/admin/catalogo', { cookie });
  check(depoisDeSair.status === 401, 'depois de "Sair", o mesmo token deixa de valer', `HTTP ${depoisDeSair.status}`);
  const aparelhoA = (await entrar()).cookie;
  const aparelhoB = (await entrar()).cookie;
  await req('/api/admin/sair-de-todos', { metodo: 'POST', cookie: aparelhoA });
  const restantes = await Promise.all([aparelhoA, aparelhoB].map((ck) => req('/api/admin/catalogo', { cookie: ck })));
  check(restantes.every((r) => r.status === 401), '"Sair de todos os aparelhos" desconecta todos', restantes.map((r) => r.status).join(', '));
  check(d1('SELECT COUNT(*) AS n FROM sessoes')[0].n === 0, 'nenhuma sessão sobra no banco');

  secao('SQL injection e XSS: dados do catálogo');
  const { cookie: c2 } = await entrar();
  const atual = (await req('/api/admin/catalogo', { cookie: c2 })).dados;
  const malicioso = {
    id: 'teste-seguranca',
    titulo: `${SQLI[3]} <img src=x onerror=alert('xss-titulo')>`,
    categoria: 'cat-maliciosa',
    descricao: `<script>alert('xss-desc')</script> ${SQLI[6]}`,
    preco: '1e400', precoAntigo: -50,
    cores: [{ nome: `"><svg onload=alert('xss-cor')>`, hex: '#ff0000' }, { nome: 'Ruim', hex: 'red;background:url(javascript:alert(1))' }],
    imagens: ['javascript:alert(1)', 'https://site-malicioso.com/a.webp', '../../wrangler.toml', 'img/../../lib/loja.js', 'data:image/png;base64,AAAA', 'assets/produtos/smartwatch.webp'],
    destaque: 'sim', disponivel: 0, admin: true,
    ...JSON.parse('{"__proto__": {"admin": true}, "constructor": {"prototype": {"admin": true}}}'), // tentativa de poluir protótipos
  };
  const put = await req('/api/admin/catalogo', {
    metodo: 'PUT', cookie: c2,
    corpo: { baseVersao: atual.versao, versao: 999999, categorias: [...atual.categorias, { id: 'cat-maliciosa', nome: "<b>x</b>'; DROP TABLE historico; --" }, { id: "x' OR '1'='1", nome: 'invalida' }], produtos: [malicioso, ...atual.produtos] },
  });
  check(put.status === 200, 'catálogo com conteúdo malicioso é aceito só como texto', `HTTP ${put.status}`);
  const salvo = put.dados?.produtos?.[0] || {};
  check(salvo.titulo === malicioso.titulo.slice(0, 80) && salvo.descricao.startsWith('<script>'), 'textos guardados exatamente como digitados (sem executar SQL)');
  check(JSON.stringify(salvo.imagens) === '["assets/produtos/smartwatch.webp"]', 'endereços de imagem perigosos foram descartados', JSON.stringify(salvo.imagens));
  check(salvo.cores?.length === 1 && salvo.preco === null && salvo.precoAntigo === null, 'cor e preços inválidos descartados');
  check(salvo.destaque === false && !('admin' in salvo), 'campos extras ignorados (sem "mass assignment")');
  check(put.dados?.versao === atual.versao + 1, 'a versão é controlada só pelo servidor', `versão ${put.dados?.versao}`);
  check(!put.dados.categorias.some((c) => c.id.includes("'")), 'categoria com id malicioso descartada');
  const contagem = d1('SELECT (SELECT COUNT(*) FROM catalogo) AS c, (SELECT COUNT(*) FROM historico) AS h')[0];
  check(contagem.c === 1, 'tabela do catálogo intacta', JSON.stringify(contagem));

  secao('Validação de dados enviados');
  for (const [nome, corpo] of [['corpo null', 'null'], ['lista em vez de objeto', '[]'], ['texto solto', '"oi"'], ['JSON quebrado', '{"a":']]) {
    const r = await req('/api/admin/catalogo', { metodo: 'PUT', cookie: c2, corpo, cabecalhos: { 'Content-Type': 'application/json' } });
    check([400, 409].includes(r.status), `${nome} é recusado com erro de dados`, `HTTP ${r.status}`);
  }
  const grande = await req('/api/admin/catalogo', { metodo: 'PUT', cookie: c2, corpo: JSON.stringify({ lixo: 'x'.repeat(3 * 1024 * 1024) }), cabecalhos: { 'Content-Type': 'application/json' } });
  check(grande.status === 413, 'catálogo gigante (3 MB) é recusado', `HTTP ${grande.status}`);
  const loginGrande = await req('/api/admin/entrar', { metodo: 'POST', corpo: JSON.stringify({ senha: 'x'.repeat(200000) }), cabecalhos: { 'Content-Type': 'application/json' }, ip: ipNovo() });
  check(loginGrande.status === 413, 'login com corpo gigante é recusado antes de processar', `HTTP ${loginGrande.status}`);

  secao('Upload de fotos');
  const jpeg = (n) => { const b = new Uint8Array(n); b.set([0xff, 0xd8, 0xff, 0xe0]); return b; };
  const up = (corpo, tipo, extra = '', ck = c2) => req(`/api/admin/imagens${extra}`, { metodo: 'POST', cookie: ck, corpo, cabecalhos: { 'Content-Type': tipo } });
  check((await up(jpeg(100), 'image/jpeg', '', null)).status === 401, 'upload sem login é recusado');
  check((await up(new TextEncoder().encode('<html><script>alert(1)</script></html>'), 'image/webp')).status === 415, 'HTML disfarçado de foto é recusado');
  check((await up(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'image/svg+xml')).status === 415, 'SVG (pode ter script) é recusado');
  check((await up(new TextEncoder().encode('oi'), 'text/html')).status === 415, 'tipo text/html é recusado');
  check((await up(new Uint8Array(0), 'image/jpeg')).status === 400, 'arquivo vazio é recusado');
  check((await up(jpeg(3 * 1024 * 1024), 'image/jpeg')).status === 413, 'foto acima de 2,5 MB é recusada');
  const poliglota = new Uint8Array([...jpeg(4), ...new TextEncoder().encode('<script>alert(1)</script>')]);
  const enviado = await up(poliglota, 'image/jpeg', `?produto=${encodeURIComponent("../../x' OR 1=1")}`);
  check(enviado.status === 201 && /^img\/[a-z0-9-]+-[0-9a-f]{8}\.jpg$/.test(enviado.dados?.caminho || '') && !/[./']/.test(enviado.dados.caminho.slice(4, -4)), 'nome do arquivo é limpo pelo servidor (sem ../ nem aspas)', enviado.dados?.caminho);
  const servido = await req(`/${enviado.dados?.caminho}`, { origem: null });
  check(servido.headers.get('content-type') === 'image/jpeg' && servido.headers.get('x-content-type-options') === 'nosniff', 'arquivo "poliglota" é servido só como imagem (o navegador não executa)');
  check(servido.headers.get('cross-origin-resource-policy') === 'same-origin', 'fotos não podem ser embutidas por outros sites (protege a cota grátis)');

  secao('Força bruta no login');
  const ipAtacante = ipNovo();
  let ultimo;
  for (let i = 0; i < 8; i++) ultimo = await req('/api/admin/entrar', { metodo: 'POST', corpo: { senha: `chute-${i}` }, ip: ipAtacante });
  const bloqueio = await req('/api/admin/entrar', { metodo: 'POST', corpo: { senha: SENHA }, ip: ipAtacante });
  check(ultimo.status === 401 && bloqueio.status === 429, 'depois de 8 erros, o endereço é bloqueado (até com a senha certa)', `HTTP ${bloqueio.status}`);
  check((await entrar(ipNovo())).r.status === 200, 'outros endereços continuam entrando normalmente');
  const linha = d1(`SELECT total, expira - strftime('%s','now') AS resta FROM falhas_login WHERE chave = 'ip:${ipAtacante}'`)[0];
  check(linha && linha.total >= 8 && linha.resta > 800 && linha.resta <= 900, 'bloqueio dura 15 minutos', `${linha?.resta}s restantes`);
}

/* =========================================================== */
const falhas = resultados.filter((r) => !r.ok);
console.log(`\n${resultados.length - falhas.length}/${resultados.length} verificações OK${falhas.length ? ` — ${falhas.length} FALHARAM` : ''}`);
process.exitCode = falhas.length ? 1 : 0;
