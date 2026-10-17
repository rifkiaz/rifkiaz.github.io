// Ceph simulator for /ceph/. Three hosts with two 100 GiB OSDs each (a
// fourth can be added), three monitors, pools split into placement groups,
// a small CRUSH (straw2-style, host failure domain), and recovery/backfill
// that moves data between OSDs over time. Time is sped up. Nothing is stored.
(function () {
  'use strict';

  var K = window.SimKit;
  var app = document.getElementById('cp');
  if (!app || !K) return;
  var esc = K.esc, setHTML = K.setHTML, setText = K.setText;
  var digest = K.digest, words = K.words;
  function $(id) { return document.getElementById(id); }
  function rnd(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function h32(s) { return parseInt(digest(s).slice(0, 8), 16); }

  var OSD_GIB = 100, NEARFULL = 0.85, FULL = 0.95, BACKFILLFULL = 0.9;
  var DOWN_OUT_MS = 12000;           // mon_osd_down_out_interval, real default 600s
  var HEARTBEAT_MS = 1500;           // how long before a dead OSD is reported down
  var RATE = 0.4;                    // GiB/s each OSD can backfill
  var OBJ_MIB = 4;
  var FSID = digest('fsid').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5');
  var HOSTS0 = [
    { name: 'node1', ip: '10.0.0.21', mon: true, joined: true, disks: 2 },
    { name: 'node2', ip: '10.0.0.22', mon: true, joined: true, disks: 2 },
    { name: 'node3', ip: '10.0.0.23', mon: true, joined: true, disks: 2 },
    { name: 'node4', ip: '10.0.0.24', mon: false, joined: false, disks: 2 }
  ];

  var MISSIONS = [
    { id: 'health', text: 'Cek kondisi cluster pakai <b>ceph -s</b>.' },
    { id: 'pool', text: 'Bikin pool <b>data</b>, aktifkan application-nya, lalu simpan objek pakai <i>rados put</i>.' },
    { id: 'map', text: 'Cari tahu objekmu disimpan di OSD mana: <b>ceph osd map data NAMA</b>.' },
    { id: 'recover', text: 'Isi pool dengan data, rusakkan satu disk OSD, lalu tunggu sampai <b>HEALTH_OK</b> lagi tanpa disk itu.' },
    { id: 'noout', text: 'Maintenance: <b>ceph osd set noout</b>, matikan satu node, nyalakan lagi, lalu <i>unset noout</i>.' },
    { id: 'full', text: 'Isi cluster sampai <b>nearfull</b>, lalu tambah node4 dan OSD-nya supaya peringatannya hilang.' },
    { id: 'quorum', text: 'Matikan node2 dan node3 sekaligus: monitor kehilangan <b>quorum</b>. Lalu pulihkan.' }
  ];

  // ---------- state ----------
  var W;
  function initWorld() {
    W = {
      run: (W ? W.run : 0) + 1, epoch: 41, busy: false,
      hosts: {}, osds: [], pools: [], flags: {}, nextPool: 2,
      lastMap: null, sawNearfull: false, quorumLost: false, nooutCycle: false, hostWasOff: {},
      recBytes: 0, recObjs: 0, created: Date.now() - 3 * 3600e3, lastHealth: 'HEALTH_OK', allowDelete: false
    };
    HOSTS0.forEach(function (h) {
      W.hosts[h.name] = { name: h.name, ip: h.ip, mon: h.mon, joined: h.joined, power: true, disks: h.disks, offAt: 0 };
      if (h.joined) for (var i = 0; i < h.disks; i++) addOsd(h.name, true);
    });
    // every cephadm cluster starts with the .mgr pool
    var mgr = makePool('.mgr', 1, true);
    mgr.app = 'mgr';
    mgr.pgs[0].bytes = 0.002;
    mgr.objs = 2;
  }
  function addOsd(host, quiet) {
    var o = {
      id: W.osds.length, host: host, up: true, in: true, failed: false, downAt: 0, autoOut: false,
      upSince: quiet ? W.created : Date.now(), inSince: quiet ? W.created : Date.now(), dev: '/dev/sd' + 'bcdefgh'[W.osds.filter(function (x) { return x.host === host; }).length]
    };
    W.osds.push(o);
    if (!quiet) W.epoch++;
    return o;
  }
  function makePool(name, pgn, quiet) {
    var p = { id: W.nextPool === 2 && name === '.mgr' ? 1 : W.nextPool++, name: name, size: 3, min: 2, pgn: pgn, app: null, objects: {}, bulk: 0, bulkObjs: 0, pgs: [], created: Date.now() };
    if (name === '.mgr') W.nextPool = 2;
    for (var i = 0; i < pgn; i++) p.pgs.push(newPg(p, i));
    p.pgs.forEach(function (g) { crushPg(p, g); g.target.forEach(function (o) { g.copies[o] = 1; }); });
    W.pools.push(p);
    if (!quiet) W.epoch++;
    return p;
  }
  function newPg(p, i) { return { pool: p, n: i, id: p.id + '.' + i.toString(16), bytes: 0, objs: 0, copies: {}, target: [], ver: 0 }; }
  function poolBy(n) { return W.pools.filter(function (p) { return p.name === n; })[0]; }
  function osdBy(id) { return W.osds[id]; }
  function hostOsds(h) { return W.osds.filter(function (o) { return o.host === h; }); }
  function monsUp() { return Object.keys(W.hosts).filter(function (h) { return W.hosts[h].mon && W.hosts[h].power; }); }
  function quorum() { return monsUp().length >= 2; }

  // ---------- CRUSH ----------
  // straw2: every candidate draws ln(u)/weight, the biggest draw wins
  function draw(key, w) { var u = (h32(key) + 1) / 4294967297; return Math.log(u) / w; }
  function crushPg(p, g) {
    var cands = Object.keys(W.hosts).filter(function (h) { return W.hosts[h].joined; }).map(function (h) {
      var os = hostOsds(h).filter(function (o) { return o.in; });
      return { h: h, os: os, w: os.length };
    }).filter(function (c) { return c.w > 0; });
    cands.forEach(function (c) { c.d = draw(g.id + '|' + c.h, c.w); });
    cands.sort(function (a, b) { return b.d - a.d; });
    g.target = cands.slice(0, p.size).map(function (c) {
      var best = null, bd = -Infinity;
      c.os.forEach(function (o) { var d = draw(g.id + '|osd.' + o.id, 1); if (d > bd) { bd = d; best = o; } });
      return best.id;
    });
  }
  function objPg(p, name) { return p.pgs[h32('obj' + name) % p.pgn]; }

  // ---------- simulation ----------
  var last = Date.now();
  function tick() {
    var now = Date.now(), dt = Math.min(1, (now - last) / 1000);
    last = now;
    var q = quorum();
    if (!q && !W.quorumLost) { W.quorumLost = true; sys('monitor kehilangan quorum (tinggal ' + monsUp().length + '/3 mon). Cluster berhenti melayani.', 'err'); }
    if (q && W.quorumLost && !W.quorumBack) { /* handled below */ }
    if (q && W.quorumLost) {
      W.quorumLost = false;
      sys('quorum kembali: ' + monsUp().join(',') + '. Cluster jalan lagi.');
      if (W.quorumSeen) M.hit('quorum');
    }
    if (!q) W.quorumSeen = true;
    // OSD daemons follow their host and disk; the mon only notices with quorum
    W.osds.forEach(function (o) {
      var h = W.hosts[o.host];
      var alive = h.power && !o.failed;
      if (!q) return;
      if (o.up && !alive) {
        if (!o.dying) o.dying = now;
        if (now - o.dying > HEARTBEAT_MS) { o.up = false; o.downAt = now; o.dying = 0; W.epoch++; sys('osd.' + o.id + ' down (' + (h.power ? 'disk rusak' : o.host + ' mati') + ')', 'warn'); K.flash(app, 'osd', 'warn'); }
      } else if (alive) o.dying = 0;
      if (!o.up && alive) {
        o.up = true; o.upSince = now; W.epoch++;
        sys('osd.' + o.id + ' up lagi');
        if (!o.in && o.autoOut) { o.in = true; o.autoOut = false; o.inSince = now; sys('osd.' + o.id + ' otomatis di-in lagi'); }
      }
      if (!o.up && o.in && !W.flags.noout && now - o.downAt > DOWN_OUT_MS) {
        o.in = false; o.autoOut = true; W.epoch++;
        sys('osd.' + o.id + ' ditandai out setelah down 600 dtk (di sini dipercepat). Data-nya mulai disalin ulang ke OSD lain.', 'warn');
      }
    });
    if (q) recover(dt);
    checkMissions();
    render();
  }
  function used(o) {
    var u = 0.6; // BlueStore DB/WAL overhead
    W.pools.forEach(function (p) { p.pgs.forEach(function (g) { var c = g.copies[o.id]; if (c) u += g.bytes * c; }); });
    return u;
  }
  function recover(dt) {
    var busyTarget = {}, moved = 0, movedObjs = 0;
    var usage = {};
    W.osds.forEach(function (o) { usage[o.id] = used(o); });
    W.pools.forEach(function (p) {
      p.pgs.forEach(function (g) {
        crushPg(p, g);
        var srcOk = Object.keys(g.copies).some(function (k) { return g.copies[k] >= 1 && osdBy(+k).up; });
        g.target.forEach(function (t) {
          if (g.copies[t] === undefined) g.copies[t] = g.bytes > 0 ? 0 : 1;
        });
        g.recovering = false;
        g.wait = false;
        g.toofull = false;
        g.target.forEach(function (t) {
          var c = g.copies[t];
          if (c >= 1) return;
          var o = osdBy(t);
          if (!o.up) return;
          if (!srcOk) return;
          if (usage[t] / OSD_GIB >= BACKFILLFULL) { g.toofull = true; return; }
          if (busyTarget[t]) { g.wait = true; return; }
          busyTarget[t] = true;
          var step = RATE * dt;
          var need = (1 - c) * g.bytes;
          var d = Math.min(step, need);
          g.copies[t] = Math.min(1, c + (g.bytes ? d / g.bytes : 1));
          if (g.copies[t] > 0.9999) g.copies[t] = 1;
          moved += d;
          movedObjs += g.bytes ? d / g.bytes * g.objs : 0;
          g.recovering = true;
        });
        // clean up copies that are no longer needed once the target is whole
        var whole = g.target.length && g.target.every(function (t) { return g.copies[t] >= 1 && osdBy(t).up; });
        Object.keys(g.copies).forEach(function (k) {
          k = +k;
          if (g.target.indexOf(k) >= 0) return;
          if (whole || !osdBy(k).up && !osdBy(k).in) {
            if (whole || g.copies[k] < 1) delete g.copies[k];
          }
          // a copy on an out OSD that is down is useless; keep it only while it can still serve
          if (g.copies[k] !== undefined && !osdBy(k).up && whole) delete g.copies[k];
        });
      });
    });
    W.recBytes = moved / Math.max(dt, 0.01);
    W.recObjs = movedObjs / Math.max(dt, 0.01);
  }
  // state string for one PG, like ceph pg dump
  function pgState(p, g) {
    var complete = Object.keys(g.copies).filter(function (k) { return g.copies[k] >= 1 && osdBy(+k).up; }).map(Number);
    var upTarget = g.target.filter(function (t) { return osdBy(t).up; });
    var n = complete.length;
    if (!quorum() && g.lastState) return g.lastState;
    var s;
    if (n === 0) s = g.bytes > 0 || !upTarget.length ? 'down' : 'active+clean';
    else if (n < p.min) s = 'undersized+degraded+peered';
    else {
      var f = ['active'];
      var undersized = upTarget.length < p.size;
      var degraded = n < p.size;
      var remapped = g.target.some(function (t) { return complete.indexOf(t) < 0; }) && !undersized;
      if (g.recovering) f.push(remapped && !degraded ? 'remapped+backfilling' : 'recovering');
      else if (g.toofull) f.push('remapped+backfill_toofull');
      else if (g.wait) f.push(remapped && !degraded ? 'remapped+backfill_wait' : 'recovery_wait');
      else if (remapped) f.push('remapped');
      if (undersized) f.push('undersized');
      if (degraded) f.push('degraded');
      if (!undersized && !degraded && !remapped && !g.recovering && !g.wait) f.push('clean');
      s = f.join('+');
    }
    g.lastState = s;
    return s;
  }
  function inactive(s) { return !/^active/.test(s); }
  function pgSummary() {
    var c = {}, tot = 0, degObjs = 0, missObjs = 0, allObjs = 0, inact = 0, deg = 0, unders = 0, toofull = 0;
    W.pools.forEach(function (p) {
      p.pgs.forEach(function (g) {
        var s = pgState(p, g);
        c[s] = (c[s] || 0) + 1;
        tot++;
        var complete = Object.keys(g.copies).filter(function (k) { return g.copies[k] >= 1 && osdBy(+k).up; }).length;
        var missing = Math.max(0, p.size - complete);
        degObjs += g.objs * missing;
        var misplaced = g.target.filter(function (t) { return !(g.copies[t] >= 1); }).length - missing;
        if (misplaced > 0) missObjs += g.objs * misplaced;
        allObjs += g.objs * p.size;
        if (inactive(s)) inact++;
        if (/degraded/.test(s)) deg++;
        if (/undersized/.test(s)) unders++;
        if (/toofull/.test(s)) toofull++;
      });
    });
    return { counts: c, tot: tot, degObjs: Math.round(degObjs), missObjs: Math.round(missObjs), allObjs: Math.round(allObjs), inact: inact, deg: deg, unders: unders, toofull: toofull };
  }
  function osdUtil(o) { return used(o) / OSD_GIB; }
  function healthChecks() {
    var out = [];
    var S = pgSummary();
    var mu = monsUp();
    if (mu.length < 3) out.push({ code: 'MON_DOWN', sev: mu.length < 2 ? 'ERR' : 'WARN', msg: (3 - mu.length) + '/3 mons down, quorum ' + (mu.length >= 2 ? mu.join(',') : '(none)') });
    if (W.flags.noout) out.push({ code: 'OSDMAP_FLAGS', sev: 'WARN', msg: 'noout flag(s) set' });
    var down = W.osds.filter(function (o) { return !o.up && o.in && W.hosts[o.host].joined; });
    if (down.length) {
      var hostsDown = Object.keys(W.hosts).filter(function (h) { return W.hosts[h].joined && !W.hosts[h].power; });
      out.push({ code: 'OSD_DOWN', sev: 'WARN', msg: down.length + ' osds down', det: down.map(function (o) { return 'osd.' + o.id + ' (root=default,host=' + o.host + ') is down'; }) });
      if (hostsDown.length) out.push({ code: 'OSD_HOST_DOWN', sev: 'WARN', msg: hostsDown.length + ' host (' + hostsDown.reduce(function (a, h) { return a + hostOsds(h).length; }, 0) + ' osds) down' });
    }
    var full = W.osds.filter(function (o) { return o.in && osdUtil(o) >= FULL; });
    var nf = W.osds.filter(function (o) { return o.in && osdUtil(o) >= NEARFULL && osdUtil(o) < FULL; });
    if (full.length) out.push({ code: 'OSD_FULL', sev: 'ERR', msg: full.length + ' full osd(s)', det: full.map(function (o) { return 'osd.' + o.id + ' is full'; }) });
    if (nf.length) out.push({ code: 'OSD_NEARFULL', sev: 'WARN', msg: nf.length + ' nearfull osd(s)', det: nf.map(function (o) { return 'osd.' + o.id + ' is near full'; }) });
    if (full.length) out.push({ code: 'POOL_FULL', sev: 'ERR', msg: W.pools.filter(function (p) { return p.name !== '.mgr'; }).length + ' pool(s) full' });
    if (S.inact) out.push({ code: 'PG_AVAILABILITY', sev: 'WARN', msg: 'Reduced data availability: ' + S.inact + ' pgs inactive' });
    if (S.deg || S.degObjs) out.push({ code: 'PG_DEGRADED', sev: 'WARN', msg: 'Degraded data redundancy: ' + S.degObjs + '/' + S.allObjs + ' objects degraded (' + (S.allObjs ? (S.degObjs / S.allObjs * 100).toFixed(3) : '0.000') + '%), ' + S.deg + ' pgs degraded' + (S.unders ? ', ' + S.unders + ' pgs undersized' : '') });
    if (S.toofull) out.push({ code: 'PG_BACKFILL_FULL', sev: 'WARN', msg: 'Low space hindering backfill (add storage if this doesn\'t resolve itself): ' + S.toofull + ' pgs backfill_toofull' });
    var noApp = W.pools.filter(function (p) { return !p.app && totalObjs(p) > 0; });
    if (noApp.length) out.push({ code: 'POOL_APP_NOT_ENABLED', sev: 'WARN', msg: noApp.length + ' pool(s) do not have an application enabled', det: noApp.map(function (p) { return "application not enabled on pool '" + p.name + "'"; }).concat(["use 'ceph osd pool application enable <pool-name> <app-name>', where <app-name> is 'cephfs', 'rbd', 'rgw', or freeform for custom applications."]) });
    return out;
  }
  function healthOf(cs) { return cs.some(function (c) { return c.sev === 'ERR'; }) ? 'HEALTH_ERR' : cs.length ? 'HEALTH_WARN' : 'HEALTH_OK'; }
  function totalObjs(p) { return p.bulkObjs + Object.keys(p.objects).length + (p.objs || 0); }
  function poolStored(p) { return p.pgs.reduce(function (a, g) { return a + g.bytes; }, 0); }

  // ---------- writes ----------
  // returns null on success or an error string
  function canWrite(p, pgs) {
    if (!quorum()) return 'timeout';
    var full = W.osds.filter(function (o) { return o.in && osdUtil(o) >= FULL; });
    if (full.length) return 'full';
    for (var i = 0; i < pgs.length; i++) if (inactive(pgState(p, pgs[i]))) return 'inactive:' + pgs[i].id;
    return null;
  }
  function addBytes(p, g, gib, objs) {
    var old = g.bytes;
    g.bytes = Math.max(0, g.bytes + gib);
    g.objs = Math.max(0, g.objs + objs);
    if (g.bytes <= 0) { Object.keys(g.copies).forEach(function (k) { g.copies[k] = 1; }); return; }
    // copies that are down or still backfilling fall behind
    Object.keys(g.copies).forEach(function (k) {
      var o = osdBy(+k), c = g.copies[k];
      if (gib > 0 && (!o.up || c < 1)) g.copies[k] = Math.max(0, old * c / g.bytes);
      if (gib < 0 && c >= 1) g.copies[k] = 1;
    });
  }

  // ---------- terminal ----------
  var term = new K.Term($('cp-out'), $('cp-in'), { onCmd: onCmd });
  var toast = K.makeToast($('cp-toast'));
  var M = new K.Missions($('cp-m-list'), $('cp-m-count'), MISSIONS, toast, '🐙 Semua misi Ceph beres. Storage engineer nih!');
  var PS = 'root@node1:/#';
  function err(t) { term.line('<span class="sx-err">' + esc(t) + '</span>'); }
  function dim(t) { term.line('<span class="sx-dim">' + esc(t) + '</span>'); }
  function hint(t) { term.line('<span class="sx-warn">' + esc(t) + '</span>'); }
  function out(t) { term.line(esc(t)); }
  function sys(t, kind) { term.line('<span class="sx-info">[mon]</span> <span class="' + (kind === 'err' ? 'sx-err' : kind === 'warn' ? 'sx-warn' : 'sx-dim') + '">' + esc(t) + '</span>'); }
  function gib(x) {
    if (x >= 1024) return (x / 1024).toFixed(1) + ' TiB';
    if (x >= 1) return (x >= 100 ? Math.round(x) : x.toFixed(x >= 10 ? 0 : 1)) + ' GiB';
    if (x * 1024 >= 1) return Math.round(x * 1024) + ' MiB';
    return Math.max(1, Math.round(x * 1048576)) + ' KiB';
  }
  function kfmt(n) { return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 2) + 'k' : String(Math.round(n)); }

  function onCmd(line) {
    term.echo(PS, line);
    if (!line) return;
    if (W.busy) { dim('# tunggu perintah sebelumnya selesai dulu'); return; }
    var w = words(line);
    var c = w[0];
    try {
      if (c === 'clear') { term.clear(); return; }
      if (c === 'help') { help(); return; }
      if ((c === 'ceph' || c === 'rados' || c === 'rbd') && !quorum()) { timeout(); return; }
      if (c === 'ceph') ceph(w.slice(1));
      else if (c === 'rados') rados(w.slice(1));
      else if (c === 'systemctl' || c === 'reboot') systemctl(w.slice(1), c);
      else if (c === 'ls') out('foto.jpg  backup.tar  notes.txt');
      else if (c === 'cephadm') dim('# kamu sudah di dalam cephadm shell');
      else if (c === 'hostname') out('node1');
      else err('bash: ' + c + ': command not found');
    } catch (e) {
      err('simulasi error: ' + (e && e.message || e));
      if (window.console) console.error(e);
    }
    tick();
  }
  function timeout() {
    W.busy = true;
    term.play([[0, '<span class="sx-dim">(menunggu monitor…)</span>'], [2200, function () {
      W.busy = false;
      if (quorum()) { dim('# quorum sudah balik. Jalankan ulang perintahnya.'); return; }
      term.lines(['<span class="sx-err">' + esc(new Date().toISOString().replace('Z', '+0000')) + ' 7f2c1b7fe640  0 monclient(hunting): authenticate timed out after 300</span>', '<span class="sx-err">[errno 110] RADOS timed out (error connecting to the cluster)</span>']);
      hint('# cuma ' + monsUp().length + ' dari 3 monitor yang hidup. Butuh mayoritas (2) supaya ada quorum. Nyalakan lagi node2 atau node3.');
    }]]);
  }
  function help() {
    term.lines([
      '<b>Perintah yang bisa dicoba</b>',
      '  ceph -s  ·  ceph health detail  ·  ceph df  ·  ceph osd tree  ·  ceph osd df',
      '  ceph osd pool create NAMA [PG]  ·  ceph osd pool ls detail',
      '  ceph osd pool set NAMA size|min_size|pg_num N  ·  ceph osd pool application enable NAMA rbd',
      '  ceph osd pool delete NAMA NAMA --yes-i-really-really-mean-it',
      '  rados -p POOL put OBJEK FILE  ·  rados -p POOL ls  ·  rados -p POOL rm OBJEK  ·  rados df',
      '  rados bench -p POOL 30 write --no-cleanup  ·  rados -p POOL cleanup',
      '  ceph osd map POOL OBJEK  ·  ceph pg stat  ·  ceph pg ls [degraded]',
      '  ceph osd out|in ID  ·  ceph osd set|unset noout',
      '  ceph orch host ls  ·  ceph orch host add node4 10.0.0.24  ·  ceph orch apply osd --all-available-devices',
      '  systemctl restart ceph-osd@ID  ·  clear'
    ]);
  }

  function ceph(a) {
    var sub = a[0];
    if (sub === '-s' || sub === 'status') { status(); M.hit('health'); return; }
    if (sub === 'health') { health(a[1] === 'detail'); return; }
    if (sub === 'df') { df(a.indexOf('detail') >= 0); return; }
    if (sub === '-v' || sub === '--version' || sub === 'version') { out('ceph version 19.2.0 (16063ff2022298c9300e49a547a16ffda59baf13) squid (stable)'); return; }
    if (sub === 'osd') { osdCmd(a.slice(1)); return; }
    if (sub === 'pg') { pgCmd(a.slice(1)); return; }
    if (sub === 'orch') { orch(a.slice(1)); return; }
    if (sub === 'mon') {
      if (a[1] === 'stat') { out('e3: 3 mons at {' + ['node1', 'node2', 'node3'].map(function (h) { return h + '=[v2:' + W.hosts[h].ip + ':3300/0,v1:' + W.hosts[h].ip + ':6789/0]'; }).join(',') + '} removed_ranks: {}, election epoch ' + (12 + W.epoch % 7) + ', leader 0 node1, quorum ' + monsUp().map(function (h, i) { return i; }).join(',') + ' ' + monsUp().join(',')); return; }
      err('Invalid command'); return;
    }
    if (sub === 'config') {
      if (a[1] === 'set' && a[3] === 'mon_allow_pool_delete') { W.allowDelete = /^(true|1)$/.test(a[4] || ''); return; }
      if (a[1] === 'set' || a[1] === 'get') { dim('# config dicatat, tapi simulasi ini cuma memakai mon_allow_pool_delete'); return; }
    }
    if (sub === 'versions') { out('{\n    "overall": {\n        "ceph version 19.2.0 squid (stable)": ' + (3 + 2 + W.osds.length) + '\n    }\n}'); return; }
    err('no valid command found; 10 closest matches:');
    dim('# ketik help buat daftar perintah yang didukung');
  }
  function status() {
    var cs = healthChecks(), h = healthOf(cs), S = pgSummary();
    var mu = monsUp(), up = W.osds.filter(function (o) { return o.up; }).length, inn = W.osds.filter(function (o) { return o.in; }).length;
    var lines = ['  cluster:', '    id:     ' + FSID, '    health: <span class="' + (h === 'HEALTH_OK' ? 'sx-ok' : h === 'HEALTH_ERR' ? 'sx-err' : 'sx-warn') + '">' + h + '</span>'];
    cs.forEach(function (c) { lines.push('            ' + esc(c.msg)); });
    var totObjs = W.pools.reduce(function (a, p) { return a + totalObjs(p); }, 0);
    var raw = W.osds.filter(function (o) { return o.in || o.up; }).length * OSD_GIB;
    var usedAll = W.osds.reduce(function (a, o) { return a + used(o); }, 0);
    lines.push('', '  services:',
      '    mon: 3 daemons, quorum ' + mu.join(',') + (mu.length < 3 ? ', out of quorum: ' + ['node1', 'node2', 'node3'].filter(function (x) { return mu.indexOf(x) < 0; }).join(',') : '') + ' (age ' + (mu.length < 3 ? rnd(3, 30) + 's' : '3h') + ')',
      '    mgr: node1.' + digest('mgr1').slice(0, 6) + '(active, since 3h), standbys: node2.' + digest('mgr2').slice(0, 6),
      '    osd: ' + W.osds.length + ' osds: ' + up + ' up (since ' + sinceTxt('up') + '), ' + inn + ' in (since ' + sinceTxt('in') + ')' + (W.flags.noout ? '\n         flags noout' : ''),
      '', '  data:',
      '    pools:   ' + W.pools.length + ' pools, ' + S.tot + ' pgs',
      '    objects: ' + kfmt(totObjs) + ' objects, ' + gib(W.pools.reduce(function (a, p) { return a + poolStored(p); }, 0)),
      '    usage:   ' + gib(usedAll) + ' used, ' + gib(raw - usedAll) + ' / ' + gib(raw) + ' avail',
      '    pgs:     ' + pgLines(S));
    if (W.recBytes > 0.01) lines.push('', '  io:', '    recovery: ' + gib(W.recBytes) + '/s, ' + Math.round(W.recObjs) + ' objects/s');
    term.lines(lines.map(function (l) { return /<span/.test(l) ? l : esc(l).replace(/&lt;/g, '&lt;'); }));
  }
  function sinceTxt(kind) {
    var t = 0;
    W.osds.forEach(function (o) { t = Math.max(t, kind === 'up' ? (o.up ? o.upSince : o.downAt) : o.inSince); });
    var s = Math.max(1, Math.round((Date.now() - t) / 1000));
    return s < 60 ? s + 's' : s < 3600 ? Math.floor(s / 60) + 'm' : Math.floor(s / 3600) + 'h';
  }
  function pgLines(S) {
    var ks = Object.keys(S.counts).sort(function (a, b) { return S.counts[b] - S.counts[a]; });
    var pre = [];
    if (S.inact) pre.push((S.inact / S.tot * 100).toFixed(3) + '% pgs not active');
    if (S.degObjs) pre.push(S.degObjs + '/' + S.allObjs + ' objects degraded (' + (S.degObjs / S.allObjs * 100).toFixed(3) + '%)');
    if (S.missObjs) pre.push(S.missObjs + '/' + S.allObjs + ' objects misplaced (' + (S.missObjs / S.allObjs * 100).toFixed(3) + '%)');
    return pre.concat(ks.map(function (k) { return S.counts[k] + ' ' + k; })).join('\n             ');
  }
  function health(detail) {
    var cs = healthChecks(), h = healthOf(cs);
    if (!detail) { out(h + (cs.length ? ' ' + cs.map(function (c) { return c.msg; }).join('; ') : '')); return; }
    term.line('<span class="' + (h === 'HEALTH_OK' ? 'sx-ok' : h === 'HEALTH_ERR' ? 'sx-err' : 'sx-warn') + '">' + h + '</span>' + (cs.length ? ' ' + esc(cs.map(function (c) { return c.msg; }).join('; ')) : ''));
    cs.forEach(function (c) {
      term.line('[' + c.sev + '] ' + c.code + ': ' + esc(c.msg), c.sev === 'ERR' ? 'sx-err' : 'sx-warn');
      (c.det || []).forEach(function (d) { out('    ' + d); });
      if (c.code === 'PG_DEGRADED') W.pools.forEach(function (p) { p.pgs.forEach(function (g) { var s = pgState(p, g); if (/degraded/.test(s) && !/peered/.test(s)) detLine(g, s); }); });
      if (c.code === 'PG_AVAILABILITY') W.pools.forEach(function (p) { p.pgs.forEach(function (g) { var s = pgState(p, g); if (inactive(s)) detLine(g, s); }); });
    });
  }
  var detCount = 0;
  function detLine(g, s) {
    if (detCount++ > 6) return;
    out('    pg ' + g.id + ' is ' + s + ', acting [' + acting(g).join(',') + ']');
  }
  function acting(g) {
    var c = Object.keys(g.copies).filter(function (k) { return g.copies[k] >= 1 && osdBy(+k).up; }).map(Number);
    var a = g.target.filter(function (t) { return c.indexOf(t) >= 0; });
    c.forEach(function (x) { if (a.indexOf(x) < 0) a.push(x); });
    return a.length ? a : g.target.filter(function (t) { return osdBy(t).up; });
  }
  function df(detail) {
    var raw = W.osds.filter(function (o) { return o.in || o.up; }).length * OSD_GIB;
    var u = W.osds.reduce(function (a, o) { return a + used(o); }, 0);
    term.lines(['--- RAW STORAGE ---']);
    term.table([['CLASS', 'SIZE', 'AVAIL', 'USED', 'RAW USED', '%RAW USED'], ['hdd', gib(raw), gib(raw - u), gib(u), gib(u), (u / raw * 100).toFixed(2)], ['TOTAL', gib(raw), gib(raw - u), gib(u), gib(u), (u / raw * 100).toFixed(2)]]);
    term.line('');
    term.lines(['--- POOLS ---']);
    term.table([['POOL', 'ID', 'PGS', 'STORED', 'OBJECTS', 'USED', '%USED', 'MAX AVAIL']].concat(W.pools.map(function (p) {
      var st = poolStored(p), us = st * p.size, ma = maxAvail(p);
      return [p.name, String(p.id), String(p.pgn), gib(st), kfmt(totalObjs(p)), gib(us), (us / (us + ma * p.size || 1) * 100).toFixed(2), gib(ma)];
    })));
    void detail;
  }
  function maxAvail(p) {
    var ins = W.osds.filter(function (o) { return o.in && o.up; });
    if (!ins.length) return 0;
    var minFree = Math.min.apply(null, ins.map(function (o) { return Math.max(0, FULL * OSD_GIB - used(o)); }));
    return minFree * ins.length / p.size;
  }

  function osdCmd(a) {
    var op = a[0];
    if (op === 'tree') {
      var rows = [['ID', 'CLASS', 'WEIGHT', 'TYPE NAME', 'STATUS', 'REWEIGHT', 'PRI-AFF']];
      var tot = W.osds.length * 0.09769;
      rows.push(['-1', '', tot.toFixed(5), 'root default', '', '', '']);
      Object.keys(W.hosts).forEach(function (h, i) {
        if (!W.hosts[h].joined) return;
        var os = hostOsds(h);
        rows.push(['-' + (3 + i * 2), '', (os.length * 0.09769).toFixed(5), '    host ' + h, '', '', '']);
        os.forEach(function (o) { rows.push([' ' + o.id, 'hdd', '0.09769', '        osd.' + o.id, o.up ? 'up' : 'down', o.in ? '1.00000' : '0', '1.00000']); });
      });
      var el = term.table(rows);
      el.innerHTML = el.innerHTML.replace(/ down /g, ' <span class="sx-err">down</span> ');
      return;
    }
    if (op === 'df') {
      var r = [['ID', 'CLASS', 'WEIGHT', 'REWEIGHT', 'SIZE', 'RAW USE', 'AVAIL', '%USE', 'VAR', 'PGS', 'STATUS']];
      var avg = W.osds.reduce(function (s, o) { return s + osdUtil(o); }, 0) / W.osds.length;
      W.osds.forEach(function (o) {
        var u = used(o), pgs = 0;
        W.pools.forEach(function (p) { p.pgs.forEach(function (g) { if (g.target.indexOf(o.id) >= 0) pgs++; }); });
        r.push([String(o.id), 'hdd', '0.09769', o.in ? '1.00000' : '0', o.in ? '100 GiB' : '0 B', gib(u), gib(OSD_GIB - u), (u / OSD_GIB * 100).toFixed(2), (u / OSD_GIB / (avg || 1)).toFixed(2), String(pgs), o.up ? 'up' : 'down']);
      });
      var e = term.table(r);
      e.innerHTML = e.innerHTML.replace(/ (8[5-9]|9\d)\.(\d\d) /g, ' <span class="sx-warn">$1.$2</span> ');
      return;
    }
    if (op === 'stat') { out(W.osds.length + ' osds: ' + W.osds.filter(function (o) { return o.up; }).length + ' up (since ' + sinceTxt('up') + '), ' + W.osds.filter(function (o) { return o.in; }).length + ' in (since ' + sinceTxt('in') + '); epoch: e' + W.epoch); return; }
    if (op === 'set' || op === 'unset') {
      var f = a[1];
      if (['noout', 'norebalance', 'nobackfill', 'norecover', 'noup', 'nodown', 'noscrub', 'nodeep-scrub'].indexOf(f) < 0) { err('Invalid command: ' + (f || '') + ' not in full|pause|noup|nodown|noout|noin|nobackfill|norebalance|norecover|noscrub|nodeep-scrub'); return; }
      if (f !== 'noout') dim('# flag dicatat, tapi simulasi ini cuma memakai noout');
      if (op === 'set') { W.flags[f] = true; out(f + ' is set'); W.nooutCycle = false; W.nooutOut = false; }
      else {
        var had = W.flags[f];
        delete W.flags[f];
        out(f + ' is unset');
        if (f === 'noout' && had && W.nooutCycle && !W.nooutOut) M.hit('noout');
        else if (f === 'noout' && had && !W.nooutCycle) dim('# misinya: selama noout aktif, matikan satu node lalu nyalakan lagi');
      }
      W.epoch++;
      return;
    }
    if (op === 'out' || op === 'in' || op === 'down') {
      var ids = a.slice(1).map(function (x) { return parseInt(String(x).replace(/^osd\./, ''), 10); });
      if (!ids.length || ids.some(isNaN)) { err('Invalid command: missing required parameter ids(<string>)'); return; }
      ids.forEach(function (id) {
        var o = osdBy(id);
        if (!o) { err('osd.' + id + ' does not exist'); return; }
        if (op === 'out') {
          if (!o.in) { out('osd.' + id + ' is already out.'); return; }
          o.in = false; o.autoOut = false; out('marked out osd.' + id + '.');
        } else if (op === 'in') {
          if (o.in) { out('osd.' + id + ' is already in.'); return; }
          o.in = true; o.autoOut = false; o.inSince = Date.now(); out('marked in osd.' + id + '.');
        } else {
          if (!o.up) { out('osd.' + id + ' is already down.'); return; }
          out('marked down osd.' + id + '.');
          dim('# OSD-nya masih hidup, jadi dia langsung lapor up lagi. Buat mensimulasikan disk rusak, klik kotak OSD-nya.');
        }
        W.epoch++;
        K.pulse(app, 'crush');
      });
      return;
    }
    if (op === 'map') {
      var p = poolBy(a[1]), name = a[2];
      if (!p) { err("pool '" + (a[1] || '') + "' does not exist"); return; }
      if (!name) { err('Invalid command: missing required parameter object(<objectname>)'); return; }
      var g = objPg(p, name);
      crushPg(p, g);
      var act = acting(g), upSet = g.target.filter(function (t) { return osdBy(t).up; });
      out('osdmap e' + W.epoch + " pool '" + p.name + "' (" + p.id + ") object '" + name + "' -> pg " + p.id + '.' + h32('obj' + name).toString(16) + ' (' + g.id + ') -> up ([' + upSet.join(',') + '], p' + (upSet[0] !== undefined ? upSet[0] : -1) + ') acting ([' + act.join(',') + '], p' + (act[0] !== undefined ? act[0] : -1) + ')');
      var exists = p.objects[name] !== undefined;
      W.lastMap = { pool: p.name, obj: name, pg: g.id, osds: act.slice(), exists: exists };
      if (!exists) dim('# objek ' + name + ' belum ada, tapi lokasinya tetap bisa dihitung. Begitulah CRUSH: lokasi dihitung, bukan dicari.');
      else M.hit('map');
      K.pulse(app, 'hash'); K.pulse(app, 'crush');
      return;
    }
    if (op === 'pool') { poolCmd(a.slice(1)); return; }
    if (op === 'purge' || op === 'destroy' || op === 'rm') {
      dim('# mengganti disk belum didukung. Klik kotak OSD-nya buat menghidupkan lagi.');
      return;
    }
    if (op === 'crush' && a[1] === 'tree') { osdCmd(['tree']); return; }
    if (op === 'ls') { W.osds.forEach(function (o) { out(String(o.id)); }); return; }
    err('Invalid command: unknown osd subcommand');
  }
  function poolCmd(a) {
    var op = a[0], name = a[1];
    if (op === 'create') {
      if (!name) { err('Invalid command: missing required parameter pool(<poolname>)'); return; }
      if (poolBy(name)) { out("pool '" + name + "' already exists"); return; }
      var pgn = a[2] ? parseInt(a[2], 10) : 32;
      if (!(pgn > 0)) { err("Error EINVAL: invalid pg_num '" + a[2] + "'"); return; }
      if (pgn > 256) { err('Error ERANGE: pg_num ' + pgn + ' size 3 would mean ' + (pgn * 3 + totalPgReplicas()) + ' total pgs, which exceeds max ' + 250 * W.osds.filter(function (o) { return o.in; }).length + ' (mon_max_pg_per_osd 250 * num_in_osds ' + W.osds.filter(function (o) { return o.in; }).length + ')'); dim('# di simulasi, maksimal 256 PG per pool supaya browser ga berat'); return; }
      if (pgn & (pgn - 1)) hint('# pg_num sebaiknya pangkat dua (32, 64, 128) supaya PG terbagi rata');
      makePool(name, pgn);
      out("pool '" + name + "' created");
      K.flash(app, 'pool');
      return;
    }
    if (op === 'ls') {
      if (name === 'detail') W.pools.forEach(function (p) {
        out('pool ' + p.id + " '" + p.name + "' replicated size " + p.size + ' min_size ' + p.min + ' crush_rule 0 object_hash rjenkins pg_num ' + p.pgn + ' pgp_num ' + p.pgn + ' autoscale_mode on last_change ' + W.epoch + ' flags hashpspool stripe_width 0' + (p.app ? ' application ' + p.app : ''));
      });
      else W.pools.forEach(function (p) { out(p.name); });
      return;
    }
    if (op === 'application') {
      if (a[1] !== 'enable') { err('Invalid command'); return; }
      var ap = poolBy(a[2]);
      if (!ap) { err("Error ENOENT: unrecognized pool '" + (a[2] || '') + "'"); return; }
      ap.app = a[3] || 'rbd';
      out("enabled application '" + ap.app + "' on pool '" + ap.name + "'");
      return;
    }
    var p = poolBy(name);
    if (op === 'delete' || op === 'rm') {
      if (!p) { out("pool '" + (name || '') + "' does not exist"); return; }
      if (a[2] !== name || a.indexOf('--yes-i-really-really-mean-it') < 0) {
        err('Error EPERM: WARNING: this will *PERMANENTLY DESTROY* all data stored in pool ' + name + '.  If you are *ABSOLUTELY CERTAIN* that is what you want, pass the pool name *twice*, followed by --yes-i-really-really-mean-it.');
        return;
      }
      if (!W.allowDelete) { err('Error EPERM: pool deletion is disabled; you must first set the mon_allow_pool_delete config option to true before you can destroy a pool'); dim('# ceph config set mon mon_allow_pool_delete true'); return; }
      if (p.name === '.mgr') { err('Error EBUSY: pool .mgr dipakai manager'); return; }
      W.pools = W.pools.filter(function (x) { return x !== p; });
      out("pool '" + name + "' removed");
      W.epoch++;
      return;
    }
    if (!p) { err("Error ENOENT: unrecognized pool '" + (name || '') + "'"); return; }
    if (op === 'set') {
      var k = a[2], v = parseInt(a[3], 10);
      if (k === 'size') {
        if (!(v >= 1 && v <= 10)) { err('Error EINVAL: pool size must be between 1 and 10'); return; }
        if (v === 1 && a.indexOf('--yes-i-really-mean-it') < 0) { err('Error EPERM: configuring pool size as 1 is disabled by default.'); return; }
        p.size = v; if (p.min > v) p.min = v;
        out('set pool ' + p.id + ' size to ' + v);
        if (v > Object.keys(W.hosts).filter(function (h) { return W.hosts[h].joined; }).length) hint('# size ' + v + ' butuh ' + v + ' node berbeda. Cuma ada ' + Object.keys(W.hosts).filter(function (h) { return W.hosts[h].joined; }).length + ', jadi PG-nya bakal undersized terus.');
        if (v === 2) hint('# size 2 itu berisiko: kalau satu salinan hilang, cuma tersisa satu. Produksi biasanya pakai size 3, min_size 2.');
      } else if (k === 'min_size') {
        if (!(v >= 1 && v <= p.size)) { err('Error EINVAL: pool min_size must be between 1 and size, which is set to ' + p.size); return; }
        p.min = v;
        out('set pool ' + p.id + ' min_size to ' + v);
        if (v === 1) hint('# min_size 1 bikin Ceph mau menulis walau cuma ada 1 salinan. Kalau disk itu rusak sebelum recovery, data hilang.');
      } else if (k === 'pg_num' || k === 'pgp_num') {
        if (!(v > 0 && v <= 256)) { err('Error EINVAL: pg_num ' + a[3] + ' ga didukung (1 sampai 256)'); return; }
        resplit(p, v);
        out('set pool ' + p.id + ' ' + k + ' to ' + v);
      } else { err('Error EINVAL: invalid choice: ' + (k || '') + '. Yang didukung: size, min_size, pg_num'); return; }
      W.epoch++;
      K.pulse(app, 'crush');
      return;
    }
    if (op === 'get') {
      var g = a[2];
      if (g === 'size') out('size: ' + p.size);
      else if (g === 'min_size') out('min_size: ' + p.min);
      else if (g === 'pg_num') out('pg_num: ' + p.pgn);
      else err('Error EINVAL: invalid choice: ' + (g || ''));
      return;
    }
    err('Invalid command');
  }
  function totalPgReplicas() { return W.pools.reduce(function (a, p) { return a + p.pgn * p.size; }, 0); }
  // pg_num change: children inherit the parent's copies, then CRUSH moves them
  function resplit(p, n) {
    var old = p.pgs, totB = poolStored(p), totO = old.reduce(function (a, g) { return a + g.objs; }, 0);
    var pgs = [];
    for (var i = 0; i < n; i++) {
      var g = newPg(p, i), par = old[i % old.length];
      g.bytes = totB / n; g.objs = totO / n;
      Object.keys(par.copies).forEach(function (k) { g.copies[k] = par.copies[k]; });
      pgs.push(g);
    }
    p.pgs = pgs; p.pgn = n;
    Object.keys(p.objects).forEach(function (o) { /* named objects keep their size inside the averages */ void o; });
  }

  function pgCmd(a) {
    var op = a[0];
    if (op === 'stat') {
      var S = pgSummary(), st = W.pools.reduce(function (s, p) { return s + poolStored(p); }, 0);
      var raw = W.osds.filter(function (o) { return o.in || o.up; }).length * OSD_GIB, u = W.osds.reduce(function (s, o) { return s + used(o); }, 0);
      out(S.tot + ' pgs: ' + Object.keys(S.counts).map(function (k) { return S.counts[k] + ' ' + k; }).join(', ') + '; ' + gib(st) + ' data, ' + gib(u) + ' used, ' + gib(raw - u) + ' / ' + gib(raw) + ' avail' + (S.degObjs ? '; ' + S.degObjs + '/' + S.allObjs + ' objects degraded' : '') + (W.recBytes > 0.01 ? '; ' + gib(W.recBytes) + '/s, ' + Math.round(W.recObjs) + ' objects/s recovering' : ''));
      return;
    }
    if (op === 'ls' || op === 'dump') {
      var filt = a.filter(function (x, i) { return i > 0 && !/^pgs_brief$/.test(x); })[0];
      var rows = [['PG', 'OBJECTS', 'BYTES', 'STATE', 'UP', 'ACTING']], n = 0, more = 0;
      W.pools.forEach(function (p) {
        p.pgs.forEach(function (g) {
          var s = pgState(p, g);
          if (filt && s.indexOf(filt) < 0) return;
          if (n++ >= 24) { more++; return; }
          rows.push([g.id, String(Math.round(g.objs)), gib(g.bytes), s, '[' + g.target.filter(function (t) { return osdBy(t).up; }).join(',') + ']p' + (g.target[0] !== undefined ? g.target[0] : -1), '[' + acting(g).join(',') + ']p' + (acting(g)[0] !== undefined ? acting(g)[0] : -1)]);
        });
      });
      if (rows.length === 1) { dim('# ga ada PG ' + (filt || '')); return; }
      term.table(rows);
      if (more) dim('# … dan ' + more + ' PG lagi');
      return;
    }
    if (op === 'repair' || op === 'scrub' || op === 'deep-scrub') { out('instructing pg ' + (a[1] || '') + ' on osd.0 to ' + op); return; }
    err('Invalid command');
  }

  function orch(a) {
    var op = a[0];
    if (op === 'host' && a[1] === 'ls') {
      term.table([['HOST', 'ADDR', 'LABELS', 'STATUS']].concat(Object.keys(W.hosts).filter(function (h) { return W.hosts[h].joined; }).map(function (h) { return [h, W.hosts[h].ip, h === 'node1' ? '_admin' : '', W.hosts[h].power ? '' : 'Offline']; })));
      out(Object.keys(W.hosts).filter(function (h) { return W.hosts[h].joined; }).length + ' hosts in cluster');
      return;
    }
    if (op === 'host' && a[1] === 'add') {
      var h = W.hosts[a[2]];
      if (!h) { err('Error EINVAL: Failed to connect to ' + (a[2] || '') + ' (' + (a[3] || a[2] || '') + '). Check that the host is reachable and accepts connections using the cephadm SSH key'); return; }
      if (h.joined) { out("Host '" + h.name + "' already in cluster"); return; }
      if (!h.power) { err('Error EINVAL: Failed to connect to ' + h.name); return; }
      h.joined = true;
      out("Added host '" + h.name + "' with addr '" + h.ip + "'");
      dim('# node4 sudah gabung, tapi belum ada OSD. Tambahkan disk-nya: ceph orch apply osd --all-available-devices');
      return;
    }
    if (op === 'device' && a[1] === 'ls') {
      var rows = [['HOST', 'PATH', 'TYPE', 'SIZE', 'AVAILABLE', 'REJECT REASONS']];
      Object.keys(W.hosts).forEach(function (hn) {
        var H = W.hosts[hn];
        if (!H.joined) return;
        for (var i = 0; i < H.disks; i++) {
          var used2 = hostOsds(hn).length > i;
          rows.push([hn, '/dev/sd' + 'bcdefgh'[i], 'hdd', '100G', used2 ? 'No' : 'Yes', used2 ? 'Has a FileSystem, Insufficient space (<10 extents) on vgs, LVM detected' : '']);
        }
      });
      term.table(rows);
      return;
    }
    if ((op === 'apply' && a[1] === 'osd') || (op === 'daemon' && a[1] === 'add' && a[2] === 'osd')) {
      var added = [];
      Object.keys(W.hosts).forEach(function (hn) {
        var H = W.hosts[hn];
        if (!H.joined || !H.power) return;
        if (op === 'daemon') { var spec = (a[3] || '').split(':'); if (spec[0] !== hn) return; }
        while (hostOsds(hn).length < H.disks) {
          added.push(addOsd(hn));
          if (op === 'daemon') break;
        }
      });
      if (op === 'apply') out('Scheduled osd.all-available-devices update...');
      if (!added.length) { if (op === 'daemon') err('Error EINVAL: ' + (a[3] || '') + ': device ga tersedia atau host belum di-add'); else dim('# ga ada disk kosong di host yang sudah gabung. Sudah ceph orch host add node4?'); return; }
      if (op === 'daemon') out('Created osd(s) ' + added.map(function (o) { return o.id; }).join(',') + ' on host \'' + added[0].host + '\'');
      sys('osd baru: ' + added.map(function (o) { return 'osd.' + o.id; }).join(', ') + '. CRUSH menghitung ulang, sebagian PG pindah ke sana (backfill).');
      K.flash(app, 'osd');
      K.pulse(app, 'crush');
      return;
    }
    if (op === 'ps') {
      var r = [['NAME', 'HOST', 'STATUS']];
      ['node1', 'node2', 'node3'].forEach(function (h) { r.push(['mon.' + h, h, W.hosts[h].power ? 'running' : 'host is offline']); });
      W.osds.forEach(function (o) { r.push(['osd.' + o.id, o.host, !W.hosts[o.host].power ? 'host is offline' : o.failed ? 'error' : 'running']); });
      term.table(r);
      return;
    }
    if (op === 'daemon' && (a[1] === 'restart' || a[1] === 'start')) {
      var m = /^osd\.(\d+)$/.exec(a[2] || '');
      if (!m || !osdBy(+m[1])) { err('Error EINVAL: Unable to find daemon(s) [' + (a[2] || '') + ']'); return; }
      restartOsd(osdBy(+m[1]));
      return;
    }
    if (op === 'status') { out('Backend: cephadm\nAvailable: Yes\nPaused: No'); return; }
    err('Invalid command');
  }
  function systemctl(a, c) {
    if (c === 'reboot') { dim('# pakai tombol daya di kartu node buat mematikan node'); return; }
    var m = /^ceph-osd@(\d+)$/.exec(a[1] || '') || /osd\.(\d+)/.exec(a[1] || '');
    if ((a[0] === 'restart' || a[0] === 'start') && m) { restartOsd(osdBy(+m[1])); return; }
    if (a[0] === 'stop' && m && osdBy(+m[1])) { osdBy(+m[1]).failed = true; return; }
    if (a[0] === 'status' && m && osdBy(+m[1])) { var o = osdBy(+m[1]); out('● ceph-osd@' + o.id + '.service - Ceph object storage daemon osd.' + o.id); out('     Active: ' + (o.failed ? 'failed (Result: exit-code)' : 'active (running)')); return; }
    err('Failed to ' + (a[0] || 'run') + ' ' + (a[1] || '') + ': Unit not found.');
  }
  function restartOsd(o) {
    if (!o) { err('osd ga ada'); return; }
    if (o.host !== 'node1') dim('# (simulasi) perintah dijalankan lewat orchestrator di ' + o.host);
    if (!W.hosts[o.host].power) { err(o.host + ' mati. Nyalakan node-nya dulu.'); return; }
    o.failed = false;
    out('Scheduled to restart osd.' + o.id + ' on host \'' + o.host + '\'');
  }

  // ---------- rados ----------
  function rados(a) {
    var pi = a.indexOf('-p') >= 0 ? a.indexOf('-p') : a.indexOf('--pool');
    var p = pi >= 0 ? poolBy(a[pi + 1]) : null;
    var rest = a.filter(function (x, i) { return i !== pi && i !== pi + 1 || pi < 0; });
    var op = rest[0];
    if (op === 'df') {
      term.table([['POOL_NAME', 'USED', 'OBJECTS', 'CLONES', 'COPIES', 'MISSING_ON_PRIMARY', 'UNFOUND', 'DEGRADED']].concat(W.pools.map(function (x) { return [x.name, gib(poolStored(x) * x.size), String(Math.round(totalObjs(x))), '0', String(Math.round(totalObjs(x) * x.size)), '0', '0', '0']; })));
      return;
    }
    if (op === 'lspools') { W.pools.forEach(function (x) { out(x.name); }); return; }
    if (pi < 0) { err('rados: you must give an action. Try --help'); dim('# contoh: rados -p data ls'); return; }
    if (!p) { err("error opening pool " + (a[pi + 1] || '') + ": (2) No such file or directory"); return; }
    if (op === 'ls') {
      var names = Object.keys(p.objects);
      names.forEach(out);
      if (p.bulkObjs) out('benchmark_data_node1_' + rnd(1000, 9999) + '_object0 … (' + p.bulkObjs + ' objek bench)');
      if (!names.length && !p.bulkObjs) dim('# pool kosong');
      return;
    }
    if (op === 'put') {
      var name = rest[1], file = rest[2];
      if (!name || !file) { err('usage: rados -p POOL put OBJ FILE'); return; }
      var sz = /tar/.test(file) ? 512 : /jpe?g|png/.test(file) ? 3.2 : 0.004; // MiB
      var g = objPg(p, name);
      var e = canWrite(p, [g]);
      if (e) { writeErr(e, 'put', name); return; }
      if (p.objects[name] !== undefined) addBytes(p, g, -p.objects[name] / 1024, -1);
      p.objects[name] = sz;
      addBytes(p, g, sz / 1024, 1);
      W.writes = (W.writes || 0) + 1;
      K.pulse(app, 'write'); K.pulse(app, 'hash'); K.pulse(app, 'crush');
      if (p.app) M.hit('pool');
      else hint('# objek tersimpan, tapi pool ' + p.name + ' belum punya application. Lihat ceph health detail.');
      return;
    }
    if (op === 'get') {
      if (p.objects[rest[1]] === undefined) { err('error getting ' + p.name + '/' + (rest[1] || '') + ': (2) No such file or directory'); return; }
      var gg = objPg(p, rest[1]);
      var e2 = canWrite(p, [gg]);
      if (e2 && e2 !== 'full') { writeErr(e2, 'get', rest[1]); return; }
      return;
    }
    if (op === 'rm') {
      if (p.objects[rest[1]] === undefined) { err('error removing ' + p.name + '>' + (rest[1] || '') + ': (2) No such file or directory'); return; }
      var g3 = objPg(p, rest[1]);
      addBytes(p, g3, -p.objects[rest[1]] / 1024, -1);
      delete p.objects[rest[1]];
      return;
    }
    if (op === 'stat') {
      if (p.objects[rest[1]] === undefined) { err(' error stat-ing ' + p.name + '/' + (rest[1] || '') + ': (2) No such file or directory'); return; }
      out(p.name + '/' + rest[1] + ' mtime ' + new Date().toISOString().slice(0, 19).replace('T', ' ') + ', size ' + Math.round(p.objects[rest[1]] * 1048576));
      return;
    }
    if (op === 'bench') {
      var secs = parseInt(rest[1], 10) || 10, mode = rest[2];
      if (mode !== 'write') { if (mode === 'seq' || mode === 'rand') { out('Total time run:       ' + secs + '.01\nBandwidth (MB/sec):   ' + rnd(900, 1300)); return; } err('rados bench: mode must be write, seq or rand'); return; }
      var gb = Math.round(secs * 0.5); // 0.5 GiB per second of bench
      var e3 = canWrite(p, p.pgs);
      if (e3) { writeErr(e3, 'bench', 'benchmark_data'); return; }
      W.busy = true;
      var rows = [];
      for (var t = 0; t < Math.min(secs, 4); t++) rows.push([280, '    ' + (t + 1) + '      16       ' + (128 * (t + 1)) + '       ' + (128 * (t + 1) - 16) + '   ' + rnd(500, 540) + '.' + rnd(10, 99) + '       512   0.12' + rnd(10, 99)]);
      term.lines(['hints = 1', 'Maintaining 16 concurrent writes of 4194304 bytes to objects of size 4194304 for up to ' + secs + ' seconds or 0 objects', 'Object prefix: benchmark_data_node1_' + rnd(1000, 9999), '  sec Cur ops   started  finished  avg MB/s  cur MB/s last lat(s)  avg lat(s)']);
      K.pulse(app, 'write');
      term.play(rows.concat([[200, function () {
        if (secs > 4) term.line('  … (' + (secs - 4) + ' detik lagi, dipercepat)', 'sx-dim');
        // check again at the end: an OSD may have filled up meanwhile
        var e4 = canWrite(p, p.pgs);
        if (e4) { writeErr(e4, 'bench', 'benchmark_data'); W.busy = false; return; }
        var objs = Math.round(gb * 1024 / OBJ_MIB);
        p.pgs.forEach(function (g4) { addBytes(p, g4, gb / p.pgn, objs / p.pgn); });
        p.bulk += gb; p.bulkObjs += objs;
        term.lines(['Total time run:         ' + secs + '.' + rnd(10, 60), 'Total writes made:      ' + objs, 'Write size:             4194304', 'Bandwidth (MB/sec):     ' + rnd(500, 540) + '.' + rnd(10, 99), 'Average IOPS:           ' + rnd(125, 135)]);
        dim('# ' + gb + ' GiB tertulis ke pool ' + p.name + ' (x' + p.size + ' salinan = ' + gb * p.size + ' GiB raw)');
        W.busy = false;
        K.pulse(app, 'hash'); K.pulse(app, 'crush');
        tick();
      }]]));
      return;
    }
    if (op === 'cleanup') {
      if (!p.bulk) { dim('# ga ada data bench di pool ' + p.name); return; }
      p.pgs.forEach(function (g5) { addBytes(p, g5, -p.bulk / p.pgn, -p.bulkObjs / p.pgn); });
      out('Removed ' + p.bulkObjs + ' objects');
      p.bulk = 0; p.bulkObjs = 0;
      return;
    }
    err('rados: unrecognized command ' + (op || ''));
  }
  function writeErr(e, op, name) {
    if (e === 'timeout') { timeout(); return; }
    if (e === 'full') {
      err('error ' + (op === 'bench' ? 'during benchmark' : 'putting ' + name) + ': (28) No space left on device');
      hint('# ada OSD yang sudah 95% (full). Ceph memblokir semua tulisan ke pool supaya OSD itu ga meledak. Tambah kapasitas: node4.');
      return;
    }
    var pg = e.split(':')[1];
    W.busy = true;
    term.play([[1400, '<span class="sx-dim">(menunggu… I/O ke PG ' + esc(pg) + ' tertahan)</span>'], [600, function () {
      W.busy = false;
      err('error ' + (op === 'bench' ? 'during benchmark' : op + 'ting ' + name) + ': (110) Connection timed out');
      hint('# PG ' + pg + ' inactive: salinan yang hidup kurang dari min_size. Ceph sengaja menahan I/O daripada menulis ke salinan yang terlalu sedikit.');
    }]]);
  }

  function checkMissions() {
    var cs = healthChecks();
    if (cs.some(function (c) { return c.code === 'OSD_NEARFULL' || c.code === 'OSD_FULL'; })) W.sawNearfull = true;
    var data = W.pools.some(function (p) { return p.name !== '.mgr' && poolStored(p) > 1; });
    var S = pgSummary();
    var allClean = S.tot && S.counts['active+clean'] === S.tot;
    var lost = W.osds.filter(function (o) { return !o.up && !o.in && W.hosts[o.host].power; });
    if (data && allClean && lost.length) M.hit('recover');
    var n4 = hostOsds('node4').filter(function (o) { return o.in; }).length;
    if (W.sawNearfull && n4 && !cs.some(function (c) { return c.code === 'OSD_NEARFULL' || c.code === 'OSD_FULL'; })) M.hit('full');
    if (W.flags.noout && W.osds.some(function (o) { return o.autoOut; })) W.nooutOut = true;
  }

  // ---------- render ----------
  var cards = {};
  function buildCards() {
    var box = $('cp-hosts');
    box.innerHTML = '';
    cards = {};
    Object.keys(W.hosts).forEach(function (h) {
      var el = document.createElement('div');
      el.className = 'cp-host';
      el.innerHTML = '<div class="sw-nh"><i class="an-dot" aria-hidden="true"></i><b>' + h + '</b><span class="cp-mon"></span>' +
        (h === 'node1' ? '' : '<label class="gx-sw sw-pw" title="nyalakan / matikan node"><input type="checkbox" data-act="power" data-h="' + h + '" checked><span aria-hidden="true"></span><i class="sr">daya ' + h + '</i></label>') +
        '</div><div class="sw-meta"></div><div class="cp-osds"></div><div class="sw-act"></div>';
      box.appendChild(el);
      cards[h] = { el: el, mon: el.querySelector('.cp-mon'), meta: el.querySelector('.sw-meta'), osds: el.querySelector('.cp-osds'), act: el.querySelector('.sw-act'), pw: el.querySelector('input') };
    });
  }
  function render() {
    var cs = healthChecks(), h = healthOf(cs), S = pgSummary();
    detCount = 0;
    var hb = $('cp-health');
    setText(hb, h);
    hb.dataset.s = h === 'HEALTH_OK' ? 'ok' : h === 'HEALTH_ERR' ? 'bad' : 'warn';
    if (h !== W.lastHealth) {
      if (h === 'HEALTH_OK' && W.lastHealth !== 'HEALTH_OK') sys('cluster kembali HEALTH_OK');
      W.lastHealth = h;
    }
    setHTML($('cp-checks'), cs.map(function (c) { return '<li data-s="' + (c.sev === 'ERR' ? 'bad' : 'warn') + '"><b>' + c.code + '</b> ' + esc(c.msg) + '</li>'; }).join(''));
    // PG state bar
    var groups = { clean: 0, rec: 0, deg: 0, bad: 0 };
    Object.keys(S.counts).forEach(function (k) {
      var n = S.counts[k];
      if (inactive(k)) groups.bad += n;
      else if (/backfill|recover/.test(k)) groups.rec += n;
      else if (/degraded|undersized|remapped|toofull/.test(k)) groups.deg += n;
      else groups.clean += n;
    });
    setHTML($('cp-pgbar'), ['clean', 'rec', 'deg', 'bad'].filter(function (k) { return groups[k]; }).map(function (k) { return '<i class="cp-' + k + '" style="flex-grow:' + groups[k] + '"></i>'; }).join(''));
    var txt = S.tot + ' PG: ' + [['clean', 'active+clean'], ['rec', 'recovery/backfill'], ['deg', 'degraded'], ['bad', 'inactive']].filter(function (x) { return groups[x[0]]; }).map(function (x) { return groups[x[0]] + ' ' + x[1]; }).join(', ');
    if (W.recBytes > 0.01) txt += ' · recovery ' + gib(W.recBytes) + '/s';
    setText($('cp-pgtxt'), txt);

    var mapOsds = W.lastMap ? W.lastMap.osds : [];
    Object.keys(W.hosts).forEach(function (hn) {
      var H = W.hosts[hn], c = cards[hn];
      var os = hostOsds(hn);
      var st = !H.power ? 'off' : !H.joined ? 'out' : os.some(function (o) { return !o.up; }) ? 'down' : 'ok';
      c.el.className = 'cp-host is-' + st;
      setText(c.mon, H.mon ? 'mon' + (H.power ? '' : ' ✕') : H.joined ? '' : 'belum gabung');
      c.mon.className = 'cp-mon' + (H.mon ? ' is-mon' : '') + (H.mon && !H.power ? ' is-dead' : '');
      setText(c.meta, H.ip + ' · ' + (!H.power ? 'mati' : !H.joined ? 'belum di cluster' : os.length + ' OSD'));
      if (c.pw && c.pw.checked !== H.power) c.pw.checked = H.power;
      setHTML(c.osds, os.map(function (o) {
        var u = osdUtil(o), pct = Math.min(100, u * 100);
        var pgs = 0;
        W.pools.forEach(function (p) { p.pgs.forEach(function (g) { if (g.target.indexOf(o.id) >= 0) pgs++; }); });
        var s = o.up && o.in ? (u >= FULL ? 'full' : u >= NEARFULL ? 'near' : 'ok') : !o.up && o.in ? 'down' : !o.up ? 'gone' : 'outup';
        var lbl = o.up && o.in ? 'up · in' : !o.up && o.in ? 'down · in' : !o.up ? 'down · out' : 'up · out';
        var mi = mapOsds.indexOf(o.id);
        return '<button type="button" class="cp-osd is-' + s + (mi >= 0 ? ' is-map' : '') + '" data-act="osd" data-id="' + o.id + '" title="' + (o.failed ? 'klik buat menyalakan ulang osd.' + o.id : 'klik buat merusak disk osd.' + o.id) + '">' +
          '<span class="cp-oh"><b>osd.' + o.id + '</b>' + (mi === 0 ? '<em>primary</em>' : mi > 0 ? '<em>replika</em>' : '') + '</span>' +
          '<span class="cp-bar"><i style="width:' + pct.toFixed(1) + '%"></i></span>' +
          '<span class="cp-os">' + (s === 'ok' || s === 'near' || s === 'full' ? '' : lbl + ' · ') + pct.toFixed(0) + '% · ' + pgs + ' PG</span></button>';
      }).join('') || (H.joined ? '<span class="sw-none">belum ada OSD</span>' : '<span class="sw-none">2 disk 100 GiB nganggur</span>'));
      var act = '';
      if (!H.joined && H.power) act = '<button type="button" data-act="cmd" data-cmd="ceph orch host add ' + hn + ' ' + H.ip + '">ceph orch host add</button>';
      else if (H.joined && H.power && os.length < H.disks) act = '<button type="button" data-act="cmd" data-cmd="ceph orch apply osd --all-available-devices">tambah OSD</button>';
      setHTML(c.act, act);
    });

    // pools
    setHTML($('cp-pools'), W.pools.map(function (p) {
      var st = poolStored(p), states = {};
      p.pgs.forEach(function (g) { var s = pgState(p, g); var k = inactive(s) ? 'bad' : /backfill|recover/.test(s) ? 'rec' : /clean/.test(s) && !/degraded|remapped/.test(s) ? 'clean' : 'deg'; states[k] = (states[k] || 0) + 1; });
      var bar = ['clean', 'rec', 'deg', 'bad'].filter(function (k) { return states[k]; }).map(function (k) { return '<i class="cp-' + k + '" style="flex-grow:' + states[k] + '"></i>'; }).join('');
      var mine = p.name !== '.mgr';
      return '<div class="cp-pool' + (mine ? '' : ' is-sys') + '"><div class="sw-sh"><b>' + esc(p.name) + '</b><span class="gx-chip">size ' + p.size + ' · min ' + p.min + '</span><span class="gx-chip">' + p.pgn + ' PG</span>' + (p.app ? '<span class="gx-chip">' + esc(p.app) + '</span>' : mine ? '<span class="gx-chip gx-chip-warn">tanpa application</span>' : '') + '</div>' +
        '<div class="dk-meta">' + gib(st) + ' tersimpan · ' + gib(st * p.size) + ' raw · ' + kfmt(totalObjs(p)) + ' objek · sisa ' + gib(maxAvail(p)) + '</div>' +
        '<div class="cp-pgbar cp-small" aria-hidden="true">' + bar + '</div>' +
        (mine ? '<div class="sw-act"><button type="button" data-act="cmd" data-cmd="rados bench -p ' + esc(p.name) + ' 30 write --no-cleanup">tulis 15 GiB</button>' + (p.bulk ? '<button type="button" data-act="cmd" data-cmd="rados -p ' + esc(p.name) + ' cleanup">hapus data bench</button>' : '') + '<button type="button" data-act="cmd" data-cmd="rados -p ' + esc(p.name) + ' ls">ls</button></div>' : '') +
        '</div>';
    }).join(''));
    var raw = W.osds.filter(function (o) { return o.in || o.up; }).length * OSD_GIB, u = W.osds.reduce(function (a, o) { return a + used(o); }, 0);
    setText($('cp-cap'), gib(u) + ' / ' + gib(raw) + ' raw');
    var mp = $('cp-map');
    if (W.lastMap) {
      mp.hidden = false;
      var L = W.lastMap;
      setHTML(mp, '<span class="cp-mapk">objek</span> <b>' + esc(L.pool + '/' + L.obj) + '</b> <span class="cp-arrow">→</span> <span class="cp-mapk">PG</span> <b>' + esc(L.pg) + '</b> <span class="cp-arrow">→</span> ' + L.osds.map(function (id, i) { return '<b class="cp-mo' + (i === 0 ? ' is-p' : '') + '">osd.' + id + '</b>'; }).join(' ') + ' <span class="cp-mapk">(' + L.osds.map(function (id) { return osdBy(id).host; }).join(', ') + ')</span>' + (L.exists ? '' : ' <span class="cp-mapk">· objeknya belum ada</span>'));
    } else mp.hidden = true;

    // flow
    var fc = $('cp-f-cli');
    var noW = !quorum() || cs.some(function (c) { return c.code === 'OSD_FULL'; }) || S.inact;
    setText(fc, !quorum() ? 'ga ada quorum' : noW ? 'I/O tertahan' : 'bisa nulis');
    fc.dataset.s = noW ? 'bad' : 'ok';
    var userPools = W.pools.filter(function (p) { return p.name !== '.mgr'; });
    setText($('cp-f-pool'), userPools.length ? userPools.length + ' pool · ' + gib(userPools.reduce(function (a, p) { return a + poolStored(p); }, 0)) : 'cuma .mgr');
    var fp = $('cp-f-pg');
    var cleanN = S.counts['active+clean'] || 0;
    setText(fp, cleanN === S.tot ? S.tot + ' clean' : (S.tot - cleanN) + ' ga clean');
    fp.dataset.s = S.inact ? 'bad' : cleanN === S.tot ? 'ok' : groups.rec ? 'info' : 'warn';
    var fo = $('cp-f-osd');
    var upN = W.osds.filter(function (o) { return o.up; }).length, inN = W.osds.filter(function (o) { return o.in; }).length;
    setText(fo, upN + ' up · ' + inN + ' in');
    fo.dataset.s = upN < W.osds.length ? 'warn' : 'ok';
  }

  // ---------- wiring ----------
  app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b || b.disabled || b.tagName === 'INPUT') return;
    var act = b.dataset.act;
    if (act === 'cmd') { if (!W.busy) term.submit(b.dataset.cmd); }
    else if (act === 'osd') {
      var o = osdBy(+b.dataset.id);
      if (!W.hosts[o.host].power) { toast(o.host + ' lagi mati'); return; }
      o.failed = !o.failed;
      term.line('<span class="sx-dim"># ' + (o.failed ? 'disk osd.' + o.id + ' di ' + o.host + ' rusak. Monitor bakal menandainya down, lalu out kalau ga balik.' : 'osd.' + o.id + ' dinyalakan ulang') + '</span>');
      tick();
    } else if (act === 'reset') reset();
  });
  app.addEventListener('change', function (e) {
    var t = e.target;
    if (t.dataset && t.dataset.act === 'power') {
      var H = W.hosts[t.dataset.h];
      H.power = t.checked;
      if (!H.power) { H.offAt = Date.now(); W.hostWasOff[H.name] = true; if (W.flags.noout) W.nooutHost = H.name; }
      else if (W.flags.noout && W.nooutHost === H.name) W.nooutCycle = true;
      term.line('<span class="sx-dim"># ' + H.name + (H.power ? ' dinyalakan lagi' : ' dimatikan' + (H.mon ? ' (termasuk monitor-nya)' : '')) + '</span>');
      tick();
    }
  });
  setInterval(tick, 250);

  function reset() {
    initWorld();
    term.clear();
    M.reset();
    buildCards();
    term.lines([
      '<span class="sx-dim"># Cluster Ceph bohongan: 3 node (node1 sampai node3), tiap node 2 disk 100 GiB dan 1 monitor. node4 masih nganggur.</span>',
      '<span class="sx-dim"># Mulai dengan </span><b>ceph -s</b><span class="sx-dim">. Ketik </span><b>help</b><span class="sx-dim"> buat daftar perintah.</span>'
    ]);
    last = Date.now();
    render();
  }
  initWorld();
  reset();
})();
