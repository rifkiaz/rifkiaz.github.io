// Shared bits for the party games (/werewolf/, /mata-mata/, /kata-rahasia/):
// browser storage, the shared player list, the "pass the phone" reveal,
// a countdown timer, and a tiny render loop. Exposed as window.Party.
// Everything is kept in localStorage on this device only.
(function () {
  'use strict';

  var PREFIX = 'pg:';
  var EN = (document.documentElement.lang || '').slice(0, 2) === 'en';
  function tr(id, en) { return EN ? en : id; }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var store = {
    load: function (key, def) {
      try {
        var raw = localStorage.getItem(PREFIX + key);
        return raw ? JSON.parse(raw) : def;
      } catch (e) { return def; }
    },
    save: function (key, val) {
      try { localStorage.setItem(PREFIX + key, JSON.stringify(val)); } catch (e) { /* private mode */ }
    },
    del: function (key) {
      try { localStorage.removeItem(PREFIX + key); } catch (e) { /* ignore */ }
    }
  };

  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function range(n) { var r = []; for (var i = 0; i < n; i++) r.push(i); return r; }

  // ---------- shared player list ----------
  var MAX_PLAYERS = 20;
  function getPlayers() {
    var p = store.load('players', []);
    return Array.isArray(p) ? p.filter(function (x) { return typeof x === 'string' && x; }).slice(0, MAX_PLAYERS) : [];
  }
  function setPlayers(list) { store.save('players', list); }

  function rosterHTML(min, note) {
    var p = getPlayers();
    var rows = p.map(function (name, i) {
      return '<li><span class="pg-seat">' + (i + 1) + '</span><span class="pg-pname">' + esc(name) + '</span>' +
        '<button type="button" class="pg-mini" data-act="p-up" data-i="' + i + tr('" aria-label="Naikkan ', '" aria-label="Move up ') + esc(name) + '"' + (i ? '' : ' disabled') + '>↑</button>' +
        '<button type="button" class="pg-mini" data-act="p-del" data-i="' + i + tr('" aria-label="Hapus ', '" aria-label="Remove ') + esc(name) + '">×</button></li>';
    }).join('');
    var need = Math.max(0, min - p.length);
    return tr('<section class="pg-card"><h2 class="pg-h">pemain <span class="pg-chip">', '<section class="pg-card"><h2 class="pg-h">players <span class="pg-chip">') + p.length + tr(' orang</span></h2>', ' people</span></h2>') +
      (note ? '<p class="pg-sub">' + note + '</p>' : '') +
      tr('<form class="pg-add" data-form="p-add"><label class="sr-only" for="pg-name">Nama pemain</label>', '<form class="pg-add" data-form="p-add"><label class="sr-only" for="pg-name">Player name</label>') +
      tr('<input id="pg-name" type="text" maxlength="16" autocomplete="off" placeholder="nama pemain" enterkeyhint="done">', '<input id="pg-name" type="text" maxlength="16" autocomplete="off" placeholder="player name" enterkeyhint="done">') +
      '<button type="submit"' + (p.length >= MAX_PLAYERS ? ' disabled' : '') + tr('>+ tambah</button></form>', '>+ add</button></form>') +
      (p.length ? '<ol class="pg-roster">' + rows + '</ol>' : tr('<p class="pg-empty">Belum ada pemain. Tambahkan nama sesuai urutan duduk.</p>', '<p class="pg-empty">No players yet. Add names in seating order.</p>')) +
      '<div class="pg-row">' +
      (need ? tr('<span class="pg-warn">butuh ', '<span class="pg-warn">need ') + need + tr(' pemain lagi</span>', ' more players</span>') : tr('<span class="pg-ok">siap, minimal ', '<span class="pg-ok">ready, at least ') + min + tr(' pemain</span>', ' players</span>')) +
      (p.length ? tr('<button type="button" class="pg-mini pg-push" data-act="p-shuffle">acak urutan</button><button type="button" class="pg-mini" data-act="p-clear">kosongkan</button>', '<button type="button" class="pg-mini pg-push" data-act="p-shuffle">shuffle order</button><button type="button" class="pg-mini" data-act="p-clear">clear</button>') : '') +
      '</div></section>';
  }

  // Handles roster clicks/submits. Returns true when it changed the list.
  function rosterAction(act, el, root) {
    var p = getPlayers();
    if (act === 'p-add') {
      var input = root.querySelector('#pg-name');
      var name = (input.value || '').replace(/\s+/g, ' ').trim().slice(0, 16);
      if (!name) return false;
      var lower = p.map(function (x) { return x.toLowerCase(); });
      if (lower.indexOf(name.toLowerCase()) >= 0) { toast(tr('Nama "', 'Name "') + name + tr('" sudah ada', '" is already taken')); return false; }
      if (p.length >= MAX_PLAYERS) return false;
      p.push(name);
    } else if (act === 'p-del') {
      p.splice(+el.dataset.i, 1);
    } else if (act === 'p-up') {
      var i = +el.dataset.i;
      if (i > 0) { var t = p[i - 1]; p[i - 1] = p[i]; p[i] = t; }
    } else if (act === 'p-shuffle') {
      p = shuffle(p);
    } else if (act === 'p-clear') {
      if (!window.confirm(tr('Hapus semua nama pemain?', 'Remove every player name?'))) return false;
      p = [];
    } else return false;
    setPlayers(p);
    return true;
  }

  // ---------- pass-the-phone reveal ----------
  // st = { i: index into order, shown: bool }. cardFn(playerIndex) returns the secret HTML.
  function revealHTML(names, order, st, cardFn, doneLabel) {
    var who = order[st.i];
    var nextName = st.i + 1 < order.length ? names[order[st.i + 1]] : null;
    var dots = order.map(function (_, k) {
      return '<i class="' + (k < st.i ? 'is-done' : k === st.i ? 'is-now' : '') + '"></i>';
    }).join('');
    if (!st.shown) {
      return '<section class="pg-card pg-pass"><div class="pg-dots" aria-hidden="true">' + dots + '</div>' +
        tr('<p class="pg-sub">oper HP ke</p><p class="pg-big">', '<p class="pg-sub">pass the phone to</p><p class="pg-big">') + esc(names[who]) + '</p>' +
        tr('<p class="pg-sub">Pastikan cuma ', '<p class="pg-sub">Make sure only ') + esc(names[who]) + tr(' yang lihat layar.</p>', ' can see the screen.</p>') +
        tr('<button type="button" class="pg-primary pg-wide" data-act="rv-show">saya ', '<button type="button" class="pg-primary pg-wide" data-act="rv-show">I\'m ') + esc(names[who]) + tr(', lihat</button></section>', ', show me</button></section>');
    }
    return '<section class="pg-card pg-pass pg-secret"><div class="pg-dots" aria-hidden="true">' + dots + '</div>' +
      cardFn(who) +
      '<button type="button" class="pg-primary pg-wide" data-act="rv-next">' +
      (nextName ? tr('tutup, oper ke ', 'close, pass to ') + esc(nextName) : esc(doneLabel || tr('tutup', 'close'))) + '</button></section>';
  }
  function revealStep(act, st, total) {
    if (act === 'rv-show') { st.shown = true; return 'shown'; }
    if (act === 'rv-next') { st.shown = false; st.i++; return st.i >= total ? 'done' : 'next'; }
    return null;
  }

  // ---------- countdown ----------
  // t = { total, left, endAt } (seconds / ms timestamp). Lives inside the saved state.
  function timerLeft(t) {
    if (!t) return 0;
    if (t.endAt) return Math.max(0, Math.ceil((t.endAt - Date.now()) / 1000));
    return t.left;
  }
  function fmt(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function timerHTML(t, label) {
    var left = timerLeft(t);
    return '<div class="pg-timer' + (left === 0 ? ' is-up' : '') + '" data-timer>' +
      '<span class="pg-tlabel">' + esc(label) + '</span>' +
      '<span class="pg-tnum" data-tnum>' + fmt(left) + '</span>' +
      '<div class="pg-tbar"><i data-tbar style="width:' + (t.total ? Math.round(left / t.total * 100) : 0) + '%"></i></div>' +
      '<div class="pg-row pg-center">' +
      (t.endAt ? tr('<button type="button" class="pg-mini" data-act="t-pause">jeda</button>', '<button type="button" class="pg-mini" data-act="t-pause">pause</button>')
        : '<button type="button" class="pg-mini" data-act="t-start"' + (left ? '' : ' disabled') + '>' + (left === t.total ? tr('mulai', 'start') : tr('lanjut', 'resume')) + '</button>') +
      tr('<button type="button" class="pg-mini" data-act="t-add">+30 detik</button>', '<button type="button" class="pg-mini" data-act="t-add">+30 sec</button>') +
      tr('<button type="button" class="pg-mini" data-act="t-reset">ulang</button></div></div>', '<button type="button" class="pg-mini" data-act="t-reset">reset</button></div></div>');
  }
  function timerAction(act, t) {
    if (act === 't-start') { if (t.left > 0) t.endAt = Date.now() + t.left * 1000; }
    else if (act === 't-pause') { t.left = timerLeft(t); t.endAt = null; }
    else if (act === 't-add') {
      if (t.endAt) t.endAt = Math.max(t.endAt, Date.now()) + 30000; else t.left += 30;
      t.total = Math.max(t.total, timerLeft(t));
    } else if (act === 't-reset') { t.left = t.total = t.base || t.total; t.endAt = null; }
    else return false;
    return true;
  }
  function newTimer(sec) { return { total: sec, base: sec, left: sec, endAt: null }; }

  // ---------- toast ----------
  var toastEl, toastTimer;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'pg-toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-on'); }, 2400);
  }

  // Keep the screen on during a game where the browser supports it.
  var lock = null;
  function wake(on) {
    try {
      if (on && !lock && navigator.wakeLock) {
        navigator.wakeLock.request('screen').then(function (l) {
          lock = l; l.addEventListener('release', function () { lock = null; });
        }).catch(function () {});
      } else if (!on && lock) { lock.release(); lock = null; }
    } catch (e) { /* unsupported */ }
  }

  // ---------- app shell ----------
  // opts: { key, init(), render(state) -> html, act(name, el, state) -> handled?, playing(state) -> bool }
  function app(root, opts) {
    var state = store.load(opts.key, null);
    if (!state || state.v !== opts.version) state = opts.init();

    function save() { store.save(opts.key, state); }
    function render() {
      var y = window.scrollY;
      root.innerHTML = opts.render(state);
      var scrollTop = root.querySelector('[data-scrolltop]');
      if (scrollTop) {
        var top = root.getBoundingClientRect().top + window.scrollY - 70;
        if (y > top) window.scrollTo(0, top);
      }
      wake(opts.playing ? opts.playing(state) : false);
      tick();
    }
    function tick() {
      var box = root.querySelector('[data-timer]');
      if (!box || !state.timer) return;
      var left = timerLeft(state.timer);
      box.querySelector('[data-tnum]').textContent = fmt(left);
      box.querySelector('[data-tbar]').style.width = (state.timer.total ? Math.round(left / state.timer.total * 100) : 0) + '%';
      if (state.timer.endAt && left === 0) {
        state.timer.left = 0; state.timer.endAt = null; save();
        if (navigator.vibrate) { try { navigator.vibrate([200, 100, 200]); } catch (e) { /* ignore */ } }
        toast(tr('Waktu habis!', 'Time\'s up!'));
        render();
      }
    }
    setInterval(tick, 250);

    function handle(act, el) {
      if (rosterAction(act, el, root)) { render(); var inp = root.querySelector('#pg-name'); if (inp && act === 'p-add') inp.focus(); return; }
      if (state.timer && timerAction(act, state.timer)) { save(); render(); return; }
      if (opts.act(act, el, state, api) !== false) { save(); render(); }
    }
    root.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]');
      if (!el || !root.contains(el) || el.disabled) return;
      handle(el.dataset.act, el);
    });
    root.addEventListener('submit', function (e) {
      var f = e.target.closest('[data-form]');
      if (!f) return;
      e.preventDefault();
      handle(f.dataset.form, f);
    });
    root.addEventListener('change', function (e) {
      var el = e.target.closest('[data-set]');
      if (!el) return;
      if (opts.set) { opts.set(el.dataset.set, el.type === 'checkbox' ? el.checked : el.value, state); save(); render(); }
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') wake(opts.playing ? opts.playing(state) : false);
    });

    var api = {
      reset: function () { state = opts.init(); save(); render(); },
      replace: function (s) { state = s; },
      render: render,
      save: save
    };
    render();
    return api;
  }

  window.Party = {
    EN: EN, tr: tr,
    esc: esc, store: store, shuffle: shuffle, pick: pick, range: range,
    getPlayers: getPlayers, setPlayers: setPlayers, rosterHTML: rosterHTML,
    revealHTML: revealHTML, revealStep: revealStep,
    newTimer: newTimer, timerHTML: timerHTML, fmt: fmt,
    toast: toast, app: app
  };
})();
