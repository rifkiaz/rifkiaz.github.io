// Shared pieces for the /terraform/, /ansible/, /docker/ and /swarm/ simulators: a small code
// editor with highlighting, a terminal pane with a command prompt, missions,
// the flow strip and a toast. Exposed as window.SimKit. Nothing is stored.
(function () {
  'use strict';

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  // only touch the DOM when the markup really changed, so CSS animations
  // and focus inside the element survive the render loop
  function setHTML(el, html) {
    if (el._h === html) return;
    el._h = html;
    el.innerHTML = html;
  }
  function setText(el, txt) { if (el.textContent !== txt) el.textContent = txt; }
  function hex(n) {
    var s = '';
    while (s.length < n) s += Math.floor(Math.random() * 16).toString(16);
    return s;
  }

  // ---------- small helpers for the docker, swarm and ceph pages ----------
  function h32(s, seed) {
    var h = (0x811c9dc5 ^ seed) >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return h >>> 0;
  }
  // fake sha256: 64 hex chars, stable for the same input
  function digest(s) {
    var o = '';
    for (var i = 0; i < 8; i++) o += ('0000000' + h32(s, Math.imul(i + 1, 0x9e3779b9)).toString(16)).slice(-8);
    return o;
  }
  function pad(s, n) { s = String(s); return s + new Array(Math.max(1, n - s.length + 1)).join(' '); }
  // split like a shell: quotes group, PESAN="a b" stays one word
  function words(line) {
    var out = [], cur = '', q = null, has = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (q) {
        if (ch === q) q = null;
        else if (ch === '\\' && q === '"' && i + 1 < line.length) cur += line[++i];
        else cur += ch;
        continue;
      }
      if (ch === '"' || ch === "'") { q = ch; has = true; continue; }
      if (/\s/.test(ch)) { if (cur || has) out.push(cur); cur = ''; has = false; continue; }
      cur += ch;
    }
    if (cur || has) out.push(cur);
    return out;
  }
  function edit(a, b) {
    var d = [];
    for (var i = 0; i <= a.length; i++) { d[i] = [i]; }
    for (var j = 0; j <= b.length; j++) d[0][j] = j;
    for (i = 1; i <= a.length; i++) for (j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return d[a.length][b.length];
  }

  function ago(t) {
    var s = Math.max(1, Math.round((Date.now() - t) / 1000));
    if (s < 60) return s + ' second' + (s > 1 ? 's' : '') + ' ago';
    if (s < 120) return 'About a minute ago';
    if (s < 3600) return Math.floor(s / 60) + ' minutes ago';
    if (s < 86400 * 2) return Math.floor(s / 3600) + ' hours ago';
    if (s < 86400 * 14) return Math.floor(s / 86400) + ' days ago';
    return Math.floor(s / 86400 / 7) + ' weeks ago';
  }

  // ---------- editor ----------
  // A transparent textarea over a highlighted <pre>. Both wrap the same way,
  // and line numbers are CSS counters on each line block, so wrapped lines
  // keep their number aligned without measuring anything.
  function Editor(root, opts) {
    var self = this;
    root.classList.add('sx-ed');
    root.innerHTML = '<pre class="sx-hl" aria-hidden="true"></pre>' +
      '<textarea spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off"></textarea>';
    this.hl = root.firstChild;
    this.ta = root.lastChild;
    this.ta.setAttribute('aria-label', opts.label || 'Editor');
    this.highlight = opts.highlight || function (l) { return esc(l); };
    this.onChange = opts.onChange || function () {};
    this.errs = {};
    this.ta.value = opts.value || '';
    this.ta.addEventListener('input', function () { self.errs = {}; self.paint(); self.onChange(self.ta.value); });
    this.ta.addEventListener('keydown', function (e) {
      if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        var s = self.ta.selectionStart, en = self.ta.selectionEnd, v = self.ta.value;
        self.ta.value = v.slice(0, s) + '  ' + v.slice(en);
        self.ta.selectionStart = self.ta.selectionEnd = s + 2;
        self.errs = {}; self.paint(); self.onChange(self.ta.value);
      }
    });
    this.paint();
  }
  Editor.prototype.get = function () { return this.ta.value; };
  Editor.prototype.set = function (v) {
    this.ta.value = v; this.errs = {}; this.paint(); this.onChange(v);
  };
  Editor.prototype.mark = function (lines) {
    var m = {};
    (lines || []).forEach(function (n) { if (n) m[n] = true; });
    this.errs = m;
    this.paint();
  };
  Editor.prototype.paint = function () {
    var hl = this.highlight, errs = this.errs;
    var html = this.ta.value.split('\n').map(function (l, i) {
      return '<span class="sx-ln' + (errs[i + 1] ? ' is-err' : '') + '">' + hl(l) + '</span>';
    }).join('');
    setHTML(this.hl, html);
  };
  Editor.prototype.append = function (text) {
    var v = this.ta.value.replace(/\s*$/, '');
    this.set(v + '\n\n' + text + '\n');
    this.ta.scrollIntoView({ block: 'nearest' });
  };

  // ---------- terminal ----------
  // Output is append-only: lines are added, never re-rendered.
  function Term(out, input, opts) {
    var self = this;
    this.out = out;
    this.input = input;
    this.hist = [];
    this.hi = 0;
    this.queue = [];
    this.busy = false;
    this.onCmd = opts.onCmd;
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var v = input.value;
        input.value = '';
        self.submit(v);
      } else if (e.key === 'ArrowUp') {
        if (!self.hist.length) return;
        e.preventDefault();
        self.hi = Math.max(0, self.hi - 1);
        input.value = self.hist[self.hi] || '';
      } else if (e.key === 'ArrowDown') {
        if (!self.hist.length) return;
        e.preventDefault();
        self.hi = Math.min(self.hist.length, self.hi + 1);
        input.value = self.hist[self.hi] || '';
      }
    });
  }
  Term.prototype.submit = function (v) {
    v = String(v).trim();
    if (v && this.hist[this.hist.length - 1] !== v) this.hist.push(v);
    this.hi = this.hist.length;
    this.onCmd(v);
  };
  Term.prototype.line = function (html, cls) {
    var d = document.createElement('div');
    d.className = 'sx-o' + (cls ? ' ' + cls : '');
    d.innerHTML = html === '' ? '&#8203;' : html;
    this.out.appendChild(d);
    while (this.out.childNodes.length > 600) this.out.removeChild(this.out.firstChild);
    this.out.scrollTop = this.out.scrollHeight;
    return d;
  };
  Term.prototype.lines = function (arr, cls) {
    var self = this;
    arr.forEach(function (l) { self.line(l, cls); });
  };
  Term.prototype.echo = function (prompt, cmd) {
    this.line('<span class="sx-ps">' + esc(prompt) + '</span> ' + esc(cmd), 'sx-cmd');
  };
  Term.prototype.clear = function () { this.out.innerHTML = ''; };
  // a docker-style table: columns padded to the widest cell plus 3 spaces,
  // in one block that scrolls sideways instead of wrapping
  Term.prototype.table = function (rows) {
    var w = [];
    rows.forEach(function (r) { r.forEach(function (c, i) { w[i] = Math.max(w[i] || 0, String(c).length); }); });
    return this.line(rows.map(function (r) {
      return r.map(function (c, i) { return i === r.length - 1 ? esc(c) : esc(pad(c, w[i] + 3)); }).join('').replace(/\s+$/, '');
    }).join('\n'), 'sx-tbl');
  };
  // print a list of [delay ms, html, cls] steps, then call done
  Term.prototype.play = function (steps, done) {
    var self = this, i = 0;
    self.busy = true;
    function next() {
      if (i >= steps.length) { self.busy = false; if (done) done(); return; }
      var s = steps[i++];
      setTimeout(function () {
        if (typeof s[1] === 'function') s[1]();
        else self.line(s[1], s[2]);
        next();
      }, s[0]);
    }
    next();
  };

  // ---------- missions ----------
  function Missions(listEl, countEl, items, toast, doneMsg) {
    this.listEl = listEl; this.countEl = countEl; this.items = items;
    this.toast = toast; this.doneMsg = doneMsg; this.done = {};
    this.render();
  }
  Missions.prototype.hit = function (id) {
    if (this.done[id]) return;
    this.done[id] = true;
    var n = 0, idx = 0, self = this;
    this.items.forEach(function (m, i) { if (self.done[m.id]) n++; if (m.id === id) idx = i; });
    this.toast(n === this.items.length ? this.doneMsg : '✓ Misi ' + (idx + 1) + ' beres (' + n + '/' + this.items.length + ')');
    this.render();
  };
  Missions.prototype.reset = function () { this.done = {}; this.render(); };
  Missions.prototype.render = function () {
    var self = this, n = 0;
    setHTML(this.listEl, this.items.map(function (m) {
      var ok = !!self.done[m.id];
      if (ok) n++;
      return '<li class="' + (ok ? 'is-done' : '') + '"><span class="gx-mk" aria-hidden="true">' + (ok ? '✓' : '') + '</span><span>' + m.text + '</span></li>';
    }).join(''));
    setText(this.countEl, n + '/' + this.items.length);
  };

  // ---------- flow strip + toast ----------
  function pulse(app, name) {
    var el = app.querySelector('[data-link="' + name + '"]');
    if (!el) return;
    el.classList.remove('is-go');
    void el.offsetWidth;
    el.classList.add('is-go');
    setTimeout(function () { el.classList.remove('is-go'); }, 1300);
  }
  function flash(app, node, kind) {
    var el = app.querySelector('[data-node="' + node + '"]');
    if (!el) return;
    el.classList.remove('is-flash', 'is-warn');
    void el.offsetWidth;
    el.classList.add(kind === 'warn' ? 'is-warn' : 'is-flash');
    setTimeout(function () { el.classList.remove('is-flash', 'is-warn'); }, 1200);
  }
  function makeToast(el) {
    var t;
    return function (msg) {
      el.innerHTML = msg;
      el.classList.add('is-on');
      clearTimeout(t);
      t = setTimeout(function () { el.classList.remove('is-on'); }, 2800);
    };
  }

  // ---------- highlighters ----------
  // Colours only, never bold or italic: the overlay must keep exactly the
  // same glyph widths as the textarea underneath.
  function wrap(cls, s) { return '<span class="sx-' + cls + '">' + esc(s) + '</span>'; }
  function scan(line, rules) {
    var out = '', i = 0;
    outer: while (i < line.length) {
      var rest = line.slice(i);
      for (var r = 0; r < rules.length; r++) {
        var m = rules[r][0].exec(rest);
        if (m && m.index === 0 && m[0].length) {
          out += typeof rules[r][1] === 'function' ? rules[r][1](m) : wrap(rules[r][1], m[0]);
          i += m[0].length;
          continue outer;
        }
      }
      out += esc(line[i]);
      i++;
    }
    return out;
  }
  function strWithInterp(s, open, close) {
    var out = '', parts = s.split(open);
    out += wrap('s', parts[0]);
    for (var i = 1; i < parts.length; i++) {
      var j = parts[i].indexOf(close);
      if (j < 0) { out += wrap('s', open + parts[i]); continue; }
      out += wrap('i', open + parts[i].slice(0, j) + close) + wrap('s', parts[i].slice(j + close.length));
    }
    return out;
  }
  var HCL = [
    [/^\s+/, function (m) { return m[0]; }],
    [/^(#|\/\/).*/, 'c'],
    [/^"(?:[^"\\]|\\.)*"?/, function (m) { return strWithInterp(m[0], '${', '}'); }],
    [/^(resource|variable|output|provider|terraform|locals|data|module|lifecycle|required_providers|ingress|egress)\b(?=\s*["{])/, 'k'],
    [/^[A-Za-z_][\w-]*(?=\s*=(?!=))/, 'a'],
    [/^(true|false|null)\b/, 'bo'],
    [/^\d+(\.\d+)?\b/, 'n'],
    [/^[A-Za-z_][\w-]*(\.[A-Za-z_*][\w-]*|\[\d+\]|\[\*\])+/, 'r']
  ];
  function hlHCL(line) { return scan(line, HCL); }

  var YAML = [
    [/^\s+/, function (m) { return m[0]; }],
    [/^#.*/, 'c'],
    [/^-(?=\s|$)/, 'p'],
    [/^"(?:[^"\\]|\\.)*"?/, function (m) { return strWithInterp(m[0], '{{', '}}'); }],
    [/^'(?:[^']|'')*'?/, function (m) { return strWithInterp(m[0], '{{', '}}'); }],
    [/^[\w.-]+(?=:(\s|$))/, 'a'],
    [/^\{\{.*?\}\}/, 'i'],
    [/^(true|false|yes|no|null)\b(?![\w.-])/, 'bo'],
    [/^\d+(\.\d+)?\b(?![\w.-])/, 'n']
  ];
  function hlYAML(line) {
    // a "# comment" only counts after whitespace; "#" inside a value is text
    return scan(line, YAML);
  }
  function hlINI(line) {
    if (/^\s*[#;]/.test(line)) return wrap('c', line);
    var m = /^(\s*)(\[[^\]]*\]?)(.*)$/.exec(line);
    if (m) return esc(m[1]) + wrap('k', m[2]) + esc(m[3]);
    return line.split(/(\s+)/).map(function (w) {
      var kv = /^([\w.-]+)=(.*)$/.exec(w);
      if (kv) return wrap('a', kv[1]) + '=' + wrap('s', kv[2]);
      return /^\s+$/.test(w) ? w : wrap('h', w);
    }).join('');
  }
  function hlJinja(line) {
    return scan(line, [
      [/^\{\{.*?\}\}/, 'i'],
      [/^\{%.*?%\}/, 'k'],
      [/^<\/?[\w-]+|^\/?>/, 'r']
    ]);
  }

  var DOCKER = [
    [/^\s+/, function (m) { return m[0]; }],
    [/^#.*/, 'c'],
    [/^"(?:[^"\\]|\\.)*"?/, function (m) { return strWithInterp(m[0], '${', '}'); }],
    [/^\$\{?\w+\}?/, 'i'],
    [/^--[\w-]+(=\S*)?/, 'a'],
    [/^\d+(\.\d+)?\b/, 'n']
  ];
  function hlDocker(line) {
    var m = /^(\s*)([A-Za-z]+)(?=\s|$)/.exec(line);
    if (/^\s*#/.test(line)) return wrap('c', line);
    if (!m) return scan(line, DOCKER);
    return esc(m[1]) + wrap('k', m[2]) + scan(line.slice(m[0].length), DOCKER.concat([[/^\b(AS|as)\b/, 'k']]));
  }
  var PY = [
    [/^\s+/, function (m) { return m[0]; }],
    [/^#.*/, 'c'],
    [/^f?"(?:[^"\\]|\\.)*"?/, function (m) { return m[0][0] === 'f' ? strWithInterp(m[0], '{', '}') : wrap('s', m[0]); }],
    [/^f?'(?:[^'\\]|\\.)*'?/, function (m) { return m[0][0] === 'f' ? strWithInterp(m[0], '{', '}') : wrap('s', m[0]); }],
    [/^@[\w.]+/, 'r'],
    [/^(import|from|def|return|if|elif|else|for|in|while|with|as|class|not|and|or|try|except|is|pass|lambda)\b/, 'k'],
    [/^(True|False|None)\b/, 'bo'],
    [/^\d+(\.\d+)?\b/, 'n'],
    [/^[A-Za-z_]\w*(?=\()/, 'a'],
    [/^[A-Za-z_]\w*/, function (m) { return esc(m[0]); }]
  ];
  function hlPy(line) { return scan(line, PY); }

  // ---------- YAML (subset) ----------
  // Enough YAML for playbooks and compose files: block maps and lists,
  // flow [..] / {..}, quoted scalars and | > blocks. Every map and list
  // remembers its source line (lineOf) so errors can point at the editor.
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

  window.SimKit = {
    esc: esc, setHTML: setHTML, setText: setText, hex: hex,
    digest: digest, pad: pad, words: words, edit: edit, ago: ago,
    Editor: Editor, Term: Term, Missions: Missions,
    pulse: pulse, flash: flash, makeToast: makeToast,
    hlHCL: hlHCL, hlYAML: hlYAML, hlINI: hlINI, hlJinja: hlJinja, hlDocker: hlDocker, hlPy: hlPy,
    parseYAML: parseYAML, yamlLine: lineOf
  };
})();
