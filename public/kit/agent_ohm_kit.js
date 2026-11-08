/* Agent-Ohm site kit: path rail + phone step bar + entrance stagger. Shared by every page (2026-11-07). */
(function () {
  var steps = Array.prototype.slice.call(document.querySelectorAll('.step'));
  var items = Array.prototype.slice.call(document.querySelectorAll('.rail li'));
  var fill = document.getElementById('railFill');
  var moStep = document.getElementById('moStep'), moQ = document.getElementById('moQ'), moFill = document.getElementById('moFill');
  var current = -1;
  function setStep(i) {
    if (i === current) return;
    current = i;
    items.forEach(function (li, k) { li.classList.toggle('on', k === i); li.classList.toggle('done', k < i); });
    if (items[i] && fill) {
      var ol = items[i].parentNode;
      fill.style.height = Math.max(0, items[i].offsetTop + 8 - 6) + 'px';
    }
    if (moStep) { moStep.textContent = 'STEP ' + (i + 1) + ' OF ' + steps.length; moQ.textContent = steps[i].getAttribute('data-q'); }
    if (moFill) moFill.style.width = ((i + 1) / steps.length * 100) + '%';
  }
  function onScroll() {
    var mid = window.innerHeight * 0.35, best = 0;
    steps.forEach(function (s, k) { if (s.getBoundingClientRect().top <= mid) best = k; });
    setStep(best);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();

  // entrance: stagger within each group as it enters view
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return;
      var el = e.target, sibs = el.parentNode ? Array.prototype.slice.call(el.parentNode.children).filter(function (c) { return c.classList.contains('rise'); }) : [];
      var k = Math.max(0, sibs.indexOf(el));
      setTimeout(function () { el.classList.add('in'); }, Math.min(k, 6) * 70);
      io.unobserve(el);
    });
  }, { rootMargin: '0px 0px -8% 0px' }) : null;
  document.querySelectorAll('.rise').forEach(function (el) { io ? io.observe(el) : el.classList.add('in'); });
})();
