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
    line(frag('Mau yang lebih teknis? Coba ', cmdButton('quiz'), ' untuk kuis Terraform, Ansible, dan Kubernetes.'), 'term-dim');
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

  function quizMenu() {
    line('🧪 Kuis hands-on: jawab tiap skenario dengan perintah yang benar.');
    Object.keys(QUIZ).forEach(function (k) {
      line(frag(cmdButton('quiz ' + k), ' '.repeat(17 - ('quiz ' + k).length) + QUIZ[k].qs.length + ' skenario, 5 soal acak per ronde'));
    });
    line('Alias: quiz tf, quiz k8s. "hint" untuk petunjuk, "skip" untuk lewati, "q" untuk keluar.', 'term-dim');
  }

  function startQuiz(key) {
    var Z = QUIZ[key];
    var qs = shuffle(Z.qs).slice(0, 5);
    var i = 0, score = 0, tries = 0;
    function ask() {
      line(frag(span('[' + (i + 1) + '/' + qs.length + '] ', 'term-dim'), span(qs[i][0], 'term-hl')));
    }
    function hint() { line('💡 Petunjuk: ' + qs[i][1], 'term-dim'); }
    function reveal() { line(frag('Jawabannya: ', span(qs[i][2], 'term-hl')), 'term-dim'); }
    function next() {
      i++; tries = 0;
      if (i < qs.length) return ask();
      scoreLine(score, qs.length, 'quiz-' + key);
      line('Main lagi: quiz ' + key + ' (soalnya diacak tiap ronde)', 'term-dim');
      stopGame();
    }
    line(frag(span('🧪 Kuis ' + Z.title, 'term-hl'), ': 5 skenario, ketik perintah lengkapnya. Tiap soal dapat 2 kesempatan.'));
    line(Z.intro + ' Ketik "hint", "skip", atau "q".', 'term-dim');
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
          line('✔ Benar!' + (c !== q[2] ? ' Versi saya: ' + q[2] : ''), 'term-ok');
          return next();
        }
        if (!Z.tool.test(c)) return err('Ini kuis ' + Z.title + ', perintahnya diawali ' + Z.start + '.');
        if (tries++ === 0) { err('✘ Belum tepat. Coba lagi.'); return hint(); }
        err('✘ Masih belum.');
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
    if (!QUIZ[k]) { err('quiz: "' + k + '" belum ada.'); return quizMenu(); }
    game = startQuiz(k);
    setPrompt(game.prompt);
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
        var a = document.createElement('div');
        a.className = 'term-art';
        a.setAttribute('aria-label', 'Logo openSUSE');
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
    game: { desc: 'main game 🎮 (port, http, cmd, angka, ketik)', run: function (args) { gameStart(args); } },
    quiz: { desc: 'kuis hands-on 🧪 (terraform, ansible, kubernetes)', run: function (args) { quizCmd(args); } },
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

  if (chips) chips.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-cmd]');
    if (!b) return;
    run(b.dataset.cmd);
    scroll();
  });

  // ---------- boot ----------
  setPrompt(ps1());
  line(frag('Selamat datang di ', span('rifki-sh', 'term-hl'), '. Terminal mini untuk jelajah isi web ini.'));
  line(frag('Ketik ', span('help', 'term-hl'), ' untuk mulai, atau ', span('game', 'term-hl'), ' buat main game, atau ', span('quiz', 'term-hl'), ' buat kuis Terraform/Ansible/Kubernetes.'), 'term-dim');
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) input.focus({ preventScroll: true });
})();
