// Mata-mata (/mata-mata/): everyone gets the same secret place except the spy.
// Players question each other; the spy tries to blend in and guess the place.
// State lives in localStorage so a refresh keeps the round going.
(function () {
  'use strict';
  var P = window.Party, esc = P.esc;
  var root = document.getElementById('pg');
  if (!P || !root) return;

  var PLACES = [
    ['🏪', 'Warung kopi'], ['🛒', 'Pasar tradisional'], ['🚆', 'Kereta komuter'], ['⛴️', 'Kapal feri'],
    ['✈️', 'Pesawat'], ['🏥', 'Rumah sakit'], ['🏫', 'Sekolah'], ['🎓', 'Kampus'], ['🏖️', 'Pantai'],
    ['🎬', 'Bioskop'], ['💒', 'Pesta pernikahan'], ['🏟️', 'Stadion sepak bola'], ['🎤', 'Konser musik'],
    ['🦁', 'Kebun binatang'], ['🏨', 'Hotel'], ['🏦', 'Bank'], ['⛽', 'SPBU'], ['🔧', 'Bengkel motor'],
    ['💈', 'Tukang cukur'], ['🍛', 'Rumah makan padang'], ['🛍️', 'Mal'], ['📚', 'Perpustakaan'],
    ['🚓', 'Kantor polisi'], ['📮', 'Kantor pos'], ['🖥️', 'Data center'], ['💼', 'Kantor startup'],
    ['🚀', 'Stasiun luar angkasa'], ['🌋', 'Pendakian gunung'], ['🏕️', 'Perkemahan'], ['🎡', 'Pasar malam'],
    ['🚌', 'Bus antarkota'], ['🧪', 'Laboratorium'], ['🏛️', 'Museum'], ['🏋️', 'Pusat kebugaran'],
    ['🎮', 'Warnet'], ['🛳️', 'Kapal pesiar'], ['🏝️', 'Pulau terpencil'], ['🚒', 'Pos pemadam kebakaran'],
    ['🍜', 'Angkringan'], ['🧺', 'Laundry kiloan'], ['🎭', 'Panggung teater'], ['🤿', 'Kapal selam']
  ];

  function init() {
    return { v: 1, phase: 'setup', cfg: { spies: 1, minutes: 8 } };
  }
  function maxSpies(n) { return n >= 8 ? 2 : 1; }
  function problem(s, n) {
    if (n < 3) return 'Minimal 3 pemain.';
    if (s.cfg.spies > maxSpies(n)) return '2 mata-mata butuh minimal 8 pemain.';
    return '';
  }

  function deal(s) {
    var names = P.getPlayers();
    if (problem(s, names.length)) return false;
    var recent = P.store.load('mm-recent', []);
    var pool = P.range(PLACES.length).filter(function (i) { return recent.indexOf(i) < 0; });
    var place = P.pick(pool.length ? pool : P.range(PLACES.length));
    recent.push(place);
    P.store.save('mm-recent', recent.slice(-12));
    var order = P.shuffle(P.range(names.length));
    s.names = names;
    s.place = place;
    s.spies = order.slice(0, s.cfg.spies);
    s.first = P.pick(P.range(names.length));
    s.rv = { i: 0, shown: false };
    s.timer = null;
    s.crossed = [];
    s.phase = 'reveal';
    return true;
  }

  function viewSetup(s) {
    var n = P.getPlayers().length, c = s.cfg, prob = problem(s, n);
    return P.rosterHTML(3, 'Semua yang main. Daftar ini sama dengan game party lain di situs ini.') +
      '<section class="pg-card"><h2 class="pg-h">pengaturan</h2>' +
      '<div class="pg-stepper"><span><b>🕵️ Mata-mata</b><small>Ga tahu tempatnya. Harus menebak dari pertanyaan dan jawaban orang lain.</small></span>' +
      '<div class="pg-num"><button type="button" class="pg-mini" data-act="spies" data-d="-1" aria-label="Kurangi mata-mata"' + (c.spies <= 1 ? ' disabled' : '') + '>−</button>' +
      '<b aria-live="polite">' + c.spies + '</b>' +
      '<button type="button" class="pg-mini" data-act="spies" data-d="1" aria-label="Tambah mata-mata"' + (c.spies >= 2 ? ' disabled' : '') + '>+</button></div></div>' +
      '<label class="pg-field"><span>Lama ronde</span><select data-set="minutes">' +
      [5, 6, 7, 8, 10, 12].map(function (m) { return '<option value="' + m + '"' + (c.minutes === m ? ' selected' : '') + '>' + m + ' menit</option>'; }).join('') +
      '</select></label></section>' +
      '<div class="pg-cta">' + (prob ? '<p class="pg-warn">' + prob + '</p>' : '') +
      '<button type="button" class="pg-primary pg-wide" data-act="start"' + (prob ? ' disabled' : '') + '>bagikan kartu</button></div>' +
      rules();
  }

  function rules() {
    return '<details class="pg-help"><summary>aturan singkat</summary><ul>' +
      '<li><b>Kartu.</b> Semua pemain dapat nama tempat yang sama, kecuali mata-mata. Mata-mata cuma tahu bahwa dia mata-mata.</li>' +
      '<li><b>Tanya jawab.</b> Yang ditunjuk aplikasi bertanya ke siapa saja soal tempat itu, misalnya "biasanya kamu ke sini pakai baju apa?". Yang ditanya menjawab, lalu ganti dia yang bertanya. Jangan tanya balik ke orang yang barusan bertanya.</li>' +
      '<li><b>Seninya.</b> Jawaban jangan terlalu jelas supaya mata-mata ga langsung tahu, tapi jangan terlalu samar supaya kamu ga dicurigai.</li>' +
      '<li><b>Menuduh.</b> Kapan saja, siapa pun boleh menuduh. Kalau semua pemain lain setuju, ronde selesai: tekan "ungkap". Kalau salah tuduh, mata-mata menang.</li>' +
      '<li><b>Mata-mata</b> boleh kapan saja mengaku dan menebak tempatnya. Tebakan benar, mata-mata menang. Daftar semua tempat ada di layar supaya bisa dicoret-coret.</li>' +
      '<li><b>Waktu habis</b> tanpa ada yang tertangkap? Semua langsung voting satu orang. Salah tebak, mata-mata menang.</li>' +
      '</ul></details>';
  }

  function card(s, i) {
    if (s.spies.indexOf(i) >= 0) {
      var mates = s.spies.filter(function (k) { return k !== i; }).map(function (k) { return esc(s.names[k]); });
      return '<p class="pg-sub">' + esc(s.names[i]) + ', kamu adalah</p>' +
        '<div class="pg-role pg-t-wolf"><span class="pg-rico" aria-hidden="true">🕵️</span><b>Mata-mata</b></div>' +
        '<p class="pg-desc">Kamu ga tahu tempatnya. Dengarkan baik-baik, berbaur, dan coba tebak tempatnya sebelum ketahuan.</p>' +
        (mates.length ? '<p class="pg-desc"><b>Mata-mata lain:</b> ' + mates.join(', ') + '</p>' : '');
    }
    var pl = PLACES[s.place];
    return '<p class="pg-sub">' + esc(s.names[i]) + ', tempatnya</p>' +
      '<div class="pg-role pg-t-village"><span class="pg-rico" aria-hidden="true">' + pl[0] + '</span><b>' + esc(pl[1]) + '</b></div>' +
      '<p class="pg-desc">Kamu bukan mata-mata. Jawab pertanyaan secukupnya, jangan sampai mata-mata bisa menebak tempat ini.</p>';
  }

  function placesGrid(s) {
    return '<details class="pg-help" open><summary>semua kemungkinan tempat (ketuk untuk coret)</summary><div class="pg-places">' +
      PLACES.map(function (p, i) {
        var x = s.crossed.indexOf(i) >= 0;
        return '<button type="button" data-act="cross" data-i="' + i + '" aria-pressed="' + x + '"' + (x ? ' class="is-x"' : '') + '><span aria-hidden="true">' + p[0] + '</span>' + esc(p[1]) + '</button>';
      }).join('') + '</div></details>';
  }

  function render(s) {
    var top = s.phase === 'setup' ? '' : '<div class="pg-top"><span class="pg-chip">' + s.names.length + ' pemain</span>' +
      '<span class="pg-chip">' + s.spies.length + ' mata-mata</span><button type="button" class="pg-mini pg-push" data-act="quit">akhiri</button></div>';
    if (s.phase === 'reveal') {
      return top + P.revealHTML(s.names, P.range(s.names.length), s.rv, function (i) { return card(s, i); }, 'tutup, taruh HP di tengah');
    }
    if (s.phase === 'play') {
      return top + '<section class="pg-card" data-scrolltop><h2 class="pg-h">🕵️ cari mata-matanya</h2>' +
        P.timerHTML(s.timer, 'sisa waktu') +
        '<p class="pg-desc">Yang mulai bertanya: <b>' + esc(s.names[s.first]) + '</b></p>' +
        '<button type="button" class="pg-primary pg-wide" data-act="reveal">ungkap jawaban</button></section>' +
        placesGrid(s) + rules();
    }
    if (s.phase === 'end') {
      var pl = PLACES[s.place];
      return top + '<section class="pg-card pg-center-card" data-scrolltop><p class="pg-sub">tempatnya</p>' +
        '<div class="pg-role pg-t-village"><span class="pg-rico" aria-hidden="true">' + pl[0] + '</span><b>' + esc(pl[1]) + '</b></div>' +
        '<p class="pg-sub">mata-matanya</p><p class="pg-big">🕵️ ' + s.spies.map(function (i) { return esc(s.names[i]); }).join(' & ') + '</p>' +
        '<div class="pg-row pg-center"><button type="button" class="pg-primary" data-act="again">ronde baru</button><button type="button" data-act="quit">ubah pemain</button></div></section>';
    }
    return viewSetup(s);
  }

  function act(a, el, s, api) {
    switch (a) {
      case 'spies': s.cfg.spies = Math.min(2, Math.max(1, s.cfg.spies + +el.dataset.d)); break;
      case 'start': return deal(s);
      case 'rv-show': case 'rv-next':
        if (P.revealStep(a, s.rv, s.names.length) === 'done') {
          s.phase = 'play'; s.timer = P.newTimer(s.cfg.minutes * 60); s.timer.endAt = Date.now() + s.timer.left * 1000;
        }
        break;
      case 'cross': {
        var i = +el.dataset.i, k = s.crossed.indexOf(i);
        if (k >= 0) s.crossed.splice(k, 1); else s.crossed.push(i);
        break;
      }
      case 'reveal':
        if (!window.confirm('Ungkap tempat dan mata-matanya sekarang?')) return false;
        s.timer = null; s.phase = 'end'; break;
      case 'again': {
        var f = Object.assign(init(), { cfg: s.cfg });
        if (deal(f) === false) f.phase = 'setup';
        api.replace(f); return true;
      }
      case 'quit':
        if (s.phase !== 'end' && !window.confirm('Akhiri ronde ini?')) return false;
        api.replace(Object.assign(init(), { cfg: s.cfg })); return true;
      default: return false;
    }
    return true;
  }

  P.app(root, {
    key: 'mata-mata', version: 1, init: init, render: render, act: act,
    set: function (k, v, s) { if (k === 'minutes') s.cfg.minutes = +v; },
    playing: function (s) { return s.phase === 'reveal' || s.phase === 'play'; }
  });
})();
