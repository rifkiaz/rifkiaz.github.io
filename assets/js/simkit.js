// Shared pieces for the /terraform/ and /ansible/ simulators: a small code
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

  window.SimKit = {
    esc: esc, setHTML: setHTML, setText: setText, hex: hex,
    Editor: Editor, Term: Term, Missions: Missions,
    pulse: pulse, flash: flash, makeToast: makeToast,
    hlHCL: hlHCL, hlYAML: hlYAML, hlINI: hlINI, hlJinja: hlJinja
  };
})();
