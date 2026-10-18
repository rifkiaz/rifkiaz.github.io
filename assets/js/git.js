// Git simulator for /git/. One laptop repo (~/proyek-web) with a working
// tree, an index and a commit graph, plus a pretend GitHub remote that a
// teammate (Dina) pushes to as well. Merges are real three-way line merges
// with conflict markers; rebase, cherry-pick, revert and stash pop share the
// same machinery. A small shell runs git plus ls/cat/echo/sed, with &&, ;,
// pipes into head/grep/wc and > / >> redirects. Nothing is stored.
(function () {
  'use strict';

  var K = window.SimKit;
  var app = document.getElementById('gt');
  if (!app || !K) return;
  var esc = K.esc, setHTML = K.setHTML, setText = K.setText, pad = K.pad;
  function $(id) { return document.getElementById(id); }

  var HOME = '/home/kamu', DIR = HOME + '/proyek-web';
  var URL_OK = 'https://github.com/kamu/proyek-web.git';
  var URLS = [URL_OK, 'https://github.com/kamu/proyek-web', 'git@github.com:kamu/proyek-web.git'];
  var VERSION = '2.47.1';
  var DINA = { name: 'Dina', email: 'dina@contoh.id' };

  var MISSIONS = [
    { id: 'init', text: 'Bikin repo pakai <i>git init</i>, isi identitas lewat <i>git config</i>, lalu bikin <b>commit pertama</b>.' },
    { id: 'stage', text: 'Ubah file, intip bedanya pakai <i>git diff</i> dan <i>git diff --staged</i>, lalu commit.' },
    { id: 'branch', text: 'Bikin <b>branch baru</b>, commit di sana, lalu balik ke <b>main</b>.' },
    { id: 'merge', text: 'Gabungkan branch itu ke main pakai <i>git merge</i>.' },
    { id: 'conflict', text: 'Ubah baris yang sama di dua branch, merge, lalu <b>selesaikan konfliknya</b>.' },
    { id: 'push', text: 'Sambungkan ke <b>origin</b> pakai <i>git remote add</i>, lalu <i>git push -u origin main</i>.' },
    { id: 'pull', text: 'Dina push duluan, jadi push kamu <b>ditolak</b>. Tarik dulu pakai <i>git pull</i>, lalu push lagi.' },
    { id: 'stash', text: 'Simpan kerjaan setengah jadi pakai <i>git stash</i>, pindah branch, balik lagi, lalu <i>git stash pop</i>.' },
    { id: 'undo', text: 'Buang commit pakai <i>git reset --hard</i>, lalu <b>selamatkan lagi</b> lewat <i>git reflog</i>.' },
    { id: 'rebase', text: 'Rapikan riwayat: jalankan <i>git rebase main</i> di branch fitur supaya garisnya lurus.' }
  ];

  var START = {
    'index.html': [
      '<!doctype html>',
      '<html lang="id">',
      '<head>',
      '  <meta charset="utf-8">',
      '  <title>Proyek Web</title>',
      '  <link rel="stylesheet" href="style.css">',
      '</head>',
      '<body>',
      '  <h1>Halo, dunia!</h1>',
      '  <p>Ini halaman pertama saya.</p>',
      '</body>',
      '</html>',
      ''
    ].join('\n'),
    'style.css': [
      'body {',
      '  font-family: sans-serif;',
      '  color: #222;',
      '}',
      '',
      'h1 {',
      '  color: teal;',
      '}',
      ''
    ].join('\n'),
    'README.md': [
      '# Proyek Web',
      '',
      'Situs kecil buat latihan Git.',
      ''
    ].join('\n')
  };
  var TENTANG = [
    '<!doctype html>',
    '<html lang="id">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <title>Tentang</title>',
    '</head>',
    '<body>',
    '  <h1>Tentang kami</h1>',
    '  <p>Dibuat bareng Dina.</p>',
    '</body>',
    '</html>',
    ''
  ].join('\n');

  // ---------- small helpers ----------
  function copy(o) { return Object.assign({}, o); }
  function keys(o) { return Object.keys(o).sort(); }
  function union() {
    var s = {};
    for (var i = 0; i < arguments.length; i++) Object.keys(arguments[i] || {}).forEach(function (k) { s[k] = true; });
    return keys(s);
  }
  function sameTree(a, b) { return union(a, b).every(function (p) { return a[p] === b[p]; }); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function short(id) { return id ? id.slice(0, 7) : ''; }
  function subject(id) { return C[id].msg.split('\n')[0]; }
  function lines(s) {
    if (s === undefined || s === '') return [];
    var a = s.split('\n');
    if (a[a.length - 1] === '') a.pop();
    return a;
  }
  function join(a) { return a.length ? a.join('\n') + '\n' : ''; }
  var MARK = /^(<{7}|={7}|>{7})( |$)/m;

  // ---------- world ----------
  var C, W, clock = 0;
  function now() { var t = Date.now(); clock = Math.max(t, clock + 1000); return clock; }
  function mkCommit(tree, parents, msg, author, time) {
    var t = time || now();
    var id = K.digest(msg + parents.join(',') + t + Math.random()).slice(0, 40);
    C[id] = { id: id, tree: copy(tree), parents: parents.slice(), msg: msg, author: { name: author.name, email: author.email }, time: t };
    return id;
  }
  function initWorld() {
    C = {};
    if (W && W.dinaTimer) clearTimeout(W.dinaTimer);
    W = {
      files: copy(START), repo: null,
      gcfg: { 'init.defaultbranch': 'main' },
      server: { branches: {}, tags: {} },
      tab: 'graf', sel: 'index.html',
      saw: {}, flags: {}, dinaN: 0, dinaTimer: null
    };
  }
  function newRepo() {
    return {
      index: {}, unmerged: {}, have: {}, branches: {}, tags: {}, head: { ref: cfg('init.defaultbranch') || 'master' },
      reflog: [], cfg: {}, remotes: {}, rtrack: {}, upstream: {}, stash: [], op: null, prev: null
    };
  }
  function cfg(k) {
    k = k.toLowerCase();
    if (W.repo && Object.prototype.hasOwnProperty.call(W.repo.cfg, k)) return W.repo.cfg[k];
    return W.gcfg[k];
  }
  function ident() { var n = cfg('user.name'), e = cfg('user.email'); return n && e ? { name: n, email: e } : null; }
  function headId() { var r = W.repo; return r.head.ref ? r.branches[r.head.ref] : r.head.id; }
  function treeOf(id) { return id ? C[id].tree : {}; }
  function headTree() { return treeOf(headId()); }

  function ancestors(id) {
    var seen = {}, st = id ? [id] : [];
    while (st.length) {
      var c = st.pop();
      if (seen[c]) continue;
      seen[c] = true;
      C[c].parents.forEach(function (p) { st.push(p); });
    }
    return seen;
  }
  function isAnc(a, b) { return !!(a && b && ancestors(b)[a]); }
  function mergeBase(a, b) {
    var A = ancestors(a), best = null;
    Object.keys(ancestors(b)).forEach(function (c) { if (A[c] && (!best || C[c].time > C[best].time)) best = c; });
    return best;
  }
  // commits reachable from `to` but not from `from`, oldest first
  function range(from, to) {
    var A = ancestors(from);
    return Object.keys(ancestors(to)).filter(function (c) { return !A[c]; }).sort(function (x, y) { return C[x].time - C[y].time; });
  }
  function markHave(id) { Object.keys(ancestors(id)).forEach(function (c) { W.repo.have[c] = true; }); }
  function localTips() {
    var r = W.repo, t = [];
    Object.keys(r.branches).forEach(function (b) { t.push(r.branches[b]); });
    Object.keys(r.tags).forEach(function (b) { t.push(r.tags[b].id); });
    Object.keys(r.rtrack).forEach(function (b) { t.push(r.rtrack[b]); });
    r.stash.forEach(function (s) { t.push(s.base); });
    if (headId()) t.push(headId());
    return t;
  }
  // "lost" = no local branch, tag or HEAD reaches it (origin/* may still do)
  function isLost(id) {
    var r = W.repo, t = [headId()];
    Object.keys(r.branches).forEach(function (b) { t.push(r.branches[b]); });
    Object.keys(r.tags).forEach(function (b) { t.push(r.tags[b].id); });
    return !t.some(function (x) { return isAnc(id, x); });
  }

  // HEAD~2, main^, HEAD@{1}, v1.0, origin/main, a1b2c3d
  function resolve(rev) {
    var r = W.repo;
    if (!rev) return null;
    var m = /^(.*?)((?:[~^]\d*)*)$/.exec(rev), base = m[1], suf = m[2], id = null;
    var rl = /^(?:HEAD)?@\{(\d+)\}$/.exec(base);
    if (rl) { var e = r.reflog[r.reflog.length - 1 - +rl[1]]; id = e ? e.id : null; }
    else if (base === 'HEAD' || base === '@') id = headId();
    else if (r.branches[base.replace(/^refs\/heads\//, '')]) id = r.branches[base.replace(/^refs\/heads\//, '')];
    else if (r.tags[base.replace(/^refs\/tags\//, '')]) id = r.tags[base.replace(/^refs\/tags\//, '')].id;
    else if (r.rtrack[base.replace(/^(refs\/)?remotes\//, '')]) id = r.rtrack[base.replace(/^(refs\/)?remotes\//, '')];
    else if (/^[0-9a-f]{4,40}$/.test(base)) {
      var hits = Object.keys(r.have).filter(function (c) { return c.indexOf(base) === 0; });
      if (hits.length === 1) id = hits[0];
    }
    if (!id) return null;
    var re = /([~^])(\d*)/g, s;
    while ((s = re.exec(suf))) {
      var n = s[2] === '' ? 1 : +s[2];
      if (s[1] === '~') { for (var i = 0; i < n; i++) { id = C[id].parents[0]; if (!id) return null; } }
      else if (n) { id = C[id].parents[n - 1]; if (!id) return null; }
    }
    return id;
  }

  // ---------- .gitignore ----------
  function ignored(p) {
    var gi = W.files['.gitignore'];
    if (!gi) return false;
    return lines(gi).some(function (l) {
      l = l.trim();
      if (!l || l[0] === '#') return false;
      if (l[l.length - 1] === '/') return p.indexOf(l) === 0;
      var re = new RegExp('^' + l.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '.') + '$');
      return re.test(p) || re.test(p.split('/').pop());
    });
  }

  // ---------- status ----------
  function changes() {
    var r = W.repo, H = headTree(), I = r.index, F = W.files;
    var o = { staged: [], unstaged: [], untracked: [], unmerged: keys(r.unmerged) };
    union(H, I).forEach(function (p) {
      if (r.unmerged[p] || I[p] === H[p]) return;
      o.staged.push({ p: p, k: H[p] === undefined ? 'new file' : I[p] === undefined ? 'deleted' : 'modified' });
    });
    keys(I).forEach(function (p) {
      if (r.unmerged[p]) return;
      if (F[p] === undefined) o.unstaged.push({ p: p, k: 'deleted' });
      else if (F[p] !== I[p]) o.unstaged.push({ p: p, k: 'modified' });
    });
    keys(F).forEach(function (p) { if (I[p] === undefined && !r.unmerged[p] && !ignored(p)) o.untracked.push(p); });
    return o;
  }
  function dirtySet() {
    var r = W.repo, H = headTree(), I = r.index, F = W.files, d = {};
    union(H, I).forEach(function (p) { if (I[p] !== H[p] || (I[p] !== undefined && F[p] !== I[p])) d[p] = true; });
    keys(r.unmerged).forEach(function (p) { d[p] = true; });
    return d;
  }
  function isDirty() { return Object.keys(dirtySet()).length > 0; }

  // move the index and working tree from HEAD's tree to `target`, keeping
  // local edits that don't collide, like git checkout does
  function overwriteCheck(target, extra) {
    var r = W.repo, H = headTree(), d = dirtySet(), bad = [], untr = [];
    union(H, target).forEach(function (p) {
      if (H[p] === target[p] && !(extra && extra[p])) return;
      if (d[p]) bad.push(p);
      else if (r.index[p] === undefined && W.files[p] !== undefined && W.files[p] !== target[p]) untr.push(p);
    });
    if (bad.length) return { kind: 'local', files: bad };
    if (untr.length) return { kind: 'untracked', files: untr };
    return null;
  }
  function switchTree(target) {
    var e = overwriteCheck(target);
    if (e) return e;
    var r = W.repo, H = headTree();
    union(H, target).forEach(function (p) {
      if (H[p] === target[p]) return;
      if (target[p] === undefined) { delete r.index[p]; delete W.files[p]; }
      else { r.index[p] = target[p]; W.files[p] = target[p]; }
    });
    return null;
  }
  function hardReset(T) {
    var r = W.repo, H = headTree();
    union(r.index, H, r.unmerged, T).forEach(function (p) {
      if (T[p] === undefined) { delete r.index[p]; delete W.files[p]; }
      else { r.index[p] = T[p]; W.files[p] = T[p]; }
    });
    r.unmerged = {};
  }
  function overwriteErr(e, op) {
    var verb = op === 'checkout' ? 'switch branches' : op;
    if (e.kind === 'local') err('error: Your local changes to the following files would be overwritten by ' + op + ':\n' + e.files.map(function (f) { return '\t' + f; }).join('\n') + '\nPlease commit your changes or stash them before you ' + verb + '.\nAborting');
    else err('error: The following untracked working tree files would be overwritten by ' + op + ':\n' + e.files.map(function (f) { return '\t' + f; }).join('\n') + '\nPlease move or remove them before you ' + verb + '.\nAborting');
    hint('Ada perubahan yang belum di-commit di file itu. Commit dulu, atau simpan sementara pakai git stash.');
  }
  function logRef(id, msg) { W.repo.reflog.push({ id: id, msg: msg }); }
  function setHead(id, msg) {
    var r = W.repo;
    if (r.head.ref) r.branches[r.head.ref] = id; else r.head.id = id;
    markHave(id);
    logRef(id, msg);
  }

  // ---------- diff ----------
  function lcs(a, b) {
    var n = a.length, m = b.length, dp = [], i, j;
    for (i = 0; i <= n; i++) { dp[i] = new Array(m + 1); dp[i][m] = 0; }
    for (j = 0; j <= m; j++) dp[n][j] = 0;
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    var out = [];
    i = 0; j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { out.push([i, j]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    return out;
  }
  function ops(a, b) {
    var out = [], i = 0, j = 0;
    lcs(a, b).concat([[a.length, b.length]]).forEach(function (pr) {
      while (i < pr[0]) out.push(['-', a[i++]]);
      while (j < pr[1]) out.push(['+', b[j++]]);
      if (pr[0] < a.length) { out.push([' ', a[i]]); i++; j++; }
    });
    return out;
  }
  function hunks(a, b) {
    var o = ops(a, b), idx = [], res = [], CTX = 3;
    o.forEach(function (x, k) { if (x[0] !== ' ') idx.push(k); });
    if (!idx.length) return res;
    var oa = [], ob = [], la = 1, lb = 1;
    o.forEach(function (x, k) { oa[k] = la; ob[k] = lb; if (x[0] !== '+') la++; if (x[0] !== '-') lb++; });
    var groups = [], s = idx[0], e = idx[0];
    idx.slice(1).forEach(function (k) { if (k - e <= CTX * 2) e = k; else { groups.push([s, e]); s = e = k; } });
    groups.push([s, e]);
    groups.forEach(function (g) {
      var from = Math.max(0, g[0] - CTX), to = Math.min(o.length - 1, g[1] + CTX), seg = o.slice(from, to + 1);
      var na = seg.filter(function (x) { return x[0] !== '+'; }).length, nb = seg.filter(function (x) { return x[0] !== '-'; }).length;
      var sa = na ? oa[from] : oa[from] - 1, sb = nb ? ob[from] : ob[from] - 1;
      res.push({ head: '@@ -' + sa + (na === 1 ? '' : ',' + na) + ' +' + sb + (nb === 1 ? '' : ',' + nb) + ' @@', ops: seg });
    });
    return res;
  }
  function blob(s) { return s === undefined ? '0000000' : K.digest('blob ' + s).slice(0, 7); }
  function fileDiff(p, a, b) {
    var h = [], B = function (t) { return '<b>' + esc(t) + '</b>'; };
    h.push(B('diff --git a/' + p + ' b/' + p));
    if (a === undefined) h.push(B('new file mode 100644'));
    if (b === undefined) h.push(B('deleted file mode 100644'));
    h.push(B('index ' + blob(a) + '..' + blob(b) + (a !== undefined && b !== undefined ? ' 100644' : '')));
    h.push(B('--- ' + (a === undefined ? '/dev/null' : 'a/' + p)));
    h.push(B('+++ ' + (b === undefined ? '/dev/null' : 'b/' + p)));
    hunks(lines(a), lines(b)).forEach(function (x) {
      h.push('<span class="gt-hh">' + esc(x.head) + '</span>');
      x.ops.forEach(function (o) {
        if (o[0] === ' ') h.push(esc(' ' + o[1]));
        else h.push('<span class="' + (o[0] === '+' ? 'sx-add' : 'sx-del') + '">' + esc(o[0] + o[1]) + '</span>');
      });
    });
    return h.join('\n');
  }
  function treeDiff(A, B, only) {
    return union(A, B).filter(function (p) { return A[p] !== B[p] && (!only || only.indexOf(p) >= 0); }).map(function (p) { return fileDiff(p, A[p], B[p]); }).join('\n');
  }
  function stat(A, B) {
    var o = { files: [], ins: 0, del: 0 };
    union(A, B).forEach(function (p) {
      if (A[p] === B[p]) return;
      var x = ops(lines(A[p]), lines(B[p])), i = 0, d = 0;
      x.forEach(function (y) { if (y[0] === '+') i++; if (y[0] === '-') d++; });
      o.files.push({ p: p, ins: i, del: d, mode: A[p] === undefined ? 'create' : B[p] === undefined ? 'delete' : '' });
      o.ins += i; o.del += d;
    });
    return o;
  }
  function summary(st) {
    var n = st.files.length;
    return ' ' + plural(n, 'file') + ' changed' +
      (st.ins || !st.del ? ', ' + st.ins + ' insertion' + (st.ins === 1 ? '' : 's') + '(+)' : '') +
      (st.del ? ', ' + st.del + ' deletion' + (st.del === 1 ? '' : 's') + '(-)' : '');
  }
  function statBlock(st) {
    var w = 0;
    st.files.forEach(function (f) { w = Math.max(w, f.p.length); });
    var h = st.files.map(function (f) {
      var n = f.ins + f.del, bar = new Array(Math.min(f.ins, 30) + 1).join('+') + new Array(Math.min(f.del, 30) + 1).join('-');
      return ' ' + esc(pad(f.p, w)) + ' | ' + (n < 10 ? ' ' : '') + n + ' <span class="sx-add">' + bar.replace(/-+/, '') + '</span><span class="sx-del">' + (bar.match(/-+/) || [''])[0] + '</span>';
    });
    h.push(esc(summary(st)));
    st.files.forEach(function (f) { if (f.mode) h.push(esc(' ' + f.mode + ' mode 100644 ' + f.p)); });
    return h.join('\n');
  }

  // ---------- three-way merge ----------
  function merge3(base, ours, theirs, lo, lt) {
    var B = lines(base), O = lines(ours), T = lines(theirs);
    var mo = [], mt = [];
    B.forEach(function (x, i) { mo[i] = -1; mt[i] = -1; });
    lcs(B, O).forEach(function (p) { mo[p[0]] = p[1]; });
    lcs(B, T).forEach(function (p) { mt[p[0]] = p[1]; });
    var out = [], conflict = false, bi = 0, oi = 0, ti = 0;
    function eq(a, b) { return a.length === b.length && a.every(function (x, i) { return x === b[i]; }); }
    function chunk(bE, oE, tE) {
      var b = B.slice(bi, bE), o = O.slice(oi, oE), t = T.slice(ti, tE);
      if (eq(o, b)) out.push.apply(out, t);
      else if (eq(t, b) || eq(o, t)) out.push.apply(out, o);
      else {
        conflict = true;
        out.push('<<<<<<< ' + lo);
        out.push.apply(out, o);
        out.push('=======');
        out.push.apply(out, t);
        out.push('>>>>>>> ' + lt);
      }
    }
    for (var i = 0; i < B.length; i++) {
      if (mo[i] < 0 || mt[i] < 0) continue;
      chunk(i, mo[i], mt[i]);
      out.push(B[i]);
      bi = i + 1; oi = mo[i] + 1; ti = mt[i] + 1;
    }
    chunk(B.length, O.length, T.length);
    return { text: join(out), conflict: conflict };
  }
  function mergeTrees(BT, OT, TT, lo, lt) {
    var tree = {}, conflicts = [];
    union(BT, OT, TT).forEach(function (p) {
      var b = BT[p], o = OT[p], t = TT[p], v;
      if (o === t) v = o;
      else if (o === b) v = t;
      else if (t === b) v = o;
      else if (o === undefined || t === undefined) {
        v = o === undefined ? t : o;
        conflicts.push({ p: p, kind: 'modify/delete', base: b, ours: o, theirs: t, side: o === undefined ? 'HEAD' : lt });
      } else {
        var m = merge3(b, o, t, lo, lt);
        v = m.text;
        if (m.conflict) conflicts.push({ p: p, kind: b === undefined ? 'add/add' : 'content', base: b, ours: o, theirs: t });
        else if (b !== undefined) conflicts.auto = (conflicts.auto || []).concat(p);
      }
      if (v !== undefined) tree[p] = v;
      if (o !== undefined && t !== undefined && o !== b && t !== b && o !== t) (conflicts.touched = conflicts.touched || []).push(p);
    });
    return { tree: tree, conflicts: conflicts };
  }
  function applyResult(res) {
    var r = W.repo, H = headTree();
    union(H, res.tree, r.index).forEach(function (p) {
      var c = res.conflicts.filter(function (x) { return x.p === p; })[0];
      if (c) {
        r.unmerged[p] = c;
        W.files[p] = res.tree[p];
        if (H[p] === undefined) delete r.index[p]; else r.index[p] = H[p];
        return;
      }
      if (res.tree[p] === H[p]) return;
      if (res.tree[p] === undefined) { delete r.index[p]; delete W.files[p]; }
      else { r.index[p] = res.tree[p]; W.files[p] = res.tree[p]; }
    });
  }
  function conflictLines(res, theirLabel) {
    var h = [];
    (res.conflicts.touched || []).forEach(function (p) { h.push('Auto-merging ' + p); });
    res.conflicts.forEach(function (c) {
      if (c.kind === 'modify/delete') h.push('CONFLICT (modify/delete): ' + c.p + ' deleted in ' + (c.ours === undefined ? 'HEAD' : theirLabel) + ' and modified in ' + (c.ours === undefined ? theirLabel : 'HEAD') + '. Version ' + (c.ours === undefined ? theirLabel : 'HEAD') + ' of ' + c.p + ' left in tree.');
      else h.push('CONFLICT (' + c.kind + '): Merge conflict in ' + c.p);
    });
    return h;
  }
  function changedPaths(T) {
    var H = headTree(), x = {};
    union(H, T).forEach(function (p) { if (H[p] !== T[p]) x[p] = true; });
    return x;
  }

  // ---------- terminal output ----------
  var term = new K.Term($('gt-out'), $('gt-in'), { onCmd: onCmd });
  var toast = K.makeToast($('gt-toast'));
  var M = new K.Missions($('gt-m-list'), $('gt-m-count'), MISSIONS, toast, '🌳 Semua misi Git beres. Kamu siap kerja bareng tim!');
  var CAP = null, NONL = false;
  function toText(h) { var d = document.createElement('div'); d.innerHTML = h; return d.textContent; }
  function html(h, cls) { if (CAP) { CAP.push(toText(h)); return; } term.line(h, cls); }
  function out(t) { html(esc(t)); }
  function err(t) { term.line('<span class="sx-err">' + esc(t) + '</span>'); }
  function hint(t) { term.line('<span class="sx-warn">' + esc(t) + '</span>'); }
  function dim(t) { term.line('<span class="sx-dim">' + esc(t) + '</span>'); }
  function green(t) { return '<span class="sx-ok">' + esc(t) + '</span>'; }
  function red(t) { return '<span class="sx-del">' + esc(t) + '</span>'; }
  function yel(t) { return '<span class="gt-y">' + esc(t) + '</span>'; }
  function needRepo() {
    if (W.repo) return true;
    err('fatal: not a git repository (or any of the parent directories): .git');
    hint('Folder ini belum jadi repo Git. Mulai dengan git init.');
    return false;
  }
  function branchLabel() {
    var r = W.repo;
    if (!r) return '';
    var b = r.head.ref || short(headId()) + '...';
    if (r.op) b += '|' + (r.op.kind === 'rebase' ? 'REBASE ' + Math.min(r.op.done, r.op.total) + '/' + r.op.total : r.op.kind === 'merge' ? 'MERGING' : r.op.kind === 'pick' ? 'CHERRY-PICKING' : 'REVERTING');
    return b;
  }
  function prompt() { return 'kamu@laptop:~/proyek-web' + (W.repo ? ' (' + branchLabel() + ')' : '') + '$'; }

  // ---------- args ----------
  function parse(a, valFlags) {
    var f = {}, v = {}, rest = [], paths = [], dd = false;
    valFlags = valFlags || [];
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (dd) { paths.push(x); continue; }
      if (x === '--') { dd = true; f['--'] = true; continue; }
      var eqm = /^(--[\w-]+)=(.*)$/.exec(x);
      if (eqm) { f[eqm[1]] = true; (v[eqm[1]] = v[eqm[1]] || []).push(eqm[2]); continue; }
      if (/^--[\w-]+$/.test(x)) { f[x] = true; if (valFlags.indexOf(x) >= 0) (v[x] = v[x] || []).push(a[++i]); continue; }
      if (/^-\d+$/.test(x)) { f['-n'] = true; (v['-n'] = v['-n'] || []).push(x.slice(1)); continue; }
      if (/^-[A-Za-z]+$/.test(x)) {
        for (var j = 1; j < x.length; j++) {
          var k = '-' + x[j];
          f[k] = true;
          if (valFlags.indexOf(k) >= 0) { (v[k] = v[k] || []).push(x.slice(j + 1) || a[++i]); break; }
        }
        continue;
      }
      rest.push(x);
    }
    return { f: f, v: v, rest: rest, paths: paths };
  }
  function val(P, k) { var x = P.v[k]; return x ? x[x.length - 1] : undefined; }

  // ---------- git: setup ----------
  function gInit() {
    if (W.repo) { out('Reinitialized existing Git repository in ' + DIR + '/.git/'); return true; }
    W.repo = newRepo();
    out('Initialized empty Git repository in ' + DIR + '/.git/');
    if (!W.gcfg['init.defaultbranch']) hint('hint: Using \'master\' as the name for the initial branch.');
    K.flash(app, 'repo');
    return true;
  }
  function gConfig(a) {
    var P = parse(a, []), g = P.f['--global'], list = P.f['--list'] || P.f['-l'];
    if (!g && !W.repo && !list) { err('fatal: not in a git directory'); hint('Belum ada repo. Pakai git config --global, atau git init dulu.'); return false; }
    if (list) {
      var rows = [];
      Object.keys(W.gcfg).forEach(function (k) { if (!P.f['--local']) rows.push(k + '=' + W.gcfg[k]); });
      if (W.repo && !g) {
        rows.push('core.repositoryformatversion=0', 'core.filemode=true', 'core.bare=false');
        Object.keys(W.repo.cfg).forEach(function (k) { rows.push(k + '=' + W.repo.cfg[k]); });
        Object.keys(W.repo.remotes).forEach(function (n) { rows.push('remote.' + n + '.url=' + W.repo.remotes[n].url, 'remote.' + n + '.fetch=+refs/heads/*:refs/remotes/' + n + '/*'); });
        Object.keys(W.repo.upstream).forEach(function (b) { var u = W.repo.upstream[b].split('/'); rows.push('branch.' + b + '.remote=' + u[0], 'branch.' + b + '.merge=refs/heads/' + u.slice(1).join('/')); });
      }
      out(rows.join('\n'));
      return true;
    }
    var store = g ? W.gcfg : W.repo.cfg;
    if (P.f['--unset']) {
      var uk = (P.rest[0] || '').toLowerCase();
      if (!(uk in store)) return false;
      delete store[uk];
      return true;
    }
    if (P.f['--edit'] || P.f['-e']) { err('error: editor belum ada di simulasi ini'); hint('Set nilainya langsung, misal git config --global user.name "Kamu".'); return false; }
    var key = P.rest[0];
    if (!key) { out('usage: git config [<options>]\n\n    git config --global user.name "Nama Kamu"\n    git config --global user.email kamu@contoh.id\n    git config --list'); return false; }
    if (key.indexOf('.') < 0) { err('error: key does not contain a section: ' + key); return false; }
    key = key.toLowerCase();
    if (P.rest.length < 2) {
      var v = g ? W.gcfg[key] : cfg(key);
      if (v === undefined) return false;
      out(v);
      return true;
    }
    store[key] = P.rest.slice(1).join(' ');
    if (key === 'user.name' || key === 'user.email') K.flash(app, 'repo');
    return true;
  }

  // ---------- git: status ----------
  function trackInfo(b) {
    var r = W.repo, up = r.upstream[b];
    if (!up) return null;
    var u = r.rtrack[up], l = r.branches[b];
    if (!u) return { up: up, gone: true };
    return { up: up, ahead: range(u, l).length, behind: range(l, u).length };
  }
  function trackText(t) {
    if (!t) return '';
    if (t.gone) return 'Your branch is based on \'' + t.up + '\', but the upstream is gone.';
    if (!t.ahead && !t.behind) return 'Your branch is up to date with \'' + t.up + '\'.';
    if (t.ahead && !t.behind) return 'Your branch is ahead of \'' + t.up + '\' by ' + plural(t.ahead, 'commit') + '.\n  (use "git push" to publish your local commits)';
    if (!t.ahead) return 'Your branch is behind \'' + t.up + '\' by ' + plural(t.behind, 'commit') + ', and can be fast-forwarded.\n  (use "git pull" to update your local branch)';
    return 'Your branch and \'' + t.up + '\' have diverged,\nand have ' + t.ahead + ' and ' + t.behind + ' different commits each, respectively.\n  (use "git pull" if you want to integrate the remote branch with yours)';
  }
  function gStatus(a) {
    var r = W.repo, ch = changes(), P = parse(a, []);
    if (P.f['-s'] || P.f['--short']) {
      var rows = [], seen = {};
      if (P.f['-b'] || P.f['--branch']) {
        var t = r.head.ref ? trackInfo(r.head.ref) : null;
        rows.push('## ' + (r.head.ref ? (headId() ? r.head.ref : 'No commits yet on ' + r.head.ref) + (t && !t.gone ? '...' + t.up + (t.ahead || t.behind ? ' [' + [t.ahead ? 'ahead ' + t.ahead : '', t.behind ? 'behind ' + t.behind : ''].filter(Boolean).join(', ') + ']' : '') : '') : 'HEAD (no branch)'));
      }
      ch.unmerged.forEach(function (p) { rows.push(red('UU') + ' ' + esc(p)); seen[p] = 1; });
      var X = {}, Y = {};
      ch.staged.forEach(function (x) { X[x.p] = x.k === 'new file' ? 'A' : x.k[0].toUpperCase(); });
      ch.unstaged.forEach(function (x) { Y[x.p] = x.k[0].toUpperCase(); });
      union(X, Y).forEach(function (p) { rows.push(green(X[p] || ' ') + red(Y[p] || ' ') + ' ' + esc(p)); });
      ch.untracked.forEach(function (p) { rows.push(red('??') + ' ' + esc(p)); });
      if (rows.length) html(rows.join('\n'));
      return true;
    }
    var h = [];
    if (r.head.ref) h.push(esc('On branch ' + r.head.ref));
    else if (r.op && r.op.kind === 'rebase') h.push(red('interactive rebase in progress; onto ' + short(r.op.onto)));
    else h.push(red('HEAD detached at ' + short(headId())));
    if (r.op) {
      if (r.op.kind === 'rebase') {
        h.push(esc('You are currently rebasing branch \'' + r.op.branch + '\' on \'' + short(r.op.onto) + '\'.'));
        h.push(esc(ch.unmerged.length ? '  (fix conflicts and then run "git rebase --continue")\n  (use "git rebase --skip" to skip this patch)\n  (use "git rebase --abort" to check out the original branch)' : '  (all conflicts fixed: run "git rebase --continue")'));
      } else if (r.op.kind === 'merge') {
        h.push(esc(ch.unmerged.length ? 'You have unmerged paths.\n  (fix conflicts and run "git commit")\n  (use "git merge --abort" to abort the merge)' : 'All conflicts fixed but you are still merging.\n  (use "git commit" to conclude merge)'));
      } else {
        var nm = r.op.kind === 'pick' ? 'cherry-pick' : 'revert';
        h.push(esc('You are currently ' + (r.op.kind === 'pick' ? 'cherry-picking' : 'reverting') + ' commit ' + short(r.op.src) + '.\n' + (ch.unmerged.length ? '  (fix conflicts and run "git ' + nm + ' --continue")' : '  (all conflicts fixed: run "git ' + nm + ' --continue")') + '\n  (use "git ' + nm + ' --abort" to cancel the ' + nm + ' operation)'));
      }
    } else if (r.head.ref && trackInfo(r.head.ref)) h.push(esc(trackText(trackInfo(r.head.ref))));
    if (!headId()) h.push('', 'No commits yet');
    if (ch.staged.length) {
      h.push('', 'Changes to be committed:', esc(headId() ? '  (use "git restore --staged <file>..." to unstage)' : '  (use "git rm --cached <file>..." to unstage)'));
      ch.staged.forEach(function (x) { h.push(green('        ' + pad(x.k + ':', 12) + x.p)); });
    }
    if (ch.unmerged.length) {
      h.push('', 'Unmerged paths:', esc('  (use "git add <file>..." to mark resolution)'));
      ch.unmerged.forEach(function (p) {
        var c = r.unmerged[p];
        h.push(red('        ' + pad(c.kind === 'modify/delete' ? (c.ours === undefined ? 'deleted by us:' : 'deleted by them:') : c.kind === 'add/add' ? 'both added:' : 'both modified:', 17) + p));
      });
    }
    if (ch.unstaged.length) {
      h.push('', 'Changes not staged for commit:', esc('  (use "git add' + (ch.unstaged.some(function (x) { return x.k === 'deleted'; }) ? '/rm' : '') + ' <file>..." to update what will be committed)'), esc('  (use "git restore <file>..." to discard changes in working directory)'));
      ch.unstaged.forEach(function (x) { h.push(red('        ' + pad(x.k + ':', 12) + x.p)); });
    }
    if (ch.untracked.length) {
      h.push('', 'Untracked files:', esc('  (use "git add <file>..." to include in what will be committed)'));
      ch.untracked.forEach(function (p) { h.push(red('        ' + p)); });
    }
    if (!ch.staged.length && !ch.unmerged.length) {
      h.push('');
      if (ch.unstaged.length) h.push(esc('no changes added to commit (use "git add" and/or "git commit -a")'));
      else if (ch.untracked.length) h.push(esc(headId() ? 'nothing added to commit but untracked files present (use "git add" to track)' : 'nothing added to commit but untracked files present (use "git add" to track)'));
      else h.push(esc(headId() ? 'nothing to commit, working tree clean' : 'nothing to commit (create/copy files and use "git add" to track)'));
    }
    html(h.join('\n'));
    return true;
  }

  // ---------- git: add / rm / restore ----------
  function expand(specs, tracked) {
    var r = W.repo, all = union(W.files, r.index, r.unmerged), outp = [], miss = null;
    specs.forEach(function (s) {
      s = s.replace(/^\.\//, '');
      if (s === '.' || s === '*' || s === ':/') { all.forEach(function (p) { outp.push(p); }); return; }
      var re = /[*?]/.test(s) ? new RegExp('^' + s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$') : null;
      var hit = all.filter(function (p) { return re ? re.test(p) : p === s || p.indexOf(s.replace(/\/$/, '') + '/') === 0; });
      if (!hit.length && !miss) miss = s;
      hit.forEach(function (p) { outp.push(p); });
    });
    outp = outp.filter(function (p, i) { return outp.indexOf(p) === i; });
    if (tracked) outp = outp.filter(function (p) { return r.index[p] !== undefined || r.unmerged[p]; });
    return { paths: outp, miss: miss };
  }
  function stagePath(p) {
    var r = W.repo;
    if (W.files[p] === undefined) delete r.index[p];
    else r.index[p] = W.files[p];
    if (r.unmerged[p]) {
      delete r.unmerged[p];
      if (W.files[p] !== undefined && MARK.test(W.files[p])) hint('Hati-hati: ' + p + ' masih berisi penanda konflik (<<<<<<<, =======, >>>>>>>). Git tetap menerimanya, jadi pastikan memang sudah kamu rapikan.');
    }
  }
  function gAdd(a) {
    var r = W.repo, P = parse(a, []), specs = P.rest.concat(P.paths);
    if (P.f['-A'] || P.f['--all']) specs.push('.');
    if (P.f['-u'] || P.f['--update']) { union(r.index, r.unmerged).forEach(function (p) { stagePath(p); }); K.pulse(app, 'add'); return true; }
    if (!specs.length) { err('Nothing specified, nothing added.'); hint('hint: Maybe you wanted to say \'git add .\'?'); return false; }
    var x = expand(specs);
    if (x.miss) { err('fatal: pathspec \'' + x.miss + '\' did not match any files'); return false; }
    var ign = [];
    x.paths.forEach(function (p) {
      if (r.index[p] === undefined && !r.unmerged[p] && ignored(p)) {
        if (specs.indexOf(p) >= 0 && !P.f['-f'] && !P.f['--force']) ign.push(p);
        if (!P.f['-f'] && !P.f['--force']) return;
      }
      stagePath(p);
    });
    if (ign.length) { err('The following paths are ignored by one of your .gitignore files:\n' + ign.join('\n') + '\nhint: Use -f if you really want to add them.'); return false; }
    K.pulse(app, 'add');
    K.flash(app, 'stage');
    return true;
  }
  function gRm(a) {
    var r = W.repo, P = parse(a, []), x = expand(P.rest.concat(P.paths), true);
    if (!P.rest.length && !P.paths.length) { err('usage: git rm [<options>] [--] <file>...'); return false; }
    if (x.miss || !x.paths.length) { err('fatal: pathspec \'' + (x.miss || P.rest[0]) + '\' did not match any files'); return false; }
    x.paths.forEach(function (p) {
      delete r.index[p];
      delete r.unmerged[p];
      if (!P.f['--cached']) delete W.files[p];
      out('rm \'' + p + '\'');
    });
    return true;
  }
  function gRestore(a) {
    var r = W.repo, P = parse(a, ['--source', '-s']), specs = P.rest.concat(P.paths);
    if (!specs.length) { err('fatal: you must specify path(s) to restore'); return false; }
    var src = val(P, '--source') || val(P, '-s'), staged = P.f['--staged'] || P.f['-S'], wt = P.f['--worktree'] || P.f['-W'] || !staged;
    var T = null;
    if (src) { var id = resolve(src); if (!id) { err('fatal: could not resolve ' + src); return false; } T = C[id].tree; }
    if (P.f['--ours'] || P.f['--theirs']) return gCheckoutSide(P.f['--ours'] ? 'ours' : 'theirs', specs);
    var x = expand(specs);
    if (x.miss) { err('error: pathspec \'' + x.miss + '\' did not match any file(s) known to git'); return false; }
    var H = headTree();
    x.paths.forEach(function (p) {
      if (staged) {
        var v = (T || H)[p];
        if (v === undefined) delete r.index[p]; else r.index[p] = v;
      }
      if (wt) {
        if (r.unmerged[p] && !T) { err('error: path \'' + p + '\' is unmerged'); return; }
        var w = T ? T[p] : r.index[p];
        if (w === undefined) { if (T || r.index[p] !== undefined) delete W.files[p]; }
        else W.files[p] = w;
      }
    });
    return true;
  }
  function gCheckoutSide(side, specs) {
    var r = W.repo, okAny = false;
    specs.forEach(function (p) {
      var c = r.unmerged[p];
      if (!c) { err('error: path \'' + p + '\' does not have ' + (side === 'ours' ? 'our' : 'their') + ' version'); return; }
      // during a rebase, "ours" is the branch being rebased onto
      var v = c[side];
      if (v === undefined) { err('error: path \'' + p + '\' does not have ' + (side === 'ours' ? 'our' : 'their') + ' version'); return; }
      W.files[p] = v;
      okAny = true;
    });
    if (okAny) dim('# isi file diganti pakai versi ' + (side === 'ours' ? 'HEAD (ours)' : 'yang masuk (theirs)') + '. Konfliknya baru dianggap selesai setelah git add.');
    return okAny;
  }

  // ---------- git: commit ----------
  function noIdent() {
    err('Author identity unknown\n\n*** Please tell me who you are.\n\nRun\n\n  git config --global user.email "you@example.com"\n  git config --global user.name "Your Name"\n\nto set your account\'s default identity.\nOmit --global to set the identity only in this repository.\n\nfatal: unable to auto-detect email address (got \'kamu@laptop.(none)\')');
    hint('Git perlu tahu siapa pembuat commit. Isi user.name dan user.email dulu.');
  }
  function gCommit(a) {
    var r = W.repo, P = parse(a, ['-m', '--message', '-C']);
    var me = ident();
    if (!me) { noIdent(); return false; }
    if (Object.keys(r.unmerged).length) {
      err('error: Committing is not possible because you have unmerged files.\nhint: Fix them up in the work tree, and then use \'git add/rm <file>\'\nhint: as appropriate to mark resolution and make a commit.\nfatal: Exiting because of an unresolved conflict.');
      hint('Masih ada konflik di: ' + keys(r.unmerged).join(', ') + '. Rapikan filenya, lalu git add.');
      return false;
    }
    if ((P.v['-m'] || P.v['--message'] || []).some(function (m) { return m === undefined; })) { err('error: switch `m\' requires a value'); return false; }
    if (P.f['-a'] || P.f['--all']) union(r.index).forEach(function (p) { if (W.files[p] !== r.index[p]) stagePath(p); });
    if (P.rest.length) {
      var x = expand(P.rest, true);
      if (x.miss) { err('error: pathspec \'' + x.miss + '\' did not match any file(s) known to git'); return false; }
      x.paths.forEach(stagePath);
    }
    var msgs = (P.v['-m'] || []).concat(P.v['--message'] || []), msg = msgs.join('\n\n').trim();
    var amend = P.f['--amend'], h = headId(), op = r.op;
    if (amend && !h) { err('fatal: You have nothing to amend.'); return false; }
    if (!msg && amend) msg = C[h].msg;
    if (!msg && op && op.msg) msg = op.msg;
    if (!msg && op && op.kind === 'rebase' && op.cur) msg = C[op.cur].msg;
    if (!msg) {
      err('Aborting commit due to empty commit message.');
      hint('Di simulasi ini ga ada editor teks buat menulis pesan. Tulis langsung: git commit -m "pesan kamu"');
      return false;
    }
    var parents = amend ? C[h].parents : h ? [h] : [];
    if (op && op.kind === 'merge') parents = [h, op.theirs];
    var tree = copy(r.index), pt = amend ? treeOf(C[h].parents[0]) : treeOf(h);
    if (!amend && !(op && op.kind === 'merge') && !P.f['--allow-empty'] && sameTree(tree, pt)) {
      var ch = changes();
      if (op && op.kind === 'rebase') { op.cur = null; out('No changes'); hint('Commit ini jadi kosong. Lanjut pakai git rebase --continue.'); return true; }
      html(h ? esc('On branch ' + (r.head.ref || 'HEAD')) : 'No commits yet');
      if (ch.unstaged.length || ch.untracked.length) {
        ch.unstaged.forEach(function (y) { html(red('        ' + pad(y.k + ':', 12) + y.p)); });
        ch.untracked.forEach(function (p) { html(red('        ' + p) + '  (untracked)'); });
        err(ch.unstaged.length ? 'no changes added to commit (use "git add" and/or "git commit -a")' : 'nothing added to commit but untracked files present (use "git add" to track)');
        hint('Perubahan harus masuk staging dulu. Pakai git add <file>, atau git commit -am "pesan" buat file yang sudah dilacak.');
      } else err('nothing to commit, working tree clean');
      return false;
    }
    var author = amend ? C[h].author : (op && op.kind === 'rebase' && op.cur ? C[op.cur].author : op && op.kind === 'pick' ? C[op.src].author : me);
    var before = treeOf(h ? (amend ? C[h].parents[0] : h) : null);
    var id = mkCommit(tree, parents, msg, author);
    var kind = !h ? 'commit (initial)' : amend ? 'commit (amend)' : op && op.kind === 'merge' ? 'commit (merge)' : op && op.kind === 'pick' ? 'cherry-pick' : op && op.kind === 'revert' ? 'revert' : op && op.kind === 'rebase' ? 'rebase (continue)' : 'commit';
    var wasHead = r.head.ref;
    setHead(id, kind + ': ' + msg.split('\n')[0]);
    html(esc('[' + (wasHead || 'detached HEAD') + (h ? '' : ' (root-commit)') + ' ' + short(id) + '] ' + msg.split('\n')[0]));
    if (amend) out(' Date: ' + fmtDate(C[h].time));
    html(statBlock(stat(before, tree)).replace(/^.*\|.*\n/gm, ''));
    K.pulse(app, 'commit');
    K.flash(app, 'repo');
    if (op && op.kind !== 'rebase') finishOp(op);
    if (op && op.kind === 'rebase') { op.cur = null; if (op.conflict) op.resolved = true; }
    if (!h) M.hit('init');
    else if (W.saw.diff && W.saw.staged && !amend && !op) M.hit('stage');
    W.saw = {};
    return true;
  }
  function finishOp(op) {
    var r = W.repo;
    r.op = null;
    if (op.conflict && !hasMarkers(headTree())) M.hit('conflict');
  }
  function hasMarkers(T) { return Object.keys(T).some(function (p) { return MARK.test(T[p]); }); }

  // ---------- git: log / show / diff / reflog ----------
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function two(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDate(t) {
    var d = new Date(t), o = -d.getTimezoneOffset(), s = o < 0 ? '-' : '+';
    o = Math.abs(o);
    return DAYS[d.getDay()] + ' ' + MONS[d.getMonth()] + ' ' + d.getDate() + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()) + ' ' + d.getFullYear() + ' ' + s + two(Math.floor(o / 60)) + two(o % 60);
  }
  function decor(id, srv) {
    var r = W.repo, d = [];
    if (srv) {
      Object.keys(W.server.branches).sort().forEach(function (b) { if (W.server.branches[b] === id) d.push({ t: 'branch', n: b }); });
      Object.keys(W.server.tags).sort().forEach(function (t) { if (W.server.tags[t] === id) d.push({ t: 'tag', n: t }); });
      return d;
    }
    var h = headId(), hb = r.head.ref;
    if (id === h && hb) d.push({ t: 'head', n: hb });
    else if (id === h) d.push({ t: 'detached', n: 'HEAD' });
    Object.keys(r.tags).sort().forEach(function (t) { if (r.tags[t].id === id) d.push({ t: 'tag', n: t }); });
    Object.keys(r.rtrack).sort().forEach(function (b) { if (r.rtrack[b] === id) d.push({ t: 'remote', n: b }); });
    Object.keys(r.branches).sort().forEach(function (b) { if (r.branches[b] === id && !(b === hb && id === h)) d.push({ t: 'branch', n: b }); });
    return d;
  }
  function decorText(id) {
    var d = decor(id);
    if (!d.length) return '';
    return ' <span class="gt-y">(</span>' + d.map(function (x) {
      if (x.t === 'head') return '<span class="gt-hd">HEAD -&gt; </span><span class="sx-ok gt-bb">' + esc(x.n) + '</span>';
      if (x.t === 'detached') return '<span class="gt-hd">HEAD</span>';
      if (x.t === 'tag') return '<span class="gt-y gt-bb">tag: ' + esc(x.n) + '</span>';
      if (x.t === 'remote') return '<span class="sx-del gt-bb">' + esc(x.n) + '</span>';
      return '<span class="sx-ok gt-bb">' + esc(x.n) + '</span>';
    }).join('<span class="gt-y">, </span>') + '<span class="gt-y">)</span>';
  }
  function sortIds(set) { return Object.keys(set).sort(function (a, b) { return C[b].time - C[a].time; }); }
  function parentsIn(id, inSet) { return C[id] ? C[id].parents.filter(function (p) { return inSet[p]; }) : []; }

  // lane layout shared by the SVG graph and git log --graph
  function layout(ids, parentsOf) {
    var lanes = [], rows = [];
    ids.forEach(function (id) {
      var before = lanes.slice(), mine = [], k;
      lanes.forEach(function (x, i) { if (x === id) mine.push(i); });
      if (mine.length) k = mine[0];
      else {
        k = lanes.indexOf(null);
        if (k < 0) k = lanes.length;
        lanes[k] = id;
        before = lanes.slice();
        before[k] = null;
      }
      mine.slice(1).forEach(function (i) { lanes[i] = null; });
      var ps = parentsOf(id), edges = [];
      if (!ps.length) lanes[k] = null;
      ps.forEach(function (p, pi) {
        var j = lanes.indexOf(p);
        if (pi === 0) {
          if (j >= 0 && j !== k) { lanes[k] = null; edges.push({ p: p, lane: j }); }
          else { lanes[k] = p; edges.push({ p: p, lane: k }); }
        } else if (j >= 0) edges.push({ p: p, lane: j });
        else {
          var n = lanes.indexOf(null);
          if (n < 0) n = lanes.length;
          lanes[n] = p;
          edges.push({ p: p, lane: n, fresh: true });
        }
      });
      while (lanes.length && lanes[lanes.length - 1] == null) lanes.pop();
      rows.push({ id: id, lane: k, before: before, merged: mine.slice(1), edges: edges, after: lanes.slice() });
    });
    return rows;
  }
  function asciiGraph(rows) {
    var outRows = [];
    rows.forEach(function (row) {
      var w = Math.max(row.before.length, row.after.length, row.lane + 1), s, i;
      if (row.merged.length) {
        s = [];
        for (i = 0; i < w; i++) {
          if (row.merged.indexOf(i) >= 0) { if (i > row.lane) s[2 * i - 1] = '/'; else s[2 * i + 1] = '\\'; }
          else if (row.before[i] != null || i === row.lane) s[2 * i] = '|';
        }
        outRows.push({ pre: true, g: fill(s) });
      }
      s = [];
      for (i = 0; i < w; i++) {
        if (i === row.lane) s[2 * i] = '*';
        else if (row.before[i] != null && row.merged.indexOf(i) < 0) s[2 * i] = '|';
      }
      outRows.push({ id: row.id, g: fill(s) });
      var fresh = row.edges.filter(function (e) { return e.fresh || e.lane !== row.lane; });
      if (fresh.length) {
        s = [];
        for (i = 0; i < Math.max(row.after.length, row.lane + 1); i++) if (row.after[i] != null && !fresh.some(function (e) { return e.fresh && e.lane === i; })) s[2 * i] = '|';
        if (row.after[row.lane] == null && row.edges.length && row.edges[0].lane !== row.lane) s[2 * row.lane] = s[2 * row.lane] || ' ';
        fresh.forEach(function (e) {
          if (e.lane > row.lane) s[2 * e.lane - 1] = '\\';
          else if (e.lane < row.lane) s[2 * e.lane + 1] = '/';
        });
        if (row.after[row.lane] != null) s[2 * row.lane] = '|';
        outRows.push({ pre: true, g: fill(s) });
      }
    });
    return outRows;
    function fill(s) { var t = ''; for (var j = 0; j < s.length; j++) t += s[j] || ' '; return t.replace(/\s+$/, ''); }
  }
  function gLog(a) {
    var r = W.repo, P = parse(a, ['-n', '--max-count', '--format', '--pretty', '--author', '--grep']);
    var max = +(val(P, '-n') || val(P, '--max-count') || 0);
    var oneline = P.f['--oneline'] || val(P, '--pretty') === 'oneline' || val(P, '--format') === 'oneline';
    var set = {}, starts = [], excl = {};
    var revs = P.rest.slice();
    if (P.f['--all']) starts = localTips();
    revs.forEach(function (x) {
      var m = /^(.*)\.\.(.*)$/.exec(x);
      if (m) {
        var A = resolve(m[1] || 'HEAD'), B = resolve(m[2] || 'HEAD');
        if (!A || !B) { starts = null; return; }
        Object.keys(ancestors(A)).forEach(function (c) { excl[c] = true; });
        starts.push(B);
        return;
      }
      var id = resolve(x);
      if (!id) {
        if (W.files[x] !== undefined || r.index[x] !== undefined) { P.paths.push(x); return; }
        starts = null;
        err('fatal: ambiguous argument \'' + x + '\': unknown revision or path not in the working tree.\nUse \'--\' to separate paths from revisions, like this:\n\'git <command> [<revision>...] -- [<file>...]\'');
        return;
      }
      starts && starts.push(id);
    });
    if (!starts) return false;
    if (!starts.length && !P.f['--all']) {
      if (!headId()) { err('fatal: your current branch \'' + r.head.ref + '\' does not have any commits yet'); return false; }
      starts.push(headId());
    }
    starts.forEach(function (s) { Object.keys(ancestors(s)).forEach(function (c) { if (!excl[c]) set[c] = true; }); });
    var ids = sortIds(set);
    if (P.paths.length) ids = ids.filter(function (id) { var pt = treeOf(C[id].parents[0]); return P.paths.some(function (p) { return C[id].tree[p] !== pt[p]; }); });
    var au = val(P, '--author'), gr = val(P, '--grep');
    if (au) ids = ids.filter(function (id) { return (C[id].author.name + ' ' + C[id].author.email).toLowerCase().indexOf(au.toLowerCase()) >= 0; });
    if (gr) ids = ids.filter(function (id) { return C[id].msg.toLowerCase().indexOf(gr.toLowerCase()) >= 0; });
    if (max) ids = ids.slice(0, max);
    if (!ids.length) return true;
    var inSet = {};
    ids.forEach(function (i) { inSet[i] = true; });
    var gl = P.f['--graph'] ? asciiGraph(layout(ids, function (id) { return parentsIn(id, inSet); })) : ids.map(function (id) { return { id: id, g: '' }; });
    var gw = 0;
    gl.forEach(function (x) { gw = Math.max(gw, x.g.length); });
    var h = [];
    gl.forEach(function (x, gi) {
      var g = P.f['--graph'] ? '<span class="gt-gr">' + esc(x.g + ' ') + '</span>' : '';
      if (x.pre) { h.push(g); return; }
      var c = C[x.id];
      if (oneline) { h.push(g + yel(short(x.id)) + decorText(x.id) + ' ' + esc(c.msg.split('\n')[0])); return; }
      // continuation prefix for the multi-line entry: the next graph row's lanes
      var nxt = gl[gi + 1], cont = P.f['--graph'] ? '<span class="gt-gr">' + esc(pad((nxt ? nxt.g : '').replace(/[*\\/]/g, '|').replace(/\|(?=[^|]*$)/, '|'), gw + 1)) + '</span>' : '';
      if (P.f['--graph'] && !nxt) cont = '<span class="gt-gr">' + esc(pad('', gw + 1)) + '</span>';
      h.push(g + yel('commit ' + x.id) + decorText(x.id));
      if (c.parents.length > 1) h.push(cont + esc('Merge: ' + c.parents.map(short).join(' ')));
      h.push(cont + esc('Author: ' + c.author.name + ' <' + c.author.email + '>'));
      h.push(cont + esc('Date:   ' + fmtDate(c.time)));
      h.push(cont);
      c.msg.split('\n').forEach(function (l) { h.push(cont + esc('    ' + l)); });
      if (gi < gl.length - 1) h.push(cont);
    });
    html(h.join('\n'), 'sx-tbl');
    return true;
  }
  function showCommit(id, P) {
    var c = C[id], h = [];
    h.push(yel('commit ' + id) + decorText(id));
    if (c.parents.length > 1) h.push(esc('Merge: ' + c.parents.map(short).join(' ')));
    h.push(esc('Author: ' + c.author.name + ' <' + c.author.email + '>'), esc('Date:   ' + fmtDate(c.time)), '');
    c.msg.split('\n').forEach(function (l) { h.push(esc('    ' + l)); });
    html(h.join('\n'));
    if (c.parents.length > 1) return;
    var A = treeOf(c.parents[0]);
    if (P && P.f['--stat']) { html('\n' + statBlock(stat(A, c.tree))); return; }
    var d = treeDiff(A, c.tree);
    if (d) html('\n' + d, 'gt-diff');
  }
  function gShow(a) {
    var P = parse(a, []), x = P.rest[0] || 'HEAD', m = /^(.*?):(.+)$/.exec(x);
    if (m) {
      var cid = resolve(m[1] || 'HEAD');
      if (!cid) { err('fatal: invalid object name \'' + m[1] + '\'.'); return false; }
      var v = C[cid].tree[m[2]];
      if (v === undefined) { err('fatal: path \'' + m[2] + '\' does not exist in \'' + m[1] + '\''); return false; }
      out(v.replace(/\n$/, ''));
      return true;
    }
    var id = resolve(x);
    if (!id) {
      if (x === 'HEAD') { err('fatal: your current branch \'' + W.repo.head.ref + '\' does not have any commits yet'); return false; }
      err('fatal: ambiguous argument \'' + x + '\': unknown revision or path not in the working tree.');
      return false;
    }
    showCommit(id, P);
    return true;
  }
  function gDiff(a) {
    var r = W.repo, P = parse(a, []), staged = P.f['--staged'] || P.f['--cached'];
    var revs = [], paths = P.paths.slice();
    P.rest.forEach(function (x) {
      var m = /^(.+?)\.\.\.?(.+)$/.exec(x);
      if (m) { revs.push(m[1], m[2]); return; }
      if (resolve(x)) revs.push(x); else paths.push(x);
    });
    var bad = paths.filter(function (p) { return W.files[p] === undefined && r.index[p] === undefined && headTree()[p] === undefined; })[0];
    if (bad) { err('fatal: ambiguous argument \'' + bad + '\': unknown revision or path not in the working tree.'); return false; }
    var A, B, only = paths.length ? paths : null;
    if (revs.length >= 2) { A = C[resolve(revs[0])].tree; B = C[resolve(revs[1])].tree; }
    else if (revs.length === 1) {
      A = C[resolve(revs[0])].tree;
      B = staged ? r.index : (function () { var t = {}; union(A, r.index).forEach(function (p) { if (r.index[p] !== undefined || A[p] !== undefined) { if (W.files[p] !== undefined) t[p] = W.files[p]; } }); return t; })();
    } else if (staged) { A = headTree(); B = r.index; }
    else {
      A = copy(r.index);
      B = {};
      union(r.index, r.unmerged).forEach(function (p) { if (W.files[p] !== undefined) B[p] = W.files[p]; });
      keys(r.unmerged).forEach(function (p) { if (A[p] === undefined) A[p] = r.unmerged[p].ours; });
    }
    if (P.f['--stat']) { var st = stat(A, B); if (st.files.length) html(statBlock(st)); return true; }
    if (P.f['--name-only']) { var nm = union(A, B).filter(function (p) { return A[p] !== B[p] && (!only || only.indexOf(p) >= 0); }); if (nm.length) out(nm.join('\n')); return true; }
    var d = treeDiff(A, B, only);
    if (d) {
      html(d, 'gt-diff');
      if (!revs.length) W.saw[staged ? 'staged' : 'diff'] = true;
    } else if (!revs.length && !staged && changes().untracked.length) hint('(kosong) git diff cuma membandingkan file yang sudah dilacak. File baru harus di-git add dulu, lalu cek pakai git diff --staged.');
    else if (!revs.length && !staged && changes().staged.length) hint('(kosong) Semua perubahan sudah di staging. Lihat pakai git diff --staged.');
    return true;
  }
  function gReflog(a) {
    var r = W.repo, P = parse(a, ['-n']), n = +(val(P, '-n') || 30);
    if (P.rest[0] === 'expire' || P.rest[0] === 'delete') { err('error: simulasi ini ga mendukung menghapus reflog'); return false; }
    if (!r.reflog.length) return true;
    W.saw.reflog = true;
    var h = [];
    for (var i = r.reflog.length - 1, j = 0; i >= 0 && j < n; i--, j++) {
      var e = r.reflog[i];
      h.push(yel(short(e.id)) + (j === 0 ? decorText(e.id) : '') + ' ' + esc('HEAD@{' + j + '}: ' + e.msg));
    }
    html(h.join('\n'));
    return true;
  }

  // ---------- git: branch / switch / checkout ----------
  function validName(n) { return /^[A-Za-z0-9._\/-]+$/.test(n) && !/^[-/.]|\/$|\.\.|\.lock$|\/\/|@\{/.test(n) && n !== 'HEAD'; }
  function gBranch(a) {
    var r = W.repo, P = parse(a, ['--set-upstream-to', '-u']);
    var cur = r.head.ref, h = headId();
    var up = val(P, '--set-upstream-to') || val(P, '-u');
    if (up) {
      var b0 = P.rest[0] || cur;
      if (!r.rtrack[up]) { err('error: the requested upstream branch \'' + up + '\' does not exist'); return false; }
      r.upstream[b0] = up;
      out('branch \'' + b0 + '\' set up to track \'' + up + '\'.');
      return true;
    }
    if (P.f['--unset-upstream']) { delete r.upstream[P.rest[0] || cur]; return true; }
    if (P.f['-d'] || P.f['-D'] || P.f['--delete']) {
      if (!P.rest.length) { err('fatal: branch name required'); return false; }
      var okAll = true;
      P.rest.forEach(function (n) {
        if (P.f['-r']) {
          if (!r.rtrack[n]) { err('error: remote-tracking branch \'' + n + '\' not found'); okAll = false; return; }
          out('Deleted remote-tracking branch ' + n + ' (was ' + short(r.rtrack[n]) + ').');
          delete r.rtrack[n];
          return;
        }
        var id = r.branches[n];
        if (!id) { err('error: branch \'' + n + '\' not found'); okAll = false; return; }
        if (n === cur) { err('error: cannot delete branch \'' + n + '\' used by worktree at \'' + DIR + '\''); okAll = false; return; }
        var upId = r.upstream[n] && r.rtrack[r.upstream[n]];
        if (!P.f['-D'] && !isAnc(id, h) && !(upId && isAnc(id, upId))) {
          err('error: the branch \'' + n + '\' is not fully merged.\nhint: If you are sure you want to delete it, run \'git branch -D ' + n + '\'');
          hint('Commit di branch itu belum masuk ke ' + (cur || 'HEAD') + '. Kalau dihapus paksa, commit-nya cuma bisa dicari lewat reflog.');
          okAll = false;
          return;
        }
        delete r.branches[n];
        delete r.upstream[n];
        out('Deleted branch ' + n + ' (was ' + short(id) + ').');
      });
      return okAll;
    }
    if (P.f['-m'] || P.f['-M']) {
      var from = P.rest.length > 1 ? P.rest[0] : cur, to = P.rest.length > 1 ? P.rest[1] : P.rest[0];
      if (!to) { err('fatal: branch name required'); return false; }
      if (!validName(to)) { err('fatal: \'' + to + '\' is not a valid branch name'); return false; }
      if (r.branches[to] && !P.f['-M']) { err('fatal: a branch named \'' + to + '\' already exists'); return false; }
      if (from === cur && !h) { r.head.ref = to; return true; }
      if (!r.branches[from]) { err('error: refname refs/heads/' + from + ' not found\nfatal: Branch rename failed'); return false; }
      r.branches[to] = r.branches[from];
      delete r.branches[from];
      if (r.upstream[from]) { r.upstream[to] = r.upstream[from]; delete r.upstream[from]; }
      if (cur === from) r.head.ref = to;
      return true;
    }
    if (P.rest.length && !P.f['-a'] && !P.f['-r'] && !P.f['--list'] && !P.f['-l']) {
      var name = P.rest[0], start = P.rest[1] || 'HEAD';
      if (!validName(name)) { err('fatal: \'' + name + '\' is not a valid branch name'); return false; }
      if (r.branches[name] && !P.f['-f']) { err('fatal: a branch named \'' + name + '\' already exists'); return false; }
      var sid = resolve(start);
      if (!sid) { err('fatal: not a valid object name: \'' + (start === 'HEAD' ? cur : start) + '\''); if (!h) hint('Branch baru butuh minimal satu commit. Commit dulu, baru bikin branch.'); return false; }
      var lost = isLost(sid);
      r.branches[name] = sid;
      markHave(sid);
      if (r.rtrack[start]) { r.upstream[name] = start; out('branch \'' + name + '\' set up to track \'' + start + '\'.'); }
      if (lost) rescued();
      return true;
    }
    var rows = [], v = P.f['-v'] || P.f['-vv'];
    var vv = a.indexOf('-vv') >= 0;
    var names = keys(r.branches);
    if (!P.f['-r']) {
      if (!cur || !r.branches[cur]) {
        if (!cur) rows.push({ cur: true, n: '(HEAD detached at ' + short(h) + ')', id: h });
      }
      names.forEach(function (n) { rows.push({ cur: n === cur, n: n, id: r.branches[n], local: true }); });
    }
    if (P.f['-a'] || P.f['-r']) keys(r.rtrack).forEach(function (n) { rows.push({ n: (P.f['-a'] ? 'remotes/' : '') + n, id: r.rtrack[n], remote: true }); });
    if (!rows.length) return true;
    var w = 0;
    rows.forEach(function (x) { w = Math.max(w, x.n.length); });
    html(rows.map(function (x) {
      var nm = x.cur ? green('* ' + (v ? pad(x.n, w) : x.n)) : x.remote ? '  ' + red(v ? pad(x.n, w) : x.n) : '  ' + esc(v ? pad(x.n, w) : x.n);
      if (!v || !x.id) return nm;
      var t = x.local ? trackInfo(x.n) : null, tr = '';
      if (t && vv) tr = '[<span class="gt-bl">' + esc(t.up) + '</span>' + (t.gone ? ': gone' : t.ahead || t.behind ? ': ' + [t.ahead ? 'ahead ' + t.ahead : '', t.behind ? 'behind ' + t.behind : ''].filter(Boolean).join(', ') : '') + '] ';
      else if (t && (t.ahead || t.behind)) tr = '[' + [t.ahead ? 'ahead ' + t.ahead : '', t.behind ? 'behind ' + t.behind : ''].filter(Boolean).join(', ') + '] ';
      return nm + ' ' + yel(short(x.id)) + ' ' + tr + esc(subject(x.id));
    }).join('\n'));
    return true;
  }
  function doSwitch(target, isBranch, label) {
    var r = W.repo, h = headId(), from = r.head.ref || h, id = isBranch ? r.branches[target] : target;
    if (Object.keys(r.unmerged).length) {
      err('error: you need to resolve your current index first\n' + keys(r.unmerged).map(function (p) { return p + ': needs merge'; }).join('\n'));
      return false;
    }
    if (r.op) { err('fatal: cannot switch branch while ' + (r.op.kind === 'rebase' ? 'rebasing' : r.op.kind === 'merge' ? 'merging' : r.op.kind === 'pick' ? 'cherry-picking' : 'reverting') + '\nConsider "git ' + (r.op.kind === 'pick' ? 'cherry-pick' : r.op.kind) + ' --abort" or "git worktree add".'); return false; }
    if (isBranch && target === r.head.ref) { out('Already on \'' + target + '\''); return true; }
    var lost = id && isLost(id);
    var e = switchTree(treeOf(id));
    if (e) { overwriteErr(e, 'checkout'); return false; }
    r.prev = r.head.ref || h;
    r.head = isBranch ? { ref: target } : { id: id };
    var ch = changes();
    ch.staged.concat(ch.unstaged).forEach(function (x) { out((x.k === 'deleted' ? 'D' : x.k === 'new file' ? 'A' : 'M') + '\t' + x.p); });
    if (isBranch) {
      out('Switched to branch \'' + target + '\'');
      var t = trackInfo(target);
      if (t) out(trackText(t));
    } else {
      out('Note: switching to \'' + (label || short(id)) + '\'.\n\nYou are in \'detached HEAD\' state. You can look around, make experimental\nchanges and commit them, and you can discard any commits you make in this\nstate without impacting any branches by switching back to a branch.\n\nIf you want to create a new branch to retain commits you create, you may\ndo so (now or later) by using -c with the switch command. Example:\n\n  git switch -c <new-branch-name>\n\nOr undo this operation with:\n\n  git switch -\n\nHEAD is now at ' + short(id) + ' ' + subject(id));
    }
    if (id) logRef(id, 'checkout: moving from ' + (typeof from === 'string' && from.length === 40 ? from : from) + ' to ' + (isBranch ? target : id));
    W.flags.stashSwitch = W.flags.stashSwitch === false ? true : W.flags.stashSwitch;
    if (isBranch && target === 'main' && typeof from === 'string' && r.branches[from] && from !== 'main' && range(r.branches.main, r.branches[from]).length) M.hit('branch');
    if (lost) rescued();
    return true;
  }
  function newBranchSwitch(name, start, force) {
    var r = W.repo;
    if (!validName(name)) { err('fatal: \'' + name + '\' is not a valid branch name'); return false; }
    if (r.branches[name] && !force) { err('fatal: a branch named \'' + name + '\' already exists'); return false; }
    if (!headId() && !start) {
      if (Object.keys(r.unmerged).length) return false;
      r.head = { ref: name };
      out('Switched to a new branch \'' + name + '\'');
      return true;
    }
    var id = resolve(start || 'HEAD');
    if (!id) { err('fatal: invalid reference: ' + start); return false; }
    if (r.op) { err('fatal: cannot switch branch while ' + r.op.kind + ' is in progress'); return false; }
    var lost = isLost(id);
    var e = switchTree(C[id].tree);
    if (e) { overwriteErr(e, 'checkout'); return false; }
    r.prev = r.head.ref || headId();
    r.branches[name] = id;
    r.head = { ref: name };
    markHave(id);
    if (start && r.rtrack[start]) { r.upstream[name] = start; out('branch \'' + name + '\' set up to track \'' + start + '\'.'); }
    out('Switched to a new branch \'' + name + '\'');
    logRef(id, 'checkout: moving from ' + r.prev + ' to ' + name);
    W.flags.stashSwitch = W.flags.stashSwitch === false ? true : W.flags.stashSwitch;
    if (lost) rescued();
    return true;
  }
  function switchByName(x, allowDetach) {
    var r = W.repo;
    if (x === '-') {
      if (!r.prev) { err('fatal: invalid reference: @{-1}'); return false; }
      x = r.prev;
      if (r.branches[x]) return doSwitch(x, true);
      return doSwitch(x, false);
    }
    if (r.branches[x]) return doSwitch(x, true);
    if (!r.branches[x] && r.rtrack['origin/' + x]) {
      var e = overwriteCheck(C[r.rtrack['origin/' + x]].tree);
      if (e) { overwriteErr(e, 'checkout'); return false; }
      r.branches[x] = r.rtrack['origin/' + x];
      r.upstream[x] = 'origin/' + x;
      out('branch \'' + x + '\' set up to track \'origin/' + x + '\'.');
      return doSwitch(x, true);
    }
    var id = resolve(x);
    if (id && allowDetach) return doSwitch(id, false, x);
    if (id) {
      err('fatal: a branch is expected, got ' + (r.rtrack[x] ? 'remote branch \'' + x + '\'' : r.tags[x] ? 'tag \'' + x + '\'' : 'commit \'' + x + '\''));
      hint('hint: If you want to detach HEAD at the commit, try again with the --detach option.');
      return false;
    }
    err('fatal: invalid reference: ' + x);
    var near = keys(r.branches).filter(function (b) { return K.edit(b, x) <= 2; })[0];
    if (near) hint('Maksudnya ' + near + '? Bikin branch baru pakai git switch -c ' + x + '.');
    else hint('Branch ' + x + ' belum ada. Bikin baru pakai git switch -c ' + x + '.');
    return false;
  }
  function gSwitch(a) {
    var P = parse(a, ['-c', '-C', '--create']);
    var c = val(P, '-c') || val(P, '--create'), C2 = val(P, '-C');
    if (c || C2) return newBranchSwitch(c || C2, P.rest[0], !!C2);
    if (P.f['-c'] || P.f['--create']) { err('error: switch `c\' requires a value'); return false; }
    if (!P.rest.length) { err('fatal: missing branch or commit argument'); return false; }
    if (P.f['--detach'] || P.f['-d']) { var id = resolve(P.rest[0]); if (!id) { err('fatal: invalid reference: ' + P.rest[0]); return false; } return doSwitch(id, false, P.rest[0]); }
    return switchByName(P.rest[0], false);
  }
  function gCheckout(a) {
    var r = W.repo, P = parse(a, ['-b', '-B']);
    var b = val(P, '-b') || val(P, '-B');
    if (b) return newBranchSwitch(b, P.rest[0], !!val(P, '-B'));
    if (P.f['--ours'] || P.f['--theirs']) return gCheckoutSide(P.f['--ours'] ? 'ours' : 'theirs', P.rest.concat(P.paths));
    if (P.paths.length) {
      if (P.rest.length) {
        var sid = resolve(P.rest[0]);
        if (!sid) { err('fatal: invalid reference: ' + P.rest[0]); return false; }
        P.paths.forEach(function (p) { var v = C[sid].tree[p]; if (v === undefined) { err('error: pathspec \'' + p + '\' did not match any file(s) known to git'); return; } W.files[p] = v; r.index[p] = v; });
        return true;
      }
      return gRestore(P.paths);
    }
    if (!P.rest.length) return true;
    var x = P.rest[0];
    if (x === '-' || r.branches[x] || (r.rtrack['origin/' + x] && !resolve(x)) || resolve(x)) return switchByName(x, true);
    if (W.files[x] !== undefined || r.index[x] !== undefined) return gRestore([x]);
    err('error: pathspec \'' + x + '\' did not match any file(s) known to git');
    hint('Ga ada branch atau file bernama ' + x + '. Bikin branch baru pakai git checkout -b ' + x + ' (atau git switch -c ' + x + ').');
    return false;
  }
  function rescued() { M.hit('undo'); toast('🛟 Commit yang tadinya hilang balik lagi'); }

  // ---------- git: merge / rebase / pick ----------
  function opBusy() {
    var r = W.repo;
    if (!r.op) return false;
    if (r.op.kind === 'merge') err(Object.keys(r.unmerged).length ? 'error: Merging is not possible because you have unmerged files.\nhint: Fix them up in the work tree, and then use \'git add/rm <file>\'\nhint: as appropriate to mark resolution and make a commit.\nfatal: Exiting because of an unresolved conflict.' : 'fatal: You have not concluded your merge (MERGE_HEAD exists).\nPlease, commit your changes before you merge.');
    else if (r.op.kind === 'rebase') err('fatal: It seems that there is already a rebase-merge directory, and\nI wonder if you are in the middle of another rebase.\n\n\tgit rebase (--continue | --abort | --skip)');
    else err('error: ' + (r.op.kind === 'pick' ? 'cherry-pick' : 'revert') + ' is already in progress\nhint: try "git ' + (r.op.kind === 'pick' ? 'cherry-pick' : 'revert') + ' (--continue | --abort | --quit)"');
    return true;
  }
  function doMerge(id, label, o) {
    var r = W.repo, h = headId();
    o = o || {};
    if (opBusy()) return false;
    if (!h) {
      var e0 = switchTree(C[id].tree);
      if (e0) { overwriteErr(e0, 'merge'); return false; }
      setHead(id, 'merge ' + label + ': Fast-forward');
      return true;
    }
    if (isAnc(id, h)) { out('Already up to date.'); return true; }
    if (isAnc(h, id) && !o.noff) {
      var before = headTree();
      var e = switchTree(C[id].tree);
      if (e) { overwriteErr(e, 'merge'); return false; }
      out('Updating ' + short(h) + '..' + short(id) + '\nFast-forward');
      html(statBlock(stat(before, C[id].tree)));
      setHead(id, (o.pull ? 'pull' : 'merge ' + label) + ': Fast-forward');
      K.flash(app, 'repo');
      return { ff: true };
    }
    if (o.ffOnly) { err('fatal: Not possible to fast-forward, aborting.'); hint('Lokal dan ' + label + ' sudah bercabang. Pilih merge (git pull --no-rebase) atau rebase (git pull --rebase).'); return false; }
    var me = ident();
    if (!me) { noIdent(); return false; }
    var base = mergeBase(h, id), res = mergeTrees(treeOf(base), headTree(), C[id].tree, 'HEAD', label);
    var touch = changedPaths(res.tree);
    res.conflicts.forEach(function (c) { touch[c.p] = true; });
    var oe = overwriteCheck(res.tree, touch);
    if (oe) { overwriteErr(oe, 'merge'); return false; }
    var before2 = headTree();
    applyResult(res);
    var msg = o.msg || ('Merge ' + (r.rtrack[label] ? 'remote-tracking ' : '') + 'branch \'' + label + '\'' + (r.head.ref && r.head.ref !== 'main' && r.head.ref !== 'master' ? ' into ' + r.head.ref : ''));
    var cl = conflictLines(res, label);
    if (res.conflicts.length) {
      r.op = { kind: 'merge', theirs: id, msg: msg, label: label, conflict: true };
      markHave(id);
      cl.forEach(function (l) { html(/^CONFLICT/.test(l) ? red(l) : esc(l)); });
      err('Automatic merge failed; fix conflicts and then commit the result.');
      hint('Buka tab file buat merapikan konfliknya (atau pakai git checkout --ours/--theirs <file>), lalu git add <file> dan git commit.');
      W.tab = 'file';
      W.sel = res.conflicts[0].p;
      K.flash(app, 'work', 'warn');
      return false;
    }
    cl.forEach(function (l) { out(l); });
    var nid = mkCommit(copy(r.index), [h, id], msg, me);
    setHead(nid, (o.pull ? 'pull' : 'merge ' + label) + ': Merge made by the \'ort\' strategy.');
    out('Merge made by the \'ort\' strategy.');
    html(statBlock(stat(before2, C[nid].tree)));
    K.pulse(app, 'commit');
    K.flash(app, 'repo');
    return { merge: true };
  }
  function gMerge(a) {
    var r = W.repo, P = parse(a, ['-m']);
    if (P.f['--abort']) {
      if (!r.op || r.op.kind !== 'merge') { err('fatal: There is no merge to abort (MERGE_HEAD missing).'); return false; }
      hardReset(headTree());
      r.op = null;
      return true;
    }
    if (P.f['--continue']) {
      if (!r.op || r.op.kind !== 'merge') { err('fatal: There is no merge in progress (MERGE_HEAD missing).'); return false; }
      return gCommit([]);
    }
    if (!P.rest.length) {
      var up = r.head.ref && r.upstream[r.head.ref];
      if (!up) { err('fatal: No remote for the current branch.'); return false; }
      P.rest.push(up);
    }
    var x = P.rest[0], id = resolve(x);
    if (!id) { err('merge: ' + x + ' - not something we can merge'); var near = keys(r.branches).filter(function (b) { return K.edit(b, x) <= 2; })[0]; if (near) hint('Maksudnya ' + near + '?'); return false; }
    var res = doMerge(id, x, { noff: P.f['--no-ff'], ffOnly: P.f['--ff-only'], msg: val(P, '-m') });
    if (res && (res.ff || res.merge) && r.head.ref && r.branches[x]) {
      M.hit('merge');
      (W.flags.merged = W.flags.merged || {})[x] = true;
    } else if (res === false && r.op && r.branches[x]) (W.flags.merged = W.flags.merged || {})[x] = true;
    return !!res;
  }
  function pickTrees(c, kind) {
    var cm = C[c], label = short(c) + ' (' + subject(c) + ')';
    if (kind === 'revert') return mergeTrees(cm.tree, headTree(), treeOf(cm.parents[0]), 'HEAD', 'parent of ' + label);
    return mergeTrees(treeOf(cm.parents[0]), headTree(), cm.tree, 'HEAD', label);
  }
  function gRebase(a) {
    var r = W.repo, P = parse(a, ['--onto']), op = r.op;
    if (P.f['--continue'] || P.f['--skip'] || P.f['--abort'] || P.f['--quit']) {
      if (!op || op.kind !== 'rebase') { err('fatal: No rebase in progress?'); return false; }
      if (P.f['--abort']) {
        hardReset(C[op.orig].tree);
        r.branches[op.branch] = op.orig;
        r.head = { ref: op.branch };
        logRef(op.orig, 'rebase (abort): returning to refs/heads/' + op.branch);
        r.op = null;
        return true;
      }
      if (P.f['--skip']) { hardReset(headTree()); op.cur = null; return rebaseStep(); }
      if (Object.keys(r.unmerged).length) {
        err(keys(r.unmerged).map(function (p) { return p + ': needs merge'; }).join('\n') + '\nYou must edit all merge conflicts and then\nmark them as resolved using git add');
        return false;
      }
      if (op.cur) {
        if (!sameTree(r.index, headTree())) {
          var me = ident();
          var nid = mkCommit(copy(r.index), [headId()], C[op.cur].msg, C[op.cur].author);
          setHead(nid, 'rebase (continue): ' + subject(op.cur));
          out('[detached HEAD ' + short(nid) + '] ' + subject(op.cur));
          if (!me) me = null;
        }
        op.cur = null;
        if (op.conflict) op.resolved = true;
      }
      return rebaseStep();
    }
    if (opBusy()) return false;
    if (!r.head.ref) { err('fatal: simulasi ini cuma bisa rebase dari sebuah branch, bukan detached HEAD'); return false; }
    var ch = changes();
    if (ch.unstaged.length || ch.staged.length) {
      err('error: cannot rebase: ' + (ch.unstaged.length ? 'You have unstaged changes.' : 'Your index contains uncommitted changes.') + '\nerror: Please commit or stash them.');
      return false;
    }
    var x = P.rest[0] || r.upstream[r.head.ref];
    if (!x) { err('There is no tracking information for the current branch.\nPlease specify which branch you want to rebase against.\n\n    git rebase <branch>'); return false; }
    var up = resolve(x);
    if (!up) { err('fatal: invalid upstream \'' + x + '\''); return false; }
    return rebaseStart(up, x, false);
  }
  function rebaseStart(up, label, fromPull) {
    var r = W.repo, h = headId(), br = r.head.ref;
    if (isAnc(up, h)) { out('Current branch ' + br + ' is up to date.'); return true; }
    if (isAnc(h, up)) {
      var e = switchTree(C[up].tree);
      if (e) { overwriteErr(e, 'checkout'); return false; }
      setHead(up, (fromPull ? 'pull --rebase' : 'rebase') + ' (finish): refs/heads/' + br + ' onto ' + up);
      out('Successfully rebased and updated refs/heads/' + br + '.');
      return true;
    }
    var todo = range(up, h).filter(function (c) { return C[c].parents.length < 2; });
    var e2 = switchTree(C[up].tree);
    if (e2) { overwriteErr(e2, 'checkout'); return false; }
    r.op = { kind: 'rebase', branch: br, onto: up, orig: h, todo: todo, done: 0, total: todo.length, cur: null, conflict: false, label: label };
    r.head = { id: up };
    logRef(up, 'rebase (start): checkout ' + label);
    return rebaseStep();
  }
  function rebaseStep() {
    var r = W.repo, op = r.op;
    while (op.todo.length) {
      var c = op.todo.shift();
      op.cur = c;
      op.done++;
      var res = pickTrees(c, 'pick');
      applyResult(res);
      if (res.conflicts.length) {
        op.conflict = true;
        conflictLines(res, short(c) + ' (' + subject(c) + ')').forEach(function (l) { html(/^CONFLICT/.test(l) ? red(l) : esc(l)); });
        err('error: could not apply ' + short(c) + '... ' + subject(c) + '\nhint: Resolve all conflicts manually, mark them as resolved with\nhint: "git add/rm <conflicted_files>", then run "git rebase --continue".\nhint: You can instead skip this commit: run "git rebase --skip".\nhint: To abort and get back to the state before "git rebase", run "git rebase --abort".\nCould not apply ' + short(c) + '... ' + subject(c));
        hint('Saat rebase, "HEAD" (ours) adalah ' + op.label + ' dan yang masuk (theirs) adalah commit kamu yang sedang diputar ulang.');
        W.tab = 'file';
        W.sel = res.conflicts[0].p;
        return false;
      }
      if (sameTree(r.index, headTree())) { dim('dropping ' + short(c) + ' ' + subject(c) + ' -- patch contents already upstream'); op.cur = null; continue; }
      var nid = mkCommit(copy(r.index), [headId()], C[c].msg, C[c].author);
      setHead(nid, 'rebase (pick): ' + subject(c));
      op.cur = null;
    }
    var tip = headId();
    r.branches[op.branch] = tip;
    r.head = { ref: op.branch };
    logRef(tip, 'rebase (finish): returning to refs/heads/' + op.branch);
    r.op = null;
    out('Successfully rebased and updated refs/heads/' + op.branch + '.');
    K.flash(app, 'repo');
    if (op.total) M.hit('rebase');
    if (op.conflict && !hasMarkers(C[tip].tree)) M.hit('conflict');
    return true;
  }
  function gPick(kind, a) {
    var r = W.repo, P = parse(a, ['-m']), nm = kind === 'pick' ? 'cherry-pick' : 'revert', op = r.op;
    if (P.f['--abort'] || P.f['--continue'] || P.f['--quit'] || P.f['--skip']) {
      if (!op || op.kind !== kind) { err('error: no ' + nm + ' in progress\nfatal: ' + nm + ' failed'); return false; }
      if (P.f['--abort']) { hardReset(headTree()); r.op = null; return true; }
      if (P.f['--quit']) { r.op = null; return true; }
      if (P.f['--skip']) { hardReset(headTree()); r.op = null; return true; }
      return gCommit([]);
    }
    if (opBusy()) return false;
    if (!P.rest.length) { err('usage: git ' + nm + ' [<options>] <commit-ish>...'); return false; }
    var me = ident();
    if (!me) { noIdent(); return false; }
    var id = resolve(P.rest[0]);
    if (!id) { err('fatal: bad revision \'' + P.rest[0] + '\''); return false; }
    if (C[id].parents.length > 1) { err('error: commit ' + id + ' is a merge but no -m option was given.\nfatal: ' + nm + ' failed'); return false; }
    if (!C[id].parents.length && kind === 'revert') { err('error: simulasi ini belum bisa revert commit pertama'); return false; }
    if (isDirty()) { err('error: your local changes would be overwritten by ' + nm + '.\nhint: commit your changes or stash them to proceed.\nfatal: ' + nm + ' failed'); return false; }
    var res = pickTrees(id, kind);
    var msg = kind === 'pick' ? C[id].msg : 'Revert "' + subject(id) + '"\n\nThis reverts commit ' + id + '.';
    applyResult(res);
    if (res.conflicts.length) {
      r.op = { kind: kind, src: id, msg: msg, conflict: true };
      conflictLines(res, short(id)).forEach(function (l) { html(/^CONFLICT/.test(l) ? red(l) : esc(l)); });
      err('error: could not ' + (kind === 'pick' ? 'apply' : 'revert') + ' ' + short(id) + '... ' + subject(id) + '\nhint: After resolving the conflicts, mark them with\nhint: "git add/rm <pathspec>", then run\nhint: "git ' + nm + ' --continue".\nhint: You can instead skip this commit with "git ' + nm + ' --skip".\nhint: To abort and get back to the state before "git ' + nm + '",\nhint: run "git ' + nm + ' --abort".');
      W.tab = 'file';
      W.sel = res.conflicts[0].p;
      return false;
    }
    if (sameTree(r.index, headTree())) {
      err('The previous cherry-pick is now empty, possibly due to conflict resolution.');
      return false;
    }
    r.op = { kind: kind, src: id, msg: msg };
    var ok = gCommit([]);
    if (r.op) r.op = null;
    return ok;
  }

  // ---------- git: reset / stash / tag ----------
  function gReset(a) {
    var r = W.repo, P = parse(a, []);
    var mode = P.f['--hard'] ? 'hard' : P.f['--soft'] ? 'soft' : 'mixed';
    var rev = null, paths = P.paths.slice();
    P.rest.forEach(function (x) { if (!rev && resolve(x) && !paths.length) rev = x; else paths.push(x); });
    var h = headId();
    if (paths.length) {
      var T = rev ? C[resolve(rev)].tree : headTree();
      var x = expand(paths);
      if (x.miss) { err('fatal: ambiguous argument \'' + x.miss + '\': unknown revision or path not in the working tree.'); return false; }
      x.paths.forEach(function (p) { if (T[p] === undefined) delete r.index[p]; else r.index[p] = T[p]; delete r.unmerged[p]; });
      var ch0 = changes();
      if (ch0.unstaged.length) out('Unstaged changes after reset:\n' + ch0.unstaged.map(function (y) { return (y.k === 'deleted' ? 'D' : 'M') + '\t' + y.p; }).join('\n'));
      return true;
    }
    if (!h) { if (mode !== 'hard') { r.index = {}; return true; } err('fatal: ambiguous argument \'HEAD\': unknown revision or path not in the working tree.'); return false; }
    var id = resolve(rev || 'HEAD');
    if (!id) { err('fatal: ambiguous argument \'' + rev + '\': unknown revision or path not in the working tree.'); return false; }
    if (r.op && r.op.kind === 'rebase') { err('fatal: di tengah rebase. Selesaikan dulu pakai git rebase --continue atau --abort.'); return false; }
    var lost = id !== h && isLost(id);
    var dropped = range(id, h).length;
    if (r.op && mode !== 'soft') r.op = null;
    setHead(id, 'reset: moving to ' + (rev || 'HEAD'));
    if (mode === 'mixed') {
      r.index = copy(C[id].tree);
      r.unmerged = {};
      var ch = changes();
      if (ch.unstaged.length) out('Unstaged changes after reset:\n' + ch.unstaged.map(function (y) { return (y.k === 'deleted' ? 'D' : 'M') + '\t' + y.p; }).join('\n'));
    } else if (mode === 'hard') {
      // index and files follow the target; untracked files stay put
      hardResetFrom(C[id].tree);
      out('HEAD is now at ' + short(id) + ' ' + subject(id));
    }
    if (dropped && mode === 'hard') dim('# ' + plural(dropped, 'commit').replace('commits', 'commit') + ' ga lagi ditunjuk branch mana pun. Masih bisa dicari lewat git reflog.');
    if (lost) rescued();
    K.flash(app, 'repo');
    return true;
  }
  function hardResetFrom(T) {
    var r = W.repo;
    union(r.index, r.unmerged, T).forEach(function (p) {
      if (T[p] === undefined) { delete r.index[p]; delete W.files[p]; }
      else { r.index[p] = T[p]; W.files[p] = T[p]; }
    });
    r.unmerged = {};
  }
  function gStash(a) {
    var r = W.repo, sub = a[0] && a[0][0] !== '-' ? a[0] : 'push', rest = a[0] && a[0][0] !== '-' ? a.slice(1) : a;
    var P = parse(rest, ['-m', '--message']);
    var n = 0;
    if (P.rest[0]) { var m = /^(?:stash@\{)?(\d+)\}?$/.exec(P.rest[0]); if (!m) { err('error: \'' + P.rest[0] + '\' is not a stash-like commit'); return false; } n = +m[1]; }
    if (sub === 'push' || sub === 'save') {
      var h = headId();
      if (!h) { err('You do not have the initial commit yet'); return false; }
      if (Object.keys(r.unmerged).length) { err(keys(r.unmerged).map(function (p) { return p + ': needs merge'; }).join('\n') + '\nerror: could not write index'); return false; }
      var ch = changes(), withU = P.f['-u'] || P.f['--include-untracked'];
      if (!ch.staged.length && !ch.unstaged.length && !(withU && ch.untracked.length)) {
        out('No local changes to save');
        if (ch.untracked.length) hint('File yang belum dilacak (untracked) ga ikut di-stash. Pakai git stash -u kalau mau ikut.');
        return true;
      }
      var msg = val(P, '-m') || val(P, '--message') || (sub === 'save' ? P.rest.join(' ') : '');
      var br = r.head.ref || '(no branch)';
      var snap = {};
      union(r.index, headTree()).forEach(function (p) { if (W.files[p] !== undefined) snap[p] = W.files[p]; });
      var untr = {};
      if (withU) ch.untracked.forEach(function (p) { untr[p] = W.files[p]; });
      var e = {
        id: K.digest('stash' + now() + Math.random()).slice(0, 40), base: h, index: copy(r.index), files: snap, untracked: untr,
        msg: msg ? 'On ' + br + ': ' + msg : 'WIP on ' + br + ': ' + short(h) + ' ' + subject(h)
      };
      r.stash.unshift(e);
      hardResetFrom(headTree());
      Object.keys(untr).forEach(function (p) { delete W.files[p]; });
      out('Saved working directory and index state ' + e.msg);
      W.flags.stashSwitch = false;
      K.flash(app, 'work');
      return true;
    }
    if (sub === 'list') { if (r.stash.length) out(r.stash.map(function (e, i) { return 'stash@{' + i + '}: ' + e.msg; }).join('\n')); return true; }
    if (sub === 'clear') { r.stash = []; return true; }
    if (!r.stash.length) { err('No stash entries found.'); return false; }
    var st = r.stash[n];
    if (!st) { err('error: stash@{' + n + '} is not a valid reference'); return false; }
    if (sub === 'show') {
      var BT = C[st.base].tree, ST = copy(st.files);
      Object.keys(st.untracked).forEach(function (p) { ST[p] = st.untracked[p]; });
      if (P.f['-p'] || P.f['--patch']) html(treeDiff(BT, ST), 'gt-diff');
      else html(statBlock(stat(BT, ST)));
      return true;
    }
    if (sub === 'drop') { r.stash.splice(n, 1); out('Dropped refs/stash@{' + n + '} (' + st.id + ')'); return true; }
    if (sub === 'pop' || sub === 'apply') {
      if (r.op || Object.keys(r.unmerged).length) { err('error: ' + keys(r.unmerged).concat(['index']).join(': needs merge\n') + '\nThe stash entry is kept in case you need it again.'); return false; }
      var B = C[st.base].tree, H = headTree(), S = copy(st.files);
      var res = mergeTrees(B, H, S, 'Updated upstream', 'Stashed changes');
      var d = dirtySet(), clash = [];
      union(B, S).forEach(function (p) { if (B[p] !== S[p] && d[p]) clash.push(p); });
      Object.keys(st.untracked).forEach(function (p) { if (W.files[p] !== undefined) clash.push(p); });
      if (clash.length) {
        err('error: Your local changes to the following files would be overwritten by merge:\n' + clash.map(function (p) { return '\t' + p; }).join('\n') + '\nPlease commit your changes or stash them before you merge.\nAborting\nThe stash entry is kept in case you need it again.');
        return false;
      }
      union(H, res.tree).forEach(function (p) {
        var c = res.conflicts.filter(function (x) { return x.p === p; })[0];
        if (c) { r.unmerged[p] = c; W.files[p] = res.tree[p]; return; }
        if (res.tree[p] === H[p]) return;
        if (res.tree[p] === undefined) { delete W.files[p]; delete r.index[p]; }
        else {
          W.files[p] = res.tree[p];
          if (st.index[p] !== undefined && B[p] === undefined) r.index[p] = res.tree[p];
        }
      });
      Object.keys(st.untracked).forEach(function (p) { W.files[p] = st.untracked[p]; });
      if (res.conflicts.length) {
        conflictLines(res, 'Stashed changes').forEach(function (l) { html(/^CONFLICT/.test(l) ? red(l) : esc(l)); });
        out('On branch ' + (r.head.ref || 'HEAD'));
        err('The stash entry is kept in case you need it again.');
        hint('Rapikan konfliknya, lalu git add. Stash-nya ga otomatis dihapus, buang manual pakai git stash drop kalau sudah beres.');
        return false;
      }
      gStatus([]);
      if (sub === 'pop') { r.stash.splice(n, 1); out('Dropped refs/stash@{' + n + '} (' + st.id + ')'); }
      if (W.flags.stashSwitch) M.hit('stash');
      else dim('# Tip misi: setelah git stash, coba pindah ke branch lain dulu, lalu balik dan pop.');
      W.flags.stashSwitch = undefined;
      K.flash(app, 'work');
      return true;
    }
    err('error: unknown subcommand: \'' + sub + '\'\nusage: git stash list\n   or: git stash show [<stash>]\n   or: git stash drop [<stash>]\n   or: git stash pop [<stash>]\n   or: git stash apply [<stash>]\n   or: git stash push [-u] [-m <message>]\n   or: git stash clear');
    return false;
  }
  function gTag(a) {
    var r = W.repo, P = parse(a, ['-m']);
    if (P.f['-d'] || P.f['--delete']) {
      return P.rest.every(function (t) {
        if (!r.tags[t]) { err('error: tag \'' + t + '\' not found.'); return false; }
        out('Deleted tag \'' + t + '\' (was ' + short(r.tags[t].id) + ')');
        delete r.tags[t];
        return true;
      });
    }
    if (!P.rest.length || P.f['-l'] || P.f['--list']) { var ts = keys(r.tags); if (ts.length) out(ts.join('\n')); return true; }
    var name = P.rest[0], id = resolve(P.rest[1] || 'HEAD');
    if (!validName(name)) { err('fatal: \'' + name + '\' is not a valid tag name.'); return false; }
    if (r.tags[name] && !P.f['-f']) { err('fatal: tag \'' + name + '\' already exists'); return false; }
    if (!id) { err('fatal: Failed to resolve \'' + (P.rest[1] || 'HEAD') + '\' as a valid ref.'); return false; }
    if ((P.f['-a'] || P.f['-s']) && !val(P, '-m')) { err('fatal: no tag message?'); hint('Tag beranotasi butuh pesan: git tag -a ' + name + ' -m "pesan"'); return false; }
    r.tags[name] = { id: id, msg: val(P, '-m') || null };
    return true;
  }

  // ---------- git: remote / push / fetch / pull ----------
  function srvFor(url) { return URLS.indexOf(url) >= 0 ? W.server : null; }
  function gRemote(a) {
    var r = W.repo, P = parse(a, []), sub = P.rest[0];
    if (!sub) { var ns = keys(r.remotes); if (ns.length) out(ns.map(function (n) { return P.f['-v'] ? n + '\t' + r.remotes[n].url + ' (fetch)\n' + n + '\t' + r.remotes[n].url + ' (push)' : n; }).join('\n')); return true; }
    var name = P.rest[1], url = P.rest[2];
    if (sub === 'add') {
      if (!name || !url) { err('usage: git remote add <name> <url>'); return false; }
      if (r.remotes[name]) { err('error: remote ' + name + ' already exists.'); return false; }
      r.remotes[name] = { url: url };
      K.flash(app, 'origin');
      if (!srvFor(url)) hint('Catatan: di simulasi ini repo GitHub-nya ada di ' + URL_OK + '. Alamat lain bakal "not found" waktu di-push.');
      return true;
    }
    if (sub === 'remove' || sub === 'rm') {
      if (!r.remotes[name]) { err('error: No such remote: \'' + name + '\''); return false; }
      delete r.remotes[name];
      Object.keys(r.rtrack).forEach(function (k) { if (k.indexOf(name + '/') === 0) delete r.rtrack[k]; });
      Object.keys(r.upstream).forEach(function (k) { if (r.upstream[k].indexOf(name + '/') === 0) delete r.upstream[k]; });
      return true;
    }
    if (sub === 'set-url') {
      if (!r.remotes[name]) { err('error: No such remote \'' + name + '\''); return false; }
      if (!url) { err('usage: git remote set-url <name> <newurl>'); return false; }
      r.remotes[name].url = url;
      return true;
    }
    if (sub === 'get-url') { if (!r.remotes[name]) { err('error: No such remote \'' + name + '\''); return false; } out(r.remotes[name].url); return true; }
    if (sub === 'show') {
      if (!r.remotes[name]) { err('fatal: \'' + name + '\' does not appear to be a git repository'); return false; }
      var s = srvFor(r.remotes[name].url);
      out('* remote ' + name + '\n  Fetch URL: ' + r.remotes[name].url + '\n  Push  URL: ' + r.remotes[name].url + '\n  HEAD branch: ' + (s && s.branches.main ? 'main' : '(unknown)') + '\n  Remote branches:\n' + (s ? keys(s.branches).map(function (b) { return '    ' + pad(b, 14) + (r.rtrack[name + '/' + b] ? 'tracked' : 'new (next fetch will store in remotes/' + name + ')'); }).join('\n') : ''));
      return true;
    }
    err('error: unknown subcommand: `' + sub + '\'');
    return false;
  }
  function remoteOf(name) {
    var r = W.repo;
    if (!r.remotes[name]) {
      err('fatal: \'' + name + '\' does not appear to be a git repository\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.');
      if (!keys(r.remotes).length) hint('Belum ada remote. Tambahkan dulu: git remote add origin ' + URL_OK);
      return null;
    }
    var s = srvFor(r.remotes[name].url);
    if (!s) { err('remote: Repository not found.\nfatal: repository \'' + r.remotes[name].url + '\' not found'); hint('Alamat remote-nya salah. Betulkan pakai git remote set-url ' + name + ' ' + URL_OK); return null; }
    return s;
  }
  function gPush(a) {
    var r = W.repo, P = parse(a, []);
    var names = keys(r.remotes);
    if (!names.length) {
      err('fatal: No configured push destination.\nEither specify the URL from the command-line or configure a remote repository using\n\n    git remote add <name> <url>\n\nand then push using the remote name\n\n    git push <name>');
      hint('Sambungkan dulu ke GitHub: git remote add origin ' + URL_OK);
      return false;
    }
    var cur = r.head.ref, upn = cur && r.upstream[cur];
    var rname = P.rest[0] || (upn ? upn.split('/')[0] : 'origin');
    var specs = P.rest.slice(1);
    var force = P.f['-f'] || P.f['--force'] || P.f['--force-with-lease'];
    var del = P.f['-d'] || P.f['--delete'];
    if (!specs.length && !P.f['--tags'] && !P.f['--all']) {
      if (!cur) { err('fatal: You are not currently on a branch.\nTo push the history leading to the current (detached HEAD)\nstate now, use\n\n    git push ' + rname + ' HEAD:<name-of-remote-branch>'); return false; }
      if (!headId()) { err('error: src refspec ' + cur + ' does not match any\nerror: failed to push some refs to \'' + (r.remotes[rname] ? r.remotes[rname].url : rname) + '\''); hint('Belum ada commit buat dikirim. Commit dulu.'); return false; }
      if (!upn && !(P.f['-u'] || P.f['--set-upstream'])) {
        if (!r.remotes[rname]) { remoteOf(rname); return false; }
        err('fatal: The current branch ' + cur + ' has no upstream branch.\nTo push the current branch and set the remote as upstream, use\n\n    git push --set-upstream ' + rname + ' ' + cur + '\n\nTo have this happen automatically for branches without a tracking\nupstream, see \'push.autoSetupRemote\' in \'git help config\'.');
        hint('Push pertama kali butuh tujuan: git push -u ' + rname + ' ' + cur + ' (setelah itu cukup git push).');
        return false;
      }
      specs = [cur + ':' + (upn ? upn.split('/').slice(1).join('/') : cur)];
    }
    if (P.f['--all']) specs = keys(r.branches);
    var s = remoteOf(rname);
    if (!s) return false;
    var url = r.remotes[rname].url, lines0 = [], rejected = [], sent = 0, okAny = false, dinaGone = false;
    if (P.f['--tags']) keys(r.tags).forEach(function (t) { if (s.tags[t] !== r.tags[t].id) { lines0.push(esc(' * [new tag]         ' + t + ' -> ' + t)); s.tags[t] = r.tags[t].id; okAny = true; } });
    var upd = [];
    for (var i = 0; i < specs.length; i++) {
      var sp = specs[i], src = sp, dst = sp, cm = /^(\+?)([^:]*):(.+)$/.exec(sp);
      if (cm) { src = cm[2]; dst = cm[3]; }
      if (src === 'HEAD') src = cur || 'HEAD';
      if (dst === 'HEAD') dst = cur;
      if (del || (cm && !src)) {
        if (!s.branches[dst] && !s.tags[dst]) { err('error: unable to delete \'' + dst + '\': remote ref does not exist\nerror: failed to push some refs to \'' + url + '\''); return false; }
        if (dst === 'main') { err('To ' + url + '\n ! [remote rejected] main (refusing to delete the current branch: refs/heads/main)\nerror: failed to push some refs to \'' + url + '\''); return false; }
        delete s.branches[dst];
        delete s.tags[dst];
        delete r.rtrack[rname + '/' + dst];
        lines0.push(esc(' - [deleted]         ' + dst));
        okAny = true;
        continue;
      }
      if (r.tags[src] && !r.branches[src]) {
        if (s.tags[dst] === r.tags[src].id) continue;
        if (s.tags[dst] && !force) { rejected.push(esc(' ! [rejected]        ' + src + ' -> ' + dst + ' (already exists)')); continue; }
        s.tags[dst] = r.tags[src].id;
        lines0.push(esc(' * [new tag]         ' + src + ' -> ' + dst));
        okAny = true;
        continue;
      }
      var id = resolve(src);
      if (!id) { err('error: src refspec ' + src + ' does not match any\nerror: failed to push some refs to \'' + url + '\''); return false; }
      var old = s.branches[dst];
      if (old === id) { upd.push({ src: src, dst: dst, same: true }); continue; }
      if (old && !isAnc(old, id) && !force && !(cm && cm[1])) {
        rejected.push(esc(' ! [rejected]        ' + src + ' -> ' + dst + (r.have[old] ? ' (non-fast-forward)' : ' (fetch first)')));
        rejected.fetch = !r.have[old];
        continue;
      }
      if (old && !isAnc(old, id) && range(id, old).some(function (c) { return C[c].author.name === DINA.name; })) dinaGone = true;
      sent += range(old, id).length;
      s.branches[dst] = id;
      r.rtrack[rname + '/' + dst] = id;
      lines0.push(esc(old ? (isAnc(old, id) ? '   ' + short(old) + '..' + short(id) + '  ' : ' + ' + short(old) + '...' + short(id) + ' ') + src + ' -> ' + dst + (isAnc(old, id) ? '' : ' (forced update)') : ' * [new branch]      ' + src + ' -> ' + dst));
      upd.push({ src: src, dst: dst, id: id, old: old });
      okAny = true;
    }
    if (!lines0.length && !rejected.length) {
      out('Everything up-to-date');
      upd.forEach(function (u) { if ((P.f['-u'] || P.f['--set-upstream']) && r.branches[u.src]) { r.upstream[u.src] = rname + '/' + u.dst; out('branch \'' + u.src + '\' set up to track \'' + rname + '/' + u.dst + '\'.'); } });
      return true;
    }
    var h = [];
    if (sent) {
      var objs = sent * 3;
      h.push(esc('Enumerating objects: ' + (objs + 2) + ', done.\nCounting objects: 100% (' + (objs + 2) + '/' + (objs + 2) + '), done.\nDelta compression using up to 8 threads\nCompressing objects: 100% (' + objs + '/' + objs + '), done.\nWriting objects: 100% (' + objs + '/' + objs + '), ' + (objs * 137) + ' bytes | ' + (objs * 137) + '.00 KiB/s, done.\nTotal ' + objs + ' (delta ' + Math.max(0, sent - 1) + '), reused 0 (delta 0), pack-reused 0 (from 0)'));
      if (upd.some(function (u) { return u.id && !u.old && u.dst !== 'main'; })) {
        var nb = upd.filter(function (u) { return u.id && !u.old && u.dst !== 'main'; })[0];
        h.push(esc('remote:\nremote: Create a pull request for \'' + nb.dst + '\' on GitHub by visiting:\nremote:      https://github.com/kamu/proyek-web/pull/new/' + nb.dst + '\nremote:'));
      }
    }
    h.push(esc('To ' + url));
    h = h.concat(lines0);
    html(h.join('\n'));
    if (rejected.length) {
      html(red(toText(rejected.join('\n'))));
      err('error: failed to push some refs to \'' + url + '\'');
      if (rejected.fetch) err('hint: Updates were rejected because the remote contains work that you do not\nhint: have locally. This is usually caused by another repository pushing to\nhint: the same ref. If you want to integrate the remote changes, use\nhint: \'git pull\' before pushing again.\nhint: See the \'Note about fast-forwards\' in \'git push --help\' for details.');
      else err('hint: Updates were rejected because the tip of your current branch is behind\nhint: its remote counterpart. If you want to integrate the remote changes,\nhint: use \'git pull\' before pushing again.\nhint: See the \'Note about fast-forwards\' in \'git push --help\' for details.');
      hint('Di origin ada commit yang belum kamu punya. Tarik dulu pakai git pull (atau git pull --rebase), lalu push lagi. Jangan langsung --force: commit teman bisa hilang.');
      W.flags.rejected = true;
      K.flash(app, 'origin', 'warn');
    }
    upd.forEach(function (u) {
      if ((P.f['-u'] || P.f['--set-upstream']) && r.branches[u.src]) { r.upstream[u.src] = rname + '/' + u.dst; out('branch \'' + u.src + '\' set up to track \'' + rname + '/' + u.dst + '\'.'); }
    });
    if (okAny) {
      K.pulse(app, 'push');
      K.flash(app, 'origin');
      var mainUp = upd.filter(function (u) { return u.dst === 'main' && u.id; })[0];
      if (mainUp) {
        M.hit('push');
        if (W.flags.rejected && range(null, mainUp.id).some(function (c) { return C[c].author.name === DINA.name; })) M.hit('pull');
        if (W.dinaN < 4 && !W.dinaTimer && !M.done.pull) W.dinaTimer = setTimeout(function () { W.dinaTimer = null; dinaPush(); }, 2600);
      }
      if (dinaGone) { hint('Waduh, force push barusan menimpa commit Dina di origin/main. Di tim beneran, ini bikin kerjaan teman hilang.'); toast('⚠️ Commit Dina tertimpa force push'); }
    }
    return !rejected.length;
  }
  function doFetch(rname, quiet) {
    var r = W.repo, s = remoteOf(rname);
    if (!s) return false;
    var url = r.remotes[rname].url, h = [];
    keys(s.branches).forEach(function (b) {
      var id = s.branches[b], key = rname + '/' + b, old = r.rtrack[key];
      if (old === id) return;
      markHave(id);
      r.rtrack[key] = id;
      h.push(old ? (isAnc(old, id) ? '   ' + short(old) + '..' + short(id) + '  ' + pad(b, 10) + ' -> ' + key : ' + ' + short(old) + '...' + short(id) + ' ' + pad(b, 10) + ' -> ' + key + '  (forced update)') : ' * [new branch]      ' + pad(b, 10) + ' -> ' + key);
    });
    keys(s.tags).forEach(function (t) { if (!r.tags[t]) { r.tags[t] = { id: s.tags[t] }; markHave(s.tags[t]); h.push(' * [new tag]         ' + pad(t, 10) + ' -> ' + t); } });
    if (h.length) {
      var n = h.length * 3;
      out('remote: Enumerating objects: ' + (n + 1) + ', done.\nremote: Counting objects: 100% (' + (n + 1) + '/' + (n + 1) + '), done.\nremote: Total ' + n + ' (delta 0), reused ' + n + ' (delta 0), pack-reused 0 (from 0)\nUnpacking objects: 100% (' + n + '/' + n + '), done.\nFrom ' + url.replace(/\.git$/, '') + '\n' + h.join('\n'));
      K.pulse(app, 'push');
      K.flash(app, 'repo');
    }
    return true;
  }
  function gFetch(a) {
    var r = W.repo, P = parse(a, []);
    if (!keys(r.remotes).length) { err('fatal: No remote repository specified.  Please, specify either a URL or a\nremote name from which new revisions should be fetched.'); hint('Belum ada remote. Tambahkan dulu: git remote add origin ' + URL_OK); return false; }
    var ok = doFetch(P.rest[0] || 'origin');
    if (ok && (P.f['-p'] || P.f['--prune'])) {
      var s = W.server;
      Object.keys(r.rtrack).forEach(function (k) { var b = k.split('/').slice(1).join('/'); if (!s.branches[b]) { out(' - [deleted]         (none)     -> ' + k); delete r.rtrack[k]; } });
    }
    return ok;
  }
  function gPull(a) {
    var r = W.repo, P = parse(a, []);
    if (opBusy()) return false;
    if (!keys(r.remotes).length) { err('fatal: No remote repository specified.'); hint('Belum ada remote. Tambahkan dulu: git remote add origin ' + URL_OK); return false; }
    var cur = r.head.ref;
    if (!cur) { err('You are not currently on a branch.\nPlease specify which branch you want to merge with.'); return false; }
    var rname = P.rest[0] || (r.upstream[cur] ? r.upstream[cur].split('/')[0] : 'origin');
    var up = P.rest[1] ? rname + '/' + P.rest[1] : r.upstream[cur];
    if (!up) {
      if (!doFetch(rname)) return false;
      err('There is no tracking information for the current branch.\nPlease specify which branch you want to merge with.\nSee git-pull(1) for details.\n\n    git pull <remote> <branch>\n\nIf you wish to set tracking information for this branch you can do so with:\n\n    git branch --set-upstream-to=' + rname + '/<branch> ' + cur);
      return false;
    }
    if (!doFetch(rname)) return false;
    var tid = r.rtrack[up];
    if (!tid) { err('fatal: couldn\'t find remote ref ' + up.split('/').slice(1).join('/')); return false; }
    var h = headId(), label = up;
    if (h && isAnc(tid, h)) { out('Already up to date.'); return true; }
    var mode = P.f['--rebase'] || P.f['-r'] ? 'rebase' : P.f['--no-rebase'] ? 'merge' : P.f['--ff-only'] ? 'ff' : null;
    if (!mode) { var pr = cfg('pull.rebase'); if (pr === 'true') mode = 'rebase'; else if (pr === 'false') mode = 'merge'; else if (cfg('pull.ff') === 'only') mode = 'ff'; }
    if (!h || isAnc(h, tid)) return !!doMerge(tid, label, { pull: true });
    if (!mode) {
      err('hint: You have divergent branches and need to specify how to reconcile them.\nhint: You can do so by running one of the following commands sometime before\nhint: your next pull:\nhint:\nhint:   git config pull.rebase false  # merge\nhint:   git config pull.rebase true   # rebase\nhint:   git config pull.ff only       # fast-forward only\nhint:\nhint: You can replace "git config" with "git config --global" to set a default\nhint: preference for all repositories. You can also pass --rebase, --no-rebase,\nhint: or --ff-only on the command line to override the configured default per\nhint: invocation.\nfatal: Need to specify how to reconcile divergent branches.');
      hint('Lokal dan ' + up + ' sama-sama punya commit baru. Pilih salah satu: git pull --no-rebase (bikin merge commit) atau git pull --rebase (riwayat tetap lurus).');
      return false;
    }
    if (mode === 'ff') { err('fatal: Not possible to fast-forward, aborting.'); return false; }
    if (mode === 'rebase') {
      var ch = changes();
      if (ch.unstaged.length || ch.staged.length) { err('error: cannot pull with rebase: You have unstaged changes.\nerror: Please commit or stash them.'); return false; }
      return rebaseStart(tid, up, true);
    }
    var srv = r.remotes[rname].url.replace(/\.git$/, '');
    return !!doMerge(tid, label, { pull: true, msg: 'Merge branch \'' + up.split('/').slice(1).join('/') + '\' of ' + srv });
  }
  function dinaPush() {
    var s = W.server, tip = s.branches.main;
    if (!tip) return;
    W.dinaN++;
    var T = copy(C[tip].tree), msg;
    if (T['tentang.html'] === undefined) { T['tentang.html'] = TENTANG; msg = 'Tambah halaman tentang'; }
    else {
      var t = T['tentang.html'];
      T['tentang.html'] = t.indexOf('</body>') >= 0 ? t.replace('</body>', '  <p>Catatan ke-' + W.dinaN + ' dari Dina.</p>\n</body>') : t + '<!-- catatan ke-' + W.dinaN + ' dari Dina -->\n';
      msg = 'Perbarui halaman tentang';
    }
    s.branches.main = mkCommit(T, [tip], msg, DINA);
    term.line('<span class="sx-warn"># 🔔 Dina (teman satu tim) baru saja push 1 commit ke origin/main: "' + esc(msg) + '"</span>');
    toast('🔔 Dina push commit baru ke origin/main');
    K.flash(app, 'origin', 'warn');
    render();
  }

  // ---------- git: misc ----------
  function gMv(a) {
    var r = W.repo, P = parse(a, []);
    if (P.rest.length !== 2) { err('usage: git mv <source> <destination>'); return false; }
    var x = P.rest[0], y = P.rest[1];
    if (r.index[x] === undefined) { err('fatal: not under version control, source=' + x + ', destination=' + y); return false; }
    if (W.files[y] !== undefined && !P.f['-f']) { err('fatal: destination exists, source=' + x + ', destination=' + y); return false; }
    W.files[y] = W.files[x];
    delete W.files[x];
    r.index[y] = W.files[y];
    delete r.index[x];
    return true;
  }
  function gClean(a) {
    var P = parse(a, []), ch = changes();
    if (!P.f['-f'] && !P.f['-n'] && !P.f['--dry-run']) { err('fatal: clean.requireForce is true and -f not given: refusing to clean'); hint('Ini sengaja: git clean menghapus file untracked tanpa bisa dibatalkan. Cek dulu pakai git clean -n.'); return false; }
    ch.untracked.forEach(function (p) {
      if (P.f['-n'] || P.f['--dry-run']) out('Would remove ' + p);
      else { out('Removing ' + p); delete W.files[p]; }
    });
    return true;
  }
  function gRevParse(a) {
    var P = parse(a, []), x = P.rest[0] || 'HEAD';
    if (P.f['--show-toplevel']) { out(DIR); return true; }
    if (P.f['--git-dir']) { out('.git'); return true; }
    if (P.f['--abbrev-ref']) { if (x === 'HEAD') { out(W.repo.head.ref || 'HEAD'); return true; } }
    var id = resolve(x);
    if (!id) { out(x); err('fatal: ambiguous argument \'' + x + '\': unknown revision or path not in the working tree.'); return false; }
    out(P.f['--short'] ? short(id) : id);
    return true;
  }
  var GIT_CMDS = ['init', 'config', 'status', 'add', 'rm', 'mv', 'restore', 'commit', 'log', 'show', 'diff', 'reflog', 'branch', 'switch', 'checkout', 'merge', 'rebase', 'cherry-pick', 'revert', 'reset', 'stash', 'tag', 'remote', 'push', 'fetch', 'pull', 'clean', 'rev-parse', 'ls-files', 'help', 'version', 'clone'];
  function git(a) {
    while (a[0] === '--no-pager' || a[0] === '-P') a = a.slice(1);
    var sub = a[0], rest = a.slice(1);
    if (!sub || sub === 'help' || sub === '--help' || sub === '-h') { gitHelp(); return !sub ? false : true; }
    if (sub === '--version' || sub === 'version') { out('git version ' + VERSION); return true; }
    if (sub === 'init') return gInit(rest);
    if (sub === 'config') return gConfig(rest);
    if (sub === 'clone') {
      err('fatal: destination path \'proyek-web\' already exists and is not an empty directory.');
      hint('Di simulasi ini proyeknya sudah ada di laptop. Mulai dengan git init, lalu sambungkan ke GitHub pakai git remote add.');
      return false;
    }
    if (GIT_CMDS.indexOf(sub) < 0) {
      err('git: \'' + sub + '\' is not a git command. See \'git --help\'.');
      var near = GIT_CMDS.filter(function (c) { return K.edit(c, sub) <= 2; })[0];
      if (near) err('\nThe most similar command is\n\t' + near);
      return false;
    }
    if (!needRepo()) return false;
    switch (sub) {
      case 'status': return gStatus(rest);
      case 'add': return gAdd(rest);
      case 'rm': return gRm(rest);
      case 'mv': return gMv(rest);
      case 'restore': return gRestore(rest);
      case 'commit': return gCommit(rest);
      case 'log': return gLog(rest);
      case 'show': return gShow(rest);
      case 'diff': return gDiff(rest);
      case 'reflog': return gReflog(rest[0] === 'show' ? rest.slice(1) : rest);
      case 'branch': return gBranch(rest);
      case 'switch': return gSwitch(rest);
      case 'checkout': return gCheckout(rest);
      case 'merge': return gMerge(rest);
      case 'rebase': return gRebase(rest);
      case 'cherry-pick': return gPick('pick', rest);
      case 'revert': return gPick('revert', rest);
      case 'reset': return gReset(rest);
      case 'stash': return gStash(rest);
      case 'tag': return gTag(rest);
      case 'remote': return gRemote(rest);
      case 'push': return gPush(rest);
      case 'fetch': return gFetch(rest);
      case 'pull': return gPull(rest);
      case 'clean': return gClean(rest);
      case 'rev-parse': return gRevParse(rest);
      case 'ls-files': { var f = keys(W.repo.index); if (f.length) out(f.join('\n')); return true; }
    }
    return false;
  }
  function gitHelp() {
    html([
      '<b>usage: git &lt;command&gt; [&lt;args&gt;]</b>',
      '',
      '<span class="sx-dim">mulai dan simpan perubahan</span>',
      '   init, config, status, add, rm, mv, restore, commit',
      '<span class="sx-dim">lihat riwayat</span>',
      '   log [--oneline --graph --all], show, diff [--staged], reflog',
      '<span class="sx-dim">branch dan gabung</span>',
      '   branch, switch, checkout, merge, rebase, cherry-pick, revert, tag',
      '<span class="sx-dim">batalkan dan simpan sementara</span>',
      '   reset [--soft|--mixed|--hard], stash [push|list|pop|apply|drop], clean',
      '<span class="sx-dim">kerja bareng</span>',
      '   remote, push, fetch, pull [--rebase]'
    ].join('\n'));
  }

  // ---------- shell ----------
  function lex(line) {
    var toks = [], cur = '', q = null, has = false;
    function push() { if (cur || has) toks.push({ w: cur }); cur = ''; has = false; }
    for (var i = 0; i < line.length; i++) {
      var ch = line[i], two2 = line.substr(i, 2);
      if (q) {
        if (ch === q) q = null;
        else if (ch === '\\' && q === '"' && i + 1 < line.length && /["\\$`]/.test(line[i + 1])) cur += line[++i];
        else cur += ch;
        continue;
      }
      if (ch === '"' || ch === "'") { q = ch; has = true; continue; }
      if (ch === '\\' && i + 1 < line.length) { cur += line[++i]; continue; }
      if (/\s/.test(ch)) { push(); continue; }
      if (two2 === '&&' || two2 === '||' || two2 === '>>') { push(); toks.push({ op: two2 }); i++; continue; }
      if (ch === ';' || ch === '|' || ch === '>') { push(); toks.push({ op: ch }); continue; }
      cur += ch;
    }
    if (q) return null;
    push();
    return toks;
  }
  function onCmd(line) {
    term.echo(prompt(), line);
    if (!line) return;
    var toks = lex(line);
    if (!toks) { err('bash: tanda kutip ' + (line.split('"').length % 2 ? '\'' : '"') + ' belum ditutup'); return; }
    var chain = [], cur = [], lastOk = true, prevOp = null;
    toks.forEach(function (t) {
      if (t.op === '&&' || t.op === '||' || t.op === ';') { chain.push({ toks: cur, op: prevOp }); prevOp = t.op; cur = []; }
      else cur.push(t);
    });
    chain.push({ toks: cur, op: prevOp });
    for (var i = 0; i < chain.length; i++) {
      var seg = chain[i];
      if (seg.op === '&&' && !lastOk) continue;
      if (seg.op === '||' && lastOk) continue;
      if (!seg.toks.length) { if (i) { err('bash: syntax error near unexpected token'); break; } continue; }
      lastOk = runPipe(seg.toks);
    }
    render();
  }
  function runPipe(toks) {
    var stages = [[]], redir = null;
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t.op === '|') { stages.push([]); continue; }
      if (t.op === '>' || t.op === '>>') {
        var f = toks[i + 1];
        if (!f || f.op) { err('bash: syntax error near unexpected token `newline\''); return false; }
        redir = { mode: t.op, file: f.w.replace(/^\.\//, '') };
        i++;
        continue;
      }
      stages[stages.length - 1].push(t.w);
    }
    if (stages.some(function (s) { return !s.length; })) { err('bash: syntax error near unexpected token `|\''); return false; }
    if (stages.length === 1 && !redir) return exec(stages[0]);
    CAP = [];
    NONL = false;
    var ok;
    try { ok = exec(stages[0]); } finally { var text = CAP.join('\n'); CAP = null; }
    for (var s = 1; s < stages.length; s++) {
      var r = filter(stages[s], text);
      if (r === null) return false;
      text = r;
    }
    if (redir) {
      if (/^\.git(\/|$)/.test(redir.file)) { err('bash: ' + redir.file + ': jangan diubah manual ya, biar Git yang urus'); return false; }
      if (!validFile(redir.file)) { err('bash: ' + redir.file + ': nama file ga valid di simulasi ini'); return false; }
      var body = text + (text && !NONL ? '\n' : '');
      W.files[redir.file] = redir.mode === '>>' ? (W.files[redir.file] || '') + body : body;
      return ok;
    }
    if (text) out(text);
    return ok;
  }
  function validFile(p) { return /^[\w.\-][\w.\-\/]*$/.test(p) && !/\/$|\.\./.test(p); }
  function filter(a, text) {
    var cmd = a[0], L = text ? text.split('\n') : [], P = parse(a.slice(1), ['-n']);
    if (cmd === 'head' || cmd === 'tail') { var n = +(val(P, '-n') || 10); return (cmd === 'head' ? L.slice(0, n) : L.slice(-n)).join('\n'); }
    if (cmd === 'grep') {
      var pat = P.rest[0];
      if (!pat) { err('usage: grep [-i] [-v] PATTERN'); return null; }
      var ci = P.f['-i'], inv = P.f['-v'];
      return L.filter(function (l) { var hit = (ci ? l.toLowerCase().indexOf(pat.toLowerCase()) : l.indexOf(pat)) >= 0; return inv ? !hit : hit; }).join('\n');
    }
    if (cmd === 'wc') return String(P.f['-l'] ? L.length : text.split(/\s+/).filter(Boolean).length);
    if (cmd === 'cat' || cmd === 'less' || cmd === 'more') return text;
    if (cmd === 'sort') return L.slice().sort().join('\n');
    err('bash: ' + cmd + ': simulasi ini cuma mendukung pipe ke head, tail, grep, wc, sort, dan less');
    return null;
  }
  function exec(a) {
    var cmd = a[0], args = a.slice(1);
    switch (cmd) {
      case 'git': return git(args);
      case 'help': return shHelp();
      case 'clear': term.clear(); return true;
      case 'pwd': out(DIR); return true;
      case 'whoami': out('kamu'); return true;
      case 'date': out(new Date().toString().replace(/ \(.*\)$/, '')); return true;
      case 'cd': {
        var d = args[0];
        if (!d || d === '.' || d === '~/proyek-web' || d === DIR || d === 'proyek-web' && false) return true;
        err('bash: cd: di simulasi ini kamu tetap di ~/proyek-web');
        return false;
      }
      case 'ls': return shLs(args);
      case 'cat': return shCat(args);
      case 'echo': return shEcho(args);
      case 'printf': out((args[0] || '').replace(/\\n/g, '\n').replace(/\n$/, '')); NONL = true; return true;
      case 'touch': args.forEach(function (f) { if (validFile(f) && W.files[f] === undefined) W.files[f] = ''; }); return true;
      case 'rm': return shRm(args);
      case 'mv': return shMv(args);
      case 'sed': return shSed(args);
      case 'nano': case 'vim': case 'vi': case 'nvim': case 'code': case 'micro': case 'emacs': return shEdit(cmd, args);
      case 'head': case 'tail': case 'grep': case 'wc': case 'sort': {
        var file = args[args.length - 1];
        if (W.files[file] === undefined || args.length < (cmd === 'grep' ? 2 : 1)) { err(cmd + ': butuh nama file (atau pakai pipe, misal git log --oneline | ' + cmd + ')'); return false; }
        var r = filter(a.slice(0, -1), W.files[file].replace(/\n$/, ''));
        if (r === null) return false;
        if (r) out(r);
        return true;
      }
      case 'mkdir': err('mkdir: simulasi ini belum mendukung folder. Pakai nama file biasa ya.'); return false;
      case 'sudo': err('kamu is not in the sudoers file. This incident will be reported. 😄'); return false;
      case 'exit': dim('# ga bisa keluar dari simulasi. Klik "reset simulasi" kalau mau mulai ulang.'); return true;
    }
    err('bash: ' + cmd + ': command not found');
    var near = ['git', 'ls', 'cat', 'echo', 'touch', 'rm', 'mv', 'sed', 'nano', 'clear', 'help', 'pwd'].filter(function (c) { return K.edit(c, cmd) <= 1; })[0];
    if (near) hint('Maksudnya ' + near + '?');
    return false;
  }
  function shHelp() {
    html([
      '<b>Perintah di simulasi ini</b>',
      '<span class="sx-dim">git</span>      git help buat daftar lengkap, misal git status, git add ., git commit -m "pesan"',
      '<span class="sx-dim">file</span>     ls, cat, echo "teks" &gt; file, echo "teks" &gt;&gt; file, touch, rm, mv, nano &lt;file&gt;',
      '<span class="sx-dim">edit</span>     sed -i \'s/lama/baru/\' file, atau buka tab <b>file</b> dan edit langsung',
      '<span class="sx-dim">shell</span>    &amp;&amp; dan ; buat merangkai, | head / grep / wc, clear, pwd',
      '',
      '<span class="sx-dim">Tombol di bawah terminal selalu menyarankan langkah berikutnya. Panah atas/bawah buat riwayat perintah.</span>'
    ].join('\n'));
    return true;
  }
  function shLs(a) {
    var P = parse(a, []), f = keys(W.files);
    if (P.rest.length) f = f.filter(function (x) { return P.rest.some(function (p) { return x === p || x.indexOf(p.replace(/\/$/, '') + '/') === 0; }); });
    if (P.rest.length && !f.length) { err('ls: cannot access \'' + P.rest[0] + '\': No such file or directory'); return false; }
    var all = (P.f['-a'] || P.f['-A']) && !P.rest.length;
    if (!all) f = f.filter(function (x) { return x[0] !== '.'; });
    if (P.f['-l']) {
      var rows = [];
      if (all && W.repo) rows.push('drwxr-xr-x 7 kamu kamu 4096 ' + lsDate() + ' .git');
      f.forEach(function (x) { rows.push('-rw-r--r-- 1 kamu kamu ' + pad(String(W.files[x].length), 4) + ' ' + lsDate() + ' ' + x); });
      out('total ' + rows.length * 4 + '\n' + rows.join('\n'));
      return true;
    }
    var items = (all && W.repo ? ['<span class="gt-dir">.git</span>'] : []).concat(f.map(function (x) { return esc(x); }));
    if (items.length) html(items.join('  '));
    return true;
  }
  function lsDate() { var d = new Date(); return MONS[d.getMonth()] + ' ' + pad(String(d.getDate()), 2) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()); }
  function shCat(a) {
    if (!a.length) { err('cat: butuh nama file'); return false; }
    var ok = true;
    a.forEach(function (f) {
      f = f.replace(/^\.\//, '');
      var r = W.repo, v;
      if (f === '.git/HEAD' && r) v = r.head.ref ? 'ref: refs/heads/' + r.head.ref : headId();
      else if (/^\.git\/refs\/heads\//.test(f) && r) v = r.branches[f.slice(16)];
      else if (/^\.git\/refs\/tags\//.test(f) && r) v = r.tags[f.slice(15)] && r.tags[f.slice(15)].id;
      else if (/^\.git\/refs\/remotes\//.test(f) && r) v = r.rtrack[f.slice(18)];
      else if (f === '.git/config' && r) {
        v = '[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false';
        Object.keys(r.remotes).forEach(function (n) { v += '\n[remote "' + n + '"]\n\turl = ' + r.remotes[n].url + '\n\tfetch = +refs/heads/*:refs/remotes/' + n + '/*'; });
        Object.keys(r.upstream).forEach(function (b) { var u = r.upstream[b].split('/'); v += '\n[branch "' + b + '"]\n\tremote = ' + u[0] + '\n\tmerge = refs/heads/' + u.slice(1).join('/'); });
      } else if (f === '.git/MERGE_HEAD' && r && r.op && r.op.kind === 'merge') v = r.op.theirs;
      else if (f === '.git' || /^\.git\//.test(f)) { err('cat: ' + f + ': ' + (r ? 'simulasi ini cuma bisa membaca .git/HEAD, .git/config, dan .git/refs/...' : 'No such file or directory')); ok = false; return; }
      else v = W.files[f];
      if (v === undefined) { err('cat: ' + f + ': No such file or directory'); ok = false; return; }
      if (v === '') return;
      var body = v.replace(/\n$/, '');
      if (!CAP && MARK.test(body)) html(body.split('\n').map(function (l) { return /^(<{7}|={7}|>{7})/.test(l) ? '<span class="sx-warn">' + esc(l) + '</span>' : esc(l); }).join('\n'));
      else out(body);
    });
    return ok;
  }
  function shEcho(a) {
    var nonl = false, e = false;
    while (a[0] === '-n' || a[0] === '-e' || a[0] === '-ne' || a[0] === '-en') { if (a[0].indexOf('n') >= 0) nonl = true; if (a[0].indexOf('e') >= 0) e = true; a = a.slice(1); }
    var t = a.join(' ');
    if (e) t = t.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    if (nonl && CAP) NONL = true;
    out(t);
    return true;
  }
  function shRm(a) {
    var P = parse(a, []), ok = true;
    if (!P.rest.length) { err('rm: missing operand'); return false; }
    P.rest.forEach(function (f) {
      f = f.replace(/^\.\//, '');
      if (f === '.git' || /^\.git\//.test(f)) { err('rm: ' + f + ': ga boleh, nanti repo-nya rusak 🙂'); ok = false; return; }
      var hit = keys(W.files).filter(function (x) { return x === f || (P.f['-r'] && x.indexOf(f.replace(/\/$/, '') + '/') === 0) || (f === '*' && x[0] !== '.'); });
      if (!hit.length) { if (!P.f['-f']) { err('rm: cannot remove \'' + f + '\': No such file or directory'); ok = false; } return; }
      hit.forEach(function (x) { delete W.files[x]; });
    });
    return ok;
  }
  function shMv(a) {
    if (a.length !== 2) { err('mv: butuh dua argumen: mv lama baru'); return false; }
    if (W.files[a[0]] === undefined) { err('mv: cannot stat \'' + a[0] + '\': No such file or directory'); return false; }
    if (!validFile(a[1])) { err('mv: nama file ga valid'); return false; }
    W.files[a[1]] = W.files[a[0]];
    delete W.files[a[0]];
    if (W.sel === a[0]) W.sel = a[1];
    return true;
  }
  function shSed(a) {
    var inPlace = false, rest = [];
    a.forEach(function (x) { if (x === '-i') inPlace = true; else rest.push(x); });
    var expr = rest[0], files = rest.slice(1);
    var m = expr && /^s(.)(.*)$/.exec(expr);
    if (!m) { err('sed: simulasi ini cuma mendukung bentuk s/lama/baru/'); return false; }
    var d = m[1], parts = [], cur = '', s = m[2];
    for (var i = 0; i < s.length; i++) {
      if (s[i] === '\\' && s[i + 1] === d) { cur += d; i++; continue; }
      if (s[i] === d) { parts.push(cur); cur = ''; continue; }
      cur += s[i];
    }
    parts.push(cur);
    if (parts.length < 3) { err('sed: -e expression #1, char ' + expr.length + ': unterminated `s\' command'); return false; }
    var re;
    try { re = new RegExp(parts[0].replace(/\\([()|{}+?])/g, '$1'), parts[2].indexOf('g') >= 0 ? 'g' : ''); } catch (e) { err('sed: pola ga valid'); return false; }
    if (!files.length) { err('sed: butuh nama file'); return false; }
    var ok = true;
    files.forEach(function (f) {
      if (W.files[f] === undefined) { err('sed: can\'t read ' + f + ': No such file or directory'); ok = false; return; }
      var res = lines(W.files[f]).map(function (l) { return l.replace(re, parts[1].replace(/\\n/g, '\n').replace(/&/g, '$&')); });
      if (inPlace) W.files[f] = join(res);
      else out(res.join('\n'));
    });
    return ok;
  }
  function shEdit(cmd, a) {
    var f = a[0];
    if (!f) { err(cmd + ': butuh nama file'); return false; }
    if (!validFile(f)) { err(cmd + ': nama file ga valid'); return false; }
    if (W.files[f] === undefined) W.files[f] = '';
    W.sel = f;
    W.tab = 'file';
    dim('# ' + f + ' dibuka di tab file. Ketik di sana, perubahannya langsung tersimpan.');
    setTimeout(function () { if (ed) ed.ta.focus(); }, 30);
    return true;
  }

  // ---------- next steps ----------
  function h1(t) { var m = /<h1>(.*?)<\/h1>/.exec(t || ''); return m ? m[1] : null; }
  function sedEsc(s) { return s.replace(/[\\/&]/g, '\\$&'); }
  function suggestMsg() {
    var ch = changes(), p = (ch.staged[0] || {}).p || '';
    var x = ch.staged[0] || {};
    if (p === 'kontak.html' && x.k === 'new file') return 'Tambah halaman kontak';
    if (p === 'style.css') return 'Ubah gaya halaman';
    if (p === 'README.md') return 'Perbarui README';
    if (p === 'index.html') return 'Ubah judul halaman';
    if (x.k === 'new file') return 'Tambah ' + p;
    if (x.k === 'deleted') return 'Hapus ' + p;
    return 'Simpan perubahan';
  }
  function ahead(b, of) { var r = W.repo; return r.branches[b] && r.branches[of] ? range(r.branches[of], r.branches[b]).length : 0; }
  function conflictBranch() {
    var r = W.repo;
    for (var i = 1; i < 20; i++) {
      var n = 'fitur/judul' + (i > 1 ? '-' + i : '');
      if (!W.flags.merged || !W.flags.merged[n]) return n;
    }
    return 'fitur/judul-x';
  }
  function nextSteps() {
    var q = [];
    if (!W.repo) return ['git init', 'git status', 'ls'];
    var r = W.repo, d = M.done, ch = changes(), h = headId(), cur = r.head.ref;
    if (!cfg('user.name')) q.push('git config --global user.name "Kamu"');
    if (!cfg('user.email')) q.push('git config --global user.email kamu@contoh.id');
    if (r.op) {
      var abort = r.op.kind === 'rebase' ? 'git rebase --abort' : r.op.kind === 'merge' ? 'git merge --abort' : r.op.kind === 'pick' ? 'git cherry-pick --abort' : 'git revert --abort';
      if (ch.unmerged.length) {
        var p = ch.unmerged[0];
        if (!W.files[p] || !MARK.test(W.files[p])) q.push('git add ' + p);
        else q.push('git checkout --theirs ' + p, 'cat ' + p, 'git checkout --ours ' + p);
        q.push('git status', abort);
        return q;
      }
      q.push(r.op.kind === 'rebase' ? 'git rebase --continue' : r.op.kind === 'merge' ? 'git commit --no-edit' : r.op.kind === 'pick' ? 'git cherry-pick --continue' : 'git revert --continue');
      q.push('git status', 'git diff --staged', abort);
      return q;
    }
    if (q.length) { q.push('git status'); return q; }
    if (!h) {
      if (!keys(r.index).length) return ['git add .', 'git status', 'git add index.html'];
      return ['git commit -m "Commit pertama"', 'git status', 'git diff --staged'];
    }
    if (ch.unmerged.length) { q.push('git add ' + ch.unmerged[0], 'git status'); return q; }
    var cm = (MISSIONS.filter(function (m) { return !d[m.id]; })[0] || {}).id;
    if (ch.unstaged.length || ch.untracked.length || ch.staged.length) {
      if (cm === 'stash' && (ch.unstaged.length || ch.staged.length) && !r.stash.length) q.push('git stash');
      if (ch.unstaged.length && !W.saw.diff) q.push('git diff');
      if (ch.unstaged.length || ch.untracked.length) q.push(ch.untracked.length === 1 && !ch.unstaged.length ? 'git add ' + ch.untracked[0] : 'git add .');
      if (ch.staged.length && !W.saw.staged) q.push('git diff --staged');
      if (ch.staged.length) q.push('git commit -m "' + suggestMsg() + '"');
      else if (ch.unstaged.length && !ch.untracked.length) q.push('git commit -am "' + (function () { var x = ch.unstaged[0].p; return x === 'README.md' ? 'Perbarui README' : x === 'style.css' ? 'Ubah gaya halaman' : x === 'index.html' ? 'Ubah judul halaman' : 'Simpan perubahan'; })() + '"');
      if (ch.unstaged.length) q.push('git restore ' + ch.unstaged[0].p);
      q.push('git status');
      return q;
    }
    var main = r.branches.main;
    if (cm === 'stage') {
      if (/color: teal;/.test(W.files['style.css'] || '')) q.push('sed -i \'s/color: teal;/color: tomato;/\' style.css');
      q.push('echo "- catatan baru" >> README.md');
    } else if (cm === 'branch' || cm === 'merge') {
      var fb = keys(r.branches).filter(function (b) { return b !== 'main' && ahead(b, 'main'); })[0];
      if (cur === 'main') {
        if (fb) q.push(cm === 'merge' ? 'git merge ' + fb : 'git switch ' + fb);
        else if (!r.branches['fitur/kontak']) q.push('git switch -c fitur/kontak');
        else q.push('git switch fitur/kontak');
      } else if (!ahead(cur, 'main')) {
        if (W.files['kontak.html'] === undefined) q.push('echo "<p>Kontak: halo@contoh.id</p>" > kontak.html');
        else q.push('echo "<p>Instagram: @proyekweb</p>" >> kontak.html');
      } else q.push('git switch main');
    } else if (cm === 'conflict') {
      var cb = conflictBranch(), base = r.branches[cb] && main ? mergeBase(main, r.branches[cb]) : null;
      var t = h1(W.files['index.html']);
      if (cur === cb) {
        if (!ahead(cb, 'main')) {
          if (t !== null) q.push('sed -i \'s/<h1>' + sedEsc(t) + '<\\/h1>/<h1>Judul dari branch fitur<\\/h1>/\' index.html');
          else q.push('echo "<h1>Judul dari branch fitur</h1>" > index.html');
        } else q.push('git switch main');
      } else if (cur === 'main') {
        if (!r.branches[cb]) q.push('git switch -c ' + cb);
        else if (!ahead(cb, 'main')) q.push('git switch ' + cb);
        else if (base === main) {
          if (t !== null) q.push('sed -i \'s/<h1>' + sedEsc(t) + '<\\/h1>/<h1>Judul dari main<\\/h1>/\' index.html');
          else q.push('echo "<h1>Judul dari main</h1>" > index.html');
        } else q.push('git merge ' + cb);
      } else q.push('git switch main');
    } else if (cm === 'push') {
      if (!r.remotes.origin) q.push('git remote add origin ' + URL_OK);
      else if (cur !== 'main') q.push('git switch main');
      else q.push('git push -u origin main', 'git remote -v');
    } else if (cm === 'pull') {
      if (cur !== 'main') q.push('git switch main');
      else {
        var srv = W.server.branches.main, known = r.rtrack['origin/main'];
        if (!W.dinaN && srv && !W.dinaTimer) q.push('git push');
        var mineAhead = srv ? range(srv, h).length : 0;
        if (srv && isAnc(srv, h) && mineAhead) q.push('git push');
        else if (srv && !isAnc(srv, h) && !mineAhead) q.push('echo "- catatan dari kamu" >> README.md', 'git pull');
        else if (srv && !isAnc(srv, h)) {
          if (!W.flags.rejected) q.push('git push');
          if (known !== srv) q.push('git fetch');
          q.push('git pull --no-rebase', 'git pull --rebase');
        } else q.push('echo "- catatan dari kamu" >> README.md');
      }
    } else if (cm === 'stash') {
      if (r.stash.length) {
        var se = r.stash[0], sb = se.msg.replace(/^(WIP on|On) ([^:]+):.*$/, '$2');
        if (W.flags.stashSwitch === false) {
          var other = keys(r.branches).filter(function (b) { return b !== cur; })[0];
          q.push(other ? 'git switch ' + other : 'git switch -c coba');
        } else if (cur !== sb && r.branches[sb]) q.push('git switch ' + sb);
        else q.push('git stash pop');
        q.push('git stash list');
      } else q.push('echo "- ide setengah jadi" >> README.md');
    } else if (cm === 'undo') {
      var last = r.reflog[r.reflog.length - 1], prevE = r.reflog[r.reflog.length - 2];
      if (last && /^reset: /.test(last.msg) && prevE && isLost(prevE.id)) {
        if (!W.saw.reflog) q.push('git reflog');
        q.push('git reset --hard HEAD@{1}', 'git reset --hard ' + short(prevE.id));
      } else if (C[h].parents.length) q.push('git reset --hard HEAD~1', 'git log --oneline');
      else q.push('echo "- catatan" >> README.md');
    } else if (cm === 'rebase') {
      var rb = 'fitur/footer';
      if (!r.branches[rb]) { if (cur === 'main') q.push('git switch -c ' + rb); else q.push('git switch main'); }
      else if (cur === rb) {
        if (!ahead(rb, 'main')) q.push('echo "footer { color: gray; }" >> style.css');
        else if (isAnc(main, r.branches[rb])) q.push('git switch main');
        else q.push('git rebase main');
      } else if (cur === 'main') {
        if (ahead(rb, 'main') && isAnc(main, r.branches[rb])) q.push('echo "- catatan rilis" >> README.md');
        else q.push('git switch ' + rb);
      } else q.push('git switch ' + rb);
    }
    ['git status', 'git log --oneline --graph --all', 'git branch -vv'].forEach(function (c) { if (q.indexOf(c) < 0) q.push(c); });
    return q;
  }

  // ---------- rendering ----------
  var ed, ROW = 34, LANE = 14, LC = ['var(--accent)', 'var(--gx-a)', 'var(--gx-b)', 'var(--gx-c)', 'var(--gx-d)'];
  function cmdBtn(c, label, cls) { return '<button type="button"' + (cls ? ' class="' + cls + '"' : '') + ' data-act="cmd" data-cmd="' + esc(c) + '">' + esc(label || c) + '</button>'; }
  function agoId(t) {
    var s = Math.max(1, Math.round((Date.now() - t) / 1000));
    if (s < 60) return s + ' dtk lalu';
    if (s < 3600) return Math.floor(s / 60) + ' mnt lalu';
    return Math.floor(s / 3600) + ' jam lalu';
  }
  function graphSVG(ids, parentsOf, rowHTML) {
    var rows = layout(ids, parentsOf), at = {}, w = 1;
    rows.forEach(function (rw, i) { at[rw.id] = i; w = Math.max(w, rw.before.length, rw.after.length, rw.lane + 1); });
    var gw = 10 + w * LANE, hgt = rows.length * ROW, paths = [], dots = [];
    function X(l) { return 10 + l * LANE; }
    function Y(i) { return i * ROW + ROW / 2; }
    rows.forEach(function (rw, i) {
      rw.edges.forEach(function (e) {
        var pi = at[e.p], P = rows[pi].lane, E = e.lane, k = rw.lane, d;
        var x1 = X(k), y1 = Y(i), xe = X(E), x2 = X(P), y2 = Y(pi);
        if (pi === i + 1) d = 'M' + x1 + ' ' + y1 + ' C' + x1 + ' ' + (y1 + ROW / 2) + ' ' + x2 + ' ' + (y2 - ROW / 2) + ' ' + x2 + ' ' + y2;
        else {
          d = 'M' + x1 + ' ' + y1 + (E !== k ? ' C' + x1 + ' ' + (y1 + ROW / 2) + ' ' + xe + ' ' + (y1 + ROW / 2) + ' ' + xe + ' ' + (y1 + ROW) : ' L' + xe + ' ' + (y1 + ROW));
          d += ' L' + xe + ' ' + (y2 - ROW);
          d += E !== P ? ' C' + xe + ' ' + (y2 - ROW / 2) + ' ' + x2 + ' ' + (y2 - ROW / 2) + ' ' + x2 + ' ' + y2 : ' L' + x2 + ' ' + y2;
        }
        paths.push('<path d="' + d + '" stroke="' + LC[E % LC.length] + '"' + (rw.id === 'WIP' ? ' stroke-dasharray="3 3"' : '') + '/>');
      });
      var c = LC[rw.lane % LC.length];
      if (rw.id === 'WIP') dots.push('<circle cx="' + X(rw.lane) + '" cy="' + Y(i) + '" r="5" class="gt-wip" stroke="' + c + '"/>');
      else dots.push('<circle cx="' + X(rw.lane) + '" cy="' + Y(i) + '" r="' + (C[rw.id].parents.length > 1 ? 4 : 5) + '" fill="' + c + '" stroke="' + c + '"' + (rw.id === rowHTML.head ? ' class="gt-dhead"' : '') + '/>');
    });
    var body = rows.map(function (rw, i) { return '<div class="gt-row" style="top:' + i * ROW + 'px;height:' + ROW + 'px;padding-left:' + (gw + 6) + 'px">' + rowHTML(rw.id) + '</div>'; }).join('');
    return '<div class="gt-graph" style="height:' + hgt + 'px"><svg class="gt-svg" style="width:' + gw + 'px;height:' + hgt + 'px" viewBox="0 0 ' + gw + ' ' + hgt + '" aria-hidden="true">' + paths.join('') + dots.join('') + '</svg>' + body + '</div>';
  }
  function refChips(d) {
    return d.map(function (x) {
      var cls = x.t === 'head' ? 'is-head' : x.t === 'detached' ? 'is-head' : x.t === 'tag' ? 'is-tag' : x.t === 'remote' ? 'is-remote' : '';
      var label = x.t === 'head' ? 'HEAD → ' + x.n : x.t === 'tag' ? '🏷 ' + x.n : x.n;
      return '<span class="gt-ref ' + cls + '">' + esc(label) + '</span>';
    }).join('');
  }
  function renderGraf() {
    var el = $('gt-v-graf');
    if (!W.repo) { setHTML(el, gate('Folder <b>proyek-web</b> berisi tiga file, tapi belum jadi repo Git. Belum ada riwayat apa pun.', 'git init')); return; }
    var r = W.repo, h = headId(), ch = changes(), nChg = ch.staged.length + ch.unstaged.length + ch.untracked.length + ch.unmerged.length;
    var head = '';
    if (r.op) {
      var opTxt = r.op.kind === 'merge' ? 'Lagi merge <b>' + esc(r.op.label) + '</b>' : r.op.kind === 'rebase' ? 'Lagi rebase <b>' + esc(r.op.branch) + '</b> ke ' + esc(r.op.label) + ' (' + Math.min(r.op.done, r.op.total) + '/' + r.op.total + ')' : r.op.kind === 'pick' ? 'Lagi cherry-pick ' + short(r.op.src) : 'Lagi revert ' + short(r.op.src);
      head += '<div class="gt-banner' + (ch.unmerged.length ? ' is-bad' : '') + '">' + opTxt + '. ' + (ch.unmerged.length ? plural(ch.unmerged.length, 'file').replace('files', 'file') + ' masih konflik: ' + ch.unmerged.map(function (p) { return '<button type="button" class="gt-link" data-act="file" data-f="' + esc(p) + '">' + esc(p) + '</button>'; }).join(', ') + '.' : 'Konflik sudah beres, tinggal lanjutkan.') + '</div>';
    }
    var bs = keys(r.branches);
    head += '<div class="gt-brs">' + bs.map(function (b) {
      var on = b === r.head.ref, t = trackInfo(b);
      return '<button type="button" class="gt-br' + (on ? ' is-on' : '') + '" data-act="cmd" data-cmd="git switch ' + esc(b) + '"' + (on ? ' aria-current="true"' : '') + '><b>' + esc(b) + '</b>' + (t && !t.gone && (t.ahead || t.behind) ? '<small>' + (t.ahead ? '↑' + t.ahead : '') + (t.behind ? '↓' + t.behind : '') + '</small>' : '') + '</button>';
    }).join('') + (!r.head.ref ? '<span class="gt-br is-on is-det"><b>HEAD</b><small>detached</small></span>' : '') + (r.stash.length ? '<span class="gt-stash">stash: ' + r.stash.length + '</span>' : '') + '</div>';
    var set = {};
    localTips().forEach(function (t) { Object.keys(ancestors(t)).forEach(function (c) { set[c] = true; }); });
    var ids = sortIds(set);
    if (!ids.length && !nChg) { setHTML(el, head + gate('Repo-nya sudah ada, tapi belum ada commit. Masukkan file ke staging dulu, lalu commit.', keys(r.index).length ? 'git commit -m "Commit pertama"' : 'git add .')); return; }
    var LIM = 60;
    if (ids.length > LIM) ids = ids.slice(0, LIM);
    var inSet = {};
    ids.forEach(function (i) { inSet[i] = true; });
    if (nChg) ids.unshift('WIP');
    var lostTip = null;
    var lastE = r.reflog[r.reflog.length - 2];
    if (lastE && isLost(lastE.id) && C[lastE.id]) lostTip = lastE.id;
    var rowFn = function (id) {
      if (id === 'WIP') return '<button type="button" class="gt-rb is-wip" data-act="tab" data-tab="file"><span class="gt-msg">' + (ch.unmerged.length ? 'konflik di ' + ch.unmerged.length + ' file' : nChg + ' perubahan belum di-commit') + '</span><small>' + (ch.staged.length ? ch.staged.length + ' di staging' : 'belum di-add') + '</small></button>';
      var c = C[id];
      return '<button type="button" class="gt-rb" data-act="cmd" data-cmd="git show ' + short(id) + '" title="' + esc(c.msg) + '"><code>' + short(id) + '</code>' + refChips(decor(id)) + '<span class="gt-msg">' + esc(subject(id)) + '</span><small>' + esc(c.author.name) + ' · ' + agoId(c.time) + '</small></button>';
    };
    rowFn.head = h;
    var g = graphSVG(ids, function (id) { if (id === 'WIP') return h && inSet[h] ? [h] : []; return parentsIn(id, inSet); }, rowFn);
    var foot = '';
    if (lostTip && !r.op) foot = '<p class="gt-note is-warn">Commit <code>' + short(lostTip) + '</code> (' + esc(subject(lostTip)) + ') baru saja lepas dari branch dan ga kelihatan di graf. Dia belum hilang: ' + cmdBtn('git reflog', 'git reflog') + '</p>';
    setHTML(el, head + g + foot);
  }
  function gate(txt, cmd) { return '<div class="gt-gate"><p>' + txt + '</p>' + (cmd ? cmdBtn(cmd, cmd, 'gx-primary') : '') + '</div>'; }
  function fileState(p) {
    if (!W.repo) return { xy: '', cls: '' };
    var r = W.repo, H = headTree(), I = r.index, F = W.files;
    if (r.unmerged[p]) return { xy: 'UU', cls: 'is-bad', t: 'konflik' };
    if (I[p] === undefined && F[p] !== undefined) return ignored(p) ? { xy: '!!', cls: 'is-ign', t: 'diabaikan' } : { xy: '??', cls: 'is-new', t: 'untracked' };
    var x = I[p] === H[p] ? ' ' : H[p] === undefined ? 'A' : I[p] === undefined ? 'D' : 'M';
    var y = I[p] === undefined ? ' ' : F[p] === undefined ? 'D' : F[p] !== I[p] ? 'M' : ' ';
    if (x === ' ' && y === ' ') return { xy: '', cls: '', t: 'bersih' };
    return { xy: x + y, cls: y !== ' ' ? 'is-mod' : 'is-staged', t: y !== ' ' ? (x !== ' ' ? 'sebagian di staging' : 'berubah') : 'di staging' };
  }
  function renderFile() {
    var r = W.repo, all = union(W.files, r ? r.index : {}, r ? r.unmerged : {});
    if (W.files[W.sel] === undefined && all.indexOf(W.sel) < 0) W.sel = keys(W.files)[0] || '';
    setHTML($('gt-files'), '<div class="gt-flist" role="list">' + all.map(function (p) {
      var s = fileState(p), gone = W.files[p] === undefined;
      return '<button type="button" role="listitem" class="gt-f ' + s.cls + (p === W.sel ? ' is-sel' : '') + (gone ? ' is-gone' : '') + '" data-act="file" data-f="' + esc(p) + '"' + (p === W.sel ? ' aria-current="true"' : '') + '><i>' + esc(s.xy || '\u00a0\u00a0') + '</i><span>' + esc(p) + '</span></button>';
    }).join('') + '</div>');
    var p = W.sel, s = fileState(p), bar = '';
    if (p) {
      bar = '<div class="gt-fh"><b>' + esc(p) + '</b><em>' + esc(s.t || (r ? '' : 'belum ada repo')) + '</em></div>';
      var acts = [];
      if (r) {
        if (r.unmerged[p]) {
          bar += '<p class="gt-note is-bad">File ini <b>konflik</b>. Pilih isi yang benar di antara <code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code> dan <code>&gt;&gt;&gt;&gt;&gt;&gt;&gt;</code>, hapus penandanya, lalu <code>git add</code>.</p>';
          acts.push(cmdBtn('git checkout --ours ' + p, 'pakai versi HEAD'), cmdBtn('git checkout --theirs ' + p, 'pakai versi yang masuk'));
          acts.push('<button type="button" data-act="both">gabung keduanya</button>');
          acts.push(cmdBtn('git add ' + p, 'git add ' + p, 'gx-primary'));
        } else {
          if (s.xy && s.xy[1] !== ' ' || s.xy === '??') acts.push(cmdBtn('git add ' + p, 'git add', 'gx-primary'));
          if (s.xy && s.xy[1] === 'M') acts.push(cmdBtn('git diff ' + p, 'git diff'), cmdBtn('git restore ' + p, 'restore', 'gt-del'));
          if (s.xy && s.xy[0] !== ' ' && s.xy !== '??') acts.push(cmdBtn('git diff --staged ' + p, 'diff --staged'), cmdBtn('git restore --staged ' + p, 'unstage'));
          if (headId() && headTree()[p] !== undefined && !s.xy) acts.push(cmdBtn('git log --oneline ' + p, 'riwayat'));
        }
      }
      if (acts.length) bar += '<div class="gt-facts">' + acts.join('') + '</div>';
    }
    setHTML($('gt-fbar'), bar);
    var edEl = $('gt-ed'), gone = !p || W.files[p] === undefined;
    edEl.hidden = gone;
    if (!gone && ed.get() !== W.files[p]) { painting = true; ed.set(W.files[p]); painting = false; }
    if (gone && p) setHTML($('gt-fbar'), $('gt-fbar').innerHTML + '<p class="gt-note">File ini sudah dihapus dari working dir. ' + (r && r.index[p] !== undefined ? cmdBtn('git restore ' + p, 'kembalikan') + ' atau ' + cmdBtn('git rm ' + p, 'git rm') : '') + '</p>');
  }
  function renderRemote() {
    var el = $('gt-v-remote');
    if (!W.repo || !W.repo.remotes.origin) {
      setHTML(el, gate('Di GitHub sudah ada repo kosong <b>kamu/proyek-web</b>. Sambungkan repo lokal ke sana sebagai <b>origin</b>.', W.repo ? 'git remote add origin ' + URL_OK : 'git init'));
      return;
    }
    var r = W.repo, s = W.server, url = r.remotes.origin.url;
    var hdr = '<div class="gt-gh"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18.5h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 9.6 4.5 4.5 0 0 0 7 18.5z"/></svg><div><b>github.com/kamu/proyek-web</b><small>' + esc(url) + (srvFor(url) ? '' : ' · alamat ini salah') + '</small></div></div>';
    var bs = keys(s.branches);
    if (!bs.length) { setHTML(el, hdr + gate('Repo di GitHub masih kosong. Kirim branch main ke sana.', 'git push -u origin ' + (r.head.ref || 'main'))); return; }
    var rows = bs.map(function (b) {
      var id = s.branches[b], loc = r.branches[b], known = r.rtrack['origin/' + b], st;
      if (!loc) st = 'belum ada di lokal';
      else if (loc === id) st = 'sama dengan lokal';
      else {
        var a1 = r.have[id] ? range(id, loc).length : range(id, loc).length, b1 = range(loc, id).length;
        st = (a1 ? 'lokal +' + a1 : '') + (a1 && b1 ? ' · ' : '') + (b1 ? 'origin +' + b1 + (known !== id ? ' (belum di-fetch)' : '') : '');
      }
      return '<div class="gt-rbr"><b>' + esc(b) + '</b><code>' + short(id) + '</code><span>' + esc(st) + '</span></div>';
    }).join('');
    var set = {};
    bs.forEach(function (b) { Object.keys(ancestors(s.branches[b])).forEach(function (c) { set[c] = true; }); });
    keys(s.tags).forEach(function (t) { Object.keys(ancestors(s.tags[t])).forEach(function (c) { set[c] = true; }); });
    var ids = sortIds(set).slice(0, 40), inSet = {};
    ids.forEach(function (i) { inSet[i] = true; });
    var rowFn = function (id) {
      var c = C[id], fresh = !r.have[id];
      return '<div class="gt-rb' + (fresh ? ' is-fresh' : '') + '"><code>' + short(id) + '</code>' + refChips(decor(id, true)) + '<span class="gt-msg">' + esc(subject(id)) + '</span><small>' + esc(c.author.name) + (fresh ? ' · baru' : '') + '</small></div>';
    };
    var g = graphSVG(ids, function (id) { return parentsIn(id, inSet); }, rowFn);
    var acts = '<div class="gt-facts">' + cmdBtn('git fetch') + cmdBtn('git pull') + cmdBtn('git push') + (s.branches.main ? '<button type="button" data-act="dina">Dina push commit baru</button>' : '') + '</div>';
    setHTML(el, hdr + '<div class="gt-rbrs">' + rows + '</div>' + acts + '<p class="gt-sub">commit di GitHub</p>' + g + '<p class="gt-note">Commit bertanda <b>baru</b> belum ada di laptop kamu. <code>git fetch</code> mengambilnya ke <code>origin/main</code> tanpa mengubah branch kamu.</p>');
  }
  function renderFlow() {
    var r = W.repo, w = $('gt-f-work'), st = $('gt-f-stage'), rp = $('gt-f-repo'), o = $('gt-f-origin');
    if (!r) {
      setText(w, keys(W.files).length + ' file'); w.dataset.s = '';
      setText(st, 'belum ada'); st.dataset.s = '';
      setText(rp, 'belum git init'); rp.dataset.s = 'warn';
      setText(o, 'belum ada'); o.dataset.s = '';
      return;
    }
    var ch = changes(), nw = ch.unstaged.length + ch.untracked.length;
    setText(w, ch.unmerged.length ? ch.unmerged.length + ' konflik' : nw ? nw + ' berubah' : 'bersih');
    w.dataset.s = ch.unmerged.length ? 'bad' : nw ? 'warn' : 'ok';
    setText(st, ch.staged.length ? ch.staged.length + ' file siap' : 'kosong');
    st.dataset.s = ch.staged.length ? 'info' : '';
    var h = headId();
    setText(rp, (r.head.ref || 'HEAD') + (h ? ' · ' + short(h) : ' · 0 commit'));
    rp.dataset.s = h ? 'ok' : '';
    if (!r.remotes.origin) { setText(o, 'belum disambung'); o.dataset.s = ''; return; }
    var srv = W.server.branches[r.head.ref || 'main'];
    if (!srv) { setText(o, 'kosong'); o.dataset.s = 'warn'; return; }
    if (!h) { setText(o, 'ada ' + short(srv)); o.dataset.s = 'info'; return; }
    var a1 = range(srv, h).length, b1 = range(h, srv).length;
    setText(o, !a1 && !b1 ? 'sinkron' : (a1 ? 'kamu +' + a1 : '') + (a1 && b1 ? ' · ' : '') + (b1 ? 'origin +' + b1 : ''));
    o.dataset.s = !a1 && !b1 ? 'ok' : b1 ? 'warn' : 'info';
  }
  function renderQuick() {
    var q = nextSteps().filter(function (c, i, a) { return a.indexOf(c) === i; }).slice(0, 7);
    setHTML($('gt-quick'), q.map(function (c) { return cmdBtn(c); }).join(''));
  }
  var painting = false;
  function render() {
    var r = W.repo;
    setText($('gt-ps'), window.matchMedia('(max-width: 640px)').matches ? prompt().replace('kamu@laptop:', '') : prompt());
    var bc = $('gt-br');
    setText(bc, r ? (r.head.ref ? r.head.ref : 'HEAD ' + short(headId())) : 'bukan repo');
    bc.classList.toggle('is-on', !!r);
    var oc = $('gt-op');
    setText(oc, r && r.op ? branchLabel().split('|')[1] : r ? (headId() ? Object.keys(ancestors(headId())).length + ' commit' : 'belum ada commit') : 'belum git init');
    oc.dataset.s = r && r.op ? (Object.keys(r.unmerged).length ? 'bad' : 'warn') : '';
    app.querySelectorAll('.gt-tabs [role="tab"]').forEach(function (b) {
      var on = b.dataset.tab === W.tab;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    app.querySelectorAll('.gt-view').forEach(function (v) { v.hidden = v.dataset.view !== W.tab; });
    var ch = r ? changes() : null;
    setText($('gt-n-file'), ch ? String((ch.staged.length + ch.unstaged.length + ch.untracked.length + ch.unmerged.length) || '') : '');
    var fresh = 0;
    if (r && r.remotes.origin) Object.keys(W.server.branches).forEach(function (b) { fresh += Object.keys(ancestors(W.server.branches[b])).filter(function (c) { return !r.have[c]; }).length; });
    setText($('gt-n-remote'), fresh ? String(fresh) : '');
    setText($('gt-n-graf'), r && r.op ? '!' : '');
    renderFlow();
    renderQuick();
    if (W.tab === 'graf') renderGraf();
    if (W.tab === 'file') renderFile();
    if (W.tab === 'remote') renderRemote();
  }

  // ---------- wiring ----------
  initWorld();
  ed = new K.Editor($('gt-ed'), {
    label: 'Editor file',
    value: '',
    highlight: function (l) {
      if (/^(<{7}|={7}|>{7})( |$)/.test(l)) return '<span class="gt-mk">' + esc(l) + '</span>';
      return /\.html?$/.test(W.sel) ? K.hlJinja(l) : /\.md$/.test(W.sel) && /^#/.test(l) ? '<span class="sx-k">' + esc(l) + '</span>' : esc(l);
    },
    onChange: function (v) {
      if (painting || !W.sel || W.files[W.sel] === undefined) return;
      W.files[W.sel] = v;
      renderFlow();
      renderQuick();
      var ch = W.repo ? changes() : null;
      setText($('gt-n-file'), ch ? String((ch.staged.length + ch.unstaged.length + ch.untracked.length + ch.unmerged.length) || '') : '');
      // refresh the status line and buttons without repainting the editor
      var keepSel = W.sel, el = $('gt-files');
      el.querySelectorAll('.gt-f').forEach(function (b) {
        var s = fileState(b.dataset.f), i = b.querySelector('i');
        i.textContent = s.xy || '\u00a0\u00a0';
        b.className = 'gt-f ' + s.cls + (b.dataset.f === keepSel ? ' is-sel' : '');
      });
    }
  });
  ed.ta.addEventListener('blur', function () { renderFile(); });
  app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    var act = b.dataset.act;
    if (act === 'cmd') term.submit(b.dataset.cmd);
    else if (act === 'tab') { W.tab = b.dataset.tab; render(); }
    else if (act === 'file') { W.sel = b.dataset.f; W.tab = 'file'; render(); }
    else if (act === 'dina') { if (W.dinaTimer) { clearTimeout(W.dinaTimer); W.dinaTimer = null; } dinaPush(); }
    else if (act === 'both') {
      var p = W.sel, v = W.files[p];
      if (v === undefined) return;
      W.files[p] = join(lines(v).filter(function (l) { return !/^(<{7}|={7}|>{7})( |$)/.test(l); }));
      toast('Penanda konflik dihapus, dua versi disimpan. Cek isinya, lalu git add.');
      render();
    }
    else if (act === 'reset') reset();
  });
  app.querySelector('.gt-tabs').addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    var tabs = ['graf', 'file', 'remote'], i = tabs.indexOf(W.tab);
    W.tab = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    render();
    $('gt-tab-' + W.tab).focus();
  });
  setInterval(function () { if (W.tab === 'graf' && document.visibilityState === 'visible' && !app.querySelector('.gt-graph:hover')) renderGraf(); }, 15000);

  function reset() {
    initWorld();
    term.clear();
    M.reset();
    term.lines([
      '<span class="sx-dim"># Ini terminal laptop kamu, di folder ~/proyek-web yang berisi tiga file: index.html, style.css, dan README.md. Belum ada Git di sini.</span>',
      '<span class="sx-dim"># Mulai dengan </span><b>git init</b><span class="sx-dim">. Ketik </span><b>help</b><span class="sx-dim"> buat daftar perintah, atau klik tombol di bawah.</span>'
    ]);
    render();
  }
  reset();
})();
