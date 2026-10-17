// Dropdown for nested menu entries. The menu scrolls horizontally on narrow
// screens, so the panel is positioned against the header instead of the <li>
// to avoid being clipped by the menu's overflow.
(function () {
  var header = document.querySelector('.header');
  var toggles = document.querySelectorAll('#menu .sub-toggle');
  if (!header || !toggles.length) return;

  function close(btn) {
    btn.setAttribute('aria-expanded', 'false');
    document.getElementById(btn.getAttribute('aria-controls')).hidden = true;
  }

  function closeAll(except) {
    toggles.forEach(function (b) { if (b !== except) close(b); });
  }

  function place(btn, panel) {
    var h = header.getBoundingClientRect();
    var r = btn.getBoundingClientRect();
    var left = r.left - h.left;
    var max = h.width - panel.offsetWidth - 8;
    panel.style.left = Math.max(8, Math.min(left, max)) + 'px';
    panel.style.top = (r.bottom - h.top) + 'px';
  }

  toggles.forEach(function (btn) {
    var panel = document.getElementById(btn.getAttribute('aria-controls'));
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = btn.getAttribute('aria-expanded') === 'true';
      closeAll(btn);
      if (open) { close(btn); return; }
      btn.setAttribute('aria-expanded', 'true');
      panel.hidden = false;
      place(btn, panel);
    });
  });

  // Groups inside a panel (Lab → Simulasi → ...) expand in place, so they
  // work the same on touch screens and stay inside the viewport.
  document.querySelectorAll('#menu .group-toggle').forEach(function (btn) {
    var list = document.getElementById(btn.getAttribute('aria-controls'));
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
      list.hidden = open;
      var panel = btn.closest('.submenu');
      var top = document.querySelector('[aria-controls="' + panel.id + '"]');
      if (top) place(top, panel);
    });
  });

  document.addEventListener('click', function (e) {
    if (!e.target.closest('.submenu')) closeAll();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    toggles.forEach(function (b) {
      if (b.getAttribute('aria-expanded') === 'true') { close(b); b.focus(); }
    });
  });
  window.addEventListener('resize', function () { closeAll(); });
  document.getElementById('menu').addEventListener('scroll', function () { closeAll(); });
})();
