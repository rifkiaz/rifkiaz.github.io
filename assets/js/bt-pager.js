// Pagination for the Beyblade X weekly blade ranking (shortcode beyblade-tren).
// Every row is in the HTML; without JS the full list simply shows.
(function () {
  document.querySelectorAll('.bt-rank[data-per]').forEach(function (list) {
    var rows = Array.prototype.slice.call(list.children);
    var per = parseInt(list.dataset.per, 10) || 10;
    var pages = Math.ceil(rows.length / per);
    if (pages < 2) return;

    var nav = document.createElement('nav');
    nav.className = 'bt-pager';
    nav.setAttribute('aria-label', 'Halaman peringkat blade');
    var info = document.createElement('span');
    info.className = 'bt-pager__info';
    info.setAttribute('aria-live', 'polite');
    var btns = document.createElement('span');
    btns.className = 'bt-pager__btns';

    function button(label, aria, fn) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (aria) b.setAttribute('aria-label', aria);
      b.addEventListener('click', fn);
      btns.appendChild(b);
      return b;
    }

    var cur = 0;
    var prev = button('‹', 'Halaman sebelumnya', function () { show(cur - 1); });
    var nums = [];
    for (var p = 0; p < pages; p++) {
      (function (p) { nums.push(button(String(p + 1), 'Halaman ' + (p + 1), function () { show(p); })); })(p);
    }
    var next = button('›', 'Halaman berikutnya', function () { show(cur + 1); });

    function show(p) {
      cur = Math.max(0, Math.min(pages - 1, p));
      var from = cur * per, to = Math.min(rows.length, from + per);
      rows.forEach(function (r, i) { r.hidden = i < from || i >= to; });
      nums.forEach(function (b, i) {
        if (i === cur) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      });
      prev.disabled = cur === 0;
      next.disabled = cur === pages - 1;
      info.textContent = 'Peringkat ' + (from + 1) + '–' + to + ' dari ' + rows.length;
    }

    nav.appendChild(info);
    nav.appendChild(btns);
    list.after(nav);
    show(0);
  });
})();
