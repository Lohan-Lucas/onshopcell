/* =============================================================
   Catálogo On Shop Cell — app do lojista (PWA)
   Telas: entrar (senha) → lista de produtos → editor.
   Fala com a API do site (/api/admin/*); a sessão fica num cookie
   seguro. As fotos são reduzidas no próprio celular antes do envio.
   ============================================================= */
(() => {
  'use strict';

  const MAX_FOTOS = 6;
  const LADO_MAX = 1200; // px do maior lado da foto enviada
  const NOVA_CATEGORIA = '__nova__';
  const CORES_PRONTAS = [
    ['Preto', '#1b1d21'], ['Branco', '#f5f5f5'], ['Cinza', '#8a8f98'], ['Prata', '#c9ccd1'],
    ['Dourado', '#d4af37'], ['Rosa', '#f2a7b9'], ['Vermelho', '#d63a3a'], ['Laranja', '#f08a24'],
    ['Amarelo', '#f5c842'], ['Verde', '#2e9d58'], ['Verde-água', '#6fd6c4'], ['Azul', '#2f6fde'],
    ['Azul-claro', '#8ec5ff'], ['Azul-marinho', '#1f2f55'], ['Roxo', '#7a4fc9'], ['Lilás', '#b9a3e3'],
  ];

  const $ = (id) => document.getElementById(id);
  const ui = {
    app: $('app'), lista: $('lista'), resumo: $('resumo'), vazio: $('vazio'), vazioTexto: $('vazio-texto'),
    filtros: $('filtros'), busca: $('busca'), barraBusca: $('barra-busca'), btnBusca: $('btn-busca'),
    btnMenu: $('btn-menu'), menu: $('menu'), btnNovo: $('btn-novo'), barraOrdem: $('barra-ordem'),
    editor: $('editor'), form: $('form'), editorTitulo: $('editor-titulo'), corpoEditor: document.querySelector('.editor__body'),
    fotos: $('fotos'), fotoCamera: $('foto-camera'), fotoGaleria: $('foto-galeria'), acoesFoto: document.querySelector('.photo-actions'),
    titulo: $('f-titulo'), preco: $('f-preco'), precoAntigo: $('f-preco-antigo'),
    categoria: $('f-categoria'), novaCategoria: $('nova-categoria'), nomeCategoria: $('f-nova-categoria'),
    descricao: $('f-descricao'), contador: $('contador-descricao'),
    coresEscolhidas: $('cores-escolhidas'), paleta: $('paleta'), corHex: $('cor-hex'), corNome: $('cor-nome'),
    disponivel: $('f-disponivel'), destaque: $('f-destaque'), btnExcluir: $('btn-excluir'),
    login: $('login'), loginForm: $('login-form'), loginSenha: $('login-senha'), loginErro: $('login-erro'),
    loginTexto: $('login-texto'), loginEntrar: $('login-entrar'), mostrarSenha: $('mostrar-senha'),
    ocupado: $('ocupado'), ocupadoTexto: $('ocupado-texto'), aviso: $('aviso'), instalarIos: $('instalar-ios'),
  };

  const estado = {
    catalogo: null,
    carregadoEm: 0,
    filtro: 'todos',
    busca: '',
    ordem: null,          // cópia da lista enquanto reorganiza
    editando: null,       // id do produto aberto (null = produto novo)
    fotos: [],            // { caminho?, blob?, url }
    cores: [],            // { nome, hex }
    categoriasNovas: [],  // criadas no editor e ainda não salvas
    alterado: false,
    instalar: null,       // convite de instalação do Android
    loginPendente: null,  // continua a ação depois de entrar de novo
  };

  /* ---------- utilidades ---------- */
  const dinheiro = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const limparTexto = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const slug = (s) => normalizar(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'produto';
  const idUnico = (base, usados) => {
    let id = base;
    for (let n = 2; usados.has(id); n++) id = `${base}-${n}`;
    return id;
  };
  const urlImagem = (caminho) => `/${caminho}`;
  const vibrar = () => { try { navigator.vibrate?.(15); } catch { /* sem vibração */ } };

  // aceita "1499", "1.499", "1.499,90", "149,9", "R$ 25"
  function lerPreco(texto) {
    let s = String(texto || '').replace(/[^\d.,]/g, '');
    if (!s) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return NaN;
    return n === 0 ? null : Math.round(n * 100) / 100;
  }
  const formatarPreco = (n) => (typeof n === 'number' ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');

  function icone(id) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'i');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#${id}`);
    svg.append(use);
    return svg;
  }

  /* ---------- carregando / avisos (popovers ficam por cima do editor) ---------- */
  const temPopover = typeof HTMLElement.prototype.showPopover === 'function';
  const mostrarCamada = (el) => {
    if (temPopover) { if (!el.matches(':popover-open')) el.showPopover(); } else el.classList.add('is-open');
  };
  const esconderCamada = (el) => {
    if (temPopover) { if (el.matches(':popover-open')) el.hidePopover(); } else el.classList.remove('is-open');
  };
  function ocupado(texto) {
    ui.ocupadoTexto.textContent = texto;
    mostrarCamada(ui.ocupado);
  }
  const livre = () => esconderCamada(ui.ocupado);
  let timerAviso = 0;
  function avisar(texto, erro = false) {
    clearTimeout(timerAviso);
    ui.aviso.textContent = texto;
    ui.aviso.classList.toggle('snackbar--erro', erro);
    esconderCamada(ui.aviso);
    mostrarCamada(ui.aviso); // reabre para ficar acima de tudo
    timerAviso = setTimeout(() => esconderCamada(ui.aviso), erro ? 6500 : 3500);
  }

  /* ---------- servidor ---------- */
  async function api(caminho, { metodo = 'GET', corpo } = {}) {
    const opcoes = { method: metodo, credentials: 'same-origin', cache: 'no-store', headers: {} };
    if (corpo instanceof Blob) {
      opcoes.body = corpo;
      opcoes.headers['Content-Type'] = corpo.type;
    } else if (corpo !== undefined) {
      opcoes.body = JSON.stringify(corpo);
      opcoes.headers['Content-Type'] = 'application/json';
    }
    let resposta;
    try {
      resposta = await fetch(caminho, opcoes);
    } catch {
      throw Object.assign(new Error('Sem conexão com a internet. Confira e tente de novo.'), { status: 0 });
    }
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok) throw Object.assign(new Error(dados.erro || `Erro ${resposta.status}. Tente de novo.`), { status: resposta.status });
    return dados;
  }

  // Se a sessão expirar no meio de uma ação, pede a senha e repete a ação.
  async function comSessao(acao) {
    try {
      return await acao();
    } catch (erro) {
      if (erro.status !== 401) throw erro;
      const texto = ui.ocupadoTexto.textContent;
      const estavaOcupado = temPopover ? ui.ocupado.matches(':popover-open') : ui.ocupado.classList.contains('is-open');
      livre();
      await pedirSenha('Sua sessão terminou. Digite a senha para continuar.');
      if (estavaOcupado) ocupado(texto);
      return acao();
    }
  }

  // Salva no site. "mudanca" recebe uma cópia do catálogo e devolve a versão nova;
  // se alguém salvou em outro aparelho no meio tempo, aplica de novo sobre a versão mais recente.
  async function publicar(mudanca) {
    for (let tentativa = 0; ; tentativa++) {
      const proximo = mudanca(structuredClone(estado.catalogo));
      try {
        estado.catalogo = await comSessao(() => api('/api/admin/catalogo', {
          metodo: 'PUT',
          corpo: { baseVersao: estado.catalogo.versao || 0, categorias: proximo.categorias, produtos: proximo.produtos },
        }));
        estado.carregadoEm = Date.now();
        renderTudo();
        return;
      } catch (erro) {
        if (erro.status !== 409 || tentativa > 0) throw erro;
        estado.catalogo = await comSessao(() => api('/api/admin/catalogo'));
      }
    }
  }

  async function carregar({ silencioso = false } = {}) {
    if (!silencioso) ocupado('Carregando produtos…');
    try {
      estado.catalogo = await comSessao(() => api('/api/admin/catalogo'));
      estado.carregadoEm = Date.now();
    } finally {
      if (!silencioso) livre();
    }
    renderTudo();
  }

  /* ---------- entrar ---------- */
  function pedirSenha(texto) {
    ui.loginTexto.textContent = texto || 'Acesso exclusivo do dono da On Shop Cell.';
    ui.loginErro.hidden = true;
    ui.loginSenha.value = '';
    if (!ui.login.open) ui.login.showModal();
    setTimeout(() => ui.loginSenha.focus(), 60);
    return new Promise((resolve) => { estado.loginPendente = resolve; });
  }

  function erroLogin(texto) {
    ui.loginErro.textContent = texto;
    ui.loginErro.hidden = false;
  }

  ui.loginForm.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const senha = ui.loginSenha.value;
    if (!senha) return erroLogin('Digite a senha.');
    ui.loginEntrar.disabled = true;
    ui.loginEntrar.textContent = 'Entrando…';
    try {
      await api('/api/admin/entrar', { metodo: 'POST', corpo: { senha } });
      ui.loginSenha.value = '';
      ui.login.close();
      const continuar = estado.loginPendente;
      estado.loginPendente = null;
      if (continuar) continuar();
    } catch (erro) {
      erroLogin(erro.message);
      ui.loginSenha.select();
    } finally {
      ui.loginEntrar.disabled = false;
      ui.loginEntrar.textContent = 'Entrar';
    }
  });
  ui.login.addEventListener('cancel', (evento) => evento.preventDefault()); // só sai entrando
  ui.mostrarSenha.addEventListener('click', () => {
    const mostrar = ui.loginSenha.type === 'password';
    ui.loginSenha.type = mostrar ? 'text' : 'password';
    ui.mostrarSenha.setAttribute('aria-pressed', String(mostrar));
    ui.mostrarSenha.setAttribute('aria-label', mostrar ? 'Esconder senha' : 'Mostrar senha');
  });

  async function sair() {
    if (!confirm('Sair do app neste aparelho?')) return;
    try { await api('/api/admin/sair', { metodo: 'POST' }); } catch { /* sem conexão: sai mesmo assim */ }
    estado.catalogo = null;
    ui.app.hidden = true;
    await pedirSenha();
    await carregar();
    ui.app.hidden = false;
  }

  /* ---------- lista ---------- */
  function renderTudo() {
    renderFiltros();
    renderLista();
  }

  function renderFiltros() {
    const { categorias, produtos } = estado.catalogo;
    const usadas = new Set(produtos.map((p) => p.categoria));
    const opcoes = [{ id: 'todos', nome: `Todos (${produtos.length})` }, ...categorias.filter((c) => usadas.has(c.id))];
    if (!opcoes.some((o) => o.id === estado.filtro)) estado.filtro = 'todos';
    ui.filtros.replaceChildren(...opcoes.map((opcao) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.dataset.filtro = opcao.id;
      chip.textContent = opcao.nome;
      chip.setAttribute('aria-pressed', String(opcao.id === estado.filtro));
      return chip;
    }));
    ui.filtros.hidden = Boolean(estado.ordem) || opcoes.length <= 2;
  }

  function renderLista() {
    const { categorias, produtos } = estado.catalogo;
    const nomes = new Map(categorias.map((c) => [c.id, c.nome]));
    const termo = normalizar(estado.busca);
    const base = estado.ordem || produtos;
    const visiveis = estado.ordem ? base : base.filter((p) =>
      (estado.filtro === 'todos' || p.categoria === estado.filtro) && (!termo || normalizar(p.titulo).includes(termo)));
    ui.lista.replaceChildren(...visiveis.map((p, i) => criarLinha(p, nomes.get(p.categoria) || '', i, base.length)));
    ui.vazio.hidden = visiveis.length > 0;
    ui.vazioTexto.textContent = produtos.length
      ? 'Nenhum produto encontrado.'
      : 'Nenhum produto cadastrado ainda. Toque em "Novo produto" para começar.';
    const esgotados = produtos.filter((p) => p.disponivel === false).length;
    ui.resumo.textContent = estado.ordem
      ? 'A ordem desta lista é a ordem em que os produtos aparecem no site.'
      : `${produtos.length} ${produtos.length === 1 ? 'produto' : 'produtos'} no site${esgotados ? ` · ${esgotados} esgotado${esgotados > 1 ? 's' : ''}` : ''}`;
  }

  function etiqueta(texto, classe) {
    const tag = document.createElement('span');
    tag.className = `tag ${classe}`;
    tag.textContent = texto;
    return tag;
  }

  function botaoIcone(idIcone, rotulo, desativado, acao) {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'icon-btn';
    botao.setAttribute('aria-label', rotulo);
    botao.disabled = desativado;
    botao.append(icone(idIcone));
    botao.addEventListener('click', acao);
    return botao;
  }

  function criarLinha(produto, categoria, indice, total) {
    const linha = document.createElement('li');
    linha.className = 'item';
    if (produto.disponivel === false) linha.classList.add('item--out');

    const principal = document.createElement(estado.ordem ? 'div' : 'button');
    principal.className = 'item__main';
    if (!estado.ordem) {
      principal.type = 'button';
      principal.setAttribute('aria-label', `Editar ${produto.titulo}`);
      principal.addEventListener('click', () => abrirEditor(produto.id));
    }

    const miniatura = document.createElement('span');
    miniatura.className = 'item__thumb';
    if (produto.imagens[0]) {
      const img = document.createElement('img');
      img.src = urlImagem(produto.imagens[0]);
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      miniatura.append(img);
    } else {
      miniatura.append(icone('i-image'));
    }

    const info = document.createElement('span');
    info.className = 'item__info';
    const titulo = document.createElement('span');
    titulo.className = 'item__title';
    titulo.textContent = produto.titulo;
    const meta = document.createElement('span');
    meta.className = 'item__meta';
    const preco = document.createElement('span');
    if (typeof produto.preco === 'number') {
      preco.className = 'item__price';
      preco.textContent = dinheiro.format(produto.preco);
    } else {
      preco.className = 'item__price item__price--ask';
      preco.textContent = 'Sem preço';
    }
    meta.append(preco, ` · ${categoria}`);
    info.append(titulo, meta);

    const tags = document.createElement('span');
    tags.className = 'item__tags';
    if (produto.cores.length) {
      const bolinhas = document.createElement('span');
      bolinhas.className = 'dots';
      produto.cores.slice(0, 8).forEach((cor) => {
        const bolinha = document.createElement('span');
        bolinha.className = 'dot';
        bolinha.title = cor.nome;
        bolinha.style.setProperty('--c', cor.hex);
        bolinhas.append(bolinha);
      });
      tags.append(bolinhas);
    }
    if (produto.destaque) tags.append(etiqueta('Destaque', 'tag--star'));
    if (produto.disponivel === false) tags.append(etiqueta('Esgotado', 'tag--out'));
    if (tags.childElementCount) info.append(tags);

    principal.append(miniatura, info);
    linha.append(principal);

    if (estado.ordem) {
      const ordem = document.createElement('span');
      ordem.className = 'item__sort';
      ordem.append(
        botaoIcone('i-up', `Subir ${produto.titulo}`, indice === 0, () => mover(indice, -1)),
        botaoIcone('i-down', `Descer ${produto.titulo}`, indice === total - 1, () => mover(indice, 1)),
      );
      linha.append(ordem);
    }
    return linha;
  }

  ui.filtros.addEventListener('click', (evento) => {
    const chip = evento.target.closest('[data-filtro]');
    if (!chip) return;
    estado.filtro = chip.dataset.filtro;
    renderTudo();
  });

  ui.btnBusca.addEventListener('click', () => {
    const abrir = ui.barraBusca.hidden;
    ui.barraBusca.hidden = !abrir;
    ui.btnBusca.setAttribute('aria-expanded', String(abrir));
    if (abrir) {
      ui.busca.focus();
    } else {
      ui.busca.value = '';
      estado.busca = '';
      renderLista();
    }
  });
  ui.busca.addEventListener('input', () => {
    estado.busca = ui.busca.value;
    renderLista();
  });

  /* ---------- ordem dos produtos ---------- */
  function iniciarOrdem() {
    estado.ordem = [...estado.catalogo.produtos];
    ui.barraOrdem.hidden = false;
    ui.btnNovo.hidden = true;
    renderTudo();
  }

  function encerrarOrdem() {
    estado.ordem = null;
    ui.barraOrdem.hidden = true;
    ui.btnNovo.hidden = false;
    renderTudo();
  }

  function mover(indice, delta) {
    const lista = estado.ordem;
    const destino = indice + delta;
    if (destino < 0 || destino >= lista.length) return;
    [lista[indice], lista[destino]] = [lista[destino], lista[indice]];
    renderLista();
    const botoes = ui.lista.children[destino]?.querySelectorAll('.item__sort .icon-btn');
    const alvo = botoes && (botoes[delta < 0 ? 0 : 1].disabled ? botoes[delta < 0 ? 1 : 0] : botoes[delta < 0 ? 0 : 1]);
    if (alvo) alvo.focus();
  }

  $('ordem-cancelar').addEventListener('click', encerrarOrdem);
  $('ordem-salvar').addEventListener('click', async () => {
    const ids = estado.ordem.map((p) => p.id);
    ocupado('Salvando a ordem…');
    try {
      await publicar((catalogo) => {
        const posicao = new Map(ids.map((id, i) => [id, i]));
        catalogo.produtos.sort((a, b) => (posicao.get(a.id) ?? 1e9) - (posicao.get(b.id) ?? 1e9));
        return catalogo;
      });
      encerrarOrdem();
      avisar('Ordem salva. Já está no site!');
      vibrar();
    } catch (erro) {
      avisar(erro.message, true);
    } finally {
      livre();
    }
  });

  /* ---------- menu ---------- */
  function alternarMenu(abrir) {
    ui.menu.hidden = !abrir;
    ui.btnMenu.setAttribute('aria-expanded', String(abrir));
  }
  ui.btnMenu.addEventListener('click', (evento) => {
    evento.stopPropagation();
    alternarMenu(ui.menu.hidden);
  });
  document.addEventListener('click', (evento) => {
    if (!ui.menu.hidden && (!evento.target.closest('.menu-wrap') || evento.target.closest('.menu__item'))) alternarMenu(false);
  });
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && !ui.menu.hidden) alternarMenu(false);
  });
  $('menu-ordem').addEventListener('click', iniciarOrdem);
  $('menu-atualizar').addEventListener('click', () => {
    carregar().then(() => avisar('Lista atualizada.')).catch((erro) => avisar(erro.message, true));
  });
  $('menu-backup').addEventListener('click', () => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(estado.catalogo, null, 2)], { type: 'application/json' }));
    link.download = `catalogo-onshopcell-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  });
  $('menu-sair').addEventListener('click', sair);
  // para quando perder o celular ou desconfiar que alguém viu a senha
  $('menu-sair-todos').addEventListener('click', async () => {
    if (!confirm('Desconectar o app de TODOS os aparelhos, inclusive este?\nUse se perdeu o celular ou acha que alguém viu a senha.')) return;
    try {
      await comSessao(() => api('/api/admin/sair-de-todos', { metodo: 'POST' }));
    } catch (erro) {
      avisar(erro.message, true);
      return;
    }
    estado.catalogo = null;
    ui.app.hidden = true;
    await pedirSenha('Todos os aparelhos foram desconectados. Entre de novo para continuar.');
    await carregar();
    ui.app.hidden = false;
  });

  /* ---------- editor ---------- */
  ui.btnNovo.addEventListener('click', () => abrirEditor(null));

  function abrirEditor(id) {
    alternarMenu(false);
    const produto = id ? estado.catalogo.produtos.find((p) => p.id === id) : null;
    estado.editando = produto ? produto.id : null;
    estado.fotos = (produto?.imagens || []).map((caminho) => ({ caminho, url: urlImagem(caminho) }));
    estado.cores = (produto?.cores || []).map((cor) => ({ ...cor }));
    estado.categoriasNovas = [];

    ui.editorTitulo.textContent = produto ? 'Editar produto' : 'Novo produto';
    ui.titulo.value = produto?.titulo || '';
    ui.preco.value = formatarPreco(produto?.preco);
    ui.precoAntigo.value = formatarPreco(produto?.precoAntigo);
    montarCategorias(produto?.categoria || (estado.filtro !== 'todos' ? estado.filtro : estado.catalogo.categorias[0]?.id));
    ui.descricao.value = produto?.descricao || '';
    atualizarContador();
    ui.disponivel.checked = produto ? produto.disponivel !== false : true;
    ui.destaque.checked = Boolean(produto?.destaque);
    ui.btnExcluir.hidden = !produto;
    ui.corNome.value = '';
    limparErros();
    renderFotos();
    renderCores();

    estado.alterado = false;
    ui.editor.showModal();
    ui.corpoEditor.scrollTop = 0;
    history.pushState({ editor: true }, ''); // o "voltar" do celular fecha o editor
  }

  function fecharEditor({ forcar = false, peloVoltar = false } = {}) {
    if (!ui.editor.open) return;
    if (!forcar && estado.alterado && !confirm('Sair sem salvar as alterações?')) {
      if (peloVoltar) history.pushState({ editor: true }, '');
      return;
    }
    estado.fotos.forEach((foto) => { if (foto.url.startsWith('blob:')) URL.revokeObjectURL(foto.url); });
    estado.fotos = [];
    estado.alterado = false;
    ui.editor.close();
    if (!peloVoltar && history.state && history.state.editor) history.back();
  }

  $('editor-voltar').addEventListener('click', () => fecharEditor());
  ui.editor.addEventListener('cancel', (evento) => {
    evento.preventDefault();
    fecharEditor();
  });
  window.addEventListener('popstate', () => {
    if (ui.editor.open) fecharEditor({ peloVoltar: true });
  });
  window.addEventListener('beforeunload', (evento) => {
    if (ui.editor.open && estado.alterado) {
      evento.preventDefault();
      evento.returnValue = '';
    }
  });
  ui.form.addEventListener('input', () => { estado.alterado = true; });
  ui.form.addEventListener('change', () => { estado.alterado = true; });

  // categorias
  function montarCategorias(selecionada) {
    const todas = [...estado.catalogo.categorias, ...estado.categoriasNovas];
    ui.categoria.replaceChildren(
      ...todas.map((c) => new Option(c.nome, c.id, false, c.id === selecionada)),
      new Option('+ Nova categoria…', NOVA_CATEGORIA),
    );
    if (!todas.some((c) => c.id === selecionada) && todas[0]) ui.categoria.value = todas[0].id;
    ui.novaCategoria.hidden = true;
  }

  function criarCategoria() {
    const nome = limparTexto(ui.nomeCategoria.value, 40);
    if (!nome) {
      ui.nomeCategoria.focus();
      return;
    }
    const todas = [...estado.catalogo.categorias, ...estado.categoriasNovas];
    const existente = todas.find((c) => normalizar(c.nome) === normalizar(nome));
    const id = existente ? existente.id : idUnico(slug(nome), new Set(todas.map((c) => c.id)));
    if (!existente) estado.categoriasNovas.push({ id, nome });
    montarCategorias(id);
    ui.nomeCategoria.value = '';
    estado.alterado = true;
  }

  ui.categoria.addEventListener('change', () => {
    const nova = ui.categoria.value === NOVA_CATEGORIA;
    ui.novaCategoria.hidden = !nova;
    if (nova) ui.nomeCategoria.focus();
  });
  $('btn-criar-categoria').addEventListener('click', criarCategoria);
  ui.nomeCategoria.addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter') {
      evento.preventDefault();
      criarCategoria();
    }
  });

  // preço e descrição
  [ui.preco, ui.precoAntigo].forEach((campo) => campo.addEventListener('blur', () => {
    const valor = lerPreco(campo.value);
    if (typeof valor === 'number' && !Number.isNaN(valor)) campo.value = formatarPreco(valor);
  }));
  function atualizarContador() {
    ui.contador.textContent = `${ui.descricao.value.length}/160`;
  }
  ui.descricao.addEventListener('input', atualizarContador);

  // fotos
  async function prepararFoto(arquivo) {
    const origem = URL.createObjectURL(arquivo);
    try {
      const img = new Image();
      img.src = origem;
      await img.decode();
      const escala = Math.min(1, LADO_MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const largura = Math.max(1, Math.round(img.naturalWidth * escala));
      const altura = Math.max(1, Math.round(img.naturalHeight * escala));
      const canvas = document.createElement('canvas');
      canvas.width = largura;
      canvas.height = altura;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, largura, altura); // a cópia não leva dados do GPS da foto
      let blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.82));
      if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
      if (!blob) throw new Error('não foi possível converter');
      return { blob, url: URL.createObjectURL(blob) };
    } finally {
      URL.revokeObjectURL(origem);
    }
  }

  async function adicionarFotos(lista) {
    const vagas = MAX_FOTOS - estado.fotos.length;
    if (vagas <= 0) return avisar(`Cada produto pode ter até ${MAX_FOTOS} fotos.`, true);
    const arquivos = [...lista].slice(0, vagas);
    if (lista.length > vagas) avisar(`Só cabem mais ${vagas} foto${vagas > 1 ? 's' : ''} neste produto.`, true);
    ocupado(arquivos.length > 1 ? `Preparando ${arquivos.length} fotos…` : 'Preparando a foto…');
    try {
      for (const arquivo of arquivos) {
        try {
          estado.fotos.push(await prepararFoto(arquivo));
          estado.alterado = true;
        } catch {
          avisar(`Não consegui abrir "${arquivo.name}". Use fotos JPG, PNG ou WebP.`, true);
        }
      }
    } finally {
      livre();
    }
    renderFotos();
  }

  [ui.fotoCamera, ui.fotoGaleria].forEach((entrada) => entrada.addEventListener('change', () => {
    if (entrada.files.length) adicionarFotos(entrada.files);
    entrada.value = '';
  }));

  function moverFoto(indice, delta) {
    const destino = indice + delta;
    if (destino < 0 || destino >= estado.fotos.length) return;
    [estado.fotos[indice], estado.fotos[destino]] = [estado.fotos[destino], estado.fotos[indice]];
    estado.alterado = true;
    renderFotos();
  }

  function removerFoto(indice) {
    const [foto] = estado.fotos.splice(indice, 1);
    if (foto && foto.url.startsWith('blob:')) URL.revokeObjectURL(foto.url);
    estado.alterado = true;
    renderFotos();
  }

  function renderFotos() {
    ui.fotos.replaceChildren(...estado.fotos.map((foto, i) => {
      const item = document.createElement('li');
      item.className = 'photo';
      const img = document.createElement('img');
      img.src = foto.url;
      img.alt = `Foto ${i + 1}`;
      item.append(img);
      if (i === 0) {
        const capa = document.createElement('span');
        capa.className = 'photo__cover';
        capa.textContent = 'Capa';
        item.append(capa);
      }
      const ferramentas = document.createElement('div');
      ferramentas.className = 'photo__tools';
      const remover = botaoIcone('i-close', `Remover foto ${i + 1}`, false, () => removerFoto(i));
      remover.className = 'remover';
      const esquerda = botaoIcone('i-left', `Mover foto ${i + 1} para a esquerda`, i === 0, () => moverFoto(i, -1));
      const direita = botaoIcone('i-right', `Mover foto ${i + 1} para a direita`, i === estado.fotos.length - 1, () => moverFoto(i, 1));
      esquerda.className = '';
      direita.className = '';
      ferramentas.append(esquerda, remover, direita);
      item.append(ferramentas);
      return item;
    }));
    const cheio = estado.fotos.length >= MAX_FOTOS;
    ui.fotoCamera.disabled = cheio;
    ui.fotoGaleria.disabled = cheio;
    ui.acoesFoto.classList.toggle('is-full', cheio);
  }

  // cores
  function montarPaleta() {
    ui.paleta.replaceChildren(...CORES_PRONTAS.map(([nome, hex]) => {
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'swatch-btn';
      botao.dataset.nome = nome;
      botao.dataset.hex = hex;
      botao.setAttribute('aria-pressed', 'false');
      const bolinha = document.createElement('span');
      bolinha.className = 'dot';
      bolinha.style.setProperty('--c', hex);
      botao.append(bolinha, nome);
      return botao;
    }));
  }

  function renderCores() {
    ui.coresEscolhidas.replaceChildren(...estado.cores.map((cor, i) => {
      const item = document.createElement('li');
      const bolinha = document.createElement('span');
      bolinha.className = 'dot';
      bolinha.style.setProperty('--c', cor.hex);
      const nome = document.createElement('span');
      nome.textContent = cor.nome;
      const remover = document.createElement('button');
      remover.type = 'button';
      remover.setAttribute('aria-label', `Remover a cor ${cor.nome}`);
      remover.append(icone('i-close'));
      remover.addEventListener('click', () => {
        estado.cores.splice(i, 1);
        estado.alterado = true;
        renderCores();
      });
      item.append(bolinha, nome, remover);
      return item;
    }));
    const marcadas = new Set(estado.cores.map((c) => normalizar(c.nome)));
    ui.paleta.querySelectorAll('.swatch-btn').forEach((botao) => {
      botao.setAttribute('aria-pressed', String(marcadas.has(normalizar(botao.dataset.nome))));
    });
  }

  ui.paleta.addEventListener('click', (evento) => {
    const botao = evento.target.closest('.swatch-btn');
    if (!botao) return;
    const indice = estado.cores.findIndex((c) => normalizar(c.nome) === normalizar(botao.dataset.nome));
    if (indice >= 0) estado.cores.splice(indice, 1);
    else estado.cores.push({ nome: botao.dataset.nome, hex: botao.dataset.hex });
    estado.alterado = true;
    renderCores();
  });

  $('btn-cor').addEventListener('click', () => {
    const nome = limparTexto(ui.corNome.value, 24);
    if (!nome) {
      ui.corNome.focus();
      return;
    }
    const hex = ui.corHex.value.toLowerCase();
    const existente = estado.cores.find((c) => normalizar(c.nome) === normalizar(nome));
    if (existente) existente.hex = hex;
    else if (estado.cores.length < 20) estado.cores.push({ nome, hex });
    ui.corNome.value = '';
    estado.alterado = true;
    renderCores();
  });

  // validação
  function limparErros() {
    ui.form.querySelectorAll('.is-invalid').forEach((campo) => campo.classList.remove('is-invalid'));
    ui.form.querySelectorAll('.field__error').forEach((mensagem) => mensagem.remove());
  }

  function erroCampo(campo, mensagem) {
    const bloco = campo.closest('.field');
    if (bloco) {
      bloco.classList.add('is-invalid');
      const texto = document.createElement('span');
      texto.className = 'field__error';
      texto.textContent = mensagem;
      bloco.append(texto);
    }
    campo.focus();
    campo.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // salvar
  ui.form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    limparErros();
    const titulo = limparTexto(ui.titulo.value, 80);
    const preco = lerPreco(ui.preco.value);
    const precoAntigo = lerPreco(ui.precoAntigo.value);
    if (!titulo) return erroCampo(ui.titulo, 'Digite o nome do produto.');
    if (Number.isNaN(preco)) return erroCampo(ui.preco, 'Preço inválido. Exemplo: 149,90');
    if (Number.isNaN(precoAntigo)) return erroCampo(ui.precoAntigo, 'Preço inválido. Exemplo: 199,90');
    if (precoAntigo !== null && (preco === null || precoAntigo <= preco)) {
      return erroCampo(ui.precoAntigo, 'O preço antigo precisa ser maior que o preço atual.');
    }
    if (ui.categoria.value === NOVA_CATEGORIA) return erroCampo(ui.categoria, 'Crie a categoria ou escolha uma da lista.');

    const novo = !estado.editando;
    const id = estado.editando || idUnico(slug(titulo), new Set(estado.catalogo.produtos.map((p) => p.id)));
    try {
      const novas = estado.fotos.filter((foto) => foto.blob);
      for (let i = 0; i < novas.length; i++) {
        ocupado(novas.length > 1 ? `Enviando foto ${i + 1} de ${novas.length}…` : 'Enviando a foto…');
        const { caminho } = await comSessao(() => api(`/api/admin/imagens?produto=${encodeURIComponent(id)}`, { metodo: 'POST', corpo: novas[i].blob }));
        novas[i].caminho = caminho;
        delete novas[i].blob; // já está no servidor (não reenvia se precisar tentar de novo)
      }

      ocupado('Publicando no site…');
      const produto = {
        id,
        titulo,
        categoria: ui.categoria.value,
        descricao: limparTexto(ui.descricao.value, 160),
        preco,
        precoAntigo,
        cores: estado.cores.map(({ nome, hex }) => ({ nome, hex })),
        imagens: estado.fotos.map((foto) => foto.caminho),
        destaque: ui.destaque.checked,
        disponivel: ui.disponivel.checked,
      };
      const categoriaNova = estado.categoriasNovas.find((c) => c.id === produto.categoria);
      await publicar((catalogo) => {
        if (categoriaNova && !catalogo.categorias.some((c) => c.id === categoriaNova.id)) catalogo.categorias.push(categoriaNova);
        const posicao = catalogo.produtos.findIndex((p) => p.id === id);
        if (posicao >= 0) catalogo.produtos[posicao] = produto;
        else catalogo.produtos.unshift(produto);
        return catalogo;
      });
      fecharEditor({ forcar: true });
      avisar(novo ? 'Produto cadastrado. Já está no site!' : 'Alterações salvas. Já estão no site!');
      vibrar();
    } catch (erro) {
      avisar(erro.message, true);
    } finally {
      livre();
    }
  });

  ui.btnExcluir.addEventListener('click', async () => {
    const produto = estado.catalogo.produtos.find((p) => p.id === estado.editando);
    if (!produto || !confirm(`Excluir "${produto.titulo}" do site?\nIsso não pode ser desfeito.`)) return;
    ocupado('Excluindo…');
    try {
      await publicar((catalogo) => {
        catalogo.produtos = catalogo.produtos.filter((p) => p.id !== produto.id);
        return catalogo;
      });
      fecharEditor({ forcar: true });
      avisar('Produto excluído do site.');
    } catch (erro) {
      avisar(erro.message, true);
    } finally {
      livre();
    }
  });

  /* ---------- instalar como app ---------- */
  function prepararInstalacao() {
    const botoes = () => document.querySelectorAll('[data-instalar]');
    const mostrar = (sim) => botoes().forEach((botao) => { botao.hidden = !sim; });
    const instalado = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (instalado) return;
    if (ios) mostrar(true);
    window.addEventListener('beforeinstallprompt', (evento) => {
      evento.preventDefault();
      estado.instalar = evento;
      mostrar(true);
    });
    window.addEventListener('appinstalled', () => {
      estado.instalar = null;
      mostrar(false);
      avisar('App instalado! Procure o ícone "Catálogo ON".');
    });
    document.addEventListener('click', async (evento) => {
      if (!evento.target.closest('[data-instalar]')) return;
      if (estado.instalar) {
        estado.instalar.prompt();
        await estado.instalar.userChoice.catch(() => null);
        estado.instalar = null;
      } else if (ios) {
        ui.instalarIos.showModal();
      } else {
        avisar('No menu do navegador, toque em "Instalar app" ou "Adicionar à tela inicial".');
      }
    });
  }

  /* ---------- início ---------- */
  async function iniciar() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => null);
    prepararInstalacao();
    montarPaleta();
    try {
      const { logado } = await api('/api/admin/sessao');
      if (!logado) await pedirSenha();
    } catch (erro) {
      const entrou = pedirSenha('Não foi possível conferir o acesso.');
      erroLogin(erro.message);
      await entrou;
    }
    try {
      await carregar();
    } catch (erro) {
      avisar(erro.message, true);
      return;
    }
    ui.app.hidden = false;
    if (location.hash === '#novo') {
      history.replaceState(null, '', location.pathname);
      abrirEditor(null);
    }
  }

  // ao voltar para o app depois de um tempo, atualiza a lista em silêncio
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !estado.catalogo || ui.editor.open || estado.ordem) return;
    if (Date.now() - estado.carregadoEm > 60_000) carregar({ silencioso: true }).catch(() => null);
  });

  iniciar();
})();
