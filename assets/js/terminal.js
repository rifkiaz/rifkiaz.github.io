(function () {
  'use strict';

  var EN = (document.documentElement.lang || '').slice(0, 2) === 'en';
  function tr(id, en) { return EN ? en : id; }

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
  root[tr('.rahasia', '.secret')] = file({ secret: true });
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
  var chips = document.getElementById('term-chips');
  var chipsHome = chips ? chips.innerHTML : '';
  var chipsMode = '';
  // saat game jalan, tombol cepat diganti jadi kontrol game (hint/skip/q)
  function updateChips() {
    if (!chips) return;
    var list = game ? (game.chips || ['q']) : null;
    var mode = list ? list.join('|') : '';
    if (mode === chipsMode) return;
    chipsMode = mode;
    if (!list) { chips.innerHTML = chipsHome; return; }
    chips.textContent = '';
    list.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button'; b.dataset.cmd = c; b.textContent = c;
      chips.appendChild(b);
    });
  }
  function setPrompt(text) { ps1El.textContent = text; updateChips(); }

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
    ['OK', 200], ['Created', 201], ['No Content', 204], ['Moved Permanently', 301], [tr('Found (redirect sementara)', 'Found (temporary redirect)'), 302],
    ['Not Modified', 304], ['Bad Request', 400], ['Unauthorized', 401], ['Forbidden', 403], ['Not Found', 404],
    ['Method Not Allowed', 405], ['Conflict', 409], ['Too Many Requests', 429], ['Internal Server Error', 500],
    [tr('Bad Gateway (nginx-nya nyerah)', 'Bad Gateway (nginx gave up)'), 502], ['Service Unavailable', 503], ['Gateway Timeout', 504], ["I'm a teapot ☕", 418]
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
  if (EN) ['List folder contents', 'Move to another folder', 'Show the folder you are in right now', 'See running processes', 'Check free disk space per partition', 'Check the size of a folder', 'Check RAM usage', 'Search for text inside files', 'Change file permissions', 'Change file owner', 'Stop a process by PID', 'Watch a log live', 'Restart a systemd service', 'Read logs from systemd', 'Copy files to another server over SSH', 'Check connectivity to a host with ICMP packets', 'See listening ports', 'Check a domain\'s DNS records', 'Extract a .tar.gz file', 'Run a command as root', 'Install a package on openSUSE', 'See running Docker containers', 'See git commit history', 'How long the server has been up', 'Create a new folder', 'Find files by name'].forEach(function (t, i) { CMDS[i][0] = t; });
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
    port: { title: tr('Tebak Port', 'Guess the Port'), desc: tr('tebak port default service', 'guess a service\'s default port'), start: function () { return quizNumber(tr('Tebak Port', 'Guess the Port'), 'port?>', PORTS, tr('Port default', 'Default port for'), tr('jaringan', 'networking')); } },
    http: { title: tr('Tebak Kode HTTP', 'Guess the HTTP Code'), desc: tr('tebak status code HTTP', 'guess the HTTP status code'), start: function () { return quizNumber(tr('Tebak Kode HTTP', 'Guess the HTTP Code'), 'http?>', HTTP_CODES, tr('Kode HTTP untuk', 'HTTP code for'), null); } },
    cmd: { title: tr('Tebak Perintah', 'Guess the Command'), desc: tr('tebak perintah Linux dari deskripsinya', 'guess the Linux command from its description'), start: startCmd },
    angka: { title: tr('Tebak Angka', 'Guess the Number'), desc: tr('tebak angka 1 sampai 100', 'guess a number from 1 to 100'), start: startAngka },
    ketik: { title: tr('Adu Cepat Ngetik', 'Typing Race'), desc: tr('ketik perintah secepat mungkin', 'type commands as fast as you can'), start: startKetik }
  };
  // English names for the Indonesian game keys (both work everywhere)
  var GAME_ALIAS = { number: 'angka', typing: 'ketik', acak: 'random' };
  function gameKey(k) { return EN ? ({ angka: 'number', ketik: 'typing' }[k] || k) : k; }

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
    var g = game;
    game = null;
    if (g && g.stop) g.stop();
    if (msg) line(msg, 'term-dim');
    setPrompt(ps1());
  }

  function cmdButton(cmd) {
    var s = span(cmd, 'term-hl term-click');
    s.dataset.cmd = cmd;
    return s;
  }

  function gameMenu() {
    line(tr('🎮 Pilih game:', '🎮 Pick a game:'));
    Object.keys(GAMES).forEach(function (k) {
      line(frag(cmdButton('game ' + gameKey(k)), ' '.repeat(Math.max(1, 13 - ('game ' + gameKey(k)).length)) + GAMES[k].desc));
    });
    line(tr('Di HP tinggal tap nama game-nya. Ketik "q" kapan saja buat keluar dari game.', 'On a phone, just tap the game name. Type "q" any time to leave a game.'), 'term-dim');
    line(frag(tr('Mau yang lebih teknis? Coba ', 'Want something more technical? Try '), cmdButton('quiz'), tr(' untuk kuis Terraform, Ansible, dan Kubernetes.', ' for Terraform, Ansible, and Kubernetes quizzes.')), 'term-dim');
  }

  function scoreLine(s, n, key) {
    var rec = saveBest(key, s, false);
    var verdict = s === n ? tr('Sempurna! Kamu layak pegang pager on-call. 🏆', 'Perfect! You\'re ready to carry the on-call pager. 🏆')
      : s >= n * 0.6 ? tr('Mantap, dikit lagi jadi kamus berjalan.', 'Nice, you\'re almost a walking reference.')
      : s >= 1 ? tr('Lumayan. Coba lagi biar makin hafal.', 'Not bad. Try again to lock it in.')
      : tr('Nggak apa-apa, semua orang pernah lupa. Coba lagi ya.', 'No worries, everyone forgets. Give it another go.');
    line(frag(tr('Skor kamu: ', 'Your score: '), span(s + '/' + n, 'term-hl'), '. ' + verdict + (rec ? tr(' Rekor baru! 🎉', ' New record! 🎉') : '')));
    if (best[key] !== undefined) line(tr('Rekor terbaik kamu: ', 'Your best: ') + best[key] + '/' + n, 'term-dim');
  }

  // quiz with numeric answers: 5 questions, 2 tries, higher/lower hint
  function quizNumber(title, prompt, bank, label, sheet) {
    var qs = shuffle(bank).slice(0, 5);
    var i = 0, score = 0, tries = 0;
    function ask() {
      line(frag(span('[' + (i + 1) + '/' + qs.length + '] ', 'term-dim'), label + ' ', span(qs[i][0], 'term-hl'), tr(' berapa?', ' is?')));
    }
    function next() {
      i++; tries = 0;
      if (i < qs.length) return ask();
      scoreLine(score, qs.length, prompt.replace('?>', ''));
      if (score < 3 && sheet) line(tr('Contekan: cat cheatsheet/', 'Cheat sheet: cat cheatsheet/') + sheet, 'term-dim');
      stopGame();
    }
    line(frag(span('🎮 ' + title, 'term-hl'), tr(': 5 soal, tiap soal dapat 2 kesempatan.', ': 5 questions, 2 tries each.')));
    line(tr('Ketik angkanya, "skip" untuk lewati, atau "q" untuk keluar.', 'Type the number, "skip" to pass, or "q" to quit.'), 'term-dim');
    ask();
    return {
      prompt: prompt,
      input: function (v) {
        var a = qs[i][1];
        if (v === 'skip') { line(frag(tr('Jawabannya ', 'The answer is '), span(String(a), 'term-hl'), '.'), 'term-dim'); return next(); }
        if (!/^\d+$/.test(v)) return err(tr('Masukkan angka ya, atau "skip" / "q".', 'Enter a number, or "skip" / "q".'));
        var n = parseInt(v, 10);
        if (n === a) { score++; line(tr('✔ Benar!', '✔ Correct!'), 'term-ok'); return next(); }
        if (tries++ === 0) return err(tr('✘ Belum tepat. Petunjuk: ', '✘ Not quite. Hint: ') + (n < a ? tr('lebih besar', 'higher') : tr('lebih kecil', 'lower')) + tr('. Sekali lagi.', '. One more try.'));
        err(tr('✘ Salah. Jawabannya ', '✘ Wrong. The answer is ') + a + '.');
        next();
      }
    };
  }

  function startCmd() {
    var qs = shuffle(CMDS).slice(0, 5);
    var i = 0, score = 0, tries = 0;
    function ask() {
      line(frag(span('[' + (i + 1) + '/' + qs.length + '] ', 'term-dim'), span(qs[i][0], 'term-hl'), tr('. Perintahnya apa?', '. What\'s the command?')));
    }
    function next() {
      i++; tries = 0;
      if (i < qs.length) return ask();
      scoreLine(score, qs.length, 'cmd');
      if (score < 3) line(tr('Contekan: cat cheatsheet/perintah-dasar', 'Cheat sheet: cat cheatsheet/basic-commands'), 'term-dim');
      stopGame();
    }
    line(frag(span(tr('🎮 Tebak Perintah', '🎮 Guess the Command'), 'term-hl'), tr(': 5 soal, cukup ketik nama perintahnya.', ': 5 questions, just type the command name.')));
    line(tr('"skip" untuk lewati, "q" untuk keluar.', '"skip" to pass, "q" to quit.'), 'term-dim');
    ask();
    return {
      prompt: 'cmd?>',
      input: function (v) {
        var ans = qs[i].slice(1);
        if (v === 'skip') { line(frag(tr('Jawabannya ', 'The answer is '), span(ans.join(' / '), 'term-hl'), '.'), 'term-dim'); return next(); }
        var word = v.replace(/^sudo\s+(?=\S)/, '').split(/\s+/)[0];
        if (ans.indexOf(word) !== -1) {
          score++;
          line(tr('✔ Benar!', '✔ Correct!') + (ans.length > 1 ? tr(' Bisa juga: ', ' Also accepted: ') + ans.filter(function (x) { return x !== word; }).join(', ') : ''), 'term-ok');
          return next();
        }
        if (tries++ === 0) return err(tr('✘ Belum tepat. Petunjuk: diawali huruf "', '✘ Not quite. Hint: it starts with "') + ans[0].charAt(0) + tr('" dan panjangnya ', '" and is ') + ans[0].length + tr(' huruf.', ' letters long.'));
        err(tr('✘ Salah. Jawabannya ', '✘ Wrong. The answer is ') + ans.join(' / ') + '.');
        next();
      }
    };
  }

  function startAngka() {
    var target = 1 + Math.floor(Math.random() * 100);
    var tries = 0, max = 7;
    line(frag(span(tr('🎮 Tebak Angka', '🎮 Guess the Number'), 'term-hl'), tr(': saya pilih angka 1 sampai 100. Kamu punya ', ': I picked a number from 1 to 100. You get ') + max + tr(' kesempatan.', ' tries.')));
    line(tr('Ketik "q" untuk keluar.', 'Type "q" to quit.'), 'term-dim');
    return {
      prompt: tr('angka?>', 'number?>'),
      input: function (v) {
        if (!/^\d+$/.test(v)) return err(tr('Masukkan angka 1 sampai 100 ya.', 'Enter a number from 1 to 100.'));
        var n = parseInt(v, 10);
        tries++;
        if (n === target) {
          var rec = saveBest('angka', tries, true);
          line(tr('✔ Tepat! Angkanya ', '✔ Got it! The number was ') + target + tr(', ketemu dalam ', ', found in ') + tries + tr(' tebakan.', ' guesses.') + (rec ? tr(' Rekor baru! 🎉', ' New record! 🎉') : ''), 'term-ok');
          line(tr('Rekor terbaik kamu: ', 'Your best: ') + best.angka + tr(' tebakan. Main lagi: game angka', ' guesses. Play again: game number'), 'term-dim');
          return stopGame();
        }
        if (tries >= max) { err(tr('✘ Kesempatan habis. Angkanya ', '✘ Out of tries. The number was ') + target + tr('. Binary search bisa bantu lho. 😉', '. Binary search helps, you know. 😉')); return stopGame(); }
        err('✘ ' + (n < target ? tr('Terlalu kecil', 'Too low') : tr('Terlalu besar', 'Too high')) + tr('. Sisa ', '. ') + (max - tries) + tr(' kesempatan.', ' tries left.'));
      }
    };
  }

  function startKetik() {
    var qs = shuffle(TYPING).slice(0, 3);
    var i = 0, t0 = 0, total = 0, chars = 0, miss = 0;
    function ask() {
      line(frag(span('[' + (i + 1) + '/' + qs.length + '] ', 'term-dim'), tr('Ketik: ', 'Type: '), span(qs[i], 'term-hl')));
      t0 = Date.now();
    }
    line(frag(span(tr('🎮 Adu Cepat Ngetik', '🎮 Typing Race'), 'term-hl'), tr(': ketik 3 perintah persis sama, secepat mungkin.', ': type 3 commands exactly, as fast as you can.')));
    line(tr('Waktu mulai jalan begitu perintahnya muncul. "q" untuk keluar.', 'The clock starts as soon as the command appears. "q" to quit.'), 'term-dim');
    ask();
    return {
      prompt: tr('ketik?>', 'typing?>'),
      raw: true,
      input: function (v) {
        if (v.trim() !== qs[i]) { miss++; return err(tr('✘ Belum sama persis, coba lagi.', '✘ Not an exact match, try again.')); }
        var dt = (Date.now() - t0) / 1000;
        total += dt; chars += qs[i].length;
        line('✔ ' + dt.toFixed(1) + tr(' detik', ' s'), 'term-ok');
        if (++i < qs.length) return ask();
        var cpm = Math.round(chars / total * 60);
        var rec = saveBest('ketik', Math.round(total * 10) / 10, true);
        line(frag('Total ', span(total.toFixed(1) + tr(' detik', ' s'), 'term-hl'), tr(', sekitar ', ', about ') + cpm + tr(' karakter/menit', ' chars/min') + (miss ? tr(', salah ', ', ') + miss + 'x' : tr(', tanpa salah', ', no mistakes')) + '.' + (rec ? tr(' Rekor baru! 🎉', ' New record! 🎉') : '')));
        line(cpm > 250 ? tr('Jari kamu jago banget. Pasti biasa hidup di terminal. ⚡', 'Those fingers are fast. You must live in a terminal. ⚡') : cpm > 150 ? tr('Cepat juga! Tinggal latihan dikit lagi.', 'Pretty quick! A bit more practice and you\'re there.') : tr('Santai aja, yang penting perintahnya benar. 😄', 'No rush, getting the command right is what counts. 😄'));
        line(tr('Rekor terbaik kamu: ', 'Your best: ') + best.ketik + tr(' detik', ' s'), 'term-dim');
        stopGame();
      }
    };
  }

  function gameStart(args) {
    var k = (args[0] || '').toLowerCase();
    if (!k) return gameMenu();
    k = GAME_ALIAS[k] || k;
    if (k === 'random') { var ks = Object.keys(GAMES); k = ks[Math.floor(Math.random() * ks.length)]; }
    if (!GAMES[k]) { err('game: "' + k + tr(tr('" nggak ada.', '" doesn\'t exist.'), '" doesn\'t exist.')); return gameMenu(); }
    game = GAMES[k].start();
    setPrompt(game.prompt);
  }

  function gameInput(raw) {
    var v = raw.trim().toLowerCase();
    if (v === 'q' || v === 'quit' || v === 'exit') return stopGame(tr('Game dihentikan.', 'Game stopped.'));
    if (!v) return;
    game.input(game.raw || game.keepCase ? raw : v);
  }

  // ---------- quiz hands-on ----------
  // tiap soal: [skenario, petunjuk, contoh jawaban, pola regex (semua harus cocok; array of array = alternatif), output simulasi]
  var INV = /(-i|--inventory|--inventory-file)[= ]hosts\.ini\b/;
  var PB = /^ansible-playbook\b.*\bsite\.yml\b/;
  var DEP = '(deployments?|deploy)[ /]web\\b';
  var QUIZ = {
    terraform: {
      title: 'Terraform', tool: /^terraform\b/, start: 'terraform',
      intro: 'Kamu ada di folder project Terraform berisi main.tf dan variables.tf.',
      qs: [
        ['Folder project baru di-clone. Siapkan backend dan download provider-nya.', 'langkah pertama sebelum plan/apply apa pun', 'terraform init',
          [/^terraform init\b/], ['Initializing the backend...', 'Initializing provider plugins...', '- Installing hashicorp/aws v5.70.0...', 'Terraform has been successfully initialized!']],
        ['Lihat apa saja yang akan berubah, tanpa mengubah apa pun.', 'subcommand-nya 4 huruf, diawali "p"', 'terraform plan',
          [/^terraform plan\b/], ['aws_instance.web: Refreshing state... [id=i-0abc]', 'Plan: 1 to add, 1 to change, 0 to destroy.']],
        ['Simpan hasil plan ke file bernama tfplan, biar yang di-apply nanti persis sama.', 'pakai opsi -out', 'terraform plan -out=tfplan',
          [/^terraform plan\b/, /-out[= ]["']?tfplan\b/], ['Plan: 1 to add, 0 to change, 0 to destroy.', 'Saved the plan to: tfplan']],
        ['Terapkan perubahan di pipeline CI, tanpa prompt konfirmasi "yes".', 'apply dengan opsi auto-...', 'terraform apply -auto-approve',
          [/^terraform apply\b/, /-auto-approve\b/], ['aws_instance.web: Creating...', 'aws_instance.web: Creation complete after 32s [id=i-0def]', 'Apply complete! Resources: 1 added, 0 changed, 0 destroyed.']],
        ['Rapikan format semua file .tf, termasuk yang ada di subfolder modules/.', 'fmt plus opsi supaya masuk ke subfolder', 'terraform fmt -recursive',
          [/^terraform fmt\b/, /-recursive\b/], ['main.tf', 'modules/vpc/main.tf']],
        ['Cek apakah konfigurasinya valid secara sintaks.', 'subcommand-nya mirip kata "validasi"', 'terraform validate',
          [/^terraform validate\b/], ['Success! The configuration is valid.']],
        ['Tampilkan daftar semua resource yang tercatat di state.', 'state + subcommand untuk menampilkan daftar', 'terraform state list',
          [/^terraform state list\b/], ['aws_instance.web', 'aws_s3_bucket.logs', 'module.vpc.aws_vpc.main']],
        ['Lihat semua atribut resource aws_instance.web yang ada di state.', 'state + subcommand untuk menampilkan detail', 'terraform state show aws_instance.web',
          [/^terraform state show ["']?aws_instance\.web\b/], ['# aws_instance.web:', 'resource "aws_instance" "web" {', '    instance_type = "t3.micro"', '}']],
        ['Resource aws_instance.web di kode sudah kamu rename jadi aws_instance.app. Pindahkan juga di state supaya nggak dibuat ulang.', 'state + subcommand yang mirip perintah mv di Linux', 'terraform state mv aws_instance.web aws_instance.app',
          [/^terraform state mv\b.*\baws_instance\.web ["']?aws_instance\.app\b/], ['Move "aws_instance.web" to "aws_instance.app"', 'Successfully moved 1 object(s).']],
        ['Bucket S3 my-logs dibuat manual lewat console. Masukkan ke state sebagai aws_s3_bucket.logs.', 'import <alamat resource> <id>', 'terraform import aws_s3_bucket.logs my-logs',
          [/^terraform import\b.*\baws_s3_bucket\.logs ["']?my-logs\b/], ['aws_s3_bucket.logs: Importing from ID "my-logs"...', 'Import successful!']],
        ['Paksa aws_instance.web dibuat ulang saat apply (taint sudah deprecated).', 'apply dengan opsi -replace=', 'terraform apply -replace=aws_instance.web',
          [/^terraform (apply|plan)\b/, /-replace[= ]["']?aws_instance\.web\b/], ['# aws_instance.web will be replaced, as requested', 'Plan: 1 to add, 0 to change, 1 to destroy.']],
        ['Plan hanya untuk module.vpc saja.', 'opsi -target=', 'terraform plan -target=module.vpc',
          [/^terraform plan\b/, /-target[= ]["']?module\.vpc\b/], ['Warning: Resource targeting is in effect', 'Plan: 2 to add, 0 to change, 0 to destroy.']],
        ['Upgrade provider ke versi terbaru yang masih masuk version constraint.', 'init dengan opsi tambahan', 'terraform init -upgrade',
          [/^terraform init\b/, /-upgrade\b/], ['Upgrading modules...', '- Installing hashicorp/aws v5.72.1...', 'Terraform has been successfully initialized!']],
        ['Buat workspace baru bernama staging (sekaligus pindah ke sana).', 'workspace + subcommand untuk membuat', 'terraform workspace new staging',
          [/^terraform workspace new staging$/], ['Created and switched to workspace "staging"!']],
        ['Ambil nilai output db_endpoint dari state.', 'subcommand-nya sama dengan nama block-nya di kode', 'terraform output db_endpoint',
          [/^terraform output\b.*\bdb_endpoint\b/], ['"db.internal.example:5432"']],
        ['Hapus semua resource yang dikelola project ini.', 'kebalikan dari apply', 'terraform destroy',
          [[/^terraform destroy\b/], [/^terraform apply\b/, /-destroy\b/]], ['Plan: 0 to add, 0 to change, 3 to destroy.', 'Destroy complete! Resources: 3 destroyed.']]
      ]
    },
    ansible: {
      title: 'Ansible', tool: /^ansible(-\w+)?\b/, start: 'ansible / ansible-playbook / ansible-vault / ...',
      intro: 'Ada inventory hosts.ini (grup webservers dan db) dan playbook site.yml.',
      qs: [
        ['Cek semua host di hosts.ini bisa dijangkau Ansible.', 'ad-hoc ke "all" pakai module ping', 'ansible all -i hosts.ini -m ping',
          [/^ansible all\b/, INV, /-m[= ](ansible\.builtin\.)?ping\b/], ['web1 | SUCCESS => {"ping": "pong"}', 'db1 | SUCCESS => {"ping": "pong"}']],
        ['Jalankan playbook site.yml dengan inventory hosts.ini.', 'ansible-playbook -i <inventory> <playbook>', 'ansible-playbook -i hosts.ini site.yml',
          [PB, INV], ['PLAY RECAP *********************************', 'web1 : ok=12 changed=2 unreachable=0 failed=0']],
        ['Dry-run site.yml (inventory hosts.ini) sambil menampilkan diff perubahan file.', 'dua opsi: --check dan --diff', 'ansible-playbook -i hosts.ini site.yml --check --diff',
          [PB, INV, /(--check\b|\s-C\b)/, /(--diff\b|\s-D\b)/], ['--- before: /etc/nginx/nginx.conf', '+++ after: /etc/nginx/nginx.conf', 'web1 : ok=12 changed=1 (check mode)']],
        ['Jalankan site.yml (inventory hosts.ini) hanya ke grup webservers.', 'opsi --limit atau -l', 'ansible-playbook -i hosts.ini site.yml --limit webservers',
          [PB, INV, /(--limit|-l)[= ]["']?webservers\b/], ['PLAY [all] *********************************', 'web1 : ok=12 changed=0', 'web2 : ok=12 changed=0']],
        ['Jalankan site.yml (inventory hosts.ini) hanya untuk task yang bertag nginx.', 'opsi --tags atau -t', 'ansible-playbook -i hosts.ini site.yml --tags nginx',
          [PB, INV, /(--tags|-t)[= ]["']?nginx\b/], ['TASK [nginx : Install nginx] ***************', 'ok: [web1]']],
        ['Jalankan site.yml (inventory hosts.ini) dengan variabel env=prod dari command line.', 'opsi -e atau --extra-vars', 'ansible-playbook -i hosts.ini site.yml -e env=prod',
          [PB, INV, /(-e|--extra-vars)[= ]["']?env=prod\b/], ['TASK [debug] *******************************', 'ok: [web1] => {"msg": "deploy ke prod"}']],
        ['Jalankan site.yml (inventory hosts.ini), tapi minta password sudo dulu.', 'opsi --ask-become-pass (huruf K besar)', 'ansible-playbook -i hosts.ini site.yml -K',
          [PB, INV, /(--ask-become-pass\b|\s-K\b)/], ['BECOME password:', 'PLAY [all] *********************************']],
        ['Cek sintaks site.yml tanpa menjalankan apa pun.', 'opsi --syntax-...', 'ansible-playbook site.yml --syntax-check',
          [PB, /--syntax-check\b/], ['playbook: site.yml']],
        ['Lihat struktur grup dan host di hosts.ini dalam bentuk pohon.', 'ansible-inventory dengan opsi --graph', 'ansible-inventory -i hosts.ini --graph',
          [/^ansible-inventory\b/, INV, /--graph\b/], ['@all:', '  |--@webservers:', '  |  |--web1', '  |--@db:', '  |  |--db1']],
        ['Cek uptime semua host di grup db (inventory hosts.ini) pakai perintah ad-hoc.', 'ansible <grup> -a "<perintah>"', 'ansible db -i hosts.ini -a uptime',
          [/^ansible db\b/, INV, /(-a|--args)[= ]["']?uptime\b/], ['db1 | CHANGED | rc=0 >>', ' 10:02:11 up 41 days,  2 users,  load average: 0.08, 0.05, 0.01']],
        ['Lihat semua facts milik host web1 (inventory hosts.ini).', 'module yang dipakai saat gather_facts', 'ansible web1 -i hosts.ini -m setup',
          [/^ansible web1\b/, INV, /-m[= ](ansible\.builtin\.)?setup\b/], ['web1 | SUCCESS => {', '    "ansible_facts": { "ansible_distribution": "openSUSE Leap", ... }']],
        ['Restart nginx di grup webservers (inventory hosts.ini) secara ad-hoc, pakai sudo.', '-m service -a "name=... state=..." plus -b', 'ansible webservers -i hosts.ini -m service -a "name=nginx state=restarted" -b',
          [/^ansible webservers\b/, INV, /-m[= ](ansible\.builtin\.)?(service|systemd|systemd_service)\b/, /name=nginx\b/, /state=restarted\b/, /(\s-b\b|--become\b)/], ['web1 | CHANGED => {"name": "nginx", "state": "started"}']],
        ['Enkripsi file group_vars/all/vault.yml yang isinya password.', 'ansible-vault + subcommand untuk enkripsi', 'ansible-vault encrypt group_vars/all/vault.yml',
          [/^ansible-vault encrypt\b.*\s(\.\/)?group_vars\/all\/vault\.yml\b/], ['New Vault password:', 'Encryption successful']],
        ['Edit file secrets.yml yang sudah terenkripsi vault.', 'ansible-vault + subcommand untuk mengedit', 'ansible-vault edit secrets.yml',
          [/^ansible-vault edit\b.*\s(\.\/)?secrets\.yml\b/], ['Vault password:', '(editor terbuka, simpan lalu keluar)']],
        ['Install semua role yang ada di requirements.yml.', 'ansible-galaxy install -r ...', 'ansible-galaxy install -r requirements.yml',
          [/^ansible-galaxy( role| collection)? install\b/, /(-r|--role-file|--requirements-file)[= ](\.\/)?requirements\.yml\b/], ['Starting galaxy role install process', '- geerlingguy.docker (7.4.1) was installed successfully']],
        ['Baca dokumentasi module copy langsung dari terminal.', 'ansible-doc <nama module>', 'ansible-doc copy',
          [/^ansible-doc\b.*\s(ansible\.builtin\.)?copy$/], ['> ANSIBLE.BUILTIN.COPY', '  The copy module copies a file from the local or remote machine...']]
      ]
    },
    kubernetes: {
      title: 'Kubernetes', tool: /^(kubectl|kubens)\b/, start: 'kubectl (alias k juga boleh)',
      intro: 'kubectl sudah terhubung ke cluster. Alias "k" untuk kubectl juga diterima.',
      qs: [
        ['Lihat semua pod di semua namespace.', 'get pods plus opsi -A', 'kubectl get pods -A',
          [/^kubectl\b.*\bget (pods?|po)\b/, /(\s-A\b|--all-namespaces\b)/], ['NAMESPACE     NAME                       READY   STATUS    RESTARTS', 'kube-system   coredns-5d78c9869d-x2kqp   1/1     Running   0', 'default       web-7d9f                   1/1     Running   0']],
        ['Lihat pod di namespace monitoring saja.', 'opsi -n <namespace>', 'kubectl get pods -n monitoring',
          [/^kubectl\b.*\bget (pods?|po)\b/, /(-n|--namespace)[= ]monitoring\b/], ['NAME                          READY   STATUS    RESTARTS', 'prometheus-0                  2/2     Running   0', 'grafana-6b8f7c9d4-qzk2w       1/1     Running   0']],
        ['Pod web-7d9f statusnya Pending. Lihat detail dan event-nya.', 'subcommand-nya kata kerja "jelaskan" dalam bahasa Inggris', 'kubectl describe pod web-7d9f',
          [/^kubectl\b.*\bdescribe (pods?|po)[ \/]web-7d9f\b/], ['Events:', '  Warning  FailedScheduling  0/3 nodes are available: 3 Insufficient memory.']],
        ['Ikuti log pod api-5c8b secara live.', 'logs plus opsi -f', 'kubectl logs -f api-5c8b',
          [/^kubectl\b.*\blogs\b/, /\b((pods?|po)\/)?api-5c8b\b/, /(\s-f\b|--follow\b)/], ['2026-10-16T10:01:02Z INFO server listening on :8080', '2026-10-16T10:01:05Z INFO GET /healthz 200']],
        ['Pod api-5c8b kena CrashLoopBackOff. Lihat log dari container sebelum crash.', 'logs plus opsi --previous', 'kubectl logs api-5c8b --previous',
          [/^kubectl\b.*\blogs\b/, /\bapi-5c8b\b/, /(\s-p\b|--previous\b)/], ['panic: dial tcp db:5432: connect: connection refused']],
        ['Masuk ke shell di dalam pod web-7d9f.', 'exec -it <pod> -- sh', 'kubectl exec -it web-7d9f -- sh',
          [/^kubectl\b.*\bexec\b/, /\bweb-7d9f\b/, /(\s-it\b|\s-ti\b|\s-i -t\b|\s-t -i\b)/, /\s--\s+(\/bin\/)?(ba)?sh$/], ['/ #']],
        ['Terapkan manifest deploy.yaml ke cluster.', 'apply -f <file>', 'kubectl apply -f deploy.yaml',
          [/^kubectl\b.*\bapply\b/, /(-f|--filename)[= ](\.\/)?deploy\.yaml\b/], ['deployment.apps/web configured', 'service/web unchanged']],
        ['Naikkan deployment web jadi 5 replica.', 'scale plus opsi --replicas', 'kubectl scale deployment web --replicas=5',
          [/^kubectl\b.*\bscale\b/, new RegExp(DEP), /--replicas[= ]5\b/], ['deployment.apps/web scaled']],
        ['Restart semua pod deployment web secara bergiliran (rolling).', 'rollout + subcommand restart', 'kubectl rollout restart deployment web',
          [new RegExp('^kubectl\\b.*\\brollout restart ' + DEP)], ['deployment.apps/web restarted']],
        ['Pantau apakah rollout deployment web sudah selesai.', 'rollout + subcommand status', 'kubectl rollout status deployment web',
          [new RegExp('^kubectl\\b.*\\brollout status ' + DEP)], ['Waiting for deployment "web" rollout to finish: 2 of 3 updated replicas are available...', 'deployment "web" successfully rolled out']],
        ['Versi baru deployment web bikin error. Kembalikan ke revisi sebelumnya.', 'rollout + subcommand undo', 'kubectl rollout undo deployment web',
          [new RegExp('^kubectl\\b.*\\brollout undo ' + DEP)], ['deployment.apps/web rolled back']],
        ['Ganti image container web di deployment web jadi nginx:1.27.', 'set image <deployment> <container>=<image>', 'kubectl set image deployment/web web=nginx:1.27',
          [new RegExp('^kubectl\\b.*\\bset image ' + DEP), /\sweb=nginx:1\.27\b/], ['deployment.apps/web image updated']],
        ['Buka Grafana di service grafana (port 3000) dari laptop lewat localhost:3000.', 'port-forward svc/<nama> <port>', 'kubectl port-forward svc/grafana 3000:3000',
          [/^kubectl\b.*\bport-forward (svc|services?)\/grafana\b/, /\s3000(:3000)?(\s|$)/], ['Forwarding from 127.0.0.1:3000 -> 3000', 'Forwarding from [::1]:3000 -> 3000']],
        ['Lihat pemakaian CPU dan memori tiap pod.', 'subcommand-nya sama seperti perintah top di Linux', 'kubectl top pods',
          [/^kubectl\b.*\btop (pods?|po)\b/], ['NAME       CPU(cores)   MEMORY(bytes)', 'web-7d9f   3m           42Mi', 'api-5c8b   12m          128Mi']],
        ['Pindah ke context prod-cluster.', 'config use-context <nama>', 'kubectl config use-context prod-cluster',
          [/^kubectl config use-context prod-cluster$/], ['Switched to context "prod-cluster".']],
        ['Jadikan monitoring namespace default untuk context yang sedang aktif.', 'config set-context --current --namespace=...', 'kubectl config set-context --current --namespace=monitoring',
          [[/^kubectl config set-context\b/, /--current\b/, /--namespace[= ]monitoring\b/], [/^kubens monitoring$/]], ['Context "prod-cluster" modified.']],
        ['Node worker-2 mau di-maintenance. Kosongkan pod-nya, pod DaemonSet biarkan saja.', 'drain plus opsi --ignore-daemonsets', 'kubectl drain worker-2 --ignore-daemonsets',
          [/^kubectl\b.*\bdrain (nodes?\/)?worker-2\b/, /--ignore-daemonsets\b/], ['node/worker-2 cordoned', 'evicting pod default/web-7d9f', 'node/worker-2 drained']],
        ['Buat secret generic bernama db-cred berisi username=admin.', 'create secret generic ... --from-literal=', 'kubectl create secret generic db-cred --from-literal=username=admin',
          [/^kubectl\b.*\bcreate secret generic db-cred\b/, /--from-literal[= ]username=admin\b/], ['secret/db-cred created']]
      ]
    }
  };
  if (EN) {
    var QUIZ_EN = {
      terraform: ['You\'re in a Terraform project folder with main.tf and variables.tf.', [
        ['The project folder was just cloned. Set up the backend and download the providers.', 'the first step before any plan/apply'],
        ['See what would change, without changing anything.', 'a 4-letter subcommand starting with "p"'],
        ['Save the plan to a file called tfplan, so what gets applied later is exactly the same.', 'use the -out option'],
        ['Apply changes in a CI pipeline, without the "yes" confirmation prompt.', 'apply with the auto-... option'],
        ['Format every .tf file, including the ones in the modules/ subfolder.', 'fmt plus an option to go into subfolders'],
        ['Check whether the configuration is syntactically valid.', 'the subcommand looks like the word "validate"'],
        ['List every resource recorded in the state.', 'state + the subcommand that lists'],
        ['See every attribute of aws_instance.web in the state.', 'state + the subcommand that shows details'],
        ['You renamed aws_instance.web to aws_instance.app in the code. Move it in the state too so it isn\'t recreated.', 'state + the subcommand that looks like mv in Linux'],
        ['The S3 bucket my-logs was created by hand in the console. Bring it into the state as aws_s3_bucket.logs.', 'import <resource address> <id>'],
        ['Force aws_instance.web to be recreated on apply (taint is deprecated).', 'apply with the -replace= option'],
        ['Plan only module.vpc.', 'the -target= option'],
        ['Upgrade providers to the newest version that still fits the version constraint.', 'init with an extra option'],
        ['Create a new workspace called staging (and switch to it).', 'workspace + the subcommand that creates'],
        ['Get the db_endpoint output value from the state.', 'the subcommand has the same name as the block in the code'],
        ['Delete every resource this project manages.', 'the opposite of apply']
      ]],
      ansible: ['There\'s an inventory hosts.ini (groups webservers and db) and a playbook site.yml.', [
        ['Check that every host in hosts.ini is reachable by Ansible.', 'ad-hoc against "all" with the ping module'],
        ['Run the site.yml playbook with the hosts.ini inventory.', 'ansible-playbook -i <inventory> <playbook>'],
        ['Dry-run site.yml (inventory hosts.ini) while showing a diff of file changes.', 'two options: --check and --diff'],
        ['Run site.yml (inventory hosts.ini) only against the webservers group.', 'the --limit or -l option'],
        ['Run site.yml (inventory hosts.ini) only for tasks tagged nginx.', 'the --tags or -t option'],
        ['Run site.yml (inventory hosts.ini) with the variable env=prod from the command line.', 'the -e or --extra-vars option'],
        ['Run site.yml (inventory hosts.ini), but ask for the sudo password first.', 'the --ask-become-pass option (capital K)'],
        ['Check the syntax of site.yml without running anything.', 'the --syntax-... option'],
        ['Show the groups and hosts in hosts.ini as a tree.', 'ansible-inventory with the --graph option'],
        ['Check the uptime of every host in the db group (inventory hosts.ini) with an ad-hoc command.', 'ansible <group> -a "<command>"'],
        ['See all facts for host web1 (inventory hosts.ini).', 'the module used by gather_facts'],
        ['Restart nginx on the webservers group (inventory hosts.ini) ad-hoc, with sudo.', '-m service -a "name=... state=..." plus -b'],
        ['Encrypt group_vars/all/vault.yml, which holds passwords.', 'ansible-vault + the subcommand that encrypts'],
        ['Edit secrets.yml, which is already vault-encrypted.', 'ansible-vault + the subcommand that edits'],
        ['Install every role listed in requirements.yml.', 'ansible-galaxy install -r ...'],
        ['Read the copy module docs right from the terminal.', 'ansible-doc <module name>']
      ]],
      kubernetes: ['kubectl is already connected to the cluster. The alias "k" for kubectl works too.', [
        ['List every pod in every namespace.', 'get pods plus the -A option'],
        ['List pods in the monitoring namespace only.', 'the -n <namespace> option'],
        ['Pod web-7d9f is stuck in Pending. Show its details and events.', 'the subcommand is the English verb for "explain"'],
        ['Follow the logs of pod api-5c8b live.', 'logs plus the -f option'],
        ['Pod api-5c8b is in CrashLoopBackOff. Show the logs from the container before it crashed.', 'logs plus the --previous option'],
        ['Open a shell inside pod web-7d9f.', 'exec -it <pod> -- sh'],
        ['Apply the deploy.yaml manifest to the cluster.', 'apply -f <file>'],
        ['Scale the web deployment to 5 replicas.', 'scale plus the --replicas option'],
        ['Restart every pod in the web deployment one by one (rolling).', 'rollout + the restart subcommand'],
        ['Watch whether the web deployment rollout has finished.', 'rollout + the status subcommand'],
        ['The new version of the web deployment is throwing errors. Roll back to the previous revision.', 'rollout + the undo subcommand'],
        ['Change the web container image in the web deployment to nginx:1.27.', 'set image <deployment> <container>=<image>'],
        ['Open Grafana from the grafana service (port 3000) on your laptop at localhost:3000.', 'port-forward svc/<name> <port>'],
        ['See CPU and memory usage per pod.', 'the subcommand is the same as Linux\'s top'],
        ['Switch to the prod-cluster context.', 'config use-context <name>'],
        ['Make monitoring the default namespace for the current context.', 'config set-context --current --namespace=...'],
        ['Node worker-2 is going into maintenance. Drain its pods, but leave DaemonSet pods alone.', 'drain plus the --ignore-daemonsets option'],
        ['Create a generic secret called db-cred containing username=admin.', 'create secret generic ... --from-literal=']
      ]]
    };
    Object.keys(QUIZ_EN).forEach(function (k) {
      QUIZ[k].intro = QUIZ_EN[k][0];
      QUIZ_EN[k][1].forEach(function (t, i) { QUIZ[k].qs[i][0] = t[0]; QUIZ[k].qs[i][1] = t[1]; });
    });
    QUIZ.kubernetes.start = 'kubectl (the alias k works too)';
    QUIZ.ansible.qs[5][4][1] = 'ok: [web1] => {"msg": "deploying to prod"}';
    QUIZ.ansible.qs[13][4][1] = '(editor opens, save and quit)';
  }
  var QUIZ_ALIAS = { tf: 'terraform', ans: 'ansible', k8s: 'kubernetes', kube: 'kubernetes', kubectl: 'kubernetes' };

  // keyboard HP suka ganti -- jadi — dan kutip jadi kutip miring
  function normCmd(v) {
    return v.replace(/—/g, '--').replace(/–/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
      .trim().replace(/\s+/g, ' ').replace(/^\$ /, '').replace(/^sudo /, '')
      .replace(/^k /, 'kubectl ').replace(/^tf /, 'terraform ');
  }

  function quizMatch(c, m) {
    var groups = m[0] instanceof RegExp ? [m] : m;
    return groups.some(function (g) { return g.every(function (re) { return re.test(c); }); });
  }

  // ilustrasi animasi (SVG + CSS) yang muncul saat kuis dimulai
  function hex(cx, cy, r) {
    var p = [];
    for (var a = 0; a < 6; a++) p.push((cx + r * Math.cos(a * Math.PI / 3)).toFixed(1) + ',' + (cy + r * Math.sin(a * Math.PI / 3)).toFixed(1));
    return p.join(' ');
  }
  var QUIZ_ART = {
    terraform: {
      color: '#844fba',
      caption: tr('terraform apply: kode di main.tf berubah jadi infrastruktur.', 'terraform apply: the code in main.tf becomes infrastructure.'),
      svg: '<rect class="qa-box" x="8" y="18" width="112" height="94" rx="8"/>' +
        '<text class="qa-dim" x="20" y="38">main.tf</text>' +
        '<rect class="qa-code" x="20" y="50" width="82" height="6" rx="3"/>' +
        '<rect class="qa-code" x="32" y="64" width="64" height="6" rx="3"/>' +
        '<rect class="qa-code" x="32" y="78" width="74" height="6" rx="3"/>' +
        '<rect class="qa-code" x="20" y="92" width="40" height="6" rx="3"/>' +
        '<line class="qa-line" x1="128" y1="65" x2="206" y2="65"/>' +
        '<text class="qa-dim" x="167" y="55" text-anchor="middle">apply</text>' +
        '<circle class="qa-dot qa-tf-dot" cx="128" cy="65" r="5"/>' +
        ['aws_vpc.main', 'aws_instance.web', 'aws_db.main'].map(function (n, i) {
          return '<g class="qa-pop" style="animation-delay:' + (i * 0.35) + 's">' +
            '<rect class="qa-res" x="214" y="' + (14 + i * 37) + '" width="138" height="28" rx="6"/>' +
            '<text class="qa-t" x="226" y="' + (32 + i * 37) + '">+ ' + n + '</text></g>';
        }).join('')
    },
    ansible: {
      color: '#e5484d',
      caption: tr('ansible-playbook: satu playbook, semua server dikonfigurasi lewat SSH.', 'ansible-playbook: one playbook configures every server over SSH.'),
      svg: '<rect class="qa-box" x="8" y="38" width="100" height="54" rx="8"/>' +
        '<text class="qa-t" x="58" y="61" text-anchor="middle">ansible</text>' +
        '<text class="qa-dim" x="58" y="79" text-anchor="middle">site.yml</text>' +
        ['web1', 'web2', 'db1'].map(function (n, i) {
          var y = 25 + i * 40, d = (i * 0.3) + 's';
          return '<line class="qa-line" x1="108" y1="65" x2="236" y2="' + y + '"/>' +
            '<circle class="qa-dot qa-an-dot" cx="108" cy="65" r="5" style="--dx:128px;--dy:' + (y - 65) + 'px;animation-delay:' + d + '"/>' +
            '<rect class="qa-box" x="236" y="' + (y - 15) + '" width="116" height="30" rx="6"/>' +
            '<text class="qa-t" x="248" y="' + (y + 4) + '">' + n + '</text>' +
            '<circle class="qa-led" cx="336" cy="' + y + '" r="6" style="animation-delay:' + d + '"/>';
        }).join('')
    },
    kubernetes: {
      color: '#326ce5',
      caption: tr('Kubernetes self-healing: pod yang crash langsung diganti pod baru.', 'Kubernetes self-healing: a crashed pod is replaced by a new one right away.'),
      svg: '<rect class="qa-box qa-cluster" x="8" y="8" width="344" height="114" rx="10"/>' +
        '<text class="qa-dim" x="22" y="28">deployment/web · replicas: 3</text>' +
        [70, 180].map(function (x, i) {
          return '<g class="qa-pulse" style="animation-delay:' + (i * 0.5) + 's"><polygon class="qa-pod" points="' + hex(x, 75, 26) + '"/>' +
            '<text class="qa-pod-t" x="' + x + '" y="79" text-anchor="middle">pod</text></g>';
        }).join('') +
        '<g class="qa-crash"><polygon class="qa-pod qa-pod-bad" points="' + hex(290, 75, 26) + '"/>' +
        '<text class="qa-pod-t" x="290" y="79" text-anchor="middle">crash</text></g>' +
        '<g class="qa-heal"><polygon class="qa-pod" points="' + hex(290, 75, 26) + '"/>' +
        '<text class="qa-pod-t" x="290" y="79" text-anchor="middle">pod</text></g>'
    }
  };

  function quizArt(key) {
    var A = QUIZ_ART[key];
    if (!A) return;
    var el = line('', 'qa');
    el.style.setProperty('--qc', A.color);
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<svg viewBox="0 0 360 130" role="presentation">' + A.svg + '</svg>';
    line(A.caption, 'term-dim');
  }

  function quizMenu() {
    line(tr('🧪 Kuis hands-on: jawab tiap skenario dengan perintah yang benar.', '🧪 Hands-on quiz: answer each scenario with the right command.'));
    Object.keys(QUIZ).forEach(function (k) {
      line(frag(cmdButton('quiz ' + k), ' '.repeat(17 - ('quiz ' + k).length) + QUIZ[k].qs.length + tr(' skenario, 5 soal acak per ronde', ' scenarios, 5 random questions per round')));
    });
    line(tr('Alias: quiz tf, quiz k8s. "hint" untuk petunjuk, "skip" untuk lewati, "q" untuk keluar.', 'Aliases: quiz tf, quiz k8s. "hint" for a hint, "skip" to pass, "q" to quit.'), 'term-dim');
  }

  function startQuiz(key) {
    var Z = QUIZ[key];
    var qs = shuffle(Z.qs).slice(0, 5);
    var i = 0, score = 0, tries = 0;
    function ask() {
      line(frag(span('[' + (i + 1) + '/' + qs.length + '] ', 'term-dim'), span(qs[i][0], 'term-hl')));
    }
    function hint() { line(tr('💡 Petunjuk: ', '💡 Hint: ') + qs[i][1], 'term-dim'); }
    function reveal() { line(frag(tr('Jawabannya: ', 'Answer: '), span(qs[i][2], 'term-hl')), 'term-dim'); }
    function next() {
      i++; tries = 0;
      if (i < qs.length) return ask();
      scoreLine(score, qs.length, 'quiz-' + key);
      line(tr('Main lagi: quiz ', 'Play again: quiz ') + key + tr(' (soalnya diacak tiap ronde)', ' (questions are shuffled every round)'), 'term-dim');
      stopGame();
    }
    line(frag(span(tr('🧪 Kuis ', '🧪 Quiz: ') + Z.title, 'term-hl'), tr(': 5 skenario, ketik perintah lengkapnya. Tiap soal dapat 2 kesempatan.', ': 5 scenarios, type the full command. 2 tries each.')));
    quizArt(key);
    line(Z.intro + tr(' Ketik "hint", "skip", atau "q".', ' Type "hint", "skip", or "q".'), 'term-dim');
    ask();
    return {
      prompt: key + '$',
      keepCase: true,
      chips: ['hint', 'skip', 'q'],
      input: function (raw) {
        var c = normCmd(raw), low = c.toLowerCase();
        if (low === 'hint' || low === 'petunjuk') { tries = Math.max(tries, 1); return hint(); }
        if (low === 'skip') { reveal(); return next(); }
        var q = qs[i];
        if (quizMatch(c, q[3])) {
          score++;
          line(q[4].join('\n'), 'term-dim term-sim');
          line(tr('✔ Benar!', '✔ Correct!') + (c !== q[2] ? tr(' Versi saya: ', ' Mine: ') + q[2] : ''), 'term-ok');
          return next();
        }
        if (!Z.tool.test(c)) return err(tr('Ini kuis ', 'This is the ') + Z.title + tr(', perintahnya diawali ', ' quiz, commands start with ') + Z.start + '.');
        if (tries++ === 0) { err(tr('✘ Belum tepat. Coba lagi.', '✘ Not quite. Try again.')); return hint(); }
        err(tr('✘ Masih belum.', '✘ Still not it.'));
        reveal();
        next();
      }
    };
  }

  function quizCmd(args) {
    var k = (args[0] || '').toLowerCase();
    k = QUIZ_ALIAS[k] || k;
    if (!k) return quizMenu();
    if (k === 'random' || k === 'acak') { var ks = Object.keys(QUIZ); k = ks[Math.floor(Math.random() * ks.length)]; }
    if (!QUIZ[k]) { err('quiz: "' + k + tr('" belum ada.', '" doesn\'t exist yet.')); return quizMenu(); }
    game = startQuiz(k);
    setPrompt(game.prompt);
  }

  // ---------- htop (palsu, tapi animasinya beneran) ----------
  function startHtop() {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var CORES = 4;
    var MEM_TOTAL = 15.5 * 1024; // MB
    var nextPid = 4200;
    var t0 = Date.now();
    // [cmd, user, cpu dasar (% 1 core), RES MB, respawn?, catatan kill]
    var BASE = [
      ['/usr/lib/systemd/systemd --switched-root --system', 'root', 0.2, 14, 'pid1'],
      ['/usr/sbin/sshd -D', 'root', 0.1, 9, true, tr('Hati-hati, kalau ini server remote kamu barusan ngunci diri sendiri. 🔒', 'Careful, if this were a remote server you just locked yourself out. 🔒')],
      ['/usr/bin/containerd', 'root', 1.4, 62, true],
      ['/usr/bin/dockerd -H fd://', 'root', 1.1, 98, true],
      ['/usr/bin/kubelet --config=/var/lib/kubelet/config.yaml', 'root', 3.2, 140, true, tr('kubelet mati, node jadi NotReady. Untung cuma sebentar.', 'kubelet died, the node went NotReady. Luckily just for a moment.')],
      ['/usr/bin/prometheus --storage.tsdb.retention=15d', 'prometheus', 4.5, 610, true, tr('Prometheus mati = alert juga ikut diam. Itu justru yang paling serem. 👻', 'Prometheus down = alerts go quiet too. That\'s the scariest part. 👻')],
      ['/usr/bin/node_exporter', 'prometheus', 0.6, 22, true],
      ['/usr/sbin/grafana-server', 'grafana', 1.2, 180, true],
      ['vault server -config=/etc/vault.d/vault.hcl', 'vault', 0.5, 95, true, tr('Vault restart dalam keadaan sealed. Siapkan unseal key kamu. 🔐', 'Vault restarted sealed. Get your unseal keys ready. 🔐')],
      ['postgres: checkpointer', 'postgres', 0.8, 240, true],
      ['redis-server *:6379', 'redis', 0.7, 48, true],
      ['nginx: worker process', 'nginx', 0.9, 16, true, tr('nginx mati, pengunjung dapat 502. Untung systemd sigap.', 'nginx died, visitors got a 502. Good thing systemd is quick.')],
      ['hugo server -D --bind 0.0.0.0', 'rifki', 2.0, 130, false],
      ['n8n start', 'rifki', 1.0, 210, false],
      ['/opt/google/chrome/chrome --type=renderer (42 tab)', 'rifki', 9, 3170, 'chrome'],
      [tr('kopi-daemon --dosis=secukupnya', 'kopi-daemon --dose=just-enough'), 'rifki', 0.3, 7, 'kopi'],
      ['-zsh', 'rifki', 0, 11, false],
      ['htop', 'rifki', 1.5, 6, 'self']
    ];
    var JOBS = [
      ['terraform apply -auto-approve', 85, 160],
      ['ansible-playbook -i inventory site.yml', 60, 120],
      ['kubectl get pods -A -w', 12, 45],
      ['git push origin main', 25, 20],
      ['zypper dup --no-confirm', 70, 90],
      ['docker build -t web:latest .', 95, 300]
    ];
    function mk(b) {
      return { pid: b[1] === 'root' && b[0].indexOf('systemd') !== -1 ? 1 : (nextPid += 3 + Math.floor(Math.random() * 40)),
        cmd: b[0], user: b[1], base: b[2], res: b[3], kind: b[4], note: b[5], cpu: b[2], time: Math.random() * 90 };
    }
    var procs = BASE.map(mk);
    var self = procs[procs.length - 1];
    var sel = null;
    var sortKeys = ['cpu', 'mem', 'pid', 'time'];
    var sortLabel = { cpu: 'CPU%', mem: 'MEM%', pid: 'PID', time: 'TIME+' };
    var sortBy = 'cpu';
    var load = [0.62, 0.55, 0.48];
    var nextJob = Date.now() + 3000;
    var timers = [];
    var msg = tr('Tekan h buat bantuan, q buat keluar.', 'Press h for help, q to quit.');

    // ---- DOM ----
    function el(tag, cls, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined) e.textContent = text;
      return e;
    }
    var root = el('div', 'htop');
    root.setAttribute('aria-label', tr('htop: daftar proses (simulasi)', 'htop: process list (simulated)'));
    var meters = el('div', 'ht-meters');
    var colL = el('div', 'ht-col');
    var colR = el('div', 'ht-col');
    meters.appendChild(colL); meters.appendChild(colR);
    function meter(parent, label, segs) {
      var m = el('div', 'ht-meter');
      m.appendChild(el('span', 'ht-lbl', label));
      m.appendChild(el('span', 'ht-br', '['));
      var tr = el('span', 'ht-track');
      var s = segs.map(function (c) { var x = el('span', 'ht-seg ' + c); tr.appendChild(x); return x; });
      var v = el('span', 'ht-val');
      tr.appendChild(v);
      m.appendChild(tr);
      m.appendChild(el('span', 'ht-br', ']'));
      parent.appendChild(m);
      return { segs: s, val: v };
    }
    var cpuM = [];
    for (var c = 0; c < CORES; c++) cpuM.push(meter(colL, String(c + 1), ['ht-low', 'ht-usr', 'ht-sys']));
    var memM = meter(colL, 'Mem', ['ht-usr', 'ht-buf', 'ht-cache']);
    var swpM = meter(colL, 'Swp', ['ht-sys']);
    var tasksEl = el('div', 'ht-info');
    var loadEl = el('div', 'ht-info');
    var upEl = el('div', 'ht-info');
    colR.appendChild(tasksEl); colR.appendChild(loadEl); colR.appendChild(upEl);
    var msgEl = el('div', 'ht-msg');
    var table = el('div', 'ht-table');
    var head = el('div', 'ht-row ht-head');
    var COLS = [['pid', 'PID'], ['user', 'USER'], ['pri', 'PRI'], ['ni', 'NI'], ['virt', 'VIRT'], ['res', 'RES'], ['shr', 'SHR'],
      ['s', 'S'], ['cpu', 'CPU%'], ['mem', 'MEM%'], ['time', 'TIME+'], ['cmd', 'Command']];
    COLS.forEach(function (col) {
      var h = el('span', 'ht-c-' + col[0], col[1]);
      h.dataset.sort = col[0];
      head.appendChild(h);
    });
    table.appendChild(head);
    var body = el('div', 'ht-body');
    table.appendChild(body);
    var foot = el('div', 'ht-foot');
    [['F1', 'Help', 'h'], ['F3', 'Search', '-'], ['F5', 'Tree', '-'], ['F6', 'SortBy', 's'], ['F9', 'Kill', 'k'], ['F10', 'Quit', 'q']].forEach(function (f) {
      var b = el('button', 'ht-fkey');
      b.type = 'button';
      b.dataset.key = f[2];
      b.appendChild(el('span', 'ht-fk', f[0]));
      b.appendChild(el('span', 'ht-fl', f[1]));
      foot.appendChild(b);
    });
    root.appendChild(meters); root.appendChild(msgEl); root.appendChild(table); root.appendChild(foot);

    // ---- format ----
    function mem(mb) {
      if (mb >= 1024) return (mb / 1024).toFixed(mb >= 10240 ? 1 : 2) + 'G';
      return Math.round(mb) + 'M';
    }
    function clock(s) {
      var m = Math.floor(s / 60), r = s % 60;
      return m + ':' + (r < 10 ? '0' : '') + r.toFixed(2);
    }
    function two(n) { return (n < 10 ? '0' : '') + n; }
    function setBar(m, parts, text) {
      var left = 100;
      parts.forEach(function (p, i) {
        var w = Math.max(0, Math.min(left, p));
        left -= w;
        m.segs[i].style.width = w.toFixed(1) + '%';
      });
      m.val.textContent = text;
    }

    // ---- simulasi ----
    function step() {
      var now = Date.now();
      if (now > nextJob) {
        var j = JOBS[Math.floor(Math.random() * JOBS.length)];
        var p = mk([j[0], 'rifki', j[1], j[2], 'job']);
        p.ttl = now + 3500 + Math.random() * 4000;
        p.time = 0;
        procs.push(p);
        nextJob = now + 6000 + Math.random() * 6000;
      }
      procs = procs.filter(function (p) { return !p.ttl || p.ttl > now; });
      var total = 0;
      procs.forEach(function (p) {
        var spike = Math.random() < 0.06 ? 3 + Math.random() * 6 : 1;
        p.cpu = Math.max(0, p.base * (0.55 + Math.random() * 0.9) * spike);
        if (p.kind === 'job') p.cpu = Math.min(100, p.cpu);
        p.time += p.cpu / 100;
        p.res = Math.max(4, p.res * (0.995 + Math.random() * 0.01));
        total += p.cpu;
      });
      var w = [], ws = 0;
      for (var i = 0; i < CORES; i++) { w.push(0.4 + Math.random()); ws += w[i]; }
      cpuM.forEach(function (m, i) {
        var u = Math.min(98, total * w[i] / ws + Math.random() * 2);
        var low = u * 0.08, sys = u * 0.22, usr = u - low - sys;
        setBar(m, [low, usr, sys], u.toFixed(1) + '%');
      });
      var used = 1200 + procs.reduce(function (a, p) { return a + p.res; }, 0);
      var buf = 310, cache = 2900 + Math.sin(now / 9000) * 300;
      setBar(memM, [used / MEM_TOTAL * 100, buf / MEM_TOTAL * 100, cache / MEM_TOTAL * 100], mem(used) + '/' + mem(MEM_TOTAL));
      setBar(swpM, [1.2], '24.0M/2.00G');
      var running = procs.filter(function (p) { return p.cpu > 8 || p === self; }).length;
      tasksEl.textContent = '';
      tasksEl.appendChild(frag(span('Tasks: ', 'ht-k'), span(String(procs.length + 117), 'ht-v'), span(', ' + (480 + procs.length * 3) + ' thr; ', 'ht-k'), span(running + ' running', 'ht-v')));
      var L = total / 100;
      load = [load[0] * 0.8 + L * 0.2, load[1] * 0.95 + L * 0.05, load[2] * 0.985 + L * 0.015];
      loadEl.textContent = '';
      loadEl.appendChild(frag(span('Load average: ', 'ht-k'), span(load[0].toFixed(2) + ' ', 'ht-v'), span(load[1].toFixed(2) + ' ' + load[2].toFixed(2), 'ht-k')));
      var s = Math.floor((now - started) / 1000) + 3 * 86400 + 4 * 3600 + 17 * 60;
      upEl.textContent = '';
      upEl.appendChild(frag(span('Uptime: ', 'ht-k'), span(Math.floor(s / 86400) + ' days, ' + two(Math.floor(s / 3600) % 24) + ':' + two(Math.floor(s / 60) % 60) + ':' + two(s % 60), 'ht-v')));
      draw();
    }

    function sorted() {
      return procs.slice().sort(function (a, b) {
        if (sortBy === 'pid') return a.pid - b.pid;
        if (sortBy === 'mem') return b.res - a.res;
        if (sortBy === 'time') return b.time - a.time;
        return b.cpu - a.cpu;
      });
    }

    function draw() {
      if (!procs.some(function (p) { return p.pid === sel; })) sel = sorted()[0].pid;
      Array.prototype.forEach.call(head.children, function (h) { h.classList.toggle('is-sort', h.dataset.sort === sortBy); });
      body.textContent = '';
      sorted().forEach(function (p) {
        var r = el('div', 'ht-row' + (p.pid === sel ? ' is-sel' : '') + (p.kind === 'job' ? ' is-new' : ''));
        r.dataset.pid = p.pid;
        var st = p === self || p.cpu > 8 ? 'R' : 'S';
        var vals = {
          pid: p.pid, user: p.user, pri: 20, ni: 0, virt: mem(p.res * 3.4 + 180), res: mem(p.res), shr: mem(Math.min(p.res * 0.3, 90)),
          s: st, cpu: p.cpu.toFixed(1), mem: (p.res / MEM_TOTAL * 100).toFixed(1), time: clock(p.time), cmd: p.cmd
        };
        COLS.forEach(function (col) {
          var cls = 'ht-c-' + col[0];
          if (col[0] === 'user' && p.user === 'root') cls += ' ht-root';
          if (col[0] === 's' && st === 'R') cls += ' ht-run';
          if (col[0] === 'cpu' && p.cpu > 50) cls += ' ht-hot';
          r.appendChild(el('span', cls, String(vals[col[0]])));
        });
        body.appendChild(r);
      });
      msgEl.textContent = msg;
      fit();
    }

    // daftar proses di-scroll sendiri supaya meter, F-key, dan prompt selalu kelihatan
    function fit() {
      var cs = getComputedStyle(screen);
      var avail = screen.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - form.offsetHeight - 12;
      body.style.maxHeight = Math.max(90, avail - (root.offsetHeight - body.offsetHeight)) + 'px';
    }

    function say(t) { msg = t; msgEl.textContent = t; fit(); }
    function later(fn, ms) { timers.push(setTimeout(fn, ms)); }

    function move(d) {
      var list = sorted();
      var i = list.findIndex(function (p) { return p.pid === sel; });
      i = Math.max(0, Math.min(list.length - 1, i + d));
      sel = list[i].pid;
      draw();
      var r = body.querySelector('.is-sel');
      if (!r) return;
      if (r.offsetTop < body.scrollTop) body.scrollTop = r.offsetTop;
      else if (r.offsetTop + r.offsetHeight > body.scrollTop + body.clientHeight) body.scrollTop = r.offsetTop + r.offsetHeight - body.clientHeight;
    }

    function kill(p) {
      if (!p) return;
      if (p.kind === 'pid1') {
        say(tr('Nice try. PID 1 nggak bisa di-kill, kernel-nya bisa ngambek. 😅', 'Nice try. PID 1 can\'t be killed, the kernel would sulk. 😅'));
        screen.classList.add('term-shake');
        later(function () { screen.classList.remove('term-shake'); }, 500);
        return;
      }
      if (p.kind === 'self') { stopGame(tr('htop: dibunuh oleh dirinya sendiri. Filosofis. 🤔', 'htop: killed by itself. How philosophical. 🤔')); return; }
      procs = procs.filter(function (x) { return x !== p; });
      var name = p.cmd.split(' ')[0].split('/').pop().replace(/:$/, '');
      if (p.kind === 'chrome') say(tr('Chrome ditutup, RAM lega ', 'Chrome closed, freed ') + mem(p.res) + tr('. 42 tab itu sebenarnya mau dibaca kapan? 🎉', ' of RAM. Were you ever going to read those 42 tabs? 🎉'));
      else if (p.kind === 'kopi') {
        say(tr('☕ kopi-daemon mati. Produktivitas turun 80%...', '☕ kopi-daemon died. Productivity down 80%...'));
        later(function () { if (game && game.htop) { procs.push(mk(BASE[15])); say(tr('☕ systemd: kopi-daemon.service dinyalakan lagi. Fiuh.', '☕ systemd: kopi-daemon.service started again. Phew.')); draw(); } }, 3000);
      } else if (p.kind === true) {
        say(tr('SIGTERM ke ', 'SIGTERM to ') + p.pid + ' (' + name + '). ' + (p.note || tr('Tenang, ada systemd.', 'Relax, systemd has it.')));
        var b = BASE.filter(function (x) { return x[0] === p.cmd; })[0];
        later(function () {
          if (!game || !game.htop) return;
          var n = mk(b); procs.push(n);
          say('systemd: ' + name + tr('.service restart otomatis jadi PID ', '.service restarted automatically as PID ') + n.pid + ' (Restart=always).');
          draw();
        }, 2500);
      } else say(tr('SIGTERM ke ', 'SIGTERM to ') + p.pid + ' (' + name + tr('). Proses selesai.', '). Process ended.'));
      draw();
    }

    function act(k) {
      if (k === 'up' || k === '↑') return move(-1);
      if (k === 'down' || k === '↓') return move(1);
      if (k === 's' || k === 'f6' || k === '>') {
        sortBy = sortKeys[(sortKeys.indexOf(sortBy) + 1) % sortKeys.length];
        say(tr('Diurutkan berdasarkan ', 'Sorted by ') + sortLabel[sortBy] + '.');
        return draw();
      }
      if (k === 'k' || k === 'f9') return kill(procs.filter(function (p) { return p.pid === sel; })[0]);
      if (k === 'h' || k === 'f1' || k === '?') return say(tr('↑/↓ pilih proses · k/F9 kill · s/F6 urutkan · q/F10 keluar. Di HP tinggal tap baris prosesnya.', '↑/↓ select a process · k/F9 kill · s/F6 sort · q/F10 quit. On a phone, just tap a process row.'));
      if (k === '-') return say(tr('Fitur ini belum ada di versi web. Pakai htop beneran ya. 😉', 'That isn\'t in the web version yet. Use the real htop. 😉'));
      if (k === 'q' || k === 'f10') return stopGame();
      var m = /^(?:k|kill)\s+(\d+)$/.exec(k);
      if (m) {
        var p = procs.filter(function (x) { return x.pid === +m[1]; })[0];
        return p ? kill(p) : say('kill: PID ' + m[1] + tr(' nggak ada.', ' doesn\'t exist.'));
      }
      say(tr('Tombol "', 'Key "') + k + tr('" nggak dikenal. Tekan h buat bantuan.', '" isn\'t recognized. Press h for help.'));
    }

    root.addEventListener('click', function (e) {
      // di desktop fokus tetap di input supaya tombol keyboard (q, k, panah) jalan terus
      if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) input.focus({ preventScroll: true });
      var f = e.target.closest('.ht-fkey');
      if (f) return act(f.dataset.key);
      var h = e.target.closest('.ht-head span');
      if (h && sortLabel[h.dataset.sort]) { sortBy = h.dataset.sort; say(tr('Diurutkan berdasarkan ', 'Sorted by ') + sortLabel[sortBy] + '.'); return draw(); }
      var r = e.target.closest('.ht-row[data-pid]');
      if (r) { sel = +r.dataset.pid; draw(); }
    });

    var row = line(root, 'term-htop-row');
    screen.classList.add('term-htop-on');
    step();
    var iv = setInterval(step, reduce ? 2500 : 1200);
    window.addEventListener('resize', fit);

    return {
      htop: true,
      prompt: 'htop>',
      silent: true,
      hotkeys: true,
      chips: ['↑', '↓', 'k', 's', 'h', 'q'],
      input: act,
      stop: function () {
        clearInterval(iv);
        window.removeEventListener('resize', fit);
        timers.forEach(clearTimeout);
        screen.classList.remove('term-htop-on');
        if (row.parentNode) row.parentNode.removeChild(row);
        line(tr('htop selesai. Server aman, kopi masih ada. ☕', 'htop closed. Servers are fine, coffee\'s still there. ☕'), 'term-dim');
      }
    };
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
  if (EN) FORTUNES = ['It works on my machine. ¯\\_(ツ)_/¯', 'There\'s always one server that isn\'t in the Ansible inventory.', 'A backup you\'ve never restored is just a hope.', 'Deploying on a Friday afternoon: brave, but not wise.', 'If an alert fires every hour, eventually nobody listens.', 'DNS. It\'s always DNS.', 'Idempotence isn\'t a spell, it\'s a habit.', 'chmod 777 isn\'t a fix, it\'s a confession.'];

  var COMMANDS = {
    help: {
      desc: tr('daftar perintah', 'list commands'),
      run: function () {
        line(tr('Perintah yang tersedia:', 'Available commands:'));
        Object.keys(COMMANDS).forEach(function (k) {
          if (COMMANDS[k].hidden) return;
          line(frag(span(k.padEnd(10), 'term-hl'), COMMANDS[k].desc));
        });
        line(tr('Tips: Tab untuk melengkapi, ↑/↓ untuk riwayat. Ada beberapa perintah rahasia juga. 😉', 'Tips: Tab to complete, ↑/↓ for history. There are a few secret commands too. 😉'), 'term-dim');
      }
    },
    whoami: {
      desc: tr('siapa saya', 'who am I'),
      run: function () {
        line(span(D.name || USER, 'term-hl'));
        if (D.roles && D.roles.length) line(D.roles.join(' · '), 'term-dim');
        line(tr('Tulisan lengkapnya: cat tentang', 'The full story: cat about'), 'term-dim');
      }
    },
    ls: {
      desc: tr('lihat isi folder (ls -a juga bisa)', 'list folder contents (ls -a works too)'),
      run: function (args) {
        var all = args.indexOf('-a') !== -1 || args.indexOf('-la') !== -1 || args.indexOf('-al') !== -1;
        var target = args.filter(function (a) { return a.charAt(0) !== '-'; })[0];
        var r = resolve(target === undefined ? '.' : target);
        if (!r) return err('ls: ' + target + tr(': folder nggak ditemukan', ': folder not found'));
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
      desc: tr('pindah folder', 'change folder'),
      run: function (args) {
        var r = resolve(args[0]);
        if (!r) return err('cd: ' + args[0] + tr(': folder nggak ditemukan', ': folder not found'));
        if (r.node.type !== 'dir') return err('cd: ' + args[0] + tr(': bukan folder. Coba: cat ', ': not a folder. Try: cat ') + args[0]);
        cwd = r.parts;
      }
    },
    pwd: { desc: tr('folder sekarang', 'current folder'), run: function () { line('/home/' + USER + (cwd.length ? '/' + cwd.join('/') : '')); } },
    cat: {
      desc: tr('baca ringkasan file', 'read a file summary'),
      run: function (args) {
        if (!args.length) return err(tr('cat: mau baca file apa? Contoh: cat tentang', 'cat: which file? Example: cat about'));
        var r = resolve(args[0]);
        if (!r) return err('cat: ' + args[0] + tr(': file nggak ditemukan', ': file not found'));
        if (r.node.type === 'dir') return err('cat: ' + args[0] + tr(': itu folder. Coba: ls ', ': that\'s a folder. Try: ls ') + args[0]);
        var m = r.node.meta;
        if (m.readme) {
          line(tr('Halo! Ini terminal mini di web saya. Semua tulisan ada di posts/, contekan di cheatsheet/.', 'Hi! This is the mini terminal on my site. All posts are in posts/, cheat sheets in cheatsheet/.'));
          line(tr('Pakai "cat" untuk baca ringkasan dan "open" untuk buka halamannya.', 'Use "cat" to read a summary and "open" to open the page.'));
          return;
        }
        if (m.secret) {
          line(tr('🔐 Isinya cuma satu baris:', '🔐 It\'s just one line:'));
          line(tr('"Jangan pernah commit file .env ke git." Itu saja rahasianya.', '"Never commit your .env file to git." That\'s the whole secret.'), 'term-hl');
          return;
        }
        if (m.stack) return line(m.title + tr(': salah satu tool yang saya pakai sehari-hari.', ': one of the tools I use every day.'));
        line(span(m.title, 'term-hl'));
        if (m.date && m.date.indexOf('0001') !== 0) line(m.date, 'term-dim');
        if (m.summary) line(m.summary);
        line(frag('→ ', link(tr('baca selengkapnya', 'read more'), m.url)), 'term-dim');
      }
    },
    open: {
      desc: tr('buka halaman tulisan', 'open a page'),
      run: function (args) {
        if (!args.length) return err(tr('open: mau buka apa? Contoh: open tentang', 'open: open what? Example: open about'));
        var r = resolve(args[0]);
        if (!r || r.node.type !== 'file' || !r.node.meta.url) return err('open: ' + args[0] + tr(': nggak bisa dibuka', ': can\'t be opened'));
        line(tr('Membuka ', 'Opening ') + r.node.meta.title + '…', 'term-dim');
        setTimeout(function () { window.location.href = r.node.meta.url; }, 300);
      }
    },
    tree: {
      desc: tr('lihat struktur folder', 'show the folder tree'),
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
      desc: tr('info "sistem"', '"system" info'),
      run: function () {
        // openSUSE logo, as drawn by neofetch (big and small variants)
        var artBig = String.raw`           .;ldkO0000Okdl;.
       .;d00xl:^''''''^:ok00d;.
     .d00l'                'o00d.
   .d0Kd'  Okxol:;,.          :O0d.
  .OKKKK0kOKKKKKKKKKKOxo:,      lKO.
 ,0KKKKKKKKKKKKKKKK0P^,,,^dx:    ;00,
.OKKKKKKKKKKKKKKKKk'.oOPPb.'0k.   cKO.
:KKKKKKKKKKKKKKKKK: kKx..dd lKd   'OK:
dKKKKKKKKKKKOx0KKKd ^0KKKO' kKKc   dKd
dKKKKKKKKKKKK;.;oOKx,..^..;kKKK0.  dKd
:KKKKKKKKKKKK0o;...^cdxxOK0O/^^'  .0K:
 kKKKKKKKKKKKKKKK0x;,,......,;od  lKk
 '0KKKKKKKKKKKKKKKKKKKKK00KKOo^  c00'
  'kKKKOxddxkOO00000Okxoc;''   .dKk'
    l0Ko.                    .c00l'
     'l0Kk:.              .;xK0l'
        'lkK0xl:;,,,,;:ldO0kl'
            '^:ldxkkkkxdl:^'`;
        var artSmall = String.raw`  _______
__|   __ \
     / .\ \
     \__/ |
   _______|
   \_______
__________/`;
        var info = [
          [USER + '@' + HOST, ''],
          ['-----------', ''],
          ['OS', tr('openSUSE Tumbleweed (versi web)', 'openSUSE Tumbleweed (web edition)')],
          ['Host', 'GitHub Pages'],
          ['Shell', 'rifki-sh 1.0'],
          ['Role', (D.roles || [])[0] || 'DevOps'],
          ['Stack', (D.stack || []).slice(0, 5).join(', ')],
          ['Uptime', uptime()],
          [tr('Kopi', 'Coffee'), tr('secukupnya ☕', 'just enough ☕')]
        ];
        var pre = document.createElement('div');
        pre.className = 'term-neofetch';
        var a = document.createElement('div');
        a.className = 'term-art';
        a.setAttribute('aria-label', tr('Logo openSUSE', 'openSUSE logo'));
        a.appendChild(span(artBig, 'term-art-big'));
        a.appendChild(span(artSmall, 'term-art-small'));
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
    htop: {
      desc: tr('pantau proses ala htop 📊 (q buat keluar)', 'watch processes htop-style 📊 (q to quit)'),
      run: function () { game = startHtop(); }
    },
    game: { desc: tr('main game 🎮 (port, http, cmd, angka, ketik)', 'play a game 🎮 (port, http, cmd, number, typing)'), run: function (args) { gameStart(args); } },
    quiz: { desc: tr('kuis hands-on 🧪 (terraform, ansible, kubernetes)', 'hands-on quiz 🧪 (terraform, ansible, kubernetes)'), run: function (args) { quizCmd(args); } },
    fortune: { desc: tr('kutipan acak', 'random quote'), run: function () { line(FORTUNES[Math.floor(Math.random() * FORTUNES.length)]); } },
    social: {
      desc: tr('akun media sosial', 'social media accounts'),
      run: function () {
        (D.socials || []).forEach(function (s) {
          var ext = /^https?:/.test(s.url);
          line(frag(span(s.name.padEnd(10), 'term-hl'), link(s.url.replace(/^https?:\/\//, ''), s.url, ext)));
        });
      }
    },
    theme: {
      desc: tr('ganti mode terang/gelap', 'toggle light/dark mode'),
      run: function () {
        var t = document.getElementById('theme-toggle');
        if (!t) return err(tr('theme: tombol tema nggak tersedia', 'theme: the theme button isn\'t available'));
        t.click();
        line(tr('Mode sekarang: ', 'Mode now: ') + (document.documentElement.dataset.theme === 'dark' ? tr('gelap 🌙', 'dark 🌙') : tr('terang ☀️', 'light ☀️')));
      }
    },
    history: { desc: tr('riwayat perintah', 'command history'), run: function () { hist.forEach(function (h, i) { line(String(i + 1).padStart(4) + '  ' + h); }); } },
    echo: { desc: tr('cetak teks', 'print text'), run: function (args) { line(args.join(' ').replace(/\$USER/g, USER).replace(/\$ROLE/g, (D.roles || [])[0] || '')); } },
    date: { desc: tr('tanggal dan jam', 'date and time'), run: function () { line(new Date().toString()); } },
    clear: { desc: tr('bersihkan layar', 'clear the screen'), run: function () { out.textContent = ''; } },
    exit: {
      desc: tr('kembali ke beranda', 'back to the homepage'),
      run: function () {
        line('logout', 'term-dim');
        setTimeout(function () { window.location.href = D.home || '/'; }, 400);
      }
    },

    // ---------- easter eggs ----------
    sudo: {
      hidden: true,
      run: function (args) {
        if (args.join(' ') === 'make me a sandwich') return line(tr('Oke. 🥪', 'Okay. 🥪'));
        err(USER + ' is not in the sudoers file. This incident will be reported. 🚨');
      }
    },
    rm: {
      hidden: true,
      run: function (args) {
        if (/-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r/.test(args.join(' ')) && /(^|\s)(\/|~|\*|\/\*)(\s|$)/.test(args.join(' '))) {
          err(tr('Wah, jangan dong. 😱 Untung ini cuma terminal mainan.', 'Whoa, please don\'t. 😱 Good thing this is just a toy terminal.'));
          screen.classList.add('term-shake');
          setTimeout(function () { screen.classList.remove('term-shake'); }, 500);
          return;
        }
        err(tr('rm: filesystem ini read-only. Tulisannya aman. 😄', 'rm: this filesystem is read-only. The posts are safe. 😄'));
      }
    },
    vim: { hidden: true, run: function () { line(tr('Keluar dari vim itu susah, jadi sengaja nggak saya pasang di sini. 🙃', 'Quitting vim is hard, so I didn\'t install it here on purpose. 🙃')); } },
    nano: { hidden: true, run: function () { line(tr('nano? Pilihan yang aman dan damai. Sayangnya tetap nggak ada di sini.', 'nano? A safe and peaceful choice. Sadly it isn\'t here either.')); } },
    emacs: { hidden: true, run: function () { line(tr('Sistem operasi yang bagus, cuma kurang text editor. 😜', 'A great operating system, it just lacks a text editor. 😜')); } },
    zypper: {
      hidden: true,
      run: function (args) {
        if (args[0] === 'in' || args[0] === 'install') {
          var pkg = args[1] || 'kopi';
          line('Loading repository data...', 'term-dim');
          line('Resolving package dependencies...', 'term-dim');
          line('The following NEW package is going to be installed: ' + pkg);
          line('(1/1) Installing: ' + pkg + ' ................................[done]', 'term-ok');
          if (pkg === 'kopi' || pkg === 'coffee') line(tr('☕ Siap. Semangat kerjanya!', '☕ Done. Have a productive day!'));
          return;
        }
        if (args[0] === 'dup') return line(tr('Tumbleweed sudah versi terbaru. Kayaknya. Coba lagi besok. 🦎', 'Tumbleweed is already up to date. Probably. Try again tomorrow. 🦎'));
        line(tr('Coba: zypper in kopi', 'Try: zypper in kopi'), 'term-dim');
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
    top: { hidden: true, run: function () { line(tr('top? Pakai htop aja, lebih berwarna. 😎', 'top? Use htop, it\'s more colorful. 😎'), 'term-dim'); COMMANDS.htop.run(); } },
    btop: { hidden: true, run: function () { line(tr('btop belum terpasang. Sementara htop dulu ya.', 'btop isn\'t installed. Here\'s htop for now.'), 'term-dim'); COMMANDS.htop.run(); } },
    uname: { hidden: true, run: function () { line('Linux ' + HOST + ' 6.x-tumbleweed #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux'); } },
    hello: { hidden: true, run: function () { line(tr('Halo juga! 👋 Ketik help kalau bingung.', 'Hi there! 👋 Type help if you\'re lost.')); } },
    halo: { hidden: true, run: function () { COMMANDS.hello.run(); } },
    kopi: { hidden: true, run: function () { COMMANDS.zypper.run(['in', 'kopi']); } },
    hack: {
      hidden: true,
      run: function () {
        line(tr('Mengakses mainframe...', 'Accessing the mainframe...'), 'term-dim');
        setTimeout(function () { line('Bypass firewall... ████████████ 100%', 'term-ok'); scroll(); }, 500);
        setTimeout(function () { line(tr('Akses ditolak. Kamu cuma bisa hack hati saya pakai pull request yang rapi. 😎', 'Access denied. The only way to hack my heart is a tidy pull request. 😎')); scroll(); }, 1100);
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
    return Math.floor(s / 60) + tr(' menit ', ' min ') + (s % 60) + tr(' detik', ' s');
  }

  // ---------- run loop ----------
  var hist = [];
  var hIdx = 0;

  function run(raw) {
    var cmd = raw.trim();
    if (game) {
      if (!game.silent) echoCommand(raw, game.prompt);
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
      err(name + tr(': command not found. Ketik help untuk lihat daftar perintah.', ': command not found. Type help to see the command list.'));
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

  // htop: tombol langsung jalan tanpa Enter, seperti aslinya
  var HOTKEYS = { ArrowUp: 'up', ArrowDown: 'down', F1: 'f1', F6: 'f6', F9: 'f9', F10: 'f10', q: 'q', Q: 'q', k: 'k', s: 's', h: 'h', '?': '?', '>': '>' };
  document.addEventListener('keydown', function (e) {
    if (!game || !game.hotkeys || !HOTKEYS[e.key] || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target === input ? input.value : /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (HOTKEYS[e.key] === 'q' || HOTKEYS[e.key] === 'f10') stopGame(); else game.input(HOTKEYS[e.key]);
  }, true);
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
    if (game && game.raw) { e.preventDefault(); err(tr('Eits, nggak boleh paste. Ketik manual ya. 😄', 'Nope, no pasting. Type it out. 😄')); scroll(); }
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
    if (e.target.closest('a, .term-click, .htop')) return;
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

  if (chips) chips.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-cmd]');
    if (!b) return;
    run(b.dataset.cmd);
    scroll();
  });

  // ---------- boot ----------
  setPrompt(ps1());
  line(frag(tr('Selamat datang di ', 'Welcome to '), span('rifki-sh', 'term-hl'), tr('. Terminal mini untuk jelajah isi web ini.', '. A mini terminal for exploring this site.')));
  line(frag(tr('Ketik ', 'Type '), span('help', 'term-hl'), tr(' untuk mulai, atau ', ' to start, or '), span('game', 'term-hl'), tr(' buat main game, atau ', ' to play a game, or '), span('quiz', 'term-hl'), tr(' buat kuis Terraform/Ansible/Kubernetes.', ' for a Terraform/Ansible/Kubernetes quiz.')), 'term-dim');
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) input.focus({ preventScroll: true });
})();
