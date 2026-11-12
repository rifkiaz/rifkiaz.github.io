// Werewolf (/werewolf/): one phone runs the game, either held by a moderator
// or passed around every night. State is saved in localStorage after every
// tap, so a refresh or a locked screen picks up where the game left off.
(function () {
  'use strict';
  var P = window.Party, esc = P.esc, tr = P.tr;
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

  if (P.EN) {
    ROLES.serigala.name = 'Werewolf';
    ROLES.serigala.desc = 'Every night, together with the other werewolves, pick one person to eat. During the day, act like an ordinary villager and don\'t get caught.';
    ROLES.warga.name = 'Villager';
    ROLES.warga.desc = 'No special ability. Your only weapons are logic, instinct, and your vote. Find the werewolves!';
    ROLES.peramal.name = 'Seer';
    ROLES.peramal.desc = 'Every night, pick one person to look into: werewolf or not. Share what you learn carefully, the werewolves will come for you.';
    ROLES.penjaga.name = 'Guardian';
    ROLES.penjaga.desc = 'Every night, pick one person to protect from the werewolves. You can pick yourself, but not the same person two nights in a row.';
    ROLES.pemburu.name = 'Hunter';
    ROLES.pemburu.desc = 'If you die, whether eaten or voted out, you immediately get to shoot one person to take with you.';
    SCRIPT.serigala = 'Werewolves, wake up. Recognize each other, then point to one victim.';
    SCRIPT.penjaga = 'Guardian, wake up. Point to the person you want to protect tonight.';
    SCRIPT.peramal = 'Seer, wake up. Point to the person you want to look into.';
  }

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
    if (w) { s.winner = w; s.phase = 'end'; log(s, w === 'wolf' ? tr('Serigala menang.', 'Werewolves win.') : tr('Warga menang.', 'Villagers win.')); return; }
    if (next === 'night') startNight(s); else { s.phase = 'day'; s.timer = P.newTimer(s.cfg.discuss); }
  }

  function startNight(s) {
    s.round++;
    s.phase = 'night';
    s.timer = null;
    s.night = { step: 0, wolf: null, guard: null, seer: null, seen: false, votes: {}, sus: {}, pass: { i: 0, shown: false, done: false } };
    if (s.cfg.mode === 'pass') s.night.order = alive(s);
    log(s, tr('— Malam ', '— Night ') + s.round + ' —');
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
      if (victim === n.guard) { s.saved = true; log(s, tr('Serangan ke ', 'The attack on ') + nameOf(s, victim) + tr(' digagalkan penjaga', ' was blocked by the guardian')); }
      else { kill(s, victim, tr('dimangsa serigala', 'eaten by the werewolves')); s.dawn.push(victim); }
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
    if (n < 5) return tr('Minimal 5 pemain', 'At least 5 players') + (c.mode === 'mod' ? tr(' (moderator ga dihitung)', ' (the moderator doesn\'t count)') : '') + '.';
    if (c.wolves * 2 >= n) return tr('Serigalanya kebanyakan, harus kurang dari setengah pemain.', 'Too many werewolves, they must be fewer than half the players.');
    if (specials > n) return tr('Peran spesial lebih banyak dari pemain.', 'There are more special roles than players.');
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
    return P.rosterHTML(5, c.mode === 'mod' ? tr('Moderator ga ikut main, jadi jangan masukkan namanya.', 'The moderator doesn\'t play, so don\'t add their name.') : tr('Semua yang main, urut sesuai posisi duduk.', 'Everyone who plays, in seating order.')) +
      tr('<section class="pg-card"><h2 class="pg-h">cara main</h2>', '<section class="pg-card"><h2 class="pg-h">how to play</h2>') +
      tr('<div class="pg-seg" role="radiogroup" aria-label="Mode permainan">', '<div class="pg-seg" role="radiogroup" aria-label="Game mode">') +
      '<button type="button" role="radio" aria-checked="' + (c.mode === 'mod') + tr('" data-act="mode" data-v="mod"><b>ada moderator</b><small>Satu orang pegang HP dan memandu. HP ini jadi naskah dan catatannya.</small></button>', '" data-act="mode" data-v="mod"><b>with a moderator</b><small>One person holds the phone and runs the game. The phone is their script and notes.</small></button>') +
      '<button type="button" role="radio" aria-checked="' + (c.mode === 'pass') + tr('" data-act="mode" data-v="pass"><b>tanpa moderator</b><small>Semua ikut main. Tiap malam HP dioper keliling, semua orang menekan sesuatu supaya ga ketahuan siapa perannya apa.</small></button>', '" data-act="mode" data-v="pass"><b>no moderator</b><small>Everyone plays. Each night the phone goes around the circle and everyone taps something, so nobody can tell who has which role.</small></button>') +
      '</div></section>' +
      tr('<section class="pg-card"><h2 class="pg-h">peran</h2>', '<section class="pg-card"><h2 class="pg-h">roles</h2>') +
      tr('<div class="pg-stepper"><span><b>🐺 Serigala</b><small>', '<div class="pg-stepper"><span><b>🐺 Werewolf</b><small>') + ROLES.serigala.desc + '</small></span>' +
      tr('<div class="pg-num"><button type="button" class="pg-mini" data-act="wolves" data-d="-1" aria-label="Kurangi serigala"', '<div class="pg-num"><button type="button" class="pg-mini" data-act="wolves" data-d="-1" aria-label="Fewer werewolves"') + (c.wolves <= 1 ? ' disabled' : '') + '>−</button>' +
      '<b aria-live="polite">' + c.wolves + '</b>' +
      tr('<button type="button" class="pg-mini" data-act="wolves" data-d="1" aria-label="Tambah serigala"', '<button type="button" class="pg-mini" data-act="wolves" data-d="1" aria-label="More werewolves"') + (c.wolves >= maxW ? ' disabled' : '') + '>+</button></div></div>' +
      (n >= 5 && c.wolves !== suggestWolves(n) ? tr('<p class="pg-sub">Saran untuk ', '<p class="pg-sub">Suggested for ') + n + tr(' pemain: ', ' players: ') + suggestWolves(n) + tr(' serigala.</p>', ' werewolves.</p>') : '') +
      chk('peramal', 'peramal') + chk('penjaga', 'penjaga') + chk('pemburu', 'pemburu') +
      tr('<p class="pg-sub">Sisanya jadi Warga. ', '<p class="pg-sub">Everyone else is a Villager. ') + ROLES.warga.desc + '</p>' +
      (n ? '<div class="pg-tags">' + sum + '</div>' : '') +
      '</section>' +
      tr('<section class="pg-card"><h2 class="pg-h">aturan</h2>', '<section class="pg-card"><h2 class="pg-h">rules</h2>') +
      '<label class="pg-check"><input type="checkbox" data-set="open"' + (c.open ? ' checked' : '') + tr('><span><b>Buka peran yang mati</b><small>Saat seseorang keluar, perannya diumumkan. Matikan kalau mau lebih seru dan penuh tebakan.</small></span></label>', '><span><b>Reveal roles of the dead</b><small>When someone is out, their role is announced. Turn this off for more guessing and drama.</small></span></label>') +
      tr('<label class="pg-field"><span>Waktu diskusi siang</span><select data-set="discuss">', '<label class="pg-field"><span>Day discussion time</span><select data-set="discuss">') +
      [60, 120, 180, 240, 300, 420].map(function (t) { return '<option value="' + t + '"' + (c.discuss === t ? ' selected' : '') + '>' + (t / 60) + tr(' menit</option>', ' min</option>'); }).join('') +
      '</select></label></section>' +
      '<div class="pg-cta">' + (prob ? '<p class="pg-warn">' + prob + '</p>' : '') +
      '<button type="button" class="pg-primary pg-wide" data-act="start"' + (prob ? ' disabled' : '') + tr('>bagikan peran</button></div>', '>deal roles</button></div>') +
      rules();
  }

  function rules() {
    return tr('<details class="pg-help"><summary>aturan singkat</summary><ul>', '<details class="pg-help"><summary>quick rules</summary><ul>') +
      tr('<li><b>Tujuan.</b> Warga menang kalau semua serigala keluar. Serigala menang kalau jumlah mereka sudah sama dengan atau lebih banyak dari sisa pemain lain.</li>', '<li><b>Goal.</b> Villagers win when every werewolf is out. Werewolves win once they equal or outnumber everyone else still alive.</li>') +
      tr('<li><b>Malam.</b> Semua menutup mata. Serigala memilih korban, penjaga melindungi satu orang, peramal menerawang satu orang. Kalau korban serigala kebetulan dilindungi, malam itu ga ada yang mati.</li>', '<li><b>Night.</b> Everyone closes their eyes. The werewolves pick a victim, the guardian protects one person, the seer looks into one person. If the victim happens to be protected, nobody dies that night.</li>') +
      tr('<li><b>Siang.</b> Diumumkan siapa yang mati semalam. Semua berdiskusi, saling tuduh, lalu voting satu orang untuk dikeluarkan. Boleh juga sepakat ga mengeluarkan siapa pun.</li>', '<li><b>Day.</b> Whoever died overnight is announced. Everyone discusses, accuses each other, then votes one person out. You can also agree to vote nobody out.</li>') +
      tr('<li><b>Yang sudah mati</b> diam saja dan ga boleh kasih kode. Mereka boleh tetap menonton.</li>', '<li><b>The dead</b> stay quiet and can\'t give hints. They can keep watching.</li>') +
      tr('<li><b>Tanpa moderator.</b> Di malam hari HP dioper ke semua yang masih hidup. Peran tanpa aksi malam diminta menunjuk orang yang paling dicurigai, jadi lama memegang HP-nya kurang lebih sama. Kalau ada satu nama yang paling banyak dicurigai, paginya diumumkan.</li>', '<li><b>No moderator.</b> At night the phone goes to everyone still alive. Roles without a night action point to the person they suspect most, so everyone holds the phone for about the same time. If one name gets the most suspicion, it\'s announced in the morning.</li>') +
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
    return '<p class="pg-sub">' + esc(nameOf(s, i)) + tr(', peranmu</p>', ', your role</p>') +
      '<div class="pg-role pg-t-' + r.team + '"><span class="pg-rico" aria-hidden="true">' + r.ico + '</span><b>' + r.name + '</b></div>' +
      '<p class="pg-desc">' + r.desc + '</p>' +
      (isWolf(s, i) ? tr('<p class="pg-desc"><b>Teman serigalamu:</b> ', '<p class="pg-desc"><b>Your fellow werewolves:</b> ') + (mates.length ? mates.map(esc).join(', ') : tr('ga ada, kamu sendirian', 'none, you\'re on your own')) + '</p>' : '');
  }

  function viewReveal(s) {
    return P.revealHTML(s.players.map(function (p) { return p.name; }), P.range(s.players.length), s.rv, function (i) { return roleCard(s, i); },
      s.cfg.mode === 'mod' ? tr('tutup, kembalikan ke moderator', 'close, hand back to the moderator') : tr('tutup, taruh HP di tengah', 'close, put the phone in the middle'));
  }

  function stepsOf(s) {
    // Roles that exist in this game are always called, even when dead, so nobody can tell.
    return NIGHT_ORDER.filter(function (r) { return has(s, r); });
  }

  function viewNightMod(s) {
    var n = s.night, steps = stepsOf(s), role = steps[n.step], a = alive(s);
    var head = tr('<section class="pg-card" data-scrolltop><h2 class="pg-h">🌙 malam ', '<section class="pg-card" data-scrolltop><h2 class="pg-h">🌙 night ') + s.round + ' <span class="pg-chip">' + (n.step + 1) + '/' + steps.length + '</span></h2>';
    if (n.step === 0 && !n.started) {
      return head + tr('<p class="pg-script">"Malam tiba. Semua tutup mata dan tundukkan kepala."</p>', '<p class="pg-script">"Night falls. Everyone close your eyes and bow your heads."</p>') +
        tr('<button type="button" class="pg-primary pg-wide" data-act="n-go">semua sudah tidur</button></section>', '<button type="button" class="pg-primary pg-wide" data-act="n-go">everyone is asleep</button></section>') + modPanel(s);
    }
    var holders = s.players.map(function (p, i) { return p.alive && p.role === role ? i : -1; }).filter(function (i) { return i >= 0; });
    var who = holders.length ? holders.map(function (i) { return esc(nameOf(s, i)); }).join(', ') : null;
    var body = '<p class="pg-script">"' + SCRIPT[role] + '"</p>' +
      '<p class="pg-sub">' + ROLES[role].ico + ' ' + ROLES[role].name + ': ' + (who || tr('<b>sudah mati</b>', '<b>dead</b>')) + '</p>';
    var ready = false;
    if (!who) {
      body += tr('<p class="pg-note">Tetap bacakan naskahnya dan tunggu beberapa detik, supaya pemain lain ga tahu perannya sudah ga ada.</p>', '<p class="pg-note">Read the script anyway and wait a few seconds, so the others can\'t tell this role is gone.</p>');
      ready = true;
    } else if (role === 'serigala') {
      body += playerBtns(s, a, n.wolf, 'n-wolf', function (i) { return isWolf(s, i) ? tr('serigala', 'werewolf') : ''; });
      ready = n.wolf != null;
    } else if (role === 'penjaga') {
      body += playerBtns(s, a, n.guard, 'n-guard', function (i) { return i === s.lastGuard ? tr('dijaga semalam', 'guarded last night') : ''; });
      ready = n.guard != null;
    } else if (role === 'peramal') {
      body += playerBtns(s, a, n.seer, 'n-seer', function (i) { return roleOf(s, i) === 'peramal' ? tr('diri sendiri', 'yourself') : ''; });
      if (n.seer != null) {
        body += '<div class="pg-result ' + (isWolf(s, n.seer) ? 'is-wolf' : 'is-ok') + '">' + esc(nameOf(s, n.seer)) + ' ' +
          (isWolf(s, n.seer) ? tr('adalah <b>SERIGALA</b> 👎', 'is a <b>WEREWOLF</b> 👎') : tr('<b>bukan serigala</b> 👍', 'is <b>not a werewolf</b> 👍')) + '</div>' +
          tr('<p class="pg-note">Kasih isyarat jempol ke peramal: jempol bawah = serigala.</p>', '<p class="pg-note">Give the seer a thumbs signal: thumbs down = werewolf.</p>');
      }
      ready = n.seer != null;
    }
    var last = n.step === steps.length - 1;
    body += '<p class="pg-script pg-dim">"' + ROLES[role].name + tr(', tidur lagi."</p>', ', go back to sleep."</p>') +
      '<button type="button" class="pg-primary pg-wide" data-act="n-next"' + (ready ? '' : ' disabled') + '>' + (last ? tr('pagi tiba ☀️', 'morning comes ☀️') : tr('lanjut', 'continue')) + '</button>';
    return head + body + '</section>' + modPanel(s);
  }

  function viewNightPass(s) {
    var n = s.night, ps = n.pass, order = n.order;
    var head = tr('<section class="pg-card pg-pass" data-scrolltop><h2 class="pg-h">🌙 malam ', '<section class="pg-card pg-pass" data-scrolltop><h2 class="pg-h">🌙 night ') + s.round + ' <span class="pg-chip">' + Math.min(ps.i + 1, order.length) + '/' + order.length + '</span></h2>';
    if (ps.i >= order.length) {
      return head + tr('<p class="pg-big">Semua sudah</p><p class="pg-sub">Taruh HP di tengah dan semua buka mata.</p>', '<p class="pg-big">Everyone\'s done</p><p class="pg-sub">Put the phone in the middle and everyone open your eyes.</p>') +
        '<button type="button" class="pg-primary pg-wide" data-act="np-dawn">pagi tiba ☀️</button></section>';
    }
    var me = order[ps.i], nm = esc(nameOf(s, me));
    if (!ps.shown) {
      return head + tr('<p class="pg-sub">semua tutup mata, oper HP ke</p><p class="pg-big">', '<p class="pg-sub">everyone close your eyes, pass the phone to</p><p class="pg-big">') + nm + '</p>' +
        tr('<button type="button" class="pg-primary pg-wide" data-act="np-show">saya ', '<button type="button" class="pg-primary pg-wide" data-act="np-show">I\'m ') + nm + '</button></section>';
    }
    var role = roleOf(s, me), a = alive(s), body = '', ready;
    var others = a.filter(function (i) { return i !== me; });
    if (role === 'serigala') {
      var votes = Object.keys(n.votes).filter(function (k) { return +k !== me; }).map(function (k) {
        return esc(nameOf(s, +k)) + ' → ' + esc(nameOf(s, n.votes[k]));
      });
      body = tr('<p class="pg-desc">🐺 Kamu serigala. Pilih korban malam ini.</p>', '<p class="pg-desc">🐺 You\'re a werewolf. Pick tonight\'s victim.</p>') +
        (votes.length ? tr('<p class="pg-note">Pilihan serigala lain: ', '<p class="pg-note">Other werewolves picked: ') + votes.join(', ') + tr('. Korban = pilihan terbanyak.</p>', '. The victim = the most picked.</p>') : '') +
        playerBtns(s, a, n.votes[me], 'np-pick', function (i) { return isWolf(s, i) ? tr('serigala', 'werewolf') : ''; });
      ready = n.votes[me] != null;
    } else if (role === 'penjaga') {
      body = tr('<p class="pg-desc">🛡️ Kamu penjaga. Pilih satu orang untuk dilindungi.</p>', '<p class="pg-desc">🛡️ You\'re the guardian. Pick one person to protect.</p>') +
        playerBtns(s, a, n.guard, 'np-pick', function (i) { return i === s.lastGuard ? tr('dijaga semalam', 'guarded last night') : ''; });
      ready = n.guard != null;
    } else if (role === 'peramal') {
      body = tr('<p class="pg-desc">🔮 Kamu peramal. Pilih satu orang untuk diterawang.</p>', '<p class="pg-desc">🔮 You\'re the seer. Pick one person to look into.</p>') +
        (n.seer == null ? playerBtns(s, others, null, 'np-pick') :
          '<div class="pg-result ' + (isWolf(s, n.seer) ? 'is-wolf' : 'is-ok') + '">' + esc(nameOf(s, n.seer)) + ' ' +
          (isWolf(s, n.seer) ? tr('adalah <b>SERIGALA</b>', 'is a <b>WEREWOLF</b>') : tr('<b>bukan serigala</b>', 'is <b>not a werewolf</b>')) + '</div>');
      ready = n.seer != null;
    } else {
      body = '<p class="pg-desc">' + ROLES[role].ico + tr(' Kamu ', ' You\'re the ') + ROLES[role].name.toLowerCase() + tr(', ga ada aksi malam ini. Biar ga ketahuan, tunjuk orang yang paling kamu curigai.</p>', ', no action tonight. So nobody can tell, point to the person you suspect most.</p>') +
        playerBtns(s, others, n.sus[me], 'np-pick');
      ready = n.sus[me] != null;
    }
    var nextName = ps.i + 1 < order.length ? esc(nameOf(s, order[ps.i + 1])) : null;
    return head.replace('pg-pass"', 'pg-pass pg-secret"') + body +
      '<button type="button" class="pg-primary pg-wide" data-act="np-next"' + (ready ? '' : ' disabled') + '>' +
      (nextName ? tr('selesai, oper ke ', 'done, pass to ') + nextName : tr('selesai', 'done')) + '</button></section>';
  }

  function viewDawn(s) {
    var txt;
    if (s.dawn.length) {
      txt = s.dawn.map(function (i) {
        return '<p class="pg-big">💀 ' + esc(nameOf(s, i)) + tr('</p><p class="pg-sub">dimangsa serigala semalam', '</p><p class="pg-sub">eaten by the werewolves last night') +
          (s.cfg.open ? tr('. Perannya: <b>', '. Role: <b>') + ROLES[roleOf(s, i)].ico + ' ' + ROLES[roleOf(s, i)].name + '</b>' : '') + '</p>';
      }).join('');
    } else {
      txt = tr('<p class="pg-big">Semua selamat</p><p class="pg-sub">Semalam ga ada yang mati.', '<p class="pg-big">Everyone survived</p><p class="pg-sub">Nobody died last night.') + (s.cfg.mode === 'mod' && s.saved ? tr(' (Penjaga berhasil menyelamatkan korban, jangan bilang-bilang.)', ' (The guardian saved the victim, keep it to yourself.)') : '') + '</p>';
    }
    var sus = s.suspect && s.players[s.suspect.who].alive ? tr('<p class="pg-note">🤔 Paling dicurigai semalam: <b>', '<p class="pg-note">🤔 Most suspected last night: <b>') + esc(nameOf(s, s.suspect.who)) + tr('</b> (', '</b> (') + s.suspect.n + tr(' orang).</p>', ' people).</p>') : '';
    return tr('<section class="pg-card pg-center-card" data-scrolltop><h2 class="pg-h">☀️ pagi hari ke-', '<section class="pg-card pg-center-card" data-scrolltop><h2 class="pg-h">☀️ morning of day ') + s.round + '</h2>' +
      tr('<p class="pg-script">"Pagi tiba, semua buka mata."</p>', '<p class="pg-script">"Morning comes, everyone open your eyes."</p>') + txt + sus +
      '<button type="button" class="pg-primary pg-wide" data-act="dawn-ok">lanjut</button></section>' + modPanel(s);
  }

  function viewHunter(s) {
    var h = s.hunter, a = alive(s);
    return tr('<section class="pg-card" data-scrolltop><h2 class="pg-h">🏹 tembakan terakhir</h2>', '<section class="pg-card" data-scrolltop><h2 class="pg-h">🏹 last shot</h2>') +
      '<p class="pg-desc"><b>' + esc(nameOf(s, h.who)) + tr('</b> adalah pemburu! Sebelum pergi, pilih satu orang untuk ditembak.</p>', '</b> is the hunter! Before leaving, pick one person to shoot.</p>') +
      playerBtns(s, a, h.pick, 'h-pick') +
      '<div class="pg-row"><button type="button" class="pg-primary" data-act="h-shoot"' + (h.pick == null ? ' disabled' : '') + tr('>tembak</button>', '>shoot</button>') +
      tr('<button type="button" data-act="h-skip">ga nembak</button></div></section>', '<button type="button" data-act="h-skip">don\'t shoot</button></div></section>');
  }

  function viewDay(s) {
    var a = alive(s), sel = s.vote;
    return tr('<section class="pg-card" data-scrolltop><h2 class="pg-h">💬 siang hari ke-', '<section class="pg-card" data-scrolltop><h2 class="pg-h">💬 day ') + s.round + ' <span class="pg-chip">' + a.length + tr(' hidup</span></h2>', ' alive</span></h2>') +
      P.timerHTML(s.timer, tr('diskusi', 'discussion')) +
      tr('<p class="pg-sub">Diskusi, lalu voting. Tunjuk bareng-bareng di hitungan ketiga, atau voting satu per satu.</p>', '<p class="pg-sub">Discuss, then vote. Everyone points on the count of three, or vote one by one.</p>') +
      playerBtns(s, a, sel, 'v-pick') +
      '<div class="pg-row"><button type="button" class="pg-primary" data-act="v-out"' + (sel == null ? ' disabled' : '') + '>' +
      (sel == null ? tr('keluarkan', 'vote out') : tr('keluarkan ', 'vote out ') + esc(nameOf(s, sel))) + '</button>' +
      tr('<button type="button" data-act="v-none">ga ada yang keluar</button></div></section>', '<button type="button" data-act="v-none">nobody goes out</button></div></section>') + modPanel(s);
  }

  function viewOut(s) {
    var i = s.out;
    return tr('<section class="pg-card pg-center-card" data-scrolltop><h2 class="pg-h">⚖️ hasil voting</h2>', '<section class="pg-card pg-center-card" data-scrolltop><h2 class="pg-h">⚖️ vote result</h2>') +
      (i == null ? tr('<p class="pg-big">Ga ada yang keluar</p><p class="pg-sub">Warga ga sepakat. Malam pun tiba.</p>', '<p class="pg-big">Nobody goes out</p><p class="pg-sub">The village couldn\'t agree. Night falls.</p>') :
        '<p class="pg-big">👋 ' + esc(nameOf(s, i)) + tr('</p><p class="pg-sub">keluar dari desa', '</p><p class="pg-sub">leaves the village') +
        (s.cfg.open ? tr('. Perannya: <b>', '. Role: <b>') + ROLES[roleOf(s, i)].ico + ' ' + ROLES[roleOf(s, i)].name + '</b>' : '') + '</p>') +
      '<button type="button" class="pg-primary pg-wide" data-act="out-ok">lanjut</button></section>' + modPanel(s);
  }

  function viewEnd(s) {
    var wolf = s.winner === 'wolf';
    var rows = s.players.map(function (p) {
      var r = ROLES[p.role];
      return '<li class="' + (p.alive ? '' : 'is-dead') + '"><span>' + r.ico + '</span><b>' + esc(p.name) + '</b><span class="pg-tag pg-t-' + r.team + '">' + r.name + '</span>' +
        '<small>' + (p.alive ? tr('hidup', 'alive') : tr('mati', 'dead')) + '</small></li>';
    }).join('');
    return '<section class="pg-card pg-center-card" data-scrolltop><p class="pg-win ' + (wolf ? 'is-wolf' : 'is-ok') + '">' + (wolf ? tr('🐺 Serigala menang!', '🐺 Werewolves win!') : tr('🎉 Warga menang!', '🎉 Villagers win!')) + '</p>' +
      '<p class="pg-sub">' + (wolf ? tr('Desa jatuh ke tangan serigala.', 'The village falls to the werewolves.') : tr('Semua serigala sudah keluar dari desa.', 'Every werewolf is out of the village.')) + '</p>' +
      '<ul class="pg-list">' + rows + '</ul>' +
      tr('<div class="pg-row pg-center"><button type="button" class="pg-primary" data-act="again">main lagi</button><button type="button" data-act="quit">ubah pengaturan</button></div></section>', '<div class="pg-row pg-center"><button type="button" class="pg-primary" data-act="again">play again</button><button type="button" data-act="quit">change settings</button></div></section>') +
      logView(s, true);
  }

  function modPanel(s) {
    if (s.cfg.mode !== 'mod') return '';
    var rows = s.players.map(function (p) {
      var r = ROLES[p.role];
      return '<li class="' + (p.alive ? '' : 'is-dead') + '"><span>' + r.ico + '</span><b>' + esc(p.name) + '</b><span class="pg-tag pg-t-' + r.team + '">' + r.name + '</span></li>';
    }).join('');
    return tr('<details class="pg-help"><summary>contekan moderator (rahasia)</summary><ul class="pg-list">', '<details class="pg-help"><summary>moderator cheat sheet (secret)</summary><ul class="pg-list">') + rows + '</ul></details>' + logView(s);
  }

  function logView(s, open) {
    if (!s.log.length) return '';
    return '<details class="pg-help"' + (open ? ' open' : '') + tr('><summary>catatan permainan</summary><ol class="pg-log">', '><summary>game log</summary><ol class="pg-log">') +
      s.log.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ol></details>';
  }

  function topbar(s) {
    if (s.phase === 'setup') return '';
    return '<div class="pg-top"><span class="pg-chip">' + (s.cfg.mode === 'mod' ? tr('ada moderator', 'with moderator') : tr('tanpa moderator', 'no moderator')) + '</span>' +
      '<span class="pg-chip">' + s.players.length + tr(' pemain</span>', ' players</span>') +
      tr('<button type="button" class="pg-mini pg-push" data-act="quit">akhiri game</button></div>', '<button type="button" class="pg-mini pg-push" data-act="quit">end game</button></div>');
  }

  function render(s) {
    var v;
    switch (s.phase) {
      case 'reveal': v = viewReveal(s); break;
      case 'ready': v = tr('<section class="pg-card pg-center-card" data-scrolltop><p class="pg-big">Semua sudah tahu perannya</p>', '<section class="pg-card pg-center-card" data-scrolltop><p class="pg-big">Everyone knows their role</p>') +
        '<p class="pg-sub">' + (s.cfg.mode === 'mod' ? tr('Moderator, mulai malam pertama.', 'Moderator, start the first night.') : tr('Taruh HP di tengah. Malam pertama dimulai, HP akan dioper keliling.', 'Put the phone in the middle. The first night begins and the phone will go around.')) + '</p>' +
        tr('<button type="button" class="pg-primary pg-wide" data-act="night">mulai malam pertama 🌙</button></section>', '<button type="button" class="pg-primary pg-wide" data-act="night">start the first night 🌙</button></section>') + modPanel(s); break;
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
      case 'n-seer': if (n.seer == null) { n.seer = i; log(s, tr('Peramal menerawang ', 'The seer looked into ') + nameOf(s, i) + ': ' + (isWolf(s, i) ? tr('serigala', 'werewolf') : tr('bukan serigala', 'not a werewolf'))); } break;
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
        if (a === 'h-shoot' && h.pick != null) { kill(s, h.pick, tr('ditembak pemburu', 'shot by the hunter')); if (s.hunterPending === h.pick) s.hunterPending = null; }
        else log(s, tr('Pemburu ga menembak', 'The hunter didn\'t shoot'));
        s.hunter = null;
        afterDeaths(s, h.next);
        break;
      }
      case 'v-pick': s.vote = s.vote === i ? null : i; break;
      case 'v-out': if (s.vote == null) return false; s.out = s.vote; s.vote = null; kill(s, s.out, tr('keluar lewat voting', 'voted out')); s.timer = null; s.phase = 'out'; break;
      case 'v-none': s.out = null; s.vote = null; log(s, tr('Voting: ga ada yang keluar', 'Vote: nobody went out')); s.timer = null; s.phase = 'out'; break;
      case 'out-ok': afterDeaths(s, 'night'); break;
      case 'again': {
        var fresh = Object.assign(init(), { cfg: s.cfg });
        if (deal(fresh) === false) fresh.phase = 'setup';
        api.replace(fresh); return true;
      }
      case 'quit':
        if (s.phase !== 'end' && !window.confirm(tr('Akhiri game ini? Daftar pemain tetap tersimpan.', 'End this game? The player list stays saved.'))) return false;
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
