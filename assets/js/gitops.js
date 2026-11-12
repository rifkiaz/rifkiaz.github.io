// GitOps simulator for /gitops/. A toy model of Git + Argo CD + a Deployment:
// commits change the desired state, Argo CD notices them on refresh/poll and
// syncs, and the Deployment controller rolls pods. Everything lives in memory.
(function () {
  'use strict';

  var app = document.getElementById('gx');
  var EN = (document.documentElement.lang || '').slice(0, 2) === 'en';
  function tr(id, en) { return EN ? en : id; }
  if (!app) return;

  function $(id) { return document.getElementById(id); }

  // ---------- model constants ----------
  var TAGS = {
    'v1.0.0': { hue: 'a' },
    'v1.1.0': { hue: 'b' },
    'v2.0.0': { hue: 'c', broken: true },
    'v1.0.1-hotfix': { hue: 'd' }
  };
  var POLL = 10000;      // Argo CD polls Git every 3 minutes; sped up here
  var HEAL_DELAY = 3000; // wait before self-heal kicks in
  var SYNC_TIME = 900;
  var DEADLINE = 9000;   // stand-in for progressDeadlineSeconds
  var T = { pending: 450, create: 1300, crash: 900, back: 2400, term: 1200 };
  var MAX_REP = 6;

  var MISSIONS = [
    { id: 'commit', text: tr('Ubah <b>replicas</b> di Git, lalu <i>commit &amp; push</i>.', 'Change <b>replicas</b> in Git, then <i>commit &amp; push</i>.') },
    { id: 'manual', text: tr('Tunggu Argo CD jadi <b>OutOfSync</b> (atau klik <i>refresh</i>), lalu <i>sync</i> manual.', 'Wait for Argo CD to go <b>OutOfSync</b> (or click <i>refresh</i>), then <i>sync</i> manually.') },
    { id: 'auto', text: tr('Nyalakan <b>auto-sync</b>, lalu rilis <b>v1.1.0</b> tanpa klik sync.', 'Turn on <b>auto-sync</b>, then release <b>v1.1.0</b> without clicking sync.') },
    { id: 'heal', text: tr('Ubah cluster pakai <b>kubectl</b>, lalu biarkan <b>self-heal</b> membereskannya.', 'Change the cluster with <b>kubectl</b>, then let <b>self-heal</b> fix it.') },
    { id: 'recover', text: tr('Rilis <b>v2.0.0</b> (yang ada bug), lalu pulihkan aplikasinya.', 'Release <b>v2.0.0</b> (the buggy one), then recover the app.') }
  ];

  // ---------- helpers ----------
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function hex(n) {
    var s = '';
    while (s.length < n) s += Math.floor(Math.random() * 16).toString(16);
    return s;
  }
  var ALNUM = 'bcdfghjklmnpqrstvwxz2456789';
  function rnd(n) {
    var s = '';
    while (s.length < n) s += ALNUM[Math.floor(Math.random() * ALNUM.length)];
    return s;
  }
  function hashOf(str) {
    var h = 7;
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    var s = '';
    for (var j = 0; j < 9; j++) { s += ALNUM[h % ALNUM.length]; h = Math.floor(h / ALNUM.length) + 13 * j; }
    return s.slice(0, 9);
  }
  function copy(spec) { return { replicas: spec.replicas, tag: spec.tag }; }
  function same(a, b) { return a.replicas === b.replicas && a.tag === b.tag; }
  function clock(t) {
    var d = new Date(t);
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map(function (n) { return (n < 10 ? '0' : '') + n; }).join(':');
  }
  function ago(t) {
    var s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return tr('baru saja', 'just now');
    return Math.floor(s / 60) + tr(' mnt lalu', ' min ago');
  }
  function setHTML(el, html) {
    if (el._h === html) return;
    el._h = html;
    el.innerHTML = html;
  }
  function setText(el, txt) { if (el.textContent !== txt) el.textContent = txt; }

  // ---------- state ----------
  var S;
  function initState() {
    var now = Date.now();
    var c0 = { sha: hex(7), msg: 'init: deploy toko-web v1.0.0', spec: { replicas: 3, tag: 'v1.0.0' }, at: now - 240000 };
    S = {
      commits: [c0],
      draft: copy(c0.spec),
      known: c0.sha,
      synced: c0.sha,
      live: copy(c0.spec),
      pods: [],
      rsOrder: ['v1.0.0'],
      auto: false,
      heal: false,
      syncing: null,
      history: [{ n: 1, sha: c0.sha, at: now - 230000 }],
      nextPoll: now + POLL,
      healAt: 0,
      rolloutAt: 0,
      health: 'Healthy',
      sawDegraded: false,
      done: {},
      logs: []
    };
    for (var i = 0; i < 3; i++) S.pods.push(newPod('v1.0.0', true));
  }
  function head() { return S.commits[S.commits.length - 1]; }
  function commitOf(sha) {
    for (var i = S.commits.length - 1; i >= 0; i--) if (S.commits[i].sha === sha) return S.commits[i];
    return null;
  }
  function target() { return commitOf(S.known).spec; }
  function diffs() {
    var t = target(), out = [];
    if (t.replicas !== S.live.replicas) out.push({ f: 'replicas', git: t.replicas, live: S.live.replicas });
    if (t.tag !== S.live.tag) out.push({ f: 'image', git: 'toko-web:' + t.tag, live: 'toko-web:' + S.live.tag });
    return out;
  }
  function syncStatus() { return S.syncing ? 'Syncing' : diffs().length ? 'OutOfSync' : 'Synced'; }

  // ---------- event log ----------
  var termEl = $('gx-term');
  function log(src, msg) {
    S.logs.push({ t: Date.now(), src: src, msg: msg });
    if (S.logs.length > 80) S.logs.shift();
    var line = document.createElement('div');
    line.className = 'gx-ln';
    line.innerHTML = '<time>' + clock(Date.now()) + '</time><b class="gx-src-' + src + '">' + src + '</b><span>' + msg + '</span>';
    termEl.appendChild(line);
    while (termEl.childNodes.length > 80) termEl.removeChild(termEl.firstChild);
    termEl.scrollTop = termEl.scrollHeight;
  }

  // ---------- flow strip ----------
  function pulse(name) {
    var el = app.querySelector('[data-link="' + name + '"]');
    if (!el) return;
    el.classList.remove('is-go');
    void el.offsetWidth;
    el.classList.add('is-go');
    setTimeout(function () { el.classList.remove('is-go'); }, 1300);
  }
  function flash(node, kind) {
    var el = app.querySelector('[data-node="' + node + '"]');
    if (!el) return;
    el.classList.remove('is-flash', 'is-warn');
    void el.offsetWidth;
    el.classList.add(kind === 'warn' ? 'is-warn' : 'is-flash');
    setTimeout(function () { el.classList.remove('is-flash', 'is-warn'); }, 1200);
  }

  // ---------- toast ----------
  var toastEl = $('gx-toast'), toastTimer;
  function toast(msg) {
    toastEl.innerHTML = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-on'); }, 2800);
  }

  // ---------- missions ----------
  function mission(id) {
    if (S.done[id]) return;
    S.done[id] = true;
    var n = 0, idx = 0;
    MISSIONS.forEach(function (m, i) { if (S.done[m.id]) n++; if (m.id === id) idx = i; });
    if (n === MISSIONS.length) toast(tr('🎉 Semua misi beres. Kamu udah paham alur GitOps!', '🎉 All missions done. You\'ve got the GitOps flow down!'));
    else toast(tr('✓ Misi ', '✓ Mission ') + (idx + 1) + tr(' beres (', ' done (') + n + '/' + MISSIONS.length + ')');
  }

  // ---------- pods & deployment controller ----------
  function newPod(tag, ready) {
    return {
      id: rnd(5), tag: tag, t: Date.now(), restarts: 0, term: false, crashed: false,
      phase: ready ? 'Running' : 'Pending', ready: !!ready
    };
  }
  function podName(p) { return 'toko-web-' + hashOf(p.tag) + '-' + p.id; }
  function stepPod(p, now) {
    var dt = now - p.t;
    var broken = TAGS[p.tag].broken;
    if (p.term) return dt > T.term ? 'gone' : null;
    if (p.phase === 'Pending' && dt > T.pending) { p.phase = 'ContainerCreating'; p.t = now; }
    else if (p.phase === 'ContainerCreating' && dt > T.create) {
      p.phase = 'Running'; p.t = now; p.ready = !broken;
    } else if (p.phase === 'Running' && broken && dt > T.crash) {
      p.phase = 'CrashLoopBackOff'; p.t = now; p.restarts++;
      if (!p.crashed) {
        p.crashed = true;
        log('k8s', 'pod <b>' + podName(p) + '</b> crash: <em class="gx-bad">CrashLoopBackOff</em> (panic: nil pointer dereference)');
      }
    } else if (p.phase === 'CrashLoopBackOff' && dt > T.back) { p.phase = 'Running'; p.t = now; }
    return null;
  }
  function kill(p, why) {
    p.term = true; p.ready = false; p.t = Date.now();
    if (why) log('k8s', why + ' <b>' + podName(p) + '</b>');
  }
  function controller() {
    var R = S.live.replicas, tag = S.live.tag;
    var alive = S.pods.filter(function (p) { return !p.term; });
    var fresh = alive.filter(function (p) { return p.tag === tag; });
    var old = alive.filter(function (p) { return p.tag !== tag; });
    var readyAll = alive.filter(function (p) { return p.ready; }).length;

    if (S.rsOrder[S.rsOrder.length - 1] !== tag) {
      var seen = S.rsOrder.indexOf(tag) >= 0;
      S.rsOrder = S.rsOrder.filter(function (t) { return t !== tag; });
      S.rsOrder.push(tag);
      log('k8s', (seen ? tr('pakai lagi ReplicaSet lama', 'reusing old ReplicaSet') : tr('ReplicaSet baru', 'new ReplicaSet')) + ' <b>toko-web-' + hashOf(tag) + tr('</b> untuk image ', '</b> for image ') + tag);
    }

    if (!old.length) {
      if (fresh.length < R) {
        for (var i = fresh.length; i < R; i++) S.pods.push(newPod(tag));
        log('k8s', 'scale up ke ' + R + ' pod (' + tag + ')');
      } else if (fresh.length > R) {
        // drop the least useful pods first: not ready, then newest
        fresh.sort(function (a, b) { return (a.ready - b.ready) || (b.t - a.t); });
        fresh.slice(0, fresh.length - R).forEach(function (p) { kill(p); });
        log('k8s', 'scale down ke ' + R + ' pod');
      }
      return;
    }

    // rolling update: maxSurge 1, maxUnavailable 0
    old.forEach(function (p) { if (!p.ready) kill(p, tr('hapus pod lama yang ga sehat', 'delete unhealthy old pod')); });
    old = old.filter(function (p) { return !p.term; });
    if (fresh.length < R && fresh.length + old.length < R + 1) S.pods.push(newPod(tag));
    if (old.length && readyAll - 1 >= R) kill(old[0], tr('matikan pod lama', 'stop old pod'));
    else if (old.length && fresh.length >= R && fresh.every(function (p) { return p.ready; })) kill(old[0], tr('matikan pod lama', 'stop old pod'));
  }
  function healthNow() {
    var R = S.live.replicas;
    var alive = S.pods.filter(function (p) { return !p.term; });
    var fresh = alive.filter(function (p) { return p.tag === S.live.tag; });
    var done = alive.length === R && fresh.length === R && fresh.every(function (p) { return p.ready; });
    if (done) { S.rolloutAt = 0; return 'Healthy'; }
    if (!S.rolloutAt) S.rolloutAt = Date.now();
    var crash = alive.some(function (p) { return p.crashed; });
    if (crash && Date.now() - S.rolloutAt > DEADLINE) return 'Degraded';
    return 'Progressing';
  }

  // ---------- actions ----------
  function setLive(spec) {
    if (same(spec, S.live)) return false;
    S.live = copy(spec);
    S.rolloutAt = Date.now();
    return true;
  }
  function autoMsg() {
    var h = head().spec, d = S.draft, parts = [];
    if (d.tag !== h.tag) parts.push(tr('rilis ', 'release ') + d.tag);
    if (d.replicas !== h.replicas) parts.push(tr('scale ke ', 'scale to ') + d.replicas + ' replicas');
    return parts.length ? parts.join(', ') : '';
  }
  var msgEl = $('gx-msg'), msgTouched = false;

  function commit() {
    var h = head();
    if (same(S.draft, h.spec)) { toast(tr('Belum ada yang diubah di manifest.', 'Nothing has changed in the manifest yet.')); return; }
    var msg = msgEl.value.trim() || autoMsg();
    var c = { sha: hex(7), msg: msg, spec: copy(S.draft), at: Date.now() };
    S.commits.push(c);
    if (c.spec.replicas !== h.spec.replicas) mission('commit');
    log('git', 'push <b>' + c.sha + tr('</b> ke main: ', '</b> to main: ') + esc(msg));
    pulse('push'); flash('git');
    msgTouched = false; msgEl.value = '';
    if (!S.auto) {
      var left = Math.max(1, Math.ceil((S.nextPoll - Date.now()) / 1000));
      log('argo', tr('belum tahu ada commit baru, polling berikutnya ', 'doesn\'t know about the new commit yet, next poll in ') + left + tr(' detik lagi', ' seconds'));
    }
  }
  function revertHead() {
    if (S.commits.length < 2) return;
    var h = head(), prev = S.commits[S.commits.length - 2];
    var c = { sha: hex(7), msg: 'Revert "' + h.msg + '"', spec: copy(prev.spec), at: Date.now() };
    S.commits.push(c);
    S.draft = copy(c.spec);
    msgTouched = false; msgEl.value = '';
    log('git', 'push <b>' + c.sha + '</b>: ' + esc(c.msg));
    pulse('push'); flash('git');
  }
  function refresh(manual) {
    var h = head();
    S.nextPoll = Date.now() + POLL;
    pulse('pull');
    if (h.sha !== S.known) {
      S.known = h.sha;
      log('argo', (manual ? 'refresh' : 'polling') + tr(': revisi baru <b>', ': new revision <b>') + h.sha + tr('</b> di Git', '</b> in Git') + (diffs().length ? ' → <em class="gx-warn">OutOfSync</em>' : ''));
      flash('argo');
    } else if (manual) {
      log('argo', tr('refresh: Git masih di <b>', 'refresh: Git is still at <b>') + h.sha + tr('</b>, ga ada yang baru', '</b>, nothing new'));
    }
    if (S.auto && S.known !== S.synced) sync('auto-sync');
  }
  function sync(reason, sha) {
    if (S.syncing) return;
    var to = sha || S.known;
    S.syncing = { reason: reason, sha: to };
    log('argo', reason + tr(': menerapkan revisi <b>', ': applying revision <b>') + to + tr('</b> ke cluster…', '</b> to the cluster…'));
    pulse('apply');
    setTimeout(function () {
      var spec = commitOf(to).spec;
      var changed = setLive(spec);
      S.synced = to;
      S.syncing = null;
      S.healAt = 0;
      S.history.push({ n: S.history.length + 1, sha: to, at: Date.now(), rb: reason === 'rollback' });
      log('argo', tr('sync selesai', 'sync finished') + (changed ? tr(', rollout dimulai', ', rollout started') : tr(', ga ada perubahan', ', no changes')) + ' → <em class="gx-ok">Synced</em>');
      flash('k8s');
      if (reason === 'sync manual' && changed) mission('manual');
      if (reason === 'auto-sync' && changed && spec.tag === 'v1.1.0') mission('auto');
      if (reason === 'self-heal') mission('heal');
    }, SYNC_TIME);
  }
  function rollback(n) {
    if (S.auto) { toast(tr('Matikan auto-sync dulu. Kalau nyala, Argo CD bakal langsung balik ke HEAD.', 'Turn off auto-sync first. While it\'s on, Argo CD goes straight back to HEAD.')); return; }
    var h = S.history[n - 1];
    if (!h) return;
    log('argo', 'rollback ke history #' + n + ' (' + h.sha + ')');
    sync('rollback', h.sha);
  }
  function drifted(what) {
    log('argo', tr('live state beda dengan Git (', 'live state differs from Git (') + what + ') → <em class="gx-warn">OutOfSync</em>' + (S.heal ? tr(', self-heal dalam ', ', self-heal in ') + HEAL_DELAY / 1000 + tr(' detik', ' seconds') : ''));
    flash('k8s', 'warn');
  }
  function kubectl(kind) {
    if (kind === 'scale') {
      var n = S.live.replicas >= MAX_REP ? 1 : MAX_REP;
      log('kubectl', 'scale deployment toko-web --replicas=' + n);
      setLive({ replicas: n, tag: S.live.tag });
      if (diffs().length) drifted('replicas');
    } else if (kind === 'image') {
      var tg = S.live.tag === 'v1.0.1-hotfix' ? target().tag : 'v1.0.1-hotfix';
      log('kubectl', 'set image deployment/toko-web web=toko-web:' + tg);
      setLive({ replicas: S.live.replicas, tag: tg });
      if (diffs().length) drifted('image');
    } else if (kind === 'delete') {
      var p = S.pods.filter(function (x) { return !x.term; })[0];
      if (!p) return;
      log('kubectl', 'delete pod ' + podName(p));
      kill(p);
      log('k8s', tr('ReplicaSet bikin pod pengganti (ini bukan drift, spec Deployment ga berubah)', 'ReplicaSet creates a replacement pod (this isn\'t drift, the Deployment spec didn\'t change)'));
    }
  }

  // ---------- rendering ----------
  var yamlEl = $('gx-yaml');
  function k(s) { return '<i>' + s + '</i>'; }
  var YAML = [
    k('apiVersion') + ': apps/v1',
    k('kind') + ': Deployment',
    k('metadata') + ':',
    '  ' + k('name') + ': toko-web',
    '  ' + k('namespace') + ': toko',
    k('spec') + ':',
    '@replicas',
    '  ' + k('strategy') + ':',
    '    ' + k('rollingUpdate') + ': { ' + k('maxSurge') + ': 1, ' + k('maxUnavailable') + ': 0 }',
    '  ' + k('template') + ':',
    '    ' + k('spec') + ':',
    '      ' + k('containers') + ':',
    '        - ' + k('name') + ': web',
    '@tag'
  ];
  yamlEl.innerHTML = YAML.map(function (l, i) {
    var body = l;
    var f = '';
    if (l === '@replicas') {
      f = 'replicas';
      body = '  ' + k('replicas') + ': <span class="gx-num"><button type="button" data-act="rep-" aria-label="' + tr('Kurangi replicas', 'Fewer replicas') + '">−</button><output id="gx-rep">3</output><button type="button" data-act="rep+" aria-label="' + tr('Tambah replicas', 'More replicas') + '">+</button></span>';
    } else if (l === '@tag') {
      f = 'tag';
      body = '          ' + k('image') + ': toko-web:<select id="gx-tag" aria-label="Tag image">' +
        tr('<option value="v1.0.0">v1.0.0</option><option value="v1.1.0">v1.1.0</option><option value="v2.0.0">v2.0.0 (ada bug)</option></select>', '<option value="v1.0.0">v1.0.0</option><option value="v1.1.0">v1.1.0</option><option value="v2.0.0">v2.0.0 (buggy)</option></select>');
    }
    return '<div class="gx-l' + (f ? ' gx-edit' : '') + '"' + (f ? ' data-f="' + f + '"' : '') + '><span class="gx-no">' + (i + 1) + '</span><code>' + body + '</code></div>';
  }).join('');
  var repEl = $('gx-rep'), tagEl = $('gx-tag');
  var lineRep = yamlEl.querySelector('[data-f="replicas"]'), lineTag = yamlEl.querySelector('[data-f="tag"]');

  var els = {
    fDev: $('gx-f-dev'), fGit: $('gx-f-git'), fArgo: $('gx-f-argo'), fK8s: $('gx-f-k8s'),
    sync: $('gx-sync'), health: $('gx-health'), rev: $('gx-rev'),
    auto: $('gx-auto'), heal: $('gx-heal'),
    pollBar: $('gx-poll-bar'), pollTxt: $('gx-poll-txt'),
    diff: $('gx-diff'), tree: $('gx-tree'), hist: $('gx-hist'), histNote: $('gx-hist-note'),
    commits: $('gx-commits'), cmds: $('gx-cmds'), mList: $('gx-m-list'), mCount: $('gx-m-count')
  };
  var btn = function (act) { return app.querySelector('[data-act="' + act + '"]'); };

  var BADGE = {
    Synced: 'ok', OutOfSync: 'warn', Syncing: 'info',
    Healthy: 'ok', Progressing: 'info', Degraded: 'bad'
  };
  var ICON = {
    Synced: '✓', OutOfSync: '⇄', Syncing: '↻', Healthy: '♥', Progressing: '◔', Degraded: '✕'
  };
  function badge(el, label, val) {
    setHTML(el, '<small>' + label + '</small><span>' + ICON[val] + ' ' + val + '</span>');
    el.dataset.s = BADGE[val];
  }

  function render() {
    var now = Date.now();
    var h = head(), st = syncStatus(), hl = S.health;
    var dirty = !same(S.draft, h.spec);
    var alive = S.pods.filter(function (p) { return !p.term; });
    var ready = alive.filter(function (p) { return p.ready; }).length;

    // flow strip
    setText(els.fDev, dirty ? tr('ada perubahan', 'changed') : tr('bersih', 'clean'));
    setText(els.fGit, h.sha);
    setText(els.fArgo, st);
    setText(els.fK8s, hl + ' ' + ready + '/' + S.live.replicas);
    els.fDev.dataset.s = dirty ? 'warn' : '';
    els.fArgo.dataset.s = BADGE[st];
    els.fK8s.dataset.s = BADGE[hl];

    // git editor
    setText(repEl, String(S.draft.replicas));
    if (tagEl.value !== S.draft.tag) tagEl.value = S.draft.tag;
    lineRep.classList.toggle('is-mod', S.draft.replicas !== h.spec.replicas);
    lineTag.classList.toggle('is-mod', S.draft.tag !== h.spec.tag);
    btn('rep-').disabled = S.draft.replicas <= 1;
    btn('rep+').disabled = S.draft.replicas >= MAX_REP;
    btn('commit').disabled = !dirty;
    btn('discard').disabled = !dirty;
    if (!msgTouched) {
      var am = autoMsg();
      if (msgEl.placeholder !== (am || tr('pesan commit', 'commit message'))) msgEl.placeholder = am || tr('pesan commit', 'commit message');
    }

    setHTML(els.commits, S.commits.slice().reverse().map(function (c, i) {
      var tags = '';
      if (i === 0) tags += '<span class="gx-tagc">HEAD</span>';
      if (c.sha === S.synced) tags += '<span class="gx-tagc gx-tagc-ok">deployed</span>';
      var rv = i === 0 && S.commits.length > 1 ? '<button type="button" data-act="revert">revert</button>' : '';
      return '<li><code>' + c.sha + '</code><span class="gx-cmsg">' + esc(c.msg) + '</span>' + tags +
        '<time>' + ago(c.at) + '</time>' + rv + '</li>';
    }).join(''));

    // argo
    badge(els.sync, 'sync', st);
    badge(els.health, 'health', hl);
    setHTML(els.rev, 'target <code>' + S.known + '</code>' + (S.known !== h.sha ? tr(' <span class="gx-stale">Git sudah di ', ' <span class="gx-stale">Git is already at ') + h.sha + '</span>' : ''));
    els.auto.checked = S.auto;
    els.heal.checked = S.heal;
    els.heal.disabled = !S.auto;
    els.heal.parentNode.classList.toggle('is-off', !S.auto);
    btn('sync').disabled = !!S.syncing;
    btn('refresh').disabled = !!S.syncing;
    var left = Math.max(0, S.nextPoll - now);
    els.pollBar.style.transform = 'scaleX(' + (1 - left / POLL).toFixed(3) + ')';
    setText(els.pollTxt, tr('polling Git dalam ', 'polling Git in ') + Math.ceil(left / 1000) + tr(' dtk (aslinya tiap 3 menit)', ' s (really every 3 minutes)'));

    var d = diffs();
    var diffHTML = '';
    if (S.syncing) {
      diffHTML = '<p class="gx-diff-h">↻ ' + S.syncing.reason + tr(' ke <code>', ' to <code>') + S.syncing.sha + '</code>…</p>';
    } else if (d.length) {
      diffHTML = '<p class="gx-diff-h">diff: Git <code>' + S.known + '</code> vs cluster</p>' + d.map(function (x) {
        return '<div class="gx-dl gx-del">- ' + x.f + ': ' + esc(x.live) + '</div><div class="gx-dl gx-add">+ ' + x.f + ': ' + esc(x.git) + '</div>';
      }).join('');
      if (S.heal && S.healAt) diffHTML += tr('<p class="gx-diff-n">self-heal dalam ', '<p class="gx-diff-n">self-heal in ') + Math.max(1, Math.ceil((S.healAt - now) / 1000)) + tr(' dtk…</p>', ' s…</p>');
      else if (S.auto && S.known === S.synced) diffHTML += tr('<p class="gx-diff-n">Auto-sync cuma jalan kalau ada commit baru. Drift manual dibiarkan kecuali self-heal nyala.</p>', '<p class="gx-diff-n">Auto-sync only runs when there\'s a new commit. Manual drift is left alone unless self-heal is on.</p>');
      else if (!S.auto) diffHTML += tr('<p class="gx-diff-n">Klik <b>sync</b> buat menyamakan cluster dengan Git.</p>', '<p class="gx-diff-n">Click <b>sync</b> to bring the cluster in line with Git.</p>');
    } else if (hl === 'Degraded') {
      diffHTML = tr('<p class="gx-diff-h gx-diff-bad">Synced tapi Degraded: pod baru crash, rollout macet. Pod lama tetap melayani traffic karena maxUnavailable: 0. Coba <b>revert</b> commit-nya di Git (atau rollback di Argo CD).</p>', '<p class="gx-diff-h gx-diff-bad">Synced but Degraded: the new pods crash and the rollout is stuck. The old pods keep serving traffic because maxUnavailable: 0. Try a <b>revert</b> of the commit in Git (or a rollback in Argo CD).</p>');
    }
    setHTML(els.diff, diffHTML);
    els.diff.hidden = !diffHTML;

    renderTree();

    setHTML(els.hist, S.history.slice().reverse().map(function (x) {
      var c = commitOf(x.sha);
      var cur = x.n === S.history.length;
      return '<li><span class="gx-hn">#' + x.n + '</span><code>' + x.sha + '</code><span class="gx-cmsg">' + esc(c.msg) + (x.rb ? ' <em>(rollback)</em>' : '') + '</span>' +
        (cur ? tr('<span class="gx-tagc gx-tagc-ok">aktif</span>', '<span class="gx-tagc gx-tagc-ok">active</span>') : '<button type="button" data-act="rollback" data-n="' + x.n + '"' + (S.auto ? ' disabled' : '') + '>rollback</button>') + '</li>';
    }).join(''));
    setText(els.histNote, S.auto
      ? tr('Rollback dikunci selama auto-sync nyala, karena Argo CD bakal langsung menyamakan lagi dengan HEAD di Git.', 'Rollback is locked while auto-sync is on, because Argo CD would immediately sync back to HEAD in Git.')
      : tr('Rollback mengembalikan cluster ke revisi lama, tapi Git tetap di HEAD. Hasilnya OutOfSync sampai kamu revert di Git.', 'Rollback takes the cluster back to an old revision, but Git stays at HEAD. The result is OutOfSync until you revert in Git.'));

    // kubectl
    var nScale = S.live.replicas >= MAX_REP ? 1 : MAX_REP;
    var tImg = S.live.tag === 'v1.0.1-hotfix' ? target().tag : 'v1.0.1-hotfix';
    var first = alive[0];
    setHTML(els.cmds,
      cmd('scale', 'kubectl scale deploy/toko-web --replicas=' + nScale, tr('ubah jumlah pod', 'change the pod count')) +
      cmd('image', 'kubectl set image deploy/toko-web web=toko-web:' + tImg, tr('ganti image diam-diam', 'swap the image quietly')) +
      cmd('delete', 'kubectl delete pod ' + (first ? podName(first) : '…'), tr('hapus satu pod', 'delete one pod'), !first));

    // missions
    var n = 0;
    setHTML(els.mList, MISSIONS.map(function (m) {
      var ok = !!S.done[m.id];
      if (ok) n++;
      return '<li class="' + (ok ? 'is-done' : '') + '"><span class="gx-mk" aria-hidden="true">' + (ok ? '✓' : '') + '</span><span>' + m.text + '</span></li>';
    }).join(''));
    setText(els.mCount, n + '/' + MISSIONS.length);
  }
  function cmd(kind, text, note, dis) {
    return '<button type="button" class="gx-cmd" data-act="kube" data-k="' + kind + '"' + (dis ? ' disabled' : '') + '>' +
      '<code><span>$</span> ' + esc(text) + '</code><small>' + note + '</small></button>';
  }

  var podEls = {}, rsEls = {};
  var PHASE = { Pending: 'is-pend', ContainerCreating: 'is-create', Running: 'is-run', CrashLoopBackOff: 'is-crash' };
  function renderTree() {
    var tree = els.tree;
    if (!tree._init) {
      tree._init = true;
      tree.innerHTML = '<div class="gx-res gx-res-dep"><span class="gx-kind">deploy</span><b>toko-web</b><span class="gx-res-meta" id="gx-dep-meta"></span></div><div class="gx-rss" id="gx-rss"></div>';
    }
    var R = S.live.replicas;
    var alive = S.pods.filter(function (p) { return !p.term; });
    setHTML($('gx-dep-meta'), 'replicas ' + R + ' · <span class="gx-hue" data-hue="' + TAGS[S.live.tag].hue + '">' + S.live.tag + '</span>');
    var rssEl = $('gx-rss');

    // newest ReplicaSet first; keep old ones visible while they still have pods, plus one empty
    var order = S.rsOrder.slice().reverse();
    var shown = [], empties = 0;
    order.forEach(function (tag, i) {
      var has = S.pods.some(function (p) { return p.tag === tag; });
      if (i === 0 || has || empties++ < 1) shown.push(tag);
    });

    Object.keys(rsEls).forEach(function (tag) {
      if (shown.indexOf(tag) < 0) { rsEls[tag].remove(); delete rsEls[tag]; }
    });
    shown.forEach(function (tag, i) {
      var el = rsEls[tag];
      if (!el) {
        el = document.createElement('div');
        el.className = 'gx-rs';
        el.innerHTML = '<div class="gx-res"><span class="gx-kind">rs</span><b>toko-web-' + hashOf(tag) + '</b><span class="gx-res-meta"></span></div><div class="gx-pods"></div>';
        el.dataset.hue = TAGS[tag].hue;
        rsEls[tag] = el;
      }
      // only move nodes when the order changes: re-inserting restarts the pods' CSS animations
      if (rssEl.children[i] !== el) rssEl.insertBefore(el, rssEl.children[i] || null);
      var mine = S.pods.filter(function (p) { return p.tag === tag; });
      var rd = mine.filter(function (p) { return p.ready; }).length;
      var want = tag === S.live.tag ? R : 0;
      setHTML(el.querySelector('.gx-res-meta'), '<span class="gx-hue" data-hue="' + TAGS[tag].hue + '">' + tag + '</span> · ' + (tag === S.live.tag ? rd + '/' + want + ' ready' : mine.length ? rd + tr(' ready, RS lama', ' ready, old RS') : tr('RS lama', 'old RS')));
      el.classList.toggle('is-old', tag !== S.live.tag);
      var podsEl = el.querySelector('.gx-pods');
      mine.forEach(function (p) {
        var pe = podEls[p.id];
        if (!pe) {
          pe = document.createElement('div');
          pe.className = 'gx-pod';
          pe.innerHTML = '<i aria-hidden="true"></i><b>' + p.id + '</b><span></span><em></em>';
          pe.title = podName(p);
          podEls[p.id] = pe;
        }
        if (pe.parentNode !== podsEl) podsEl.appendChild(pe);
        var cls = 'gx-pod ' + (p.term ? 'is-term' : PHASE[p.phase] + (p.ready ? ' is-ready' : ''));
        if (pe.className !== cls) pe.className = cls;
        setText(pe.querySelector('span'), p.term ? 'Terminating' : p.phase === 'Running' && !p.ready ? tr('Running (belum siap)', 'Running (not ready)') : p.phase);
        setText(pe.querySelector('em'), p.restarts ? '↻ ' + p.restarts : '');
      });
      if (!mine.length) setHTML(podsEl, '<span class="gx-pods-empty">0 pod</span>');
      else { var e = podsEl.querySelector('.gx-pods-empty'); if (e) { e.remove(); podsEl._h = null; } }
    });
    Object.keys(podEls).forEach(function (id) {
      if (!S.pods.some(function (p) { return p.id === id; })) { podEls[id].remove(); delete podEls[id]; }
    });
    tree.dataset.count = alive.length;
  }

  // ---------- loop ----------
  function tick() {
    var now = Date.now();
    if (now >= S.nextPoll) refresh(false);

    S.pods = S.pods.filter(function (p) { return stepPod(p, now) !== 'gone'; });
    controller();

    var hl = healthNow();
    if (hl !== S.health) {
      log('argo', 'health ' + S.health + ' → <em class="gx-' + BADGE[hl] + '">' + hl + '</em>');
      if (hl === 'Degraded') S.sawDegraded = true;
      if (hl === 'Healthy' && S.sawDegraded && !TAGS[S.live.tag].broken) { S.sawDegraded = false; mission('recover'); }
      S.health = hl;
    }

    if (S.heal && !S.syncing && diffs().length) {
      if (!S.healAt) S.healAt = now + HEAL_DELAY;
      else if (now >= S.healAt) { S.healAt = 0; sync('self-heal'); }
    } else if (!S.syncing) {
      S.healAt = 0;
    }
    render();
  }

  // ---------- events ----------
  app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    var act = b.dataset.act;
    if (act === 'rep-') S.draft.replicas = Math.max(1, S.draft.replicas - 1);
    else if (act === 'rep+') S.draft.replicas = Math.min(MAX_REP, S.draft.replicas + 1);
    else if (act === 'commit') commit();
    else if (act === 'discard') { S.draft = copy(head().spec); msgTouched = false; msgEl.value = ''; }
    else if (act === 'revert') revertHead();
    else if (act === 'refresh') refresh(true);
    else if (act === 'sync') {
      // a sync resolves the branch again, so it always targets the latest commit
      if (S.known !== head().sha) { S.known = head().sha; pulse('pull'); }
      sync('sync manual');
    }
    else if (act === 'rollback') rollback(+b.dataset.n);
    else if (act === 'kube') kubectl(b.dataset.k);
    else if (act === 'reset') { reset(); return; }
    render();
  });
  tagEl.addEventListener('change', function () { S.draft.tag = tagEl.value; render(); });
  msgEl.addEventListener('input', function () { msgTouched = msgEl.value.trim() !== ''; });
  msgEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); commit(); render(); } });
  els.auto.addEventListener('change', function () {
    S.auto = els.auto.checked;
    if (!S.auto) S.heal = false;
    log('argo', 'auto-sync ' + (S.auto ? tr('<em class="gx-ok">nyala</em>', '<em class="gx-ok">on</em>') : tr('mati', 'off')));
    if (S.auto && S.known !== S.synced) sync('auto-sync');
    render();
  });
  els.heal.addEventListener('change', function () {
    S.heal = els.heal.checked && S.auto;
    log('argo', 'self-heal ' + (S.heal ? tr('<em class="gx-ok">nyala</em>', '<em class="gx-ok">on</em>') : tr('mati', 'off')));
    render();
  });

  var timer;
  function reset() {
    Object.keys(podEls).forEach(function (id) { podEls[id].remove(); });
    Object.keys(rsEls).forEach(function (t) { rsEls[t].remove(); });
    podEls = {}; rsEls = {};
    termEl.innerHTML = '';
    msgTouched = false; msgEl.value = '';
    initState();
    log('argo', tr('app <b>toko-web</b> Synced ke <b>', 'app <b>toko-web</b> Synced to <b>') + S.known + '</b>, 3/3 pod Running');
    log('git', tr('repo <b>toko-gitops</b> siap. Ubah manifest di panel Git buat mulai.', 'repo <b>toko-gitops</b> is ready. Edit the manifest in the Git panel to start.'));
    render();
  }
  reset();
  timer = setInterval(tick, 200);
  document.addEventListener('visibilitychange', function () {
    // pause while hidden so the poll countdown doesn't fire a burst on return
    if (document.hidden) { clearInterval(timer); timer = null; S._hiddenAt = Date.now(); }
    else if (!timer) {
      var gap = Date.now() - (S._hiddenAt || Date.now());
      S.nextPoll += gap; if (S.healAt) S.healAt += gap; if (S.rolloutAt) S.rolloutAt += gap;
      S.pods.forEach(function (p) { p.t += gap; });
      timer = setInterval(tick, 200);
    }
  });
})();
