// Docker Swarm simulator for /swarm/. Four fake machines, a manager that
// reconciles services into tasks every tick, rolling updates with
// pause/rollback, drain, a routing mesh and `docker stack deploy` from the
// stack.yml editor. Time runs faster than real life. Nothing is stored.
(function () {
  'use strict';

  var K = window.SimKit;
  var app = document.getElementById('sw');
  if (!app || !K) return;
  var esc = K.esc, setHTML = K.setHTML, setText = K.setText;
  var digest = K.digest, pad = K.pad, words = K.words, ago = K.ago;
  function $(id) { return document.getElementById(id); }
  function rnd(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }

  // ---------- catalog ----------
  // images the fake registry knows; anything else gets "No such image"
  var IMG = {
    'nginx:1.25': { ver: '1.25.5', port: 80, http: 'nginx' },
    'nginx:1.27': { ver: '1.27.2', port: 80, http: 'nginx' },
    'nginx:latest': { ver: '1.27.2', port: 80, http: 'nginx' },
    'nginx:alpine': { ver: '1.27.2', port: 80, http: 'nginx' },
    'traefik/whoami:latest': { port: 80, http: 'whoami' },
    'traefik/whoami:v1.10': { port: 80, http: 'whoami' },
    'redis:7': { port: 6379 },
    'redis:latest': { port: 6379 },
    'alpine:latest': { cmd: true },
    'prom/node-exporter:latest': { port: 9100, http: 'metrics' },
    'httpd:2.4': { port: 80, http: 'httpd' }
  };
  function normRef(r) {
    r = String(r || '').replace(/^docker\.io\//, '').replace(/^library\//, '');
    return r.split('/').pop().indexOf(':') < 0 ? r + ':latest' : r;
  }
  var HUES = ['a', 'b', 'c', 'd'];
  var IPS = { manager1: '10.0.0.11', worker1: '10.0.0.12', worker2: '10.0.0.13', worker3: '10.0.0.14' };
  var NODE_NAMES = ['manager1', 'worker1', 'worker2', 'worker3'];
  // seconds in the sim; real Swarm uses 10s+ for these
  var HEARTBEAT = 5000, UPDATE_DELAY = 2500, RESTART_DELAY = 2500;

  var STACK0 = [
    'services:',
    '  web:',
    '    image: nginx:1.25',
    '    ports:',
    '      - "8090:80"',
    '    deploy:',
    '      replicas: 3',
    '      update_config:',
    '        parallelism: 1',
    '        delay: 10s',
    '        failure_action: rollback',
    '',
    '  api:',
    '    image: traefik/whoami',
    '    ports:',
    '      - "8091:80"',
    '    deploy:',
    '      replicas: 2',
    '      placement:',
    '        constraints:',
    '          - node.role == worker',
    '',
    '  exporter:',
    '    image: prom/node-exporter',
    '    deploy:',
    '      mode: global',
    ''
  ].join('\n');

  var MISSIONS = [
    { id: 'init', text: '<b>docker swarm init</b> di manager1, lalu gabungkan worker1 dan worker2 (tombol <i>gabung</i> di kartunya).' },
    { id: 'svc', text: 'Bikin service <b>web</b> 3 replika dengan <i>-p 8080:80</i>.' },
    { id: 'mesh', text: 'Gabungkan <b>worker3</b>, lalu curl ke worker3:8080. Dia ga punya task web tapi tetap menjawab. Itu <b>routing mesh</b>.' },
    { id: 'scale', text: 'Scale <b>web</b> jadi 6 replika.' },
    { id: 'heal', text: 'Matikan satu worker dan tunggu task-nya pindah ke node lain.' },
    { id: 'update', text: 'Rolling update <b>web</b> ke <i>nginx:1.27</i> sampai selesai.' },
    { id: 'rollback', text: 'Update ke image yang ga ada (misal <i>nginx:9.9</i>), lihat update berhenti, lalu <b>rollback</b>.' },
    { id: 'drain', text: '<b>drain</b> satu worker buat maintenance, lalu deploy <i>stack.yml</i> pakai docker stack deploy.' }
  ];

  // ---------- state ----------
  var W;
  function initWorld() {
    W = {
      run: (W ? W.run : 0) + 1, swarm: false, at: 'manager1', busy: false,
      nodes: {}, svcs: [], tok: { w: '', m: '' }, rr: {}, file: STACK0, errs: [], seq: 0,
      healSeen: false, pausedOnce: false, drained: false
    };
    NODE_NAMES.forEach(function (n, i) {
      W.nodes[n] = {
        name: n, id: digest('node' + n).slice(0, 25), role: i === 0 ? 'manager' : 'worker', joined: false,
        power: true, status: 'ready', avail: 'active', offAt: 0, images: {}, leader: i === 0
      };
    });
  }
  function nodes() { return NODE_NAMES.map(function (n) { return W.nodes[n]; }); }
  function members() { return nodes().filter(function (n) { return n.joined; }); }
  function svcBy(q) {
    return W.svcs.filter(function (s) { return s.name === q || s.id.indexOf(q) === 0; })[0];
  }
  function live(t) { return t.desired === 'running' && !/^(failed|rejected|shutdown|orphaned|complete)$/.test(t.state); }
  function activeTasks(s) { return s.tasks.filter(live); }
  function runningTasks(s) { return s.tasks.filter(function (t) { return t.desired === 'running' && t.state === 'running'; }); }
  function want(s) { return s.mode === 'global' ? eligible(s).length : s.replicas; }
  function eligible(s) {
    return members().filter(function (n) {
      if (n.status !== 'ready' || n.avail !== 'active') return false;
      return (s.cons || []).every(function (c) { return matchCons(n, c); });
    });
  }
  function matchCons(n, c) {
    var m = /^\s*node\.(role|hostname)\s*(==|!=)\s*(\S+)\s*$/.exec(c);
    if (!m) return true;
    var v = m[1] === 'role' ? n.role : n.name;
    return m[2] === '==' ? v === m[3] : v !== m[3];
  }
  function validCons(c) { return /^\s*node\.(role|hostname)\s*(==|!=)\s*\S+\s*$/.test(c); }

  // ---------- scheduler ----------
  function newTask(s, slot, node) {
    var t = {
      id: digest('task' + (++W.seq) + Math.random()).slice(0, 25), slot: slot, svc: s, image: s.image, node: node ? node.name : null,
      desired: 'running', state: 'new', since: Date.now(), err: '', cid: digest('cid' + Math.random()).slice(0, 12), ver: s.ver, born: Date.now()
    };
    s.tasks.push(t);
    return t;
  }
  function pickNode(s, slotTasks) {
    var el = eligible(s);
    if (!el.length) return null;
    // spread: fewest tasks of this service, then fewest tasks overall
    function count(n, only) {
      var c = 0;
      W.svcs.forEach(function (x) { if (only && x !== s) return; x.tasks.forEach(function (t) { if (live(t) && t.node === n.name) c++; }); });
      return c;
    }
    el.sort(function (a, b) { return count(a, true) - count(b, true) || count(a) - count(b) || NODE_NAMES.indexOf(a.name) - NODE_NAMES.indexOf(b.name); });
    void slotTasks;
    return el[0];
  }
  function stopTask(t, why) {
    if (t.desired === 'shutdown') return;
    t.desired = 'shutdown';
    t.stopAt = Date.now() + 400;
    t.why = why || '';
  }
  // one reconcile pass
  function tick() {
    if (!W || !W.swarm) { render(); return; }
    var now = Date.now();
    // heartbeat
    nodes().forEach(function (n) {
      if (!n.joined) return;
      if (!n.power && n.status === 'ready' && now - n.offAt > HEARTBEAT) {
        n.status = 'down';
        sys(n.name + ' ga kirim heartbeat lagi, ditandai Down');
        K.flash(app, 'node', 'warn');
      }
      if (n.power && n.status === 'down') { n.status = 'ready'; sys(n.name + ' kembali Ready'); }
    });
    W.svcs.forEach(function (s) {
      // tasks on dead or drained nodes
      s.tasks.forEach(function (t) {
        var n = t.node && W.nodes[t.node];
        if (!live(t) || !n) return;
        if (n.status === 'down') { t.state = 'orphaned'; t.desired = 'shutdown'; t.err = 'node ' + n.name + ' down'; t.since = now; t.lostNode = true; W.healSeen = true; }
        else if (n.avail === 'drain') stopTask(t, 'drain');
        else if (!n.joined) { t.state = 'shutdown'; t.desired = 'shutdown'; t.since = now; }
        else if ((s.cons || []).some(function (c) { return !matchCons(n, c); })) stopTask(t, 'constraint');
      });
      // progress
      s.tasks.forEach(function (t) {
        if (t.desired === 'shutdown') {
          if (t.state !== 'shutdown' && t.state !== 'orphaned' && t.state !== 'rejected' && t.state !== 'failed' && now >= (t.stopAt || 0)) { t.state = 'shutdown'; t.since = now; }
          return;
        }
        var age = now - t.since;
        var n = t.node && W.nodes[t.node];
        if (t.state === 'new' || t.state === 'pending') {
          var pick = pickNode(s);
          if (!pick) {
            if (t.state !== 'pending') { t.state = 'pending'; t.since = now; }
            t.err = 'no suitable node (' + noNodeWhy(s) + ')';
            return;
          }
          t.node = pick.name; t.state = 'assigned'; t.since = now; t.err = '';
        } else if (t.state === 'assigned' && age > 150) {
          t.state = 'preparing'; t.since = now;
        } else if (t.state === 'preparing') {
          var meta = IMG[normRef(t.image)];
          if (!meta) {
            t.state = 'rejected'; t.desired = 'shutdown'; t.since = now;
            t.err = 'No such image: ' + normRef(t.image);
            t.retryAt = now + RESTART_DELAY;
            return;
          }
          var pullMs = n && n.images[normRef(t.image)] ? 200 : 900;
          if (age > pullMs) { if (n) n.images[normRef(t.image)] = true; t.state = 'starting'; t.since = now; }
        } else if (t.state === 'starting' && age > 350) {
          t.state = 'running'; t.since = now;
          t.runningAt = now;
        }
      });
      // keep history short, like --task-history-limit
      var bySlot = {};
      s.tasks.forEach(function (t) { var k = slotKey(t); (bySlot[k] = bySlot[k] || []).push(t); });
      Object.keys(bySlot).forEach(function (k) {
        var dead = bySlot[k].filter(function (t) { return !live(t); });
        if (dead.length > 4) dead.slice(0, dead.length - 4).forEach(function (t) { t.gone = true; });
      });
      s.tasks = s.tasks.filter(function (t) { return !t.gone; });
      reconcile(s, now);
      update(s, now);
    });
    render();
  }
  function slotKey(t) { return t.svc.mode === 'global' ? 'n:' + t.node : 's:' + t.slot; }
  function noNodeWhy(s) {
    var m = members();
    var ready = m.filter(function (n) { return n.status === 'ready'; });
    var act = ready.filter(function (n) { return n.avail === 'active'; });
    if (!act.length) return 'scheduling constraints not satisfied on ' + m.length + ' nodes';
    return 'scheduling constraints not satisfied on ' + m.length + ' nodes';
  }
  function reconcile(s, now) {
    if (s.updating && s.updating.paused) { /* paused updates still keep replicas alive */ }
    if (s.mode === 'global') {
      var el = eligible(s);
      el.forEach(function (n) {
        var has = s.tasks.some(function (t) { return live(t) && t.node === n.name; });
        var blocked = s.tasks.some(function (t) { return t.node === n.name && t.state === 'rejected' && t.retryAt > now; });
        if (!has && !blocked) { var t = newTask(s, 0, n); t.state = 'assigned'; }
      });
      s.tasks.forEach(function (t) {
        if (live(t) && t.node && !el.some(function (n) { return n.name === t.node; })) stopTask(t, 'node');
      });
      return;
    }
    for (var slot = 1; slot <= s.replicas; slot++) {
      var act = s.tasks.filter(function (t) { return live(t) && t.slot === slot; });
      if (act.length) {
        if (act.length > 1) act.slice(0, -1).forEach(function (t) { stopTask(t); });
        continue;
      }
      // the updater replaces a slot itself; wait for it
      if (s.updating && s.updating.cur && s.updating.cur.indexOf(slot) >= 0) continue;
      var lastFail = s.tasks.filter(function (t) { return t.slot === slot && (t.state === 'rejected' || t.state === 'failed'); }).pop();
      if (lastFail && lastFail.retryAt > now) continue;
      newTask(s, slot);
    }
    s.tasks.forEach(function (t) { if (live(t) && t.slot > s.replicas) stopTask(t, 'scale'); });
  }

  // ---------- rolling update ----------
  function startUpdate(s, image, rollback) {
    var slots = s.mode === 'global' ? [] : [];
    if (s.mode === 'global') activeTasks(s).forEach(function (t) { slots.push(t.node); });
    else for (var i = 1; i <= s.replicas; i++) slots.push(i);
    s.prev = { image: s.image, ver: s.ver };
    s.image = image;
    s.ver++;
    s.updating = { queue: slots, cur: [], paused: false, rollback: !!rollback, nextAt: 0, started: Date.now(), msg: rollback ? 'rollback in progress' : 'update in progress' };
    s.updState = rollback ? 'rollback_started' : 'updating';
  }
  function update(s, now) {
    var u = s.updating;
    if (!u || u.paused) return;
    var cfg = s.upd;
    // check the slots being replaced
    for (var i = u.cur.length - 1; i >= 0; i--) {
      var slot = u.cur[i];
      var mine = s.tasks.filter(function (t) { return (s.mode === 'global' ? t.node === slot : t.slot === slot) && t.ver === s.ver; });
      var ok = mine.filter(function (t) { return t.state === 'running'; })[0];
      var bad = mine.filter(function (t) { return t.state === 'rejected' || t.state === 'failed'; })[0];
      if (ok && now - ok.runningAt > 300) { u.cur.splice(i, 1); u.nextAt = now + cfg.delay; }
      else if (bad) {
        if (u.rollback) { u.cur.splice(i, 1); continue; }
        if (cfg.failure === 'continue') { u.cur.splice(i, 1); continue; }
        var msg = 'update paused due to failure or early termination of task ' + bad.id;
        if (cfg.failure === 'rollback') {
          sys('service ' + s.name + ': update gagal (' + bad.err + '), otomatis rollback');
          s.updating = null;
          startUpdate(s, s.prev.image, true);
          s.autoRolled = true;
          return;
        }
        // the spec already has the new image, so the slot keeps retrying it
        u.paused = true; u.msg = msg; s.updState = 'paused'; u.cur = [];
        W.pausedOnce = true;
        sys('service ' + s.name + ': ' + msg);
        K.flash(app, 'svc', 'warn');
        return;
      }
    }
    if (u.cur.length >= cfg.par || now < u.nextAt) return;
    if (!u.queue.length) {
      if (!u.cur.length) {
        s.updating = null;
        s.updState = u.rollback ? 'rollback_completed' : 'completed';
        sys('service ' + s.name + ': ' + (u.rollback ? 'rollback' : 'update') + ' selesai');
        if (u.rollback && (W.pausedOnce || s.autoRolled)) M.hit('rollback');
        if (!u.rollback && s.name === 'web' && normRef(s.image) === 'nginx:1.27') M.hit('update');
      }
      return;
    }
    while (u.cur.length < cfg.par && u.queue.length) {
      var sl = u.queue.shift();
      var old = s.tasks.filter(function (t) { return live(t) && (s.mode === 'global' ? t.node === sl : t.slot === sl); });
      if (s.mode !== 'global' && sl > s.replicas) continue;
      // a task already running the target image stays as it is
      if (old.length && old.every(function (t) { return normRef(t.image) === normRef(s.image); })) { old.forEach(function (t) { t.ver = s.ver; }); continue; }
      old.forEach(function (t) { stopTask(t, 'update'); });
      var nt = newTask(s, s.mode === 'global' ? 0 : sl, s.mode === 'global' ? W.nodes[sl] : null);
      if (s.mode !== 'global') {
        // prefer the node the old task was on, like Swarm does
        var prev = old[0] && W.nodes[old[0].node];
        if (prev && eligible(s).indexOf(prev) >= 0) { nt.node = prev.name; nt.state = 'assigned'; }
      } else nt.state = 'assigned';
      u.cur.push(sl);
    }
  }

  // ---------- terminal ----------
  var term = new K.Term($('sw-out'), $('sw-in'), { onCmd: onCmd });
  var toast = K.makeToast($('sw-toast'));
  var M = new K.Missions($('sw-m-list'), $('sw-m-count'), MISSIONS, toast, '🐝 Semua misi Swarm beres. Keren!');
  function err(t) { term.line('<span class="sx-err">' + esc(t) + '</span>'); }
  function dim(t) { term.line('<span class="sx-dim">' + esc(t) + '</span>'); }
  function hint(t) { term.line('<span class="sx-warn">' + esc(t) + '</span>'); }
  function out(t) { term.line(esc(t)); }
  function sys(t) { term.line('<span class="sx-info">[swarm]</span> <span class="sx-dim">' + esc(t) + '</span>'); }
  function ps() { return 'rifki@' + W.at + ':~$'; }

  function onCmd(line) {
    term.echo(ps(), line);
    if (!line) return;
    var w = words(line);
    if (w[0] === 'sudo') w.shift();
    try { exec(w, W.at); } catch (e) {
      err('simulasi error: ' + (e && e.message || e));
      if (window.console) console.error(e);
    }
    tick();
  }
  function exec(w, host) {
    var c = w[0];
    if (c === 'ssh') {
      var to = (w[1] || '').replace(/^.*@/, '');
      if (!W.nodes[to]) { err('ssh: Could not resolve hostname ' + (w[1] || '') + ': Name or service not known'); return; }
      if (!W.nodes[to].power) { err('ssh: connect to host ' + to + ' port 22: No route to host'); return; }
      if (w.length > 2) { exec(w.slice(2), to); return; }
      W.at = to;
      $('sw-ps').textContent = ps();
      dim('# sekarang kamu di ' + to + '. Ketik exit buat balik ke ' + (to === 'manager1' ? 'laptop' : 'manager1') + '.');
      renderQuick();
      return;
    }
    if (c === 'exit' || c === 'logout') {
      if (W.at === 'manager1') { dim('# ini sudah di manager1, tetap di sini ya'); return; }
      out('logout');
      out('Connection to ' + W.at + ' closed.');
      W.at = 'manager1';
      $('sw-ps').textContent = ps();
      renderQuick();
      return;
    }
    if (c === 'clear') { term.clear(); return; }
    if (c === 'help') { help(); return; }
    if (c === 'curl') { curl(w.slice(1), host); return; }
    if (c === 'hostname') { out(host); return; }
    if (c === 'cat' && w[1] === 'stack.yml') { term.lines(W.file.replace(/\n$/, '').split('\n').map(esc)); return; }
    if (c === 'ls') { out(host === 'manager1' ? 'stack.yml' : ''); return; }
    if (c === 'kubectl') { dim('# ini Swarm, bukan Kubernetes. Coba docker service ls'); return; }
    if (c !== 'docker') { err(c + ': command not found'); return; }
    docker(w.slice(1), host);
  }
  function help() {
    term.lines([
      '<b>Perintah yang bisa dicoba</b>',
      '  docker swarm init  ·  docker swarm join-token worker  ·  docker swarm leave',
      '  docker node ls  ·  docker node ps NODE  ·  docker node update --availability drain|active NODE',
      '  docker node promote|demote NODE',
      '  docker service create --name web --replicas 3 -p 8080:80 nginx:1.25',
      '  docker service ls  ·  docker service ps web  ·  docker service inspect --pretty web',
      '  docker service scale web=6  ·  docker service update --image nginx:1.27 web',
      '  docker service rollback web  ·  docker service logs web  ·  docker service rm web',
      '  docker stack deploy -c stack.yml shop  ·  docker stack ls|ps|services|rm shop',
      '  curl NODE:PORT  ·  ssh worker1  ·  exit  ·  clear',
      '<span class="sx-dim">Image yang ada: nginx:1.25, nginx:1.27, traefik/whoami, redis:7, alpine, httpd:2.4, prom/node-exporter.</span>'
    ]);
  }
  function needMgr(host) {
    if (!W.swarm || !W.nodes[host].joined) {
      err('Error response from daemon: This node is not a swarm manager. Use "docker swarm init" or "docker swarm join" to connect this node to swarm and try again.');
      return false;
    }
    if (W.nodes[host].role !== 'manager') {
      err('Error response from daemon: This node is not a swarm manager. Worker nodes can\'t be used to view or modify cluster state. Please run this command on a manager node or promote the current node to a manager.');
      return false;
    }
    return true;
  }
  function docker(a, host) {
    var sub = a[0], args = a.slice(1);
    switch (sub) {
      case 'swarm': swarmCmd(args, host); return;
      case 'node': if (needMgr(host)) nodeCmd(args); return;
      case 'service': if (needMgr(host)) serviceCmd(args); return;
      case 'stack': if (needMgr(host)) stackCmd(args); return;
      case 'ps': localPs(host, args); return;
      case 'info': {
        var n = W.nodes[host];
        term.lines([' Swarm: ' + (n.joined ? 'active' : 'inactive')].concat(n.joined ? ['  NodeID: ' + n.id, '  Is Manager: ' + (n.role === 'manager'), '  Nodes: ' + members().length, '  Managers: ' + members().filter(function (x) { return x.role === 'manager'; }).length] : []).map(esc));
        return;
      }
      case 'version': out('Docker version 27.3.1, build ce12230'); return;
      case 'run': dim('# di Swarm, pakai docker service create supaya container-nya diatur manager. docker run cuma jalan di satu mesin.'); return;
      case 'compose': dim('# Compose buat satu mesin. Di Swarm, file yang sama dipakai lewat docker stack deploy -c stack.yml NAMA'); return;
      case 'network':
        if (args[0] === 'ls') {
          var rows = [['NETWORK ID', 'NAME', 'DRIVER', 'SCOPE'], [digest('nb').slice(0, 12), 'bridge', 'bridge', 'local']];
          if (W.nodes[host].joined) rows.push([digest('ngw').slice(0, 12), 'docker_gwbridge', 'bridge', 'local'], [digest('ning').slice(0, 12), 'ingress', 'overlay', 'swarm']);
          W.svcs.filter(function (s) { return s.stack; }).map(function (s) { return s.stack; }).filter(function (x, i, l) { return l.indexOf(x) === i; }).forEach(function (st) { rows.push([digest('net' + st).slice(0, 12), st + '_default', 'overlay', 'swarm']); });
          term.table(rows);
          return;
        }
        dim('# yang didukung cuma docker network ls');
        return;
    }
    err('docker: unknown command: docker ' + (sub || ''));
  }

  function swarmCmd(a, host) {
    var op = a[0], n = W.nodes[host];
    if (op === 'init') {
      if (n.joined) { err('Error response from daemon: This node is already part of a swarm. Use "docker swarm leave" to leave this swarm and join another one.'); return; }
      if (W.swarm) { err('Error response from daemon: This node is not part of the swarm. Use "docker swarm join" to join the existing swarm.'); dim('# swarm sudah di-init di manager1, node ini tinggal join'); return; }
      if (host !== 'manager1') { dim('# di simulasi ini, init swarm dari manager1 ya (ketik exit dulu)'); return; }
      W.swarm = true;
      n.joined = true; n.role = 'manager'; n.leader = true;
      if (host !== 'manager1') { /* fine, but keep manager1 as the leader name in docs */ }
      W.tok.w = 'SWMTKN-1-' + digest('cl' + W.run).slice(0, 50) + '-' + digest('w' + W.run).slice(0, 25);
      W.tok.m = 'SWMTKN-1-' + digest('cl' + W.run).slice(0, 50) + '-' + digest('m' + W.run).slice(0, 25);
      term.lines([
        'Swarm initialized: current node (' + n.id + ') is now a manager.',
        '',
        'To add a worker to this swarm, run the following command:',
        '',
        '    <b>docker swarm join --token ' + W.tok.w + ' ' + IPS[host] + ':2377</b>',
        '',
        'To add a manager to this swarm, run \'docker swarm join-token manager\' and follow the instructions.'
      ]);
      dim('# perintah join itu dijalankan di worker. Pakai tombol "gabung" di kartu worker, atau ssh worker1 lalu tempel perintahnya.');
      K.flash(app, 'mgr');
      renderQuick();
      return;
    }
    if (op === 'join') {
      if (n.joined) { err('Error response from daemon: This node is already part of a swarm. Use "docker swarm leave" to leave this swarm and join another one.'); return; }
      var ti = a.indexOf('--token'), tok = ti >= 0 ? a[ti + 1] : null, addr = a.filter(function (x, i) { return i > 0 && x[0] !== '-' && x !== tok; })[0];
      if (!tok || !addr) { err('"docker swarm join" requires exactly 1 argument.'); dim('Usage:  docker swarm join [OPTIONS] HOST:PORT'); return; }
      if (!W.swarm) { err('Error response from daemon: rpc error: code = Unavailable desc = connection error: dial tcp ' + addr + ': connect: connection refused'); dim('# belum ada swarm. Jalankan docker swarm init di manager1 dulu.'); return; }
      var mh = addr.split(':')[0];
      if (mh !== IPS.manager1 && mh !== 'manager1') { err('Error response from daemon: Timeout was reached before node joined. The attempt to join the swarm will continue in the background.'); return; }
      if (tok !== W.tok.w && tok !== W.tok.m) { err('Error response from daemon: rpc error: code = InvalidArgument desc = A valid join token is necessary to join this cluster'); return; }
      n.joined = true; n.status = 'ready'; n.role = tok === W.tok.m ? 'manager' : 'worker';
      out('This node joined a swarm as a ' + n.role + '.');
      K.flash(app, 'node');
      if (W.nodes.worker1.joined && W.nodes.worker2.joined) M.hit('init');
      renderQuick();
      return;
    }
    if (op === 'join-token') {
      if (!needMgr(host)) return;
      var r = a.filter(function (x) { return x[0] !== '-'; })[1] || a[1];
      if (r !== 'worker' && r !== 'manager') { err('"docker swarm join-token" requires exactly 1 argument.'); return; }
      if (a.indexOf('-q') >= 0) { out(r === 'worker' ? W.tok.w : W.tok.m); return; }
      term.lines(['To add a ' + r + ' to this swarm, run the following command:', '', '    <b>docker swarm join --token ' + (r === 'worker' ? W.tok.w : W.tok.m) + ' ' + IPS.manager1 + ':2377</b>', '']);
      return;
    }
    if (op === 'leave') {
      if (!n.joined) { err('Error response from daemon: This node is not part of a swarm'); return; }
      if (n.role === 'manager' && a.indexOf('--force') < 0 && a.indexOf('-f') < 0) {
        err('Error response from daemon: You are attempting to leave the swarm on a node that is participating as a manager. Removing the last manager erases all current state of the swarm. Use `--force` to ignore this message.');
        return;
      }
      if (n.role === 'manager') {
        W.swarm = false;
        nodes().forEach(function (x) { x.joined = false; x.role = x.name === 'manager1' ? 'manager' : 'worker'; });
        W.svcs = [];
        out('Node left the swarm.');
        dim('# manager terakhir keluar, jadi seluruh state swarm (service, token) ikut hilang');
        renderQuick();
        return;
      }
      n.joined = false;
      out('Node left the swarm.');
      dim('# di manager, node ini masih kelihatan sebagai Down sampai dihapus pakai docker node rm ' + host);
      n.left = true;
      return;
    }
    if (op === 'ca' || op === 'unlock' || op === 'update') { dim('# perintah ini belum didukung di simulasi'); return; }
    err('docker: unknown command: docker swarm ' + (op || ''));
  }

  function findNode(q) {
    return nodes().filter(function (n) { return (n.joined || n.left) && (n.name === q || n.id.indexOf(q) === 0); })[0];
  }
  function nodeStatus(n) { return n.joined && n.status === 'ready' && n.power ? 'Ready' : 'Down'; }
  function nodeCmd(a) {
    var op = a[0];
    if (op === 'ls' || !op) {
      term.table([['ID', 'HOSTNAME', 'STATUS', 'AVAILABILITY', 'MANAGER STATUS', 'ENGINE VERSION']].concat(nodes().filter(function (n) { return n.joined || n.left; }).map(function (n) {
        var me = n.name === W.at;
        return [n.id + (me ? ' *' : ''), n.name, n.left ? 'Down' : n.status === 'down' ? 'Down' : 'Ready', n.avail[0].toUpperCase() + n.avail.slice(1), n.role === 'manager' ? (n.leader ? 'Leader' : n.status === 'down' ? 'Unreachable' : 'Reachable') : '', '27.3.1'];
      })));
      return;
    }
    if (op === 'ps') {
      var n = findNode(a[1] || W.at);
      if (!n) { err('Error: No such node: ' + (a[1] || '')); return; }
      var list = [];
      W.svcs.forEach(function (s) { s.tasks.forEach(function (t) { if (t.node === n.name) list.push(t); }); });
      taskTable(list);
      return;
    }
    if (op === 'update') {
      var avail = null, add = null, target = null;
      for (var i = 1; i < a.length; i++) {
        if (a[i] === '--availability') avail = a[++i];
        else if (/^--availability=/.test(a[i])) avail = a[i].split('=')[1];
        else if (a[i] === '--label-add') add = a[++i];
        else if (a[i][0] !== '-') target = a[i];
      }
      var nd = findNode(target);
      if (!nd) { err('Error: No such node: ' + (target || '')); return; }
      if (avail) {
        if (['active', 'drain', 'pause'].indexOf(avail) < 0) { err('invalid argument "' + avail + '" for "--availability" flag: invalid value, must be one of active, pause, drain'); return; }
        nd.avail = avail;
        if (avail === 'drain') {
          sys(nd.name + ' di-drain: task di sini dihentikan dan dijadwalkan ulang ke node lain');
          if (nd.role === 'worker') W.drained = true;
        }
        if (avail === 'active') sys(nd.name + ' aktif lagi. Task lama ga otomatis balik ke sini; cuma task baru yang bisa dijadwalkan ke sini.');
      }
      if (add) dim('# label ' + add + ' dicatat (constraint label belum dipakai di simulasi)');
      out(nd.name);
      K.flash(app, 'node');
      return;
    }
    if (op === 'promote' || op === 'demote') {
      var p = findNode(a[1]);
      if (!p) { err('Error: No such node: ' + (a[1] || '')); return; }
      if (op === 'demote' && p.leader) { err('Error response from daemon: rpc error: code = FailedPrecondition desc = attempting to demote the last manager of the swarm'); return; }
      p.role = op === 'promote' ? 'manager' : 'worker';
      out('Node ' + p.name + ' ' + (op === 'promote' ? 'promoted to a manager' : 'demoted') + ' in the swarm.');
      var mg = members().filter(function (x) { return x.role === 'manager'; }).length;
      if (op === 'promote' && mg === 2) hint('# 2 manager malah lebih rapuh dari 1: Raft butuh mayoritas (2 dari 2). Pakai 3 manager supaya tahan 1 mati.');
      return;
    }
    if (op === 'rm') {
      var r = findNode(a.filter(function (x, i) { return i > 0 && x[0] !== '-'; })[0]);
      if (!r) { err('Error: No such node: ' + (a[1] || '')); return; }
      if (r.joined && r.status === 'ready' && a.indexOf('--force') < 0 && a.indexOf('-f') < 0) { err('Error response from daemon: rpc error: code = FailedPrecondition desc = node ' + r.id + ' is not down and can\'t be removed'); return; }
      if (r.leader) { err('Error response from daemon: rpc error: code = FailedPrecondition desc = node ' + r.id + ' is a cluster manager and is a member of the raft cluster. It must be demoted to worker before removal'); return; }
      r.joined = false; r.left = false; r.avail = 'active';
      out(r.name);
      return;
    }
    if (op === 'inspect') {
      var ni = findNode(a.filter(function (x, i) { return i > 0 && x[0] !== '-'; })[0] || 'self');
      if (!ni && a.indexOf('self') >= 0) ni = W.nodes[W.at];
      if (!ni) { err('Error: No such node: ' + (a[1] || '')); return; }
      term.lines(['ID:\t\t\t' + ni.id, 'Hostname:\t\t' + ni.name, 'Status:', ' State:\t\t\t' + nodeStatus(ni), ' Availability:\t\t' + ni.avail[0].toUpperCase() + ni.avail.slice(1), ' Address:\t\t' + IPS[ni.name], 'Platform:', ' OS:\t\t\tlinux', ' Architecture:\t\tx86_64', 'Engine Version:\t\t27.3.1'].map(esc));
      return;
    }
    err('docker: unknown command: docker node ' + (op || ''));
  }

  // --- service ---
  function parseSvcFlags(a, forUpdate) {
    var o = { env: [], p: [], cons: [], rmP: [], args: [] };
    for (var i = 0; i < a.length; i++) {
      var t = a[i], v = null, k = t;
      if (/^--[\w-]+=/.test(t)) { k = t.slice(0, t.indexOf('=')); v = t.slice(t.indexOf('=') + 1); }
      var take = function () { if (v !== null) return v; i++; if (a[i] === undefined) throw 'flag needs an argument: ' + k; return a[i]; };
      switch (k) {
        case '--name': o.name = take(); break;
        case '--replicas': o.replicas = take(); break;
        case '-p': case '--publish': case '--publish-add': o.p.push(take()); break;
        case '--publish-rm': o.rmP.push(take()); break;
        case '--mode': o.mode = take(); break;
        case '--image': o.image = take(); break;
        case '-e': case '--env': case '--env-add': o.env.push(take()); break;
        case '--constraint': case '--constraint-add': o.cons.push(take()); break;
        case '--update-parallelism': o.par = take(); break;
        case '--update-delay': o.delay = take(); break;
        case '--update-failure-action': o.fail = take(); break;
        case '--rollback': o.rollback = true; break;
        case '--force': o.force = true; break;
        case '-d': case '--detach': o.detach = true; break;
        case '-q': case '--quiet': break;
        case '--network': case '--label': case '--limit-memory': case '--limit-cpu': case '--reserve-memory': case '--restart-condition': take(); break;
        default:
          if (t[0] === '-') throw 'unknown flag: ' + k;
          o.args.push(t);
      }
    }
    void forUpdate;
    return o;
  }
  function parseDelay(d) {
    var m = /^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(String(d));
    if (!m) return null;
    return parseFloat(m[1]) * (m[2] === 'ms' ? 1 : m[2] === 'm' ? 60000 : 1000);
  }
  function portsFrom(list, s) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var x = String(list[i]), m = /^(?:published=(\d+),\s*target=(\d+)|(\d+):(\d+))(\/tcp)?$/.exec(x);
      if (!m) return { err: 'invalid argument "' + x + '" for "-p, --publish" flag: invalid published port' };
      var p = { p: +(m[1] || m[3]), t: +(m[2] || m[4]) };
      var clash = W.svcs.filter(function (z) { return z !== s && z.ports.some(function (q) { return q.p === p.p; }); })[0];
      if (clash) return { err: 'Error response from daemon: rpc error: code = InvalidArgument desc = port \'' + p.p + '\' is already in use by service \'' + clash.name + '\' (' + clash.id + ') as an ingress port' };
      out.push(p);
    }
    return { ports: out };
  }
  function createService(spec) {
    var s = {
      id: digest('svc' + spec.name + Math.random()).slice(0, 25), name: spec.name, image: spec.image, mode: spec.mode || 'replicated',
      replicas: spec.mode === 'global' ? 0 : (spec.replicas === undefined ? 1 : spec.replicas), ports: spec.ports || [], env: spec.env || [], cons: spec.cons || [],
      upd: spec.upd || { par: 1, delay: UPDATE_DELAY, delayLabel: '0s', failure: 'pause' }, tasks: [], ver: 1, created: Date.now(),
      updState: '', prev: null, stack: spec.stack || null, hue: HUES[W.svcs.length % HUES.length]
    };
    W.svcs.push(s);
    return s;
  }
  function serviceCmd(a) {
    var op = a[0], o;
    try { o = parseSvcFlags(a.slice(1)); } catch (e) { err(e); return; }
    if (op === 'create') {
      var image = o.args[0];
      if (!image) { err('"docker service create" requires at least 1 argument.'); dim('Usage:  docker service create [OPTIONS] IMAGE [COMMAND] [ARG...]'); return; }
      var name = o.name || ['admiring', 'bold', 'eager', 'jolly', 'quirky'][rnd(0, 4)] + '_' + ['turing', 'hopper', 'knuth', 'curie'][rnd(0, 3)];
      if (svcBy(name) && svcBy(name).name === name) { err('Error response from daemon: rpc error: code = AlreadyExists desc = name conflicts with an existing object: service ' + name + ' already exists'); return; }
      if (o.mode && o.mode !== 'global' && o.mode !== 'replicated') { err('invalid argument "' + o.mode + '" for "--mode" flag'); return; }
      var reps = o.replicas === undefined ? 1 : parseInt(o.replicas, 10);
      if (isNaN(reps) || reps < 0) { err('invalid argument "' + o.replicas + '" for "--replicas" flag'); return; }
      if (o.mode === 'global' && o.replicas !== undefined) { err('Error response from daemon: rpc error: code = InvalidArgument desc = replicas can only be used with replicated mode'); return; }
      var bad = o.cons.filter(function (c) { return !validCons(c); })[0];
      if (bad) { err('Error response from daemon: rpc error: code = InvalidArgument desc = invalid constraint: ' + bad); dim('# contoh: --constraint node.role==worker atau node.hostname==worker1'); return; }
      var pr = portsFrom(o.p, null);
      if (pr.err) { err(pr.err); return; }
      var upd = { par: o.par ? Math.max(0, parseInt(o.par, 10)) || 1 : 1, delay: o.delay ? Math.min(parseDelay(o.delay) || 0, 8000) * 0.25 : 0, delayLabel: o.delay || '0s', failure: o.fail || 'pause' };
      var s = createService({ name: name, image: image, mode: o.mode, replicas: reps, ports: pr.ports, env: o.env, cons: o.cons, upd: upd });
      out(s.id);
      if (!IMG[normRef(image)]) hint('# image ' + normRef(image) + ' ga ada di registry simulasi. Task-nya bakal Rejected terus.');
      K.pulse(app, 'sched');
      if (name === 'web' && reps >= 3 && pr.ports.some(function (p) { return p.p === 8080; })) M.hit('svc');
      if (!o.detach) convergeNote(s);
      return;
    }
    if (op === 'ls') {
      term.table([['ID', 'NAME', 'MODE', 'REPLICAS', 'IMAGE', 'PORTS']].concat(W.svcs.map(function (s) {
        var r = runningTasks(s).length + '/' + want(s);
        if (s.updating && !s.updating.paused) r += ' (updating)';
        return [s.id.slice(0, 12), s.name, s.mode, r, normRef(s.image), s.ports.map(function (p) { return '*:' + p.p + '->' + p.t + '/tcp'; }).join(', ')];
      })));
      return;
    }
    var s = svcBy(op === 'scale' ? (o.args[0] || '').split('=')[0] : o.args[o.args.length - 1]);
    if (op === 'scale') {
      if (!o.args.length) { err('"docker service scale" requires at least 1 argument.'); return; }
      o.args.forEach(function (kv) {
        var m = /^([\w.-]+)=(\d+)$/.exec(kv);
        if (!m) { err('invalid scale specifier \'' + kv + '\'. See \'docker service scale --help\''); return; }
        var sv = svcBy(m[1]);
        if (!sv) { err(m[1] + ': Error: No such service: ' + m[1]); return; }
        if (sv.mode === 'global') { err(sv.name + ': scale can only be used with replicated or replicated-job mode'); return; }
        sv.replicas = +m[2];
        out(sv.name + ' scaled to ' + m[2]);
        K.pulse(app, 'sched');
        if (sv.name === 'web' && +m[2] >= 6) M.hit('scale');
      });
      dim('overall progress: lihat kartu node di samping, atau docker service ps ' + (o.args[0] || '').split('=')[0]);
      return;
    }
    if (!s) { err('Error: No such service: ' + (o.args[o.args.length - 1] || '')); return; }
    if (op === 'ps') {
      var list = s.tasks.slice();
      if (a.indexOf('--no-trunc') < 0) { /* fine */ }
      taskTable(list, true);
      return;
    }
    if (op === 'inspect') {
      term.lines([
        'ID:\t\t' + s.id, 'Name:\t\t' + s.name + (s.stack ? '\nLabels:\n com.docker.stack.namespace=' + s.stack : ''),
        'Service Mode:\t' + (s.mode === 'global' ? 'Global' : 'Replicated'), s.mode === 'global' ? '' : ' Replicas:\t' + s.replicas,
        s.updState ? 'UpdateStatus:\n State:\t\t' + s.updState + (s.updating && s.updating.paused ? '\n Message:\t' + s.updating.msg : '') : '',
        'Placement:' + (s.cons.length ? '\n Constraints:\t[' + s.cons.join(' ') + ']' : ''),
        'UpdateConfig:', ' Parallelism:\t' + s.upd.par, ' Delay:\t\t' + s.upd.delayLabel, ' On failure:\t' + s.upd.failure,
        'ContainerSpec:', ' Image:\t\t' + normRef(s.image) + '@sha256:' + digest('img' + normRef(s.image)).slice(0, 16) + '…',
        s.env.length ? ' Env:\t\t' + s.env.join(' ') : '',
        'Endpoint Mode:\tvip', s.ports.length ? 'Ports:\n' + s.ports.map(function (p) { return ' PublishedPort = ' + p.p + '\n  Protocol = tcp\n  TargetPort = ' + p.t + '\n  PublishMode = ingress'; }).join('\n') : ''
      ].filter(Boolean).join('\n').split('\n').map(esc));
      return;
    }
    if (op === 'update') {
      if (o.rollback) { doRollback(s); return; }
      var changed = false;
      if (o.replicas !== undefined) { s.replicas = parseInt(o.replicas, 10) || 0; changed = true; }
      if (o.par) s.upd.par = Math.max(1, parseInt(o.par, 10) || 1);
      if (o.delay) { s.upd.delay = Math.min(parseDelay(o.delay) || 0, 8000) * 0.25; s.upd.delayLabel = o.delay; }
      if (o.fail) s.upd.failure = o.fail;
      if (o.cons.length) { var bc = o.cons.filter(function (c) { return !validCons(c); })[0]; if (bc) { err('invalid constraint: ' + bc); return; } s.cons = s.cons.concat(o.cons); changed = true; }
      if (o.p.length || o.rmP.length) {
        s.ports = s.ports.filter(function (p) { return o.rmP.every(function (r) { return String(p.t) !== String(r).split(':').pop() && String(p.p) !== String(r).split(':')[0]; }); });
        var np = portsFrom(o.p, s);
        if (np.err) { err(np.err); return; }
        s.ports = s.ports.concat(np.ports);
      }
      out(s.name);
      if (s.updating && s.updating.paused && !o.image && !o.force) {
        dim('# update sebelumnya masih paused. Pakai --image lain, --force, atau docker service rollback ' + s.name);
      }
      if (o.image || o.env.length || o.force) {
        var img = o.image || s.image;
        if (o.env.length) s.env = s.env.concat(o.env);
        s.updating = null;
        startUpdate(s, img, false);
        if (!IMG[normRef(img)]) hint('# image ' + normRef(img) + ' ga ada di registry. Lihat apa yang terjadi di docker service ps ' + s.name);
        dim('overall progress: rolling update ' + s.upd.par + ' task sekali jalan, jeda ' + s.upd.delayLabel + ' (dipercepat), kalau gagal: ' + s.upd.failure);
      } else if (!changed && !o.p.length && !o.rmP.length && !o.par && !o.delay && !o.fail) dim('# ga ada yang berubah');
      K.pulse(app, 'sched');
      return;
    }
    if (op === 'rollback') { doRollback(s); return; }
    if (op === 'rm') {
      o.args.forEach(function (n) {
        var x = svcBy(n);
        if (!x) { err('Error: No such service: ' + n); return; }
        W.svcs = W.svcs.filter(function (z) { return z !== x; });
        out(n);
      });
      return;
    }
    if (op === 'logs') {
      var r = runningTasks(s).slice(0, 4);
      if (!r.length) { dim('# belum ada task yang jalan'); return; }
      r.forEach(function (t) {
        var pre = '<span class="dk-svc">' + esc(s.name + '.' + (t.slot || t.node) + '.' + t.id.slice(0, 12) + '@' + t.node) + '</span>    | ';
        var meta = IMG[normRef(t.image)] || {};
        if (meta.http === 'nginx') { term.line(pre + '/docker-entrypoint.sh: Configuration complete; ready for start up'); }
        else if (meta.http === 'whoami') term.line(pre + esc('Starting up on port 80'));
        else term.line(pre + 'started');
        (t.hits || []).slice(-2).forEach(function (h) { term.line(pre + esc(h)); });
      });
      return;
    }
    err('docker: unknown command: docker service ' + (op || ''));
  }
  function doRollback(s) {
    if (!s.prev) { err('Error response from daemon: rpc error: code = FailedPrecondition desc = service ' + s.id + ' does not have a previous spec'); return; }
    out(s.name);
    out('rollback: manually requested rollback');
    s.updating = null;
    startUpdate(s, s.prev.image, true);
    K.pulse(app, 'sched');
  }
  function convergeNote(s) {
    dim('overall progress: 0 out of ' + want(s) + ' tasks');
    dim('verify: Waiting… (lihat task-nya muncul di kartu node, atau docker service ps ' + s.name + ')');
  }
  function taskState(t) {
    var map = { new: 'New', pending: 'Pending', assigned: 'Assigned', preparing: 'Preparing', starting: 'Starting', running: 'Running', shutdown: 'Shutdown', rejected: 'Rejected', failed: 'Failed', orphaned: 'Running' };
    return map[t.state] + ' ' + ago(t.since);
  }
  function taskTable(list, mark) {
    if (!list.length) { dim('# belum ada task'); return; }
    var rows = [['ID', 'NAME', 'IMAGE', 'NODE', 'DESIRED STATE', 'CURRENT STATE', 'ERROR']];
    var groups = {};
    list.forEach(function (t) { var k = t.svc.name + '|' + slotKey(t); (groups[k] = groups[k] || []).push(t); });
    Object.keys(groups).sort(function (a, b) {
      var A = groups[a][0], B = groups[b][0];
      return A.svc.name.localeCompare(B.svc.name) || (A.slot - B.slot) || String(A.node).localeCompare(String(B.node));
    }).forEach(function (k) {
      var g = groups[k].slice().sort(function (a, b) { return (live(b) ? 1 : 0) - (live(a) ? 1 : 0) || b.born - a.born; });
      g.forEach(function (t, i) {
        var nm = t.svc.name + '.' + (t.svc.mode === 'global' ? t.node ? W.nodes[t.node].id.slice(0, 25) : '?' : t.slot);
        rows.push([t.id.slice(0, 12), (mark && i > 0 ? ' \\_ ' : '') + nm, normRef(t.image), t.node || '', t.desired === 'running' ? 'Running' : 'Shutdown', taskState(t), t.err ? '"' + (t.err.length > 38 ? t.err.slice(0, 37) + '…' : t.err) + '"' : '']);
      });
    });
    var el = term.table(rows);
    // colour states inside the block
    el.innerHTML = el.innerHTML.replace(/(Rejected|Failed)( [^ ]+ [^ ]+( ago)?)/g, '<span class="sx-err">$1$2</span>').replace(/\bRunning (\d+ seconds? ago|About a minute ago|\d+ minutes ago)/g, '<span class="sx-ok">Running $1</span>');
  }
  function localPs(host, a) {
    void a;
    var n = W.nodes[host], rows = [['CONTAINER ID', 'IMAGE', 'STATUS', 'NAMES']];
    W.svcs.forEach(function (s) {
      s.tasks.forEach(function (t) {
        if (t.node === host && t.state === 'running' && t.desired === 'running') rows.push([t.cid, normRef(t.image), 'Up ' + ago(t.since).replace(' ago', ''), s.name + '.' + (t.slot || n.id.slice(0, 25)) + '.' + t.id.slice(0, 25)]);
      });
    });
    term.table(rows);
    if (rows.length === 1 && W.swarm) dim('# ga ada task di ' + host + '. Task bisa jalan di node mana pun, lihat docker service ps NAMA di manager.');
  }

  // --- stack ---
  function stackCmd(a) {
    var op = a[0];
    if (op === 'deploy' || op === 'up') {
      var ci = a.indexOf('-c') >= 0 ? a.indexOf('-c') : a.indexOf('--compose-file');
      var file = ci >= 0 ? a[ci + 1] : null;
      var name = a.filter(function (x, i) { return i > 0 && x[0] !== '-' && i !== ci + 1; })[0];
      if (!file) { err('Please specify only one compose file (with --compose-file).'); return; }
      if (file !== 'stack.yml' && file !== './stack.yml') { err('open ' + file + ': no such file or directory'); return; }
      if (!name) { err('"docker stack deploy" requires exactly 1 argument.'); return; }
      deploy(name);
      return;
    }
    if (op === 'ls') {
      var st = {};
      W.svcs.forEach(function (s) { if (s.stack) st[s.stack] = (st[s.stack] || 0) + 1; });
      term.table([['NAME', 'SERVICES']].concat(Object.keys(st).map(function (k) { return [k, String(st[k])]; })));
      return;
    }
    var nm = a[1];
    var svcs = W.svcs.filter(function (s) { return s.stack === nm; });
    if (op === 'services') {
      if (!svcs.length) { out('Nothing found in stack: ' + (nm || '')); return; }
      term.table([['ID', 'NAME', 'MODE', 'REPLICAS', 'IMAGE']].concat(svcs.map(function (s) { return [s.id.slice(0, 12), s.name, s.mode, runningTasks(s).length + '/' + want(s), normRef(s.image)]; })));
      return;
    }
    if (op === 'ps') {
      if (!svcs.length) { out('Nothing found in stack: ' + (nm || '')); return; }
      var l = [];
      svcs.forEach(function (s) { l = l.concat(s.tasks); });
      taskTable(l, true);
      return;
    }
    if (op === 'rm' || op === 'down') {
      if (!svcs.length) { out('Nothing found in stack: ' + (nm || '')); return; }
      svcs.forEach(function (s) { out('Removing service ' + s.name); });
      out('Removing network ' + nm + '_default');
      W.svcs = W.svcs.filter(function (s) { return s.stack !== nm; });
      return;
    }
    err('docker: unknown command: docker stack ' + (op || ''));
  }
  function deploy(stack) {
    var doc;
    try { doc = K.parseYAML(W.file); }
    catch (e) { err('yaml: line ' + e.line + ': ' + e.msg); markErr(e.line); return; }
    if (!doc || !doc.services || typeof doc.services !== 'object') { err('Top-level object must be a mapping'); markErr(1); return; }
    var specs = [];
    var names = Object.keys(doc.services);
    for (var i = 0; i < names.length; i++) {
      var n = names[i], s = doc.services[n] || {}, ln = K.yamlLine(doc.services, n);
      if (typeof s !== 'object') { err('services.' + n + ' must be a mapping'); markErr(ln); return; }
      if (s.build && !s.image) { err('service ' + n + ': build ga didukung di swarm, pakai image yang sudah di-push ke registry'); markErr(K.yamlLine(s, 'build')); return; }
      if (!s.image) { err('Service ' + n + ' has neither an image nor a build context specified. At least one must be provided.'); markErr(ln); return; }
      var d = s.deploy || {};
      var known = ['replicas', 'mode', 'update_config', 'placement', 'resources', 'restart_policy', 'labels', 'rollback_config'];
      var bad = Object.keys(d).filter(function (k) { return known.indexOf(k) < 0; })[0];
      if (bad) { err('services.' + n + '.deploy Additional property ' + bad + ' is not allowed'); markErr(K.yamlLine(d, bad)); return; }
      if (d.mode && d.mode !== 'global' && d.mode !== 'replicated') { err('services.' + n + '.deploy.mode must be one of the following: "replicated", "global"'); markErr(K.yamlLine(d, 'mode')); return; }
      var reps = d.replicas === undefined ? 1 : parseInt(d.replicas, 10);
      if (isNaN(reps)) { err('services.' + n + '.deploy.replicas must be a integer'); markErr(K.yamlLine(d, 'replicas')); return; }
      var uc = d.update_config || {};
      var cons = (d.placement && d.placement.constraints) || [];
      if (!Array.isArray(cons)) { err('services.' + n + '.deploy.placement.constraints must be a list'); markErr(K.yamlLine(d.placement, 'constraints')); return; }
      var bc = cons.filter(function (c) { return !validCons(String(c)); })[0];
      if (bc) { err('invalid constraint: ' + bc + '. Contoh: node.role == worker'); markErr(K.yamlLine(d.placement, 'constraints')); return; }
      var env = [];
      if (Array.isArray(s.environment)) env = s.environment.map(String);
      else if (s.environment) Object.keys(s.environment).forEach(function (k) { env.push(k + '=' + s.environment[k]); });
      specs.push({
        name: stack + '_' + n, image: String(s.image), mode: d.mode === 'global' ? 'global' : 'replicated', replicas: reps,
        ports: (s.ports || []).map(String), env: env, cons: cons.map(String), stack: stack,
        upd: { par: uc.parallelism ? parseInt(uc.parallelism, 10) || 1 : 1, delay: Math.min(parseDelay(uc.delay || '0s') || 0, 8000) * 0.25, delayLabel: String(uc.delay || '0s'), failure: uc.failure_action || 'pause' }
      });
    }
    W.errs = [];
    ed.mark([]);
    var exist = W.svcs.some(function (s) { return s.stack === stack; });
    if (!exist) out('Creating network ' + stack + '_default');
    for (var k = 0; k < specs.length; k++) {
      var sp = specs[k], cur = svcBy(sp.name);
      var pr = portsFrom(sp.ports, cur && cur.name === sp.name ? cur : null);
      if (pr.err) { err('failed to ' + (cur ? 'update' : 'create') + ' service ' + sp.name + ': ' + pr.err.replace(/^Error response from daemon: /, '')); return; }
      if (cur && cur.name === sp.name) {
        out('Updating service ' + sp.name + ' (id: ' + cur.id + ')');
        cur.ports = pr.ports; cur.cons = sp.cons; cur.upd = sp.upd; cur.env = sp.env;
        if (cur.mode === 'replicated') cur.replicas = sp.replicas;
        if (normRef(cur.image) !== normRef(sp.image)) { cur.updating = null; startUpdate(cur, sp.image, false); }
      } else {
        sp.ports = pr.ports;
        var s2 = createService(sp);
        out('Creating service ' + s2.name);
      }
    }
    K.pulse(app, 'sched');
    if (W.drained) M.hit('drain');
    else hint('# stack ter-deploy. Misi terakhir juga minta satu worker di-drain dulu.');
  }

  // ---------- routing mesh ----------
  function curl(a, from) {
    var url = a.filter(function (x) { return x[0] !== '-'; })[0];
    if (!url) { err('curl: try \'curl --help\' for more information'); return; }
    var m = /^(?:https?:\/\/)?([^:/]+)(?::(\d+))?/.exec(url);
    var host = m[1] === 'localhost' || m[1] === '127.0.0.1' ? from : m[1];
    var nd = W.nodes[host] || nodes().filter(function (n) { return IPS[n.name] === host; })[0];
    var port = parseInt(m[2] || '80', 10);
    if (!nd) { err('curl: (6) Could not resolve host: ' + m[1]); return; }
    if (!nd.power) { err('curl: (28) Failed to connect to ' + m[1] + ' port ' + port + ' after 3002 ms: Timeout was reached'); return; }
    var s = W.svcs.filter(function (x) { return x.ports.some(function (p) { return p.p === port; }); })[0];
    if (!s || !nd.joined) { err('curl: (7) Failed to connect to ' + m[1] + ' port ' + port + ' after 0 ms: Couldn\'t connect to server'); if (s && !nd.joined) dim('# ' + nd.name + ' belum gabung swarm, jadi routing mesh ga ada di sana'); return; }
    var tp = s.ports.filter(function (p) { return p.p === port; })[0].t;
    var pool = runningTasks(s);
    if (!pool.length) { err('curl: (7) Failed to connect to ' + m[1] + ' port ' + port + ' after 0 ms: Couldn\'t connect to server'); dim('# belum ada task ' + s.name + ' yang Running'); return; }
    W.rr[s.id] = ((W.rr[s.id] || 0) + 1) % pool.length;
    var t = pool[W.rr[s.id]];
    var meta = IMG[normRef(t.image)] || {};
    t.hits = t.hits || [];
    t.hits.push('10.0.0.' + rnd(2, 9) + ' - - "GET / HTTP/1.1" 200');
    K.pulse(app, 'mesh');
    hitTask(t);
    if (meta.port !== tp || !meta.http) {
      err(meta.port === 6379 ? 'curl: (52) Empty reply from server' : 'curl: (56) Recv failure: Connection reset by peer');
      if (meta.port !== tp) hint('# app di image ' + normRef(t.image) + ' listen di port ' + (meta.port || '?') + ', bukan ' + tp + '. Cek -p PUBLISHED:TARGET');
      return;
    }
    if (meta.http === 'nginx') term.lines(['&lt;title&gt;Welcome to nginx!&lt;/title&gt;', '&lt;h1&gt;Welcome to nginx!&lt;/h1&gt; <span class="sx-dim">(nginx/' + meta.ver + ')</span>']);
    else if (meta.http === 'whoami') term.lines(['Hostname: ' + t.cid, 'IP: 127.0.0.1', 'IP: 10.0.1.' + (W.svcs.indexOf(s) * 10 + (t.slot || 1) + 2), 'RemoteAddr: 10.0.0.' + rnd(2, 9) + ':' + rnd(30000, 60000), 'GET / HTTP/1.1', 'Host: ' + esc(m[1]) + ':' + port]);
    else if (meta.http === 'httpd') term.line('&lt;html&gt;&lt;body&gt;&lt;h1&gt;It works!&lt;/h1&gt;&lt;/body&gt;&lt;/html&gt;');
    else term.line('<span class="sx-dim"># HELP</span> node_cpu_seconds_total Seconds the CPUs spent in each mode.');
    var here = t.node === nd.name;
    dim('# dijawab ' + s.name + '.' + (t.slot || t.node) + ' di ' + t.node + (here ? '' : ', diteruskan routing mesh dari ' + nd.name));
    if (!here && s.name === 'web' && !runningTasks(s).some(function (x) { return x.node === nd.name; })) M.hit('mesh');
  }

  // ---------- editor ----------
  var ed = new K.Editor($('sw-ed'), {
    value: STACK0, label: 'Isi stack.yml', highlight: K.hlYAML,
    onChange: function (v) { W.file = v; W.errs = []; }
  });
  function markErr(line) { W.errs = line ? [line] : []; ed.mark(W.errs); }

  // ---------- render ----------
  var cards = {}, chips = {};
  function hitTask(t) {
    var el = chips[t.id];
    if (!el) return;
    el.classList.remove('is-hit');
    void el.offsetWidth;
    el.classList.add('is-hit');
  }
  function buildCards() {
    var box = $('sw-nodes');
    box.innerHTML = '';
    NODE_NAMES.forEach(function (n) {
      var el = document.createElement('div');
      el.className = 'sw-node';
      el.innerHTML = '<div class="sw-nh"><i class="an-dot" aria-hidden="true"></i><b>' + n + '</b><span class="sw-role"></span>' +
        (n === 'manager1' ? '' : '<label class="gx-sw sw-pw" title="nyalakan / matikan mesin"><input type="checkbox" data-act="power" data-n="' + n + '" checked><span aria-hidden="true"></span><i class="sr">daya ' + n + '</i></label>') +
        '</div><div class="sw-meta"></div><div class="sw-tasks"></div><div class="sw-act"></div>';
      box.appendChild(el);
      cards[n] = { el: el, role: el.querySelector('.sw-role'), meta: el.querySelector('.sw-meta'), tasks: el.querySelector('.sw-tasks'), act: el.querySelector('.sw-act'), pw: el.querySelector('input') };
    });
  }
  function render() {
    var now = Date.now();
    var all = [];
    NODE_NAMES.forEach(function (name) {
      var n = W.nodes[name], c = cards[name];
      var st = !n.power ? 'off' : !n.joined ? 'out' : n.status === 'down' ? 'down' : n.avail !== 'active' ? 'drain' : 'ok';
      c.el.className = 'sw-node is-' + st + (name === W.at ? ' is-here' : '');
      setText(c.role, n.joined ? (n.role === 'manager' ? (n.leader ? 'Leader' : 'manager') : 'worker') : 'belum gabung');
      c.role.className = 'sw-role' + (n.joined && n.role === 'manager' ? ' is-mgr' : '');
      var meta = IPS[name] + ' · ' + (!n.power ? 'mati' : !n.joined ? 'docker biasa' : n.status === 'down' ? 'Down' : n.power && now - n.offAt < 0 ? '' : 'Ready') + (n.joined && n.avail !== 'active' ? ' · ' + n.avail : '') + (name === W.at ? ' · kamu di sini' : '');
      setText(c.meta, meta);
      if (c.pw && c.pw.checked !== n.power) c.pw.checked = n.power;
      // task chips, keyed so they animate in and out
      var mine = [];
      W.svcs.forEach(function (s) { s.tasks.forEach(function (t) { if (t.node === name && (live(t) || now - t.since < 1600 && t.state !== 'rejected')) mine.push(t); }); });
      mine.sort(function (a, b) { return W.svcs.indexOf(a.svc) - W.svcs.indexOf(b.svc) || (a.slot - b.slot); });
      var keep = {};
      mine.forEach(function (t, i) {
        keep[t.id] = true;
        var el = chips[t.id];
        if (!el) {
          el = document.createElement('span');
          chips[t.id] = el;
        }
        var cls = 'sw-t' + (t.state === 'running' && t.desired === 'running' ? ' is-run' : live(t) ? ' is-start' : ' is-stop') + (t.state === 'orphaned' ? ' is-lost' : '');
        if (el.className.replace(/ ?is-hit/, '') !== cls) el.className = cls + (el.classList.contains('is-hit') ? ' is-hit' : '');
        el.dataset.hue = t.svc.hue;
        var label = t.svc.name.replace(/^[^_]+_/, '') + '.' + (t.svc.mode === 'global' ? 'g' : t.slot);
        var ver = (IMG[normRef(t.image)] || {}).ver;
        setHTML(el, esc(label) + (t.svc.prev || t.ver > 1 ? '<small>' + esc(ver || normRef(t.image).split(':')[1]) + '</small>' : ''));
        el.title = t.svc.name + ' · ' + normRef(t.image) + ' · ' + t.state;
        if (c.tasks.children[i] !== el) c.tasks.insertBefore(el, c.tasks.children[i] || null);
      });
      Array.prototype.slice.call(c.tasks.children).forEach(function (ch) { if (!ch.classList.contains('sw-none') && mine.every(function (t) { return chips[t.id] !== ch; })) c.tasks.removeChild(ch); });
      if (!mine.length) { if (!c.tasks.querySelector('.sw-none')) { var e = document.createElement('span'); e.className = 'sw-none'; e.textContent = n.joined ? 'belum ada task' : ''; c.tasks.appendChild(e); } }
      else { var nn = c.tasks.querySelector('.sw-none'); if (nn) c.tasks.removeChild(nn); }
      all = all.concat(mine);
      var act = '';
      if (!n.joined && W.swarm && name !== 'manager1' && n.power) act = '<button type="button" data-act="join" data-n="' + name + '">gabung ke swarm</button>';
      else if (n.joined && n.role === 'worker' && n.power) act = n.avail === 'active' ? '<button type="button" data-act="cmd" data-cmd="docker node update --availability drain ' + name + '">drain</button>' : '<button type="button" data-act="cmd" data-cmd="docker node update --availability active ' + name + '">aktifkan</button>';
      if (n.joined && n.power) act += '<button type="button" data-act="cmd" data-cmd="curl ' + name + ':' + (W.svcs[0] && W.svcs[0].ports[0] ? W.svcs[0].ports[0].p : 8080) + '">curl</button>';
      setHTML(c.act, act);
    });
    Object.keys(chips).forEach(function (id) { if (!all.some(function (t) { return t.id === id; })) delete chips[id]; });

    // services list
    var box = $('sw-svcs');
    setHTML(box, W.svcs.map(function (s) {
      var r = runningTasks(s).length, wnt = want(s);
      var stt = s.updating ? (s.updating.paused ? 'paused' : s.updating.rollback ? 'rollback…' : 'updating…') : s.updState === 'rollback_completed' ? 'rollback selesai' : s.updState === 'completed' ? 'update selesai' : '';
      var pct = wnt ? Math.round(r / wnt * 100) : 100;
      var cls = s.updating && s.updating.paused ? 'bad' : r < wnt ? 'warn' : 'ok';
      var newV = s.tasks.filter(function (t) { return t.ver === s.ver && t.state === 'running' && t.desired === 'running'; }).length;
      return '<div class="sw-svc" data-hue="' + s.hue + '"><div class="sw-sh"><b>' + esc(s.name) + '</b><span class="sw-rep" data-s="' + cls + '">' + r + '/' + wnt + '</span>' +
        (stt ? '<em data-s="' + cls + '">' + esc(stt) + '</em>' : '') + '</div>' +
        '<div class="dk-meta">' + esc(normRef(s.image)) + ' · ' + (s.mode === 'global' ? 'global' : s.replicas + ' replika') + (s.ports.length ? ' · ' + s.ports.map(function (p) { return ':' + p.p + '→' + p.t; }).join(' ') : '') + (s.cons.length ? ' · ' + esc(s.cons.join(', ')) : '') + '</div>' +
        '<div class="sw-bar" aria-hidden="true"><i style="width:' + pct + '%"></i>' + (s.updating ? '<i class="sw-new" style="width:' + (wnt ? Math.round(newV / wnt * 100) : 0) + '%"></i>' : '') + '</div>' +
        (s.updating && s.updating.paused ? '<div class="dk-log">' + esc(s.updating.msg) + '</div>' : '') +
        '</div>';
    }).join(''));
    $('sw-svcs-empty').hidden = W.svcs.length > 0;
    setText($('sw-svc-chip'), W.svcs.length + ' service');

    // flow
    var fm = $('sw-f-mgr'), mgrs = members().filter(function (n) { return n.role === 'manager'; }).length;
    setText(fm, W.swarm ? 'Leader' + (mgrs > 1 ? ' + ' + (mgrs - 1) : '') : 'belum init');
    fm.dataset.s = W.swarm ? 'ok' : '';
    var fs = $('sw-f-svc');
    setText(fs, W.svcs.length ? W.svcs.length + ' service' : 'belum ada');
    var upd = W.svcs.some(function (s) { return s.updating && !s.updating.paused; }), paused = W.svcs.some(function (s) { return s.updating && s.updating.paused; });
    fs.dataset.s = paused ? 'bad' : upd ? 'info' : W.svcs.length ? 'ok' : '';
    var ft = $('sw-f-node');
    var mem = members(), ready = mem.filter(function (n) { return n.status === 'ready' && n.power; }).length;
    setText(ft, mem.length ? ready + '/' + mem.length + ' Ready' : '1 mesin');
    ft.dataset.s = mem.length && ready < mem.length ? 'warn' : mem.length ? 'ok' : '';
    var ports = [];
    W.svcs.forEach(function (s) { s.ports.forEach(function (p) { ports.push(':' + p.p); }); });
    var fp = $('sw-f-mesh');
    setText(fp, ports.length ? ports.slice(0, 3).join(' ') : 'belum ada');
    fp.dataset.s = ports.length ? 'ok' : '';
    setText($('sw-cl-chip'), mem.length ? mem.length + ' node di swarm' : '4 mesin');

    // heal mission: a task was lost with its node and the service is whole again
    W.svcs.forEach(function (s) {
      if (s.tasks.some(function (t) { return t.lostNode; }) && runningTasks(s).length >= want(s) && want(s) > 0 && !s.updating) M.hit('heal');
    });
  }
  function renderQuick() {
    var q;
    if (W.at !== 'manager1') q = [['docker ps', 'docker ps'], ['docker node ls', 'docker node ls'], ['exit', 'exit']];
    else if (!W.swarm) q = [['swarm init', 'docker swarm init'], ['node ls', 'docker node ls'], ['help', 'help']];
    else q = [
      ['node ls', 'docker node ls'],
      ['create web', 'docker service create --name web --replicas 3 -p 8080:80 nginx:1.25'],
      ['service ps web', 'docker service ps web'],
      ['curl :8080', 'curl worker1:8080'],
      ['scale web=6', 'docker service scale web=6'],
      ['update 1.27', 'docker service update --image nginx:1.27 web'],
      ['update 9.9', 'docker service update --image nginx:9.9 web'],
      ['rollback', 'docker service rollback web'],
      ['service ls', 'docker service ls']
    ];
    setHTML($('sw-quick'), q.map(function (x) { return '<button type="button" data-act="cmd" data-cmd="' + esc(x[1]) + '">' + esc(x[0]) + '</button>'; }).join(''));
  }

  // ---------- wiring ----------
  app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b || b.disabled || b.tagName === 'INPUT') return;
    var act = b.dataset.act;
    if (act === 'cmd') term.submit(b.dataset.cmd);
    else if (act === 'join') term.submit('ssh ' + b.dataset.n + ' docker swarm join --token ' + W.tok.w + ' ' + IPS.manager1 + ':2377');
    else if (act === 'file-reset') { W.file = STACK0; ed.set(STACK0); markErr(0); toast('stack.yml balik ke versi awal'); }
    else if (act === 'reset') reset();
  });
  app.addEventListener('change', function (e) {
    var t = e.target;
    if (t.dataset && t.dataset.act === 'power') {
      var n = W.nodes[t.dataset.n];
      n.power = t.checked;
      if (!n.power) {
        n.offAt = Date.now();
        term.line('<span class="sx-dim"># ' + n.name + ' dimatikan. Manager baru sadar setelah heartbeat-nya hilang beberapa detik.</span>');
        if (W.at === n.name) { W.at = 'manager1'; $('sw-ps').textContent = ps(); dim('# koneksi ssh ke ' + n.name + ' putus, balik ke manager1'); renderQuick(); }
      } else {
        term.line('<span class="sx-dim"># ' + n.name + ' dinyalakan lagi.' + (n.joined ? ' Task yang sudah dipindah ga balik sendiri; Swarm ga rebalance otomatis.' : '') + '</span>');
      }
      tick();
    }
  });
  setInterval(tick, 250);

  function reset() {
    initWorld();
    term.clear();
    M.reset();
    chips = {};
    buildCards();
    ed.set(STACK0);
    markErr(0);
    $('sw-ps').textContent = ps();
    renderQuick();
    term.lines([
      '<span class="sx-dim"># Ada 4 mesin dengan Docker: manager1 (tempat terminal ini), worker1, worker2, worker3. Belum ada yang jadi swarm.</span>',
      '<span class="sx-dim"># Mulai dengan </span><b>docker swarm init</b><span class="sx-dim">. Ketik </span><b>help</b><span class="sx-dim"> buat daftar perintah.</span>'
    ]);
    render();
  }
  initWorld();
  reset();
})();
