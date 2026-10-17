// Docker simulator for /docker/. A fake Docker host in memory: a small
// registry, a BuildKit-style builder with a layer cache, containers with
// port mappings, volumes and networks, and a Compose subset. The Flask app
// in app.py is read with regexes, not run. Nothing leaves the page.
(function () {
  'use strict';

  var K = window.SimKit;
  var app = document.getElementById('dk');
  if (!app || !K) return;
  var esc = K.esc, setHTML = K.setHTML, setText = K.setText;
  var digest = K.digest, pad = K.pad, words = K.words, edit = K.edit, ago = K.ago;
  function $(id) { return document.getElementById(id); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function rnd(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function fmtSize(mb) {
    if (mb < 0.001) return Math.max(1, Math.round(mb * 1e6)) + 'B';
    if (mb < 1) return (mb * 1000).toFixed(mb < 0.01 ? 2 : 1).replace(/\.0+$/, '') + 'kB';
    if (mb < 1000) return (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + 'MB';
    return (mb / 1000).toFixed(2) + 'GB';
  }
  function dur(t) {
    var s = Math.max(1, Math.round((Date.now() - t) / 1000));
    if (s < 60) return s + ' second' + (s > 1 ? 's' : '');
    if (s < 120) return 'About a minute';
    return Math.floor(s / 60) + ' minutes';
  }
  function durID(t) {
    var s = Math.max(1, Math.round((Date.now() - t) / 1000));
    return s < 60 ? s + ' dtk' : Math.floor(s / 60) + ' mnt';
  }
  // ---------- registry ----------
  // base: shared bottom layer (Debian bookworm or Alpine), so pulls can say
  // "Already exists" like the real thing.
  var REG = {
    'nginx:1.27': { size: 192, n: 7, base: 'deb', kind: 'web', alias: ['latest'], ago: 16 },
    'nginx:1.25': { size: 187, n: 7, base: 'deb', kind: 'web', ago: 140 },
    'nginx:alpine': { size: 47.9, n: 8, base: 'alp', kind: 'web', ago: 16 },
    'httpd:2.4': { size: 148, n: 6, base: 'deb', kind: 'httpd', alias: ['latest'], ago: 30 },
    'redis:7': { size: 117, n: 8, base: 'deb', kind: 'redis', alias: ['latest'], ago: 21, vol: '/data' },
    'redis:7-alpine': { size: 41.2, n: 8, base: 'alp', kind: 'redis', ago: 21, vol: '/data' },
    'postgres:16': { size: 435, n: 14, base: 'deb', kind: 'pg', alias: ['latest'], ago: 25, vol: '/var/lib/postgresql/data' },
    'python:3.12-slim': { size: 124, n: 4, base: 'deb', kind: 'py', ago: 12 },
    'python:3.12': { size: 1020, n: 8, base: 'deb', kind: 'py', alias: ['latest'], ago: 12 },
    'ubuntu:24.04': { size: 78.1, n: 1, kind: 'os', os: 'ubuntu', alias: ['latest'], ago: 35 },
    'ubuntu:22.04': { size: 77.9, n: 1, kind: 'os', os: 'ubuntu', ago: 35 },
    'alpine:3.20': { size: 7.8, n: 1, base: 'alp', kind: 'os', os: 'alpine', alias: ['latest'], ago: 60 },
    'hello-world:latest': { size: 0.0133, n: 1, kind: 'hello', ago: 520 }
  };
  var ALIAS = {};
  Object.keys(REG).forEach(function (r) {
    ALIAS[r] = r;
    var repo = r.split(':')[0];
    (REG[r].alias || []).forEach(function (t) { ALIAS[repo + ':' + t] = r; });
  });
  var REPOS = {};
  Object.keys(ALIAS).forEach(function (r) { REPOS[r.split(':')[0]] = true; });
  var KIND_CMD = {
    web: ['nginx', '-g', 'daemon off;'], httpd: ['httpd-foreground'], redis: ['redis-server'],
    pg: ['postgres'], py: ['python3'], hello: ['/hello'], os: ['/bin/sh']
  };
  var KIND_PORT = { web: 80, httpd: 80, redis: 6379, pg: 5432 };
  var PIP = ['flask', 'requests', 'redis', 'gunicorn', 'django', 'fastapi', 'uvicorn', 'numpy', 'pandas', 'psycopg2-binary', 'sqlalchemy', 'werkzeug', 'jinja2', 'pytest'];
  var ADJ = ['admiring', 'bold', 'brave', 'clever', 'eager', 'festive', 'happy', 'jolly', 'keen', 'nifty', 'quirky', 'relaxed', 'sharp', 'vibrant', 'zealous', 'pensive', 'gracious', 'serene'];
  var SCI = ['turing', 'hopper', 'lovelace', 'torvalds', 'ritchie', 'thompson', 'knuth', 'hamilton', 'curie', 'tesla', 'noether', 'babbage', 'wozniak', 'kernighan', 'liskov', 'shannon'];

  function normRef(r) {
    r = String(r || '').replace(/^docker\.io\//, '').replace(/^library\//, '');
    if (r.indexOf('@') >= 0) r = r.split('@')[0];
    var last = r.split('/').pop();
    return last.indexOf(':') < 0 ? r + ':latest' : r;
  }

  // ---------- files ----------
  var FILES0 = {
    'Dockerfile': [
      'FROM python:3.12-slim',
      '',
      'WORKDIR /app',
      'COPY . .',
      'RUN pip install -r requirements.txt',
      '',
      'EXPOSE 5000',
      'CMD ["python", "app.py"]',
      ''
    ].join('\n'),
    'app.py': [
      'import os',
      'from flask import Flask',
      '',
      'app = Flask(__name__)',
      'PESAN = os.environ.get("PESAN", "Halo dari container!")',
      'DATA = "/data/hits.txt"',
      '',
      '@app.route("/")',
      'def index():',
      '    os.makedirs("/data", exist_ok=True)',
      '    hits = int(open(DATA).read()) if os.path.exists(DATA) else 0',
      '    hits += 1',
      '    open(DATA, "w").write(str(hits))',
      '    return f"{PESAN} Kunjungan ke-{hits}\\n"',
      '',
      'app.run(host="0.0.0.0", port=5000)',
      ''
    ].join('\n'),
    'requirements.txt': 'flask==3.0.3\n',
    'compose.yaml': [
      'services:',
      '  web:',
      '    build: .',
      '    ports:',
      '      - "8000:5000"',
      '    environment:',
      '      PESAN: "Halo dari Compose!"',
      '    volumes:',
      '      - hits:/data',
      '    depends_on:',
      '      - cache',
      '',
      '  cache:',
      '    image: redis:7',
      '',
      'volumes:',
      '  hits:',
      ''
    ].join('\n')
  };
  function plain(l) { return esc(l); }
  var TABS = [
    { f: 'Dockerfile', hl: K.hlDocker },
    { f: 'app.py', hl: K.hlPy },
    { f: 'requirements.txt', hl: plain },
    { f: 'compose.yaml', hl: K.hlYAML }
  ];

  var MISSIONS = [
    { id: 'run', text: 'Jalankan nginx dengan <b>-p 8080:80</b>, lalu buka pakai <i>curl localhost:8080</i>.' },
    { id: 'build', text: 'Build image dari Dockerfile: <b>docker build -t app:1.0 .</b>' },
    { id: 'app', text: 'Jalankan image app kamu dan dapatkan balasannya lewat <i>curl</i>.' },
    { id: 'vol', text: 'Hapus container app, bikin lagi, dan hitungan kunjungan ga balik ke 1. Pakai <b>volume</b>.' },
    { id: 'cache', text: 'Ubah <b>PESAN</b> di app.py lalu build ulang. Atur Dockerfile supaya <i>pip install</i> tetap CACHED.' },
    { id: 'compose', text: 'Naikkan semua service di compose.yaml pakai <b>docker compose up -d</b>, lalu curl port 8000.' }
  ];

  // ---------- state ----------
  var W, S0 = 0;
  var PS = 'rifki@laptop:~/app$';
  function initWorld() {
    W = {
      run: (W ? W.run : 0) + 1, busy: false, ask: null,
      files: {}, errs: {},
      images: [], layers: {}, cache: {},
      ctrs: [], vols: {}, binds: {},
      nets: {
        bridge: { driver: 'bridge', sub: 17, next: 2, created: Date.now() - 86400e3 * 3 },
        host: { driver: 'host', created: Date.now() - 86400e3 * 3 },
        none: { driver: 'null', created: Date.now() - 86400e3 * 3 }
      },
      netSeq: 18
    };
    Object.keys(FILES0).forEach(function (f) { W.files[f] = FILES0[f]; W.errs[f] = []; });
  }
  function imgById(id) {
    return W.images.filter(function (i) { return i.id.indexOf(id) === 0; })[0];
  }
  function imgByRef(ref) {
    var n = normRef(ref);
    return W.images.filter(function (i) { return i.tags.indexOf(n) >= 0; })[0];
  }
  function findImage(arg) {
    return imgByRef(arg) || (/^[0-9a-f]{4,64}$/.test(arg) ? imgById(arg) : null);
  }
  function findCtr(q) {
    if (!q) return null;
    return W.ctrs.filter(function (c) { return c.name === q; })[0] ||
      (/^[0-9a-f]{3,64}$/.test(q) ? W.ctrs.filter(function (c) { return c.id.indexOf(q) === 0; })[0] : null);
  }
  function running(c) { return c.state === 'running'; }
  function imgName(c) { return c.ref; }
  function tagLabel(img) { return img.tags[0] || '<none>:<none>'; }

  // ---------- pulling ----------
  // returns true when the image is local afterwards; prints like docker pull
  async function pull(ref, quiet) {
    var n = normRef(ref);
    var canon = ALIAS[n];
    var repo = n.split(':')[0], tag = n.slice(repo.length + 1);
    if (!canon) {
      if (!quiet && ref.split('/').pop().indexOf(':') < 0) term.line('Using default tag: latest');
      if (REPOS[repo]) {
        err('Error response from daemon: manifest for ' + n + ' not found: manifest unknown: manifest unknown');
      } else {
        var near = Object.keys(REPOS).filter(function (r) { return edit(r, repo) <= 2; })[0];
        err('Error response from daemon: pull access denied for ' + repo + ', repository does not exist or may require \'docker login\': denied: requested access to the resource is denied');
        if (near) dim('# mungkin maksudnya ' + near + '?');
      }
      return false;
    }
    var R = REG[canon];
    var have = W.images.filter(function (i) { return i.canon === canon; })[0];
    if (!quiet && ref.split('/').pop().indexOf(':') < 0) term.line('Using default tag: latest');
    if (have) {
      if (have.tags.indexOf(n) < 0) have.tags.push(n);
      if (!quiet) {
        term.line(esc(tag) + ': Pulling from library/' + esc(repo));
        term.line('Digest: sha256:' + digest('dg' + canon));
        term.line('Status: Image is up to date for ' + esc(n));
        term.line('docker.io/library/' + esc(n));
      }
      renderAll();
      return true;
    }
    term.line(esc(tag) + ': Pulling from library/' + esc(repo));
    var ids = layerIds(canon);
    var rows = ids.map(function (id) {
      return term.line(id.slice(0, 12) + ': ' + (W.layers[id] ? 'Already exists' : 'Pulling fs layer'));
    });
    K.pulse(app, 'build');
    for (var i = 0; i < ids.length; i++) {
      if (W.layers[ids[i]]) continue;
      await sleep(R.size > 300 ? 260 : R.size > 50 ? 170 : 90);
      rows[i].innerHTML = ids[i].slice(0, 12) + ': <span class="sx-ok">Pull complete</span>';
      W.layers[ids[i]] = true;
    }
    term.line('Digest: sha256:' + digest('dg' + canon));
    term.line('Status: Downloaded newer image for ' + esc(n));
    if (!quiet) term.line('docker.io/library/' + esc(n));
    var img = {
      id: digest('img' + canon), canon: canon, tags: [n], size: R.size, created: Date.now() - R.ago * 86400e3,
      layers: ids.map(function (id, k) { return { id: id, size: k === 0 ? R.size * 0.45 : R.size * 0.55 / Math.max(1, ids.length - 1), base: true }; }),
      cfg: { kind: R.kind, cmd: KIND_CMD[R.kind].slice(), entry: [], env: {}, workdir: R.kind === 'web' ? '/' : '/', expose: KIND_PORT[R.kind] ? [KIND_PORT[R.kind]] : [], vol: R.vol || null, os: R.os || (R.base === 'alp' ? 'alpine' : 'debian') },
      fs: {}, pkgs: {}, built: false
    };
    W.images.push(img);
    K.flash(app, 'img');
    renderAll();
    return true;
  }
  function layerIds(canon) {
    var R = REG[canon], ids = [];
    for (var i = 0; i < R.n; i++) {
      if (i === 0 && R.base) ids.push(digest('base-' + R.base));
      else ids.push(digest('L' + canon + i));
    }
    return ids;
  }

  // ---------- Dockerfile ----------
  var INSTR = ['FROM', 'RUN', 'CMD', 'LABEL', 'EXPOSE', 'ENV', 'ADD', 'COPY', 'ENTRYPOINT', 'VOLUME', 'USER', 'WORKDIR', 'ARG', 'HEALTHCHECK', 'SHELL', 'STOPSIGNAL', 'ONBUILD'];
  function parseDockerfile(src) {
    var out = [], lines = src.split('\n'), buf = '', start = 0;
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (!buf && (!t || t[0] === '#')) continue;
      if (!buf) start = i + 1;
      if (/\\$/.test(t)) { buf += t.slice(0, -1) + ' '; continue; }
      buf += t;
      var m = /^(\S+)\s*([\s\S]*)$/.exec(buf);
      buf = '';
      var ins = m[1].toUpperCase(), arg = m[2].trim();
      if (INSTR.indexOf(ins) < 0) {
        var near = INSTR.filter(function (x) { return edit(x, ins) <= 2; })[0];
        throw { line: start, msg: 'dockerfile parse error on line ' + start + ': unknown instruction: ' + m[1] + (near ? ' (did you mean ' + near.toLowerCase() + '?)' : '') };
      }
      if (!arg) throw { line: start, msg: 'dockerfile parse error on line ' + start + ': ' + ins + ' requires at least one argument' };
      if (m[1] !== ins && i === 0) { /* lowercase instructions are allowed */ }
      out.push({ ins: ins, arg: arg, line: start });
    }
    var froms = out.filter(function (x) { return x.ins === 'FROM'; });
    if (!froms.length) throw { line: 1, msg: 'no build stage in current context' };
    var first = out.filter(function (x) { return x.ins !== 'ARG'; })[0];
    if (first.ins !== 'FROM') throw { line: first.line, msg: 'no build stage in current context' };
    if (froms.length > 1) throw { line: froms[1].line, msg: 'multi-stage build (FROM kedua) belum didukung di simulasi ini' };
    return out;
  }
  function execForm(arg) {
    if (/^\[/.test(arg)) {
      try { var a = JSON.parse(arg); if (Array.isArray(a)) return { json: true, argv: a.map(String) }; } catch (e) { /* fall through */ }
      return { json: false, argv: ['/bin/sh', '-c', arg], bad: true };
    }
    return { json: false, argv: ['/bin/sh', '-c', arg] };
  }
  function resolvePath(p, wd) {
    if (!p || p === '.') return wd;
    var parts = (p[0] === '/' ? p : wd.replace(/\/$/, '') + '/' + p).split('/'), out = [];
    parts.forEach(function (x) { if (!x || x === '.') return; if (x === '..') out.pop(); else out.push(x); });
    return '/' + out.join('/');
  }
  function ctxMatch(src) {
    var names = Object.keys(W.files);
    src = src.replace(/^\.\//, '');
    if (src === '.' || src === '' || src === '*') return names;
    if (src.indexOf('*') >= 0) {
      var re = new RegExp('^' + src.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
      return names.filter(function (n) { return re.test(n); });
    }
    return names.indexOf(src) >= 0 ? [src] : null;
  }

  // RUN: a tiny /bin/sh. Returns { code, out: [], dur, size }
  function shRun(cmd, st) {
    var parts = cmd.split(/\s*&&\s*/), out = [], size = 0, d = 0.1;
    var alp = st.os === 'alpine';
    for (var i = 0; i < parts.length; i++) {
      var w = words(parts[i]);
      var c = w[0];
      if (!c) continue;
      if (c === 'pip' || c === 'pip3' || (c === 'python' || c === 'python3') && w[1] === '-m' && w[2] === 'pip') {
        if (st.kind !== 'py') return { code: 127, out: ['/bin/sh: 1: ' + c + ': not found'], dur: 0.1 };
        var args = c[0] === 'p' && w[1] === '-m' ? w.slice(3) : w.slice(1);
        if (args[0] !== 'install') { out.push('pip ' + args.join(' ')); continue; }
        var pk = [];
        for (var j = 1; j < args.length; j++) {
          if (args[j] === '-r' || args[j] === '--requirement') {
            var f = resolvePath(args[++j], st.wd);
            if (st.fs[f] === undefined) return { code: 1, out: ["ERROR: Could not open requirements file: [Errno 2] No such file or directory: '" + args[j] + "'"], dur: 0.9 };
            st.fs[f].split('\n').forEach(function (l) { l = l.replace(/#.*/, '').trim(); if (l) pk.push(l); });
          } else if (args[j][0] !== '-') pk.push(args[j]);
        }
        if (!pk.length) return { code: 1, out: ['ERROR: You must give at least one requirement to install (see "pip help install")'], dur: 0.6 };
        for (var k = 0; k < pk.length; k++) {
          var name = pk[k].split(/[=<>~!\[ ]/)[0].toLowerCase();
          var near = PIP.filter(function (p) { return p !== name && edit(p, name) <= 2; })[0];
          if (PIP.indexOf(name) < 0 && near) {
            return { code: 1, out: ['ERROR: Could not find a version that satisfies the requirement ' + pk[k] + ' (from versions: none)', 'ERROR: No matching distribution found for ' + pk[k]], dur: 2.1 };
          }
        }
        pk.forEach(function (p) {
          var name = p.split(/[=<>~!\[ ]/)[0].toLowerCase();
          st.pkgs[name] = true;
          out.push('Collecting ' + p);
        });
        if (st.pkgs.flask) ['werkzeug', 'jinja2', 'itsdangerous', 'click', 'blinker'].forEach(function (x) { st.pkgs[x] = true; });
        out.push('Successfully installed ' + Object.keys(st.pkgs).sort().map(function (x) { return x + (x === 'flask' ? '-3.0.3' : ''); }).join(' '));
        size += 9 + pk.length * 3; d += 5.5 + pk.length * 1.2;
      } else if (c === 'apt-get' || c === 'apt') {
        if (alp) return { code: 127, out: ['/bin/sh: ' + c + ': not found', '# image Alpine pakai apk, bukan apt'], dur: 0.1 };
        if (w[1] === 'update') { st.aptOk = true; out.push('Get:1 http://deb.debian.org/debian bookworm InRelease [151 kB]', 'Reading package lists...'); d += 3.2; size += 18; continue; }
        if (w[1] === 'install') {
          var pk2 = w.slice(2).filter(function (x) { return x[0] !== '-'; });
          if (!st.aptOk) return { code: 100, out: ['Reading package lists...', 'E: Unable to locate package ' + (pk2[0] || ''), '# di image slim, daftar paket apt masih kosong. Jalankan apt-get update dulu di RUN yang sama.'], dur: 0.8 };
          if (w.indexOf('-y') < 0 && w.indexOf('--yes') < 0) return { code: 1, out: ['The following NEW packages will be installed:', '  ' + pk2.join(' '), 'Do you want to continue? [Y/n] Abort.', '# di build ga ada yang bisa jawab Y. Tambahkan -y.'], dur: 1.2 };
          pk2.forEach(function (p) { st.bins[p] = true; out.push('Setting up ' + p + ' ...'); });
          d += 4 + pk2.length * 2; size += 12 * pk2.length;
          continue;
        }
        if (w[1] === 'clean' || w[1] === 'autoremove') continue;
        out.push(c + ' ' + w.slice(1).join(' '));
      } else if (c === 'apk') {
        if (!alp) return { code: 127, out: ['/bin/sh: 1: apk: not found', '# apk cuma ada di image Alpine'], dur: 0.1 };
        w.slice(2).filter(function (x) { return x[0] !== '-'; }).forEach(function (p) { st.bins[p] = true; out.push('(1/1) Installing ' + p); });
        d += 1.5; size += 6;
      } else if (c === 'mkdir' || c === 'touch' || c === 'chmod' || c === 'chown' || c === 'useradd' || c === 'adduser' || c === 'groupadd' || c === 'rm' || c === 'cp' || c === 'mv' || c === 'true' || c === 'cd' || c === 'ln') {
        if (c === 'touch') w.slice(1).forEach(function (x) { if (x[0] !== '-') st.fs[resolvePath(x, st.wd)] = ''; });
        d += 0.1;
      } else if (c === 'echo') {
        var gt = parts[i].match(/>\s*(\S+)\s*$/);
        if (gt) st.fs[resolvePath(gt[1], st.wd)] = w.slice(1, w.indexOf('>') < 0 ? undefined : w.indexOf('>')).join(' ') + '\n';
        else out.push(w.slice(1).join(' '));
      } else if (c === 'ls' || c === 'cat' || c === 'pwd' || c === 'whoami' || c === 'env' || c === 'uname') {
        out.push('(' + c + ')');
      } else if (c === 'python' || c === 'python3') {
        if (st.kind !== 'py') return { code: 127, out: ['/bin/sh: 1: ' + c + ': not found'], dur: 0.1 };
        out.push('Python 3.12.7');
      } else if (st.bins[c]) {
        d += 0.5;
      } else {
        return { code: 127, out: ['/bin/sh: 1: ' + c + ': not found'], dur: 0.1 };
      }
    }
    return { code: 0, out: out, dur: d, size: size };
  }

  // the classic cache mistake: COPY . . sits above RUN pip install
  function copyAllBeforePip(df) {
    var all = -1, pip = -1;
    df.forEach(function (d, i) {
      if ((d.ins === 'COPY' || d.ins === 'ADD') && all < 0 && /(^|\s)\.\/?\s/.test(d.arg + ' ') && words(d.arg).length === 2) all = i;
      if (d.ins === 'RUN' && /pip3? install|pip install/.test(d.arg) && pip < 0) pip = i;
    });
    return all >= 0 && pip > all;
  }
  function stepLine(n, tot, txt) { return '[' + n + '/' + tot + '] ' + txt; }
  function bk(html, t, cls) {
    return term.line(' <span class="sx-info">=&gt;</span> ' + html + (t !== undefined ? '  <span class="sx-dim">' + t.toFixed(1) + 's</span>' : ''), cls);
  }

  // build the Dockerfile in ~/app. Resolves to the image or null.
  async function build(tag, o) {
    o = o || {};
    var run = W.run;
    var df;
    var head = term.line('[+] Building 0.0s (0/0)');
    try { df = parseDockerfile(W.files.Dockerfile); }
    catch (e) {
      head.innerHTML = '[+] Building 0.0s (1/1) <span class="sx-err">FINISHED</span>';
      bk('[internal] load build definition from Dockerfile', 0);
      term.line('<span class="sx-err">ERROR: failed to solve: ' + esc(e.msg) + '</span>');
      markErr('Dockerfile', e.line);
      K.flash(app, 'df', 'warn');
      return null;
    }
    W.errs.Dockerfile = [];
    renderTabs();
    var steps = df.filter(function (x) { return /^(FROM|RUN|COPY|ADD|WORKDIR)$/.test(x.ins); });
    var tot = steps.length, total = 0, done = 0, n = 0;
    var from = df.filter(function (x) { return x.ins === 'FROM'; })[0];
    var baseRef = normRef(from.arg.split(/\s+/)[0]);
    var canon = ALIAS[baseRef];
    bk('[internal] load build definition from Dockerfile', 0);
    await sleep(200);
    if (run !== W.run) return null;
    if (!canon) {
      bk('<span class="sx-err">ERROR [internal] load metadata for docker.io/library/' + esc(baseRef) + '</span>', 1.4);
      var repo = baseRef.split(':')[0];
      term.line('<span class="sx-err">ERROR: failed to solve: ' + esc(baseRef) + ': failed to resolve source metadata for docker.io/library/' + esc(baseRef) + ': ' + (REPOS[repo] ? esc(baseRef) + ': not found' : 'pull access denied, repository does not exist or may require authorization') + '</span>');
      markErr('Dockerfile', from.line);
      head.innerHTML = '[+] Building 1.4s (2/3) <span class="sx-err">FINISHED</span>';
      return null;
    }
    var t0 = 0.6 + Math.random();
    bk('[internal] load metadata for docker.io/library/' + esc(baseRef), t0);
    bk('[internal] load .dockerignore', 0);
    total += t0;
    var R = REG[canon];
    var st = { fs: {}, pkgs: {}, bins: {}, wd: '/', env: {}, kind: R.kind, os: R.os || (R.base === 'alp' ? 'alpine' : 'debian'), aptOk: false };
    var cfg = { kind: R.kind === 'py' ? 'app' : R.kind, cmd: KIND_CMD[R.kind].slice(), entry: [], env: {}, workdir: '/', expose: [], vol: R.vol || null, os: st.os, user: '' };
    var layers = layerIds(canon).map(function (id, k) { return { id: id, size: k === 0 ? R.size * 0.45 : R.size * 0.55 / Math.max(1, R.n - 1), base: true }; });
    var key = 'base:' + canon, size = R.size, broke = false, cachedPip = false, freshCopy = false, keys = [];
    for (var i = 0; i < df.length; i++) {
      if (run !== W.run) return null;
      var d = df[i], ins = d.ins, arg = d.arg;
      if (ins === 'FROM') {
        n++;
        var baseLocal = W.images.some(function (im) { return im.canon === canon; }) || W.cache['base:' + canon];
        if (baseLocal) bk('<span class="sx-dim">CACHED</span> ' + stepLine(n, tot, 'FROM docker.io/library/' + esc(baseRef) + '@sha256:' + digest('dg' + canon).slice(0, 12) + '…'), 0);
        else {
          var tf = 2 + R.size / 60;
          bk(stepLine(n, tot, 'FROM docker.io/library/' + esc(baseRef) + '@sha256:' + digest('dg' + canon).slice(0, 12) + '…'), tf);
          term.line(' <span class="sx-info">=&gt;</span> <span class="sx-dim">=&gt; resolve docker.io/library/' + esc(baseRef) + ' … done</span>');
          await sleep(500);
          total += tf;
          layerIds(canon).forEach(function (id) { W.layers[id] = true; });
          W.cache['base:' + canon] = true;
        }
        if (n === 1) {
          bk('[internal] load build context', 0);
          term.line(' <span class="sx-info">=&gt;</span> <span class="sx-dim">=&gt; transferring context: ' + fmtSize(Object.keys(W.files).reduce(function (a, f) { return a + W.files[f].length; }, 0) / 1e6) + '</span>');
        }
        continue;
      }
      if (ins === 'ENV') {
        var em = /^([\w.-]+)=(.*)$/.exec(arg) || /^([\w.-]+)\s+(.*)$/.exec(arg);
        if (em) {
          words(arg).forEach(function (kv) { var p = /^([\w.-]+)=(.*)$/.exec(kv); if (p) cfg.env[p[1]] = p[2]; });
          if (!/=/.test(arg)) cfg.env[em[1]] = em[2].replace(/^"|"$/g, '');
        }
        key += '|ENV ' + arg; continue;
      }
      if (ins === 'EXPOSE') { arg.split(/\s+/).forEach(function (p) { var x = parseInt(p, 10); if (x) cfg.expose.push(x); }); continue; }
      if (ins === 'CMD' || ins === 'ENTRYPOINT') {
        var ef = execForm(arg);
        if (ef.bad) { markErr('Dockerfile', d.line); }
        if (ins === 'CMD') cfg.cmd = ef.argv; else { cfg.entry = ef.argv; cfg.cmd = []; }
        continue;
      }
      if (ins === 'VOLUME') { cfg.vol = arg.replace(/[\[\]"]/g, '').split(/[\s,]+/)[0]; continue; }
      if (ins === 'USER') { cfg.user = arg; continue; }
      if (/^(LABEL|ARG|HEALTHCHECK|SHELL|STOPSIGNAL|ONBUILD)$/.test(ins)) continue;

      n++;
      var label, layerSize = 0, t = 0, extra = null;
      if (ins === 'WORKDIR') {
        st.wd = resolvePath(arg, st.wd);
        cfg.workdir = st.wd;
        key += '|WORKDIR ' + st.wd;
        label = 'WORKDIR ' + esc(arg);
        t = 0.1;
      } else if (ins === 'COPY' || ins === 'ADD') {
        var cw = words(arg).filter(function (x) { return !/^--(chown|chmod|link)/.test(x); });
        if (cw.some(function (x) { return /^--from/.test(x); })) {
          bk('<span class="sx-err">ERROR ' + stepLine(n, tot, ins + ' ' + esc(arg)) + '</span>', 0);
          term.line('<span class="sx-err">ERROR: COPY --from butuh multi-stage build, belum didukung di simulasi ini</span>');
          markErr('Dockerfile', d.line);
          return null;
        }
        if (cw.length < 2) {
          term.line('<span class="sx-err">ERROR: failed to solve: dockerfile parse error on line ' + d.line + ': ' + ins + ' requires at least two arguments, but only one was provided. Destination could not be determined</span>');
          markErr('Dockerfile', d.line);
          return null;
        }
        var dest = cw[cw.length - 1], srcs = cw.slice(0, -1), got = [];
        for (var s = 0; s < srcs.length; s++) {
          var mm = ctxMatch(srcs[s]);
          if (!mm || !mm.length) {
            bk('<span class="sx-err">ERROR ' + stepLine(n, tot, ins + ' ' + esc(arg)) + '</span>', 0);
            term.line('<span class="sx-err">ERROR: failed to solve: failed to compute cache key: failed to calculate checksum of ref ' + digest('ref').slice(0, 20) + '::' + digest('ctx').slice(0, 12) + ': "/' + esc(srcs[s].replace(/^\.\//, '')) + '": not found</span>');
            markErr('Dockerfile', d.line);
            head.innerHTML = '[+] Building ' + total.toFixed(1) + 's (' + (n + 3) + '/' + (tot + 3) + ') <span class="sx-err">FINISHED</span>';
            return null;
          }
          mm.forEach(function (x) { if (got.indexOf(x) < 0) got.push(x); });
        }
        var dirDest = /\/$/.test(dest) || dest === '.' || got.length > 1 || srcs.some(function (x) { return x === '.' || x === './' || x.indexOf('*') >= 0; });
        var base = resolvePath(dest, st.wd);
        var csum = digest(got.map(function (f) { return f + '\0' + W.files[f]; }).join('\0'));
        got.forEach(function (f) { st.fs[dirDest ? base.replace(/\/$/, '') + '/' + f : base] = W.files[f]; });
        key += '|COPY ' + arg + '@' + base + '#' + csum;
        layerSize = got.reduce(function (a, f) { return a + W.files[f].length; }, 0) / 1e6;
        label = ins + ' ' + esc(arg);
        t = 0.1;
        extra = 'copy';
      } else if (ins === 'RUN') {
        var ex = execForm(arg);
        var cmd = ex.json ? ex.argv.join(' ') : arg;
        var res = shRun(cmd, st);
        key += '|RUN ' + cmd;
        label = 'RUN ' + esc(arg);
        t = res.dur;
        layerSize = res.size || 0.01;
        if (res.code) {
          var tt = res.dur;
          bk('<span class="sx-err">ERROR ' + stepLine(n, tot, label) + '</span>', tt);
          await sleep(500);
          term.line('------');
          term.line(' &gt; ' + stepLine(n, tot, label) + ':');
          res.out.forEach(function (l) { term.line(/^#/.test(l) ? '<span class="sx-dim">' + esc(l) + '</span>' : esc(tt.toFixed(1) + ' ' + l)); });
          term.line('------');
          term.line('<span class="sx-err">ERROR: failed to solve: process "/bin/sh -c ' + esc(cmd) + '" did not complete successfully: exit code: ' + res.code + '</span>');
          markErr('Dockerfile', d.line);
          head.innerHTML = '[+] Building ' + (total + tt).toFixed(1) + 's (' + (n + 3) + '/' + (tot + 3) + ') <span class="sx-err">FINISHED</span>';
          K.flash(app, 'df', 'warn');
          return null;
        }
        extra = /pip|apt|apk/.test(cmd) ? 'pip' : 'run';
      }
      keys.push(key);
      var hit = !o.noCache && !broke && W.cache[key];
      if (!hit) broke = true;
      if (hit) {
        bk('<span class="sx-dim">CACHED</span> ' + stepLine(n, tot, label), 0);
        if (extra === 'pip') cachedPip = true;
        await sleep(90);
      } else {
        var row = bk(stepLine(n, tot, label));
        if (extra === 'copy' && cachedPip) freshCopy = true;
        await sleep(Math.min(1700, 160 + t * 220));
        if (run !== W.run) return null;
        row.innerHTML += '  <span class="sx-dim">' + t.toFixed(1) + 's</span>';
        if (ins === 'RUN' && res.out.length) {
          res.out.slice(0, 4).forEach(function (l) { term.line(' <span class="sx-info">=&gt;</span> <span class="sx-dim">=&gt; ' + esc(l) + '</span>'); });
        }
        total += t;
      }
      size += layerSize;
      layers.push({ id: digest('layer' + key), size: layerSize, cmd: ins + ' ' + arg, cached: !!hit });
    }
    if (run !== W.run) return null;
    var cached = layers.filter(function (l) { return l.cached; }).length;
    var id = digest('built' + key + JSON.stringify(cfg));
    bk('exporting to image', 0.2);
    term.line(' <span class="sx-info">=&gt;</span> <span class="sx-dim">=&gt; exporting layers</span>');
    term.line(' <span class="sx-info">=&gt;</span> <span class="sx-dim">=&gt; writing image sha256:' + id + '</span>');
    var ref = tag ? normRef(tag) : null;
    if (ref) term.line(' <span class="sx-info">=&gt;</span> <span class="sx-dim">=&gt; naming to docker.io/library/' + esc(ref) + '</span>');
    total += 0.2;
    head.innerHTML = '[+] Building ' + total.toFixed(1) + 's (' + (tot + 4) + '/' + (tot + 4) + ') <span class="sx-ok">FINISHED</span>';
    keys.forEach(function (k) { W.cache[k] = true; });
    var img = imgById(id);
    if (ref) W.images.forEach(function (im) { im.tags = im.tags.filter(function (t2) { return t2 !== ref; }); });
    if (!img) {
      img = { id: id, canon: null, tags: [], size: size, created: Date.now(), layers: layers, cfg: cfg, fs: st.fs, pkgs: st.pkgs, built: true, src: W.files['app.py'] };
      W.images.push(img);
    }
    if (ref && img.tags.indexOf(ref) < 0) img.tags.push(ref);
    // the old image that lost its tag stays as <none> (dangling)
    K.pulse(app, 'build');
    K.flash(app, 'img');
    M.hit('build');
    if (cachedPip && freshCopy) M.hit('cache');
    else if (W.prevBuilt && !cachedPip && copyAllBeforePip(df)) {
      hint('# pip install dibangun ulang karena layer COPY di atasnya berubah. Coba pindahkan COPY requirements.txt + RUN pip install sebelum COPY . .');
    }
    W.prevBuilt = true;
    if (cached && !o.quiet) dim('# ' + cached + ' layer diambil dari cache');
    renderAll();
    return img;
  }

  // ---------- containers ----------
  function newName() {
    for (var i = 0; i < 50; i++) {
      var n = pick(ADJ) + '_' + pick(SCI);
      if (!findCtr(n)) return n;
    }
    return 'ctr_' + digest(String(Math.random())).slice(0, 6);
  }
  function netOf(name) { return W.nets[name]; }
  function assignIP(c) {
    var N = netOf(c.net);
    if (!N || !N.sub) { c.ip = ''; return; }
    c.ip = '172.' + N.sub + '.0.' + (N.next++);
  }
  function anonVol() {
    var n = digest('anon' + Math.random());
    W.vols[n] = { data: {}, created: Date.now(), anon: true };
    return n;
  }
  // what the container's main process does
  function proc(c) {
    var img = c.img, cfg = img.cfg;
    var argv = (c.entry || cfg.entry).concat(c.cmd.length ? c.cmd : cfg.cmd);
    var userCmd = c.cmd.length > 0;
    var bin = (argv[0] || '').split('/').pop();
    if (bin === 'sh' && argv[1] === '-c') { argv = words(argv.slice(2).join(' ')); bin = (argv[0] || '').split('/').pop(); }
    if (cfg.kind === 'hello' && !userCmd) {
      return { exit: 0, logs: ['', 'Hello from Docker!', 'This message shows that your installation appears to be working correctly.', '', 'To generate this message, Docker took the following steps:', ' 1. The Docker client contacted the Docker daemon.', ' 2. The Docker daemon pulled the "hello-world" image from the Docker Hub.', ' 3. The Docker daemon created a new container from that image which runs the', '    executable that produced the output you are currently reading.', ' 4. The Docker daemon streamed that output to the Docker client, which sent it', '    to your terminal.', ''] };
    }
    if ((cfg.kind === 'web' || cfg.kind === 'httpd') && (!userCmd || bin === 'nginx' || bin === 'httpd-foreground')) {
      return { serve: cfg.kind, port: 80, host: '0.0.0.0', logs: cfg.kind === 'web' ? ['/docker-entrypoint.sh: Configuration complete; ready for start up', '2026/10/17 05:20:11 [notice] 1#1: nginx/1.27.2', '2026/10/17 05:20:11 [notice] 1#1: start worker processes'] : ['AH00558: httpd: Could not reliably determine the server\'s fully qualified domain name', '[mpm_event:notice] AH00489: Apache/2.4.62 (Unix) configured -- resuming normal operations'] };
    }
    if (cfg.kind === 'redis' && (!userCmd || bin === 'redis-server')) {
      return { serve: 'redis', port: 6379, host: '0.0.0.0', logs: ['1:C 17 Oct 2026 05:20:11.402 * oO0OoO0OoO0Oo Redis is starting oO0OoO0OoO0Oo', '1:M 17 Oct 2026 05:20:11.403 * Running mode=standalone, port=6379.', '1:M 17 Oct 2026 05:20:11.404 * Ready to accept connections tcp'] };
    }
    if (cfg.kind === 'pg' && (!userCmd || bin === 'postgres')) {
      if (!c.env.POSTGRES_PASSWORD && c.env.POSTGRES_HOST_AUTH_METHOD !== 'trust') {
        return { exit: 1, delay: 300, logs: ['Error: Database is uninitialized and superuser password is not specified.', '       You must specify POSTGRES_PASSWORD to a non-empty value for the', '       superuser. For example, "-e POSTGRES_PASSWORD=password" on "docker run".'] };
      }
      return { serve: 'pg', port: 5432, host: '0.0.0.0', logs: ['PostgreSQL init process complete; ready for start up.', 'LOG:  listening on IPv4 address "0.0.0.0", port 5432', 'LOG:  database system is ready to accept connections'] };
    }
    // a command line
    if (bin === 'python' || bin === 'python3') {
      if (cfg.kind !== 'app' && cfg.kind !== 'py') return notFound(argv[0]);
      if (argv[1] === '--version' || argv[1] === '-V') return { exit: 0, logs: ['Python 3.12.7'] };
      if (argv[1] === '-c') { var pm = /print\((["'])(.*)\1\)/.exec(argv.slice(2).join(' ')); return { exit: 0, logs: pm ? [pm[2]] : [] }; }
      if (!argv[1]) return c.tty ? { long: true, logs: ['Python 3.12.7 (main, Oct 1 2026, 00:00:00) [GCC 12.2.0] on linux', '>>> '] } : { exit: 0, logs: [] };
      return pyApp(c, resolvePath(argv[1], cfg.workdir));
    }
    if (bin === 'flask' || bin === 'gunicorn') {
      if (!img.pkgs[bin]) return notFound(bin);
      var hm = /--host[= ](\S+)|-b[= ]?(\S+)|--bind[= ](\S+)/.exec(argv.join(' '));
      var bind = hm ? (hm[1] || hm[2] || hm[3]) : (bin === 'gunicorn' ? '127.0.0.1:8000' : '127.0.0.1');
      var r = pyApp(c, resolvePath('app.py', cfg.workdir), true);
      if (r.serve) { r.host = bind.split(':')[0]; r.port = parseInt(bind.split(':')[1], 10) || (bin === 'flask' ? 5000 : 8000); }
      return r;
    }
    if (bin === 'sh' || bin === 'bash') {
      if (bin === 'bash' && cfg.os === 'alpine') return notFound('bash');
      return c.tty ? { long: true, logs: [] } : { exit: 0, logs: [] };
    }
    if (bin === 'sleep') {
      var sec = argv[1] === 'infinity' ? Infinity : parseFloat(argv[1]);
      if (!(sec > 0)) return { exit: 1, logs: ['sleep: missing operand'] };
      return sec > 4 ? { long: true, stopAfter: sec === Infinity ? 0 : sec * 1000, logs: [] } : { exit: 0, delay: sec * 1000, logs: [] };
    }
    if (bin === 'tail' && argv.indexOf('-f') >= 0) return { long: true, logs: [] };
    var simple = inside(c, argv);
    if (simple) return { exit: simple.code, logs: simple.out };
    return notFound(argv[0]);
  }
  function notFound(b) {
    return { fail: 127, msg: 'failed to create task for container: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: exec: "' + b + '": executable file not found in $PATH: unknown' };
  }
  // read app.py the way a person would: vars, port, host, return string
  function pyApp(c, path, viaServer) {
    var img = c.img, src = img.fs[path];
    if (src === undefined) return { exit: 2, logs: ["python: can't open file '" + path + "': [Errno 2] No such file or directory"] };
    var lines = src.split('\n');
    var bal = 0, q = null, open = 0;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].replace(/#.*$/, '');
      for (var j = 0; j < l.length; j++) {
        var ch = l[j];
        if (q) { if (ch === q && l[j - 1] !== '\\') q = null; continue; }
        if (ch === '"' || ch === "'") q = ch;
        else if (ch === '(') { if (!bal) open = i + 1; bal++; }
        else if (ch === ')') bal--;
      }
      if (q) return { exit: 1, logs: ['  File "' + path + '", line ' + (i + 1), '    ' + lines[i].trim(), 'SyntaxError: unterminated string literal (detected at line ' + (i + 1) + ')'] };
      if (bal < 0) return { exit: 1, logs: ['  File "' + path + '", line ' + (i + 1), '    ' + lines[i].trim(), "SyntaxError: unmatched ')'"] };
    }
    if (bal > 0) return { exit: 1, logs: ['  File "' + path + '", line ' + open, '    ' + lines[open - 1].trim(), "SyntaxError: '(' was never closed"] };
    var mods = [];
    lines.forEach(function (l, k) {
      var m = /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/.exec(l);
      if (m) mods.push({ name: (m[1] || m[2]).split('.')[0], line: k + 1, text: l.trim() });
    });
    for (var k = 0; k < mods.length; k++) {
      var nm = mods[k].name;
      if (['os', 'sys', 'json', 'time', 'random', 'socket', 'datetime', 'pathlib', 'math'].indexOf(nm) >= 0) continue;
      if (!img.pkgs[nm.toLowerCase()]) {
        return { exit: 1, logs: ['Traceback (most recent call last):', '  File "' + path + '", line ' + mods[k].line + ', in <module>', '    ' + mods[k].text, "ModuleNotFoundError: No module named '" + nm + "'"] };
      }
    }
    var vars = {}, counter = null;
    lines.forEach(function (l) {
      var m = /^([A-Za-z_]\w*)\s*=\s*os\.environ\.get\(\s*["'](\w+)["']\s*(?:,\s*(["'])(.*?)\3)?\s*\)/.exec(l);
      if (m) { vars[m[1]] = { env: m[2], def: m[4] !== undefined ? m[4] : 'None' }; return; }
      m = /^([A-Za-z_]\w*)\s*=\s*os\.getenv\(\s*["'](\w+)["']\s*(?:,\s*(["'])(.*?)\3)?\s*\)/.exec(l);
      if (m) { vars[m[1]] = { env: m[2], def: m[4] !== undefined ? m[4] : 'None' }; return; }
      m = /^([A-Za-z_]\w*)\s*=\s*(["'])(.*?)\2\s*$/.exec(l);
      if (m) vars[m[1]] = { val: m[3] };
      var cm = /^\s+([A-Za-z_]\w*)\s*\+=\s*1\b/.exec(l);
      if (cm) counter = cm[1];
    });
    var ret = /^\s*return\s+(f?)(["'])(.*?)\2\s*$/m.exec(src);
    var dataPath = null;
    if (counter) {
      Object.keys(vars).forEach(function (v) { if (vars[v].val && /^\//.test(vars[v].val)) dataPath = vars[v].val; });
      if (!dataPath) dataPath = '/tmp/hits.txt';
    }
    var run = /^app\.run\((.*)\)\s*$/m.exec(src);
    if (!run && !viaServer) return { exit: 0, logs: [] };
    var args = run ? run[1] : '';
    var host = (/host\s*=\s*["']([^"']+)["']/.exec(args) || [0, '127.0.0.1'])[1];
    var port = parseInt((/port\s*=\s*(\d+)/.exec(args) || [0, 5000])[1], 10);
    return {
      serve: 'flask', port: port, host: host, app: { vars: vars, counter: counter, ret: ret, data: dataPath },
      logs: [" * Serving Flask app 'app'", ' * Debug mode: off', 'WARNING: This is a development server. Do not use it in a production deployment. Use a production WSGI server instead.']
        .concat(host === '0.0.0.0' ? [' * Running on all addresses (0.0.0.0)', ' * Running on http://127.0.0.1:' + port, ' * Running on http://' + (c.ip || '172.17.0.2') + ':' + port] : [' * Running on http://' + host + ':' + port])
        .concat(['Press CTRL+C to quit'])
    };
  }
  // simple commands used by "docker run IMG cmd" and "docker exec"
  function inside(c, argv) {
    var img = c.img, cfg = img.cfg, b = (argv[0] || '').split('/').pop();
    var osr = cfg.os === 'alpine' ? ['NAME="Alpine Linux"', 'VERSION_ID=3.20.3', 'PRETTY_NAME="Alpine Linux v3.20"'] : cfg.os === 'ubuntu' ? ['PRETTY_NAME="Ubuntu 24.04.1 LTS"', 'NAME="Ubuntu"', 'VERSION_ID="24.04"'] : ['PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"', 'NAME="Debian GNU/Linux"', 'VERSION_ID="12"'];
    var fsv = allFiles(c);
    switch (b) {
      case 'echo': return { code: 0, out: [argv.slice(1).join(' ')] };
      case 'hostname': return { code: 0, out: [c.id.slice(0, 12)] };
      case 'whoami': return { code: 0, out: [cfg.user || 'root'] };
      case 'pwd': return { code: 0, out: [cfg.workdir || '/'] };
      case 'date': return { code: 0, out: [new Date().toUTCString().replace('GMT', 'UTC')] };
      case 'uname': return { code: 0, out: [argv[1] === '-a' ? 'Linux ' + c.id.slice(0, 12) + ' 6.10.14-linuxkit #1 SMP x86_64 GNU/Linux' : 'Linux'] };
      case 'env': return { code: 0, out: ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'HOSTNAME=' + c.id.slice(0, 12)].concat(Object.keys(cfg.env).concat(Object.keys(c.env)).filter(function (k, i, a) { return a.indexOf(k) === i; }).map(function (k) { return k + '=' + (c.env[k] !== undefined ? c.env[k] : cfg.env[k]); })).concat(['HOME=/root']) };
      case 'ls': {
        var dir = resolvePath(argv.filter(function (x) { return x[0] !== '-'; })[1] || cfg.workdir || '/', cfg.workdir || '/');
        if (dir === '/') return { code: 0, out: ['bin   dev  home  lib64  mnt  proc  run   srv  tmp  var', 'boot  etc  lib   media  opt  root  sbin  sys  usr' + (cfg.workdir && cfg.workdir !== '/' ? '  ' + cfg.workdir.slice(1).split('/')[0] : '')] };
        var names = {};
        Object.keys(fsv).forEach(function (p) { if (p.indexOf(dir + '/') === 0) names[p.slice(dir.length + 1).split('/')[0]] = 1; });
        mountsAt(c).forEach(function (m) { if (m.dst.indexOf(dir + '/') === 0) names[m.dst.slice(dir.length + 1).split('/')[0]] = 1; });
        var ks = Object.keys(names).sort();
        if (!ks.length && !isDir(c, dir)) return { code: 2, out: ["ls: cannot access '" + dir + "': No such file or directory"] };
        return { code: 0, out: ks.length ? [ks.join('  ')] : [] };
      }
      case 'cat': {
        var f = argv[1];
        if (!f) return { code: 0, out: [] };
        if (f === '/etc/os-release') return { code: 0, out: osr };
        if (f === '/etc/hostname') return { code: 0, out: [c.id.slice(0, 12)] };
        if (f === '/etc/hosts') return { code: 0, out: ['127.0.0.1\tlocalhost', (c.ip || '172.17.0.2') + '\t' + c.id.slice(0, 12)] };
        var p = resolvePath(f, cfg.workdir || '/');
        var v = fsv[p];
        if (v === undefined) return { code: 1, out: ['cat: ' + f + ': No such file or directory'] };
        return { code: 0, out: String(v).replace(/\n$/, '').split('\n') };
      }
      case 'ps': return { code: 0, out: ['PID   USER     TIME  COMMAND', '    1 root      0:00 ' + c.cmdLine] };
      case 'pip': return img.pkgs && Object.keys(img.pkgs).length ? { code: 0, out: ['Package    Version', '---------- -------'].concat(Object.keys(img.pkgs).sort().map(function (p) { return pad(p, 11) + (p === 'flask' ? '3.0.3' : '1.0'); })) } : null;
      case 'nproc': return { code: 0, out: ['4'] };
      case 'id': return { code: 0, out: ['uid=0(root) gid=0(root) groups=0(root)'] };
    }
    return null;
  }
  function mountsAt(c) { return c.mounts; }
  function isDir(c, dir) { return dir === (c.img.cfg.workdir || '/') || /^\/(etc|usr|var|tmp|root|home|bin|lib|opt|srv|data)$/.test(dir); }
  // image files + container writes + mounted volume files
  function allFiles(c) {
    var o = {};
    Object.keys(c.img.fs).forEach(function (p) { o[p] = c.img.fs[p]; });
    Object.keys(c.local).forEach(function (p) { o[p] = c.local[p]; });
    c.mounts.forEach(function (m) {
      var store = storeOf(m);
      Object.keys(store).forEach(function (p) { o[m.dst.replace(/\/$/, '') + '/' + p] = store[p]; });
    });
    return o;
  }
  function storeOf(m) {
    if (m.type === 'volume') return (W.vols[m.src] || { data: {} }).data;
    W.binds[m.src] = W.binds[m.src] || {};
    return W.binds[m.src];
  }
  // where a path inside the container really lives
  function fileRef(c, path) {
    for (var i = 0; i < c.mounts.length; i++) {
      var m = c.mounts[i], d = m.dst.replace(/\/$/, '');
      if (path.indexOf(d + '/') === 0) return { store: storeOf(m), key: path.slice(d.length + 1) };
    }
    return { store: c.local, key: path };
  }

  function createCtr(img, o) {
    var c = {
      id: digest('ctr' + Math.random() + Date.now()), name: o.name || newName(), img: img, ref: o.ref || tagLabel(img),
      cmd: o.cmd || [], entry: o.entry || null, env: o.env || {}, ports: o.ports || [], mounts: [], net: o.net || 'bridge',
      state: 'created', code: 0, created: Date.now(), started: 0, finished: 0, logs: [], served: 0, local: {},
      tty: !!o.tty, rm: !!o.rm, restart: o.restart || 'no', compose: o.compose || null, aliases: o.aliases || []
    };
    (o.mounts || []).forEach(function (m) {
      m = Object.assign({}, m);
      if (m.anon && !m.src) m.src = anonVol();
      if (m.type === 'volume' && !W.vols[m.src]) { W.vols[m.src] = { data: {}, created: Date.now(), anon: false, compose: o.compose ? o.compose.proj : null }; }
      c.mounts.push(m);
    });
    if (img.cfg.vol && !c.mounts.some(function (m) { return m.dst === img.cfg.vol; })) {
      c.mounts.push({ type: 'volume', src: anonVol(), dst: img.cfg.vol, anon: true });
    }
    var argv = (c.entry || img.cfg.entry).concat(c.cmd.length ? c.cmd : img.cfg.cmd);
    c.cmdLine = argv.join(' ');
    W.ctrs.push(c);
    return c;
  }
  // start; resolves to { ok, msg } and leaves the container running or exited
  function startCtr(c) {
    var clash = null;
    c.ports.forEach(function (p) {
      W.ctrs.forEach(function (o) {
        if (o !== c && running(o) && o.ports.some(function (q) { return q.h === p.h; })) clash = p;
      });
    });
    if (clash) {
      return { ok: false, msg: 'Error response from daemon: driver failed programming external connectivity on endpoint ' + c.name + ' (' + c.id.slice(0, 64) + '): Bind for 0.0.0.0:' + clash.h + ' failed: port is already allocated' };
    }
    if (!c.ip) assignIP(c);
    var p = proc(c);
    if (p.fail) {
      c.code = p.fail;
      return { ok: false, msg: 'Error response from daemon: ' + p.msg };
    }
    c.state = 'running';
    c.started = Date.now();
    c.p = p;
    c.logs = c.logs.concat(p.logs || []);
    var gen = c.gen = (c.gen || 0) + 1;
    if (p.exit !== undefined) {
      if (p.delay) setTimeout(function () { if (c.gen === gen && running(c)) exitCtr(c, p.exit); }, p.delay);
      else exitCtr(c, p.exit, true);
    } else if (p.stopAfter) {
      setTimeout(function () { if (c.gen === gen && running(c)) exitCtr(c, 0); }, p.stopAfter);
    }
    return { ok: true, p: p };
  }
  function exitCtr(c, code, quiet) {
    c.state = 'exited';
    c.code = code;
    c.finished = Date.now();
    c.p = null;
    if (c.rm) removeCtr(c);
    if (!quiet) {
      if (code) K.flash(app, 'ctr', 'warn');
      renderAll();
    }
  }
  function removeCtr(c) {
    W.ctrs = W.ctrs.filter(function (x) { return x !== c; });
    // anonymous volumes go with --rm
    if (c.rm) c.mounts.forEach(function (m) { if (m.anon) delete W.vols[m.src]; });
  }
  function stopCtr(c) {
    if (!running(c)) return;
    c.gen++;
    c.state = 'exited';
    // python and sleep as PID 1 ignore SIGTERM, so Docker kills them after 10s
    c.code = c.p && (c.p.serve === 'flask' || c.p.long) ? 137 : 0;
    c.finished = Date.now();
    c.p = null;
    if (c.rm) removeCtr(c);
  }
  function portsTxt(c, sep) {
    if (!running(c) || !c.ports.length) return '';
    return c.ports.map(function (p) { return '0.0.0.0:' + p.h + '->' + p.c + '/tcp'; }).join(sep || ', ');
  }
  function status(c) {
    if (c.state === 'running') return 'Up ' + dur(c.started);
    if (c.state === 'created') return 'Created';
    return 'Exited (' + c.code + ') ' + ago(c.finished);
  }

  // ---------- http ----------
  function serve(c, port, fromInside) {
    var p = c.p;
    if (!p || !p.serve) return { err: 7 };
    if (port !== p.port) return { err: fromInside ? 7 : 56 };
    if (!fromInside && p.host !== '0.0.0.0') return { err: 56, hint: 'app di container cuma listen di ' + p.host + ', jadi ga bisa dijangkau dari luar container. Ubah jadi host="0.0.0.0".' };
    var ip = fromInside ? '127.0.0.1' : '172.17.0.1';
    var stamp = '[' + new Date().toUTCString().slice(5, 25).replace(' ', '/').replace(' ', '/') + ']';
    if (p.serve === 'web') {
      c.logs.push(ip + ' - - ' + stamp + ' "GET / HTTP/1.1" 200 615 "-" "curl/8.7.1" "-"');
      return { code: 200, type: 'text/html', body: ['<!DOCTYPE html>', '<html>', '<head>', '<title>Welcome to nginx!</title>', '</head>', '<body>', '<h1>Welcome to nginx!</h1>', '<p>If you see this page, the nginx web server is successfully installed and working.</p>', '</body>', '</html>'], kind: 'web' };
    }
    if (p.serve === 'httpd') return { code: 200, type: 'text/html', body: ['<html><body><h1>It works!</h1></body></html>'], kind: 'web' };
    if (p.serve === 'redis' || p.serve === 'pg') return { err: 52 };
    if (p.serve === 'flask') {
      var a = p.app, hits = null;
      if (a.counter) {
        var ref = fileRef(c, a.data);
        hits = (parseInt(ref.store[ref.key], 10) || 0) + 1;
        ref.store[ref.key] = String(hits);
        c.served++;
      }
      var vals = {};
      Object.keys(a.vars).forEach(function (v) {
        var x = a.vars[v];
        vals[v] = x.env ? (c.env[x.env] !== undefined ? c.env[x.env] : c.img.cfg.env[x.env] !== undefined ? c.img.cfg.env[x.env] : x.def) : x.val;
      });
      if (a.counter) vals[a.counter] = hits;
      var body = 'OK';
      if (a.ret) {
        body = a.ret[3];
        if (a.ret[1]) body = body.replace(/\{(\w+)\}/g, function (m0, v) { return vals[v] !== undefined ? vals[v] : m0; });
        body = body.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\n$/, '');
      }
      c.logs.push(ip + ' - - ' + stamp + ' "GET / HTTP/1.1" 200 -');
      return { code: 200, type: 'text/html; charset=utf-8', body: body.split('\n'), kind: 'app', hits: hits };
    }
    return { err: 7 };
  }
  function curl(args, from) {
    var url = args.filter(function (x) { return x[0] !== '-'; })[0];
    var showHead = args.indexOf('-i') >= 0 || args.indexOf('-I') >= 0;
    if (!url) { err('curl: try \'curl --help\' for more information'); return; }
    var m = /^(?:https?:\/\/)?([^:/]+)(?::(\d+))?(\/.*)?$/.exec(url);
    if (!m) { err('curl: (3) URL rejected: Malformed input to a URL function'); return; }
    var host = m[1], port = parseInt(m[2] || '80', 10);
    var target = null, inside = false;
    if (from) {
      if (host === 'localhost' || host === '127.0.0.1') { target = from; inside = true; }
      else target = resolveName(from, host);
      if (!target) { err('curl: (6) Could not resolve host: ' + host); return; }
    } else {
      if (!/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(host)) {
        err('curl: (6) Could not resolve host: ' + host);
        if (findCtr(host)) dim('# nama container cuma bisa dipanggil dari container lain di network yang sama. Dari laptop, pakai localhost:PORT_HOST.');
        return;
      }
      var hit = W.ctrs.filter(function (c) { return running(c) && c.ports.some(function (p) { return p.h === port; }); })[0];
      if (!hit) {
        err('curl: (7) Failed to connect to ' + host + ' port ' + port + ' after 0 ms: Couldn\'t connect to server');
        var down = W.ctrs.filter(function (c) { return !running(c) && c.ports.some(function (p) { return p.h === port; }); })[0];
        if (down) dim('# container ' + down.name + ' yang pegang port ' + port + ' lagi ' + (down.state === 'created' ? 'belum jalan' : 'mati (Exited ' + down.code + '). Cek docker logs ' + down.name) + '.');
        return;
      }
      target = hit;
      port = hit.ports.filter(function (p) { return p.h === port; })[0].c;
    }
    var r = serve(target, port, inside || !!from);
    K.pulse(app, 'port');
    if (r.err) {
      if (r.err === 56) err('curl: (56) Recv failure: Connection reset by peer');
      else if (r.err === 52) err('curl: (52) Empty reply from server');
      else err('curl: (7) Failed to connect to ' + host + ' port ' + (m[2] || 80) + ' after 0 ms: Couldn\'t connect to server');
      if (r.hint) hint('# ' + r.hint);
      else if (r.err === 56 && target.p && target.p.port) hint('# port container yang di-publish salah. App di ' + target.name + ' listen di port ' + target.p.port + ', bukan ' + port + '.');
      else if (r.err === 52) dim('# ' + target.name + ' bukan server HTTP');
      return;
    }
    if (showHead) term.lines(['HTTP/1.1 200 OK', 'Server: ' + (r.kind === 'web' ? 'nginx/1.27.2' : 'Werkzeug/3.0.4 Python/3.12.7'), 'Content-Type: ' + r.type, '']);
    term.lines(r.body.map(function (l) { return esc(l); }));
    renderAll();
    if (from) return;
    if (r.kind === 'web' && target.img.cfg.kind === 'web') M.hit('run');
    if (r.kind === 'app') {
      M.hit('app');
      if (r.hits && r.hits > target.served && target.mounts.some(function (mm) { return !mm.anon; })) M.hit('vol');
      if (target.compose) M.hit('compose');
    }
  }
  function resolveName(from, host) {
    if (from.net === 'bridge' || from.net === 'host' || from.net === 'none') return null;
    return W.ctrs.filter(function (c) { return running(c) && c.net === from.net && (c.name === host || c.aliases.indexOf(host) >= 0 || c.id.indexOf(host) === 0); })[0] || null;
  }

  // ---------- terminal ----------
  var term = new K.Term($('dk-out'), $('dk-in'), { onCmd: onCmd });
  var toast = K.makeToast($('dk-toast'));
  var M = new K.Missions($('dk-m-list'), $('dk-m-count'), MISSIONS, toast, '🐳 Semua misi Docker beres. Mantap!');
  function err(t) { term.line('<span class="sx-err">' + esc(t) + '</span>'); }
  function dim(t) { term.line('<span class="sx-dim">' + esc(t) + '</span>'); }
  function hint(t) { term.line('<span class="sx-warn">' + esc(t) + '</span>'); }
  function out(t) { term.line(esc(t)); }
  function table(rows) { term.table(rows); }

  async function onCmd(line) {
    if (W.ask) {
      var a = W.ask;
      W.ask = null;
      app.classList.remove('is-confirm');
      term.line(esc(line));
      if (/^y(es)?$/i.test(line)) a();
      else dim('# dibatalkan');
      return;
    }
    term.echo(PS, line);
    if (!line) return;
    if (W.busy) { dim('# tunggu perintah sebelumnya selesai dulu'); return; }
    var w = words(line);
    if (w[0] === 'sudo') { w.shift(); dim('# ga perlu sudo, user rifki sudah ada di grup docker'); }
    var c = w[0];
    W.busy = true;
    renderBusy();
    try {
      if (c === 'docker') await docker(w.slice(1));
      else if (c === 'docker-compose') await compose(w.slice(1));
      else if (c === 'curl') curl(w.slice(1));
      else if (c === 'clear') term.clear();
      else if (c === 'help') help();
      else if (c === 'ls') out(Object.keys(W.files).join('  '));
      else if (c === 'cat') {
        var f = w[1];
        if (W.files[f] === undefined) err('cat: ' + (f || '') + ': No such file or directory');
        else term.lines(W.files[f].replace(/\n$/, '').split('\n').map(esc));
      } else if (c === 'vim' || c === 'nano' || c === 'code' || c === 'vi') dim('# edit file-nya langsung di panel ~/app ya');
      else if (c === 'pwd') out('/home/rifki/app');
      else if (c === 'whoami') out('rifki');
      else if (c === 'podman') dim('# podman hampir sama perintahnya, tapi di sini adanya docker');
      else if (c === 'kubectl') dim('# Kubernetes ada di simulasi GitOps. Di sini cuma docker.');
      else err(c + ': command not found');
    } catch (e) {
      err('simulasi error: ' + (e && e.message || e));
      if (window.console) console.error(e);
    }
    W.busy = false;
    renderAll();
  }
  function help() {
    term.lines([
      '<b>Perintah yang bisa dicoba</b>',
      '  docker run [-d] [-p 8080:80] [--name x] [-e K=V] [-v vol:/path] [--rm] IMAGE [cmd]',
      '  docker ps [-a]  ·  docker logs NAMA  ·  docker exec NAMA cmd',
      '  docker stop|start|restart|rm [-f] NAMA',
      '  docker build -t nama:tag [--no-cache] .',
      '  docker images  ·  docker pull IMAGE  ·  docker rmi IMAGE  ·  docker tag A B',
      '  docker volume ls|create|rm|inspect  ·  docker network ls|create|rm',
      '  docker compose up [-d] [--build]  ·  docker compose ps|logs|down [-v]',
      '  docker system df  ·  docker image prune  ·  docker container prune',
      '  curl localhost:PORT  ·  cat FILE  ·  clear',
      '<span class="sx-dim">Image yang ada di registry: nginx, httpd, redis, postgres, python, ubuntu, alpine, hello-world.</span>'
    ]);
  }

  // ---------- docker cli ----------
  async function docker(a) {
    var sub = a[0];
    if (!sub || sub === '--help' || sub === 'help') { help(); return; }
    if (sub === 'container' && a[1]) { sub = a[1] === 'ls' ? 'ps' : a[1]; a = [sub].concat(a.slice(2)); if (sub === 'prune') { await prune('container', a.slice(1)); return; } }
    else if (sub === 'image' && a[1]) {
      var m = { ls: 'images', rm: 'rmi', build: 'build', pull: 'pull', tag: 'tag', inspect: 'inspect', history: 'history' }[a[1]];
      if (a[1] === 'prune') { await prune('image', a.slice(2)); return; }
      if (!m) { err('docker: unknown command: docker image ' + a[1]); return; }
      sub = m; a = [m].concat(a.slice(2));
    }
    var args = a.slice(1);
    switch (sub) {
      case 'version': case '-v': case '--version':
        out('Docker version 27.3.1, build ce12230'); return;
      case 'info':
        term.lines(['Server:', ' Containers: ' + W.ctrs.length, '  Running: ' + W.ctrs.filter(running).length, '  Stopped: ' + W.ctrs.filter(function (c) { return !running(c); }).length, ' Images: ' + W.images.length, ' Server Version: 27.3.1', ' Storage Driver: overlay2', ' Kernel Version: 6.10.14-linuxkit', ' Operating System: Docker Desktop (simulasi)'].map(esc)); return;
      case 'run': await runCmd(args); return;
      case 'create': await runCmd(args, true); return;
      case 'ps': psCmd(args); return;
      case 'images': imagesCmd(args); return;
      case 'pull':
        if (!args[0]) { err('"docker pull" requires exactly 1 argument.'); return; }
        await pull(args[0]); return;
      case 'build': await buildCmd(args); return;
      case 'stop': case 'kill': case 'start': case 'restart': case 'rm': case 'pause': case 'unpause':
        lifecycle(sub, args); return;
      case 'logs': logsCmd(args); return;
      case 'exec': execCmd(args); return;
      case 'rmi': rmiCmd(args); return;
      case 'tag': tagCmd(args); return;
      case 'inspect': inspectCmd(args); return;
      case 'history': historyCmd(args); return;
      case 'volume': volumeCmd(args); return;
      case 'network': networkCmd(args); return;
      case 'compose': await compose(args); return;
      case 'system':
        if (args[0] === 'df') { sysDf(); return; }
        if (args[0] === 'prune') { await prune('system', args.slice(1)); return; }
        err('docker: unknown command: docker system ' + (args[0] || '')); return;
      case 'login': dim('# registry di simulasi ini publik semua, ga perlu login'); return;
      case 'push': err('denied: requested access to the resource is denied'); dim('# push ga didukung di simulasi. Di dunia nyata, tag dulu jadi user/nama:tag lalu docker login.'); return;
      case 'search': dim('# image yang tersedia: ' + Object.keys(REPOS).join(', ')); return;
      case 'stats': table([['CONTAINER ID', 'NAME', 'CPU %', 'MEM USAGE / LIMIT']].concat(W.ctrs.filter(running).map(function (c) { return [c.id.slice(0, 12), c.name, (Math.random() * 2).toFixed(2) + '%', rnd(6, 48) + 'MiB / 7.67GiB']; }))); return;
      case 'top': {
        var tc = findCtr(args[0]);
        if (!tc) { err('Error response from daemon: No such container: ' + (args[0] || '')); return; }
        if (!running(tc)) { err('Error response from daemon: container ' + tc.id + ' is not running'); return; }
        table([['UID', 'PID', 'CMD'], ['root', String(rnd(2000, 9000)), tc.cmdLine]]); return;
      }
      case 'port': {
        var pc = findCtr(args[0]);
        if (!pc) { err('Error: No such container: ' + (args[0] || '')); return; }
        pc.ports.forEach(function (p) { out(p.c + '/tcp -> 0.0.0.0:' + p.h); });
        return;
      }
    }
    err('docker: unknown command: docker ' + sub);
    dim("Run 'docker --help' for more information");
  }

  var VALUED = { '-p': 'p', '--publish': 'p', '-e': 'e', '--env': 'e', '-v': 'v', '--volume': 'v', '--name': 'name', '--network': 'net', '--net': 'net', '--restart': 'restart', '-w': 'w', '--workdir': 'w', '--entrypoint': 'entry', '-u': 'u', '--user': 'u', '--hostname': 'h', '-h': 'h', '--mount': 'mount', '--memory': 'x', '-m': 'x', '--cpus': 'x', '--env-file': 'envfile', '--label': 'x', '-l': 'x', '--platform': 'x', '--network-alias': 'alias' };
  var BOOL = { '-d': 'd', '--detach': 'd', '-i': 'i', '--interactive': 'i', '-t': 't', '--tty': 't', '--rm': 'rm', '-P': 'P', '--publish-all': 'P', '--privileged': 'x', '--init': 'x' };
  function parseRunFlags(a) {
    var o = { p: [], e: [], v: [], alias: [] }, i = 0;
    for (; i < a.length; i++) {
      var t = a[i];
      if (t[0] !== '-' || t === '-') break;
      var eq = t.indexOf('=');
      var k = eq > 0 && t[1] === '-' ? t.slice(0, eq) : t;
      var v = eq > 0 && t[1] === '-' ? t.slice(eq + 1) : null;
      if (VALUED[k]) {
        if (v === null) { v = a[++i]; if (v === undefined) return { err: 'flag needs an argument: ' + k }; }
        var key = VALUED[k];
        if (Array.isArray(o[key])) o[key].push(v); else o[key] = v;
        continue;
      }
      if (BOOL[k]) { o[BOOL[k]] = true; continue; }
      // combined short flags: -it, -dp 8080:80
      if (/^-[a-zA-Z]{2,}$/.test(t)) {
        var chars = t.slice(1).split(''), bad = null;
        for (var j = 0; j < chars.length; j++) {
          var f = '-' + chars[j];
          if (BOOL[f]) o[BOOL[f]] = true;
          else if (VALUED[f] && j === chars.length - 1) {
            var vv = a[++i];
            if (vv === undefined) return { err: 'flag needs an argument: \'' + chars[j] + '\' in ' + t };
            if (Array.isArray(o[VALUED[f]])) o[VALUED[f]].push(vv); else o[VALUED[f]] = vv;
          } else { bad = chars[j]; break; }
        }
        if (bad) return { err: 'unknown shorthand flag: \'' + bad + '\' in ' + t };
        continue;
      }
      return { err: 'unknown flag: ' + k };
    }
    o.rest = a.slice(i);
    return o;
  }
  function parsePorts(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var s = String(list[i]).replace(/\/tcp$|\/udp$/, '');
      var parts = s.split(':');
      if (parts.length === 3) parts = parts.slice(1);
      var h, c;
      if (parts.length === 1) { c = parseInt(parts[0], 10); h = rnd(32768, 60999); }
      else { h = parseInt(parts[0], 10); c = parseInt(parts[1], 10); }
      if (!(h > 0 && h < 65536 && c > 0 && c < 65536)) return { err: 'invalid containerPort: ' + list[i] };
      out.push({ h: h, c: c });
    }
    return { ports: out };
  }
  function parseMounts(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var p = String(list[i]).split(':');
      if (p.length === 1) { out.push({ type: 'volume', src: null, dst: p[0], anon: true }); continue; }
      if (!/^\//.test(p[1])) return { err: 'invalid volume specification: \'' + list[i] + '\': invalid mount config for type "volume": invalid mount path: \'' + p[1] + '\' mount path must be absolute' };
      if (/^[./~]/.test(p[0])) out.push({ type: 'bind', src: p[0].replace(/^\.\//, '/home/rifki/app/').replace(/^\.$/, '/home/rifki/app').replace(/^~/, '/home/rifki'), dst: p[1] });
      else {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(p[0])) return { err: '"' + p[0] + '" includes invalid characters for a local volume name, only "[a-zA-Z0-9][a-zA-Z0-9_.-]" are allowed.' };
        out.push({ type: 'volume', src: p[0], dst: p[1] });
      }
    }
    return { mounts: out };
  }
  function parseEnv(list) {
    var o = {};
    list.forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i < 0) return;
      o[kv.slice(0, i)] = kv.slice(i + 1);
    });
    return o;
  }

  async function runCmd(a, createOnly) {
    var o = parseRunFlags(a);
    if (o.err) { err(o.err); dim("See 'docker run --help'."); return; }
    if (!o.rest.length) { err('"docker run" requires at least 1 argument.'); dim("See 'docker run --help'."); return; }
    var ref = o.rest[0], cmd = o.rest.slice(1);
    if (o.name && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(o.name)) { err('Error response from daemon: Invalid container name (' + o.name + '), only [a-zA-Z0-9][a-zA-Z0-9_.-] are allowed'); return; }
    if (o.name && findCtr(o.name) && findCtr(o.name).name === o.name) {
      var ex = findCtr(o.name);
      err('docker: Error response from daemon: Conflict. The container name "/' + o.name + '" is already in use by container "' + ex.id + '". You have to remove (or rename) that container to be able to reuse that name.');
      dim('# hapus dulu: docker rm -f ' + o.name);
      return;
    }
    var pp = parsePorts(o.p);
    if (pp.err) { err('docker: ' + pp.err); return; }
    var mm = parseMounts(o.v);
    if (mm.err) { err('docker: Error response from daemon: ' + mm.err); return; }
    if (o.net && !W.nets[o.net]) { err('docker: Error response from daemon: network ' + o.net + ' not found.'); return; }
    var img = findImage(ref);
    if (!img) {
      if (/^[a-z0-9._/-]+(:[\w.-]+)?$/.test(ref) === false) { err('docker: invalid reference format: repository name (' + ref + ') must be lowercase.'); return; }
      term.line('Unable to find image \'' + esc(normRef(ref)) + '\' locally');
      var ok = await pull(ref, true);
      if (!ok) { dim("See 'docker run --help'."); return; }
      img = findImage(ref);
    }
    if (o.P) img.cfg.expose.forEach(function (p) { pp.ports.push({ h: rnd(32768, 60999), c: p }); });
    var c = createCtr(img, {
      name: o.name, ref: ref, cmd: cmd, env: parseEnv(o.e),
      ports: pp.ports, mounts: mm.mounts, net: o.net, tty: o.t, rm: o.rm, restart: o.restart,
      entry: o.entry !== undefined ? (o.entry ? [o.entry] : []) : null, aliases: o.alias
    });
    if (o.w) c.img = Object.assign({}, img, { cfg: Object.assign({}, img.cfg, { workdir: o.w }) });
    K.pulse(app, 'run');
    if (createOnly) { out(c.id); renderAll(); return; }
    var r = startCtr(c);
    if (!r.ok) {
      if (o.d) out(c.id);
      err('docker: ' + r.msg + '.');
      if (/port is already allocated/.test(r.msg)) {
        var holder = W.ctrs.filter(function (x) { return x !== c && running(x) && x.ports.some(function (q) { return c.ports.some(function (p) { return p.h === q.h; }); }); })[0];
        if (holder) hint('# port itu sudah dipakai container ' + holder.name + '. Pakai port host lain (misal -p 8081:80) atau stop container itu dulu. Container baru tetap terbuat dalam status Created.');
      }
      if (c.rm) removeCtr(c);
      renderAll();
      return;
    }
    if (o.d) {
      out(c.id);
    } else {
      // foreground: show what the process prints
      (r.p.logs || []).forEach(function (l) { out(l); });
      if (running(c) && (r.p.serve || r.p.long) && !o.t) {
        dim('# (simulasi) container tetap jalan di background, anggap kamu tekan Ctrl+P Ctrl+Q. Pakai -d biar terminal ga ketahan.');
      }
    }
    if (o.t && o.i && r.p.long && !r.p.serve) dim('# shell interaktif ga ada di simulasi ini. Pakai docker exec ' + c.name + ' <perintah> buat jalanin perintah di dalamnya.');
    if (r.p.exit !== undefined && !r.p.delay && !c.rm) {
      if (c.code) hint('# container langsung mati (Exited ' + c.code + '). Lihat penyebabnya: docker logs ' + c.name);
      else if (o.d || !(r.p.logs || []).length) dim('# container langsung selesai (Exited 0) karena perintah utamanya sudah beres. Container butuh proses yang terus jalan supaya tetap hidup.');
    }
    if (o.d && r.p.exit) {
      await sleep((r.p.delay || 0) + 60);
    }
    K.flash(app, 'ctr', running(c) ? '' : 'warn');
    renderAll();
  }

  function psCmd(a) {
    var all = a.indexOf('-a') >= 0 || a.indexOf('--all') >= 0;
    var q = a.indexOf('-q') >= 0 || a.indexOf('--quiet') >= 0 || a.indexOf('-aq') >= 0 || a.indexOf('-qa') >= 0;
    if (a.indexOf('-aq') >= 0 || a.indexOf('-qa') >= 0) all = true;
    var list = W.ctrs.filter(function (c) { return all || running(c); }).slice().reverse();
    if (q) { list.forEach(function (c) { out(c.id.slice(0, 12)); }); return; }
    table([['CONTAINER ID', 'IMAGE', 'COMMAND', 'CREATED', 'STATUS', 'PORTS', 'NAMES']].concat(list.map(function (c) {
      var cmd = c.cmdLine.length > 20 ? c.cmdLine.slice(0, 19) + '…' : c.cmdLine;
      return [c.id.slice(0, 12), imgName(c), '"' + cmd + '"', ago(c.created), status(c), portsTxt(c), c.name];
    })));
    if (!all && W.ctrs.some(function (c) { return !running(c); }) && !list.length) dim('# ga ada yang jalan. Tambah -a buat lihat container yang sudah berhenti.');
  }
  function imagesCmd(a) {
    var showAll = a.indexOf('-a') >= 0;
    var q = a.indexOf('-q') >= 0;
    var rows = [];
    W.images.slice().reverse().forEach(function (im) {
      if (!im.tags.length) { rows.push(['<none>', '<none>', im.id.slice(0, 12), ago(im.created), fmtSize(im.size)]); return; }
      im.tags.forEach(function (t) {
        var i = t.lastIndexOf(':');
        rows.push([t.slice(0, i), t.slice(i + 1), im.id.slice(0, 12), ago(im.created), fmtSize(im.size)]);
      });
    });
    if (showAll) { /* same list */ }
    if (q) { rows.forEach(function (r) { out(r[2]); }); return; }
    table([['REPOSITORY', 'TAG', 'IMAGE ID', 'CREATED', 'SIZE']].concat(rows));
  }
  async function buildCmd(a) {
    var tag = null, ctx = null, noCache = false;
    for (var i = 0; i < a.length; i++) {
      var t = a[i];
      if (t === '-t' || t === '--tag') tag = a[++i];
      else if (/^--tag=/.test(t)) tag = t.slice(6);
      else if (/^-t\S/.test(t)) tag = t.slice(2);
      else if (t === '--no-cache') noCache = true;
      else if (t === '-f' || t === '--file') {
        var f = a[++i];
        if (f !== 'Dockerfile' && f !== './Dockerfile') { err('ERROR: failed to solve: failed to read dockerfile: open ' + f + ': no such file or directory'); return; }
      } else if (t === '-q' || t === '--quiet' || t === '--pull' || /^--progress/.test(t)) { /* ignored */ }
      else if (t[0] === '-') { err('unknown flag: ' + t); return; }
      else if (ctx === null) ctx = t;
      else { err('ERROR: "docker buildx build" requires exactly 1 argument.'); return; }
    }
    if (ctx === null) { err('ERROR: "docker buildx build" requires exactly 1 argument.'); dim('# jangan lupa titik di akhir: docker build -t app:1.0 .'); return; }
    if (ctx !== '.' && ctx !== './' && ctx !== '/home/rifki/app') { err('ERROR: unable to prepare context: path "' + ctx + '" not found'); return; }
    if (tag && !/^[a-z0-9][a-z0-9._/-]*(:[\w][\w.-]{0,127})?$/.test(tag)) { err('ERROR: invalid tag "' + tag + '": repository name must be lowercase'); return; }
    var before = tag ? imgByRef(tag) : null;
    var img = await build(tag, { noCache: noCache });
    if (img && before && before !== img) {
      var users = W.ctrs.filter(function (c) { return c.img === before && running(c); });
      if (users.length) hint('# image ' + normRef(tag) + ' sekarang menunjuk ke build baru, tapi container ' + users.map(function (c) { return c.name; }).join(', ') + ' masih jalan dari image lama. Hapus dan run ulang supaya dapat versi baru.');
    }
  }
  function lifecycle(op, a) {
    var force = false, names = [];
    a.forEach(function (x) { if (x === '-f' || x === '--force') force = true; else if (x === '-v' || x[0] === '-') { /* ignore */ } else names.push(x); });
    if (!names.length) { err('"docker ' + op + '" requires at least 1 argument.'); return; }
    names.forEach(function (n) {
      var c = findCtr(n);
      if (!c) { err('Error response from daemon: No such container: ' + n); return; }
      if (op === 'stop' || op === 'kill') {
        if (running(c)) { stopCtr(c); if (op === 'kill') c.code = 137; }
        out(n);
      } else if (op === 'start' || op === 'restart') {
        if (op === 'restart' && running(c)) stopCtr(c);
        if (running(c)) { out(n); return; }
        var r = startCtr(c);
        if (!r.ok) { err('Error response from daemon: ' + r.msg.replace(/^Error response from daemon: /, '')); err('Error: failed to start containers: ' + n); return; }
        out(n);
        K.pulse(app, 'run');
      } else if (op === 'rm') {
        if (running(c) && !force) {
          err('Error response from daemon: cannot remove container "/' + c.name + '": container is running: stop the container before removing or force remove');
          return;
        }
        if (running(c)) stopCtr(c);
        removeCtr(c);
        out(n);
      } else {
        err('Error response from daemon: ' + op + ' belum didukung di simulasi');
      }
    });
    renderAll();
  }
  function logsCmd(a) {
    var tail = null, name = null;
    for (var i = 0; i < a.length; i++) {
      if (a[i] === '--tail' || a[i] === '-n') tail = parseInt(a[++i], 10);
      else if (a[i][0] !== '-') name = a[i];
    }
    var c = findCtr(name);
    if (!c) { err('Error response from daemon: No such container: ' + (name || '')); return; }
    var L = c.logs;
    if (tail >= 0 && tail !== null) L = L.slice(-tail);
    L.forEach(function (l) { out(l); });
    if (a.indexOf('-f') >= 0) dim('# (simulasi) -f ga nge-follow, cuma nampilin log yang sudah ada');
    if (!L.length) dim('# log kosong');
  }
  function execCmd(a) {
    var i = 0;
    while (i < a.length && a[i][0] === '-') { if (a[i] === '-e' || a[i] === '-u' || a[i] === '-w') i++; i++; }
    var c = findCtr(a[i]), argv = a.slice(i + 1);
    if (!c) { err('Error response from daemon: No such container: ' + (a[i] || '')); return; }
    if (!running(c)) { err('Error response from daemon: container ' + c.id + ' is not running'); return; }
    if (!argv.length) { err('"docker exec" requires at least 2 arguments.'); return; }
    if (argv[0] === 'sh' && argv[1] === '-c') argv = words(argv.slice(2).join(' '));
    var b = argv[0].split('/').pop();
    if ((b === 'sh' || b === 'bash') && argv.length === 1) {
      if (b === 'bash' && c.img.cfg.os === 'alpine') { err('OCI runtime exec failed: exec failed: unable to start container process: exec: "bash": executable file not found in $PATH: unknown'); dim('# Alpine cuma punya sh'); return; }
      dim('# shell interaktif ga ada di simulasi ini. Ketik perintahnya langsung, misal: docker exec ' + c.name + ' ls /');
      return;
    }
    if (b === 'curl') { curl(argv.slice(1), c); return; }
    if (b === 'ping') {
      var host = argv.filter(function (x) { return x[0] !== '-' && !/^\d+$/.test(x); })[1];
      if (!host) { err('ping: usage error: Destination address required'); return; }
      var t = host === 'localhost' ? c : resolveName(c, host);
      if (!t) {
        err('ping: ' + host + ': Name or service not known');
        if (c.net === 'bridge' && findCtr(host)) hint('# di network bridge bawaan, container ga bisa saling panggil pakai nama. Bikin network sendiri (docker network create) atau pakai Compose.');
        return;
      }
      var ip = t === c ? '127.0.0.1' : t.ip;
      term.lines(['PING ' + esc(host) + ' (' + ip + ') 56(84) bytes of data.', '64 bytes from ' + (t === c ? 'localhost' : esc(t.name) + '.' + esc(c.net)) + ' (' + ip + '): icmp_seq=1 ttl=64 time=0.0' + rnd(4, 9) + ' ms', '64 bytes from ' + (t === c ? 'localhost' : esc(t.name) + '.' + esc(c.net)) + ' (' + ip + '): icmp_seq=2 ttl=64 time=0.0' + rnd(4, 9) + ' ms', '', '--- ' + esc(host) + ' ping statistics ---', '2 packets transmitted, 2 received, 0% packet loss']);
      return;
    }
    if (b === 'redis-cli') {
      if (c.img.cfg.kind !== 'redis') { err('OCI runtime exec failed: exec: "redis-cli": executable file not found in $PATH: unknown'); return; }
      var ref = fileRef(c, '/data/dump.rdb');
      var db = ref.store[ref.key] ? JSON.parse(ref.store[ref.key]) : {};
      var op = (argv[1] || '').toLowerCase(), k = argv[2], res;
      if (!op) { dim('# redis-cli interaktif ga ada, kasih perintahnya langsung: redis-cli SET kunci nilai'); return; }
      if (op === 'ping') res = 'PONG';
      else if (op === 'set') { db[k] = argv.slice(3).join(' '); res = 'OK'; }
      else if (op === 'get') res = db[k] === undefined ? '(nil)' : '"' + db[k] + '"';
      else if (op === 'incr') { db[k] = String((parseInt(db[k], 10) || 0) + 1); res = '(integer) ' + db[k]; }
      else if (op === 'keys') res = Object.keys(db).map(function (x, i2) { return (i2 + 1) + ') "' + x + '"'; }).join('\n') || '(empty array)';
      else if (op === 'del') { res = '(integer) ' + (db[k] !== undefined ? 1 : 0); delete db[k]; }
      else res = "(error) ERR unknown command '" + argv[1] + "'";
      ref.store[ref.key] = JSON.stringify(db);
      term.lines(String(res).split('\n').map(esc));
      return;
    }
    if (b === 'touch' || (b === 'echo' && argv.indexOf('>') > 0)) {
      var path = b === 'touch' ? argv[1] : argv[argv.indexOf('>') + 1];
      var fr = fileRef(c, resolvePath(path, c.img.cfg.workdir || '/'));
      fr.store[fr.key] = b === 'touch' ? (fr.store[fr.key] || '') : argv.slice(1, argv.indexOf('>')).join(' ') + '\n';
      renderAll();
      return;
    }
    var r = inside(c, argv);
    if (!r) { err('OCI runtime exec failed: exec failed: unable to start container process: exec: "' + argv[0] + '": executable file not found in $PATH: unknown'); return; }
    term.lines(r.out.map(esc), r.code ? 'sx-err' : '');
  }
  function rmiCmd(a) {
    var force = a.indexOf('-f') >= 0 || a.indexOf('--force') >= 0;
    var names = a.filter(function (x) { return x[0] !== '-'; });
    if (!names.length) { err('"docker rmi" requires at least 1 argument.'); return; }
    names.forEach(function (n) {
      var img = findImage(n);
      if (!img) { err('Error response from daemon: No such image: ' + normRef(n)); return; }
      var users = W.ctrs.filter(function (c) { return c.img.id === img.id; });
      var byRef = imgByRef(n) === img;
      if (byRef && img.tags.length > 1) {
        img.tags = img.tags.filter(function (t) { return t !== normRef(n); });
        out('Untagged: ' + normRef(n));
        return;
      }
      if (users.length && !force) {
        err('Error response from daemon: conflict: unable to ' + (byRef ? 'remove repository reference "' + n + '" (must force)' : 'delete ' + img.id.slice(0, 12) + ' (must be forced)') + ' - container ' + users[0].id.slice(0, 12) + ' is using its referenced image ' + img.id.slice(0, 12));
        return;
      }
      if (users.some(running) && force) {
        err('Error response from daemon: conflict: unable to delete ' + img.id.slice(0, 12) + ' (cannot be forced) - image is being used by running container ' + users.filter(running)[0].id.slice(0, 12));
        return;
      }
      img.tags.forEach(function (t) { out('Untagged: ' + t); });
      out('Deleted: sha256:' + img.id);
      W.images = W.images.filter(function (x) { return x !== img; });
      if (img.canon) {
        // drop pulled layers no other image uses, so the next pull downloads again
        var keep = {};
        W.images.forEach(function (x) { if (x.canon) layerIds(x.canon).forEach(function (id) { keep[id] = true; }); });
        layerIds(img.canon).forEach(function (id) { if (!keep[id]) delete W.layers[id]; });
      }
    });
    renderAll();
  }
  function tagCmd(a) {
    if (a.length !== 2) { err('"docker tag" requires exactly 2 arguments.'); return; }
    var img = findImage(a[0]);
    if (!img) { err('Error response from daemon: No such image: ' + normRef(a[0])); return; }
    var ref = normRef(a[1]);
    W.images.forEach(function (im) { im.tags = im.tags.filter(function (t) { return t !== ref; }); });
    img.tags.push(ref);
    renderAll();
  }
  function inspectCmd(a) {
    var n = a.filter(function (x) { return x[0] !== '-'; })[0];
    var c = findCtr(n);
    if (c) {
      var o = {
        Id: c.id, Name: '/' + c.name, Image: 'sha256:' + c.img.id,
        State: { Status: c.state, Running: running(c), ExitCode: c.code },
        Config: { Cmd: c.cmd.length ? c.cmd : c.img.cfg.cmd, Env: Object.keys(c.env).map(function (k) { return k + '=' + c.env[k]; }), WorkingDir: c.img.cfg.workdir, ExposedPorts: c.img.cfg.expose.map(function (p) { return p + '/tcp'; }) },
        Mounts: c.mounts.map(function (m) { return { Type: m.type, Name: m.type === 'volume' ? m.src : undefined, Source: m.type === 'volume' ? '/var/lib/docker/volumes/' + m.src + '/_data' : m.src, Destination: m.dst }; }),
        NetworkSettings: { Networks: {}, Ports: {} }
      };
      o.NetworkSettings.Networks[c.net] = { IPAddress: running(c) ? c.ip : '' };
      c.ports.forEach(function (p) { o.NetworkSettings.Ports[p.c + '/tcp'] = [{ HostIp: '0.0.0.0', HostPort: String(p.h) }]; });
      term.lines(JSON.stringify([o], null, 4).split('\n').map(esc));
      return;
    }
    var img = n && findImage(n);
    if (img) {
      term.lines(JSON.stringify([{ Id: 'sha256:' + img.id, RepoTags: img.tags, Config: { Cmd: img.cfg.cmd, Entrypoint: img.cfg.entry.length ? img.cfg.entry : null, Env: Object.keys(img.cfg.env).map(function (k) { return k + '=' + img.cfg.env[k]; }), WorkingDir: img.cfg.workdir, ExposedPorts: img.cfg.expose.map(function (p) { return p + '/tcp'; }) }, RootFS: { Type: 'layers', Layers: img.layers.map(function (l) { return 'sha256:' + l.id.slice(0, 16) + '…'; }) } }], null, 4).split('\n').map(esc));
      return;
    }
    err('Error: No such object: ' + (n || ''));
  }
  function historyCmd(a) {
    var img = findImage(a.filter(function (x) { return x[0] !== '-'; })[0] || '');
    if (!img) { err('Error response from daemon: No such image: ' + (a[0] || '')); return; }
    var rows = [['IMAGE', 'CREATED', 'CREATED BY', 'SIZE']];
    img.layers.slice().reverse().forEach(function (l, i) {
      rows.push([i === 0 ? img.id.slice(0, 12) : '<missing>', ago(img.created), l.base ? '/bin/sh -c #(nop) layer dari image dasar' : l.cmd.length > 46 ? l.cmd.slice(0, 45) + '…' : l.cmd, fmtSize(l.size)]);
    });
    table(rows);
  }
  function volumeCmd(a) {
    var op = a[0], n = a[1];
    if (op === 'ls' || op === 'list' || !op) {
      table([['DRIVER', 'VOLUME NAME']].concat(Object.keys(W.vols).map(function (v) { return ['local', v]; })));
      return;
    }
    if (op === 'create') {
      n = n || digest('v' + Math.random());
      if (!W.vols[n]) W.vols[n] = { data: {}, created: Date.now(), anon: false };
      out(n);
      renderAll();
      return;
    }
    if (op === 'rm' || op === 'remove') {
      a.slice(1).filter(function (x) { return x[0] !== '-'; }).forEach(function (v) {
        if (!W.vols[v]) { err('Error response from daemon: get ' + v + ': no such volume'); return; }
        var u = W.ctrs.filter(function (c) { return c.mounts.some(function (m) { return m.src === v; }); });
        if (u.length) { err('Error response from daemon: remove ' + v + ': volume is in use - [' + u.map(function (c) { return c.id; }).join(', ') + ']'); return; }
        delete W.vols[v];
        out(v);
      });
      renderAll();
      return;
    }
    if (op === 'inspect') {
      if (!W.vols[n]) { err('Error response from daemon: get ' + (n || '') + ': no such volume'); return; }
      term.lines(JSON.stringify([{ CreatedAt: new Date(W.vols[n].created).toISOString(), Driver: 'local', Mountpoint: '/var/lib/docker/volumes/' + n + '/_data', Name: n, Scope: 'local', Isi: Object.keys(W.vols[n].data) }], null, 4).split('\n').map(esc));
      return;
    }
    if (op === 'prune') {
      var used = {};
      W.ctrs.forEach(function (c) { c.mounts.forEach(function (m) { used[m.src] = true; }); });
      var gone = Object.keys(W.vols).filter(function (v) { return !used[v] && W.vols[v].anon; });
      gone.forEach(function (v) { delete W.vols[v]; });
      out('Deleted Volumes:');
      gone.forEach(out);
      out('');
      out('Total reclaimed space: 0B');
      renderAll();
      return;
    }
    err('docker: unknown command: docker volume ' + op);
  }
  function networkCmd(a) {
    var op = a[0], n = a.filter(function (x, i) { return i > 0 && x[0] !== '-'; })[0];
    if (op === 'ls' || !op) {
      table([['NETWORK ID', 'NAME', 'DRIVER', 'SCOPE']].concat(Object.keys(W.nets).map(function (k) { return [digest('net' + k).slice(0, 12), k, W.nets[k].driver, 'local']; })));
      return;
    }
    if (op === 'create') {
      if (!n) { err('"docker network create" requires exactly 1 argument.'); return; }
      if (W.nets[n]) { err('Error response from daemon: network with name ' + n + ' already exists'); return; }
      W.nets[n] = { driver: 'bridge', sub: W.netSeq++, next: 2, created: Date.now() };
      out(digest('net' + n));
      renderAll();
      return;
    }
    if (op === 'rm') {
      if (!W.nets[n]) { err('Error response from daemon: network ' + (n || '') + ' not found'); return; }
      if (/^(bridge|host|none)$/.test(n)) { err('Error response from daemon: ' + n + ' is a pre-defined network and cannot be removed'); return; }
      if (W.ctrs.some(function (c) { return c.net === n && running(c); })) { err('Error response from daemon: error while removing network: network ' + n + ' id ' + digest('net' + n) + ' has active endpoints'); return; }
      delete W.nets[n];
      out(n);
      renderAll();
      return;
    }
    if (op === 'connect') { dim('# network connect belum didukung. Jalankan ulang container dengan --network ' + (a[1] || 'NAMA')); return; }
    if (op === 'inspect') {
      if (!W.nets[n]) { err('Error response from daemon: network ' + (n || '') + ' not found'); return; }
      var cs = {};
      W.ctrs.filter(function (c) { return c.net === n && running(c); }).forEach(function (c) { cs[c.id.slice(0, 12)] = { Name: c.name, IPv4Address: c.ip + '/16' }; });
      term.lines(JSON.stringify([{ Name: n, Driver: W.nets[n].driver, IPAM: W.nets[n].sub ? { Config: [{ Subnet: '172.' + W.nets[n].sub + '.0.0/16' }] } : {}, Containers: cs }], null, 4).split('\n').map(esc));
      return;
    }
    err('docker: unknown command: docker network ' + op);
  }
  function sysDf() {
    var imgSize = W.images.reduce(function (s, i) { return s + i.size; }, 0);
    table([['TYPE', 'TOTAL', 'ACTIVE', 'SIZE', 'RECLAIMABLE'],
      ['Images', String(W.images.length), String(W.images.filter(function (i) { return W.ctrs.some(function (c) { return c.img.id === i.id; }); }).length), fmtSize(imgSize), fmtSize(W.images.filter(function (i) { return !W.ctrs.some(function (c) { return c.img.id === i.id; }); }).reduce(function (s, i) { return s + i.size; }, 0))],
      ['Containers', String(W.ctrs.length), String(W.ctrs.filter(running).length), '0B', '0B'],
      ['Local Volumes', String(Object.keys(W.vols).length), String(Object.keys(W.vols).filter(function (v) { return W.ctrs.some(function (c) { return c.mounts.some(function (m) { return m.src === v; }); }); }).length), '0B', '0B'],
      ['Build Cache', String(Object.keys(W.cache).length), '0', fmtSize(Object.keys(W.cache).length * 4.2), fmtSize(Object.keys(W.cache).length * 4.2)]]);
  }
  function prune(what, a) {
    var force = a.indexOf('-f') >= 0 || a.indexOf('--force') >= 0;
    var allImg = a.indexOf('-a') >= 0 || a.indexOf('--all') >= 0;
    var msg = {
      container: 'WARNING! This will remove all stopped containers.',
      image: allImg ? 'WARNING! This will remove all images without at least one container associated to them.' : 'WARNING! This will remove all dangling images.',
      system: 'WARNING! This will remove:\n  - all stopped containers\n  - all networks not used by at least one container\n  - all dangling images\n  - unused build cache'
    }[what];
    function go() {
      var lines = [];
      if (what === 'container' || what === 'system') {
        var dead = W.ctrs.filter(function (c) { return !running(c); });
        if (dead.length) lines.push('Deleted Containers:');
        dead.forEach(function (c) { removeCtr(c); lines.push(c.id); });
      }
      if (what === 'image' || what === 'system') {
        var used = {};
        W.ctrs.forEach(function (c) { used[c.img.id] = true; });
        var gone = W.images.filter(function (i) { return !used[i.id] && (!i.tags.length || allImg); });
        if (gone.length) lines.push('Deleted Images:');
        gone.forEach(function (i) { i.tags.forEach(function (t) { lines.push('untagged: ' + t); }); lines.push('deleted: sha256:' + i.id); });
        W.images = W.images.filter(function (i) { return gone.indexOf(i) < 0; });
      }
      if (what === 'system') {
        Object.keys(W.nets).forEach(function (n) { if (!/^(bridge|host|none)$/.test(n) && !W.ctrs.some(function (c) { return c.net === n; })) { delete W.nets[n]; } });
        W.cache = {};
        lines.push('Deleted build cache objects: semua');
      }
      lines.push('', 'Total reclaimed space: ' + fmtSize(rnd(10, 400)));
      term.lines(lines.map(esc));
      renderAll();
    }
    if (force) { go(); return; }
    term.lines(msg.split('\n').map(esc));
    term.line('Are you sure you want to continue? [y/N]');
    W.ask = go;
    app.classList.add('is-confirm');
  }

  // ---------- compose ----------
  var PROJ = 'app';
  function loadCompose() {
    var src = W.files['compose.yaml'], doc;
    try { doc = K.parseYAML(src); }
    catch (e) { return { err: 'yaml: line ' + e.line + ': ' + e.msg, line: e.line }; }
    if (!doc || typeof doc !== 'object' || !doc.services || typeof doc.services !== 'object') return { err: 'no service selected', line: 1, hint: 'compose.yaml harus punya kunci services:' };
    var svcs = [], names = Object.keys(doc.services);
    for (var i = 0; i < names.length; i++) {
      var n = names[i], s = doc.services[n] || {};
      var ln = K.yamlLine(doc.services, n);
      if (typeof s !== 'object') return { err: 'services.' + n + ' must be a mapping', line: ln };
      var known = ['image', 'build', 'ports', 'environment', 'volumes', 'depends_on', 'command', 'restart', 'container_name', 'networks', 'expose', 'healthcheck', 'working_dir', 'env_file'];
      var bad = Object.keys(s).filter(function (k) { return known.indexOf(k) < 0; })[0];
      if (bad) return { err: 'validating compose.yaml: services.' + n + ' additional properties \'' + bad + '\' not allowed', line: K.yamlLine(s, bad) };
      if (!s.image && !s.build) return { err: 'service "' + n + '" has neither an image nor a build context specified: invalid compose project', line: ln };
      var env = {};
      if (Array.isArray(s.environment)) s.environment.forEach(function (kv) { var j = String(kv).indexOf('='); if (j > 0) env[String(kv).slice(0, j)] = String(kv).slice(j + 1); });
      else if (s.environment && typeof s.environment === 'object') Object.keys(s.environment).forEach(function (k) { env[k] = s.environment[k] === null ? '' : String(s.environment[k]); });
      var ports = parsePorts((s.ports || []).map(String));
      if (ports.err) return { err: 'services.' + n + '.ports: ' + ports.err, line: K.yamlLine(s, 'ports') };
      var vols = [];
      for (var v = 0; v < (s.volumes || []).length; v++) {
        var p = String(s.volumes[v]).split(':');
        if (p.length < 2) { vols.push({ type: 'volume', src: null, dst: p[0], anon: true }); continue; }
        if (/^[./~]/.test(p[0])) vols.push({ type: 'bind', src: p[0].replace(/^\.\//, '/home/rifki/app/'), dst: p[1] });
        else {
          if (!doc.volumes || !(p[0] in doc.volumes)) return { err: 'service "' + n + '" refers to undefined volume ' + p[0] + ': invalid compose project', line: K.yamlLine(s, 'volumes') };
          vols.push({ type: 'volume', src: PROJ + '_' + p[0], dst: p[1] });
        }
      }
      var deps = Array.isArray(s.depends_on) ? s.depends_on : s.depends_on && typeof s.depends_on === 'object' ? Object.keys(s.depends_on) : [];
      for (var d = 0; d < deps.length; d++) if (names.indexOf(deps[d]) < 0) return { err: 'service "' + n + '" depends on undefined service "' + deps[d] + '": invalid compose project', line: K.yamlLine(s, 'depends_on') };
      var cmd = s.command ? (Array.isArray(s.command) ? s.command.map(String) : words(String(s.command))) : [];
      svcs.push({ name: n, image: s.image ? String(s.image) : null, build: !!s.build, env: env, ports: ports.ports, vols: vols, deps: deps, cmd: cmd, cname: s.container_name || PROJ + '-' + n + '-1' });
    }
    // order by depends_on
    var order = [], seen = {};
    function visit(s, stack) {
      if (seen[s.name]) return;
      if (stack.indexOf(s.name) >= 0) throw { err: 'dependency cycle detected: ' + stack.concat(s.name).join(' -> ') };
      s.deps.forEach(function (d2) { visit(svcs.filter(function (x) { return x.name === d2; })[0], stack.concat(s.name)); });
      seen[s.name] = true;
      order.push(s);
    }
    try { svcs.forEach(function (s) { visit(s, []); }); } catch (e) { return { err: e.err, line: 1 }; }
    return { svcs: order, vols: doc.volumes ? Object.keys(doc.volumes) : [] };
  }
  function composeCtrs() { return W.ctrs.filter(function (c) { return c.compose && c.compose.proj === PROJ; }); }
  function cfgSig(s, img) { return JSON.stringify([img.id, s.env, s.ports, s.vols.map(function (v) { return v.anon ? '' : v.src + v.dst; }), s.cmd]); }
  function crow(kind, name, st, t) {
    var nm = pad(kind + ' ' + name, 26);
    return ' <span class="sx-ok">✔</span> ' + esc(nm) + '<span class="' + (st === 'Error' ? 'sx-err' : 'sx-ok') + '">' + esc(pad(st, 10)) + '</span><span class="sx-dim">' + t.toFixed(1) + 's</span>';
  }
  async function compose(a) {
    var i = 0;
    while (a[i] === '-f' || a[i] === '--file' || a[i] === '-p') { i += 2; }
    var op = a[i], args = a.slice(i + 1);
    if (!op) { dim('Usage:  docker compose [OPTIONS] COMMAND'); return; }
    if (op === 'ps') {
      var list = composeCtrs().filter(function (c) { return running(c) || args.indexOf('-a') >= 0; });
      table([['NAME', 'IMAGE', 'SERVICE', 'STATUS', 'PORTS']].concat(list.map(function (c) { return [c.name, c.ref, c.compose.svc, status(c), portsTxt(c)]; })));
      return;
    }
    if (op === 'logs') {
      var only = args.filter(function (x) { return x[0] !== '-'; });
      composeCtrs().filter(function (c) { return !only.length || only.indexOf(c.compose.svc) >= 0; }).forEach(function (c) {
        c.logs.slice(-8).forEach(function (l) { term.line('<span class="dk-svc">' + esc(pad(c.name, 14)) + '|</span> ' + esc(l)); });
      });
      return;
    }
    if (op === 'down') {
      var cs = composeCtrs();
      var rows = [], anon = [];
      cs.forEach(function (c) {
        if (running(c)) stopCtr(c);
        c.mounts.forEach(function (m) { if (m.anon) anon.push(m.src); });
        rows.push(['Container', c.name, 'Removed']);
        removeCtr(c);
      });
      if (W.nets[PROJ + '_default']) { delete W.nets[PROJ + '_default']; rows.push(['Network', PROJ + '_default', 'Removed']); }
      if (args.indexOf('-v') >= 0 || args.indexOf('--volumes') >= 0) {
        Object.keys(W.vols).forEach(function (v) {
          if (W.vols[v].compose === PROJ || anon.indexOf(v) >= 0) { delete W.vols[v]; rows.push(['Volume', W.vols[v] && W.vols[v].anon ? v.slice(0, 12) : v, 'Removed']); }
        });
      }
      if (!rows.length) { dim('# belum ada yang jalan dari compose.yaml'); return; }
      term.line('[+] Running ' + rows.length + '/' + rows.length);
      rows.forEach(function (r) { term.line(crow(r[0], r[1], r[2], Math.random() * 0.6 + 0.1)); });
      renderAll();
      return;
    }
    if (op === 'stop' || op === 'start' || op === 'restart') {
      composeCtrs().forEach(function (c) { lifecycle(op, [c.name]); });
      return;
    }
    if (op === 'exec') {
      var svc = args.filter(function (x) { return x[0] !== '-'; })[0];
      var c = composeCtrs().filter(function (x) { return x.compose.svc === svc; })[0];
      if (!c) { err('service "' + (svc || '') + '" is not running'); return; }
      execCmd([c.name].concat(args.slice(args.indexOf(svc) + 1)));
      return;
    }
    if (op === 'config') { term.lines(W.files['compose.yaml'].replace(/\n$/, '').split('\n').map(esc)); return; }
    if (op !== 'up' && op !== 'build' && op !== 'create') { err('unknown docker command: "compose ' + op + '"'); return; }
    var cf = loadCompose();
    if (cf.err) { err(cf.err); if (cf.hint) dim('# ' + cf.hint); markErr('compose.yaml', cf.line); return; }
    W.errs['compose.yaml'] = [];
    renderTabs();
    var forceBuild = op === 'build' || args.indexOf('--build') >= 0;
    var detach = args.indexOf('-d') >= 0 || args.indexOf('--detach') >= 0;
    // build / pull first
    var imgs = {};
    for (var k = 0; k < cf.svcs.length; k++) {
      var s = cf.svcs[k];
      if (s.build) {
        var ref = s.image || PROJ + '-' + s.name;
        var have = imgByRef(ref);
        if (!have || forceBuild) {
          var b = await build(ref, { quiet: true });
          if (!b) { err('failed to solve: service "' + s.name + '" gagal di-build'); return; }
          have = b;
        }
        imgs[s.name] = { img: have, ref: ref };
      } else {
        var im = imgByRef(s.image);
        if (!im) {
          term.line('[+] Pulling 1/1');
          var ok = await pull(s.image, true);
          if (!ok) return;
          im = imgByRef(s.image);
          term.line(' <span class="sx-ok">✔</span> ' + esc(s.name) + ' Pulled');
        }
        imgs[s.name] = { img: im, ref: s.image };
      }
    }
    if (op === 'build') return;
    var rows2 = [];
    var net = PROJ + '_default';
    if (!W.nets[net]) { W.nets[net] = { driver: 'bridge', sub: W.netSeq++, next: 2, created: Date.now() }; rows2.push(['Network', net, 'Created']); }
    cf.vols.forEach(function (v) {
      var vn = PROJ + '_' + v;
      if (!W.vols[vn]) { W.vols[vn] = { data: {}, created: Date.now(), anon: false, compose: PROJ }; rows2.push(['Volume', '"' + vn + '"', 'Created']); }
    });
    var errMsg = null;
    cf.svcs.forEach(function (s) {
      if (errMsg) return;
      var I = imgs[s.name];
      var sig = cfgSig(s, I.img);
      var ex = W.ctrs.filter(function (c) { return c.name === s.cname; })[0];
      var state = 'Started';
      if (ex && ex.compose && ex.compose.sig === sig) {
        if (running(ex)) { rows2.push(['Container', s.cname, 'Running']); return; }
      } else if (ex) {
        if (!ex.compose) { errMsg = 'Error response from daemon: Conflict. The container name "/' + s.cname + '" is already in use by container "' + ex.id + '". You have to remove (or rename) that container to be able to reuse that name.'; return; }
        stopCtr(ex);
        removeCtr(ex);
        ex = null;
        state = 'Recreated';
      }
      if (!ex) ex = createCtr(I.img, { name: s.cname, ref: I.ref, cmd: s.cmd, env: s.env, ports: s.ports, mounts: s.vols, net: net, compose: { proj: PROJ, svc: s.name, sig: sig }, aliases: [s.name] });
      var r = startCtr(ex);
      if (!r.ok) { errMsg = r.msg; rows2.push(['Container', s.cname, 'Error']); return; }
      rows2.push(['Container', s.cname, state]);
    });
    term.line('[+] Running ' + rows2.length + '/' + rows2.length);
    for (var x = 0; x < rows2.length; x++) {
      await sleep(120);
      term.line(crow(rows2[x][0], rows2[x][1], rows2[x][2], Math.random() * 0.6 + 0.1));
    }
    if (errMsg) err(errMsg);
    if (!detach && !errMsg) {
      composeCtrs().filter(running).forEach(function (c) { c.logs.slice(-3).forEach(function (l) { term.line('<span class="dk-svc">' + esc(pad(c.name, 14)) + '|</span> ' + esc(l)); }); });
      dim('# (simulasi) tanpa -d, Compose biasanya nempel ke log. Di sini anggap kamu langsung detach.');
    }
    K.pulse(app, 'run');
    await sleep(400);
    renderAll();
  }

  // ---------- editor ----------
  var curTab = 'Dockerfile';
  var ed = new K.Editor($('dk-ed'), {
    value: '', label: 'Isi file', highlight: K.hlDocker,
    onChange: function (v) { W.files[curTab] = v; W.errs[curTab] = []; renderTabs(); renderFlow(); }
  });
  function openTab(f) {
    curTab = f;
    var t = TABS.filter(function (x) { return x.f === f; })[0];
    ed.highlight = t.hl;
    ed.ta.value = W.files[f];
    ed.mark(W.errs[f] || []);
    ed.ta.setAttribute('aria-label', 'Isi file ' + f);
    renderTabs();
  }
  function renderTabs() {
    setHTML($('dk-tabs'), TABS.map(function (t) {
      var bad = (W.errs[t.f] || []).length;
      var mod = W.files[t.f] !== FILES0[t.f];
      return '<button type="button" role="tab" data-act="tab" data-f="' + t.f + '" aria-selected="' + (t.f === curTab) + '">' + esc(t.f) + (bad ? ' <i>●</i>' : mod ? ' <i title="diubah">*</i>' : '') + '</button>';
    }).join(''));
  }
  function markErr(file, line) {
    W.errs[file] = line ? [line] : [];
    if (file !== curTab) openTab(file); else ed.mark(W.errs[file]);
    renderTabs();
  }

  // ---------- render ----------
  var cards = {};
  function renderFlow() {
    var df, bad = false;
    try { df = parseDockerfile(W.files.Dockerfile); } catch (e) { bad = true; }
    var fs = $('dk-f-df');
    setText(fs, bad ? 'ada error' : df.length + ' instruksi');
    fs.dataset.s = bad ? 'bad' : '';
    var nb = W.images.length, own = W.images.filter(function (i) { return i.built; }).length;
    setText($('dk-f-img'), nb ? nb + ' image' + (own ? ', ' + own + ' buatanmu' : '') : 'belum ada');
    var up = W.ctrs.filter(running).length, dn = W.ctrs.length - up;
    var fc = $('dk-f-ctr');
    setText(fc, W.ctrs.length ? up + ' jalan' + (dn ? ', ' + dn + ' mati' : '') : 'belum ada');
    fc.dataset.s = up ? 'ok' : dn ? 'warn' : '';
    var ports = [];
    W.ctrs.filter(running).forEach(function (c) { c.ports.forEach(function (p) { ports.push(':' + p.h); }); });
    var fp = $('dk-f-port');
    setText(fp, ports.length ? ports.slice(0, 3).join(' ') + (ports.length > 3 ? ' …' : '') : 'belum ada');
    fp.dataset.s = ports.length ? 'ok' : '';
  }
  function ctrCard(c) {
    var el = cards['c' + c.id];
    if (!el) {
      el = document.createElement('div');
      el.className = 'dk-c';
      el.innerHTML = '<div class="dk-ch"><i class="dk-dot" aria-hidden="true"></i><b></b><em></em></div><div class="dk-body"></div><div class="dk-acts"></div>';
      cards['c' + c.id] = el;
    }
    var st = c.state === 'running' ? 'run' : c.state === 'created' ? 'new' : c.code ? 'bad' : 'off';
    el.className = 'dk-c is-' + st + (c.compose ? ' is-compose' : '');
    setText(el.querySelector('b'), c.name);
    setText(el.querySelector('em'), c.state === 'running' ? 'jalan · ' + durID(c.started) : c.state === 'created' ? 'dibuat, belum jalan' : 'keluar (' + c.code + ')');
    var body = '<div class="dk-meta"><span class="dk-imgref">' + esc(c.ref) + '</span> · ' + c.id.slice(0, 12) + (c.compose ? ' · <span class="dk-svc">compose</span>' : '') + '</div>';
    if (c.ports.length) body += '<div class="dk-row"><small>port</small>' + c.ports.map(function (p) { return '<span class="dk-port' + (running(c) ? ' is-on' : '') + '">:' + p.h + ' → ' + p.c + '</span>'; }).join('') + '</div>';
    var ms = c.mounts.filter(function (m) { return !m.anon; });
    if (c.mounts.length) body += '<div class="dk-row"><small>data</small>' + c.mounts.map(function (m) { return '<span class="dk-mnt' + (m.anon ? ' is-anon' : '') + '" title="' + esc((m.anon ? 'volume anonim ' : m.type + ' ') + m.src) + '">' + esc(m.anon ? 'anonim' : m.src.length > 18 ? '…' + m.src.slice(-16) : m.src) + ' → ' + esc(m.dst) + '</span>'; }).join('') + '</div>';
    void ms;
    if (c.net !== 'bridge') body += '<div class="dk-row"><small>net</small><span class="dk-net">' + esc(c.net) + '</span></div>';
    var last = c.logs.filter(function (l) { return /Error|SyntaxError|can't open/.test(l); })[0] || c.logs[c.logs.length - 1];
    if (c.state !== 'running' && c.code && last) body += '<div class="dk-log" title="baris log terakhir">' + esc(last) + '</div>';
    setHTML(el.querySelector('.dk-body'), body);
    var n = esc(c.name);
    setHTML(el.querySelector('.dk-acts'),
      '<button type="button" data-act="cmd" data-cmd="docker logs ' + n + '">logs</button>' +
      (running(c) ? '<button type="button" data-act="cmd" data-cmd="docker stop ' + n + '">stop</button>' : '<button type="button" data-act="cmd" data-cmd="docker start ' + n + '">start</button>') +
      '<button type="button" data-act="cmd" data-cmd="docker rm ' + (running(c) ? '-f ' : '') + n + '">rm</button>');
    return el;
  }
  function imgCard(im) {
    var el = cards['i' + im.id];
    if (!el) {
      el = document.createElement('div');
      el.className = 'dk-i';
      cards['i' + im.id] = el;
    }
    var used = W.ctrs.filter(function (c) { return c.img.id === im.id; }).length;
    el.className = 'dk-i' + (im.built ? ' is-own' : '') + (im.tags.length ? '' : ' is-dangling');
    var tot = im.layers.reduce(function (s, l) { return s + Math.max(l.size, 0.5); }, 0);
    var bar = im.layers.map(function (l) {
      return '<i class="' + (l.base ? 'is-base' : l.cached ? 'is-cached' : 'is-new') + '" style="flex-grow:' + (Math.max(l.size, 0.5) / tot * 100).toFixed(2) + '" title="' + esc(l.base ? 'layer image dasar' : l.cmd + (l.cached ? ' (CACHED)' : '')) + ' · ' + fmtSize(l.size) + '"></i>';
    }).join('');
    setHTML(el, '<div class="dk-ih"><b>' + esc(im.tags.length ? im.tags.join(', ') : '<none>') + '</b><em>' + fmtSize(im.size) + '</em></div>' +
      '<div class="dk-meta">' + im.id.slice(0, 12) + ' · ' + im.layers.length + ' layer' + (used ? ' · dipakai ' + used + ' container' : '') + (im.tags.length ? '' : ' · <span class="dk-dang">dangling</span>') + '</div>' +
      '<div class="dk-layers" aria-hidden="true">' + bar + '</div>');
    return el;
  }
  function sync(box, list, make, prefix) {
    var want = list.map(make);
    Array.prototype.slice.call(box.children).forEach(function (ch) { if (want.indexOf(ch) < 0) box.removeChild(ch); });
    want.forEach(function (el, i) { if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null); });
    Object.keys(cards).forEach(function (k) { if (k[0] === prefix && want.indexOf(cards[k]) < 0) delete cards[k]; });
  }
  function renderAll() {
    renderFlow();
    renderTabs();
    sync($('dk-ctrs'), W.ctrs.slice().reverse(), ctrCard, 'c');
    $('dk-ctrs-empty').hidden = W.ctrs.length > 0;
    sync($('dk-imgs'), W.images.slice().reverse(), imgCard, 'i');
    $('dk-imgs-empty').hidden = W.images.length > 0;
    var used = {};
    W.ctrs.forEach(function (c) { c.mounts.forEach(function (m) { used[m.src] = (used[m.src] || 0) + (running(c) ? 1 : 0); }); });
    var vk = Object.keys(W.vols);
    setHTML($('dk-vols'), vk.length ? vk.map(function (v) {
      var d = W.vols[v].data, ks = Object.keys(d);
      var info = ks.indexOf('hits.txt') >= 0 ? 'hits.txt = ' + d['hits.txt'] : ks.length ? ks.length + ' file' : 'kosong';
      return '<span class="dk-chip' + (used[v] ? ' is-on' : '') + (W.vols[v].anon ? ' is-anon' : '') + '" title="' + esc(v) + '"><b>' + esc(W.vols[v].anon ? v.slice(0, 10) + '…' : v) + '</b> ' + esc(info) + '</span>';
    }).join('') : '<span class="dk-none">belum ada</span>');
    setHTML($('dk-nets'), Object.keys(W.nets).map(function (n) {
      var cnt = W.ctrs.filter(function (c) { return c.net === n && running(c); }).length;
      return '<span class="dk-chip' + (cnt ? ' is-on' : '') + '"><b>' + esc(n) + '</b> ' + W.nets[n].driver + (cnt ? ' · ' + cnt + ' container' : '') + '</span>';
    }).join(''));
    setText($('dk-host-chip'), W.ctrs.filter(running).length + ' jalan · ' + W.images.length + ' image');
    renderBusy();
  }
  function renderBusy() {
    $('dk-quick').classList.toggle('is-busy', !!W.busy);
  }

  // ---------- wiring ----------
  app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    var act = b.dataset.act;
    if (act === 'tab') openTab(b.dataset.f);
    else if (act === 'cmd') {
      if (W.ask && b.dataset.cmd !== 'y' && b.dataset.cmd !== 'n') return;
      if (W.busy && !W.ask) return;
      term.submit(b.dataset.cmd);
    } else if (act === 'file-reset') {
      W.files[curTab] = FILES0[curTab];
      W.errs[curTab] = [];
      openTab(curTab);
      renderAll();
      toast(curTab + ' balik ke versi awal');
    } else if (act === 'reset') reset();
  });
  setInterval(function () {
    if (!W) return;
    // live "Up 12 dtk" labels without touching anything else
    W.ctrs.forEach(function (c) {
      var el = cards['c' + c.id];
      if (el && running(c)) setText(el.querySelector('em'), 'jalan · ' + durID(c.started));
    });
  }, 1000);

  function reset() {
    W && (W.run++);
    initWorld();
    term.clear();
    M.reset();
    app.classList.remove('is-confirm');
    cards = {};
    $('dk-ctrs').innerHTML = '';
    $('dk-imgs').innerHTML = '';
    openTab('Dockerfile');
    term.lines([
      '<span class="sx-dim"># Docker host bohongan di laptop kamu. Folder ~/app berisi Dockerfile, app Flask kecil, dan compose.yaml.</span>',
      '<span class="sx-dim"># Mulai dari </span><b>docker run -d -p 8080:80 nginx</b><span class="sx-dim">. Ketik </span><b>help</b><span class="sx-dim"> buat daftar perintah.</span>'
    ]);
    renderAll();
  }
  void S0;
  initWorld();
  reset();
})();
