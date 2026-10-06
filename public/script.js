/* =============================================================
   On Shop Cell — script.js  (JavaScript puro, sem bibliotecas)
   1. Configuração
   2. Animação de rolagem: sequência de frames desenhada num <canvas>
   3. Links do WhatsApp
   4. Cabeçalho, menu mobile, filtros e animações de entrada
   ============================================================= */
(() => {
  'use strict';

  /* 1. CONFIGURAÇÃO ------------------------------------------- */
  const CONFIG = {
    // WhatsApp: código do país + DDD + número, só dígitos
    whatsapp: '5585998033405',
    whatsappMessage: 'Olá! Vim pelo site da On Shop Cell e gostaria de mais informações.',

    frames: {
      count: 240,           // quantidade de imagens na pasta
      folder: 'frames/',    // pasta dos frames, relativa ao index.html
      mobileFolder: '',     // opcional: frames menores/verticais para celular, ex.: 'frames/mobile/'
      prefix: 'frame-',     // frame-0001.webp
      digits: 4,            // 0001 = 4 dígitos
      extension: '.webp',
      version: '2',         // ao trocar os frames, aumente este número (o navegador baixa de novo)
    },

    // Enquadramento: o frame sempre preenche a tela mantendo a proporção. Se para
    // isso fosse preciso cortar mais que "maxCrop" do frame (ex.: frame deitado num
    // celular em pé), ele corta só esse tanto e completa a tela esticando as bordas
    // do próprio frame. 1 = corte livre (cover puro) · 0 = frame sempre inteiro.
    maxCrop: 0.25,
    extendEdges: true,      // false = completa com a cor "background" em vez das bordas do frame
    focusX: 0.5,            // ponto preservado no corte: 0 = esquerda · 0.5 = centro · 1 = direita
    focusY: 0.5,            // 0 = topo · 0.5 = centro · 1 = base
    focusYPortrait: 0.36,   // posição vertical em telas em pé (deixa espaço para o texto embaixo)
    smoothing: 0.14,        // suavidade da troca de frames: 0.05 (bem suave) … 1 (imediata)
    blendFrames: true,      // funde dois frames vizinhos durante a transição (movimento mais fluido)
    maxPixelRatio: 2,       // limita a resolução do canvas em telas retina (economiza memória no celular)
    concurrency: 6,         // quantos frames baixar ao mesmo tempo
    loaderMaxWait: 5000,    // ms: tempo máximo da tela de carregamento; o resto continua baixando em segundo plano
    staticFrame: 80,        // frame exibido com "reduzir movimento" ou economia de dados
    background: '#05070b',  // cor de fundo usada quando extendEdges = false
  };

  const root = document.documentElement;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const smoothstep = (t) => t * t * (3 - 2 * t);
  const onMediaChange = (mq, fn) => (mq.addEventListener ? mq.addEventListener('change', fn) : mq.addListener(fn));

  // Mesmo critério do script no <head>: "reduzir movimento" ou economia de dados → capa estática
  function prefersStatic() {
    const connection = navigator.connection || {};
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const saveData = connection.saveData === true || /(^|-)2g$/.test(connection.effectiveType || '');
    return reduce || saveData;
  }

  // Tela de carregamento
  const loader = {
    fill: document.querySelector('[data-loader-fill]'),
    pct: document.querySelector('[data-loader-pct]'),
    done: false,
    set(progress) {
      if (this.done) return;
      if (this.fill) this.fill.style.transform = `scaleX(${progress})`;
      if (this.pct) this.pct.textContent = String(Math.round(progress * 100));
    },
    hide() {
      if (this.done) return;
      this.done = true;
      root.classList.remove('is-loading');
    },
  };

  /* 2. ANIMAÇÃO DE ROLAGEM ------------------------------------ */
  function initSequence() {
    const hero = document.querySelector('[data-sequence]');
    const stage = hero && hero.querySelector('.hero__stage');
    const canvas = hero && hero.querySelector('.hero__canvas');
    const ctx = canvas && canvas.getContext('2d', { alpha: false });
    if (!hero || !stage || !ctx) {
      root.classList.add('frames-missing');
      loader.hide();
      return;
    }

    const F = CONFIG.frames;
    const total = Math.max(1, F.count | 0);
    const useMobile = F.mobileFolder && window.matchMedia('(max-width: 768px)').matches;
    const folder = useMobile ? F.mobileFolder : F.folder;
    const query = F.version ? `?v=${encodeURIComponent(F.version)}` : '';
    const frameUrl = (i) => `${folder}${F.prefix}${String(i + 1).padStart(F.digits, '0')}${F.extension}${query}`;
    const staticIndex = clamp((CONFIG.staticFrame | 0) - 1, 0, total - 1);

    const frames = new Array(total).fill(null); // imagens prontas para desenhar
    const pending = new Array(total);           // promessas de download (evita baixar duas vezes)
    let settled = 0;                            // frames carregados + com erro
    let loadingAll = false;

    let isStatic = root.classList.contains('motion-static');
    let current = isStatic ? staticIndex : 0;   // posição exibida (fracionária durante a transição)
    let target = current;                       // posição pedida pela rolagem
    let drawnAt = -1;
    let dirty = true;
    let usedNearest = false;
    let travel = 0;                             // distância de rolagem em que a animação acontece
    let inView = true;
    let raf = 0;
    let lastTime = 0;

    const playedBar = hero.querySelector('[data-progress]');
    const bufferBar = hero.querySelector('[data-buffer]');
    const hint = hero.querySelector('[data-hint]');
    const beats = Array.from(hero.querySelectorAll('[data-beat]'), (el) => {
      const [from, to] = el.dataset.beat.split(',').map(Number);
      return { el, from, to, opacity: -1 };
    });

    // ---------- carregamento ----------
    function loadFrame(i) {
      if (pending[i]) return pending[i];
      pending[i] = new Promise((resolve) => {
        let attempts = 0;
        const fetchImage = () => {
          attempts++;
          const img = new Image();
          img.decoding = 'async';
          if (i === 0 || i === staticIndex) img.fetchPriority = 'high';
          const ready = () => {
            frames[i] = img;
            settled++;
            onProgress();
            // chegou um frame mais próximo do que o que está na tela? redesenha
            if (usedNearest || drawnAt < 0) {
              dirty = true;
              requestTick();
            }
            resolve(true);
          };
          // decode() deixa a imagem decodificada antes de ir para o canvas (evita travadas)
          img.onload = () => (img.decode ? img.decode().then(ready, ready) : ready());
          img.onerror = () => {
            // rede instável: tenta mais uma vez antes de desistir deste frame
            if (attempts < 2) {
              setTimeout(fetchImage, 800);
              return;
            }
            settled++;
            onProgress();
            resolve(false);
          };
          img.src = frameUrl(i);
        };
        fetchImage();
      });
      return pending[i];
    }

    // Ordem progressiva: 1º e último frame, depois a cada 128, 64, 32... frames.
    // Se o visitante rolar antes do fim do download, já existe uma versão
    // "grossa" da animação inteira, que vai ficando mais fluida.
    function loadingOrder() {
      const order = [];
      const seen = new Uint8Array(total);
      const add = (i) => {
        if (!seen[i]) {
          seen[i] = 1;
          order.push(i);
        }
      };
      add(0);
      add(total - 1);
      for (let step = 2 ** Math.floor(Math.log2(total)); step >= 1; step /= 2) {
        for (let i = 0; i < total; i += step) add(i);
      }
      return order;
    }

    function loadAll() {
      if (loadingAll) return Promise.resolve();
      loadingAll = true;
      const queue = loadingOrder();
      const worker = () => (queue.length ? loadFrame(queue.shift()).then(worker) : Promise.resolve());
      return Promise.all(Array.from({ length: Math.max(1, CONFIG.concurrency) }, worker));
    }

    function onProgress() {
      const progress = settled / total;
      loader.set(progress);
      if (bufferBar) bufferBar.style.transform = `scaleX(${progress})`;
    }

    // ---------- desenho ----------
    function nearestLoaded(i) {
      if (frames[i]) return i;
      for (let d = 1; d < total; d++) {
        if (i - d >= 0 && frames[i - d]) return i - d;
        if (i + d < total && frames[i + d]) return i + d;
      }
      return -1;
    }

    // Posição e tamanho do frame no canvas (proporção sempre preservada)
    function layout(img) {
      const cw = canvas.width;
      const ch = canvas.height;
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      const cover = Math.max(cw / iw, ch / ih);
      const keep = 1 - clamp(CONFIG.maxCrop, 0, 1); // fração mínima do frame que continua visível
      const limit = keep > 0 ? Math.max(Math.min(cw / iw, ch / ih), Math.min(cw / (iw * keep), ch / (ih * keep))) : cover;
      const scale = Math.min(cover, limit);
      const w = iw * scale;
      const h = ih * scale;
      const focusY = ch > cw ? CONFIG.focusYPortrait : CONFIG.focusY;
      return { x: (cw - w) * CONFIG.focusX, y: (ch - h) * focusY, w, h };
    }

    // Bordas do frame (reduzidas no máximo a 320 px: a média leve apaga ruído de
    // compressão sem borrar detalhes), usadas para completar a tela quando o frame
    // não cobre tudo. Cada borda ocupa 3 linhas/colunas e só a do meio é lida,
    // assim a interpolação nunca mistura uma borda com a outra. Uma vez por frame.
    const edgeCache = new WeakMap();
    function edgesOf(img, vertical) {
      let entry = edgeCache.get(img);
      if (!entry) {
        entry = {};
        edgeCache.set(img, entry);
      }
      const key = vertical ? 'sides' : 'ends';
      if (!entry[key]) {
        const iw = img.naturalWidth;
        const ih = img.naturalHeight;
        const strip = document.createElement('canvas');
        const s = strip.getContext('2d');
        if (vertical) { // esquerda nas colunas 0-2, direita nas colunas 5-7
          const n = Math.min(ih, 320);
          strip.width = 8;
          strip.height = n;
          s.imageSmoothingQuality = 'high';
          s.drawImage(img, 0, 0, 1, ih, 0, 0, 3, n);
          s.drawImage(img, iw - 1, 0, 1, ih, 5, 0, 3, n);
        } else { // topo nas linhas 0-2, base nas linhas 5-7
          const n = Math.min(iw, 320);
          strip.width = n;
          strip.height = 8;
          s.imageSmoothingQuality = 'high';
          s.drawImage(img, 0, 0, iw, 1, 0, 0, n, 3);
          s.drawImage(img, 0, ih - 1, iw, 1, 0, 5, n, 3);
        }
        entry[key] = strip;
      }
      return entry[key];
    }

    function paint(img, alpha) {
      const cw = canvas.width;
      const ch = canvas.height;
      const r = layout(img);
      ctx.globalAlpha = alpha;
      const gapY = r.y > 0.5;
      const gapX = r.x > 0.5;
      if (gapX || gapY) {
        if (CONFIG.extendEdges) {
          // as faixas avançam 1 px sob o frame para não sobrar fresta
          if (gapY) {
            const ends = edgesOf(img, false);
            const bottom = Math.floor(r.y + r.h) - 1;
            ctx.drawImage(ends, 0, 1, ends.width, 1, r.x, 0, r.w, Math.ceil(r.y) + 1);
            ctx.drawImage(ends, 0, 6, ends.width, 1, r.x, bottom, r.w, ch - bottom);
          }
          if (gapX) {
            const sides = edgesOf(img, true);
            const right = Math.floor(r.x + r.w) - 1;
            ctx.drawImage(sides, 1, 0, 1, sides.height, 0, r.y, Math.ceil(r.x) + 1, r.h);
            ctx.drawImage(sides, 6, 0, 1, sides.height, right, r.y, cw - right, r.h);
          }
        } else if (alpha >= 1) {
          ctx.fillStyle = CONFIG.background;
          ctx.fillRect(0, 0, cw, ch);
        }
      }
      ctx.drawImage(img, r.x, r.y, r.w, r.h);
    }

    function draw(position) {
      const base = CONFIG.blendFrames ? Math.floor(position) : Math.round(position);
      const index = nearestLoaded(base);
      if (index < 0) return false;
      usedNearest = index !== base;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      paint(frames[index], 1);

      // transição suave: o próximo frame entra por cima com a parte fracionária
      const t = position - base;
      const next = frames[base + 1];
      if (CONFIG.blendFrames && !usedNearest && t > 0.004 && next) paint(next, t);
      ctx.globalAlpha = 1;

      if (!hero.classList.contains('has-frame')) hero.classList.add('has-frame');
      return true;
    }

    // ---------- textos sobre a animação ----------
    function beatOpacity(p, from, to) {
      const FADE = 0.06;
      const fadeIn = from <= 0 ? 1 : clamp((p - from) / FADE, 0, 1);
      const fadeOut = to >= 1 ? 1 : clamp((to - p) / FADE, 0, 1);
      return smoothstep(Math.min(fadeIn, fadeOut));
    }

    function updateOverlay(p) {
      if (playedBar) playedBar.style.transform = `scaleX(${p.toFixed(4)})`;
      if (hint) hint.style.opacity = String(clamp(1 - p / 0.04, 0, 1));
      for (const beat of beats) {
        const opacity = beatOpacity(p, beat.from, beat.to);
        if (Math.abs(opacity - beat.opacity) < 0.002) continue;
        beat.opacity = opacity;
        const direction = p < (beat.from + beat.to) / 2 ? 1 : -1; // entra de baixo, sai para cima
        beat.el.style.opacity = opacity.toFixed(3);
        beat.el.style.transform = opacity >= 1 ? 'none' : `translate3d(0, ${(direction * (1 - opacity) * 32).toFixed(1)}px, 0)`;
        beat.el.classList.toggle('is-visible', opacity > 0);
      }
    }

    function resetOverlay() {
      for (const beat of beats) {
        beat.opacity = -1;
        beat.el.style.opacity = '';
        beat.el.style.transform = '';
        beat.el.classList.remove('is-visible');
      }
      if (hint) hint.style.opacity = '';
    }

    // ---------- laço de animação ----------
    function scrollProgress() {
      if (isStatic || travel <= 0) return 0;
      return clamp(-hero.getBoundingClientRect().top / travel, 0, 1);
    }

    function requestTick() {
      if (!raf) raf = requestAnimationFrame(tick);
    }

    function tick(now) {
      raf = 0;
      const dt = lastTime ? Math.min(now - lastTime, 100) : 16.7;
      lastTime = now;

      // alvo sempre num frame inteiro: em repouso a imagem fica nítida
      target = isStatic ? staticIndex : Math.round(scrollProgress() * (total - 1));
      // aproximação suave e independente da taxa de quadros (60 Hz, 120 Hz...)
      const k = isStatic ? 1 : 1 - Math.pow(1 - clamp(CONFIG.smoothing, 0.01, 1), dt / 16.7);
      current += (target - current) * k;
      if (Math.abs(target - current) < 0.01) current = target;

      if (dirty || current !== drawnAt) {
        if (draw(current)) {
          drawnAt = current;
          dirty = false;
        }
        if (!isStatic) updateOverlay(current / Math.max(1, total - 1));
      }

      if (current !== target) requestTick();
      else lastTime = 0;
    }

    // ---------- tamanho do canvas ----------
    function resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, CONFIG.maxPixelRatio);
      const width = Math.max(1, Math.round(stage.clientWidth * ratio));
      const height = Math.max(1, Math.round(stage.clientHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width; // redimensionar apaga o canvas...
        canvas.height = height;
      }
      travel = hero.offsetHeight - stage.offsetHeight;
      dirty = true;
      if (draw(current)) { // ...então redesenha na hora, sem piscar
        drawnAt = current;
        dirty = false;
      }
      requestTick();
    }

    // ---------- modo estático (reduzir movimento / economia de dados) ----------
    function setStatic(on) {
      if (on === isStatic) return;
      isStatic = on;
      root.classList.toggle('motion-static', on);
      if (on) {
        resetOverlay();
        loadFrame(staticIndex);
      } else {
        for (const beat of beats) beat.opacity = -1;
        if (!root.classList.contains('frames-missing')) loadAll();
      }
      dirty = true;
      requestTick();
    }

    // ---------- eventos ----------
    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(resize);
      observer.observe(stage);
      observer.observe(hero);
    } else {
      window.addEventListener('resize', resize);
    }
    resize();

    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        inView = entries[entries.length - 1].isIntersecting;
        if (inView) requestTick();
      }).observe(hero);
    }

    window.addEventListener('scroll', () => {
      if (inView && !isStatic) requestTick();
    }, { passive: true });

    onMediaChange(window.matchMedia('(prefers-reduced-motion: reduce)'), () => setStatic(prefersStatic()));

    // ---------- início ----------
    loadFrame(isStatic ? staticIndex : 0).then((ok) => {
      if (!ok) {
        root.classList.add('frames-missing');
        loader.hide();
        console.warn(`[On Shop Cell] Frames não encontrados em "${folder}". Exibindo a capa estática (veja o README.md).`);
        return;
      }
      if (isStatic) {
        loader.hide();
        return;
      }
      loadAll().then(() => loader.hide());
      // não segura o visitante por muito tempo: o restante carrega em segundo plano
      setTimeout(() => loader.hide(), Math.max(0, CONFIG.loaderMaxWait - performance.now()));
    });
  }

  /* 3. WHATSAPP ------------------------------------------------ */
  // Todo link com data-wa ganha uma mensagem pronta. data-product="Nome" monta
  // "tenho interesse em: Nome"; data-wa="texto" usa um texto próprio.
  function initWhatsApp() {
    const base = `https://wa.me/${CONFIG.whatsapp}`;
    document.querySelectorAll('[data-wa]').forEach((link) => {
      const product = link.dataset.product;
      const text = link.dataset.wa || (product
        ? `Olá! Vi no site da On Shop Cell e tenho interesse em: ${product}. Está disponível?`
        : CONFIG.whatsappMessage);
      link.href = `${base}?text=${encodeURIComponent(text)}`;
    });
  }

  /* 4. INTERFACE ----------------------------------------------- */
  // Cabeçalho sólido e botão flutuante do WhatsApp depois da animação
  function initHeader() {
    const header = document.querySelector('[data-header]');
    const float = document.querySelector('[data-wa-float]');
    const hero = document.querySelector('.hero');
    const setPast = (past) => {
      if (header) header.classList.toggle('is-solid', past);
      if (float) float.classList.toggle('is-visible', past);
    };
    if (!hero || !('IntersectionObserver' in window)) {
      setPast(true);
      return;
    }
    new IntersectionObserver((entries) => {
      setPast(!entries[entries.length - 1].isIntersecting);
    }, { rootMargin: '-80px 0px 0px 0px' }).observe(hero);
  }

  // Menu em tela cheia no celular
  function initMenu() {
    const toggle = document.querySelector('[data-menu-toggle]');
    const nav = document.getElementById('menu');
    if (!toggle || !nav) return;
    const outside = [
      document.querySelector('main'),
      document.querySelector('.site-footer'),
      document.querySelector('[data-wa-float]'),
    ].filter(Boolean);

    const setOpen = (open) => {
      root.classList.toggle('menu-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
      outside.forEach((el) => { el.inert = open; });
      if (open) {
        const first = nav.querySelector('a');
        if (first) first.focus({ preventScroll: true });
      }
    };

    toggle.addEventListener('click', () => setOpen(!root.classList.contains('menu-open')));
    nav.addEventListener('click', (event) => {
      if (event.target.closest('a')) setOpen(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && root.classList.contains('menu-open')) {
        setOpen(false);
        toggle.focus();
      }
    });
    onMediaChange(window.matchMedia('(min-width: 901px)'), (event) => {
      if (event.matches) setOpen(false);
    });
  }

  // Seções e cards surgem suavemente ao entrar na tela.
  // Devolve uma função para observar elementos criados depois (os produtos).
  function initReveal() {
    if (!('IntersectionObserver' in window)) return null;
    document.querySelectorAll('.service__grid, .steps__list').forEach((list) => {
      Array.from(list.children).forEach((child, i) => child.style.setProperty('--delay', `${(i % 4) * 70}ms`));
    });
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });
    root.classList.add('reveal-ready');
    document.querySelectorAll('[data-reveal]').forEach((el) => observer.observe(el));
    return (el) => observer.observe(el);
  }

  /* 5. CATÁLOGO ------------------------------------------------ */
  // Os produtos são cadastrados no painel do lojista (/admin/) e chegam por
  // /api/produtos. Se a API falhar, usa a cópia publicada com o site.
  function initCatalog(reveal) {
    const grid = document.querySelector('[data-products]');
    const template = document.getElementById('produto-modelo');
    if (!grid || !template) return;
    const filtersEl = document.querySelector('[data-filters]');
    const status = document.querySelector('[data-filter-status]');
    const cta = grid.querySelector('.grid-cta');
    const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const IMAGE = /^(?:assets\/produtos|img)\/[\w.-]+\.(?:webp|jpe?g|png)$/i;
    const HEX = /^#[0-9a-f]{6}$/i;
    let cards = [];

    const load = (url) => fetch(url, { cache: 'no-cache' }).then((response) => {
      if (!response.ok) throw new Error(`${url} respondeu ${response.status}`);
      return response.json();
    });

    load('/api/produtos')
      .catch((error) => {
        console.warn('[On Shop Cell] Catálogo ao vivo indisponível, usando a cópia do site.', error);
        return load('data/produtos.json');
      })
      .then(render)
      .catch((error) => {
        console.error(error);
        renderNotice('Não foi possível carregar os produtos agora. Fale com a gente no WhatsApp: (85) 99803-3405.');
      });

    function waLink(product, color) {
      const colorText = color ? ` (cor: ${color})` : '';
      const priceText = typeof product.preco === 'number' ? ` · ${money.format(product.preco)}` : '';
      const text = product.disponivel === false
        ? `Olá! Vi no site que o produto ${product.titulo}${colorText} está esgotado. Pode me avisar quando chegar?`
        : `Olá! Vi no site da On Shop Cell e tenho interesse em: ${product.titulo}${colorText}${priceText}. Está disponível?`;
      return `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(text)}`;
    }

    function buildCard(product, categoryName) {
      const card = template.content.firstElementChild.cloneNode(true);
      const $ = (selector) => card.querySelector(selector);
      const soldOut = product.disponivel === false;
      card.dataset.category = product.categoria;
      card.classList.toggle('is-soldout', soldOut);

      // fotos: carrossel deslizável (setas aparecem no computador)
      const slides = $('.product__slides');
      const images = (product.imagens || []).filter((src) => IMAGE.test(src));
      images.forEach((src, i) => {
        const img = document.createElement('img');
        img.src = src;
        img.alt = images.length > 1 ? `${product.titulo} (foto ${i + 1} de ${images.length})` : product.titulo;
        img.width = 800;
        img.height = 1000;
        img.loading = 'lazy';
        img.decoding = 'async';
        img.draggable = false;
        slides.appendChild(img);
      });
      if (!images.length) card.classList.add('no-photo');
      if (images.length > 1) {
        const count = $('.product__count');
        count.hidden = false;
        count.textContent = `1/${images.length}`;
        $('.product__arrow--prev').hidden = false;
        $('.product__arrow--next').hidden = false;
        let pending = 0;
        slides.addEventListener('scroll', () => {
          if (pending) return;
          pending = requestAnimationFrame(() => {
            pending = 0;
            count.textContent = `${Math.round(slides.scrollLeft / Math.max(1, slides.clientWidth)) + 1}/${images.length}`;
          });
        }, { passive: true });
      }

      const badge = $('.product__badge');
      if (soldOut || product.destaque) {
        badge.hidden = false;
        badge.textContent = soldOut ? 'Esgotado' : 'Destaque';
        badge.classList.toggle('product__badge--muted', soldOut);
      }

      $('.product__tag').textContent = categoryName;
      $('.product__name').textContent = product.titulo;
      if (product.descricao) {
        const desc = $('.product__desc');
        desc.textContent = product.descricao;
        desc.hidden = false;
      }

      // preço ("de/por" quando houver preço antigo)
      const price = $('.product__price');
      if (typeof product.preco === 'number') {
        if (typeof product.precoAntigo === 'number' && product.precoAntigo > product.preco) {
          const before = document.createElement('s');
          before.textContent = money.format(product.precoAntigo);
          const label = document.createElement('span');
          label.className = 'sr-only';
          label.textContent = 'De ';
          const now = document.createElement('span');
          now.className = 'sr-only';
          now.textContent = ' por ';
          price.append(label, before, now);
        }
        const value = document.createElement('strong');
        value.textContent = money.format(product.preco);
        price.append(value);
      } else {
        price.textContent = 'Consulte o preço';
        price.classList.add('product__price--ask');
      }

      // cores: tocar numa cor coloca ela na mensagem do WhatsApp
      const link = $('.product__cta');
      const colors = (product.cores || []).filter((c) => c && c.nome && HEX.test(c.hex));
      let chosen = colors.length === 1 ? colors[0].nome : null;
      if (colors.length) {
        $('.product__colors').hidden = false;
        const swatches = $('.product__swatches');
        const name = $('.product__color-name');
        const summary = () => (chosen ? `Cor: ${chosen}` : `${colors.length} cores`);
        colors.forEach((color) => {
          const swatch = document.createElement('button');
          swatch.type = 'button';
          swatch.className = 'swatch';
          swatch.title = color.nome;
          swatch.dataset.color = color.nome;
          swatch.style.setProperty('--swatch', color.hex);
          swatch.setAttribute('aria-label', color.nome);
          swatch.setAttribute('aria-pressed', String(color.nome === chosen));
          swatches.appendChild(swatch);
        });
        name.textContent = summary();
        swatches.addEventListener('click', (event) => {
          const swatch = event.target.closest('.swatch');
          if (!swatch) return;
          chosen = chosen === swatch.dataset.color && colors.length > 1 ? null : swatch.dataset.color;
          swatches.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-pressed', String(s.dataset.color === chosen)));
          name.textContent = summary();
          link.href = waLink(product, chosen);
        });
      }

      link.href = waLink(product, chosen);
      const extra = document.createElement('span');
      extra.className = 'hide-sm';
      extra.textContent = soldOut ? ' quando chegar' : ' no WhatsApp';
      $('.product__cta-label').append(soldOut ? 'Avise-me' : 'Pedir', extra);
      return card;
    }

    function render(data) {
      const categories = Array.isArray(data.categorias) ? data.categorias : [];
      const names = new Map(categories.map((c) => [c.id, c.nome]));
      const products = (Array.isArray(data.produtos) ? data.produtos : []).filter((p) => p && p.titulo);
      grid.querySelectorAll('.product, .products__notice').forEach((el) => el.remove());
      if (!products.length) {
        renderNotice('Em breve, novos produtos por aqui. Enquanto isso, fale com a gente no WhatsApp!');
        return;
      }
      cards = products.map((product, i) => {
        const card = buildCard(product, names.get(product.categoria) || '');
        card.style.setProperty('--delay', `${(i % 4) * 70}ms`);
        card.setAttribute('data-reveal', '');
        grid.insertBefore(card, cta);
        if (reveal) reveal(card);
        return card;
      });
      grid.setAttribute('aria-busy', 'false');
      buildFilters(categories, products);
      fitCta();
    }

    function renderNotice(message) {
      grid.querySelectorAll('.product, .products__notice').forEach((el) => el.remove());
      cards = [];
      const notice = document.createElement('li');
      notice.className = 'products__notice';
      notice.textContent = message;
      grid.insertBefore(notice, cta);
      grid.setAttribute('aria-busy', 'false');
      if (cta) cta.style.gridColumn = '1 / -1';
    }

    // filtros: só as categorias que têm produto
    function buildFilters(categories, products) {
      if (!filtersEl) return;
      const used = new Set(products.map((p) => p.categoria));
      const options = [{ id: 'todos', nome: 'Todos' }, ...categories.filter((c) => used.has(c.id))];
      filtersEl.replaceChildren(...options.map((option, i) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.dataset.filter = option.id;
        chip.textContent = option.nome;
        chip.setAttribute('aria-pressed', String(i === 0));
        return chip;
      }));
      filtersEl.hidden = options.length <= 2;
    }

    if (filtersEl) {
      filtersEl.addEventListener('click', (event) => {
        const chip = event.target.closest('[data-filter]');
        if (!chip) return;
        const filter = chip.dataset.filter;
        let shown = 0;
        filtersEl.querySelectorAll('[data-filter]').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
        cards.forEach((card) => {
          const match = filter === 'todos' || card.dataset.category === filter;
          card.hidden = !match;
          if (match) shown++;
        });
        if (status) status.textContent = `${shown} ${shown === 1 ? 'produto' : 'produtos'} em ${chip.textContent.trim()}`;
        fitCta();
      });
    }

    // setas do carrossel (no fim, volta para a primeira foto)
    grid.addEventListener('click', (event) => {
      const arrow = event.target.closest('.product__arrow');
      if (!arrow) return;
      const slides = arrow.closest('.product__media').querySelector('.product__slides');
      const width = Math.max(1, slides.clientWidth);
      const last = slides.children.length - 1;
      let index = Math.round(slides.scrollLeft / width) + (arrow.classList.contains('product__arrow--next') ? 1 : -1);
      if (index > last) index = 0;
      if (index < 0) index = last;
      slides.scrollTo({ left: index * width, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    });

    // o cartão "Tem muito mais na loja" ocupa as colunas que sobram na última linha
    function fitCta() {
      if (!cta || !cards.length) return;
      const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
      const rest = cards.filter((card) => !card.hidden).length % columns;
      const span = rest ? columns - rest : columns;
      cta.style.gridColumn = `span ${span}`;
      cta.classList.toggle('is-wide', span > 1);
    }
    let resizeFrame = 0;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(fitCta);
    });
  }

  function initYear() {
    const year = String(new Date().getFullYear());
    document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = year; });
  }

  // Cada parte roda isolada: um erro numa delas não derruba as outras
  const run = (fn) => {
    try {
      fn();
    } catch (error) {
      console.error(error);
    }
  };

  run(() => {
    try {
      initSequence();
    } catch (error) {
      root.classList.add('frames-missing');
      loader.hide();
      throw error;
    }
  });
  run(initWhatsApp);
  run(initHeader);
  run(initMenu);
  let reveal = null;
  run(() => { reveal = initReveal(); });
  run(() => initCatalog(reveal));
  run(initYear);
})();
