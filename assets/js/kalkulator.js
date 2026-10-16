/* Kalkulator biaya cloud (/kalkulator/): AWS vs GCP side by side.
   Prices come from data/hargacloud.json (inlined by the layout). Nothing is stored;
   "salin tautan" puts the inputs in the URL hash. */
(function () {
  'use strict';
  var root = document.getElementById('kalk');
  var dataEl = document.getElementById('kalk-data');
  if (!root || !dataEl) return;
  var D = JSON.parse(dataEl.textContent);
  var HRS = 730;

  // default GCP counterpart for each AWS type
  var VM_PAIR = {
    't3.micro': 'e2-micro', 't3.small': 'e2-small', 't3.medium': 'e2-medium', 't3.large': 'e2-standard-2',
    't3.xlarge': 'e2-standard-4', 'm6i.large': 'n2-standard-2', 'm6i.xlarge': 'n2-standard-4',
    'm6i.2xlarge': 'n2-standard-8', 'c5.large': 'n2-highcpu-2', 'c5.xlarge': 'n2-highcpu-4',
    'r5.large': 'n2-highmem-2', 'r5.xlarge': 'n2-highmem-4'
  };
  var SQL_SIZES = ['1-3.75', '2-4', '2-8', '4-16', '2-13', '4-26', '8-32'];
  var DB_PAIR = {
    'db.t3.micro': '1-3.75', 'db.t3.small': '1-3.75', 'db.t3.medium': '2-4', 'db.t3.large': '2-8',
    'db.m6i.large': '2-8', 'db.m6i.xlarge': '4-16', 'db.r5.large': '2-13'
  };
  var SUD = [1, 0.8678, 0.7356, 0.6034]; // N2 sustained use, per quarter of the month
  var OBJ = { std: 'Standard', ia: 'Jarang diakses', arch: 'Arsip' };
  var OBJ_SVC = { std: ['S3 Standard', 'GCS Standard'], ia: ['S3 Standard-IA', 'GCS Nearline'], arch: ['S3 Glacier Flexible', 'GCS Archive'] };
  var DEST = { id: 'Indonesia / Australia', asia: 'Asia lainnya', us: 'Amerika / Eropa' };

  var PRESETS = {
    web: {
      vm: [{ a: 't3.medium', g: 'e2-medium', n: 2, h: 730 }], ssd: 60, hdd: 0, obj: { c: 'std', gb: 50 },
      db: [{ e: 'my', a: 'db.t3.small', g: '1-3.75', ha: 0, n: 1, gb: 20, h: 730 }],
      lb: { n: 1, gb: 100 }, nat: { n: 0, gb: 0 }, ip: 2, k8s: 0, eg: 200, dest: 'id'
    },
    k8s: {
      vm: [{ a: 'm6i.large', g: 'n2-standard-2', n: 3, h: 730 }, { a: 't3.large', g: 'e2-standard-2', n: 2, h: 360 }],
      ssd: 400, hdd: 0, obj: { c: 'std', gb: 500 },
      db: [{ e: 'po', a: 'db.m6i.large', g: '2-8', ha: 1, n: 1, gb: 100, h: 730 }],
      lb: { n: 1, gb: 1000 }, nat: { n: 1, gb: 300 }, ip: 1, k8s: 1, eg: 1000, dest: 'id'
    },
    data: {
      vm: [{ a: 't3.small', g: 'e2-small', n: 1, h: 730 }], ssd: 20, hdd: 1000,
      obj: { c: 'ia', gb: 5000 }, db: [], lb: { n: 0, gb: 0 }, nat: { n: 0, gb: 0 }, ip: 1, k8s: 0, eg: 100, dest: 'id'
    },
    kosong: {
      vm: [], ssd: 0, hdd: 0, obj: { c: 'std', gb: 0 }, db: [], lb: { n: 0, gb: 0 }, nat: { n: 0, gb: 0 }, ip: 0, k8s: 0, eg: 0, dest: 'id'
    }
  };

  var S = clone(PRESETS.web);
  S.r = 'jkt'; S.m = 'od'; S.cur = 'usd'; S.kurs = 16500;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function $(sel, el) { return (el || root).querySelector(sel); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function n(v, lo, hi) { v = Number(v); if (!isFinite(v)) v = 0; return Math.min(hi == null ? 1e9 : hi, Math.max(lo || 0, v)); }
  function dec(x) { return String(x).replace('.', ','); }
  function fmt(usd) {
    if (S.cur === 'idr') return 'Rp' + Math.round(usd * S.kurs).toLocaleString('id-ID');
    var d = usd !== 0 && Math.abs(usd) < 1 ? 3 : 2;
    return '$' + usd.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: d });
  }
  function tier(gb, t) {
    var s = 0;
    for (var i = 0; i < t.length; i++) {
      var hi = t[i][1] == null ? Infinity : t[i][1];
      s += Math.max(0, Math.min(gb, hi) - t[i][0]) * t[i][2];
    }
    return s;
  }
  function sudHours(h) { // N2 sustained use discount, applied per quarter of the month
    var f = h / HRS, out = 0;
    for (var q = 0; q < 4; q++) out += Math.max(0, Math.min(f - q * 0.25, 0.25)) * SUD[q];
    return out * HRS;
  }
  function spec(v) { return dec(v[0]) + ' vCPU · ' + dec(v[1]) + ' GB'; }
  function sqlSpec(k) { var p = k.split('-'); return dec(p[0]) + ' vCPU · ' + dec(p[1]) + ' GB'; }

  /* ---------- cost model ---------- */
  function costs() {
    var A = D.aws[S.r], G = D.gcp[S.r], c = {};
    var vmA = 0, vmG = 0;
    S.vm.forEach(function (v) {
      var a = A.ec2[v.a], g = G.gce[v.g], q = n(v.n), h = n(v.h, 0, HRS);
      if (S.m === 'od') {
        vmA += a[0] * h * q;
        vmG += g[0] * (/^n2-/.test(v.g) ? sudHours(h) : h) * q;
      } else {
        var i = S.m === 'y1' ? 1 : 2;
        vmA += a[i] * HRS * q; vmG += g[i] * HRS * q;
      }
    });
    c.vm = [vmA, vmG];
    c.disk = [n(S.ssd) * A.ebs.ssd + n(S.hdd) * A.ebs.hdd, n(S.ssd) * G.pd.ssd + n(S.hdd) * G.pd.hdd];
    var ob = n(S.obj.gb), oc = S.obj.c;
    c.obj = [oc === 'std' ? tier(ob, A.s3.std) : ob * A.s3[oc], ob * G.gcs[oc]];
    var dbA = 0, dbG = 0;
    S.db.forEach(function (d) {
      var ha = d.ha ? 1 : 0, q = n(d.n), h = n(d.h, 0, HRS), gb = n(d.gb);
      var p = d.g.split('-').map(Number);
      dbA += (A.rds[d.e][d.a][ha] * h + gb * A.rdsGp3[ha]) * q;
      dbG += ((p[0] * G.sql.cpu[ha] + p[1] * G.sql.mem[ha]) * h + gb * G.sql.ssd[ha]) * q;
    });
    c.db = [dbA, dbG];
    var lbn = n(S.lb.n), lbgb = n(S.lb.gb);
    c.lb = [lbn * A.lb[0] * HRS + (lbn ? lbgb * A.lb[1] : 0),
      lbn ? (G.lb[0] + Math.max(0, lbn - 5) * 0.01) * HRS + lbgb * G.lb[1] : 0];
    var nn = n(S.nat.n), ngb = nn ? n(S.nat.gb) : 0;
    c.nat = [nn * A.nat[0] * HRS + ngb * A.nat[1], nn * G.nat[0] * HRS + ngb * G.nat[1]];
    c.ip = [n(S.ip) * A.ip * HRS, n(S.ip) * G.ip * HRS];
    c.k8s = [n(S.k8s) * A.k8s * HRS, n(S.k8s) * G.k8s * HRS];
    c.eg = [tier(n(S.eg), A.egress), tier(n(S.eg), G.egress[S.dest])];
    return c;
  }

  /* ---------- rendering ---------- */
  var SECTIONS = [
    ['vm', 'Mesin virtual', 'EC2 ↔ Compute Engine'],
    ['disk', 'Block storage', 'EBS ↔ Persistent Disk'],
    ['obj', 'Object storage', 'S3 ↔ Cloud Storage'],
    ['db', 'Database terkelola', 'RDS ↔ Cloud SQL'],
    ['lb', 'Load balancer', 'ALB ↔ Cloud Load Balancing'],
    ['nat', 'NAT gateway', 'NAT Gateway ↔ Cloud NAT'],
    ['ip', 'IP publik', 'IPv4 publik yang terpakai'],
    ['k8s', 'Kubernetes', 'EKS ↔ GKE (control plane)'],
    ['eg', 'Egress internet', 'data keluar ke internet']
  ];

  function opts(list, sel, label) {
    return list.map(function (k) {
      return '<option value="' + esc(k) + '"' + (k === sel ? ' selected' : '') + '>' + esc(label(k)) + '</option>';
    }).join('');
  }
  function num(path, val, label, unit, max) {
    return '<label class="kalk-f"><span>' + label + '</span><span class="kalk-in"><input type="number" inputmode="decimal" min="0"' +
      (max ? ' max="' + max + '"' : '') + ' step="any" data-k="' + path + '" value="' + val + '">' +
      (unit ? '<i>' + unit + '</i>' : '') + '</span></label>';
  }
  function sel(path, html, label, cls) {
    return '<label class="kalk-f' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span><select data-k="' + path + '">' + html + '</select></label>';
  }
  function side(tag, html) { return '<div class="kalk-side kalk-' + tag + '"><b class="kalk-tag">' + tag + '</b>' + html + '</div>'; }

  function body(id) {
    var ec2 = Object.keys(VM_PAIR), rds = Object.keys(DB_PAIR);
    var gce = ec2.map(function (k) { return VM_PAIR[k]; });
    switch (id) {
      case 'vm':
        return S.vm.map(function (v, i) {
          var p = 'vm.' + i + '.';
          return '<div class="kalk-row">' +
            side('aws', sel(p + 'a', opts(ec2, v.a, function (k) { return k + ' · ' + spec(D.spec.ec2[k]); }), 'tipe EC2')) +
            side('gcp', sel(p + 'g', opts(gce, v.g, function (k) { return k + ' · ' + spec(D.spec.gce[k]); }), 'tipe GCE')) +
            '<div class="kalk-common">' + num(p + 'n', v.n, 'jumlah', 'unit') +
            num(p + 'h', v.h, 'nyala', 'jam/bln', HRS) +
            '<button type="button" class="kalk-del" data-del="vm.' + i + '" aria-label="Hapus VM ini">hapus</button></div></div>';
        }).join('') + '<button type="button" class="kalk-add" data-add="vm">+ tambah VM</button>';
      case 'disk':
        return '<div class="kalk-common">' + num('ssd', S.ssd, 'SSD (gp3 / balanced)', 'GB') + num('hdd', S.hdd, 'HDD (st1 / standard)', 'GB') + '</div>';
      case 'obj':
        return '<div class="kalk-common">' +
          sel('obj.c', opts(Object.keys(OBJ), S.obj.c, function (k) { return OBJ[k] + ' (' + OBJ_SVC[k].join(' / ') + ')'; }), 'kelas', 'kalk-wide') +
          num('obj.gb', S.obj.gb, 'data tersimpan', 'GB') + '</div>';
      case 'db':
        return S.db.map(function (d, i) {
          var p = 'db.' + i + '.';
          return '<div class="kalk-row">' +
            side('aws', sel(p + 'a', opts(rds, d.a, function (k) { return k + ' · ' + spec(D.spec.rds[k]); }), 'kelas RDS')) +
            side('gcp', sel(p + 'g', opts(SQL_SIZES, d.g, sqlSpec), 'ukuran Cloud SQL')) +
            '<div class="kalk-common">' +
            sel(p + 'e', opts(['my', 'po'], d.e, function (k) { return k === 'my' ? 'MySQL' : 'PostgreSQL'; }), 'engine') +
            num(p + 'gb', d.gb, 'storage', 'GB') + num(p + 'n', d.n, 'jumlah', 'unit') + num(p + 'h', d.h, 'nyala', 'jam/bln', HRS) +
            '<label class="kalk-chk"><input type="checkbox" data-k="' + p + 'ha"' + (d.ha ? ' checked' : '') + '> HA (Multi-AZ / regional)</label>' +
            '<button type="button" class="kalk-del" data-del="db.' + i + '" aria-label="Hapus database ini">hapus</button></div></div>';
        }).join('') + '<button type="button" class="kalk-add" data-add="db">+ tambah database</button>';
      case 'lb':
        return '<div class="kalk-common">' + num('lb.n', S.lb.n, 'jumlah LB', 'unit') + num('lb.gb', S.lb.gb, 'data diproses', 'GB/bln') + '</div>';
      case 'nat':
        return '<div class="kalk-common">' + num('nat.n', S.nat.n, 'jumlah gateway', 'unit') + num('nat.gb', S.nat.gb, 'data lewat NAT', 'GB/bln') + '</div>';
      case 'ip':
        return '<div class="kalk-common">' + num('ip', S.ip, 'alamat IPv4', 'buah') + '</div>';
      case 'k8s':
        return '<div class="kalk-common">' + num('k8s', S.k8s, 'cluster', 'buah') + '</div>';
      case 'eg':
        return '<div class="kalk-common">' + num('eg', S.eg, 'data keluar', 'GB/bln') +
          sel('dest', opts(Object.keys(DEST), S.dest, function (k) { return DEST[k]; }), 'tujuan pengguna', 'kalk-wide') + '</div>';
    }
  }

  function render() {
    $('#kalk-main').innerHTML = SECTIONS.map(function (s) {
      return '<section class="kalk-sec" data-sec="' + s[0] + '"><header class="kalk-sec-head"><h2>' + s[1] +
        ' <small>' + s[2] + '</small></h2><div class="kalk-sec-cost" data-cost="' + s[0] + '"></div></header>' +
        '<div class="kalk-sec-body">' + body(s[0]) + '</div></section>';
    }).join('');
    syncBar();
    update();
  }

  function syncBar() {
    $('#kalk-region').value = S.r;
    $('#kalk-model').value = S.m;
    $('#kalk-kurs').value = S.kurs;
    $('#kalk-kurs-wrap').hidden = S.cur !== 'idr';
    root.querySelectorAll('[data-cur]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.cur === S.cur)); });
  }

  function verdict(a, g) {
    if (!a && !g) return '';
    if (Math.abs(a - g) < 0.005) return 'harganya sama';
    var cheap = a < g ? 'AWS' : 'GCP', hi = Math.max(a, g), lo = Math.min(a, g);
    return cheap + ' lebih murah ' + fmt(hi - lo) + ' (' + Math.round((hi - lo) / hi * 100) + '%)';
  }

  function update() {
    var c = costs(), ta = 0, tg = 0, rows = '';
    SECTIONS.forEach(function (s) {
      var v = c[s[0]], a = v[0], g = v[1];
      ta += a; tg += g;
      var el = $('[data-cost="' + s[0] + '"]');
      if (el) {
        el.innerHTML = '<span class="' + (a < g - 0.005 ? 'is-low' : '') + '"><b>aws</b> ' + fmt(a) + '</span>' +
          '<span class="' + (g < a - 0.005 ? 'is-low' : '') + '"><b>gcp</b> ' + fmt(g) + '</span>';
        el.classList.toggle('is-zero', !a && !g);
      }
      if (a || g) {
        rows += '<tr><th scope="row">' + s[1] + '</th><td class="' + (a < g - 0.005 ? 'is-low' : '') + '">' + fmt(a) +
          '</td><td class="' + (g < a - 0.005 ? 'is-low' : '') + '">' + fmt(g) + '</td></tr>';
      }
    });
    var reg = D.regions.filter(function (r) { return r.id === S.r; })[0];
    var max = Math.max(ta, tg) || 1;
    $('#kalk-sum').innerHTML =
      '<p class="kalk-sum-title"><span>❯</span> estimasi per bulan</p>' +
      '<p class="kalk-sum-reg">' + esc(reg.name) + ' · ' + esc(reg.aws) + ' / ' + esc(reg.gcp) + '</p>' +
      '<div class="kalk-tot"><div class="kalk-tot-row kalk-aws"><span>AWS</span><b>' + fmt(ta) + '</b></div>' +
      '<div class="kalk-meter"><i style="width:' + (ta / max * 100).toFixed(1) + '%"></i></div>' +
      '<div class="kalk-tot-row kalk-gcp"><span>GCP</span><b>' + fmt(tg) + '</b></div>' +
      '<div class="kalk-meter kalk-meter-g"><i style="width:' + (tg / max * 100).toFixed(1) + '%"></i></div></div>' +
      '<p class="kalk-verdict">' + (verdict(ta, tg) || 'isi dulu komponennya') + '</p>' +
      (rows ? '<table class="kalk-break"><thead><tr><th></th><th>AWS</th><th>GCP</th></tr></thead><tbody>' + rows +
        '</tbody><tfoot><tr><th scope="row">per tahun</th><td>' + fmt(ta * 12) + '</td><td>' + fmt(tg * 12) + '</td></tr></tfoot></table>' : '') +
      (S.cur === 'idr' ? '<p class="kalk-sum-note">kurs Rp' + S.kurs.toLocaleString('id-ID') + ' per USD</p>' : '') +
      '<button type="button" class="kalk-primary" data-act="copy">salin ringkasan</button>';
    $('#kalk-dock').innerHTML = '<span><b>aws</b> ' + fmt(ta) + '</span><span><b>gcp</b> ' + fmt(tg) + '</span><small>/bln</small>';
    root._tot = [ta, tg, c];
  }

  /* ---------- state edits ---------- */
  function setPath(path, val) {
    var ks = path.split('.'), o = S;
    for (var i = 0; i < ks.length - 1; i++) o = o[ks[i]];
    o[ks[ks.length - 1]] = val;
  }

  root.addEventListener('input', function (e) {
    var t = e.target, k = t.dataset && t.dataset.k;
    if (k) {
      var v = t.type === 'checkbox' ? (t.checked ? 1 : 0) : t.tagName === 'SELECT' ? t.value : n(t.value, 0, t.max ? Number(t.max) : null);
      setPath(k, v);
      // picking an AWS type moves the GCP side to its usual counterpart
      var m = /^(vm|db)\.(\d+)\.a$/.exec(k);
      if (m) {
        var pair = (m[1] === 'vm' ? VM_PAIR : DB_PAIR)[v];
        if (pair) {
          S[m[1]][m[2]].g = pair;
          var gs = $('[data-k="' + m[1] + '.' + m[2] + '.g"]');
          if (gs) gs.value = pair;
        }
      }
      update();
    } else if (t.id === 'kalk-kurs') {
      S.kurs = n(t.value, 1, 100000) || 16500; update();
    }
  });
  root.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'kalk-region') { S.r = t.value; update(); }
    else if (t.id === 'kalk-model') { S.m = t.value; update(); }
    else if (t.id === 'kalk-preset' && t.value) {
      var keep = { r: S.r, m: S.m, cur: S.cur, kurs: S.kurs };
      S = Object.assign(clone(PRESETS[t.value]), keep);
      t.value = ''; render();
    } else if (t.dataset && t.dataset.k && t.type === 'number') {
      t.value = n(t.value, 0, t.max ? Number(t.max) : null); // normalise what the user typed
    }
  });
  root.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.cur) { S.cur = b.dataset.cur; syncBar(); update(); }
    else if (b.dataset.add === 'vm') { S.vm.push({ a: 't3.medium', g: 'e2-medium', n: 1, h: HRS }); render(); focusLast('vm'); }
    else if (b.dataset.add === 'db') { S.db.push({ e: 'my', a: 'db.t3.medium', g: '2-4', ha: 0, n: 1, gb: 20, h: HRS }); render(); focusLast('db'); }
    else if (b.dataset.del) { var p = b.dataset.del.split('.'); S[p[0]].splice(Number(p[1]), 1); render(); }
    else if (b.dataset.act === 'copy') copyText(summary(), 'Ringkasan disalin.');
    else if (b.dataset.act === 'link') copyText(link(), 'Tautan disalin. Isian kamu ikut di tautan itu.');
  });
  $('#kalk-dock').addEventListener('click', function () { $('#kalk-sum').scrollIntoView({ behavior: 'smooth', block: 'start' }); });

  function focusLast(sec) {
    var rows = root.querySelectorAll('[data-sec="' + sec + '"] .kalk-row');
    var s = rows.length && rows[rows.length - 1].querySelector('select');
    if (s) s.focus();
  }

  /* ---------- share ---------- */
  function summary() {
    var t = root._tot, reg = D.regions.filter(function (r) { return r.id === S.r; })[0];
    var lines = ['Estimasi biaya cloud per bulan, ' + reg.name + ' (' + reg.aws + ' / ' + reg.gcp + ')', ''];
    SECTIONS.forEach(function (s) {
      var v = t[2][s[0]];
      if (v[0] || v[1]) lines.push(s[1] + ': AWS ' + fmt(v[0]) + ' | GCP ' + fmt(v[1]));
    });
    lines.push('', 'Total: AWS ' + fmt(t[0]) + ' | GCP ' + fmt(t[1]), verdict(t[0], t[1]),
      'Harga publik per ' + D.asOf + ', estimasi kasar. ' + link());
    return lines.join('\n');
  }
  function link() {
    var u = location.href.split('#')[0];
    try { return u + '#s=' + btoa(unescape(encodeURIComponent(JSON.stringify(S)))); } catch (e) { return u; }
  }
  function readHash() {
    var m = /#s=([^&]+)/.exec(location.hash);
    if (!m) return;
    try {
      var o = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
      var base = clone(PRESETS.kosong);
      ['ssd', 'hdd', 'ip', 'k8s', 'eg', 'kurs'].forEach(function (k) { if (o[k] != null) base[k] = n(o[k], 0); });
      if (D.aws[o.r]) base.r = o.r;
      base.m = ['od', 'y1', 'y3'].indexOf(o.m) >= 0 ? o.m : 'od';
      base.cur = o.cur === 'idr' ? 'idr' : 'usd';
      base.kurs = n(o.kurs, 1, 100000) || 16500;
      base.dest = DEST[o.dest] ? o.dest : 'id';
      if (o.obj && OBJ[o.obj.c]) base.obj = { c: o.obj.c, gb: n(o.obj.gb) };
      ['lb', 'nat'].forEach(function (k) { if (o[k]) base[k] = { n: n(o[k].n), gb: n(o[k].gb) }; });
      (o.vm || []).slice(0, 20).forEach(function (v) {
        if (D.spec.ec2[v.a] && D.spec.gce[v.g]) base.vm.push({ a: v.a, g: v.g, n: n(v.n), h: n(v.h, 0, HRS) });
      });
      (o.db || []).slice(0, 20).forEach(function (d) {
        if (D.spec.rds[d.a] && SQL_SIZES.indexOf(d.g) >= 0) base.db.push({ e: d.e === 'po' ? 'po' : 'my', a: d.a, g: d.g, ha: d.ha ? 1 : 0, n: n(d.n), gb: n(d.gb), h: n(d.h, 0, HRS) });
      });
      S = base;
    } catch (e) { /* bad hash: keep defaults */ }
  }
  function copyText(txt, msg) {
    var done = function () { toast(msg); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(txt).then(done, function () { fallback(txt) ? done() : toast('Gagal menyalin.'); });
    } else { fallback(txt) ? done() : toast('Gagal menyalin.'); }
  }
  function fallback(txt) {
    var ta = document.createElement('textarea');
    ta.value = txt; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }
  var toastT;
  function toast(msg) {
    var el = $('#kalk-toast');
    el.textContent = msg; el.classList.add('is-on');
    clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove('is-on'); }, 2400);
  }

  /* ---------- mobile dock: show while the summary is off screen ---------- */
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (en) {
      var dock = $('#kalk-dock');
      dock.classList.toggle('is-on', !en[0].isIntersecting && en[0].boundingClientRect.top > 0);
    }).observe($('#kalk-sum'));
  }

  /* ---------- init ---------- */
  $('#kalk-region').innerHTML = D.regions.map(function (r) {
    return '<option value="' + r.id + '">' + esc(r.name) + '</option>';
  }).join('');
  var d = new Date(D.asOf + 'T00:00:00');
  $('#kalk-asof').textContent = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  readHash();
  render();
})();
