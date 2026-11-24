// Search for the "combo per blade" list (shortcode beyblade-combo-blade). Every blade that
// appeared in a winning deck is in the HTML; by default only the top N (data-show) are
// visible, the rest show up when they match the search or after "show all".
(function () {
  document.querySelectorAll('.cb[data-show]').forEach(function (box) {
    if (box.dataset.ready) return;
    box.dataset.ready = '1';
    var q = box.querySelector('.cb-q'), info = box.querySelector('.cb-info');
    var none = box.querySelector('.cb-none'), all = box.querySelector('.cb-all');
    var items = box.querySelectorAll('.cb-item'), showAll = false;
    var en = box.dataset.lang === 'en';
    var norm = function (s) { return s.toLowerCase().replace(/[^a-z0-9]/g, ''); };
    items.forEach(function (it) { it.dataset.k = norm(it.dataset.n); });
    function apply() {
      var term = norm(q.value), hits = [];
      items.forEach(function (it) {
        var ok = term ? it.dataset.k.indexOf(term) !== -1 : (showAll || !it.classList.contains('cb-more'));
        it.hidden = !ok;
        if (ok) hits.push(it);
      });
      none.hidden = !term || hits.length > 0;
      all.hidden = !!term;
      all.textContent = showAll ? all.dataset.less : all.dataset.more;
      if (term && hits.length === 1) hits[0].open = true;
      info.textContent = term
        ? (en ? hits.length + ' blade' + (hits.length === 1 ? '' : 's') + ' found' : hits.length + ' blade ketemu')
        : '';
    }
    q.addEventListener('input', apply);
    all.addEventListener('click', function () {
      showAll = !showAll;
      apply();
      if (!showAll) box.scrollIntoView({ block: 'start' });
    });
    apply();
  });
})();
