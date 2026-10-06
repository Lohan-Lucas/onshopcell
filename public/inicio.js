/* Roda antes da primeira pintura: liga o modo JS, decide se a animação
   completa será usada e mostra a tela de carregamento. */
(function (h) {
  h.className = h.className.replace(/\bno-js\b/, 'js');
  var c = navigator.connection || {};
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var saveData = c.saveData === true || /(^|-)2g$/.test(c.effectiveType || '');
  if (reduce || saveData) {
    h.classList.add('motion-static');
  } else {
    h.classList.add('is-loading');
    setTimeout(function () { h.classList.remove('is-loading'); }, 12000); /* trava de segurança */
  }
})(document.documentElement);
