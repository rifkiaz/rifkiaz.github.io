// Ansible simulator for /ansible/. Parses an INI inventory and a YAML
// playbook (a practical subset), then runs it over SSH against five fake
// lab servers kept in memory. Nothing leaves the page and nothing is stored.
(function () {
  'use strict';

  var K = window.SimKit;
  var app = document.getElementById('an');
  if (!app || !K) return;
  var esc = K.esc, setHTML = K.setHTML, setText = K.setText;
  function $(id) { return document.getElementById(id); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function jitter(a, b) { return a + Math.floor(Math.random() * (b - a)); }

  // ---------- lab ----------
  var LAB = {
    web1: { os: 'Ubuntu 24.04', fam: 'Debian', dist: 'Ubuntu', ver: '24.04', pm: 'apt' },
    web2: { os: 'Ubuntu 24.04', fam: 'Debian', dist: 'Ubuntu', ver: '24.04', pm: 'apt' },
    web3: { os: 'Rocky Linux 9', fam: 'RedHat', dist: 'Rocky', ver: '9.4', pm: 'dnf' },
    db1: { os: 'Ubuntu 24.04', fam: 'Debian', dist: 'Ubuntu', ver: '24.04', pm: 'apt' },
    db2: { os: 'Debian 12', fam: 'Debian', dist: 'Debian', ver: '12', pm: 'apt' }
  };
  var HOSTS = Object.keys(LAB);
  // d: in Debian/Ubuntu repos, r: in Rocky repos
  var PKG = {
    nginx: { on: 'dr', svc: 'nginx', files: { '/etc/nginx/nginx.conf': 'user www-data;\nworker_processes auto;\n', '/var/www/html/index.html': '<h1>Welcome to nginx!</h1>\n' } },
    postgresql: { on: 'd', svc: 'postgresql' },
    'postgresql-server': { on: 'r', svc: 'postgresql' },
    'redis-server': { on: 'd', svc: 'redis-server' },
    redis: { on: 'r', svc: 'redis' },
    chrony: { on: 'dr', svc: 'chrony' },
    fail2ban: { on: 'dr', svc: 'fail2ban' },
    ufw: { on: 'd', svc: 'ufw' },
    firewalld: { on: 'r', svc: 'firewalld' },
    git: { on: 'dr' }, curl: { on: 'dr' }, htop: { on: 'dr' }, vim: { on: 'dr' },
    tree: { on: 'dr' }, unzip: { on: 'dr' }, jq: { on: 'dr' }, python3: { on: 'dr' }, rsync: { on: 'dr' }
  };

  var FILES0 = {
    'inventory.ini': [
      '[web]',
      'web1',
      'web2',
      '',
      '[db]',
      'db1',
      '',
      '[all:vars]',
      'ansible_user=deploy',
      ''
    ].join('\n'),
    'site.yml': [
      '- name: Siapkan web server',
      '  hosts: web',
      '  become: true',
      '  vars:',
      '    pesan: "Halo dari Ansible"',
      '',
      '  tasks:',
      '    - name: Install nginx',
      '      apt:',
      '        name: nginx',
      '        state: present',
      '',
      '    - name: Pasang halaman index',
      '      template:',
      '        src: index.html.j2',
      '        dest: /var/www/html/index.html',
      '      notify: restart nginx',
      '',
      '    - name: Catat waktu deploy',
      '      shell: date > /etc/deploy-time',
      '',
      '    - name: Pastikan nginx jalan',
      '      service:',
      '        name: nginx',
      '        state: started',
      '        enabled: true',
      '',
      '  handlers:',
      '    - name: restart nginx',
      '      service:',
      '        name: nginx',
      '        state: restarted',
      '',
      '- name: Siapkan database',
      '  hosts: db',
      '  become: true',
      '  tasks:',
      '    - name: Install postgresql',
      '      apt:',
      '        name: postgresql',
      '        state: present',
      '',
      '    - name: Pastikan postgresql jalan',
      '      service:',
      '        name: postgresql',
      '        state: started',
      ''
    ].join('\n'),
    'index.html.j2': [
      '<!doctype html>',
      '<h1>{{ pesan }}</h1>',
      '<p>Disajikan oleh {{ ansible_hostname }} ({{ ansible_distribution }})</p>',
      ''
    ].join('\n')
  };
  var TABS = [
    { f: 'inventory.ini', hl: K.hlINI },
    { f: 'site.yml', hl: K.hlYAML },
    { f: 'index.html.j2', label: 'templates/index.html.j2', hl: K.hlJinja }
  ];

  var MISSIONS = [
    { id: 'ping', text: 'Cek koneksi ke semua host: <b>ansible all -m ping</b>.' },
    { id: 'run', text: 'Jalankan playbook <b>site.yml</b> dan lihat nginx terpasang.' },
    { id: 'idem', text: 'Jalankan lagi sampai <i>changed=0</i> di semua host. Ada satu task yang bandel.' },
    { id: 'check', text: 'Ganti <b>pesan</b>, intip dulu pakai <i>--check --diff</i>, lalu jalankan beneran.' },
    { id: 'limit', text: 'Tambah <b>web3</b> ke grup web, lalu jalankan khusus web3 pakai <i>--limit</i>.' },
    { id: 'rocky', text: 'web3 pakai Rocky Linux. Benerin playbook-nya sampai nginx jalan di sana.' }
  ];

  // ---------- YAML (subset) ----------
  function YErr(line, msg) { return { line: line, msg: msg }; }
  function setMeta(o, line, keys) {
    Object.defineProperty(o, '__l', { value: { line: line, keys: keys || {} }, enumerable: false });
    return o;
  }
  function lineOf(o, key) {
    if (!o || !o.__l) return 0;
    return key && o.__l.keys[key] ? o.__l.keys[key] : o.__l.line;
  }
  function stripComment(s) {
    var q = null;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (q) { if (c === q) q = null; continue; }
      if ((c === '"' || c === "'") && (i === 0 || /[\s:\[{,-]/.test(s[i - 1]))) { q = c; continue; }
      if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i);
    }
    return s;
  }
  function parseYAML(src) {
    var raw = src.split('\n'), L = [];
    raw.forEach(function (r, i) {
      var lead = /^[ \t]*/.exec(r)[0];
      if (lead.indexOf('\t') >= 0 && r.trim()) throw YErr(i + 1, 'YAML ga boleh pakai tab buat indentasi. Pakai spasi.');
      var t = stripComment(r).replace(/\s+$/, '');
      if (!t.trim() || t.trim() === '---') return;
      L.push({ n: i + 1, ind: lead.length, text: t.slice(lead.length) });
    });
    var pos = 0;
    function isDash(t) { return t === '-' || t.slice(0, 2) === '- '; }
    var KEY = /^("(?:[^"\\]|\\.)*"|'[^']*'|[^\s"'#:\[\]{}][^#]*?)\s*:(?:\s+(.*)|$)/;
    function node(ind) {
      return isDash(L[pos].text) ? seq(ind) : map(ind);
    }
    function seq(ind) {
      var arr = setMeta([], L[pos].n);
      while (pos < L.length && L[pos].ind === ind && isDash(L[pos].text)) {
        var ln = L[pos];
        var rest = ln.text === '-' ? '' : ln.text.slice(1).replace(/^\s+/, '');
        if (!rest) {
          pos++;
          arr.push(pos < L.length && L[pos].ind > ind ? node(L[pos].ind) : null);
        } else if (KEY.test(rest) && !/^["'[{]/.test(rest) || isDash(rest)) {
          ln.ind = ind + (ln.text.length - rest.length);
          ln.text = rest;
          arr.push(node(ln.ind));
        } else {
          arr.push(scalar(rest, ln.n));
          pos++;
        }
      }
      if (pos < L.length && L[pos].ind > ind) throw YErr(L[pos].n, 'Indentasi baris ini ga cocok dengan item list di atasnya.');
      return arr;
    }
    function map(ind) {
      var obj = {}, keys = {}, first = L[pos].n;
      while (pos < L.length && L[pos].ind === ind) {
        var ln = L[pos];
        if (isDash(ln.text)) throw YErr(ln.n, 'Ada item list (-) di tempat yang harusnya kunci: nilai. Cek indentasinya.');
        var m = KEY.exec(ln.text);
        if (!m) {
          if (/=/.test(ln.text)) throw YErr(ln.n, 'Baris ini harusnya berbentuk "kunci: nilai". Format kunci=nilai cuma boleh sebagai nilai, misal "apt: name=nginx".');
          throw YErr(ln.n, 'Baris ini harusnya berbentuk "kunci: nilai" (perhatikan spasi setelah titik dua).');
        }
        var key = m[1].replace(/^(["'])(.*)\1$/, '$2').trim(), val = m[2];
        keys[key] = ln.n;
        pos++;
        if (val === undefined || val === '') {
          if (pos < L.length && L[pos].ind > ind) obj[key] = node(L[pos].ind);
          else if (pos < L.length && L[pos].ind === ind && isDash(L[pos].text)) obj[key] = seq(ind);
          else obj[key] = null;
        } else if (/^[|>][+-]?$/.test(val)) {
          var body = [], j = ln.n, bi = null;
          while (j < raw.length) {
            var r = raw[j];
            var li = /^ */.exec(r)[0].length;
            if (r.trim() && li <= ind) break;
            if (r.trim() && bi === null) bi = li;
            body.push(r);
            j++;
          }
          while (body.length && !body[body.length - 1].trim()) body.pop();
          var text = body.map(function (r) { return r.slice(bi || 0); });
          obj[key] = val[0] === '|' ? text.join('\n') + (val[1] === '-' ? '' : '\n') : text.join(' ').replace(/\s+/g, ' ').trim() + '\n';
          while (pos < L.length && L[pos].n <= j) pos++;
        } else obj[key] = scalar(val, ln.n);
      }
      if (pos < L.length && L[pos].ind > ind) throw YErr(L[pos].n, 'Indentasi baris ini kelebihan. Cek jumlah spasinya.');
      return setMeta(obj, first, keys);
    }
    function splitTop(s) {
      var out = [], depth = 0, q = null, cur = '';
      for (var i = 0; i < s.length; i++) {
        var c = s[i];
        if (q) { cur += c; if (c === q) q = null; continue; }
        if (c === '"' || c === "'") q = c;
        else if (c === '[' || c === '{') depth++;
        else if (c === ']' || c === '}') depth--;
        else if (c === ',' && !depth) { out.push(cur); cur = ''; continue; }
        cur += c;
      }
      if (cur.trim()) out.push(cur);
      return out;
    }
    function scalar(s, n) {
      s = s.trim();
      if (s.slice(0, 2) === '{{') throw YErr(n, 'Nilai yang diawali {{ harus diberi tanda kutip, misal "{{ pesan }}". Tanpa kutip, YAML membacanya sebagai map.');
      if (s[0] === '[') {
        if (s[s.length - 1] !== ']') throw YErr(n, 'List [ belum ditutup dengan ].');
        return splitTop(s.slice(1, -1)).map(function (x) { return scalar(x, n); });
      }
      if (s[0] === '{') {
        if (s[s.length - 1] !== '}') throw YErr(n, 'Map { belum ditutup dengan }.');
        var o = {};
        splitTop(s.slice(1, -1)).forEach(function (kv) {
          var i = kv.indexOf(':');
          if (i < 0) throw YErr(n, 'Isi map harus berbentuk kunci: nilai.');
          o[kv.slice(0, i).trim().replace(/^(["'])(.*)\1$/, '$2')] = scalar(kv.slice(i + 1), n);
        });
        return setMeta(o, n);
      }
      if (s[0] === '"') {
        if (s.length < 2 || s[s.length - 1] !== '"') throw YErr(n, 'Tanda kutip " belum ditutup.');
        return s.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
      if (s[0] === "'") {
        if (s.length < 2 || s[s.length - 1] !== "'") throw YErr(n, "Tanda kutip ' belum ditutup.");
        return s.slice(1, -1).replace(/''/g, "'");
      }
      if (/^(true|yes|on)$/i.test(s)) return true;
      if (/^(false|no|off)$/i.test(s)) return false;
      if (/^(null|~)$/.test(s)) return null;
      if (/^-?\d+$/.test(s)) return parseInt(s, 10);
      if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
      return s;
    }
    if (!L.length) return null;
    var out = node(L[0].ind);
    if (pos < L.length) throw YErr(L[pos].n, 'Indentasi baris ini ga cocok dengan struktur di atasnya.');
    return out;
  }

  // ---------- inventory ----------
  function parseInv(src) {
    var inv = { hosts: {}, groups: { all: { hosts: [], children: [], vars: {} }, ungrouped: { hosts: [], children: [], vars: {} } }, order: [], errs: [] };
    var cur = 'ungrouped', mode = 'hosts';
    function grp(g) { return inv.groups[g] = inv.groups[g] || { hosts: [], children: [], vars: {} }; }
    function kv(parts, into, n) {
      parts.forEach(function (p) {
        var m = /^([\w.-]+)=(.*)$/.exec(p);
        if (!m) { inv.errs.push({ line: n, msg: '"' + p + '" bukan format kunci=nilai.' }); return; }
        into[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
      });
    }
    src.split('\n').forEach(function (r, i) {
      var n = i + 1, t = r.replace(/\s[#;].*$/, '').trim();
      if (!t || t[0] === '#' || t[0] === ';') return;
      var g = /^\[([^\]]*)\]$/.exec(t);
      if (g) {
        var p = g[1].split(':');
        if (!/^[\w-]+$/.test(p[0]) || (p[1] && p[1] !== 'vars' && p[1] !== 'children')) {
          inv.errs.push({ line: n, msg: 'Nama grup "[' + g[1] + ']" ga valid. Contoh yang benar: [web], [web:vars], [prod:children].' });
          cur = null; return;
        }
        cur = p[0]; mode = p[1] || 'hosts';
        grp(cur);
        return;
      }
      if (/^\[/.test(t)) { inv.errs.push({ line: n, msg: 'Header grup belum ditutup dengan ].' }); cur = null; return; }
      if (!cur) return;
      var parts = t.split(/\s+/);
      if (mode === 'vars') { kv(parts, inv.groups[cur].vars, n); return; }
      if (mode === 'children') { inv.groups[cur].children.push(parts[0]); grp(parts[0]); return; }
      var names = [parts[0]];
      var rg = /^(.*)\[(\d+):(\d+)\](.*)$/.exec(parts[0]);
      if (rg) {
        names = [];
        for (var x = +rg[2]; x <= +rg[3] && names.length < 20; x++) names.push(rg[1] + x + rg[4]);
      }
      names.forEach(function (h) {
        if (!inv.hosts[h]) { inv.hosts[h] = { vars: {}, line: n }; inv.order.push(h); }
        kv(parts.slice(1), inv.hosts[h].vars, n);
        if (inv.groups[cur].hosts.indexOf(h) < 0) inv.groups[cur].hosts.push(h);
      });
    });
    // a host listed in any named group is no longer "ungrouped"
    inv.groups.ungrouped.hosts = inv.groups.ungrouped.hosts.filter(function (h) {
      return !Object.keys(inv.groups).some(function (g) { return g !== 'ungrouped' && g !== 'all' && inv.groups[g].hosts.indexOf(h) >= 0; });
    });
    inv.groups.all.hosts = inv.order.slice();
    return inv;
  }
  function groupHosts(inv, g, seen) {
    var G = inv.groups[g];
    if (!G) return [];
    seen = seen || {};
    if (seen[g]) return [];
    seen[g] = true;
    var out = G.hosts.slice();
    G.children.forEach(function (c) { groupHosts(inv, c, seen).forEach(function (h) { if (out.indexOf(h) < 0) out.push(h); }); });
    return out;
  }
  function groupsOf(inv, h) {
    return Object.keys(inv.groups).filter(function (g) { return g !== 'all' && groupHosts(inv, g).indexOf(h) >= 0; });
  }
  function matchPattern(inv, pat) {
    var out = [];
    String(pat || '').split(/[:,]/).forEach(function (part, i) {
      part = part.trim();
      if (!part) return;
      var op = part[0] === '!' ? '!' : part[0] === '&' ? '&' : '';
      var name = op ? part.slice(1) : part;
      var set;
      if (name === 'all' || name === '*') set = inv.order.slice();
      else if (inv.groups[name]) set = groupHosts(inv, name);
      else if (/[*?]/.test(name)) {
        var re = new RegExp('^' + name.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
        set = inv.order.filter(function (h) { return re.test(h); });
      } else set = inv.hosts[name] ? [name] : [];
      if (op === '!') out = out.filter(function (h) { return set.indexOf(h) < 0; });
      else if (op === '&') out = out.filter(function (h) { return set.indexOf(h) >= 0; });
      else set.forEach(function (h) { if (out.indexOf(h) < 0) out.push(h); });
      void i;
    });
    return inv.order.filter(function (h) { return out.indexOf(h) >= 0; });
  }
  function invVars(inv, h) {
    var v = {};
    function add(o) { Object.keys(o).forEach(function (k) { v[k] = o[k]; }); }
    add(inv.groups.all.vars);
    groupsOf(inv, h).forEach(function (g) { add(inv.groups[g].vars); });
    add(inv.hosts[h].vars);
    return v;
  }

  // ---------- jinja (tiny) ----------
  function Undef(name) { this.name = name; }
  function lookup(vars, name) {
    var parts = name.split('.'), v = vars;
    for (var i = 0; i < parts.length; i++) {
      if (v === null || v === undefined || typeof v !== 'object' || !(parts[i] in v)) throw new Undef(name);
      v = v[parts[i]];
    }
    return v;
  }
  function tokens(s) {
    var re = /\s*(==|!=|>=|<=|>|<|\(|\)|\[|\]|,|\||"[^"]*"|'[^']*'|-?\d+(?:\.\d+)?|[A-Za-z_][\w.]*)/g, out = [], m, last = 0;
    while ((m = re.exec(s))) {
      if (m.index !== last && s.slice(last, m.index).trim()) throw new Error('ga paham bagian "' + s.slice(last, m.index).trim() + '"');
      out.push(m[1]);
      last = re.lastIndex;
    }
    if (s.slice(last).trim()) throw new Error('ga paham bagian "' + s.slice(last).trim() + '"');
    return out;
  }
  function evalExpr(src, vars) {
    var t = tokens(src), i = 0;
    function peek() { return t[i]; }
    function eat(x) { if (t[i] === x) { i++; return true; } return false; }
    function or() { var v = and(); while (eat('or')) { var r = and(); v = truthy(v) || truthy(r); } return v; }
    function and() { var v = not(); while (eat('and')) { var r = not(); v = truthy(v) && truthy(r); } return v; }
    function not() { if (eat('not')) return !truthy(not()); return cmp(); }
    function cmp() {
      var save = i, v;
      try { v = filt(); }
      catch (e) {
        if (!(e instanceof Undef)) throw e;
        // "x is defined" must not blow up on an undefined x
        if (t[i] === 'is') { v = e; } else { i = save; throw e; }
      }
      if (eat('is')) {
        var neg = eat('not'), test = t[i++];
        var r;
        if (test === 'defined') r = !(v instanceof Undef);
        else if (test === 'undefined') r = v instanceof Undef;
        else if (v instanceof Undef) throw v;
        else if (test === 'none') r = v === null;
        else throw new Error('test "' + test + '" belum didukung');
        return neg ? !r : r;
      }
      if (v instanceof Undef) throw v;
      var op = peek();
      if (op === 'not' && t[i + 1] === 'in') { i += 2; return !inop(v, filt()); }
      if (eat('in')) return inop(v, filt());
      if (['==', '!=', '>', '<', '>=', '<='].indexOf(op) >= 0) {
        i++;
        var r2 = filt();
        if (op === '==') return v == r2; // eslint-disable-line eqeqeq
        if (op === '!=') return v != r2; // eslint-disable-line eqeqeq
        if (op === '>') return v > r2;
        if (op === '<') return v < r2;
        if (op === '>=') return v >= r2;
        return v <= r2;
      }
      return v;
    }
    function inop(a, b) { return Array.isArray(b) ? b.indexOf(a) >= 0 : String(b).indexOf(a) >= 0; }
    function filt() {
      var v;
      try { v = prim(); }
      catch (e) {
        if (!(e instanceof Undef) || t[i] !== '|' || t[i + 1] !== 'default') throw e;
        v = e;
      }
      while (eat('|')) {
        var f = t[i++], arg;
        if (eat('(')) { arg = t[i] === ')' ? undefined : or(); eat(')'); }
        if (f === 'default' || f === 'd') { if (v instanceof Undef) v = arg === undefined ? '' : arg; }
        else if (v instanceof Undef) throw v;
        else if (f === 'upper') v = String(v).toUpperCase();
        else if (f === 'lower') v = String(v).toLowerCase();
        else if (f === 'length') v = v.length;
        else if (f === 'join') v = v.join(arg === undefined ? '' : arg);
        else if (f === 'int') v = parseInt(v, 10) || 0;
        else if (f === 'string') v = String(v);
        else if (f === 'bool') v = truthy(v);
        else throw new Error('filter "' + f + '" belum didukung di simulasi ini');
      }
      return v;
    }
    function prim() {
      var x = t[i++];
      if (x === undefined) throw new Error('ekspresinya kepotong');
      if (x === '(') { var v = or(); eat(')'); return v; }
      if (x === '[') {
        var l = [];
        while (!eat(']')) { l.push(or()); eat(','); if (i > t.length) break; }
        return l;
      }
      if (/^["']/.test(x)) return x.slice(1, -1);
      if (/^-?\d/.test(x)) return parseFloat(x);
      if (/^(true|True)$/.test(x)) return true;
      if (/^(false|False)$/.test(x)) return false;
      if (/^(none|None)$/.test(x)) return null;
      var lv = lookup(vars, x);
      // vars that hold templates are rendered when used, like Ansible does
      if (typeof lv === 'string' && lv.indexOf('{{') >= 0 && (vars.__depth || 0) < 8) lv = render(lv, Object.assign({}, vars, { __depth: (vars.__depth || 0) + 1 }));
      return lv;
    }
    var out = or();
    if (i < t.length) throw new Error('ada sisa "' + t.slice(i).join(' ') + '"');
    return out;
  }
  function truthy(v) {
    if (typeof v === 'string') return !!v && !/^(false|no|0)$/i.test(v);
    if (Array.isArray(v)) return v.length > 0;
    return !!v;
  }
  function render(s, vars) {
    if (typeof s !== 'string') {
      if (Array.isArray(s)) return s.map(function (x) { return render(x, vars); });
      if (s && typeof s === 'object') { var o = {}; Object.keys(s).forEach(function (k) { o[k] = render(s[k], vars); }); return o; }
      return s;
    }
    var whole = /^\s*\{\{\s*([^}]*?)\s*\}\}\s*$/.exec(s);
    if (whole) return evalExpr(whole[1], vars);
    return s.replace(/\{\{\s*([^}]*?)\s*\}\}/g, function (m, e) {
      var v = evalExpr(e, vars);
      return v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    });
  }

  // ---------- playbook model ----------
  var TASK_KW = ['name', 'become', 'become_user', 'when', 'notify', 'loop', 'with_items', 'register', 'ignore_errors', 'changed_when', 'failed_when', 'tags', 'vars', 'check_mode', 'listen', 'no_log', 'delegate_to', 'run_once'];
  var PLAY_KW = ['name', 'hosts', 'become', 'become_user', 'gather_facts', 'vars', 'tasks', 'handlers', 'remote_user', 'tags', 'serial', 'any_errors_fatal', 'pre_tasks', 'post_tasks', 'roles', 'connection'];
  var MODS = {
    apt: { args: ['name', 'pkg', 'state', 'update_cache', 'cache_valid_time', 'upgrade', 'autoremove'] },
    dnf: { args: ['name', 'pkg', 'state', 'update_cache'] },
    yum: { args: ['name', 'pkg', 'state', 'update_cache'] },
    package: { args: ['name', 'state', 'use'] },
    service: { args: ['name', 'state', 'enabled', 'daemon_reload'], req: ['name'] },
    systemd: { args: ['name', 'state', 'enabled', 'daemon_reload'] },
    copy: { args: ['dest', 'content', 'src', 'mode', 'owner', 'group', 'backup', 'force'], req: ['dest'] },
    template: { args: ['src', 'dest', 'mode', 'owner', 'group', 'backup', 'force'], req: ['src', 'dest'] },
    file: { args: ['path', 'dest', 'name', 'state', 'mode', 'owner', 'group', 'recurse'] },
    lineinfile: { args: ['path', 'dest', 'line', 'regexp', 'state', 'create', 'insertafter', 'insertbefore', 'backup'] },
    user: { args: ['name', 'groups', 'shell', 'state', 'append', 'create_home', 'home', 'comment', 'system', 'remove'], req: ['name'] },
    group: { args: ['name', 'state', 'gid', 'system'], req: ['name'] },
    command: { args: ['_raw', 'cmd', 'creates', 'removes', 'chdir', 'argv'], free: true },
    shell: { args: ['_raw', 'cmd', 'creates', 'removes', 'chdir', 'executable'], free: true },
    ping: { args: ['data'] },
    debug: { args: ['msg', 'var', 'verbosity'] },
    setup: { args: ['filter', 'gather_subset'] },
    wait_for: { args: ['port', 'host', 'timeout', 'delay', 'state', 'path'] },
    reboot: { args: ['reboot_timeout', 'msg'] }
  };
  function modName(k) { return k.replace(/^ansible\.(builtin|posix)\./, ''); }
  function PErr(line, msg, file) { return { line: line, msg: msg, file: file || 'site.yml' }; }
  function freeArgs(s, mod) {
    var out = {}, raw = [];
    (String(s).match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []).forEach(function (w) {
      var m = /^([\w]+)=(.*)$/.exec(w);
      if (m && (!MODS[mod].free || ['creates', 'removes', 'chdir', 'executable'].indexOf(m[1]) >= 0)) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
      else raw.push(w);
    });
    if (MODS[mod].free) { if (raw.length) out._raw = raw.join(' '); }
    else if (raw.length) out._bad = raw.join(' ');
    return out;
  }
  function compileTask(t, file, isHandler) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) throw PErr(lineOf(t), (isHandler ? 'Handler' : 'Task') + ' harus berupa map (name, modul, dan argumennya).', file);
    var mods = Object.keys(t).filter(function (k) { return TASK_KW.indexOf(k) < 0 && k !== 'args'; });
    if (!mods.length) throw PErr(lineOf(t), 'ERROR! no module/action detected in task.', file);
    if (mods.length > 1) throw PErr(lineOf(t, mods[1]), 'ERROR! conflicting action statements: ' + mods.join(', ') + '. Satu task cuma boleh satu modul.', file);
    var mk = mods[0], mod = modName(mk);
    if (!MODS[mod]) {
      var best = Object.keys(MODS).filter(function (m) { return m[0] === mod[0] && Math.abs(m.length - mod.length) < 3; })[0];
      throw PErr(lineOf(t, mk), "ERROR! couldn't resolve module/action '" + mk + "'. This often indicates a misspelling, missing collection, or incorrect module path." + (best ? ' Maksudnya ' + best + '?' : ''), file);
    }
    var a = t[mk];
    var args;
    if (a === null || a === undefined) args = {};
    else if (typeof a === 'string') args = freeArgs(a, mod);
    else if (typeof a === 'object' && !Array.isArray(a)) { args = {}; Object.keys(a).forEach(function (k) { args[k] = a[k]; }); }
    else throw PErr(lineOf(t, mk), 'Argumen modul ' + mk + ' harus berupa map atau teks kunci=nilai.', file);
    if (t.args && typeof t.args === 'object') Object.keys(t.args).forEach(function (k) { args[k] = t.args[k]; });
    var notify = t.notify === undefined || t.notify === null ? [] : Array.isArray(t.notify) ? t.notify : [t.notify];
    return {
      name: t.name ? String(t.name) : mk + (args._raw ? ' ' + args._raw : ''), mod: mod, args: args, line: lineOf(t),
      when: t.when, loop: t.loop !== undefined ? t.loop : t.with_items, register: t.register, notify: notify,
      become: t.become, ignore: truthy(t.ignore_errors), changedWhen: t.changed_when, failedWhen: t.failed_when, vars: t.vars || {}
    };
  }
  function compile(src) {
    var doc = parseYAML(src);
    if (!Array.isArray(doc)) throw PErr(doc ? lineOf(doc) : 1, 'ERROR! A playbook must be a list of plays. Awali tiap play dengan "- name: ...".');
    return doc.map(function (p) {
      if (!p || typeof p !== 'object' || Array.isArray(p)) throw PErr(lineOf(p) || 1, 'ERROR! Each play must be a dictionary (map).');
      Object.keys(p).forEach(function (k) {
        if (PLAY_KW.indexOf(k) < 0) {
          var hint = MODS[modName(k)] ? ' Sepertinya ini task yang lupa ditaruh di bawah "tasks:".' : '';
          throw PErr(lineOf(p, k), "ERROR! '" + k + "' is not a valid attribute for a Play." + hint);
        }
      });
      if (p.roles) throw PErr(lineOf(p, 'roles'), 'Roles belum didukung di simulasi ini. Tulis task-nya langsung di "tasks:".');
      if (p.hosts === undefined || p.hosts === null || p.hosts === '') throw PErr(lineOf(p), "ERROR! the field 'hosts' is required but was not set");
      ['tasks', 'handlers', 'pre_tasks', 'post_tasks'].forEach(function (k) {
        if (p[k] !== undefined && p[k] !== null && !Array.isArray(p[k])) throw PErr(lineOf(p, k), "ERROR! A malformed block was encountered while loading " + k + ". Isinya harus list, tiap item diawali \"- \".");
      });
      var tasks = [].concat(p.pre_tasks || [], p.tasks || [], p.post_tasks || []).map(function (t) { return compileTask(t); });
      var handlers = (p.handlers || []).map(function (t) { return compileTask(t, 'site.yml', true); });
      tasks.forEach(function (t) {
        t.notify.forEach(function (n) {
          if (!handlers.some(function (h) { return h.name === n; })) throw PErr(t.line, "ERROR! The requested handler '" + n + "' was not found in either the main handlers list nor in the listening handlers list");
        });
      });
      return {
        name: p.name ? String(p.name) : String(p.hosts), hosts: Array.isArray(p.hosts) ? p.hosts.join(':') : String(p.hosts),
        become: truthy(p.become), facts: p.gather_facts === undefined ? true : truthy(p.gather_facts),
        vars: p.vars && typeof p.vars === 'object' ? p.vars : {}, tasks: tasks, handlers: handlers, line: lineOf(p)
      };
    });
  }

  // ---------- servers ----------
  var S, W;
  function freshHost(h) {
    var L0 = LAB[h], deb = L0.fam === 'Debian';
    var svc = {};
    svc[deb ? 'ssh' : 'sshd'] = { running: true, enabled: true };
    svc.cron = { running: true, enabled: true };
    return {
      name: h, up: true, pkgs: { python3: true, 'openssh-server': true }, svcs: svc,
      files: { '/etc/hostname': { type: 'file', content: h + '\n', mode: '0644' }, '/etc/motd': { type: 'file', content: '', mode: '0644' } },
      dirs: { '/etc': 1, '/var': 1, '/tmp': 1, '/opt': 1, '/home': 1 },
      users: { root: { groups: [] }, deploy: { groups: ['sudo'] } },
      status: 'idle', task: '', last: null, touched: {}, fresh: {}
    };
  }
  function initWorld() {
    S = {};
    HOSTS.forEach(function (h) { S[h] = freshHost(h); });
    W = { run: 0, busy: false, checkedDiff: false, files: {}, errs: {} };
    Object.keys(FILES0).forEach(function (f) { W.files[f] = FILES0[f]; });
  }
  function facts(h, inv) {
    var L0 = LAB[h];
    return {
      ansible_hostname: h, ansible_fqdn: h + '.lab.local', ansible_os_family: L0.fam, ansible_distribution: L0.dist,
      ansible_distribution_version: L0.ver, ansible_distribution_major_version: L0.ver.split('.')[0],
      ansible_pkg_mgr: L0.pm, ansible_service_mgr: 'systemd', ansible_architecture: 'x86_64',
      ansible_memtotal_mb: h.indexOf('db') === 0 ? 3912 : 1963, ansible_processor_vcpus: 2
    };
    void inv;
  }
  function needRoot(path) { return /^\/(etc|var|usr|opt|root|srv)(\/|$)/.test(path); }
  function dirOf(p) { return p.replace(/\/[^/]*$/, '') || '/'; }
  function lineDiff(path, before, after) {
    var b = (before || '').replace(/\n$/, '').split('\n'), a = (after || '').replace(/\n$/, '').split('\n');
    if (before === null) b = [];
    var out = ['<span class="sx-dim">--- before: ' + esc(path) + '</span>', '<span class="sx-dim">+++ after: ' + esc(path) + '</span>', '<span class="sx-info">@@ -1,' + b.length + ' +1,' + a.length + ' @@</span>'];
    var i = 0, j = 0;
    while (i < b.length || j < a.length) {
      if (i < b.length && j < a.length && b[i] === a[j]) { out.push(' ' + esc(b[i])); i++; j++; }
      else if (i < b.length && a.indexOf(b[i], j) < 0) { out.push('<span class="sx-del">-' + esc(b[i]) + '</span>'); i++; }
      else if (j < a.length) { out.push('<span class="sx-add">+' + esc(a[j]) + '</span>'); j++; }
      else { out.push('<span class="sx-del">-' + esc(b[i]) + '</span>'); i++; }
    }
    return out;
  }
  function pkgList(v) {
    if (v === undefined || v === null) return [];
    if (Array.isArray(v)) return v.map(String);
    return String(v).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  }

  // run one module on one host. ctx: { check, root, vars, diff }
  function execMod(H, mod, A, ctx) {
    var L0 = LAB[H.name], deb = L0.fam === 'Debian';
    var spec = MODS[mod];
    var res = { changed: false };
    function fail(msg, extra) { res.failed = true; res.msg = msg; if (extra) Object.keys(extra).forEach(function (k) { res[k] = extra[k]; }); return res; }
    if (A._bad) return fail("this module requires key=value arguments (['" + A._bad + "'])");
    var unknown = Object.keys(A).filter(function (k) { return k[0] !== '_' && spec.args.indexOf(k) < 0; });
    if (unknown.length) return fail('Unsupported parameters for (' + mod + ') module: ' + unknown.join(', ') + '. Supported parameters include: ' + spec.args.filter(function (k) { return k[0] !== '_'; }).join(', ') + '.');
    var miss = (spec.req || []).filter(function (k) { return A[k] === undefined || A[k] === null || A[k] === ''; });
    if (miss.length) return fail('missing required arguments: ' + miss.join(', '));
    var noRoot = 'Missing sudo password atau permission denied. Task ini butuh root, tambahkan "become: true".';

    if (mod === 'ping') { res.ping = A.data || 'pong'; return res; }
    if (mod === 'setup') { res.ansible_facts = facts(H.name); return res; }
    if (mod === 'debug') {
      if (A['var'] !== undefined) {
        var vv;
        try { vv = evalExpr(String(A['var']), ctx.vars); } catch (e) { vv = 'VARIABLE IS NOT DEFINED!'; }
        res[String(A['var'])] = vv;
      } else res.msg = A.msg === undefined ? 'Hello world!' : A.msg;
      res.debug = true;
      return res;
    }
    if (mod === 'wait_for') { res.elapsed = 0; return res; }
    if (mod === 'reboot') {
      if (!ctx.root) return fail(noRoot);
      res.changed = true; res.elapsed = 32; res.rebooted = true;
      return res;
    }
    if (mod === 'apt' || mod === 'dnf' || mod === 'yum' || mod === 'package') {
      var names = pkgList(A.name !== undefined ? A.name : A.pkg);
      if (mod === 'apt' && !deb) return fail('Failed to find required executable "apt-get" in paths: /usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin. Host ini ' + L0.os + ' (keluarga RedHat), jadi pakai dnf atau modul package.');
      if ((mod === 'dnf' || mod === 'yum') && deb) return fail('Could not find a matching action for the "' + mod + '" package manager on this host. Host ini ' + L0.os + ', pakai apt atau modul package.');
      if (!names.length) {
        if (A.update_cache) { res.changed = mod === 'apt'; res.cache_updated = true; return res; }
        return fail('one of the following is required: name, pkg' + (mod === 'apt' ? ', upgrade, update_cache' : ''));
      }
      var state = A.state || 'present';
      if (['present', 'installed', 'latest', 'absent', 'removed'].indexOf(state) < 0) return fail('value of state must be one of: absent, installed, latest, present, removed, got: ' + state);
      var add = [], del = [];
      for (var i = 0; i < names.length; i++) {
        var n = names[i], p = PKG[n];
        if (state === 'absent' || state === 'removed') { if (H.pkgs[n]) del.push(n); continue; }
        if (!p || p.on.indexOf(deb ? 'd' : 'r') < 0) {
          var alt = n === 'postgresql' && !deb ? ' Di Rocky namanya postgresql-server.' : n === 'redis-server' && !deb ? ' Di Rocky namanya redis.' : n === 'redis' && deb ? ' Di Ubuntu/Debian namanya redis-server.' : n === 'postgresql-server' && deb ? ' Di Ubuntu/Debian namanya postgresql.' : '';
          return fail('No package matching \'' + n + '\' is available.' + alt);
        }
        if (!H.pkgs[n]) add.push(n);
      }
      if (!add.length && !del.length && state !== 'latest') return res;
      if (!ctx.root && (add.length || del.length)) return fail(noRoot);
      res.changed = add.length > 0 || del.length > 0;
      if (ctx.diff && res.changed) {
        res.diffLines = [];
        if (add.length) res.diffLines.push('The following NEW packages will be installed:', '  ' + add.join(' '));
        if (del.length) res.diffLines.push('The following packages will be REMOVED:', '  ' + del.join(' '));
      }
      if (!ctx.check) {
        add.forEach(function (n2) {
          H.pkgs[n2] = true;
          var p2 = PKG[n2];
          if (p2.svc) H.svcs[p2.svc] = { running: deb, enabled: deb }; // Debian starts services on install
          Object.keys(p2.files || {}).forEach(function (f) {
            H.files[f] = { type: 'file', content: p2.files[f], mode: '0644' };
            H.dirs[dirOf(f)] = 1;
          });
          if (n2 === 'nginx') { H.dirs['/var/www/html'] = 1; H.dirs['/var/www'] = 1; }
        });
        del.forEach(function (n2) {
          delete H.pkgs[n2];
          var p2 = PKG[n2];
          if (p2 && p2.svc) delete H.svcs[p2.svc];
        });
      }
      return res;
    }
    if (mod === 'service' || mod === 'systemd') {
      var sn = String(A.name || ''), sv = H.svcs[sn];
      if (!sn) return fail('missing required arguments: name');
      if (!sv) return fail('Could not find the requested service ' + sn + ': host' + (PKG[sn] ? '. Paketnya belum terpasang.' : ''));
      var want = A.state, nr = sv.running, ne = sv.enabled;
      if (want && ['started', 'stopped', 'restarted', 'reloaded'].indexOf(want) < 0) return fail('value of state must be one of: reloaded, restarted, started, stopped, got: ' + want);
      if (want === 'started') nr = true;
      if (want === 'stopped') nr = false;
      if (want === 'restarted' || want === 'reloaded') { nr = true; res.changed = true; }
      if (A.enabled !== undefined) ne = truthy(A.enabled);
      if (nr !== sv.running || ne !== sv.enabled) res.changed = true;
      if (res.changed && !ctx.root) return fail('Unable to ' + (want === 'stopped' ? 'stop' : 'start') + ' service ' + sn + ': Interactive authentication required. Tambahkan "become: true".');
      res.name = sn; res.state = nr ? 'started' : 'stopped'; res.enabled = ne;
      if (!ctx.check) { sv.running = nr; sv.enabled = ne; if (want === 'restarted') H.restarts = (H.restarts || 0) + 1; }
      return res;
    }
    if (mod === 'copy' || mod === 'template') {
      var dest = String(A.dest), content;
      if (mod === 'template') {
        var src = String(A.src).replace(/^templates\//, '');
        if (W.files[src] === undefined) return fail('Could not find or access \'' + A.src + '\'. Template yang ada: templates/index.html.j2.');
        try { content = render(W.files[src], ctx.vars); }
        catch (e) { return fail(e instanceof Undef ? "AnsibleUndefinedVariable: '" + e.name + "' is undefined" : 'template error while templating string: ' + e.message); }
        if (typeof content !== 'string') content = String(content);
      } else {
        if (A.src !== undefined && A.content === undefined) return fail('Could not find or access \'' + A.src + '\'. Di simulasi ini pakai content: buat isi filenya.');
        content = A.content === undefined || A.content === null ? '' : String(A.content);
      }
      if (/\/$/.test(dest)) dest += src || 'file';
      if (!H.dirs[dirOf(dest)] && !H.files[dirOf(dest)]) return fail('Destination directory ' + dirOf(dest) + ' does not exist');
      var cur = H.files[dest];
      var mode = A.mode !== undefined ? String(A.mode).replace(/^(\d{3})$/, '0$1') : cur ? cur.mode : '0644';
      if (cur && cur.content === content && cur.mode === mode) { res.dest = dest; return res; }
      if (!ctx.root && needRoot(dest)) return fail('Destination ' + dirOf(dest) + ' not writable. Butuh root, tambahkan "become: true".');
      res.changed = true; res.dest = dest;
      if (ctx.diff && (!cur || cur.content !== content)) res.diffLines = lineDiff(dest, cur ? cur.content : null, content);
      if (!ctx.check) { H.files[dest] = { type: 'file', content: content, mode: mode }; H.touched[dest] = true; }
      return res;
    }
    if (mod === 'file') {
      var path = String(A.path || A.dest || A.name || '');
      if (!path) return fail('missing required arguments: path');
      var st = A.state || (H.dirs[path] ? 'directory' : 'file');
      var exists = H.files[path] || H.dirs[path];
      if (st === 'directory') {
        if (H.dirs[path]) return res;
        if (H.files[path]) return fail('there was an issue creating ' + path + ' as requested: ' + path + ' sudah ada sebagai file biasa');
        if (!ctx.root && needRoot(path)) return fail('There was an issue creating ' + path + ' as requested: [Errno 13] Permission denied');
        res.changed = true;
        if (!ctx.check) { var parts = path.split('/'); for (var x = 2; x <= parts.length; x++) H.dirs[parts.slice(0, x).join('/')] = 1; H.touched[path] = true; }
      } else if (st === 'absent') {
        if (!exists) return res;
        if (!ctx.root && needRoot(path)) return fail('[Errno 13] Permission denied: ' + path);
        res.changed = true;
        if (!ctx.check) { delete H.files[path]; delete H.dirs[path]; }
      } else if (st === 'touch') {
        if (!ctx.root && needRoot(path)) return fail('Error, could not touch target: [Errno 13] Permission denied: ' + path);
        res.changed = true;
        if (!ctx.check && !H.files[path]) { H.files[path] = { type: 'file', content: '', mode: '0644' }; H.touched[path] = true; }
      } else if (st === 'file') {
        if (!H.files[path]) return fail('file (' + path + ') is absent, cannot continue');
        if (A.mode !== undefined && String(A.mode).replace(/^(\d{3})$/, '0$1') !== H.files[path].mode) {
          res.changed = true;
          if (!ctx.check) H.files[path].mode = String(A.mode).replace(/^(\d{3})$/, '0$1');
        }
      } else return fail('value of state must be one of: absent, directory, file, hard, link, touch, got: ' + st);
      res.path = path;
      return res;
    }
    if (mod === 'lineinfile') {
      var lp = String(A.path || A.dest || '');
      if (!lp) return fail('missing required arguments: path');
      var f = H.files[lp];
      if (!f && !truthy(A.create)) return fail('Destination ' + lp + ' does not exist !', { rc: 257 });
      var lines = f && f.content ? f.content.replace(/\n$/, '').split('\n') : [];
      var before = lines.join('\n');
      var re = A.regexp ? new RegExp(String(A.regexp)) : null;
      if ((A.state || 'present') === 'absent') {
        lines = lines.filter(function (l) { return re ? !re.test(l) : l !== String(A.line); });
      } else {
        var line = String(A.line === undefined ? '' : A.line);
        var hit = -1;
        lines.forEach(function (l, k) { if ((re && re.test(l)) || l === line) hit = k; });
        if (hit >= 0) lines[hit] = line; else lines.push(line);
      }
      var after = lines.join('\n');
      if (after === before && f) return res;
      if (!ctx.root && needRoot(lp)) return fail('Destination ' + lp + ' not writable. Butuh root, tambahkan "become: true".');
      res.changed = true;
      res.msg = A.state === 'absent' ? 'line removed' : 'line added';
      if (ctx.diff) res.diffLines = lineDiff(lp, f ? f.content : null, after + '\n');
      if (!ctx.check) { H.files[lp] = { type: 'file', content: after + '\n', mode: f ? f.mode : '0644' }; H.touched[lp] = true; }
      return res;
    }
    if (mod === 'user' || mod === 'group') {
      var un = String(A.name);
      if (mod === 'group') {
        H.groups = H.groups || {};
        if (H.groups[un] || A.state === 'absent' && !H.groups[un]) return res;
        if (!ctx.root) return fail('groupadd: Permission denied. Tambahkan "become: true".');
        res.changed = true;
        if (!ctx.check) H.groups[un] = true;
        return res;
      }
      var u = H.users[un];
      var gs = pkgList(A.groups);
      if (A.state === 'absent') {
        if (!u) return res;
        if (!ctx.root) return fail('userdel: Permission denied. Tambahkan "become: true".');
        res.changed = true;
        if (!ctx.check) delete H.users[un];
        return res;
      }
      var ng = u ? (truthy(A.append) ? u.groups.concat(gs.filter(function (g) { return u.groups.indexOf(g) < 0; })) : (A.groups !== undefined ? gs : u.groups)) : gs;
      if (u && JSON.stringify(ng) === JSON.stringify(u.groups)) { res.name = un; return res; }
      if (!ctx.root) return fail((u ? 'usermod' : 'useradd') + ': Permission denied. Tambahkan "become: true".');
      res.changed = true; res.name = un;
      if (!ctx.check) { H.users[un] = { groups: ng }; if (A.create_home !== false) H.dirs['/home/' + un] = 1; }
      return res;
    }
    if (mod === 'command' || mod === 'shell') {
      var cmd = String(A.cmd || A._raw || '');
      if (!cmd) return fail('no command given', { rc: 256 });
      if (A.creates && (H.files[A.creates] || H.dirs[A.creates])) { res.stdout = 'skipped, since ' + A.creates + ' exists'; res.skippedCmd = true; return res; }
      if (A.removes && !(H.files[A.removes] || H.dirs[A.removes])) { res.stdout = 'skipped, since ' + A.removes + ' does not exist'; res.skippedCmd = true; return res; }
      if (ctx.check) { res.skipped = true; res.msg = 'Command would have run if not in check mode'; return res; }
      if (mod === 'command' && /[|>;&]|\$\(/.test(cmd)) {
        // command does not go through a shell, so redirects are just arguments
        res.rc = 1; res.stderr = 'date: extra operand ‘>’'; res.changed = true;
        return fail('non-zero return code. Modul command ga lewat shell, jadi ">" dan "|" ga jalan. Pakai modul shell.', { rc: 1, changed: true });
      }
      res.changed = true; res.rc = 0;
      var out = '';
      var redir = /^(.*?)\s*(>>?)\s*(\S+)\s*$/.exec(cmd);
      var base = redir ? redir[1] : cmd;
      var word = base.trim().split(/\s+/);
      var now = new Date();
      if (word[0] === 'date') out = now.toUTCString().replace('GMT', 'UTC');
      else if (word[0] === 'hostname') out = H.name;
      else if (word[0] === 'whoami') out = ctx.root ? 'root' : String(ctx.vars.ansible_user || 'deploy');
      else if (word[0] === 'uptime') out = ' ' + now.toTimeString().slice(0, 8) + ' up 3 days,  2:14,  1 user,  load average: 0.08, 0.03, 0.01';
      else if (word[0] === 'echo') out = base.replace(/^echo\s*/, '').replace(/^["']|["']$/g, '');
      else if (word[0] === 'uname') out = 'Linux' + (word[1] === '-a' ? ' ' + H.name + ' 6.8.0-45-generic x86_64 GNU/Linux' : '');
      else if (word[0] === 'cat') {
        var cf = H.files[word[1]];
        if (!cf) return fail('non-zero return code', { rc: 1, stderr: 'cat: ' + word[1] + ': No such file or directory', changed: true });
        out = cf.content.replace(/\n$/, '');
      } else if (word[0] === 'systemctl' && word[1] === 'is-active') {
        var s2 = H.svcs[word[2]];
        out = s2 && s2.running ? 'active' : 'inactive';
        if (!(s2 && s2.running)) return fail('non-zero return code', { rc: 3, stdout: out, changed: true });
      } else if (word[0] === 'ls') out = Object.keys(H.files).filter(function (p) { return dirOf(p) === (word[1] || '/home/deploy'); }).map(function (p) { return p.split('/').pop(); }).join('\n');
      else if (word[0] === 'free') out = '               total        used        free\nMem:            ' + (H.name.indexOf('db') === 0 ? '3912' : '1963') + '         412        1205';
      else if (word[0] === 'df') out = 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        20G  4.1G   15G  22% /';
      else if (word[0] === 'touch' || word[0] === 'mkdir' || word[0] === 'true') out = '';
      else if (word[0] === 'false') return fail('non-zero return code', { rc: 1, changed: true });
      else out = '';
      if (word[0] === 'touch' && word[1]) {
        if (!ctx.root && needRoot(word[1])) return fail('non-zero return code', { rc: 1, stderr: 'touch: cannot touch \'' + word[1] + '\': Permission denied', changed: true });
        if (!H.files[word[1]]) H.files[word[1]] = { type: 'file', content: '', mode: '0644' };
        H.touched[word[1]] = true;
      }
      if (word[0] === 'mkdir' && word[word.length - 1]) H.dirs[word[word.length - 1]] = 1;
      if (redir && mod === 'shell') {
        var rp = redir[3];
        if (!ctx.root && needRoot(rp)) return fail('non-zero return code', { rc: 1, stderr: '/bin/sh: 1: cannot create ' + rp + ': Permission denied', changed: true });
        var prev = H.files[rp] && redir[2] === '>>' ? H.files[rp].content : '';
        H.files[rp] = { type: 'file', content: prev + out + '\n', mode: '0644' };
        H.touched[rp] = true;
        out = '';
      }
      res.stdout = out;
      res.cmd = cmd;
      return res;
    }
    return fail('module ' + mod + ' belum dibuat di simulasi ini');
  }

  // ---------- UI shell ----------
  var term = new K.Term($('an-out'), $('an-in'), { onCmd: runLine });
  var toast = K.makeToast($('an-toast'));
  var M = new K.Missions($('an-m-list'), $('an-m-count'), MISSIONS, toast, '🎉 Semua misi beres. Kamu udah paham dasar Ansible!');
  var PS = 'deploy@control:~/lab$';
  var curTab = 'site.yml';
  var ed = new K.Editor($('an-ed'), {
    value: '', label: 'Isi file', highlight: K.hlYAML,
    onChange: function (v) { W.files[curTab] = v; W.errs[curTab] = []; renderAll(); }
  });
  function openTab(f) {
    curTab = f;
    var t = TABS.filter(function (x) { return x.f === f; })[0];
    ed.highlight = t.hl;
    ed.ta.value = W.files[f];
    ed.mark(W.errs[f] || []);
    ed.ta.setAttribute('aria-label', 'Isi file ' + (t.label || f));
    renderTabs();
  }
  function renderTabs() {
    setHTML($('an-tabs'), TABS.map(function (t) {
      var bad = (W.errs[t.f] || []).length;
      return '<button type="button" role="tab" data-act="tab" data-f="' + t.f + '" aria-selected="' + (t.f === curTab) + '">' + esc(t.label || t.f) + (bad ? ' <i>●</i>' : '') + '</button>';
    }).join(''));
  }
  function markErr(file, line) {
    W.errs[file] = line ? [line] : [];
    if (file !== curTab) openTab(file); else ed.mark(W.errs[file]);
    renderTabs();
  }

  function stars(title) {
    var pad = Math.max(3, 72 - title.length - 1);
    return '<span class="sx-b sx-nw">' + esc(title) + '</span> <span class="sx-dim">' + new Array(pad + 1).join('*') + '</span>';
  }
  function jsonish(o, ind) {
    ind = ind || '';
    var keys = Object.keys(o).filter(function (k) { return o[k] !== undefined && k !== 'diffLines' && k !== 'debug' && k !== 'skippedCmd'; });
    return '{\n' + keys.map(function (k, i) {
      var v = o[k];
      var s = typeof v === 'object' && v !== null ? (Array.isArray(v) ? JSON.stringify(v) : jsonish(v, ind + '    ')) : JSON.stringify(v);
      return ind + '    ' + JSON.stringify(k) + ': ' + s + (i < keys.length - 1 ? ',' : '');
    }).join('\n') + '\n' + ind + '}';
  }
  function hostLine(h, r, item) {
    var it = item !== undefined ? ' =&gt; (item=' + esc(typeof item === 'object' ? JSON.stringify(item) : item) + ')' : '';
    if (r.unreachable) return '<span class="sx-err">fatal: [' + h + ']: UNREACHABLE! =&gt; ' + esc(jsonish({ changed: false, msg: r.msg, unreachable: true })) + '</span>';
    if (r.failed) return '<span class="sx-err">' + (r.ignored ? 'failed' : 'fatal') + ': [' + h + ']' + (it ? it : ': FAILED!') + ' =&gt; ' + esc(jsonish(clean(r))) + '</span>' + (r.ignored ? '\n<span class="sx-info">...ignoring</span>' : '');
    if (r.skipped) return '<span class="sx-info">skipping: [' + h + ']' + it + '</span>';
    var cls = r.changed ? 'sx-chg' : 'sx-ok';
    var word = r.changed ? 'changed' : 'ok';
    var body = '';
    if (r.debug) body = ' =&gt; ' + esc(jsonish(clean(r)));
    return '<span class="' + cls + '">' + word + ': [' + h + ']' + it + body + '</span>';
  }
  function clean(r) {
    var o = {};
    Object.keys(r).forEach(function (k) { if (['failed', 'ignored', 'diffLines', 'debug', 'skippedCmd', 'unreachable'].indexOf(k) < 0) o[k] = r[k]; });
    if (r.failed) o.changed = !!r.changed;
    return o;
  }

  function runLine(line) {
    term.echo(PS, line);
    if (!line) return;
    var words = line.match(/"[^"]*"|'[^']*'|\S+/g) || [];
    var cmd = words.shift();
    if (cmd === 'clear') { term.clear(); return; }
    if (cmd === 'help') { help(); return; }
    if (cmd === 'ls') { term.line('ansible.cfg  inventory.ini  site.yml  <span class="sx-info">templates/</span>'); return; }
    if (cmd === 'cat') {
      var f = (words[0] || '').replace(/^templates\//, '');
      if (f === 'ansible.cfg') { term.lines(['[defaults]', 'inventory = inventory.ini', 'host_key_checking = False', 'forks = 5']); return; }
      if (W.files[f] === undefined) { term.line('cat: ' + esc(words[0] || '') + ': No such file or directory', 'sx-err'); return; }
      var t = TABS.filter(function (x) { return x.f === f; })[0];
      term.lines(W.files[f].replace(/\n$/, '').split('\n').map(t.hl));
      return;
    }
    if (cmd === 'curl') { curl(words.filter(function (w) { return w[0] !== '-'; })[0]); return; }
    if (cmd === 'ssh') { term.line('Simulasi ini ga punya shell interaktif. Coba: ansible ' + esc(words[0] || 'web1') + ' -a "uptime"', 'sx-warn'); return; }
    if (W.busy) { term.line('Playbook sebelumnya masih jalan. Tunggu sebentar ya.', 'sx-warn'); return; }
    if (cmd === 'ansible-playbook') { playbookCmd(words); return; }
    if (cmd === 'ansible') { adhoc(words); return; }
    if (cmd === 'ansible-inventory') { invCmd(words); return; }
    term.line('bash: ' + esc(cmd) + ': command not found', 'sx-err');
    term.line('<span class="sx-dim">Ketik <b>help</b> buat lihat perintah yang ada.</span>');
  }
  function help() {
    term.lines([
      '<span class="sx-b">Perintah yang bisa dicoba:</span>',
      '  ansible all -m ping                    cek koneksi SSH ke semua host',
      '  ansible web -a "uptime"                perintah ad-hoc (modul command)',
      '  ansible db -m apt -a "name=htop" -b    ad-hoc pakai modul lain, -b = become',
      '  ansible-playbook site.yml [--check] [--diff] [--limit web1]',
      '  ansible-playbook site.yml --syntax-check | --list-hosts | --list-tasks',
      '  ansible-inventory --graph',
      '  curl web1                              lihat halaman yang disajikan nginx',
      '  ls, cat FILE, clear',
      '<span class="sx-dim">Panah atas/bawah buat ambil perintah sebelumnya.</span>'
    ]);
  }
  function loadInv() {
    var inv = parseInv(W.files['inventory.ini']);
    if (inv.errs.length) {
      var e = inv.errs[0];
      term.line('<span class="sx-warn">[WARNING]: Unable to parse /home/deploy/lab/inventory.ini as an inventory source</span>');
      term.line('<span class="sx-err">ERROR! inventory.ini baris ' + e.line + ': ' + esc(e.msg) + '</span>');
      markErr('inventory.ini', e.line);
      return null;
    }
    W.errs['inventory.ini'] = [];
    if (curTab === 'inventory.ini') ed.mark([]);
    renderTabs();
    return inv;
  }
  function invCmd(words) {
    var inv = loadInv();
    if (!inv) return;
    if (words.indexOf('--list') >= 0) {
      var o = { _meta: { hostvars: {} } };
      Object.keys(inv.groups).forEach(function (g) { var G = inv.groups[g]; o[g] = { hosts: g === 'all' ? undefined : G.hosts, children: G.children.length ? G.children : undefined }; });
      inv.order.forEach(function (h) { o._meta.hostvars[h] = invVars(inv, h); });
      term.lines(JSON.stringify(o, null, 4).split('\n').map(esc));
      return;
    }
    var out = ['@all:'];
    var tops = Object.keys(inv.groups).filter(function (g) {
      return g !== 'all' && !Object.keys(inv.groups).some(function (p) { return inv.groups[p].children.indexOf(g) >= 0; });
    });
    function walk(g, pre) {
      out.push(pre + '|--@' + g + ':');
      inv.groups[g].children.forEach(function (c) { walk(c, pre + '|  '); });
      inv.groups[g].hosts.forEach(function (h) { out.push(pre + '|  |--' + h); });
    }
    tops.forEach(function (g) { if (g !== 'ungrouped' || inv.groups.ungrouped.hosts.length) walk(g, '  '); });
    term.lines(out.map(esc));
  }
  function curl(target) {
    var h = String(target || '').replace(/^https?:\/\//, '').replace(/[:/].*$/, '');
    if (!h) { term.line('curl: try \'curl web1\'', 'sx-warn'); return; }
    if (!S[h]) { term.line('curl: (6) Could not resolve host: ' + esc(h), 'sx-err'); return; }
    var H = S[h];
    if (!H.up) { term.line('curl: (28) Failed to connect to ' + h + ' port 80 after 3001 ms: Timeout was reached', 'sx-err'); return; }
    if (!H.svcs.nginx || !H.svcs.nginx.running) { term.line('curl: (7) Failed to connect to ' + h + ' port 80 after 2 ms: Couldn\'t connect to server', 'sx-err'); return; }
    var page = H.files['/var/www/html/index.html'];
    term.lines((page ? page.content : '<h1>Welcome to nginx!</h1>\n').replace(/\n$/, '').split('\n').map(K.hlJinja));
  }

  function opts(words) {
    var o = { check: false, diff: false, limit: null, become: false, file: null, mod: null, args: null, pattern: null, flags: {} };
    for (var i = 0; i < words.length; i++) {
      var w = words[i].replace(/^["']|["']$/g, '');
      var nx = function () { i++; return (words[i] || '').replace(/^["']|["']$/g, ''); };
      if (w === '-C' || w === '--check') o.check = true;
      else if (w === '-D' || w === '--diff') o.diff = true;
      else if (w === '-l' || w === '--limit') o.limit = nx();
      else if (/^--limit=/.test(w)) o.limit = w.slice(8);
      else if (w === '-b' || w === '--become') o.become = true;
      else if (w === '-i' || w === '--inventory') nx();
      else if (w === '-m' || w === '--module-name') o.mod = nx();
      else if (w === '-a' || w === '--args') o.args = nx();
      else if (w === '-v' || w === '-vv' || w === '-vvv') o.flags.v = true;
      else if (/^--/.test(w)) o.flags[w.slice(2)] = true;
      else if (/^-/.test(w)) o.flags[w.slice(1)] = true;
      else if (!o.file) o.file = w;
      else o.extra = w;
    }
    return o;
  }

  // ---------- host cards ----------
  var cards = {};
  function buildCards() {
    var wrap = $('an-hosts');
    HOSTS.forEach(function (h) {
      var el = document.createElement('div');
      el.className = 'an-host';
      el.innerHTML = '<div class="an-hh"><i class="an-dot" aria-hidden="true"></i><b>' + h + '</b><span class="an-os"></span>' +
        '<label class="gx-sw an-pw" title="Nyalakan atau matikan server"><input type="checkbox" checked data-act="power" data-h="' + h + '"><span aria-hidden="true"></span><em class="sr">power ' + h + '</em></label></div>' +
        '<div class="an-groups"></div><div class="an-task"></div><div class="an-body"></div><div class="an-recap"></div>';
      wrap.appendChild(el);
      cards[h] = { el: el, os: el.querySelector('.an-os'), groups: el.querySelector('.an-groups'), task: el.querySelector('.an-task'), body: el.querySelector('.an-body'), recap: el.querySelector('.an-recap'), pw: el.querySelector('input') };
    });
  }
  function hit(h) {
    var el = cards[h].el;
    el.classList.remove('is-hit');
    void el.offsetWidth;
    el.classList.add('is-hit');
  }
  function renderHosts(inv) {
    HOSTS.forEach(function (h) {
      var H = S[h], c = cards[h];
      var inInv = inv && inv.hosts[h];
      var cls = 'an-host an-' + H.status + (H.up ? '' : ' is-off') + (inInv ? '' : ' is-out');
      var keep = c.el.classList.contains('is-hit') ? ' is-hit' : '';
      if (c.el.className !== cls + keep) c.el.className = cls + keep;
      setText(c.os, LAB[h].os);
      if (c.pw.checked !== H.up) c.pw.checked = H.up;
      var gs = inv && inInv ? groupsOf(inv, h).filter(function (g) { return g !== 'ungrouped'; }) : [];
      setHTML(c.groups, inInv ? (gs.length ? gs.map(function (g) { return '<span class="an-g">' + esc(g) + '</span>'; }).join('') : '<span class="an-g">ungrouped</span>') : '<span class="an-out">belum ada di inventory</span>');
      setText(c.task, H.task);
      var pk = Object.keys(H.pkgs).filter(function (p) { return p !== 'python3' && p !== 'openssh-server'; });
      var sv = Object.keys(H.svcs).filter(function (s) { return s !== 'ssh' && s !== 'sshd' && s !== 'cron'; });
      var fl = Object.keys(H.touched).filter(function (f) { return H.files[f] || H.dirs[f]; });
      var body = '';
      if (sv.length) body += '<div class="an-row"><small>service</small>' + sv.map(function (s) { var on = H.svcs[s].running; return '<span class="an-svc' + (on ? ' is-on' : '') + '" title="' + (on ? 'running' : 'stopped') + '">' + esc(s) + '</span>'; }).join('') + '</div>';
      if (pk.length) body += '<div class="an-row"><small>paket</small>' + pk.map(function (p) { return '<span class="an-pkg">' + esc(p) + '</span>'; }).join('') + '</div>';
      if (fl.length) body += '<div class="an-row"><small>file</small>' + fl.slice(-3).map(function (f) { return '<span class="an-file" title="' + esc(f) + '">' + esc(f) + '</span>'; }).join('') + (fl.length > 3 ? '<span class="an-more">+' + (fl.length - 3) + '</span>' : '') + '</div>';
      if (!body) body = '<div class="an-row an-blank">server baru, belum diapa-apain</div>';
      setHTML(c.body, body);
      var r = H.last;
      setHTML(c.recap, r ? ['ok', 'changed', 'failed', 'unreachable', 'skipped'].filter(function (k) { return r[k] || k === 'ok' || k === 'changed'; }).map(function (k) { return '<span class="an-rc an-rc-' + k + '">' + k + '=' + r[k] + '</span>'; }).join('') : '');
    });
  }
  function renderAll() {
    var inv = parseInv(W.files['inventory.ini']);
    var nHosts = inv.errs.length ? 0 : inv.order.length;
    setText($('an-f-inv'), inv.errs.length ? 'ada error' : nHosts + ' host');
    $('an-f-inv').dataset.s = inv.errs.length ? 'bad' : '';
    var pb = null, perr = null;
    try { pb = compile(W.files['site.yml']); } catch (e) { perr = e; }
    var nt = pb ? pb.reduce(function (a, p) { return a + p.tasks.length; }, 0) : 0;
    setText($('an-f-pb'), perr ? 'ada error' : pb.length + ' play · ' + nt + ' task');
    $('an-f-pb').dataset.s = perr ? 'bad' : '';
    var up = HOSTS.filter(function (h) { return !inv.errs.length && inv.hosts[h] && S[h].up; }).length;
    var down = HOSTS.filter(function (h) { return !inv.errs.length && inv.hosts[h] && !S[h].up; }).length;
    setText($('an-f-srv'), W.busy ? 'sedang dikonfigurasi…' : up + ' nyala' + (down ? ', ' + down + ' mati' : ''));
    $('an-f-srv').dataset.s = W.busy ? 'info' : down ? 'warn' : '';
    var rc = W.recap;
    setText($('an-f-rc'), rc ? (rc.failed + rc.unreachable ? rc.failed + rc.unreachable + ' gagal' : rc.changed ? rc.changed + ' changed' : 'semua ok') : 'belum jalan');
    $('an-f-rc').dataset.s = rc ? (rc.failed + rc.unreachable ? 'bad' : rc.changed ? 'warn' : 'ok') : '';
    // limit picker follows the inventory
    var sel = $('an-limit'), cur = sel.value;
    var optsH = '<option value="">semua host</option>' + (inv.errs.length ? '' :
      Object.keys(inv.groups).filter(function (g) { return g !== 'all' && g !== 'ungrouped'; }).map(function (g) { return '<option value="' + esc(g) + '">grup ' + esc(g) + '</option>'; }).join('') +
      inv.order.map(function (h) { return '<option value="' + esc(h) + '">' + esc(h) + '</option>'; }).join(''));
    if (sel._h !== optsH) { sel.innerHTML = optsH; sel._h = optsH; sel.value = cur; if (sel.value !== cur) sel.value = ''; }
    $('an-quick').classList.toggle('is-busy', W.busy);
    renderHosts(inv.errs.length ? null : inv);
  }

  // ---------- ad-hoc ----------
  async function adhoc(words) {
    var o = opts(words);
    if (!o.file) { term.line('usage: ansible &lt;host-pattern&gt; [-m MODULE] [-a ARGS] [-b] [--check]', 'sx-warn'); return; }
    if (o.flags.version) { term.line('ansible [core 2.17.5]'); return; }
    var inv = loadInv();
    if (!inv) return;
    var hosts = matchPattern(inv, o.file);
    if (o.limit) { var lim = matchPattern(inv, o.limit); hosts = hosts.filter(function (h) { return lim.indexOf(h) >= 0; }); }
    if (!hosts.length) {
      term.line('<span class="sx-warn">[WARNING]: Could not match supplied host pattern, ignoring: ' + esc(o.file) + '</span>');
      term.line('<span class="sx-warn">[WARNING]: No hosts matched, nothing to do</span>');
      return;
    }
    var mod = modName(o.mod || 'command');
    if (!MODS[mod]) { term.line("ERROR! couldn't resolve module/action '" + esc(o.mod) + "'", 'sx-err'); return; }
    var args = o.args ? freeArgs(o.args, mod) : {};
    W.busy = true;
    var run = ++W.run;
    renderAll();
    var pinged = 0;
    await Promise.all(hosts.map(async function (h) {
      if (S[h]) { S[h].status = 'run'; S[h].task = (o.mod || 'command') + (o.args ? ' ' + o.args : ''); }
      renderAll();
      await sleep(jitter(300, 900));
      if (run !== W.run) return;
      var vars = Object.assign({ inventory_hostname: h }, invVars(inv, h), facts(h));
      var r;
      if (!LAB[h]) r = { unreachable: true, msg: 'Failed to connect to the host via ssh: ssh: Could not resolve hostname ' + h + ': Name or service not known' };
      else if (!S[h].up) r = { unreachable: true, msg: 'Failed to connect to the host via ssh: ssh: connect to host ' + h + ' port 22: Connection timed out' };
      else {
        var ra;
        try { ra = render(args, vars); } catch (e) { ra = null; r = { failed: true, msg: e instanceof Undef ? "'" + e.name + "' is undefined" : e.message }; }
        if (ra) r = execMod(S[h], mod, ra, { check: o.check, diff: o.diff, root: o.become, vars: vars });
      }
      if (LAB[h]) { S[h].status = r.unreachable ? 'unreachable' : r.failed ? 'failed' : r.changed ? 'changed' : 'ok'; S[h].task = ''; hit(h); }
      if (r.unreachable) term.line('<span class="sx-err">' + h + ' | UNREACHABLE! =&gt; ' + esc(jsonish({ changed: false, msg: r.msg, unreachable: true })) + '</span>');
      else if (r.failed) term.line('<span class="sx-err">' + h + ' | FAILED!' + (r.rc !== undefined ? ' | rc=' + r.rc : '') + ' =&gt; ' + esc(jsonish(clean(r))) + '</span>');
      else if ((mod === 'command' || mod === 'shell') && !r.skipped) term.line('<span class="' + (r.changed ? 'sx-chg' : 'sx-ok') + '">' + h + ' | ' + (r.changed ? 'CHANGED' : 'SUCCESS') + ' | rc=0 &gt;&gt;</span>' + (r.stdout ? '\n' + esc(r.stdout) : ''));
      else {
        if (mod === 'ping') pinged++;
        term.line('<span class="' + (r.changed ? 'sx-chg' : 'sx-ok') + '">' + h + ' | ' + (r.changed ? 'CHANGED' : 'SUCCESS') + ' =&gt; ' + esc(jsonish(clean(r))) + '</span>');
        if (r.diffLines) term.lines(r.diffLines);
      }
      renderAll();
    }));
    if (run !== W.run) return;
    W.busy = false;
    if (mod === 'ping' && pinged && pinged === hosts.length) M.hit('ping');
    else if (mod === 'ping' && pinged) toast('Ada host yang ga bisa dihubungi. Cek kartunya di bawah.');
    renderAll();
  }

  // ---------- ansible-playbook ----------
  async function playbookCmd(words) {
    var o = opts(words);
    if (!o.file) { term.line('usage: ansible-playbook [-i INVENTORY] [--check] [--diff] [--limit SUBSET] playbook.yml', 'sx-warn'); return; }
    if (o.file !== 'site.yml') { term.line('ERROR! the playbook: ' + esc(o.file) + ' could not be found', 'sx-err'); return; }
    var inv = loadInv();
    if (!inv) return;
    var plays;
    try { plays = compile(W.files['site.yml']); }
    catch (e) {
      if (e.msg === undefined) throw e;
      e.file = e.file || 'site.yml';
      var where = e.line ? "\n\nThe error appears to be in '/home/deploy/lab/" + e.file + "': line " + e.line + ', column 1, but may\nbe elsewhere in the file depending on the exact syntax problem.' : '';
      var src = e.line ? '\n\nThe offending line appears to be:\n\n' + (W.files[e.file].split('\n')[e.line - 1] || '') + '\n^ here' : '';
      term.lines(((/^ERROR!/.test(e.msg) ? '' : 'ERROR! Syntax Error while loading YAML.\n  ') + e.msg + where + src).split('\n').map(function (l) { return '<span class="sx-err">' + esc(l) + '</span>'; }));
      markErr(e.file, e.line);
      return;
    }
    W.errs['site.yml'] = [];
    if (curTab === 'site.yml') ed.mark([]);
    renderTabs();
    var limit = o.limit ? matchPattern(inv, o.limit) : null;
    if (o.limit && !limit.length) {
      term.line('<span class="sx-warn">[WARNING]: Could not match supplied host pattern, ignoring: ' + esc(o.limit) + '</span>');
      term.line('<span class="sx-err">ERROR! Specified inventory, host pattern and/or --limit leaves us with no hosts to target.</span>');
      return;
    }
    if (o.flags['syntax-check']) { term.lines(['', 'playbook: site.yml']); return; }
    if (o.flags['list-hosts'] || o.flags['list-tasks']) {
      term.lines(['', 'playbook: site.yml']);
      plays.forEach(function (p, i) {
        var hs = matchPattern(inv, p.hosts).filter(function (h) { return !limit || limit.indexOf(h) >= 0; });
        term.lines(['', '  play #' + (i + 1) + ' (' + esc(p.hosts) + '): ' + esc(p.name) + '\tTAGS: []']);
        if (o.flags['list-hosts']) term.lines(['    pattern: [\'' + esc(p.hosts) + '\']', '    hosts (' + hs.length + '):'].concat(hs.map(function (h) { return '      ' + h; })));
        if (o.flags['list-tasks']) term.lines(['    tasks:'].concat(p.tasks.map(function (t) { return '      ' + esc(t.name) + '\tTAGS: []'; })));
      });
      return;
    }
    await runPlaybook(plays, inv, limit, o);
  }

  async function runPlaybook(plays, inv, limit, o) {
    var run = ++W.run;
    W.busy = true;
    var recap = {}, touchedHosts = [], handlerRan = false, checkChanged = false;
    var regs = {};
    function rc(h) { return recap[h] = recap[h] || { ok: 0, changed: 0, unreachable: 0, failed: 0, skipped: 0, rescued: 0, ignored: 0 }; }
    var dead = {};
    HOSTS.forEach(function (h) { S[h].status = 'idle'; S[h].task = ''; });
    renderAll();
    if (o.check) term.line('<span class="sx-dim"># --check: cuma simulasi, server ga diubah</span>');
    var anyHosts = false;
    for (var pi = 0; pi < plays.length; pi++) {
      var p = plays[pi];
      var hosts = matchPattern(inv, p.hosts).filter(function (h) { return !limit || limit.indexOf(h) >= 0; });
      term.lines(['', stars('PLAY [' + p.name + ']')]);
      K.pulse(app, 'target');
      await sleep(250);
      if (run !== W.run) return;
      if (!hosts.length) { term.line('<span class="sx-info">skipping: no hosts matched</span>'); continue; }
      anyHosts = true;
      hosts.forEach(function (h) { if (touchedHosts.indexOf(h) < 0) touchedHosts.push(h); rc(h); });
      var live = hosts.filter(function (h) { return !dead[h]; });
      var notified = {};
      var hv = {};
      live.forEach(function (h) {
        hv[h] = Object.assign({ inventory_hostname: h, group_names: groupsOf(inv, h).filter(function (g) { return g !== 'ungrouped'; }), groups: {} }, invVars(inv, h));
      });
      var connect = function (h) {
        if (!LAB[h]) return { unreachable: true, msg: 'Failed to connect to the host via ssh: ssh: Could not resolve hostname ' + h + ': Name or service not known' };
        if (!S[h].up) return { unreachable: true, msg: 'Failed to connect to the host via ssh: ssh: connect to host ' + h + ' port 22: Connection timed out' };
        return null;
      };
      var steps = [];
      if (p.facts) steps.push({ facts: true, name: 'Gathering Facts' });
      p.tasks.forEach(function (t) { steps.push(t); });
      for (var ti = 0; ti < steps.length; ti++) {
        var t = steps[ti];
        if (!live.length) break;
        term.lines(['', stars('TASK [' + t.name + ']')]);
        live.forEach(function (h) { if (LAB[h]) { S[h].status = 'run'; S[h].task = t.name; } });
        renderAll();
        K.pulse(app, 'ssh');
        await sleep(200);
        // hosts run a task in parallel (forks = 5); print in finishing order
        var order = live.map(function (h) { return { h: h, at: jitter(120, 520) }; }).sort(function (a, b) { return a.at - b.at; });
        var elapsed = 0;
        for (var oi = 0; oi < order.length; oi++) {
          await sleep(order[oi].at - elapsed);
          elapsed = order[oi].at;
          if (run !== W.run) return;
          var h = order[oi].h, R = rc(h);
          var conn = connect(h);
          if (t.facts) {
            if (conn) { finishHost(h, conn); continue; }
            Object.assign(hv[h], facts(h));
            hv[h].ansible_facts = facts(h);
            R.ok++;
            term.line('<span class="sx-ok">ok: [' + h + ']</span>');
            setHost(h, 'ok');
            continue;
          }
          if (conn && !p.facts) { finishHost(h, conn); continue; }
          await doTask(h, t, p, hv[h], R, notified);
        }
        live = live.filter(function (h) { return !dead[h]; });
        renderAll();
      }
      // handlers run once at the end of the play, in the order they are defined
      for (var hi = 0; hi < p.handlers.length; hi++) {
        var hd = p.handlers[hi];
        var hh = live.filter(function (h) { return notified[h] && notified[h][hd.name]; });
        if (!hh.length) continue;
        term.lines(['', stars('RUNNING HANDLER [' + hd.name + ']')]);
        hh.forEach(function (h) { S[h].status = 'run'; S[h].task = 'handler: ' + hd.name; });
        renderAll();
        for (var x = 0; x < hh.length; x++) {
          await sleep(jitter(150, 400));
          if (run !== W.run) return;
          await doTask(hh[x], hd, p, hv[hh[x]], rc(hh[x]), {});
          if (!o.check) handlerRan = true;
        }
        live = live.filter(function (h) { return !dead[h]; });
      }
    }
    if (run !== W.run) return;
    if (!anyHosts) term.lines(['', '<span class="sx-warn">[WARNING]: No hosts matched, nothing to do</span>']);

    async function doTask(h, t, p, vars, R, notified) {
      var items = [undefined];
      var tv = Object.assign({}, vars, regs[h] || {});
      Object.keys(p.vars).forEach(function (k) { tv[k] = p.vars[k]; });
      Object.keys(t.vars || {}).forEach(function (k) { tv[k] = t.vars[k]; });
      // play/task vars may themselves use {{ }}
      try { Object.keys(p.vars).forEach(function (k) { tv[k] = render(p.vars[k], tv); }); } catch (e) { /* reported below when used */ }
      if (t.loop !== undefined && t.loop !== null) {
        try { items = render(t.loop, tv); } catch (e) { return report(h, R, { failed: true, msg: "'" + (e.name || e.message) + "' is undefined" }, t); }
        if (!Array.isArray(items)) return report(h, R, { failed: true, msg: 'Invalid data passed to \'loop\', it requires a list, got this instead: ' + items }, t);
      }
      var all = [], anyChanged = false, anyFail = false, allSkip = true;
      for (var i = 0; i < items.length; i++) {
        var iv = items[i] === undefined ? tv : Object.assign({}, tv, { item: items[i] });
        var r;
        if (t.when !== undefined && t.when !== null) {
          var conds = Array.isArray(t.when) ? t.when : [t.when];
          var ok = true, werr = null;
          for (var c = 0; c < conds.length; c++) {
            var expr = typeof conds[c] === 'string' ? conds[c].replace(/^\s*\{\{\s*|\s*\}\}\s*$/g, '') : conds[c];
            try { if (!truthy(typeof expr === 'string' ? evalExpr(expr, iv) : expr)) { ok = false; break; } }
            catch (e) { werr = e instanceof Undef ? "The conditional check '" + conds[c] + "' failed. The error was: '" + e.name + "' is undefined" : "The conditional check '" + conds[c] + "' failed: " + e.message; break; }
          }
          if (werr) r = { failed: true, msg: werr };
          else if (!ok) r = { skipped: true, changed: false, skip_reason: 'Conditional result was False' };
        }
        if (!r) {
          var a;
          try { a = render(t.args, iv); }
          catch (e) { r = { failed: true, msg: e instanceof Undef ? "The task includes an option with an undefined variable. The error was: '" + e.name + "' is undefined" : 'template error: ' + e.message }; }
          if (!r) {
            var root = t.become !== undefined ? truthy(t.become) : p.become || o.become;
            r = execMod(S[h], t.mod, a, { check: o.check, diff: o.diff, root: root, vars: iv });
            if (t.changedWhen !== undefined && !r.failed) {
              try { r.changed = truthy(typeof t.changedWhen === 'string' ? evalExpr(t.changedWhen, Object.assign({}, iv, t.register ? (function () { var x = {}; x[t.register] = r; return x; })() : {})) : t.changedWhen); } catch (e) { /* keep */ }
            }
          }
        }
        if (r.failed && t.ignore) { r.ignored = true; }
        all.push(r);
        if (!r.skipped) allSkip = false;
        if (r.changed) anyChanged = true;
        if (r.failed && !r.ignored) anyFail = true;
        if (items.length > 1 || items[0] !== undefined) {
          term.line(hostLine(h, r, items[i]));
          if (o.diff && r.diffLines) term.lines(r.diffLines);
        }
        if (r.failed && !r.ignored) break;
      }
      var final = all.length === 1 ? all[0] : { changed: anyChanged, failed: anyFail, skipped: allSkip, results: all.length, msg: anyFail ? 'One or more items failed' : undefined };
      if (t.register) { regs[h] = regs[h] || {}; regs[h][t.register] = clean(final); }
      if (items.length === 1 && items[0] === undefined) {
        term.line(hostLine(h, final));
        if (o.diff && final.diffLines) term.lines(final.diffLines);
        if (final.debug && final.msg === undefined && !final.failed) { /* var debug printed by hostLine */ }
      }
      if (final.changed && !final.failed) t.notify.forEach(function (n) { notified[h] = notified[h] || {}; notified[h][n] = true; });
      return report(h, R, final, t, true);
    }
    function report(h, R, r, t, printed) {
      if (!printed) term.line(hostLine(h, r));
      if (r.failed && !r.ignored) { R.failed++; dead[h] = true; setHost(h, 'failed'); return; }
      if (r.ignored) { R.ignored++; R.ok++; setHost(h, 'failed'); return; }
      if (r.skipped) { R.skipped++; setHost(h, 'skipped'); return; }
      R.ok++;
      if (r.changed) { R.changed++; if (o.check && t && (t.mod === 'template' || t.mod === 'copy')) checkChanged = true; }
      setHost(h, r.changed ? 'changed' : 'ok');
    }
    function finishHost(h, r) {
      term.line(hostLine(h, r));
      rc(h).unreachable++;
      dead[h] = true;
      setHost(h, 'unreachable');
    }
    function setHost(h, st) {
      if (!S[h]) return;
      S[h].status = st;
      S[h].task = st === 'unreachable' ? 'ga bisa SSH' : '';
      hit(h);
      renderAll();
    }

    // PLAY RECAP
    term.lines(['', stars('PLAY RECAP')]);
    var tot = { ok: 0, changed: 0, failed: 0, unreachable: 0 };
    var padW = Math.max.apply(null, touchedHosts.map(function (h) { return h.length; }).concat([4])) + 2;
    touchedHosts.forEach(function (h) {
      var r = rc(h);
      var col = r.failed || r.unreachable ? 'sx-err' : r.changed ? 'sx-chg' : 'sx-ok';
      var f = function (k, cls) { var s = k + '=' + r[k]; return (r[k] && cls ? '<span class="' + cls + '">' + s + '</span>' : s) + new Array(Math.max(1, 3 - String(r[k]).length)).join(' '); };
      term.line('<span class="' + col + '">' + h + '</span>' + new Array(Math.max(2, padW + 1 - h.length)).join(' ') + ': ' +
        f('ok', 'sx-ok') + ' ' + f('changed', 'sx-chg') + ' ' + f('unreachable', 'sx-err') + ' ' + f('failed', 'sx-err') + ' ' + f('skipped', 'sx-info') + (r.rescued ? ' ' + f('rescued') : '') + (r.ignored ? ' ' + f('ignored', 'sx-warn') : ''));
      ['ok', 'changed', 'failed', 'unreachable'].forEach(function (k) { tot[k] += r[k]; });
      if (S[h]) {
        S[h].last = r;
        S[h].status = r.failed || r.unreachable ? (r.unreachable ? 'unreachable' : 'failed') : r.changed ? 'changed' : 'ok';
        S[h].task = '';
      }
    });
    W.recap = tot;
    W.busy = false;
    K.pulse(app, 'recap');
    K.flash(app, 'recap', tot.failed + tot.unreachable ? 'warn' : '');

    // missions
    if (!o.check && touchedHosts.length) {
      M.hit('run');
      var full = !limit && touchedHosts.length >= 2;
      if (full && !tot.changed && !tot.failed && !tot.unreachable) M.hit('idem');
      if (handlerRan && W.checkedDiff) M.hit('check');
      if (limit && touchedHosts.length === 1 && touchedHosts[0] === 'web3') M.hit('limit');
      var r3 = recap.web3;
      if (r3 && !r3.failed && !r3.unreachable && S.web3.svcs.nginx && S.web3.svcs.nginx.running) M.hit('rocky');
    }
    if (o.check && o.diff && checkChanged) W.checkedDiff = true;
    if (!o.check && handlerRan) W.checkedDiff = false;
    renderAll();
  }

  // ---------- wiring ----------
  app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    var act = b.dataset.act;
    if (act === 'tab') openTab(b.dataset.f);
    else if (act === 'cmd') term.submit(b.dataset.cmd);
    else if (act === 'play') {
      var c = 'ansible-playbook -i inventory.ini site.yml';
      if ($('an-check').checked) c += ' --check';
      if ($('an-diff').checked) c += ' --diff';
      if ($('an-limit').value) c += ' --limit ' + $('an-limit').value;
      term.submit(c);
    } else if (act === 'file-reset') {
      W.files[curTab] = FILES0[curTab];
      W.errs[curTab] = [];
      openTab(curTab);
      renderAll();
      toast(curTab + ' balik ke versi awal');
    } else if (act === 'reset') reset();
  });
  app.addEventListener('change', function (e) {
    var t = e.target;
    if (t.dataset && t.dataset.act === 'power') {
      var h = t.dataset.h;
      S[h].up = t.checked;
      S[h].status = 'idle';
      S[h].task = t.checked ? '' : 'mati';
      term.line('<span class="sx-dim"># ' + h + ' ' + (t.checked ? 'dinyalakan lagi' : 'dimatikan. Coba jalankan playbook dan lihat hasilnya.') + '</span>');
      renderAll();
    }
  });

  function reset() {
    W && W.run++;
    initWorld();
    term.clear();
    M.reset();
    HOSTS.forEach(function (h) { cards[h].el.classList.remove('is-hit'); });
    openTab('site.yml');
    W.recap = null;
    term.lines([
      '<span class="sx-dim"># Control node ini terhubung ke 5 server lab: web1, web2, web3, db1, db2.</span>',
      '<span class="sx-dim"># Mulai dengan </span><b>ansible all -m ping</b><span class="sx-dim">. Ketik </span><b>help</b><span class="sx-dim"> buat daftar perintah.</span>'
    ]);
    renderAll();
  }
  buildCards();
  initWorld();
  reset();
})();
