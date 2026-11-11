// Werewolf (/werewolf/): one phone runs the game, either held by a moderator
// or passed around every night. State is saved in localStorage after every
// tap, so a refresh or a locked screen picks up where the game left off.
(function () {
  'use strict';
  var P = window.Party, esc = P.esc;
  var root = document.getElementById('pg');
  if (!P || !root) return;

  var ROLES = {
    serigala: { name: 'Serigala', team: 'wolf', ico: '🐺',
      desc: 'Tiap malam, bareng serigala lain, pilih satu orang untuk dimangsa. Siang hari, pura-pura jadi warga biasa dan jangan sampai ketahuan.' },
    warga: { name: 'Warga', team: 'village', ico: '🧑‍🌾',
      desc: 'Ga punya kemampuan khusus. Senjatamu cuma logika, insting, dan suara saat voting. Cari serigalanya!' },
    peramal: { name: 'Peramal', team: 'village', ico: '🔮',
      desc: 'Tiap malam, pilih satu orang untuk diterawang: serigala atau bukan. Bagikan hasilnya dengan hati-hati, serigala pasti mengincarmu.' },
    penjaga: { name: 'Penjaga', team: 'village', ico: '🛡️',
      desc: 'Tiap malam, pilih satu orang untuk dilindungi dari serangan serigala. Boleh dirimu sendiri, tapi ga boleh orang yang sama dua malam berturut-turut.' },
    pemburu: { name: 'Pemburu', team: 'village', ico: '🏹',
      desc: 'Kalau kamu mati, entah dimangsa atau kena voting, kamu langsung boleh menembak satu orang untuk ikut keluar.' }
  };
  var NIGHT_ORDER = ['serigala', 'penjaga', 'peramal'];
  var SCRIPT = {
    serigala: 'Serigala, bangun. Saling kenali teman kalian, lalu tunjuk satu korban.',
    penjaga: 'Penjaga, bangun. Tunjuk satu orang yang mau kamu lindungi malam ini.',
    peramal: 'Peramal, bangun. Tunjuk satu orang yang mau kamu terawang.'
  };

  function suggestWolves(n) { return n <= 6 ? 1 : n <= 11 ? 2 : 3; }

  function init() {
    var n = P.getPlayers().length;
    return {
      v: 1, phase: 'setup',
      cfg: { mode: 'mod', wolves: suggestWolves(n), wolvesAuto: true, peramal: true, penjaga: true, pemburu: n >= 7, open: true, discuss: 180 },
      players: [], round: 0, log: []
    };
  }

  // ---------- helpers ----------
  function alive(s) { return s.players.map(function (p, i) { return p.alive ? i : -1; }).filter(function (i) { return i >= 0; }); }
  function nameOf(s, i) { return s.players[i].name; }
  function roleOf(s, i) { return s.players[i].role; }
  function isWolf(s, i) { return ROLES[roleOf(s, i)].team === 'wolf'; }
  function has(s, role) { return s.players.some(function (p) { return p.role === role; }); }
  function aliveRole(s, role) { return s.players.some(function (p) { return p.alive && p.role === role; }); }
  function log(s, msg) { s.log.push(msg); }

  function winner(s) {
    var a = alive(s), w = a.filter(function (i) { return isWolf(s, i); }).length;
    if (w === 0) return 'village';
    if (w >= a.length - w) return 'wolf';
    return null;
  }

  function kill(s, i, why) {
    if (!s.players[i].alive) return;
    s.players[i].alive = false;
    log(s, nameOf(s, i) + ' ' + why + ' (' + ROLES[roleOf(s, i)].name + ')');
    if (roleOf(s, i) === 'pemburu') s.hunterPending = i;
  }

  // After deaths: hunter shot first, then a win check, then the next phase.
  function afterDeaths(s, next) {
    if (s.hunterPending != null) { s.hunter = { who: s.hunterPending, next: next, pick: null }; s.hunterPending = null; s.phase = 'hunter'; return; }
    var w = winner(s);
    if (w) { s.winner = w; s.phase = 'end'; log(s, w === 'wolf' ? 'Serigala menang.' : 'Warga menang.'); return; }
    if (next === 'night') startNight(s); else { s.phase = 'day'; s.timer = P.newTimer(s.cfg.discuss); }
  }

  function startNight(s) {
    s.round++;
    s.phase = 'night';
    s.timer = null;
    s.night = { step: 0, wolf: null, guard: null, seer: null, seen: false, votes: {}, sus: {}, pass: { i: 0, shown: false, done: false } };
    if (s.cfg.mode === 'pass') s.night.order = alive(s);
    log(s, '— Malam ' + s.round + ' —');
  }

  function resolveNight(s) {
    var n = s.night, victim = n.wolf;
    if (s.cfg.mode === 'pass') {
      var tally = {}, best = 0, top = [];
      Object.keys(n.votes).forEach(function (k) { var t = n.votes[k]; tally[t] = (tally[t] || 0) + 1; });
      Object.keys(tally).forEach(function (t) {
        if (tally[t] > best) { best = tally[t]; top = [+t]; } else if (tally[t] === best) top.push(+t);
      });
      victim = top.length ? P.pick(top) : null;
      var sb = 0, st = [];
      var sc = {};
      Object.keys(n.sus).forEach(function (k) { var t = n.sus[k]; sc[t] = (sc[t] || 0) + 1; });
      Object.keys(sc).forEach(function (t) { if (sc[t] > sb) { sb = sc[t]; st = [+t]; } else if (sc[t] === sb) st.push(+t); });
      s.suspect = sb >= 2 && st.length === 1 ? { who: st[0], n: sb } : null;
    }
    s.lastGuard = n.guard;
    s.dawn = [];
    s.saved = false;
    if (victim != null) {
      if (victim === n.guard) { s.saved = true; log(s, 'Serangan ke ' + nameOf(s, victim) + ' digagalkan penjaga'); }
      else { kill(s, victim, 'dimangsa serigala'); s.dawn.push(victim); }
    }
    s.night = null;
    s.phase = 'dawn';
  }

  // ---------- setup ----------
  // Until the stepper is touched, the wolf count follows the player count.
  function syncWolves(s, n) { if (s.cfg.wolvesAuto && n >= 5) s.cfg.wolves = suggestWolves(n); }

  function rolesFor(s, n) {
    var c = s.cfg, list = [];
    for (var k = 0; k < c.wolves; k++) list.push('serigala');
    if (c.peramal) list.push('peramal');
    if (c.penjaga) list.push('penjaga');
    if (c.pemburu) list.push('pemburu');
    while (list.length < n) list.push('warga');
    return list;
  }
  function setupProblem(s, n) {
    var c = s.cfg, specials = c.wolves + (c.peramal ? 1 : 0) + (c.penjaga ? 1 : 0) + (c.pemburu ? 1 : 0);
    if (n < 5) return 'Minimal 5 pemain' + (c.mode === 'mod' ? ' (moderator ga dihitung)' : '') + '.';
    if (c.wolves * 2 >= n) return 'Serigalanya kebanyakan, harus kurang dari setengah pemain.';
    if (specials > n) return 'Peran spesial lebih banyak dari pemain.';
    return '';
  }

  function viewSetup(s) {
    var n = P.getPlayers().length, c = s.cfg;
    syncWolves(s, n);
    var prob = setupProblem(s, n);
    var maxW = Math.max(1, Math.ceil(n / 2) - 1);
    var roles = rolesFor(s, n), count = {};
    roles.forEach(function (r) { count[r] = (count[r] || 0) + 1; });
    var sum = Object.keys(ROLES).filter(function (r) { return count[r]; }).map(function (r) {
      return '<span class="pg-tag pg-t-' + ROLES[r].team + '">' + ROLES[r].ico + ' ' + ROLES[r].name + ' ×' + count[r] + '</span>';
    }).join('');
    function chk(key, role) {
      return '<label class="pg-check"><input type="checkbox" data-set="' + key + '"' + (c[key] ? ' checked' : '') + '>' +
        '<span><b>' + ROLES[role].ico + ' ' + ROLES[role].name + '</b><small>' + ROLES[role].desc + '</small></span></label>';
    }
    return P.rosterHTML(5, c.mode === 'mod' ? 'Moderator ga ikut main, jadi jangan masukkan namanya.' : 'Semua yang main, urut sesuai posisi duduk.') +
      '<section class="pg-card"><h2 class="pg-h">cara main</h2>' +
      '<div class="pg-seg" role="radiogroup" aria-label="Mode permainan">' +
      '<button type="button" role="radio" aria-checked="' + (c.mode === 'mod') + '" data-act="mode" data-v="mod"><b>ada moderator</b><small>Satu orang pegang HP dan memandu. HP ini jadi naskah dan catatannya.</small></button>' +
      '<button type="button" role="radio" aria-checked="' + (c.mode === 'pass') + '" data-act="mode" data-v="pass"><b>tanpa moderator</b><small>Semua ikut main. Tiap malam HP dioper keliling, semua orang menekan sesuatu supaya ga ketahuan siapa perannya apa.</small></button>' +
      '</div></section>' +
      '<section class="pg-card"><h2 class="pg-h">peran</h2>' +
      '<div class="pg-stepper"><span><b>🐺 Serigala</b><small>' + ROLES.serigala.desc + '</small></span>' +
      '<div class="pg-num"><button type="button" class="pg-mini" data-act="wolves" data-d="-1" aria-label="Kurangi serigala"' + (c.wolves <= 1 ? ' disabled' : '') + '>−</button>' +
      '<b aria-live="polite">' + c.wolves + '</b>' +
      '<button type="button" class="pg-mini" data-act="wolves" data-d="1" aria-label="Tambah serigala"' + (c.wolves >= maxW ? ' disabled' : '') + '>+</button></div></div>' +
      (n >= 5 && c.wolves !== suggestWolves(n) ? '<p class="pg-sub">Saran untuk ' + n + ' pemain: ' + suggestWolves(n) + ' serigala.</p>' : '') +
      chk('peramal', 'peramal') + chk('penjaga', 'penjaga') + chk('pemburu', 'pemburu') +
      '<p class="pg-sub">Sisanya jadi Warga. ' + ROLES.warga.desc + '</p>' +
      (n ? '<div class="pg-tags">' + sum + '</div>' : '') +
      '</section>' +
      '<section class="pg-card"><h2 class="pg-h">aturan</h2>' +
      '<label class="pg-check"><input type="checkbox" data-set="open"' + (c.open ? ' checked' : '') + '><span><b>Buka peran yang mati</b><small>Saat seseorang keluar, perannya diumumkan. Matikan kalau mau lebih seru dan penuh tebakan.</small></span></label>' +
      '<label class="pg-field"><span>Waktu diskusi siang</span><select data-set="discuss">' +
      [60, 120, 180, 240, 300, 420].map(function (t) { return '<option value="' + t + '"' + (c.discuss === t ? ' selected' : '') + '>' + (t / 60) + ' menit</option>'; }).join('') +
      '</select></label></section>' +
      '<div class="pg-cta">' + (prob ? '<p class="pg-warn">' + prob + '</p>' : '') +
      '<button type="button" class="pg-primary pg-wide" data-act="start"' + (prob ? ' disabled' : '') + '>bagikan peran</button></div>' +
      rules();
  }

  function rules() {
    return '<details class="pg-help"><summary>aturan singkat</summary><ul>' +
      '<li><b>Tujuan.</b> Warga menang kalau semua serigala keluar. Serigala menang kalau jumlah mereka sudah sama dengan atau lebih banyak dari sisa pemain lain.</li>' +
      '<li><b>Malam.</b> Semua menutup mata. Serigala memilih korban, penjaga melindungi satu orang, peramal menerawang satu orang. Kalau korban serigala kebetulan dilindungi, malam itu ga ada yang mati.</li>' +
      '<li><b>Siang.</b> Diumumkan siapa yang mati semalam. Semua berdiskusi, saling tuduh, lalu voting satu orang untuk dikeluarkan. Boleh juga sepakat ga mengeluarkan siapa pun.</li>' +
      '<li><b>Yang sudah mati</b> diam saja dan ga boleh kasih kode. Mereka boleh tetap menonton.</li>' +
      '<li><b>Tanpa moderator.</b> Di malam hari HP dioper ke semua yang masih hidup. Peran tanpa aksi malam diminta menunjuk orang yang paling dicurigai, jadi lama memegang HP-nya kurang lebih sama. Kalau ada satu nama yang paling banyak dicurigai, paginya diumumkan.</li>' +
      '</ul></details>';
  }

  // ---------- views ----------
  function playerBtns(s, ids, sel, act, disabledFn) {
    return '<div class="pg-pick">' + ids.map(function (i) {
      var dis = disabledFn ? disabledFn(i) : '';
      return '<button type="button" data-act="' + act + '" data-i="' + i + '"' + (sel === i ? ' aria-pressed="true" class="is-sel"' : ' aria-pressed="false"') +
        (dis ? ' disabled title="' + esc(dis) + '"' : '') + '>' + esc(nameOf(s, i)) + (dis ? '<small>' + esc(dis) + '</small>' : '') + '</button>';
    }).join('') + '</div>';
  }

  function roleCard(s, i) {
    var r = ROLES[roleOf(s, i)];
    var mates = isWolf(s, i) ? s.players.map(function (p, k) { return k !== i && p.role === 'serigala' ? p.name : null; }).filter(Boolean) : [];
    return '<p class="pg-sub">' + esc(nameOf(s, i)) + ', peranmu</p>' +
      '<div class="pg-role pg-t-' + r.team + '"><span class="pg-rico" aria-hidden="true">' + r.ico + '</span><b>' + r.name + '</b></div>' +
      '<p class="pg-desc">' + r.desc + '</p>' +
      (isWolf(s, i) ? '<p class="pg-desc"><b>Teman serigalamu:</b> ' + (mates.length ? mates.map(esc).join(', ') : 'ga ada, kamu sendirian') + '</p>' : '');
  }

  function viewReveal(s) {
    return P.revealHTML(s.players.map(function (p) { return p.name; }), P.range(s.players.length), s.rv, function (i) { return roleCard(s, i); },
      s.cfg.mode === 'mod' ? 'tutup, kembalikan ke moderator' : 'tutup, taruh HP di tengah');
  }

  function stepsOf(s) {
    // Roles that exist in this game are always called, even when dead, so nobody can tell.
    return NIGHT_ORDER.filter(function (r) { return has(s, r); });
  }

  function viewNightMod(s) {
    var n = s.night, steps = stepsOf(s), role = steps[n.step], a = alive(s);
    var head = '<section class="pg-card" data-scrolltop><h2 class="pg-h">🌙 malam ' + s.round + ' <span class="pg-chip">' + (n.step + 1) + '/' + steps.length + '</span></h2>';
    if (n.step === 0 && !n.started) {
      return head + '<p class="pg-script">"Malam tiba. Semua tutup mata dan tundukkan kepala."</p>' +
        '<button type="button" class="pg-primary pg-wide" data-act="n-go">semua sudah tidur</button></section>' + modPanel(s);
    }
    var holders = s.players.map(function (p, i) { return p.alive && p.role === role ? i : -1; }).filter(function (i) { return i >= 0; });
    var who = holders.length ? holders.map(function (i) { return esc(nameOf(s, i)); }).join(', ') : null;
    var body = '<p class="pg-script">"' + SCRIPT[role] + '"</p>' +
      '<p class="pg-sub">' + ROLES[role].ico + ' ' + ROLES[role].name + ': ' + (who || '<b>sudah mati</b>') + '</p>';
    var ready = false;
    if (!who) {
      body += '<p class="pg-note">Tetap bacakan naskahnya dan tunggu beberapa detik, supaya pemain lain ga tahu perannya sudah ga ada.</p>';
      ready = true;
    } else if (role === 'serigala') {
      body += playerBtns(s, a, n.wolf, 'n-wolf', function (i) { return isWolf(s, i) ? 'serigala' : ''; });
      ready = n.wolf != null;
    } else if (role === 'penjaga') {
      body += playerBtns(s, a, n.guard, 'n-guard', function (i) { return i === s.lastGuard ? 'dijaga semalam' : ''; });
      ready = n.guard != null;
    } else if (role === 'peramal') {
      body += playerBtns(s, a, n.seer, 'n-seer', function (i) { return roleOf(s, i) === 'peramal' ? 'diri sendiri' : ''; });
      if (n.seer != null) {
        body += '<div class="pg-result ' + (isWolf(s, n.seer) ? 'is-wolf' : 'is-ok') + '">' + esc(nameOf(s, n.seer)) + ' ' +
          (isWolf(s, n.seer) ? 'adalah <b>SERIGALA</b> 👎' : '<b>bukan serigala</b> 👍') + '</div>' +
          '<p class="pg-note">Kasih isyarat jempol ke peramal: jempol bawah = serigala.</p>';
      }
      ready = n.seer != null;
    }
    var last = n.step === steps.length - 1;
    body += '<p class="pg-script pg-dim">"' + ROLES[role].name + ', tidur lagi."</p>' +
      '<button type="button" class="pg-primary pg-wide" data-act="n-next"' + (ready ? '' : ' disabled') + '>' + (last ? 'pagi tiba ☀️' : 'lanjut') + '</button>';
    return head + body + '</section>' + modPanel(s);
  }

  function viewNightPass(s) {
    var n = s.night, ps = n.pass, order = n.order;
    var head = '<section class="pg-card pg-pass" data-scrolltop><h2 class="pg-h">🌙 malam ' + s.round + ' <span class="pg-chip">' + Math.min(ps.i + 1, order.length) + '/' + order.length + '</span></h2>';
    if (ps.i >= order.length) {
      return head + '<p class="pg-big">Semua sudah</p><p class="pg-sub">Taruh HP di tengah dan semua buka mata.</p>' +
        '<button type="button" class="pg-primary pg-wide" data-act="np-dawn">pagi tiba ☀️</button></section>';
    }
    var me = order[ps.i], nm = esc(nameOf(s, me));
    if (!ps.shown) {
      return head + '<p class="pg-sub">semua tutup mata, oper HP ke</p><p class="pg-big">' + nm + '</p>' +
        '<button type="button" class="pg-primary pg-wide" data-act="np-show">saya ' + nm + '</button></section>';
    }
    var role = roleOf(s, me), a = alive(s), body = '', ready;
    var others = a.filter(function (i) { return i !== me; });
    if (role === 'serigala') {
      var votes = Object.keys(n.votes).filter(function (k) { return +k !== me; }).map(function (k) {
        return esc(nameOf(s, +k)) + ' → ' + esc(nameOf(s, n.votes[k]));
      });
      body = '<p class="pg-desc">🐺 Kamu serigala. Pilih korban malam ini.</p>' +
        (votes.length ? '<p class="pg-note">Pilihan serigala lain: ' + votes.join(', ') + '. Korban = pilihan terbanyak.</p>' : '') +
        playerBtns(s, a, n.votes[me], 'np-pick', function (i) { return isWolf(s, i) ? 'serigala' : ''; });
      ready = n.votes[me] != null;
    } else if (role === 'penjaga') {
      body = '<p class="pg-desc">🛡️ Kamu penjaga. Pilih satu orang untuk dilindungi.</p>' +
        playerBtns(s, a, n.guard, 'np-pick', function (i) { return i === s.lastGuard ? 'dijaga semalam' : ''; });
      ready = n.guard != null;
    } else if (role === 'peramal') {
      body = '<p class="pg-desc">🔮 Kamu peramal. Pilih satu orang untuk diterawang.</p>' +
        (n.seer == null ? playerBtns(s, others, null, 'np-pick') :
          '<div class="pg-result ' + (isWolf(s, n.seer) ? 'is-wolf' : 'is-ok') + '">' + esc(nameOf(s, n.seer)) + ' ' +
          (isWolf(s, n.seer) ? 'adalah <b>SERIGALA</b>' : '<b>bukan serigala</b>') + '</div>');
      ready = n.seer != null;
    } else {
      body = '<p class="pg-desc">' + ROLES[role].ico + ' Kamu ' + ROLES[role].name.toLowerCase() + ', ga ada aksi malam ini. Biar ga ketahuan, tunjuk orang yang paling kamu curigai.</p>' +
        playerBtns(s, others, n.sus[me], 'np-pick');
      ready = n.sus[me] != null;
    }
    var nextName = ps.i + 1 < order.length ? esc(nameOf(s, order[ps.i + 1])) : null;
    return head.replace('pg-pass"', 'pg-pass pg-secret"') + body +
      '<button type="button" class="pg-primary pg-wide" data-act="np-next"' + (ready ? '' : ' disabled') + '>' +
      (nextName ? 'selesai, oper ke ' + nextName : 'selesai') + '</button></section>';
  }

  function viewDawn(s) {
    var txt;
    if (s.dawn.length) {
      txt = s.dawn.map(function (i) {
        return '<p class="pg-big">💀 ' + esc(nameOf(s, i)) + '</p><p class="pg-sub">dimangsa serigala semalam' +
          (s.cfg.open ? '. Perannya: <b>' + ROLES[roleOf(s, i)].ico + ' ' + ROLES[roleOf(s, i)].name + '</b>' : '') + '</p>';
      }).join('');
    } else {
      txt = '<p class="pg-big">Semua selamat</p><p class="pg-sub">Semalam ga ada yang mati.' + (s.cfg.mode === 'mod' && s.saved ? ' (Penjaga berhasil menyelamatkan korban, jangan bilang-bilang.)' : '') + '</p>';
    }
    var sus = s.suspect && s.players[s.suspect.who].alive ? '<p class="pg-note">🤔 Paling dicurigai semalam: <b>' + esc(nameOf(s, s.suspect.who)) + '</b> (' + s.suspect.n + ' orang).</p>' : '';
    return '<section class="pg-card pg-center-card" data-scrolltop><h2 class="pg-h">☀️ pagi hari ke-' + s.round + '</h2>' +
      '<p class="pg-script">"Pagi tiba, semua buka mata."</p>' + txt + sus +
      '<button type="button" class="pg-primary pg-wide" data-act="dawn-ok">lanjut</button></section>' + modPanel(s);
  }

  function viewHunter(s) {
    var h = s.hunter, a = alive(s);
    return '<section class="pg-card" data-scrolltop><h2 class="pg-h">🏹 tembakan terakhir</h2>' +
      '<p class="pg-desc"><b>' + esc(nameOf(s, h.who)) + '</b> adalah pemburu! Sebelum pergi, pilih satu orang untuk ditembak.</p>' +
      playerBtns(s, a, h.pick, 'h-pick') +
      '<div class="pg-row"><button type="button" class="pg-primary" data-act="h-shoot"' + (h.pick == null ? ' disabled' : '') + '>tembak</button>' +
      '<button type="button" data-act="h-skip">ga nembak</button></div></section>';
  }

  function viewDay(s) {
    var a = alive(s), sel = s.vote;
    return '<section class="pg-card" data-scrolltop><h2 class="pg-h">💬 siang hari ke-' + s.round + ' <span class="pg-chip">' + a.length + ' hidup</span></h2>' +
      P.timerHTML(s.timer, 'diskusi') +
      '<p class="pg-sub">Diskusi, lalu voting. Tunjuk bareng-bareng di hitungan ketiga, atau voting satu per satu.</p>' +
      playerBtns(s, a, sel, 'v-pick') +
      '<div class="pg-row"><button type="button" class="pg-primary" data-act="v-out"' + (sel == null ? ' disabled' : '') + '>' +
      (sel == null ? 'keluarkan' : 'keluarkan ' + esc(nameOf(s, sel))) + '</button>' +
      '<button type="button" data-act="v-none">ga ada yang keluar</button></div></section>' + modPanel(s);
  }

  function viewOut(s) {
    var i = s.out;
    return '<section class="pg-card pg-center-card" data-scrolltop><h2 class="pg-h">⚖️ hasil voting</h2>' +
      (i == null ? '<p class="pg-big">Ga ada yang keluar</p><p class="pg-sub">Warga ga sepakat. Malam pun tiba.</p>' :
        '<p class="pg-big">👋 ' + esc(nameOf(s, i)) + '</p><p class="pg-sub">keluar dari desa' +
        (s.cfg.open ? '. Perannya: <b>' + ROLES[roleOf(s, i)].ico + ' ' + ROLES[roleOf(s, i)].name + '</b>' : '') + '</p>') +
      '<button type="button" class="pg-primary pg-wide" data-act="out-ok">lanjut</button></section>' + modPanel(s);
  }

  function viewEnd(s) {
    var wolf = s.winner === 'wolf';
    var rows = s.players.map(function (p) {
      var r = ROLES[p.role];
      return '<li class="' + (p.alive ? '' : 'is-dead') + '"><span>' + r.ico + '</span><b>' + esc(p.name) + '</b><span class="pg-tag pg-t-' + r.team + '">' + r.name + '</span>' +
        '<small>' + (p.alive ? 'hidup' : 'mati') + '</small></li>';
    }).join('');
    return '<section class="pg-card pg-center-card" data-scrolltop><p class="pg-win ' + (wolf ? 'is-wolf' : 'is-ok') + '">' + (wolf ? '🐺 Serigala menang!' : '🎉 Warga menang!') + '</p>' +
      '<p class="pg-sub">' + (wolf ? 'Desa jatuh ke tangan serigala.' : 'Semua serigala sudah keluar dari desa.') + '</p>' +
      '<ul class="pg-list">' + rows + '</ul>' +
      '<div class="pg-row pg-center"><button type="button" class="pg-primary" data-act="again">main lagi</button><button type="button" data-act="quit">ubah pengaturan</button></div></section>' +
      logView(s, true);
  }

  function modPanel(s) {
    if (s.cfg.mode !== 'mod') return '';
    var rows = s.players.map(function (p) {
      var r = ROLES[p.role];
      return '<li class="' + (p.alive ? '' : 'is-dead') + '"><span>' + r.ico + '</span><b>' + esc(p.name) + '</b><span class="pg-tag pg-t-' + r.team + '">' + r.name + '</span></li>';
    }).join('');
    return '<details class="pg-help"><summary>contekan moderator (rahasia)</summary><ul class="pg-list">' + rows + '</ul></details>' + logView(s);
  }

  function logView(s, open) {
    if (!s.log.length) return '';
    return '<details class="pg-help"' + (open ? ' open' : '') + '><summary>catatan permainan</summary><ol class="pg-log">' +
      s.log.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ol></details>';
  }

  function topbar(s) {
    if (s.phase === 'setup') return '';
    return '<div class="pg-top"><span class="pg-chip">' + (s.cfg.mode === 'mod' ? 'ada moderator' : 'tanpa moderator') + '</span>' +
      '<span class="pg-chip">' + s.players.length + ' pemain</span>' +
      '<button type="button" class="pg-mini pg-push" data-act="quit">akhiri game</button></div>';
  }

  function render(s) {
    var v;
    switch (s.phase) {
      case 'reveal': v = viewReveal(s); break;
      case 'ready': v = '<section class="pg-card pg-center-card" data-scrolltop><p class="pg-big">Semua sudah tahu perannya</p>' +
        '<p class="pg-sub">' + (s.cfg.mode === 'mod' ? 'Moderator, mulai malam pertama.' : 'Taruh HP di tengah. Malam pertama dimulai, HP akan dioper keliling.') + '</p>' +
        '<button type="button" class="pg-primary pg-wide" data-act="night">mulai malam pertama 🌙</button></section>' + modPanel(s); break;
      case 'night': v = s.cfg.mode === 'pass' ? viewNightPass(s) : viewNightMod(s); break;
      case 'dawn': v = viewDawn(s); break;
      case 'hunter': v = viewHunter(s); break;
      case 'day': v = viewDay(s); break;
      case 'out': v = viewOut(s); break;
      case 'end': v = viewEnd(s); break;
      default: v = viewSetup(s);
    }
    return topbar(s) + v;
  }

  // ---------- actions ----------
  function deal(s) {
    var names = P.getPlayers();
    syncWolves(s, names.length);
    if (setupProblem(s, names.length)) return false;
    var roles = P.shuffle(rolesFor(s, names.length));
    s.players = names.map(function (nm, k) { return { name: nm, role: roles[k], alive: true }; });
    s.round = 0; s.log = []; s.lastGuard = null; s.winner = null; s.hunterPending = null; s.suspect = null;
    s.night = null; s.timer = null; s.vote = null;
    s.rv = { i: 0, shown: false }; s.phase = 'reveal';
    return true;
  }

  function act(a, el, s, api) {
    var i = el.dataset.i != null ? +el.dataset.i : null, n = s.night;
    switch (a) {
      case 'mode': s.cfg.mode = el.dataset.v; break;
      case 'wolves': s.cfg.wolves = Math.max(1, s.cfg.wolves + +el.dataset.d); s.cfg.wolvesAuto = false; break;
      case 'start': return deal(s);
      case 'rv-show': case 'rv-next':
        if (P.revealStep(a, s.rv, s.players.length) === 'done') s.phase = 'ready';
        break;
      case 'night': startNight(s); break;
      // moderator night
      case 'n-go': n.started = true; break;
      case 'n-wolf': n.wolf = i; break;
      case 'n-guard': n.guard = i; break;
      case 'n-seer': if (n.seer == null) { n.seer = i; log(s, 'Peramal menerawang ' + nameOf(s, i) + ': ' + (isWolf(s, i) ? 'serigala' : 'bukan serigala')); } break;
      case 'n-next':
        if (n.step < stepsOf(s).length - 1) n.step++; else resolveNight(s);
        break;
      // pass-the-phone night
      case 'np-show': n.pass.shown = true; break;
      case 'np-pick': {
        var me = n.order[n.pass.i], r = roleOf(s, me);
        if (r === 'serigala') n.votes[me] = i;
        else if (r === 'penjaga') n.guard = i;
        else if (r === 'peramal') { if (n.seer == null) n.seer = i; }
        else n.sus[me] = i;
        break;
      }
      case 'np-next': n.pass.shown = false; n.pass.i++; break;
      case 'np-dawn': resolveNight(s); break;
      case 'dawn-ok': afterDeaths(s, 'day'); break;
      case 'h-pick': s.hunter.pick = i; break;
      case 'h-shoot': case 'h-skip': {
        var h = s.hunter;
        if (a === 'h-shoot' && h.pick != null) { kill(s, h.pick, 'ditembak pemburu'); if (s.hunterPending === h.pick) s.hunterPending = null; }
        else log(s, 'Pemburu ga menembak');
        s.hunter = null;
        afterDeaths(s, h.next);
        break;
      }
      case 'v-pick': s.vote = s.vote === i ? null : i; break;
      case 'v-out': if (s.vote == null) return false; s.out = s.vote; s.vote = null; kill(s, s.out, 'keluar lewat voting'); s.timer = null; s.phase = 'out'; break;
      case 'v-none': s.out = null; s.vote = null; log(s, 'Voting: ga ada yang keluar'); s.timer = null; s.phase = 'out'; break;
      case 'out-ok': afterDeaths(s, 'night'); break;
      case 'again': {
        var fresh = Object.assign(init(), { cfg: s.cfg });
        if (deal(fresh) === false) fresh.phase = 'setup';
        api.replace(fresh); return true;
      }
      case 'quit':
        if (s.phase !== 'end' && !window.confirm('Akhiri game ini? Daftar pemain tetap tersimpan.')) return false;
        var c = s.cfg; api.replace(Object.assign(init(), { cfg: c })); return true;
      default: return false;
    }
    return true;
  }

  function set(key, val, s) {
    if (key === 'discuss') s.cfg.discuss = +val;
    else s.cfg[key] = !!val;
  }

  // "again"/"quit" swap the whole state via api.replace(); the shell then saves and re-renders.
  P.app(root, {
    key: 'werewolf', version: 1, init: init, render: render, act: act, set: set,
    playing: function (s) { return s.phase !== 'setup' && s.phase !== 'end'; }
  });
})();
