// Pagination for Beyblade X lists on /hobi/beyblade-x-meta/ (shortcodes
// beyblade-tren and beyblade-juara). Every row is in the HTML; without JS the
// full list simply shows. A list may have a month filter: buttons in
// `.bt-filter[data-for=<list id>]` with `data-bulan`, rows with `data-bulan`.
(function () {
  document.querySelectorAll('[data-per]').forEach(function (list) {
    if (list.dataset.pagerReady) return; // script may be included by both shortcodes
    list.dataset.pagerReady = '1';
    var all = Array.prototype.slice.call(list.children);
    var per = parseInt(list.dataset.per, 10) || 10;
    var rows = all, cur = 0;

    var nav = document.createElement('nav');
    nav.className = 'bt-pager';
    nav.setAttribute('aria-label', list.dataset.pagerLabel || 'Halaman daftar');
    var info = document.createElement('span');
    info.className = 'bt-pager__info';
    info.setAttribute('aria-live', 'polite');
    var btns = document.createElement('span');
    btns.className = 'bt-pager__btns';
    nav.appendChild(info);
    nav.appendChild(btns);
    list.after(nav);

    function button(label, aria, page, disabled, current) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (aria) b.setAttribute('aria-label', aria);
      if (current) b.setAttribute('aria-current', 'page');
      b.disabled = disabled;
      b.addEventListener('click', function () { show(page, true); });
      btns.appendChild(b);
    }
    function gap() {
      var s = document.createElement('span');
      s.className = 'bt-pager__gap';
      s.textContent = '…';
      btns.appendChild(s);
    }

    function show(p, focus) {
      var pages = Math.max(1, Math.ceil(rows.length / per));
      cur = Math.max(0, Math.min(pages - 1, p));
      var from = cur * per, to = Math.min(rows.length, from + per);
      all.forEach(function (r) { r.hidden = true; });
      rows.slice(from, to).forEach(function (r) { r.hidden = false; });
      nav.hidden = pages < 2 && rows.length === all.length;
      info.textContent = rows.length ? (from + 1) + '–' + to + ' dari ' + rows.length : 'Tidak ada data';
      btns.textContent = '';
      if (pages < 2) return;
      button('‹', 'Halaman sebelumnya', cur - 1, cur === 0);
      // Show first, last, and the pages around the current one.
      var last = -1;
      for (var i = 0; i < pages; i++) {
        if (i === 0 || i === pages - 1 || Math.abs(i - cur) <= 1) {
          if (last >= 0 && i - last > 1) gap();
          button(String(i + 1), 'Halaman ' + (i + 1), i, false, i === cur);
          last = i;
        }
      }
      button('›', 'Halaman berikutnya', cur + 1, cur === pages - 1);
      if (focus) {
        var b = btns.querySelector('[aria-current]');
        if (b) b.focus();
        if (list.getBoundingClientRect().top < 0) list.scrollIntoView({ block: 'start' });
      }
    }

    var filter = list.id && document.querySelector('.bt-filter[data-for="' + list.id + '"]');
    if (filter) {
      filter.hidden = false;
      filter.addEventListener('click', function (ev) {
        var b = ev.target.closest('button[data-bulan]');
        if (!b) return;
        filter.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        var m = b.dataset.bulan;
        rows = m ? all.filter(function (r) { return r.dataset.bulan === m; }) : all;
        show(0);
      });
    }
    show(0);
  });
})();
