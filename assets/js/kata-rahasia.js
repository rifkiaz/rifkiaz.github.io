// Kata Rahasia (/kata-rahasia/): most players share one word, the infiltrators
// get a similar one (and don't know it), and the optional "Si Kosong" gets none.
// Players give one-word clues, then vote someone out. Saved in localStorage.
(function () {
  'use strict';
  var P = window.Party, esc = P.esc;
  var root = document.getElementById('pg');
  if (!P || !root) return;

  var PAIRS = [
    ['Kopi', 'Teh'], ['Kucing', 'Harimau'], ['Nasi goreng', 'Mie goreng'], ['Bakso', 'Mie ayam'],
    ['Sate', 'Soto'], ['Motor', 'Sepeda'], ['Pantai', 'Danau'], ['Gunung', 'Bukit'],
    ['Hujan', 'Salju'], ['Matahari', 'Bulan'], ['Dokter', 'Perawat'], ['Guru', 'Dosen'],
    ['Pesawat', 'Helikopter'], ['Kereta', 'Bus'], ['Sendok', 'Garpu'], ['Bantal', 'Guling'],
    ['Jeruk', 'Lemon'], ['Semangka', 'Melon'], ['Gitar', 'Ukulele'], ['Piano', 'Keyboard'],
    ['Sepak bola', 'Futsal'], ['Badminton', 'Tenis'], ['Laptop', 'Tablet'], ['WhatsApp', 'Telegram'],
    ['Instagram', 'TikTok'], ['Netflix', 'YouTube'], ['Kemeja', 'Kaus'], ['Sandal', 'Sepatu'],
    ['Payung', 'Jas hujan'], ['Bioskop', 'Teater'], ['Martabak manis', 'Terang bulan'], ['Gorengan', 'Kerupuk'],
    ['Rendang', 'Semur'], ['Es teh', 'Es jeruk'], ['Apel', 'Pir'], ['Singa', 'Macan tutul'],
    ['Lumba-lumba', 'Hiu'], ['Bebek', 'Angsa'], ['Lebah', 'Tawon'], ['Kupu-kupu', 'Ngengat'],
    ['Linux', 'Windows'], ['Docker', 'Virtual machine'], ['Server', 'Router'], ['Git', 'Google Drive'],
    ['Kamera', 'Teropong'], ['Jam tangan', 'Gelang'], ['Lilin', 'Senter'], ['Kulkas', 'Freezer'],
    ['Sabun', 'Sampo'], ['Sikat gigi', 'Sisir'], ['Ojek online', 'Taksi'], ['Pasar', 'Supermarket'],
    ['Mudik', 'Liburan'], ['Ulang tahun', 'Wisuda'], ['Kondangan', 'Arisan'], ['Kopi susu', 'Cokelat panas']
  ];

  function init() { return { v: 1, phase: 'setup', cfg: { inf: 1, blank: false, custom: '', onlyCustom: false } }; }

  function customPairs(c) {
    return (c.custom || '').split('\n').map(function (l) {
      var m = l.split(/\s*[\/|,]\s*/).map(function (x) { return x.trim(); }).filter(Boolean);
      return m.length === 2 && m[0].toLowerCase() !== m[1].toLowerCase() ? [m[0].slice(0, 30), m[1].slice(0, 30)] : null;
    }).filter(Boolean);
  }

  function maxInf(n) { return Math.max(1, Math.floor((n - 1) / 3)); }
  function problem(s, n) {
    var c = s.cfg;
    if (n < 4) return 'Minimal 4 pemain.';
    if (c.inf > maxInf(n)) return 'Penyusupnya kebanyakan untuk ' + n + ' pemain (maksimal ' + maxInf(n) + ').';
    if (c.blank && n < 5) return 'Si Kosong butuh minimal 5 pemain.';
    if (c.onlyCustom && !customPairs(c).length) return 'Belum ada pasangan kata buatanmu yang valid.';
    return '';
  }

  function deal(s) {
    var names = P.getPlayers(), c = s.cfg;
    if (problem(s, names.length)) return false;
    var custom = customPairs(c), pool = c.onlyCustom ? custom : PAIRS.concat(custom);
    var recent = P.store.load('kr-recent', []);
    var fresh = pool.filter(function (p) { return recent.indexOf(p.join('|')) < 0; });
    var pair = P.pick(fresh.length ? fresh : pool);
    recent.push(pair.join('|'));
    P.store.save('kr-recent', recent.slice(-20));
    if (Math.random() < 0.5) pair = [pair[1], pair[0]];
    var order = P.shuffle(P.range(names.length)), roles = [];
    names.forEach(function () { roles.push('warga'); });
    for (var k = 0; k < c.inf; k++) roles[order[k]] = 'penyusup';
    if (c.blank) roles[order[c.inf]] = 'kosong';
    s.players = names.map(function (n, i) { return { name: n, role: roles[i], alive: true }; });
    s.words = { warga: pair[0], penyusup: pair[1] };
    s.round = 1; s.out = null; s.vote = null; s.winner = null; s.guess = '';
    s.rv = { i: 0, shown: false };
    s.phase = 'reveal';
    return true;
  }

  var ROLE = {
    warga: { name: 'Warga', team: 'village' },
    penyusup: { name: 'Penyusup', team: 'wolf' },
    kosong: { name: 'Si Kosong', team: 'blank' }
  };

  function alive(s) { return s.players.map(function (p, i) { return p.alive ? i : -1; }).filter(function (i) { return i >= 0; }); }
  function winner(s) {
    var a = alive(s), bad = a.filter(function (i) { return s.players[i].role !== 'warga'; }).length;
    if (!bad) return 'warga';
    if (a.length - bad <= bad || a.length <= 2) return 'penyusup';
    return null;
  }
  function startOrder(s) {
    var a = alive(s), st = P.pick(P.range(a.length));
    // Si Kosong never opens a round: going first with no word is too harsh.
    for (var t = 0; t < a.length && s.players[a[st]].role === 'kosong'; t++) st = (st + 1) % a.length;
    return a.slice(st).concat(a.slice(0, st));
  }

  function viewSetup(s) {
    var n = P.getPlayers().length, c = s.cfg, prob = problem(s, n), cp = customPairs(c).length;
    return P.rosterHTML(4, 'Semua yang main, urut sesuai posisi duduk.') +
      '<section class="pg-card"><h2 class="pg-h">pengaturan</h2>' +
      '<div class="pg-stepper"><span><b>🎭 Penyusup</b><small>Dapat kata yang mirip tapi beda, dan ga tahu kalau dirinya penyusup.</small></span>' +
      '<div class="pg-num"><button type="button" class="pg-mini" data-act="inf" data-d="-1" aria-label="Kurangi penyusup"' + (c.inf <= 1 ? ' disabled' : '') + '>−</button>' +
      '<b aria-live="polite">' + c.inf + '</b>' +
      '<button type="button" class="pg-mini" data-act="inf" data-d="1" aria-label="Tambah penyusup"' + (c.inf >= Math.max(1, maxInf(n)) ? ' disabled' : '') + '>+</button></div></div>' +
      '<label class="pg-check"><input type="checkbox" data-set="blank"' + (c.blank ? ' checked' : '') + '><span><b>❔ Si Kosong</b><small>Satu orang ga dapat kata sama sekali dan tahu itu. Kalau ketahuan, dia masih boleh menebak kata warga untuk menang sendirian.</small></span></label>' +
      '</section>' +
      '<details class="pg-help pg-card-like"' + (c.custom ? ' open' : '') + '><summary>pasangan kata buatan sendiri' + (cp ? ' (' + cp + ')' : '') + '</summary>' +
      '<p class="pg-sub">Satu pasangan per baris, pisahkan pakai garis miring. Contoh: <code>Kopi / Teh</code>. Tersimpan di browser ini.</p>' +
      '<label class="sr-only" for="kr-custom">Pasangan kata</label><textarea id="kr-custom" data-set="custom" rows="4" placeholder="Bakwan / Tahu isi&#10;Gojek / Grab">' + esc(c.custom || '') + '</textarea>' +
      '<label class="pg-check"><input type="checkbox" data-set="onlyCustom"' + (c.onlyCustom ? ' checked' : '') + '><span><b>Pakai kata buatanku saja</b><small>Kalau ga dicentang, kata buatanmu dicampur dengan ' + PAIRS.length + ' pasangan bawaan.</small></span></label></details>' +
      '<div class="pg-cta">' + (prob ? '<p class="pg-warn">' + prob + '</p>' : '') +
      '<button type="button" class="pg-primary pg-wide" data-act="start"' + (prob ? ' disabled' : '') + '>bagikan kata</button></div>' + rules();
  }

  function rules() {
    return '<details class="pg-help"><summary>aturan singkat</summary><ul>' +
      '<li><b>Kata.</b> Hampir semua pemain dapat kata yang sama. Penyusup dapat kata yang mirip, misalnya <i>Kopi</i> lawan <i>Teh</i>, dan ga tahu kalau dia penyusup. Si Kosong ga dapat kata.</li>' +
      '<li><b>Petunjuk.</b> Sesuai urutan di layar, tiap orang menyebut satu kata atau frasa pendek tentang katanya. Jangan sebut katanya langsung.</li>' +
      '<li><b>Voting.</b> Setelah semua bicara, diskusi sebentar lalu voting satu orang untuk keluar. Perannya dibuka.</li>' +
      '<li><b>Menang.</b> Warga menang kalau semua penyusup dan Si Kosong keluar. Penyusup menang kalau jumlah warga yang tersisa sudah ga lebih banyak dari mereka. Si Kosong yang keluar boleh menebak kata warga, kalau benar dia menang.</li>' +
      '<li><b>Tips.</b> Kalau petunjuk orang lain terasa agak "nyerempet", bisa jadi kamu sendiri penyusupnya. Main aman dan samarkan petunjukmu.</li>' +
      '</ul></details>';
  }

  function card(s, i) {
    var p = s.players[i];
    if (p.role === 'kosong') {
      return '<p class="pg-sub">' + esc(p.name) + ', kamu</p><div class="pg-role pg-t-blank"><span class="pg-rico" aria-hidden="true">❔</span><b>Si Kosong</b></div>' +
        '<p class="pg-desc">Kamu ga dapat kata. Dengarkan petunjuk orang lain, ikut berbaur, dan coba tebak kata mereka.</p>';
    }
    return '<p class="pg-sub">' + esc(p.name) + ', katamu</p><div class="pg-role pg-t-word"><b>' + esc(s.words[p.role]) + '</b></div>' +
      '<p class="pg-desc">Ingat baik-baik. Saat giliranmu, sebut satu petunjuk tanpa menyebut kata ini.</p>';
  }

  function pickBtns(s, ids, sel) {
    return '<div class="pg-pick">' + ids.map(function (i) {
      return '<button type="button" data-act="v-pick" data-i="' + i + '" aria-pressed="' + (sel === i) + '"' + (sel === i ? ' class="is-sel"' : '') + '>' + esc(s.players[i].name) + '</button>';
    }).join('') + '</div>';
  }

  function listAll(s) {
    return '<ul class="pg-list">' + s.players.map(function (p) {
      var r = ROLE[p.role];
      return '<li class="' + (p.alive ? '' : 'is-dead') + '"><b>' + esc(p.name) + '</b><span class="pg-tag pg-t-' + r.team + '">' + r.name + '</span><small>' +
        (p.role === 'kosong' ? '—' : esc(s.words[p.role])) + '</small></li>';
    }).join('') + '</ul>';
  }

  function render(s) {
    var top = s.phase === 'setup' ? '' : '<div class="pg-top"><span class="pg-chip">' + s.players.length + ' pemain</span>' +
      '<span class="pg-chip">ronde ' + s.round + '</span><button type="button" class="pg-mini pg-push" data-act="quit">akhiri</button></div>';
    var p = s.phase;
    if (p === 'reveal') {
      return top + P.revealHTML(s.players.map(function (x) { return x.name; }), P.range(s.players.length), s.rv,
        function (i) { return card(s, i); }, 'tutup, taruh HP di tengah');
    }
    if (p === 'clue') {
      return top + '<section class="pg-card" data-scrolltop><h2 class="pg-h">🗣️ ronde ' + s.round + ': petunjuk</h2>' +
        '<p class="pg-sub">Sebut satu petunjuk sesuai urutan ini:</p><ol class="pg-order">' +
        s.order.map(function (i) { return '<li>' + esc(s.players[i].name) + '</li>'; }).join('') + '</ol>' +
        '<button type="button" class="pg-primary pg-wide" data-act="to-vote">semua sudah, lanjut voting</button></section>' + rules();
    }
    if (p === 'vote') {
      return top + '<section class="pg-card" data-scrolltop><h2 class="pg-h">⚖️ voting ronde ' + s.round + '</h2>' +
        '<p class="pg-sub">Diskusi, lalu tunjuk bareng-bareng di hitungan ketiga. Pilih yang suaranya terbanyak.</p>' +
        pickBtns(s, alive(s), s.vote) +
        '<button type="button" class="pg-primary pg-wide" data-act="v-out"' + (s.vote == null ? ' disabled' : '') + '>' +
        (s.vote == null ? 'keluarkan' : 'keluarkan ' + esc(s.players[s.vote].name)) + '</button></section>';
    }
    if (p === 'out') {
      var o = s.players[s.out], r = ROLE[o.role];
      return top + '<section class="pg-card pg-center-card" data-scrolltop><p class="pg-big">👋 ' + esc(o.name) + '</p>' +
        '<p class="pg-sub">ternyata</p><div class="pg-role pg-t-' + r.team + '"><b>' + r.name + '</b></div>' +
        (o.role === 'kosong' ? '<p class="pg-desc">Si Kosong punya satu kesempatan menebak kata warga.</p>' +
          '<form class="pg-add" data-form="guess"><label class="sr-only" for="kr-guess">Tebakan kata</label><input id="kr-guess" type="text" maxlength="30" autocomplete="off" placeholder="tebakan kata warga"><button type="submit" class="pg-primary">tebak</button></form>' +
          '<button type="button" class="pg-mini" data-act="no-guess">ga mau nebak</button>' :
          '<button type="button" class="pg-primary pg-wide" data-act="out-ok">lanjut</button>') + '</section>';
    }
    if (p === 'end') {
      var w = s.winner, infLeft = s.players.some(function (x) { return x.alive && x.role === 'penyusup'; });
      var msg = w === 'warga' ? '🎉 Warga menang!' : w === 'kosong' || !infLeft ? '❔ Si Kosong menang!' : '🎭 Penyusup menang!';
      return top + '<section class="pg-card pg-center-card" data-scrolltop><p class="pg-win ' + (w === 'warga' ? 'is-ok' : 'is-wolf') + '">' + msg + '</p>' +
        (w === 'kosong' ? '<p class="pg-sub">Tebakan "' + esc(s.guess) + '" benar.</p>' : '') +
        '<p class="pg-desc">Kata warga <b>' + esc(s.words.warga) + '</b>, kata penyusup <b>' + esc(s.words.penyusup) + '</b>.</p>' + listAll(s) +
        '<div class="pg-row pg-center"><button type="button" class="pg-primary" data-act="again">main lagi</button><button type="button" data-act="quit">ubah pengaturan</button></div></section>';
    }
    return viewSetup(s);
  }

  function norm(x) { return String(x).toLowerCase().replace(/[^a-z0-9]/g, ''); }

  function next(s) {
    var w = winner(s);
    if (w) { s.winner = w; s.phase = 'end'; return; }
    s.round++; s.order = startOrder(s); s.phase = 'clue';
  }

  function act(a, el, s, api) {
    switch (a) {
      case 'inf': s.cfg.inf = Math.max(1, s.cfg.inf + +el.dataset.d); break;
      case 'start': return deal(s);
      case 'rv-show': case 'rv-next':
        if (P.revealStep(a, s.rv, s.players.length) === 'done') { s.order = startOrder(s); s.phase = 'clue'; }
        break;
      case 'to-vote': s.phase = 'vote'; s.vote = null; break;
      case 'v-pick': s.vote = s.vote === +el.dataset.i ? null : +el.dataset.i; break;
      case 'v-out':
        if (s.vote == null) return false;
        s.out = s.vote; s.vote = null; s.players[s.out].alive = false; s.phase = 'out'; break;
      case 'guess': {
        var g = (root.querySelector('#kr-guess').value || '').trim();
        if (!g) return false;
        s.guess = g;
        if (norm(g) === norm(s.words.warga)) { s.winner = 'kosong'; s.phase = 'end'; }
        else { P.toast('Salah, bukan "' + g + '"'); next(s); }
        break;
      }
      case 'no-guess': case 'out-ok': next(s); break;
      case 'again': {
        var f = Object.assign(init(), { cfg: s.cfg });
        if (deal(f) === false) f.phase = 'setup';
        api.replace(f); return true;
      }
      case 'quit':
        if (s.phase !== 'end' && !window.confirm('Akhiri game ini?')) return false;
        api.replace(Object.assign(init(), { cfg: s.cfg })); return true;
      default: return false;
    }
    return true;
  }

  P.app(root, {
    key: 'kata-rahasia', version: 1, init: init, render: render, act: act,
    set: function (k, v, s) { if (k === 'custom') s.cfg.custom = String(v).slice(0, 4000); else s.cfg[k] = !!v; },
    playing: function (s) { return s.phase !== 'setup' && s.phase !== 'end'; }
  });
})();
