// Filter for the Beyblade X part catalogue (shortcode beyblade-katalog): text search on
// name/product code plus a type chip. Hides empty groups and shows a "no match" note.
(function () {
  var bar = document.querySelector('.kt-filter');
  if (!bar || bar.dataset.ready) return;
  bar.dataset.ready = '1';
  var q = bar.querySelector('.kt-q'), none = bar.querySelector('.kt-none');
  var chips = bar.querySelectorAll('.kt-chip'), type = '';
  function apply() {
    var term = q.value.trim().toLowerCase(), any = false;
    document.querySelectorAll('.kt-group').forEach(function (g) {
      var shown = 0;
      g.querySelectorAll('.kt-item').forEach(function (it) {
        var ok = (!term || it.dataset.n.indexOf(term) !== -1) && (!type || it.dataset.t === type);
        it.hidden = !ok;
        if (ok) shown++;
      });
      g.hidden = shown === 0;
      if (shown) any = true;
    });
    none.hidden = any;
  }
  q.addEventListener('input', apply);
  chips.forEach(function (c) {
    c.addEventListener('click', function () {
      type = c.dataset.t;
      chips.forEach(function (o) { o.classList.toggle('is-on', o === c); o.setAttribute('aria-pressed', o === c); });
      apply();
    });
  });
})();
