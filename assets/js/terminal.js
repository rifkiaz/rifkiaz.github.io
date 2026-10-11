(function () {
  'use strict';

  var dataEl = document.getElementById('term-data');
  var screen = document.getElementById('term-screen');
  var out = document.getElementById('term-out');
  var form = document.getElementById('term-form');
  var input = document.getElementById('term-input');
  var ps1El = document.getElementById('term-ps1');
  if (!dataEl || !out || !form || !input) return;

  var D = JSON.parse(dataEl.textContent || '{}');
  var USER = 'rifki';
  var HOST = 'devops';

  // ---------- virtual filesystem ----------
  function file(meta) { return { type: 'file', meta: meta }; }
  function dir(children) { return { type: 'dir', children: children }; }

  function entries(list) {
    var c = {};
    (list || []).forEach(function (p) { c[p.name + '.md'] = file(p); });
    return c;
  }

  var stackDir = {};
  (D.stack || []).forEach(function (s) { stackDir[s] = file({ title: s, stack: true }); });

  var root = { posts: dir(entries(D.posts)), cheatsheet: dir(entries(D.cheatsheet)), stack: dir(stackDir) };
  (D.pages || []).forEach(function (p) { root[p.name + '.md'] = file(p); });
  root['README.txt'] = file({ readme: true });
  root['.rahasia'] = file({ secret: true });
  var FS = dir(root);

  var cwd = [];

  function pathStr(parts) { return '~' + (parts.length ? '/' + parts.join('/') : ''); }

  function resolve(path) {
    if (path === undefined || path === '' || path === '~') return { node: FS, parts: [] };
    var parts = path.charAt(0) === '/' || path.charAt(0) === '~' ? [] : cwd.slice();
    path.replace(/^~\/?/, '').split('/').forEach(function (seg) {
      if (!seg || seg === '.') return;
      if (seg === '..') parts.pop(); else parts.push(seg);
    });
    var node = FS;
    for (var i = 0; i < parts.length; i++) {
      if (!node || node.type !== 'dir') return null;
      var kids = node.children;
      var key = kids[parts[i]] ? parts[i] : kids[parts[i] + '.md'] ? parts[i] + '.md' : null;
      if (!key) {
        // case-insensitive fallback, handy on phones that auto-capitalize
        key = Object.keys(kids).filter(function (k) {
          var l = k.toLowerCase(), t = parts[i].toLowerCase();
          return l === t || l === t + '.md';
        })[0];
      }
      if (!key) return null;
      parts[i] = key;
      node = kids[key];
    }
    return { node: node, parts: parts };
  }

  // ---------- output helpers ----------
  function line(text, cls) {
    var el = document.createElement('div');
    el.className = 'term-row' + (cls ? ' ' + cls : '');
    if (text instanceof Node) el.appendChild(text); else el.textContent = text === undefined ? '' : text;
    out.appendChild(el);
    return el;
  }
  function span(text, cls) {
    var s = document.createElement('span');
    if (cls) s.className = cls;
    s.textContent = text;
    return s;
  }
  function link(text, href, external) {
    var a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    if (external) { a.target = '_blank'; a.rel = 'noopener'; }
    return a;
  }
  function frag() {
    var f = document.createDocumentFragment();
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      f.appendChild(typeof a === 'string' ? document.createTextNode(a) : a);
    }
    return f;
  }
  function err(text) { line(text, 'term-err'); }
  function scroll() { screen.scrollTop = screen.scrollHeight; }

  function ps1() { return USER + '@' + HOST + ':' + pathStr(cwd) + '$'; }
  function setPrompt(text) { ps1El.textContent = text; }

  function echoCommand(cmd, prompt) {
    line(frag(span(prompt, 'term-ps1'), ' ' + cmd), 'term-echo');
  }

  // ---------- games ----------
  var PORTS = [
    ['SSH', 22], ['HTTP', 80], ['HTTPS', 443], ['DNS', 53], ['SMTP', 25], ['FTP', 21],
    ['MySQL / MariaDB', 3306], ['PostgreSQL', 5432], ['MongoDB', 27017], ['Redis', 6379],
    ['Elasticsearch', 9200], ['Prometheus', 9090], ['node_exporter', 9100], ['Grafana', 3000],
    ['Alertmanager', 9093], ['Vault', 8200], ['n8n', 5678], ['RDP', 3389], ['Kubernetes API', 6443],
    ['etcd', 2379], ['Telnet', 23], ['NTP', 123], ['LDAP', 389], ['RabbitMQ (AMQP)', 5672]
  ];
  var HTTP_CODES = [
    ['OK', 200], ['Created', 201], ['No Content', 204], ['Moved Permanently', 301], ['Found (redirect sementara)', 302],
    ['Not Modified', 304], ['Bad Request', 400], ['Unauthorized', 401], ['Forbidden', 403], ['Not Found', 404],
    ['Method Not Allowed', 405], ['Conflict', 409], ['Too Many Requests', 429], ['Internal Server Error', 500],
    ["Bad Gateway (nginx-nya nyerah)", 502], ['Service Unavailable', 503], ['Gateway Timeout', 504], ["I'm a teapot ☕", 418]
  ];
  // [deskripsi, jawaban yang diterima...]
  var CMDS = [
    ['Lihat isi folder', 'ls', 'dir', 'll'],
    ['Pindah ke folder lain', 'cd'],
    ['Tampilkan folder tempat kamu berada sekarang', 'pwd'],
    ['Lihat proses yang sedang jalan', 'ps', 'top', 'htop', 'btop'],
    ['Cek sisa ruang disk per partisi', 'df'],
    ['Cek ukuran sebuah folder', 'du'],
    ['Cek pemakaian RAM', 'free', 'top', 'htop'],
    ['Cari teks di dalam file', 'grep', 'rg', 'ag'],
    ['Ubah permission file', 'chmod'],
    ['Ubah pemilik file', 'chown'],
    ['Hentikan proses berdasarkan PID', 'kill'],
    ['Pantau isi log secara live', 'tail', 'journalctl'],
    ['Restart service di systemd', 'systemctl'],
    ['Lihat log dari systemd', 'journalctl'],
    ['Salin file ke server lain lewat SSH', 'scp', 'rsync', 'sftp'],
    ['Cek koneksi ke host dengan paket ICMP', 'ping'],
    ['Lihat port yang sedang listen', 'ss', 'netstat', 'lsof'],
    ['Cek record DNS sebuah domain', 'dig', 'nslookup', 'host', 'drill'],
    ['Ekstrak file .tar.gz', 'tar'],
    ['Jalankan perintah sebagai root', 'sudo', 'su', 'doas'],
    ['Install paket di openSUSE', 'zypper'],
    ['Lihat container Docker yang jalan', 'docker', 'podman'],
    ['Lihat riwayat commit git', 'git'],
    ['Berapa lama server sudah menyala', 'uptime'],
    ['Buat folder baru', 'mkdir'],
    ['Cari file berdasarkan nama', 'find', 'locate', 'fd']
  ];
  var TYPING = [
    'sudo zypper dup',
    'git commit -m "fix typo"',
    'kubectl get pods -A',
    'docker compose up -d',
    'ansible-playbook -i inventory site.yml',
    'tail -f /var/log/syslog',
    'systemctl restart nginx',
    'ssh -i ~/.ssh/id_ed25519 rifki@server',
    'grep -rn "TODO" .',
    'tar -czvf backup.tar.gz /etc',
    'chmod 600 ~/.ssh/config',
    'journalctl -u sshd --since today'
  ];

  var GAMES = {
    port: { title: 'Tebak Port', desc: 'tebak port default service', start: function () { return quizNumber('Tebak Port', 'port?>', PORTS, 'Port default', 'jaringan'); } },
    http: { title: 'Tebak Kode HTTP', desc: 'tebak status code HTTP', start: function () { return quizNumber('Tebak Kode HTTP', 'http?>', HTTP_CODES, 'Kode HTTP untuk', null); } },
    cmd: { title: 'Tebak Perintah', desc: 'tebak perintah Linux dari deskripsinya', start: startCmd },
    angka: { title: 'Tebak Angka', desc: 'tebak angka 1 sampai 100', start: startAngka },
    ketik: { title: 'Adu Cepat Ngetik', desc: 'ketik perintah secepat mungkin', start: startKetik }
  };

  var game = null;
  var best = {};
  try { best = JSON.parse(localStorage.getItem('rifki-sh-best') || '{}') || {}; } catch (e) { best = {}; }
  function saveBest(key, value, lowerIsBetter) {
    var old = best[key];
    var better = old === undefined || (lowerIsBetter ? value < old : value > old);
    if (better) {
      best[key] = value;
      try { localStorage.setItem('rifki-sh-best', JSON.stringify(best)); } catch (e) { /* private mode */ }
    }
    return better && old !== undefined;
  }

  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function stopGame(msg) {
    if (msg) line(msg, 'term-dim');
    game = null;
    setPrompt(ps1());
  }

  function cmdButton(cmd) {
    var s = span(cmd, 'term-hl term-click');
    s.dataset.cmd = cmd;
    return s;
  }

  function gameMenu() {
    line('🎮 Pilih game:');
    Object.keys(GAMES).forEach(function (k) {
      line(frag(cmdButton('game ' + k), ' '.repeat(12 - ('game ' + k).length) + GAMES[k].desc));
    });
    line('Di HP tinggal tap nama game-nya. Ketik "q" kapan saja buat keluar dari game.', 'term-dim');
  }

  function scoreLine(s, n, key) {
    var rec = saveBest(key, s, false);
    var verdict = s === n ? 'Sempurna! Kamu layak pegang pager on-call. 🏆'
      : s >= n * 0.6 ? 'Mantap, dikit lagi jadi kamus berjalan.'
      : s >= 1 ? 'Lumayan. Coba lagi biar makin hafal.'
      : 'Nggak apa-apa, semua orang pernah lupa. Coba lagi ya.';
    line(frag('Skor kamu: ', span(s + '/' + n, 'term-hl'), '. ' + verdict + (rec ? ' Rekor baru! 🎉' : '')));
    if (best[key] !== undefined) line('Rekor terbaik kamu: ' + best[key] + '/' + n, 'term-dim');
  }

  // quiz with numeric answers: 5 questions, 2 tries, higher/lower hint
  function quizNumber(title, prompt, bank, label, sheet) {
    var qs = shuffle(bank).slice(0, 5);
    var i = 0, score = 0, tries = 0;
    function ask() {
      line(frag(span('[' + (i + 1) + '/' + qs.length + '] ', 'term-dim'), label + ' ', span(qs[i][0], 'term-hl'), ' berapa?'));
    }
    function next() {
      i++; tries = 0;
      if (i < qs.length) return ask();
      scoreLine(score, qs.length, prompt.replace('?>', ''));
      if (score < 3 && sheet) line('Contekan: cat cheatsheet/' + sheet, 'term-dim');
      stopGame();
    }
    line(frag(span('🎮 ' + title, 'term-hl'), ': 5 soal, tiap soal dapat 2 kesempatan.'));
    line('Ketik angkanya, "skip" untuk lewati, atau "q" untuk keluar.', 'term-dim');
    ask();
    return {
      prompt: prompt,
      input: function (v) {
        var a = qs[i][1];
        if (v === 'skip') { line(frag('Jawabannya ', span(String(a), 'term-hl'), '.'), 'term-dim'); return next(); }
        if (!/^\d+$/.test(v)) return err('Masukkan angka ya, atau "skip" / "q".');
        var n = parseInt(v, 10);
        if (n === a) { score++; line('✔ Benar!', 'term-ok'); return next(); }
        if (tries++ === 0) return err('✘ Belum tepat. Petunjuk: ' + (n < a ? 'lebih besar' : 'lebih kecil') + '. Sekali lagi.');
        err('✘ Salah. Jawabannya ' + a + '.');
        next();
      }
    };
  }

  function startCmd() {
    var qs = shuffle(CMDS).slice(0, 5);
    var i = 0, score = 0, tries = 0;
    function ask() {
      line(frag(span('[' + (i + 1) + '/' + qs.length + '] ', 'term-dim'), span(qs[i][0], 'term-hl'), '. Perintahnya apa?'));
    }
    function next() {
      i++; tries = 0;
      if (i < qs.length) return ask();
      scoreLine(score, qs.length, 'cmd');
      if (score < 3) line('Contekan: cat cheatsheet/perintah-dasar', 'term-dim');
      stopGame();
    }
    line(frag(span('🎮 Tebak Perintah', 'term-hl'), ': 5 soal, cukup ketik nama perintahnya.'));
    line('"skip" untuk lewati, "q" untuk keluar.', 'term-dim');
    ask();
    return {
      prompt: 'cmd?>',
      input: function (v) {
        var ans = qs[i].slice(1);
        if (v === 'skip') { line(frag('Jawabannya ', span(ans.join(' / '), 'term-hl'), '.'), 'term-dim'); return next(); }
        var word = v.replace(/^sudo\s+(?=\S)/, '').split(/\s+/)[0];
        if (ans.indexOf(word) !== -1) {
          score++;
          line('✔ Benar!' + (ans.length > 1 ? ' Bisa juga: ' + ans.filter(function (x) { return x !== word; }).join(', ') : ''), 'term-ok');
          return next();
        }
        if (tries++ === 0) return err('✘ Belum tepat. Petunjuk: diawali huruf "' + ans[0].charAt(0) + '" dan panjangnya ' + ans[0].length + ' huruf.');
        err('✘ Salah. Jawabannya ' + ans.join(' / ') + '.');
        next();
      }
    };
  }

  function startAngka() {
    var target = 1 + Math.floor(Math.random() * 100);
    var tries = 0, max = 7;
    line(frag(span('🎮 Tebak Angka', 'term-hl'), ': saya pilih angka 1 sampai 100. Kamu punya ' + max + ' kesempatan.'));
    line('Ketik "q" untuk keluar.', 'term-dim');
    return {
      prompt: 'angka?>',
      input: function (v) {
        if (!/^\d+$/.test(v)) return err('Masukkan angka 1 sampai 100 ya.');
        var n = parseInt(v, 10);
        tries++;
        if (n === target) {
          var rec = saveBest('angka', tries, true);
          line('✔ Tepat! Angkanya ' + target + ', ketemu dalam ' + tries + ' tebakan.' + (rec ? ' Rekor baru! 🎉' : ''), 'term-ok');
          line('Rekor terbaik kamu: ' + best.angka + ' tebakan. Main lagi: game angka', 'term-dim');
          return stopGame();
        }
        if (tries >= max) { err('✘ Kesempatan habis. Angkanya ' + target + '. Binary search bisa bantu lho. 😉'); return stopGame(); }
        err('✘ ' + (n < target ? 'Terlalu kecil' : 'Terlalu besar') + '. Sisa ' + (max - tries) + ' kesempatan.');
      }
    };
  }

  function startKetik() {
    var qs = shuffle(TYPING).slice(0, 3);
    var i = 0, t0 = 0, total = 0, chars = 0, miss = 0;
    function ask() {
      line(frag(span('[' + (i + 1) + '/' + qs.length + '] ', 'term-dim'), 'Ketik: ', span(qs[i], 'term-hl')));
      t0 = Date.now();
    }
    line(frag(span('🎮 Adu Cepat Ngetik', 'term-hl'), ': ketik 3 perintah persis sama, secepat mungkin.'));
    line('Waktu mulai jalan begitu perintahnya muncul. "q" untuk keluar.', 'term-dim');
    ask();
    return {
      prompt: 'ketik?>',
      raw: true,
      input: function (v) {
        if (v.trim() !== qs[i]) { miss++; return err('✘ Belum sama persis, coba lagi.'); }
        var dt = (Date.now() - t0) / 1000;
        total += dt; chars += qs[i].length;
        line('✔ ' + dt.toFixed(1) + ' detik', 'term-ok');
        if (++i < qs.length) return ask();
        var cpm = Math.round(chars / total * 60);
        var rec = saveBest('ketik', Math.round(total * 10) / 10, true);
        line(frag('Total ', span(total.toFixed(1) + ' detik', 'term-hl'), ', sekitar ' + cpm + ' karakter/menit' + (miss ? ', salah ' + miss + 'x' : ', tanpa salah') + '.' + (rec ? ' Rekor baru! 🎉' : '')));
        line(cpm > 250 ? 'Jari kamu jago banget. Pasti biasa hidup di terminal. ⚡' : cpm > 150 ? 'Cepat juga! Tinggal latihan dikit lagi.' : 'Santai aja, yang penting perintahnya benar. 😄');
        line('Rekor terbaik kamu: ' + best.ketik + ' detik', 'term-dim');
        stopGame();
      }
    };
  }

  function gameStart(args) {
    var k = (args[0] || '').toLowerCase();
    if (!k) return gameMenu();
    if (k === 'random' || k === 'acak') { var ks = Object.keys(GAMES); k = ks[Math.floor(Math.random() * ks.length)]; }
    if (!GAMES[k]) { err('game: "' + k + '" nggak ada.'); return gameMenu(); }
    game = GAMES[k].start();
    setPrompt(game.prompt);
  }

  function gameInput(raw) {
    var v = raw.trim().toLowerCase();
    if (v === 'q' || v === 'quit' || v === 'exit') return stopGame('Game dihentikan.');
    if (!v) return;
    game.input(game.raw ? raw : v);
  }

  // ---------- commands ----------
  var FORTUNES = [
    'It works on my machine. ¯\\_(ツ)_/¯',
    'Selalu ada satu server yang nggak masuk inventory Ansible.',
    'Backup yang belum pernah di-restore itu cuma harapan.',
    'Deploy hari Jumat sore: berani tapi nggak bijak.',
    'Kalau alert bunyi tiap jam, lama-lama nggak ada yang dengar.',
    'DNS. Selalu DNS.',
    'Idempoten itu bukan mantra, tapi kebiasaan.',
    'chmod 777 bukan solusi, itu pengakuan.'
  ];

  var COMMANDS = {
    help: {
      desc: 'daftar perintah',
      run: function () {
        line('Perintah yang tersedia:');
        Object.keys(COMMANDS).forEach(function (k) {
          if (COMMANDS[k].hidden) return;
          line(frag(span(k.padEnd(10), 'term-hl'), COMMANDS[k].desc));
        });
        line('Tips: Tab untuk melengkapi, ↑/↓ untuk riwayat. Ada beberapa perintah rahasia juga. 😉', 'term-dim');
      }
    },
    whoami: {
      desc: 'siapa saya',
      run: function () {
        line(span(D.name || USER, 'term-hl'));
        if (D.roles && D.roles.length) line(D.roles.join(' · '), 'term-dim');
        line('Tulisan lengkapnya: cat tentang', 'term-dim');
      }
    },
    ls: {
      desc: 'lihat isi folder (ls -a juga bisa)',
      run: function (args) {
        var all = args.indexOf('-a') !== -1 || args.indexOf('-la') !== -1 || args.indexOf('-al') !== -1;
        var target = args.filter(function (a) { return a.charAt(0) !== '-'; })[0];
        var r = resolve(target);
        if (!r) return err('ls: ' + target + ': folder nggak ditemukan');
        if (r.node.type === 'file') return line(target);
        var row = document.createElement('div');
        row.className = 'term-ls-out';
        Object.keys(r.node.children).forEach(function (k) {
          if (k.charAt(0) === '.' && !all) return;
          var n = r.node.children[k];
          var s = span(n.type === 'dir' ? k + '/' : k, n.type === 'dir' ? 'term-dir' : n.meta.stack ? 'term-exec' : '');
          s.dataset.path = r.parts.concat(k).join('/');
          s.className += ' term-click';
          row.appendChild(s);
        });
        line(row);
      }
    },
    cd: {
      desc: 'pindah folder',
      run: function (args) {
        var r = resolve(args[0]);
        if (!r) return err('cd: ' + args[0] + ': folder nggak ditemukan');
        if (r.node.type !== 'dir') return err('cd: ' + args[0] + ': bukan folder. Coba: cat ' + args[0]);
        cwd = r.parts;
      }
    },
    pwd: { desc: 'folder sekarang', run: function () { line('/home/' + USER + (cwd.length ? '/' + cwd.join('/') : '')); } },
    cat: {
      desc: 'baca ringkasan file',
      run: function (args) {
        if (!args.length) return err('cat: mau baca file apa? Contoh: cat tentang');
        var r = resolve(args[0]);
        if (!r) return err('cat: ' + args[0] + ': file nggak ditemukan');
        if (r.node.type === 'dir') return err('cat: ' + args[0] + ': itu folder. Coba: ls ' + args[0]);
        var m = r.node.meta;
        if (m.readme) {
          line('Halo! Ini terminal mini di web saya. Semua tulisan ada di posts/, contekan di cheatsheet/.');
          line('Pakai "cat" untuk baca ringkasan dan "open" untuk buka halamannya.');
          return;
        }
        if (m.secret) {
          line('🔐 Isinya cuma satu baris:');
          line('"Jangan pernah commit file .env ke git." Itu saja rahasianya.', 'term-hl');
          return;
        }
        if (m.stack) return line(m.title + ': salah satu tool yang saya pakai sehari-hari.');
        line(span(m.title, 'term-hl'));
        if (m.date && m.date.indexOf('0001') !== 0) line(m.date, 'term-dim');
        if (m.summary) line(m.summary);
        line(frag('→ ', link('baca selengkapnya', m.url)), 'term-dim');
      }
    },
    open: {
      desc: 'buka halaman tulisan',
      run: function (args) {
        if (!args.length) return err('open: mau buka apa? Contoh: open tentang');
        var r = resolve(args[0]);
        if (!r || r.node.type !== 'file' || !r.node.meta.url) return err('open: ' + args[0] + ': nggak bisa dibuka');
        line('Membuka ' + r.node.meta.title + '…', 'term-dim');
        setTimeout(function () { window.location.href = r.node.meta.url; }, 300);
      }
    },
    tree: {
      desc: 'lihat struktur folder',
      run: function () {
        line('~');
        var keys = Object.keys(FS.children).filter(function (k) { return k.charAt(0) !== '.'; });
        keys.forEach(function (k, i) {
          var last = i === keys.length - 1;
          var n = FS.children[k];
          line((last ? '└── ' : '├── ') + k + (n.type === 'dir' ? '/' : ''), n.type === 'dir' ? 'term-dir' : '');
          if (n.type === 'dir') {
            var kids = Object.keys(n.children);
            kids.forEach(function (c, j) {
              line((last ? '    ' : '│   ') + (j === kids.length - 1 ? '└── ' : '├── ') + c);
            });
          }
        });
      }
    },
    neofetch: {
      desc: 'info "sistem"',
      run: function () {
        var art = [
          '    .--.    ',
          '   |o_o |   ',
          '   |:_/ |   ',
          '  //   \\ \\  ',
          ' (|     | ) ',
          "/'\\_   _/`\\ ",
          '\\___)=(___/ '
        ];
        var info = [
          [USER + '@' + HOST, ''],
          ['-----------', ''],
          ['OS', 'openSUSE Tumbleweed (versi web)'],
          ['Host', 'GitHub Pages'],
          ['Shell', 'rifki-sh 1.0'],
          ['Role', (D.roles || [])[0] || 'DevOps'],
          ['Stack', (D.stack || []).slice(0, 5).join(', ')],
          ['Uptime', uptime()],
          ['Kopi', 'secukupnya ☕']
        ];
        var pre = document.createElement('div');
        pre.className = 'term-neofetch';
        var a = span(art.join('\n'), 'term-art');
        var i = document.createElement('div');
        info.forEach(function (r) {
          var d = document.createElement('div');
          if (r[1]) d.appendChild(frag(span(r[0], 'term-hl'), ': ' + r[1]));
          else d.appendChild(span(r[0], r[0].charAt(0) === '-' ? 'term-dim' : 'term-hl'));
          i.appendChild(d);
        });
        pre.appendChild(a);
        pre.appendChild(i);
        line(pre);
      }
    },
    game: { desc: 'main game 🎮 (port, http, cmd, angka, ketik)', run: function (args) { gameStart(args); } },
    fortune: { desc: 'kutipan acak', run: function () { line(FORTUNES[Math.floor(Math.random() * FORTUNES.length)]); } },
    social: {
      desc: 'akun media sosial',
      run: function () {
        (D.socials || []).forEach(function (s) {
          var ext = /^https?:/.test(s.url);
          line(frag(span(s.name.padEnd(10), 'term-hl'), link(s.url.replace(/^https?:\/\//, ''), s.url, ext)));
        });
      }
    },
    theme: {
      desc: 'ganti mode terang/gelap',
      run: function () {
        var t = document.getElementById('theme-toggle');
        if (!t) return err('theme: tombol tema nggak tersedia');
        t.click();
        line('Mode sekarang: ' + (document.documentElement.dataset.theme === 'dark' ? 'gelap 🌙' : 'terang ☀️'));
      }
    },
    history: { desc: 'riwayat perintah', run: function () { hist.forEach(function (h, i) { line(String(i + 1).padStart(4) + '  ' + h); }); } },
    echo: { desc: 'cetak teks', run: function (args) { line(args.join(' ').replace(/\$USER/g, USER).replace(/\$ROLE/g, (D.roles || [])[0] || '')); } },
    date: { desc: 'tanggal dan jam', run: function () { line(new Date().toString()); } },
    clear: { desc: 'bersihkan layar', run: function () { out.textContent = ''; } },
    exit: {
      desc: 'kembali ke beranda',
      run: function () {
        line('logout', 'term-dim');
        setTimeout(function () { window.location.href = D.home || '/'; }, 400);
      }
    },

    // ---------- easter eggs ----------
    sudo: {
      hidden: true,
      run: function (args) {
        if (args.join(' ') === 'make me a sandwich') return line('Oke. 🥪');
        err(USER + ' is not in the sudoers file. This incident will be reported. 🚨');
      }
    },
    rm: {
      hidden: true,
      run: function (args) {
        if (/-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r/.test(args.join(' ')) && /(^|\s)(\/|~|\*|\/\*)(\s|$)/.test(args.join(' '))) {
          err('Wah, jangan dong. 😱 Untung ini cuma terminal mainan.');
          screen.classList.add('term-shake');
          setTimeout(function () { screen.classList.remove('term-shake'); }, 500);
          return;
        }
        err('rm: filesystem ini read-only. Tulisannya aman. 😄');
      }
    },
    vim: { hidden: true, run: function () { line('Keluar dari vim itu susah, jadi sengaja nggak saya pasang di sini. 🙃'); } },
    nano: { hidden: true, run: function () { line('nano? Pilihan yang aman dan damai. Sayangnya tetap nggak ada di sini.'); } },
    emacs: { hidden: true, run: function () { line('Sistem operasi yang bagus, cuma kurang text editor. 😜'); } },
    zypper: {
      hidden: true,
      run: function (args) {
        if (args[0] === 'in' || args[0] === 'install') {
          var pkg = args[1] || 'kopi';
          line('Loading repository data...', 'term-dim');
          line('Resolving package dependencies...', 'term-dim');
          line('The following NEW package is going to be installed: ' + pkg);
          line('(1/1) Installing: ' + pkg + ' ................................[done]', 'term-ok');
          if (pkg === 'kopi' || pkg === 'coffee') line('☕ Siap. Semangat kerjanya!');
          return;
        }
        if (args[0] === 'dup') return line('Tumbleweed sudah versi terbaru. Kayaknya. Coba lagi besok. 🦎');
        line('Coba: zypper in kopi', 'term-dim');
      }
    },
    ping: {
      hidden: true,
      run: function (args) {
        var h = args[0] || 'rifkiaz.my.id';
        line('PING ' + h + ': 56 data bytes');
        var n = 0;
        (function tick() {
          if (n >= 3) { line('--- ' + h + ' ping statistics --- 3 packets transmitted, 3 received, 0% packet loss', 'term-dim'); scroll(); return; }
          line('64 bytes from ' + h + ': icmp_seq=' + n + ' ttl=64 time=' + (8 + Math.random() * 20).toFixed(1) + ' ms');
          scroll();
          n++;
          setTimeout(tick, 350);
        })();
      }
    },
    uname: { hidden: true, run: function () { line('Linux ' + HOST + ' 6.x-tumbleweed #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux'); } },
    hello: { hidden: true, run: function () { line('Halo juga! 👋 Ketik help kalau bingung.'); } },
    halo: { hidden: true, run: function () { COMMANDS.hello.run(); } },
    kopi: { hidden: true, run: function () { COMMANDS.zypper.run(['in', 'kopi']); } },
    hack: {
      hidden: true,
      run: function () {
        line('Mengakses mainframe...', 'term-dim');
        setTimeout(function () { line('Bypass firewall... ████████████ 100%', 'term-ok'); scroll(); }, 500);
        setTimeout(function () { line('Akses ditolak. Kamu cuma bisa hack hati saya pakai pull request yang rapi. 😎'); scroll(); }, 1100);
      }
    }
  };
  COMMANDS.ll = { hidden: true, run: function (a) { COMMANDS.ls.run(['-a'].concat(a)); } };
  COMMANDS.dir = { hidden: true, run: function (a) { COMMANDS.ls.run(a); } };
  COMMANDS.cls = { hidden: true, run: function () { COMMANDS.clear.run(); } };
  COMMANDS.less = COMMANDS.more = { hidden: true, run: function (a) { COMMANDS.cat.run(a); } };

  var started = Date.now();
  function uptime() {
    var s = Math.floor((Date.now() - started) / 1000);
    return Math.floor(s / 60) + ' menit ' + (s % 60) + ' detik';
  }

  // ---------- run loop ----------
  var hist = [];
  var hIdx = 0;

  function run(raw) {
    var cmd = raw.trim();
    if (game) {
      echoCommand(raw, game.prompt);
      gameInput(raw);
      return;
    }
    echoCommand(raw, ps1());
    if (!cmd) return;
    hist.push(cmd);
    hIdx = hist.length;
    if (cmd === 'rm -rf /' || cmd === 'sudo rm -rf /') return COMMANDS.rm.run(['-rf', '/']);
    var parts = cmd.split(/\s+/);
    var name = parts[0].toLowerCase();
    var c = COMMANDS[name];
    if (!c) {
      err(name + ': command not found. Ketik help untuk lihat daftar perintah.');
      return;
    }
    c.run(parts.slice(1));
    setPrompt(game ? game.prompt : ps1());
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = input.value;
    input.value = '';
    run(v);
    scroll();
  });

  // ---------- tab completion ----------
  function complete() {
    var v = input.value;
    var parts = v.split(' ');
    var cands;
    if (parts.length === 1) {
      cands = Object.keys(COMMANDS).filter(function (k) { return !COMMANDS[k].hidden && k.indexOf(v) === 0; });
      if (cands.length === 1) input.value = cands[0] + ' ';
    } else {
      var word = parts[parts.length - 1];
      var slash = word.lastIndexOf('/');
      var base = slash === -1 ? '' : word.slice(0, slash + 1);
      var r = resolve(base ? base.replace(/\/$/, '') || '/' : '.');
      if (!r || r.node.type !== 'dir') return;
      var pre = word.slice(slash + 1);
      cands = Object.keys(r.node.children).filter(function (k) { return k.indexOf(pre) === 0 && (pre.charAt(0) === '.' || k.charAt(0) !== '.'); });
      if (cands.length === 1) {
        var n = r.node.children[cands[0]];
        parts[parts.length - 1] = base + cands[0] + (n.type === 'dir' ? '/' : '');
        input.value = parts.join(' ');
      }
    }
    if (cands && cands.length > 1) {
      echoCommand(v, game ? game.prompt : ps1());
      line(cands.join('  '), 'term-dim');
      scroll();
    }
  }

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      if (!game) complete();
    } else if (e.key === 'ArrowUp') {
      if (!hist.length) return;
      e.preventDefault();
      hIdx = Math.max(0, hIdx - 1);
      input.value = hist[hIdx];
    } else if (e.key === 'ArrowDown') {
      if (!hist.length) return;
      e.preventDefault();
      hIdx = Math.min(hist.length, hIdx + 1);
      input.value = hist[hIdx] || '';
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      out.textContent = '';
    } else if (e.key === 'c' && e.ctrlKey && !window.getSelection().toString()) {
      e.preventDefault();
      echoCommand(input.value + '^C', game ? game.prompt : ps1());
      input.value = '';
      if (game) stopGame();
      scroll();
    }
  });

  // no copy-paste shortcuts in the typing race
  input.addEventListener('paste', function (e) {
    if (game && game.raw) { e.preventDefault(); err('Eits, nggak boleh paste. Ketik manual ya. 😄'); scroll(); }
  });

  // click on a listed file/folder: cd into folders, cat files
  out.addEventListener('click', function (e) {
    var t = e.target.closest('.term-click');
    if (!t) return;
    if (t.dataset.cmd) { if (!game) run(t.dataset.cmd); scroll(); return; }
    var r = resolve('~/' + t.dataset.path);
    if (!r) return;
    run((r.node.type === 'dir' ? 'cd ~/' : 'cat ~/') + t.dataset.path);
    if (r.node.type === 'dir') run('ls');
    scroll();
  });

  // focus input when tapping the terminal (but keep text selection working)
  screen.addEventListener('click', function (e) {
    if (e.target.closest('a, .term-click')) return;
    if (window.getSelection().toString()) return;
    input.focus({ preventScroll: true });
  });

  // keep the prompt visible above the on-screen keyboard on phones
  function keepInputVisible() {
    if (document.activeElement !== input) return;
    var vv = window.visualViewport;
    var r = input.getBoundingClientRect();
    var bottom = vv ? vv.height + vv.offsetTop : window.innerHeight;
    if (r.bottom > bottom - 8 || r.top < 0) input.scrollIntoView({ block: 'center' });
  }
  if (window.visualViewport) window.visualViewport.addEventListener('resize', function () { setTimeout(keepInputVisible, 50); });
  input.addEventListener('focus', function () { setTimeout(keepInputVisible, 300); });
  form.addEventListener('submit', function () { setTimeout(keepInputVisible, 0); });

  var chips = document.getElementById('term-chips');
  if (chips) chips.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-cmd]');
    if (!b) return;
    run(b.dataset.cmd);
    scroll();
  });

  // ---------- boot ----------
  setPrompt(ps1());
  line(frag('Selamat datang di ', span('rifki-sh', 'term-hl'), '. Terminal mini untuk jelajah isi web ini.'));
  line(frag('Ketik ', span('help', 'term-hl'), ' untuk mulai, atau ', span('game', 'term-hl'), ' buat main game.'), 'term-dim');
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) input.focus({ preventScroll: true });
})();
