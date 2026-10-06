// Service worker do app do lojista: abre rápido e funciona sem internet.
// Sempre tenta a versão mais nova pela rede; sem conexão, usa a cópia guardada.
// A lista de produtos e as fotos (API) nunca são guardadas aqui.
const CACHE = 'catalogo-on-v1';
const CASCA = ['./', 'index.html', 'app.css', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-180.png'];

self.addEventListener('install', (evento) => {
  evento.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CASCA)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((chave) => chave !== CACHE).map((chave) => caches.delete(chave))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const { request } = evento;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith('/admin/')) return;
  evento.respondWith(
    fetch(request)
      .then((resposta) => {
        if (resposta.ok) {
          const copia = resposta.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copia));
        }
        return resposta;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((guardada) => guardada || caches.match('./'))),
  );
});
