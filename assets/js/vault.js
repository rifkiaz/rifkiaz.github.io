// HashiCorp Vault simulator for /vault/. One Vault server (vault-1) with
// integrated raft storage: init and Shamir unseal, tokens and ACL policies
// checked against the real API paths, KV v1/v2, transit, a database engine
// backed by a pretend PostgreSQL, AppRole auth, an audit device and leases
// that really expire. A laptop shell runs the vault CLI with env vars,
// $(...) substitution and pipes into base64, jq and grep. Nothing is stored.
(function () {
  'use strict';

  var K = window.SimKit;
  var app = document.getElementById('vt');
  if (!app || !K) return;
  var esc = K.esc, setHTML = K.setHTML, setText = K.setText, words = K.words, pad = K.pad;
  function $(id) { return document.getElementById(id); }

  var HOST = '10.0.0.10', ADDR_OK = 'http://10.0.0.10:8200', DB_HOST = '10.0.0.20';
  var DB_ADMIN = { user: 'vault', pass: 'vault-pass', db: 'app' };
  var VERSION = '1.17.6', BUILD = '2024-09-24T19:48:40Z';
  var SYS_TTL = 768 * 3600;
  var CAPS = ['create', 'read', 'update', 'patch', 'delete', 'list', 'sudo', 'deny'];
  var ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var ROLE_SQL = 'CREATE ROLE \\"{{name}}\\" WITH LOGIN PASSWORD \'{{password}}\' VALID UNTIL \'{{expiration}}\'; GRANT SELECT ON ALL TABLES IN SCHEMA public TO \\"{{name}}\\";';
  var ROLE_CMD = 'vault write database/roles/readonly db_name=postgres creation_statements="' + ROLE_SQL + '" default_ttl=1m max_ttl=5m';
  var DB_CMD = 'vault write database/config/postgres plugin_name=postgresql-database-plugin connection_url="postgresql://{{username}}:{{password}}@' + DB_HOST + ':5432/app" allowed_roles=readonly username=vault password=vault-pass';

  var MISSIONS = [
    { id: 'init', text: 'Arahkan CLI ke server (<b>VAULT_ADDR</b>), lalu inisialisasi: <i>vault operator init</i>.' },
    { id: 'unseal', text: 'Buka segel Vault pakai <b>3 dari 5</b> unseal key.' },
    { id: 'login', text: 'Login pakai <b>root token</b>, lalu cek <i>vault token lookup</i>.' },
    { id: 'kv', text: 'Aktifkan <b>KV v2</b> di <i>secret/</i>, simpan <b>secret/app/db</b>, lalu baca lagi.' },
    { id: 'versi', text: 'Ubah secret itu, lalu ambil <b>versi lamanya</b> pakai <i>-version=1</i> atau <i>kv rollback</i>.' },
    { id: 'policy', text: 'Tulis policy <b>app-read</b>, bikin token dengannya, lalu buktikan token itu bisa baca tapi <b>ga bisa nulis</b>.' },
    { id: 'approle', text: 'Login sebagai aplikasi lewat <b>AppRole</b>: tukar role-id + secret-id jadi token.' },
    { id: 'dynamic', text: 'Minta <b>kredensial database dinamis</b>, lalu revoke lease-nya (atau tunggu sampai habis).' },
    { id: 'transit', text: 'Enkripsi teks pakai <b>transit</b>, lalu dekripsi lagi ke teks aslinya.' },
    { id: 'seal', text: 'Segel darurat pakai <b>vault operator seal</b>, lalu unseal lagi.' }
  ];

  var DEFAULT_POLICY = [
    '# Allow tokens to look up their own properties',
    'path "auth/token/lookup-self" {',
    '    capabilities = ["read"]',
    '}',
    '',
    '# Allow tokens to renew themselves',
    'path "auth/token/renew-self" {',
    '    capabilities = ["update"]',
    '}',
    '',
    '# Allow tokens to revoke themselves',
    'path "auth/token/revoke-self" {',
    '    capabilities = ["update"]',
    '}',
    '',
    '# Allow a token to look up its own capabilities on a path',
    'path "sys/capabilities-self" {',
    '    capabilities = ["update"]',
    '}',
    '',
    '# Allow a token to renew or look up a lease via lease_id in the request body',
    'path "sys/leases/renew" {',
    '    capabilities = ["update"]',
    '}',
    'path "sys/leases/lookup" {',
    '    capabilities = ["update"]',
    '}',
    '',
    '# Allow a token to manage its own cubbyhole',
    'path "cubbyhole/*" {',
    '    capabilities = ["create", "read", "update", "delete", "list"]',
    '}'
  ].join('\n');

  var SNIPS = {
    ro: [
      '# Policy buat aplikasi web: boleh baca secret di secret/app/,',
      '# tapi ga boleh nulis atau menghapus.',
      '# Di KV v2, path API-nya pakai prefix data/ (secret/data/...).',
      'path "secret/data/app/*" {',
      '  capabilities = ["read"]',
      '}',
      '',
      '# minta kredensial database dinamis',
      'path "database/creds/readonly" {',
      '  capabilities = ["read"]',
      '}',
      '',
      '# pakai kunci transit "app" buat enkripsi dan dekripsi',
      'path "transit/encrypt/app" {',
      '  capabilities = ["update"]',
      '}',
      'path "transit/decrypt/app" {',
      '  capabilities = ["update"]',
      '}',
      ''
    ].join('\n'),
    v1: [
      '# Kelihatannya benar, tapi buat KV v2 ini salah:',
      '# CLI "vault kv get secret/app/db" sebenarnya membaca',
      '# path API secret/data/app/db, jadi rule di bawah ga kena.',
      'path "secret/app/*" {',
      '  capabilities = ["read", "list"]',
      '}',
      ''
    ].join('\n')
  };

  // ---------- small helpers ----------
  function rs(n, chars) {
    chars = chars || ALNUM;
    var s = '';
    for (var i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }
  function uuid() { var h = K.hex(32); return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20); }
  function randB64(bytes) { var s = ''; for (var i = 0; i < bytes; i++) s += String.fromCharCode(Math.floor(Math.random() * 256)); return btoa(s); }
  function b64(s) { try { return btoa(unescape(encodeURIComponent(s))); } catch (e) { return ''; } }
  function unb64(s) {
    s = String(s || '').replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4) return null;
    try { var raw = atob(s); try { return decodeURIComponent(escape(raw)); } catch (e) { return raw; } } catch (e2) { return null; }
  }
  function isB64(s) { return /^[A-Za-z0-9+/]*={0,2}$/.test(s) && s.length % 4 === 0; }
  function isoNano(t) { return new Date(t).toISOString().slice(0, 23) + rs(6, '0123456789') + 'Z'; }
  function iso(t) { return new Date(t).toISOString().replace(/\.\d+Z$/, 'Z'); }
  function now() { return Date.now(); }
  function dur(s) {
    s = Math.max(0, Math.round(s));
    if (!s) return '0s';
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return (h ? h + 'h' : '') + (m ? m + 'm' : '') + (x ? x + 's' : '');
  }
  function parseDur(v) {
    if (v === undefined || v === null || v === '') return null;
    v = String(v).trim();
    if (/^\d+$/.test(v)) return +v;
    var m = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(v);
    if (!m) return NaN;
    return (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+(m[3] || 0)) * 60 + (+(m[4] || 0));
  }
  function list(v) {
    if (v === undefined || v === null || v === '') return [];
    if (Array.isArray(v)) return v;
    return String(v).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
  function jlist(a) { return '[' + a.map(function (x) { return '"' + x + '"'; }).join(' ') + ']'; }

  // CLI errors are thrown and printed in red by onCmd
  function E(msg, hintTxt) { var e = new Error(msg); e.cli = true; e.hint = hintTxt; return e; }
  function apiE(code, msgs, hintTxt) { return { api: true, code: code, msgs: [].concat(msgs), hint: hintTxt }; }

  // ---------- policies ----------
  function PErr(line, msg) { return { pline: line, msg: msg }; }
  function parsePolicy(src) {
    var toks = [], i = 0, line = 1, j;
    while (i < src.length) {
      var c = src[i];
      if (c === '\n') { line++; i++; continue; }
      if (/\s/.test(c)) { i++; continue; }
      if (c === '#' || (c === '/' && src[i + 1] === '/')) { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') {
        j = src.indexOf('*/', i + 2);
        if (j < 0) throw PErr(line, 'komentar /* belum ditutup dengan */');
        line += (src.slice(i, j).match(/\n/g) || []).length;
        i = j + 2;
        continue;
      }
      if (c === '"') {
        var v = '';
        j = i + 1;
        while (j < src.length && src[j] !== '"' && src[j] !== '\n') { if (src[j] === '\\') { v += src[j + 1] || ''; j += 2; continue; } v += src[j]; j++; }
        if (src[j] !== '"') throw PErr(line, 'tanda kutip " belum ditutup');
        toks.push({ t: 's', v: v, line: line });
        i = j + 1;
        continue;
      }
      if ('{}[]=,'.indexOf(c) >= 0) { toks.push({ t: c, line: line }); i++; continue; }
      var m = /^[A-Za-z_][\w-]*|^\d+/.exec(src.slice(i));
      if (m) { toks.push({ t: 'id', v: m[0], line: line }); i += m[0].length; continue; }
      if (c === '“' || c === '”') throw PErr(line, 'pakai tanda kutip biasa ", bukan kutip miring');
      throw PErr(line, 'karakter "' + c + '" ga dikenal');
    }
    var p = 0, rules = [];
    function lastLine() { return toks.length ? toks[toks.length - 1].line : 1; }
    function need(t, what) {
      var k = toks[p];
      if (!k || k.t !== t) throw PErr(k ? k.line : lastLine(), 'harusnya ada ' + what + ' di sini');
      p++;
      return k;
    }
    function value() {
      var k = toks[p];
      if (!k) throw PErr(lastLine(), 'nilainya belum ditulis');
      if (k.t === 's' || k.t === 'id') { p++; return k.v; }
      if (k.t === '[') {
        p++;
        var arr = [];
        while (toks[p] && toks[p].t !== ']') {
          var x = toks[p];
          if (x.t !== 's') throw PErr(x.line, 'isi list harus string berkutip, misal "read"');
          arr.push(x.v);
          p++;
          if (toks[p] && toks[p].t === ',') p++;
          else if (toks[p] && toks[p].t !== ']') throw PErr(toks[p].line, 'kurang koma di antara isi list');
        }
        need(']', '] penutup list');
        return arr;
      }
      if (k.t === '{') {
        var d = 0;
        do { if (toks[p].t === '{') d++; if (toks[p].t === '}') d--; p++; } while (p < toks.length && d > 0);
        if (d) throw PErr(k.line, 'kurung { belum ditutup');
        return {};
      }
      throw PErr(k.line, 'nilai ga valid');
    }
    while (p < toks.length) {
      var k = toks[p];
      if (k.t !== 'id' || k.v !== 'path') throw PErr(k.line, k.t === 'id' ? 'blok "' + k.v + '" ga dikenal. Isi policy itu blok path "..." { ... }' : 'harusnya diawali path "..."');
      p++;
      var ps = need('s', 'nama path berkutip, misal path "secret/data/app/*"');
      var open = need('{', '{ setelah nama path');
      var caps = null, capLine = open.line;
      while (toks[p] && toks[p].t !== '}') {
        var a = toks[p];
        if (a.t !== 'id') throw PErr(a.line, 'harusnya atribut seperti capabilities = [...]');
        p++;
        need('=', '= setelah ' + a.v);
        var val = value();
        if (a.v === 'capabilities') {
          if (!Array.isArray(val)) throw PErr(a.line, 'capabilities harus berupa list, misal ["read"]');
          caps = val;
          capLine = a.line;
        } else if (['allowed_parameters', 'denied_parameters', 'required_parameters', 'min_wrapping_ttl', 'max_wrapping_ttl'].indexOf(a.v) < 0) {
          throw PErr(a.line, 'atribut "' + a.v + '" ga dikenal. Yang biasa dipakai: capabilities');
        }
      }
      if (!toks[p]) throw PErr(open.line, 'blok path ini belum ditutup dengan }');
      p++;
      if (!caps) throw PErr(ps.line, 'path "' + ps.v + '": belum ada capabilities');
      caps.forEach(function (c) { if (CAPS.indexOf(c) < 0) throw PErr(capLine, 'path "' + ps.v + '": invalid capability "' + c + '"'); });
      if (/\*./.test(ps.v)) throw PErr(ps.line, 'path "' + ps.v + '": tanda * cuma boleh di akhir path');
      rules.push({ path: ps.v.replace(/^\/+/, ''), caps: caps, line: ps.line });
    }
    return rules;
  }
  function globRe(pat) {
    var star = /\*$/.test(pat), body = star ? pat.slice(0, -1) : pat;
    return new RegExp('^' + body.split('+').map(function (x) { return x.replace(/[.?^${}()|[\]\\/]/g, '\\$&'); }).join('[^/]+') + (star ? '.*' : '') + '$');
  }
  // Vault's priority: later first wildcard wins, then no trailing *, then
  // fewer + segments, then the longer path
  function spec(p) { var i = p.search(/[*+]/); return [i < 0 ? p.length : i, /\*$/.test(p) ? 1 : 0, (p.match(/\+/g) || []).length, p.length]; }
  function cmpSpec(a, b) {
    var x = spec(a.path), y = spec(b.path);
    return (y[0] - x[0]) || (x[1] - y[1]) || (x[2] - y[2]) || (y[3] - x[3]);
  }
  function isRoot(tok) { return tok && tok.policies.indexOf('root') >= 0; }
  function capsFor(tok, path) {
    if (isRoot(tok)) return ['root'];
    var exact = [], globs = [];
    tok.policies.forEach(function (n) {
      var pol = W.policies[n];
      if (!pol) return;
      pol.rules.forEach(function (r) {
        if (!globRe(r.path).test(path)) return;
        (/[*+]/.test(r.path) ? globs : exact).push(r);
      });
    });
    var win = exact;
    if (!win.length && globs.length) {
      globs.sort(cmpSpec);
      win = globs.filter(function (r) { return r.path === globs[0].path; });
    }
    var caps = [];
    win.forEach(function (r) { r.caps.forEach(function (c) { if (caps.indexOf(c) < 0) caps.push(c); }); });
    return caps.indexOf('deny') >= 0 ? ['deny'] : caps;
  }

  // ---------- state ----------
  var W;
  function initWorld() {
    W = {
      tab: W ? W.tab : 'status',
      env: { HOME: '/home/kamu', USER: 'kamu', SHELL: '/bin/bash', PATH: '/usr/local/bin:/usr/bin:/bin' },
      shell: {}, tmp: null, fileToken: null, pending: null,
      init: false, sealed: true, shares: 0, threshold: 0, keys: [], parts: [], nonce: '', root: null,
      clusterId: uuid(), clusterName: 'vault-cluster-' + K.hex(8), activeSince: 0, sealedAt: now(),
      mounts: {}, auths: {}, audits: {}, policies: {}, tokens: {}, dead: {}, leases: [], dbUsers: [], ciphers: {},
      sealedByOp: false, raftIdx: 31, last: {}, dupKey: false
    };
    addMount('cubbyhole/', 'cubbyhole', 'per-token private secret storage');
    addMount('identity/', 'identity', 'identity store');
    addMount('sys/', 'system', 'system endpoints used for control, policy and debugging');
    W.auths['token/'] = { type: 'token', accessor: 'auth_token_' + K.hex(8), desc: 'token based credentials', roles: {} };
    W.policies['default'] = { text: DEFAULT_POLICY, rules: parsePolicy(DEFAULT_POLICY) };
    W.policies.root = { text: '', rules: [] };
  }
  function addMount(path, type, desc, version) {
    W.mounts[path] = {
      type: type, version: version || 0, accessor: (type === 'system' ? 'system' : type) + '_' + K.hex(8), desc: desc || '',
      created: now(), secrets: {}, keys: {}, configs: {}, roles: {}
    };
  }
  function longest(map, p) {
    var ks = Object.keys(map).sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < ks.length; i++) if ((p + '/').indexOf(ks[i]) === 0) return ks[i];
    return null;
  }
  function vEnv() { return Object.assign({}, W.env, W.tmp || {}); }
  function curTokId() { var e = vEnv(); return e.VAULT_TOKEN || W.fileToken; }
  function curTok() { var id = curTokId(); return id ? W.tokens[id] : null; }
  function newToken(o) {
    var t = {
      id: 'hvs.' + rs(24), accessor: rs(24), policies: o.policies, created: now(), ttl: o.ttl || 0,
      expires: o.ttl ? now() + o.ttl * 1000 : 0, display: o.display || 'token', path: o.path || 'auth/token/create',
      renewable: !!o.ttl, orphan: !!o.orphan, parent: o.parent || null, meta: o.meta || null
    };
    W.tokens[t.id] = t;
    return t;
  }
  function revokeToken(id, why) {
    var t = W.tokens[id];
    if (!t) return;
    delete W.tokens[id];
    W.dead[id] = why || 'dicabut';
    Object.keys(W.tokens).forEach(function (k) { var c = W.tokens[k]; if (c && c.parent === id && !c.orphan) revokeToken(k, why); });
    W.leases.slice().forEach(function (L) { if (L.token === id) endLease(L, 'token-nya ' + (why || 'dicabut')); });
  }
  function newLease(prefix, ttl, max, tok, info) {
    var L = { id: prefix + '/' + rs(24), path: prefix, issued: now(), renewed: 0, ttl: ttl, expires: now() + ttl * 1000, maxAt: now() + max * 1000, token: tok ? tok.id : null, info: info };
    W.leases.push(L);
    return L;
  }
  function endLease(L, why) {
    var i = W.leases.indexOf(L);
    if (i < 0) return;
    W.leases.splice(i, 1);
    if (L.info && L.info.kind === 'db') {
      W.dbUsers.forEach(function (u) { if (u.lease === L.id && !u.gone) { u.gone = now(); u.why = why; } });
      K.pulse(app, 'creds');
      K.flash(app, 'db', 'warn');
      if (why === 'kedaluwarsa') toast('⏳ Lease habis. User <b>' + esc(L.info.user.slice(0, 26)) + '…</b> dihapus dari PostgreSQL.');
      M.hit('dynamic');
    }
  }
  function storeCount() {
    var n = 0;
    Object.keys(W.mounts).forEach(function (k) {
      var m = W.mounts[k];
      Object.keys(m.secrets).forEach(function (s) { n += m.secrets[s].versions ? m.secrets[s].versions.length : 1; });
      n += Object.keys(m.keys).length + Object.keys(m.configs).length + Object.keys(m.roles).length + 1;
    });
    return n + Object.keys(W.policies).length + Object.keys(W.tokens).length + W.leases.length + Object.keys(W.auths).length;
  }

  // ---------- terminal and output ----------
  var term = new K.Term($('vt-out'), $('vt-in'), { onCmd: onCmd });
  var toast = K.makeToast($('vt-toast'));
  var M = new K.Missions($('vt-m-list'), $('vt-m-count'), MISSIONS, toast, '🔐 Semua misi Vault beres. Rahasia kamu aman!');
  var ed;
  var CAP = null;
  function emit(text, cls) {
    if (CAP) { CAP.push(text + '\n'); return; }
    term.line(esc(text), cls);
  }
  function emitRaw(s) {
    if (CAP) { CAP.push(s); return; }
    term.line(esc(String(s).replace(/\n$/, '')));
  }
  function out(t) { emit(t); }
  function block(t) { emit(t, 'sx-tbl'); }
  function err(t) { term.line('<span class="sx-err">' + esc(t) + '</span>'); }
  function dim(t) { term.line('<span class="sx-dim">' + esc(t) + '</span>'); }
  function hint(t) { term.line('<span class="sx-warn">' + esc(t) + '</span>'); }
  function ok(t) { if (CAP) { CAP.push(t + '\n'); return; } term.line('<span class="sx-ok">' + esc(t) + '</span>'); }
  function prompt() { return 'kamu@laptop:~$'; }

  function fmtVal(v) {
    if (v === null || v === undefined) return '<nil>';
    if (Array.isArray(v)) return '[' + v.map(fmtVal).join(' ') + ']';
    if (typeof v === 'object') return 'map[' + Object.keys(v).sort().map(function (k) { return k + ':' + fmtVal(v[k]); }).join(' ') + ']';
    return String(v);
  }
  // Vault's "Key  Value" table
  function kvt(pairs) {
    var w = 3;
    pairs.forEach(function (p) { w = Math.max(w, p[0].length); });
    block([pad('Key', w + 4) + 'Value', pad('---', w + 4) + '-----'].concat(pairs.map(function (p) { return pad(p[0], w + 4) + fmtVal(p[1]); })).join('\n'));
  }
  function cols(rows) {
    var w = [];
    rows.forEach(function (r) { r.forEach(function (c, i) { w[i] = Math.max(w[i] || 0, String(c).length); }); });
    var head = rows[0].map(function (h) { return h.replace(/./g, '-'); });
    rows.splice(1, 0, head);
    block(rows.map(function (r) { return r.map(function (c, i) { return i === r.length - 1 ? String(c) : pad(c, w[i] + 4); }).join(''); }).join('\n'));
  }
  // -format=json, -field=x or the normal table
  function show(P, resp, pairs) {
    var f = P.get('field');
    if (f) {
      var hit = pairs.filter(function (p) { return p[0] === f; })[0];
      if (!hit) throw E('Field "' + f + '" not present in secret');
      emit(typeof hit[1] === 'string' ? hit[1] : fmtVal(hit[1]));
      return;
    }
    if (P.get('format') === 'json') { emit(JSON.stringify(resp, null, 2)); return; }
    if (P.get('format') && P.get('format') !== 'table') throw E('Invalid output format: ' + P.get('format'));
    kvt(pairs);
  }
  function respJSON(r) {
    return {
      request_id: uuid(), lease_id: r.lease ? r.lease.id : '', lease_duration: r.lease ? r.lease.ttl : 0, renewable: !!r.lease,
      data: r.data || null, warnings: r.warnings || null, auth: r.auth ? authJSON(r.auth) : null, mount_type: r.mountType || ''
    };
  }
  function authJSON(t) {
    return { client_token: t.id, accessor: t.accessor, policies: t.policies, token_policies: t.policies, metadata: t.meta, lease_duration: t.ttl, renewable: t.renewable, entity_id: '', token_type: 'service', orphan: t.orphan };
  }
  function authPairs(t) {
    var p = [['token', t.id], ['token_accessor', t.accessor], ['token_duration', t.ttl ? dur(t.ttl) : '∞'], ['token_renewable', String(t.renewable)],
      ['token_policies', jlist(t.policies)], ['identity_policies', '[]'], ['policies', jlist(t.policies)]];
    if (t.meta) Object.keys(t.meta).forEach(function (k) { p.push(['token_meta_' + k, t.meta[k]]); });
    return p;
  }
  function leasePairs(L) { return [['lease_id', L.id], ['lease_duration', dur(L.ttl)], ['lease_renewable', 'true']]; }

  // ---------- API ----------
  var NOAUTH = /^(sys\/(seal-status|health|init|unseal|leader|internal\/ui\/mounts\/.+)|auth\/[^/]+\/login)$/;
  var SEAL_FREE = /^sys\/(seal-status|health|init|unseal|leader)$/;
  function netCheck(addr, method, path) {
    var gm = method === 'LIST' ? 'Get' : method[0] + method.slice(1).toLowerCase();
    var a = (addr || 'https://127.0.0.1:8200').replace(/\/+$/, '');
    var u = a + '/v1/' + path + (method === 'LIST' ? '?list=true' : '');
    var m = /^(https?):\/\/([^/:]+)(?::(\d+))?$/.exec(a);
    if (!m) return { msg: gm + ' "' + u + '": unsupported protocol scheme ""', hint: '# VAULT_ADDR harus lengkap dengan http:// dan port, misal ' + ADDR_OK };
    var host = m[2], port = m[3] || (m[1] === 'https' ? '443' : '80');
    if (host === HOST && port === '8200') {
      if (m[1] === 'https') return { msg: gm + ' "' + u + '": http: server gave HTTP response to HTTPS client', hint: '# listener vault-1 di simulasi ini pakai http. Pakai export VAULT_ADDR=' + ADDR_OK };
      return null;
    }
    var h = !addr ? (W.shell.VAULT_ADDR ? '# VAULT_ADDR sudah di-set tapi belum di-export, jadi vault ga melihatnya. Jalankan: export VAULT_ADDR' : '# VAULT_ADDR belum di-set, jadi CLI mencoba https://127.0.0.1:8200 (laptop kamu sendiri). Jalankan: export VAULT_ADDR=' + ADDR_OK) : '# server Vault ada di ' + ADDR_OK;
    return { msg: gm + ' "' + u + '": dial tcp ' + host + ':' + port + ': connect: connection refused', hint: h };
  }
  function api(method, path, body, o) {
    o = o || {};
    path = String(path || '').replace(/^\/+/, '').replace(/\/+$/, '');
    var env = vEnv();
    var n = netCheck(env.VAULT_ADDR, method, path);
    if (n) { var ne = { net: true, msg: n.msg, hint: n.hint }; throw ne; }
    var e;
    K.pulse(app, 'api');
    if (!W.init && !/^sys\/(seal-status|health|init|leader)$/.test(path)) { K.flash(app, 'vault', 'warn'); e = apiE(400, 'Vault is not initialized', '# Vault belum di-init. Jalankan: vault operator init'); }
    else if (W.sealed && !SEAL_FREE.test(path)) { K.flash(app, 'vault', 'warn'); e = apiE(503, 'Vault is sealed', '# Vault masih tersegel. Buka dulu pakai vault operator unseal.'); }
    if (e) { e.method = method; e.path = path; throw e; }
    var h, tok = null, op;
    try {
      h = route(method, path);
      op = h.op || ({ GET: 'read', LIST: 'list', DELETE: 'delete', PATCH: 'patch' }[method]) || (h.exists ? 'update' : 'create');
      if (!NOAUTH.test(path)) {
        var id = o.token !== undefined ? o.token : curTokId();
        tok = id ? W.tokens[id] : null;
        if (!tok) {
          K.flash(app, 'vault', 'warn');
          throw apiE(403, 'permission denied', !id ? '# belum ada token. Login dulu: vault login' : W.dead[id] ? '# token ini sudah ' + W.dead[id] + '. Login lagi atau pakai token lain.' : '# token ini ga dikenal Vault. Cek lagi, mungkin salah salin.');
        }
        var caps = capsFor(tok, path);
        var allowed = caps[0] === 'root' || (caps.indexOf(op) >= 0 || (op === 'patch' && caps.indexOf('update') >= 0 && caps.indexOf('read') >= 0)) && (!h.sudo || caps.indexOf('sudo') >= 0);
        if (!allowed) {
          tok.denied = true;
          policyMission(tok);
          K.flash(app, 'vault', 'warn');
          throw apiE(403, 'permission denied', denyHint(tok, path, op, h, caps));
        }
      }
      var r = h.fn(body || {}, tok) || {};
      if (tok && method === 'GET' && !/^(sys|auth)\//.test(path) && !r.notFound) { tok.okRead = true; policyMission(tok); }
      if (method !== 'GET' && method !== 'LIST') { W.raftIdx++; K.pulse(app, 'barrier'); }
      if (W.audits['file/'] && W.audits['file/'].n !== undefined) W.audits['file/'].n++;
      return r;
    } catch (x) {
      if (x && x.api) { x.method = method; x.path = path; }
      throw x;
    }
  }
  function denyHint(tok, path, op, h, caps) {
    var m = /^([^/]+\/)data\/(.+)$/.exec(path);
    var mt = m && W.mounts[m[1]];
    if (mt && mt.type === 'kv' && mt.version === 2) {
      var plain = m[1] + m[2];
      var miss = tok.policies.some(function (n) { var p = W.policies[n]; return p && p.rules.some(function (r) { return globRe(r.path).test(plain); }); });
      if (miss) return '# policy kamu menulis path tanpa data/. Di KV v2, path API-nya ' + path + ', jadi tulis path "' + m[1] + 'data/..." di policy.';
    }
    if (h.sudo && caps.indexOf(op) >= 0) return '# path ini butuh kemampuan sudo.';
    return '# policy token ini (' + tok.policies.join(', ') + ') ga mengizinkan "' + op + '" di ' + path + '. Cek pakai: vault token capabilities ' + path;
  }
  function policyMission(tok) {
    if (!tok || isRoot(tok)) return;
    var custom = tok.policies.some(function (p) { return p !== 'default'; });
    if (custom && tok.okRead && tok.denied) M.hit('policy');
  }
  function notFoundRoute(path) { return apiE(404, 'no handler for route "' + path + '". route entry not found.'); }
  function unsupported() { return apiE(405, 'unsupported operation'); }
  function route(method, path) {
    if (path === 'sys' || /^sys\//.test(path)) return sysRoute(method, path.slice(4), path);
    if (/^auth\//.test(path)) {
      var ap = longest(W.auths, path.slice(5));
      if (!ap) throw notFoundRoute(path);
      var rel = path.slice(5 + ap.length);
      var am = W.auths[ap];
      if (am.type === 'token') return tokenRoute(method, rel);
      if (am.type === 'approle') return approleRoute(am, method, rel);
      throw notFoundRoute(path);
    }
    var mp = longest(W.mounts, path);
    if (!mp) throw notFoundRoute(path);
    var m = W.mounts[mp], r = path.slice(mp.length);
    if (m.type === 'kv' && m.version === 2) return kv2Route(m, mp, method, r);
    if (m.type === 'kv') return kv1Route(m, method, r, null);
    if (m.type === 'cubbyhole') return kv1Route(m, method, r, true);
    if (m.type === 'transit') return transitRoute(m, mp, method, r);
    if (m.type === 'database') return dbRoute(m, mp, method, r);
    throw notFoundRoute(path);
  }
  function isWrite(method) { return method === 'PUT' || method === 'POST'; }

  // ---------- sys/ ----------
  function sealStatus() {
    return {
      type: 'shamir', initialized: W.init, sealed: W.sealed, t: W.threshold, n: W.shares, progress: W.parts.length,
      nonce: W.parts.length ? W.nonce : '', version: VERSION, build_date: BUILD, storage_type: 'raft',
      cluster_name: W.sealed ? undefined : W.clusterName, cluster_id: W.sealed ? undefined : W.clusterId
    };
  }
  function sysRoute(method, rel, full) {
    var m;
    if (rel === 'seal-status' || rel === 'health' || rel === 'leader') { if (method !== 'GET') throw unsupported(); return { fn: function () { return { data: sealStatus() }; } }; }
    if (rel === 'init') {
      if (method === 'GET') return { fn: function () { return { data: { initialized: W.init } }; } };
      return { fn: doInit };
    }
    if (rel === 'unseal') return { fn: doUnseal };
    if (rel === 'seal') return { op: 'update', sudo: true, fn: doSeal };
    if ((m = /^internal\/ui\/mounts\/(.+)$/.exec(rel))) {
      return {
        fn: function () {
          var p = m[1].replace(/\/+$/, '');
          var mp = longest(W.mounts, p);
          if (!mp || mp === 'sys/') throw apiE(403, 'preflight capability check returned 403, please ensure client\'s policies grant access to path "' + p + '/"', '# belum ada secrets engine di path ini. Aktifkan dulu, misal: vault secrets enable -path=secret kv-v2');
          var mt = W.mounts[mp];
          return { data: { path: mp, type: mt.type, options: mt.type === 'kv' ? { version: String(mt.version || 1) } : null } };
        }
      };
    }
    if (rel === 'mounts') { if (method !== 'GET') throw unsupported(); return { fn: function () { return { data: W.mounts }; } }; }
    if ((m = /^mounts\/(.+)$/.exec(rel))) {
      var mp = m[1].replace(/\/+$/, '') + '/';
      if (isWrite(method)) return { exists: !!W.mounts[mp], fn: function (b) { enableMount(mp, b); } };
      if (method === 'DELETE') return { fn: function () { disableMount(mp); } };
      if (method === 'GET') return { fn: function () { var x = W.mounts[mp]; if (!x) throw apiE(400, 'cannot fetch sysview for path "' + mp + '"'); return { data: { type: x.type } }; } };
      throw unsupported();
    }
    if (rel === 'auth') { if (method !== 'GET') throw unsupported(); return { fn: function () { return { data: W.auths }; } }; }
    if ((m = /^auth\/(.+)$/.exec(rel))) {
      var ap = m[1].replace(/\/+$/, '') + '/';
      if (isWrite(method)) return { sudo: true, exists: !!W.auths[ap], fn: function (b) { enableAuth(ap, b); } };
      if (method === 'DELETE') return { sudo: true, fn: function () { if (ap === 'token/') throw apiE(400, 'token credential backend cannot be disabled'); delete W.auths[ap]; } };
      throw unsupported();
    }
    if (rel === 'audit') { if (method !== 'GET') throw unsupported(); return { sudo: true, fn: function () { return { data: W.audits }; } }; }
    if ((m = /^audit\/(.+)$/.exec(rel))) {
      var dp = m[1].replace(/\/+$/, '') + '/';
      if (isWrite(method)) {
        return {
          sudo: true, op: 'update', fn: function (b) {
            if (W.audits[dp]) throw apiE(400, 'path already in use');
            if (b.type !== 'file') throw apiE(400, 'unknown backend type: "' + (b.type || '') + '"', '# simulasi ini cuma punya audit device file');
            var fp = b.options && b.options.file_path;
            if (!fp) throw apiE(400, 'file_path is required');
            W.audits[dp] = { type: 'file', path: fp, accessor: 'file_' + K.hex(8), n: 0 };
          }
        };
      }
      if (method === 'DELETE') return { sudo: true, fn: function () { delete W.audits[dp]; } };
      throw unsupported();
    }
    if (rel === 'policies/acl' || rel === 'policy') {
      if (method !== 'LIST' && method !== 'GET') throw unsupported();
      return { op: 'list', fn: function () { return { data: { keys: Object.keys(W.policies).sort() } }; } };
    }
    if ((m = /^(?:policies\/acl|policy)\/(.+)$/.exec(rel))) {
      var pn = m[1];
      if (method === 'GET') return { fn: function () { var p = W.policies[pn]; if (!p) return { notFound: true }; return { data: { name: pn, policy: p.text } }; } };
      if (isWrite(method)) {
        return {
          exists: !!W.policies[pn], fn: function (b) {
            if (pn === 'root') throw apiE(400, 'cannot update "root" policy');
            var rules;
            try { rules = parsePolicy(String(b.policy || '')); } catch (pe) {
              if (pe && pe.msg) { var x = apiE(400, 'failed to parse policy: ' + pe.msg); x.pline = pe.pline; throw x; }
              throw pe;
            }
            W.policies[pn] = { text: String(b.policy || ''), rules: rules };
          }
        };
      }
      if (method === 'DELETE') return { fn: function () { if (pn === 'root' || pn === 'default') throw apiE(400, 'cannot delete "' + pn + '" policy'); delete W.policies[pn]; } };
      throw unsupported();
    }
    if (rel === 'leases/renew') return { op: 'update', fn: leaseRenew };
    if (rel === 'leases/revoke') return { op: 'update', fn: function (b) { var L = findLease(b.lease_id); endLease(L, 'dicabut'); } };
    if (rel === 'leases/lookup') return { op: 'update', fn: function (b) { var L = findLease(b.lease_id); return { data: leaseInfo(L) }; } };
    if ((m = /^leases\/revoke-prefix\/(.+)$/.exec(rel))) {
      return {
        op: 'update', sudo: true, fn: function () {
          var pre = m[1];
          W.leases.slice().forEach(function (L) { if (L.id.indexOf(pre) === 0) endLease(L, 'dicabut'); });
        }
      };
    }
    if ((m = /^leases\/lookup\/?(.*)$/.exec(rel))) {
      if (method !== 'LIST') throw unsupported();
      return {
        sudo: true, fn: function () {
          var pre = m[1] ? m[1].replace(/\/?$/, '/') : '';
          var keys = uniq(W.leases.filter(function (L) { return L.id.indexOf(pre) === 0; }).map(function (L) { var r = L.id.slice(pre.length); return r.indexOf('/') >= 0 ? r.split('/')[0] + '/' : r; })).sort();
          return keys.length ? { data: { keys: keys } } : { notFound: true };
        }
      };
    }
    if (rel === 'capabilities-self' || rel === 'capabilities') {
      return {
        op: 'update', fn: function (b, tok) {
          var t = rel === 'capabilities' ? W.tokens[b.token] : tok;
          if (!t) throw apiE(400, 'invalid token');
          var out = {};
          list(b.paths || b.path).forEach(function (p) { var c = capsFor(t, p.replace(/^\/+/, '')); out[p] = c.length ? c : ['deny']; });
          return { data: out };
        }
      };
    }
    if (rel === 'storage/raft/configuration') return { fn: function () { return { data: { config: { servers: [{ node_id: 'vault-1', address: HOST + ':8201', leader: true, voter: true }] } } }; } };
    throw notFoundRoute(full);
  }
  function doInit(b) {
    if (W.init) throw apiE(400, 'Vault is already initialized');
    var n = b.secret_shares === undefined ? 5 : +b.secret_shares, t = b.secret_threshold === undefined ? 3 : +b.secret_threshold;
    if (!(n >= 1) || !(t >= 1) || n !== Math.floor(n) || t !== Math.floor(t)) throw apiE(400, 'invalid seal configuration: share count must be a positive integer');
    if (n > 10) throw apiE(400, 'invalid seal configuration: share count must be at most 10 di simulasi ini');
    if (t > n) throw apiE(400, 'invalid seal configuration: threshold must not be greater than shares');
    if (n > 1 && t < 2) throw apiE(400, 'invalid seal configuration: threshold must be greater than one for multiple shares');
    W.init = true;
    W.shares = n;
    W.threshold = t;
    W.keys = [];
    for (var i = 0; i < n; i++) W.keys.push(rs(44, ALNUM + '+/'));
    var root = newToken({ policies: ['root'], display: 'root', path: 'auth/token/root', orphan: true });
    W.root = root.id;
    W.raftIdx += 40;
    M.hit('init');
    K.flash(app, 'storage');
    return { data: { keys_base64: W.keys.slice(), root_token: root.id } };
  }
  function doUnseal(b) {
    W.dupKey = false;
    if (b.reset) { W.parts = []; return { data: sealStatus() }; }
    if (!W.sealed) return { data: sealStatus() };
    var k = String(b.key || '').trim();
    if (!k) throw apiE(400, '\'key\' must be specified in request body as JSON, or \'reset\' set to true');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(k)) throw apiE(400, '\'key\' must be a valid hex or base64 string', '# unseal key itu string base64 44 karakter dari output vault operator init');
    if (!W.parts.length) W.nonce = uuid();
    if (W.parts.indexOf(k) >= 0) { W.dupKey = true; return { data: sealStatus() }; }
    W.parts.push(k);
    if (W.parts.length >= W.threshold) {
      var good = W.parts.every(function (p) { return W.keys.indexOf(p) >= 0; });
      W.parts = [];
      if (!good) throw apiE(400, 'cipher: message authentication failed', '# ada key yang salah, jadi root key gagal disusun. Progress unseal di-reset; ulangi dengan key yang benar.');
      var gap = now() - W.sealedAt;
      W.leases.forEach(function (L) { L.expires += gap; L.maxAt += gap; });
      Object.keys(W.tokens).forEach(function (id) { var t = W.tokens[id]; if (t.expires) t.expires += gap; });
      W.sealed = false;
      W.activeSince = now();
      K.flash(app, 'vault');
      K.pulse(app, 'barrier');
      M.hit('unseal');
      if (W.sealedByOp) M.hit('seal');
    }
    return { data: sealStatus() };
  }
  function doSeal() {
    W.sealed = true;
    W.sealedAt = now();
    W.parts = [];
    W.sealedByOp = true;
    K.flash(app, 'vault', 'warn');
  }
  var SUPPORTED = { kv: 1, transit: 1, database: 1 };
  var KNOWN = ['pki', 'ssh', 'aws', 'gcp', 'azure', 'totp', 'consul', 'nomad', 'rabbitmq', 'ldap', 'kmip', 'kubernetes', 'terraform', 'mongodbatlas', 'openldap'];
  function enableMount(mp, b) {
    var type = b.type;
    if (W.mounts[mp]) throw apiE(400, 'path is already in use at ' + mp);
    var clash = longest(W.mounts, mp.slice(0, -1));
    if (clash || Object.keys(W.mounts).some(function (k) { return k.indexOf(mp) === 0; })) throw apiE(400, 'path is already in use at ' + (clash || mp));
    if (/^(auth|sys|cubbyhole|identity)\//.test(mp)) throw apiE(400, 'cannot mount "' + mp + '" of type "' + type + '": reserved path');
    if (!SUPPORTED[type]) {
      if (KNOWN.indexOf(type) >= 0) throw apiE(400, 'plugin not found in the catalog: ' + type, '# ' + type + ' ada di Vault beneran, tapi belum ada di simulasi ini. Yang ada: kv, kv-v2, transit, database');
      throw apiE(400, 'plugin not found in the catalog: ' + type, '# simulasi ini punya secrets engine kv, kv-v2, transit, dan database');
    }
    var v = type === 'kv' ? (+((b.options || {}).version) === 2 ? 2 : 1) : 0;
    addMount(mp, type, b.description || '', v);
  }
  function disableMount(mp) {
    if (/^(sys|cubbyhole|identity)\/$/.test(mp)) throw apiE(400, 'cannot unmount "' + mp + '"');
    if (!W.mounts[mp]) return;
    W.leases.slice().forEach(function (L) { if (L.id.indexOf(mp) === 0) endLease(L, 'dicabut'); });
    delete W.mounts[mp];
  }
  function enableAuth(ap, b) {
    if (W.auths[ap]) throw apiE(400, 'path is already in use at auth/' + ap);
    if (b.type !== 'approle') {
      if (['userpass', 'kubernetes', 'oidc', 'jwt', 'ldap', 'github', 'aws', 'cert', 'gcp', 'azure'].indexOf(b.type) >= 0) throw apiE(400, 'plugin not found in the catalog: ' + b.type, '# ' + b.type + ' ada di Vault beneran, tapi simulasi ini baru punya auth method approle');
      throw apiE(400, 'plugin not found in the catalog: ' + b.type, '# simulasi ini baru punya auth method approle');
    }
    W.auths[ap] = { type: 'approle', accessor: 'auth_approle_' + K.hex(8), desc: b.description || '', roles: {} };
  }
  function findLease(id) {
    if (!id) throw apiE(400, 'lease_id must be specified');
    var L = W.leases.filter(function (x) { return x.id === id; })[0];
    if (!L) throw apiE(400, 'invalid lease', '# lease ini ga ada. Mungkin sudah habis atau sudah dicabut.');
    return L;
  }
  function leaseRenew(b) {
    var L = findLease(b.lease_id);
    var role = L.info && L.info.ttl || L.ttl;
    var inc = b.increment !== undefined ? parseDur(b.increment) : role;
    if (isNaN(inc)) throw apiE(400, 'invalid increment');
    var left = Math.floor((L.maxAt - now()) / 1000), warn = null;
    if (inc > left) { warn = 'TTL of "' + dur(inc) + '" exceeded the effective max_ttl of "' + dur(left) + '"; TTL value is capped accordingly'; inc = left; }
    L.ttl = Math.max(0, inc);
    L.expires = now() + L.ttl * 1000;
    L.renewed = now();
    return { lease: L, warnings: warn ? [warn] : null };
  }
  function leaseInfo(L) {
    return { expire_time: iso(L.expires), id: L.id, issue_time: iso(L.issued), last_renewal: L.renewed ? iso(L.renewed) : null, renewable: true, ttl: Math.max(0, Math.round((L.expires - now()) / 1000)) };
  }

  // ---------- auth/token/ ----------
  function tokenInfo(t) {
    return {
      accessor: t.accessor, creation_time: Math.floor(t.created / 1000), creation_ttl: t.ttl, display_name: t.display, entity_id: '',
      expire_time: t.expires ? iso(t.expires) : null, explicit_max_ttl: 0, id: t.id, issue_time: iso(t.created), meta: t.meta,
      num_uses: 0, orphan: t.orphan, path: t.path, policies: t.policies, renewable: t.renewable,
      ttl: t.expires ? Math.max(0, Math.round((t.expires - now()) / 1000)) : 0, type: 'service'
    };
  }
  function tokenRoute(method, rel) {
    if (rel === 'lookup-self') return { op: 'read', fn: function (b, tok) { return { data: tokenInfo(tok) }; } };
    if (rel === 'lookup') return { op: 'update', fn: function (b) { var t = W.tokens[b.token]; if (!t) throw apiE(403, 'bad token'); return { data: tokenInfo(t) }; } };
    if (rel === 'create' || rel === 'create-orphan') return { op: 'update', fn: function (b, tok) { return { auth: createToken(b, tok, rel === 'create-orphan') }; } };
    if (rel === 'revoke-self') return { op: 'update', fn: function (b, tok) { revokeToken(tok.id, 'dicabut'); } };
    if (rel === 'revoke') return { op: 'update', fn: function (b) { if (!b.token) throw apiE(400, 'missing token'); revokeToken(b.token, 'dicabut'); } };
    if (rel === 'renew-self') {
      return {
        op: 'update', fn: function (b, tok) {
          if (!tok.renewable) throw apiE(400, 'lease is not renewable');
          tok.expires = now() + tok.ttl * 1000;
          return { auth: tok };
        }
      };
    }
    throw notFoundRoute('auth/token/' + rel);
  }
  function createToken(b, parent, orphan) {
    var pol = list(b.policies);
    var root = isRoot(parent);
    if (!pol.length) pol = parent.policies.filter(function (p) { return p !== 'default'; });
    if (pol.indexOf('root') >= 0 && !root) throw apiE(400, 'root tokens may not be created without parent token being root');
    if (!root && pol.some(function (p) { return parent.policies.indexOf(p) < 0; })) throw apiE(400, 'child policies must be subset of parent');
    var ttl = b.ttl !== undefined ? parseDur(b.ttl) : null;
    if (isNaN(ttl)) throw apiE(400, 'error parsing ttl');
    var isR = pol.indexOf('root') >= 0;
    if (!isR) pol = uniq(pol.concat(['default'])).sort();
    var t = newToken({ policies: isR ? ['root'] : pol, ttl: isR && ttl === null ? 0 : ttl || SYS_TTL, display: b.display_name ? 'token-' + b.display_name : 'token', parent: orphan || b.no_parent ? null : parent.id, orphan: !!(orphan || b.no_parent) });
    W.last.token = t.id;
    return t;
  }

  // ---------- auth/approle/ ----------
  function approleRoute(am, method, rel) {
    var m;
    if (rel === 'login') return { op: 'update', fn: function (b) { return { auth: approleLogin(am, b) }; } };
    if (rel === 'role' && method === 'LIST') return { fn: function () { var k = Object.keys(am.roles).sort(); return k.length ? { data: { keys: k } } : { notFound: true }; } };
    if ((m = /^role\/([^/]+)$/.exec(rel))) {
      var rn = m[1];
      if (method === 'GET') return { fn: function () { var r = am.roles[rn]; if (!r) return { notFound: true }; return { data: roleData(r) }; } };
      if (isWrite(method)) {
        return {
          exists: !!am.roles[rn], fn: function (b) {
            var r = am.roles[rn] || { name: rn, roleId: uuid(), sids: [], policies: [], ttl: 0, maxTtl: 0, sidTtl: 0, sidUses: 0 };
            if (b.token_policies !== undefined || b.policies !== undefined) r.policies = list(b.token_policies !== undefined ? b.token_policies : b.policies);
            ['token_ttl:ttl', 'token_max_ttl:maxTtl', 'secret_id_ttl:sidTtl'].forEach(function (pair) {
              var k = pair.split(':');
              if (b[k[0]] !== undefined) { var d = parseDur(b[k[0]]); if (isNaN(d)) throw apiE(400, 'invalid ' + k[0]); r[k[1]] = d; }
            });
            if (b.secret_id_num_uses !== undefined) r.sidUses = +b.secret_id_num_uses || 0;
            if (b.role_id) r.roleId = String(b.role_id);
            am.roles[rn] = r;
          }
        };
      }
      if (method === 'DELETE') return { fn: function () { delete am.roles[rn]; } };
      throw unsupported();
    }
    if ((m = /^role\/([^/]+)\/role-id$/.exec(rel))) {
      return {
        fn: function () {
          var r = am.roles[m[1]];
          if (!r) throw apiE(400, 'role "' + m[1] + '" does not exist');
          W.last.roleId = r.roleId;
          return { data: { role_id: r.roleId } };
        }
      };
    }
    if ((m = /^role\/([^/]+)\/secret-id$/.exec(rel))) {
      if (method === 'LIST') return { fn: function () { var r = am.roles[m[1]]; if (!r || !r.sids.length) return { notFound: true }; return { data: { keys: r.sids.map(function (s) { return s.accessor; }) } }; } };
      return {
        op: 'update', fn: function () {
          var r = am.roles[m[1]];
          if (!r) throw apiE(400, 'role "' + m[1] + '" does not exist');
          var s = { id: uuid(), accessor: uuid(), created: now(), uses: r.sidUses, exp: r.sidTtl ? now() + r.sidTtl * 1000 : 0 };
          r.sids.push(s);
          W.last.secretId = s.id;
          return { data: { secret_id: s.id, secret_id_accessor: s.accessor, secret_id_num_uses: r.sidUses, secret_id_ttl: r.sidTtl } };
        }
      };
    }
    throw notFoundRoute('auth/approle/' + rel);
  }
  function roleData(r) {
    return { bind_secret_id: true, secret_id_num_uses: r.sidUses, secret_id_ttl: r.sidTtl, token_max_ttl: r.maxTtl, token_policies: r.policies, token_ttl: r.ttl, token_type: 'default' };
  }
  function approleLogin(am, b) {
    if (!b.role_id) throw apiE(400, 'missing role_id');
    var r = Object.keys(am.roles).map(function (k) { return am.roles[k]; }).filter(function (x) { return x.roleId === b.role_id; })[0];
    if (!r) throw apiE(400, 'invalid role or secret ID');
    if (!b.secret_id) throw apiE(400, 'missing secret_id');
    var s = r.sids.filter(function (x) { return x.id === b.secret_id; })[0];
    if (!s || (s.exp && s.exp < now())) throw apiE(400, 'invalid role or secret ID', s ? '# secret-id ini sudah kedaluwarsa. Minta yang baru.' : null);
    if (s.uses) { s.left = (s.left === undefined ? s.uses : s.left) - 1; if (s.left <= 0) r.sids.splice(r.sids.indexOf(s), 1); }
    var t = newToken({ policies: uniq(r.policies.concat(['default'])).sort(), ttl: r.ttl || SYS_TTL, display: 'approle', path: 'auth/approle/login', orphan: true, meta: { role_name: r.name } });
    W.last.appToken = t.id;
    M.hit('approle');
    return t;
  }

  // ---------- kv ----------
  function keysUnder(paths, prefix) {
    var pre = prefix ? prefix.replace(/\/?$/, '/') : '';
    return uniq(paths.filter(function (p) { return p.indexOf(pre) === 0; }).map(function (p) {
      var r = p.slice(pre.length);
      return r.indexOf('/') >= 0 ? r.split('/')[0] + '/' : r;
    })).sort();
  }
  function kv1Route(m, method, rel, cubby) {
    return {
      exists: method === 'GET' ? undefined : !!m.secrets[rel],
      fn: function (b, tok) {
        var key = cubby ? tok.id + '|' + rel : rel;
        if (method === 'LIST') {
          var all = Object.keys(m.secrets).filter(function (k) { return !cubby || k.indexOf(tok.id + '|') === 0; }).map(function (k) { return cubby ? k.slice(tok.id.length + 1) : k; });
          var ks = keysUnder(all, rel);
          return ks.length ? { data: { keys: ks } } : { notFound: true };
        }
        if (!rel) throw unsupported();
        if (method === 'GET') return m.secrets[key] ? { data: Object.assign({}, m.secrets[key]) } : { notFound: true };
        if (isWrite(method)) {
          if (!Object.keys(b).length) throw apiE(400, 'missing data fields');
          m.secrets[key] = Object.assign({}, b);
          return null;
        }
        if (method === 'DELETE') { delete m.secrets[key]; return null; }
        throw unsupported();
      }
    };
  }
  function kvMeta(v, n) { return { created_time: v.iso, custom_metadata: null, deletion_time: v.deleted ? isoNano(v.deleted) : '', destroyed: v.destroyed, version: n }; }
  function kvMetaPairs(md) { return [['created_time', md.created_time], ['custom_metadata', '<nil>'], ['deletion_time', md.deletion_time || 'n/a'], ['destroyed', String(md.destroyed)], ['version', md.version]]; }
  function versionsOf(b) { return list(b.versions).map(function (x) { return +x; }).filter(function (x) { return x > 0; }); }
  function kv2Route(m, mp, method, rel) {
    var mm = /^(data|metadata|delete|undelete|destroy)\/(.+)$/.exec(rel);
    if (rel === 'config') return { fn: function () { return { data: { cas_required: false, delete_version_after: '0s', max_versions: 0 } }; } };
    if ((rel === 'metadata' || rel === 'metadata/') && method === 'LIST') {
      return { fn: function () { var ks = keysUnder(Object.keys(m.secrets), ''); return ks.length ? { data: { keys: ks } } : { notFound: true }; } };
    }
    if (!mm) throw apiE(404, 'Invalid path for a versioned K/V secrets engine. See the API docs for the appropriate API endpoints to use. If using the Vault CLI, use \'vault kv ' + (method === 'GET' ? 'get' : 'put') + '\' for this operation.', '# di KV v2 pakai vault kv get/put, atau path API ' + mp + 'data/' + rel);
    var kind = mm[1], p = mm[2], s = m.secrets[p];
    if (kind === 'data') {
      if (method === 'GET') {
        return {
          fn: function (b) {
            if (!s) return { notFound: true };
            var n = b.version ? +b.version : s.cur;
            var v = s.versions[n - 1];
            if (!v) return { notFound: true };
            var r = { data: { data: v.deleted || v.destroyed ? null : Object.assign({}, v.data), metadata: kvMeta(v, n) }, mountType: 'kv' };
            if (!v.deleted && !v.destroyed) W.last.kvRead = mp + p;
            return r;
          }
        };
      }
      if (isWrite(method) || method === 'PATCH') {
        return {
          exists: !!s, fn: function (b) {
            var data = b.data || {};
            if (method === 'PATCH') {
              if (!s) return { notFound: true };
              var curv = s.versions[s.cur - 1];
              if (curv.deleted || curv.destroyed) throw apiE(404, 'no value found at ' + mp + 'data/' + p);
              data = Object.assign({}, curv.data, data);
            }
            if (!s) s = m.secrets[p] = { versions: [], cur: 0, created: now() };
            var v = { data: data, created: now(), deleted: 0, destroyed: false };
            v.iso = isoNano(v.created);
            s.versions.push(v);
            s.cur = s.versions.length;
            s.updated = now();
            K.flash(app, 'storage');
            return { data: kvMeta(v, s.cur) };
          }
        };
      }
      if (method === 'DELETE') return { fn: function () { if (s) { var v = s.versions[s.cur - 1]; if (!v.deleted) v.deleted = now(); } } };
      throw unsupported();
    }
    if (kind === 'metadata') {
      if (method === 'GET') {
        return {
          fn: function () {
            if (!s) return { notFound: true };
            var vers = {};
            s.versions.forEach(function (v, i) { vers[i + 1] = { created_time: v.iso, deletion_time: v.deleted ? isoNano(v.deleted) : '', destroyed: v.destroyed }; });
            var oldest = 0;
            return { data: { cas_required: false, created_time: s.versions[0].iso, current_version: s.cur, custom_metadata: null, delete_version_after: '0s', max_versions: 0, oldest_version: oldest, updated_time: s.versions[s.cur - 1].iso, versions: vers } };
          }
        };
      }
      if (method === 'LIST') return { fn: function () { var ks = keysUnder(Object.keys(m.secrets), p); return ks.length ? { data: { keys: ks } } : { notFound: true }; } };
      if (method === 'DELETE') return { fn: function () { delete m.secrets[p]; } };
      if (isWrite(method)) return { exists: !!s, fn: function () { return null; } };
      throw unsupported();
    }
    if (!isWrite(method)) throw unsupported();
    return {
      op: 'update', fn: function (b) {
        var vs = versionsOf(b);
        if (!vs.length) throw apiE(400, 'no version number provided');
        if (!s) return null;
        vs.forEach(function (n) {
          var v = s.versions[n - 1];
          if (!v) return;
          if (kind === 'delete' && !v.deleted) v.deleted = now();
          if (kind === 'undelete' && !v.destroyed) v.deleted = 0;
          if (kind === 'destroy') { v.destroyed = true; v.data = null; }
        });
        return null;
      }
    };
  }

  // ---------- transit ----------
  function newTKey() { return { latest: 1, minDec: 1, created: now(), versions: { 1: now() }, count: 0, del: false }; }
  function transitRoute(m, mp, method, rel) {
    var x;
    if (rel === 'keys' && method === 'LIST') return { fn: function () { var k = Object.keys(m.keys).sort(); return k.length ? { data: { keys: k } } : { notFound: true }; } };
    if ((x = /^keys\/([^/]+)$/.exec(rel))) {
      var kn = x[1], key = m.keys[kn];
      if (method === 'GET') {
        return {
          fn: function () {
            if (!key) return { notFound: true };
            var vers = {};
            Object.keys(key.versions).forEach(function (v) { vers[v] = Math.floor(key.versions[v] / 1000); });
            return { data: { name: kn, type: 'aes256-gcm96', latest_version: key.latest, min_decryption_version: key.minDec, min_encryption_version: 0, deletion_allowed: key.del, exportable: false, supports_encryption: true, supports_decryption: true, keys: vers } };
          }
        };
      }
      if (isWrite(method)) return { exists: !!key, fn: function () { if (!key) m.keys[kn] = newTKey(); } };
      if (method === 'DELETE') return { fn: function () { if (!key) return; if (!key.del) throw apiE(400, 'deletion is not allowed for this key', '# kunci transit ga bisa dihapus kecuali deletion_allowed=true. Ini sengaja: kunci hilang = data terenkripsi hilang.'); delete m.keys[kn]; } };
      throw unsupported();
    }
    if ((x = /^keys\/([^/]+)\/rotate$/.exec(rel))) {
      if (!isWrite(method)) throw unsupported();
      return {
        op: 'update', fn: function () {
          var k = m.keys[x[1]];
          if (!k) throw apiE(400, 'encryption key not found');
          k.latest++;
          k.versions[k.latest] = now();
          K.flash(app, 'vault');
        }
      };
    }
    if ((x = /^keys\/([^/]+)\/config$/.exec(rel))) {
      if (!isWrite(method)) throw unsupported();
      return {
        op: 'update', fn: function (b) {
          var k = m.keys[x[1]];
          if (!k) throw apiE(400, 'no existing key named ' + x[1] + ' could be found');
          if (b.deletion_allowed !== undefined) k.del = String(b.deletion_allowed) === 'true';
          if (b.min_decryption_version !== undefined) {
            var v = +b.min_decryption_version;
            if (!(v >= 1) || v > k.latest) throw apiE(400, 'cannot set min decryption version of ' + v + ', latest key version is ' + k.latest);
            k.minDec = v;
          }
        }
      };
    }
    if ((x = /^(encrypt|decrypt|rewrap)\/([^/]+)$/.exec(rel))) {
      if (!isWrite(method)) throw unsupported();
      var act = x[1], name = x[2];
      return {
        exists: act === 'encrypt' ? !!m.keys[name] : true,
        fn: function (b) {
          var k = m.keys[name];
          if (act === 'encrypt') {
            if (b.plaintext === undefined) throw apiE(400, 'missing plaintext to encrypt');
            var pt = String(b.plaintext);
            if (!isB64(pt)) throw apiE(400, 'failed to base64-decode plaintext', '# plaintext harus base64. Contoh: plaintext=$(echo -n "halo vault" | base64)');
            if (!k) k = m.keys[name] = newTKey();
            return { data: { ciphertext: makeCt(mp, name, k, pt), key_version: k.latest } };
          }
          if (!k) throw apiE(400, 'encryption key not found');
          var ct = String(b.ciphertext || '');
          if (!ct) throw apiE(400, 'missing ciphertext to decrypt');
          if (!/^vault:v\d+:/.test(ct)) throw apiE(400, 'invalid ciphertext: no prefix', '# ciphertext transit selalu diawali vault:v1:, vault:v2:, dan seterusnya');
          var c = W.ciphers[ct], ver = +/^vault:v(\d+):/.exec(ct)[1];
          if (ver < k.minDec) throw apiE(400, 'ciphertext or signature version is disallowed by policy (too old)');
          if (!c || c.mount !== mp || c.key !== name) throw apiE(400, 'cipher: message authentication failed', '# ciphertext ini bukan hasil enkripsi kunci ' + name + ', atau ada karakter yang berubah');
          if (act === 'decrypt') { M.hit('transit'); W.last.pt = c.pt; return { data: { plaintext: c.pt } }; }
          return { data: { ciphertext: makeCt(mp, name, k, c.pt), key_version: k.latest } };
        }
      };
    }
    throw notFoundRoute(mp + rel);
  }
  function makeCt(mp, name, k, pt) {
    var ct = 'vault:v' + k.latest + ':' + randB64(12 + atob(pt).length + 16);
    W.ciphers[ct] = { mount: mp, key: name, ver: k.latest, pt: pt };
    k.count++;
    W.last.ct = ct;
    return ct;
  }

  // ---------- database ----------
  function parseConn(url, b) {
    var m = /^postgres(?:ql)?:\/\/(?:([^:@/]+)(?::([^@/]*))?@)?([^:/?]+)(?::(\d+))?(?:\/([^?]*))?/.exec(url || '');
    if (!m) return null;
    var u = m[1] && m[1] !== '{{username}}' ? decodeURIComponent(m[1]) : b.username;
    var p = m[2] && m[2] !== '{{password}}' ? decodeURIComponent(m[2]) : b.password;
    return { user: u, pass: p, host: m[3], port: m[4] || '5432', db: m[5] || 'postgres' };
  }
  function dbRoute(m, mp, method, rel) {
    var x;
    if ((rel === 'config' || rel === 'roles') && method === 'LIST') {
      return { fn: function () { var k = Object.keys(rel === 'config' ? m.configs : m.roles).sort(); return k.length ? { data: { keys: k } } : { notFound: true }; } };
    }
    if ((x = /^config\/([^/]+)$/.exec(rel))) {
      var cn = x[1];
      if (method === 'GET') {
        return {
          fn: function () {
            var c = m.configs[cn];
            if (!c) return { notFound: true };
            return { data: { allowed_roles: c.roles, connection_details: { connection_url: c.url, username: c.user }, plugin_name: c.plugin, root_credentials_rotate_statements: [], verify_connection: true } };
          }
        };
      }
      if (isWrite(method)) {
        return {
          exists: !!m.configs[cn], fn: function (b) {
            if (!b.plugin_name) throw apiE(400, 'empty plugin name');
            if (b.plugin_name !== 'postgresql-database-plugin') throw apiE(400, 'error creating database object: invalid database version: no database plugin named "' + b.plugin_name + '" found', /mysql|mongo|redis|mssql|oracle/.test(b.plugin_name) ? '# di simulasi ini cuma ada PostgreSQL: plugin_name=postgresql-database-plugin' : '# nama plugin PostgreSQL: postgresql-database-plugin');
            var c = parseConn(b.connection_url, b);
            if (!c) throw apiE(400, 'error creating database object: error verifying connection: cannot parse connection_url', '# formatnya: postgresql://{{username}}:{{password}}@' + DB_HOST + ':5432/app');
            if (c.host !== DB_HOST || c.port !== '5432') throw apiE(400, 'error creating database object: error verifying connection: dial tcp ' + c.host + ':' + c.port + ': connect: connection refused', '# PostgreSQL di lab ini ada di ' + DB_HOST + ':5432 (lihat cat db-admin.txt)');
            if (c.user !== DB_ADMIN.user || c.pass !== DB_ADMIN.pass) throw apiE(400, 'error creating database object: error verifying connection: failed to connect to `host=' + DB_HOST + ' user=' + (c.user || '') + ' database=' + c.db + '`: failed SASL auth (FATAL: password authentication failed for user "' + (c.user || '') + '" (SQLSTATE 28P01))', '# user dan password admin ada di file db-admin.txt');
            if (c.db !== DB_ADMIN.db) throw apiE(400, 'error creating database object: error verifying connection: FATAL: database "' + c.db + '" does not exist (SQLSTATE 3D000)', '# nama database-nya app');
            m.configs[cn] = { plugin: b.plugin_name, url: b.connection_url, user: c.user, roles: list(b.allowed_roles) };
            K.pulse(app, 'creds');
            K.flash(app, 'db');
          }
        };
      }
      if (method === 'DELETE') return { fn: function () { delete m.configs[cn]; } };
      throw unsupported();
    }
    if ((x = /^roles\/([^/]+)$/.exec(rel))) {
      var rn = x[1];
      if (method === 'GET') {
        return {
          fn: function () {
            var r = m.roles[rn];
            if (!r) return { notFound: true };
            return { data: { creation_statements: [r.sql], credential_type: 'password', db_name: r.db, default_ttl: r.ttl, max_ttl: r.max, renew_statements: [], revocation_statements: [], rollback_statements: [] } };
          }
        };
      }
      if (isWrite(method)) {
        return {
          exists: !!m.roles[rn], fn: function (b) {
            if (!b.db_name) throw apiE(400, 'empty database name attribute');
            if (!b.creation_statements) throw apiE(400, 'creation_statements is required', '# isi creation_statements dengan SQL CREATE ROLE ... buat bikin user');
            var sql = String(b.creation_statements);
            if (!/\{\{\s*name\s*\}\}/.test(sql) || !/\{\{\s*password\s*\}\}/.test(sql)) throw apiE(400, 'creation_statements harus memakai {{name}} dan {{password}}');
            var ttl = parseDur(b.default_ttl), max = parseDur(b.max_ttl);
            if (isNaN(ttl) || isNaN(max)) throw apiE(400, 'invalid duration');
            if (ttl && max && ttl > max) throw apiE(400, 'ttl cannot be greater than max_ttl');
            var grant = /GRANT\s+([A-Z, ]+?)\s+ON/i.exec(sql);
            m.roles[rn] = { db: b.db_name, sql: sql, ttl: ttl || SYS_TTL, max: max || SYS_TTL, grant: grant ? grant[1].toUpperCase() : 'LOGIN' };
          }
        };
      }
      if (method === 'DELETE') return { fn: function () { delete m.roles[rn]; } };
      throw unsupported();
    }
    if ((x = /^creds\/([^/]+)$/.exec(rel))) {
      if (method !== 'GET') throw unsupported();
      return {
        fn: function (b, tok) {
          var r = m.roles[x[1]];
          if (!r) throw apiE(400, 'unknown role: ' + x[1]);
          var c = m.configs[r.db];
          if (!c) throw apiE(400, 'error getting database: database "' + r.db + '" is not configured');
          if (c.roles.indexOf('*') < 0 && c.roles.indexOf(x[1]) < 0) throw apiE(400, '"' + x[1] + '" is not an allowed role', '# tambahkan role ini ke allowed_roles di database/config/' + r.db);
          var user = ('v-' + tok.display + '-' + x[1].slice(0, 8) + '-' + rs(20) + '-' + Math.floor(now() / 1000)).slice(0, 63);
          var pw = 'A1a-' + rs(16);
          var L = newLease(mp + 'creds/' + x[1], Math.min(r.ttl, r.max), r.max, tok, { kind: 'db', user: user, ttl: r.ttl });
          W.dbUsers.push({ name: user, role: x[1], lease: L.id, created: now(), grant: r.grant });
          W.last.lease = L.id;
          K.pulse(app, 'creds');
          K.flash(app, 'db');
          return { lease: L, data: { username: user, password: pw } };
        }
      };
    }
    if ((x = /^rotate-root\/([^/]+)$/.exec(rel))) {
      return { op: 'update', fn: function () { if (!m.configs[x[1]]) throw apiE(400, 'no configuration found'); m.configs[x[1]].rotated = now(); } };
    }
    throw notFoundRoute(mp + rel);
  }

  // ---------- shell: expansion, pipes, env ----------
  function shellEnv() { return Object.assign({}, W.shell, W.env); }
  function expand(line) {
    var o = '', i = 0, q = null, envs = shellEnv();
    while (i < line.length) {
      var c = line[i];
      if (q === "'") { o += c; if (c === "'") q = null; i++; continue; }
      if (c === "'" && !q) { q = "'"; o += c; i++; continue; }
      if (c === '"') { q = q === '"' ? null : '"'; o += c; i++; continue; }
      if (c === '\\' && i + 1 < line.length) { o += c + line[i + 1]; i += 2; continue; }
      if (c === '$' && line[i + 1] === '(') {
        var d = 0, j = i + 1;
        for (; j < line.length; j++) { if (line[j] === '(') d++; else if (line[j] === ')') { d--; if (!d) break; } }
        if (j >= line.length) throw E('bash: unexpected EOF while looking for matching `)\'');
        var sub;
        try { sub = runLine(line.slice(i + 2, j), true) || ''; } catch (e) { report(e); sub = ''; }
        o += sub.replace(/\n+$/, '');
        i = j + 1;
        continue;
      }
      if (c === '$') {
        var m = /^\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))/.exec(line.slice(i));
        if (m) { var v = envs[m[1] || m[2]]; o += v === undefined ? '' : v; i += m[0].length; continue; }
      }
      o += c;
      i++;
    }
    return o;
  }
  function splitPipes(line) {
    var parts = [], cur = '', q = null, d = 0;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (q) { cur += c; if (c === q) q = null; else if (c === '\\' && q === '"' && i + 1 < line.length) cur += line[++i]; continue; }
      if (c === '"' || c === "'") { q = c; cur += c; continue; }
      if (c === '\\' && i + 1 < line.length) { cur += c + line[++i]; continue; }
      if (c === '$' && line[i + 1] === '(') { d++; cur += '$('; i++; continue; }
      if (c === '(' && d) { d++; cur += c; continue; }
      if (c === ')' && d) { d--; cur += c; continue; }
      if (c === '|' && !d) { parts.push(cur); cur = ''; continue; }
      cur += c;
    }
    parts.push(cur);
    return parts;
  }
  function runLine(line, capture) {
    var segs = splitPipes(line).map(function (s) { return s.trim(); });
    if (segs.length > 1 && segs.some(function (s) { return !s; })) throw E('bash: syntax error near unexpected token `|\'');
    var input = null;
    for (var i = 0; i < segs.length; i++) input = runOne(segs[i], input, i < segs.length - 1 || capture);
    return input;
  }
  function runOne(seg, stdin, cap) {
    var prev = CAP, buf = cap ? [] : null;
    CAP = buf;
    try { exec(seg, stdin); } finally { CAP = prev; }
    return buf ? buf.join('') : null;
  }
  function exec(seg, stdin) {
    var w = words(expand(seg)), tmp = {}, any = false;
    while (w.length && /^[A-Za-z_]\w*=/.test(w[0])) {
      var i = w[0].indexOf('=');
      tmp[w[0].slice(0, i)] = w[0].slice(i + 1);
      w.shift();
      any = true;
    }
    if (!w.length) {
      Object.keys(tmp).forEach(function (k) { W.shell[k] = tmp[k]; if (W.env[k] !== undefined) W.env[k] = tmp[k]; });
      if ((tmp.VAULT_ADDR !== undefined && W.env.VAULT_ADDR === undefined) || (tmp.VAULT_TOKEN !== undefined && W.env.VAULT_TOKEN === undefined)) {
        hint('# ini cuma variabel shell, belum kelihatan oleh perintah vault. Pakai export, misal: export ' + (tmp.VAULT_ADDR !== undefined ? 'VAULT_ADDR' : 'VAULT_TOKEN'));
      }
      return;
    }
    var prev = W.tmp;
    W.tmp = any ? tmp : null;
    try { laptop(w, stdin); } finally { W.tmp = prev; }
  }

  // ---------- laptop commands ----------
  var FILES = {
    'db-admin.txt': '# akun admin PostgreSQL yang dipakai Vault buat bikin user (khusus lab)\nhost: ' + DB_HOST + ':5432\ndatabase: app\nuser: vault\npassword: vault-pass'
  };
  function fileName(f) { return String(f || '').replace(/^(\.\/|~\/|\/home\/kamu\/)/, ''); }
  function readFile(f) {
    var n = fileName(f);
    if (n === 'app-read.hcl') return ed.get();
    if (n === '.vault-token' && W.fileToken) return W.fileToken;
    if (FILES[n] !== undefined) return FILES[n];
    return null;
  }
  function laptop(w, stdin) {
    var c = w[0];
    if (c === 'vault') { vault(w.slice(1)); return; }
    if (c === 'clear') { term.clear(); return; }
    if (c === 'help') { help(); return; }
    if (c === 'export') { doExport(w.slice(1)); return; }
    if (c === 'unset') { w.slice(1).forEach(function (k) { delete W.env[k]; delete W.shell[k]; }); return; }
    if (c === 'env' || c === 'printenv') {
      var e = W.env;
      if (w[1]) { if (e[w[1]] !== undefined) out(e[w[1]]); return; }
      Object.keys(e).sort().forEach(function (k) { out(k + '=' + e[k]); });
      return;
    }
    if (c === 'echo') {
      var a = w.slice(1), nl = true;
      while (a[0] === '-n' || a[0] === '-e' || a[0] === '-ne' || a[0] === '-en') { if (a[0].indexOf('n') >= 0) nl = false; a.shift(); }
      emitRaw(a.join(' ') + (nl ? '\n' : ''));
      return;
    }
    if (c === 'base64') {
      var dec = w.indexOf('-d') > 0 || w.indexOf('--decode') > 0 || w.indexOf('-D') > 0;
      var src = stdin;
      var f = w.slice(1).filter(function (x) { return x[0] !== '-'; })[0];
      if (src === null && f) { src = readFile(f); if (src === null) throw E('base64: ' + f + ': No such file or directory'); }
      if (src === null) { dim('# base64 butuh input dari pipe, misal: echo -n "halo" | base64'); return; }
      if (dec) {
        var r = unb64(src.trim());
        if (r === null) throw E('base64: invalid input');
        emitRaw(r);
      } else emit(b64(src));
      return;
    }
    if (c === 'jq') { jq(w.slice(1), stdin); return; }
    if (c === 'grep') {
      if (stdin === null) { dim('# grep di sini cuma buat dipakai lewat pipe, misal: vault secrets list | grep kv'); return; }
      var pat = w.slice(1).filter(function (x) { return x[0] !== '-'; })[0] || '';
      var iflag = w.indexOf('-i') > 0;
      stdin.split('\n').forEach(function (l) { if (l && (iflag ? l.toLowerCase().indexOf(pat.toLowerCase()) : l.indexOf(pat)) >= 0) emit(l); });
      return;
    }
    if (c === 'cat') {
      if (!w[1]) { if (stdin !== null) emitRaw(stdin); return; }
      w.slice(1).forEach(function (f) {
        var t = readFile(f);
        if (t === null) err('cat: ' + f + ': No such file or directory');
        else emitRaw(t.replace(/\n?$/, '\n'));
      });
      return;
    }
    if (c === 'ls') {
      var all = w.some(function (x) { return /^-\w*a/.test(x); });
      var names = ['app-read.hcl', 'db-admin.txt'];
      if (all) names = ['.', '..', '.bashrc'].concat(W.fileToken ? ['.vault-token'] : []).concat(names);
      out(names.join('  '));
      return;
    }
    if (c === 'nano' || c === 'vim' || c === 'vi' || c === 'code') {
      if (fileName(w[1]) === 'app-read.hcl') { W.tab = 'akses'; render(); setTimeout(function () { ed.ta.focus(); }, 50); dim('# file app-read.hcl dibuka di panel akses. Edit di sana, lalu jalankan vault policy write.'); }
      else dim('# di simulasi ini yang bisa diedit cuma app-read.hcl (di panel akses)');
      return;
    }
    if (c === 'whoami') { out('kamu'); return; }
    if (c === 'hostname') { out('laptop'); return; }
    if (c === 'pwd') { out('/home/kamu'); return; }
    if (c === 'cd') { dim('# simulasi ini cuma punya satu folder: /home/kamu'); return; }
    if (c === 'which') { if (w[1] === 'vault') out('/usr/local/bin/vault'); else if (w[1]) err(w[1] + ' not found'); return; }
    if (c === 'curl') { curl(w.slice(1)); return; }
    if (c === 'history') { term.hist.forEach(function (h, i) { out(pad(String(i + 1), 5) + h); }); return; }
    if (c === 'sudo') { dim('# ga perlu sudo buat vault CLI'); return; }
    if (c === 'psql') { dim('# psql ga ada di laptop ini. User yang dibuat Vault kelihatan di tab lease, bagian PostgreSQL.'); return; }
    if (c === 'exit' || c === 'logout') { dim('# ini terminal laptop kamu. Ga ada yang perlu di-exit.'); return; }
    throw E('bash: ' + c + ': command not found');
  }
  function doExport(a) {
    if (!a.length) { Object.keys(W.env).sort().forEach(function (k) { out('declare -x ' + k + '="' + W.env[k] + '"'); }); return; }
    a.forEach(function (x) {
      var i = x.indexOf('=');
      if (i < 0) { if (W.shell[x] !== undefined) W.env[x] = W.shell[x]; return; }
      var k = x.slice(0, i), v = x.slice(i + 1);
      W.env[k] = v;
      W.shell[k] = v;
      if (k === 'VAULT_ADDR' && v.replace(/\/+$/, '') !== ADDR_OK) hint('# server Vault di lab ini ada di ' + ADDR_OK);
      if (k === 'VAULT_ADDR' && v.replace(/\/+$/, '') === ADDR_OK) W.env[k] = ADDR_OK;
    });
  }
  function jq(a, stdin) {
    if (stdin === null) { dim('# jq dipakai lewat pipe, misal: vault kv get -format=json secret/app/db | jq -r .data.data.password'); return; }
    var raw = a.indexOf('-r') >= 0, f = a.filter(function (x) { return x[0] !== '-'; })[0] || '.';
    var v;
    try { v = JSON.parse(stdin); } catch (e) { throw E('jq: error (at <stdin>:1): Cannot parse input as JSON. Pakai -format=json di perintah vault.'); }
    if (!/^\.([\w-]+(\.[\w-]+)*)?$/.test(f) && f !== '.') throw E('jq: simulasi ini cuma paham filter sederhana seperti .data.data.password');
    f.slice(1).split('.').filter(Boolean).forEach(function (k) { v = v === null || v === undefined ? null : v[k]; });
    if (v === undefined) v = null;
    if (raw && typeof v === 'string') emit(v);
    else emit(JSON.stringify(v, null, 2));
  }
  function curl(a) {
    var hdr = {}, url = null, method = 'GET';
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (x === '-H' || x === '--header') { var h = a[++i] || '', j = h.indexOf(':'); if (j > 0) hdr[h.slice(0, j).trim().toLowerCase()] = h.slice(j + 1).trim(); }
      else if (x === '-X' || x === '--request') method = (a[++i] || 'GET').toUpperCase();
      else if (x === '-d' || x === '--data') { i++; }
      else if (x[0] !== '-') url = x;
    }
    if (!url) { err('curl: try \'curl --help\' for more information'); return; }
    var m = /^(https?:\/\/[^/]+)\/v1\/(.+)$/.exec(url);
    if (!m) { err('curl: (7) Failed to connect to ' + url.replace(/^\w+:\/\//, '').split('/')[0] + ': Connection refused'); return; }
    if (method !== 'GET' && method !== 'LIST') { dim('# di simulasi ini curl cuma buat GET. Buat menulis, pakai vault write.'); return; }
    var prevTmp = W.tmp;
    W.tmp = Object.assign({}, W.tmp || {}, { VAULT_ADDR: m[1] });
    try {
      var r = api(method, m[2].replace(/\?.*$/, ''), versionQ(m[2]), { token: hdr['x-vault-token'] || '' });
      if (r.notFound) { emit('{"errors":[]}'); return; }
      emit(JSON.stringify(/^sys\/(health|seal-status)$/.test(m[2]) ? r.data : respJSON(r)));
    } catch (e) {
      if (e && e.net) { err('curl: (7) Failed to connect to ' + m[1].replace(/^\w+:\/\//, '') + ': Connection refused'); return; }
      if (e && e.api) { emit(JSON.stringify({ errors: e.msgs })); if (e.code === 403 && !hdr['x-vault-token']) hint('# curl ga otomatis pakai VAULT_TOKEN. Tambahkan -H "X-Vault-Token: $VAULT_TOKEN"'); else if (e.hint) hint(e.hint); return; }
      throw e;
    } finally { W.tmp = prevTmp; }
  }
  function versionQ(p) { var m = /[?&]version=(\d+)/.exec(p); return m ? { version: +m[1] } : {}; }
  function help() {
    term.lines([
      '<b>Perintah yang bisa dicoba</b> (ketik atau klik tombol di bawah):',
      '  export VAULT_ADDR=' + ADDR_OK + '   vault status   vault operator init | unseal | seal',
      '  vault login [token]   vault token lookup | create -policy=... | revoke | capabilities PATH',
      '  vault secrets enable [-path=..] kv-v2 | transit | database   vault secrets list',
      '  vault kv put | get [-version=N] [-field=x] | list | delete | undelete | destroy | rollback | metadata get',
      '  vault policy write NAMA app-read.hcl | read | list | delete',
      '  vault auth enable approle   vault read | write | list | delete PATH   vault lease renew | revoke | lookup',
      '  vault audit enable file file_path=/var/log/vault_audit.log   vault operator raft list-peers',
      '  ls  cat FILE  echo  env  unset  base64 [-d]  jq -r .a.b  grep  curl -H "X-Vault-Token: ..." URL',
      '<span class="sx-dim">  bisa juga: VAULT_TOKEN=hvs... vault kv get ...,  $(echo -n "teks" | base64),  ... | base64 -d</span>'
    ]);
  }

  // ---------- vault CLI ----------
  var BOOL = { f: 1, force: 1, prefix: 1, self: 1, orphan: 1, detailed: 1, reset: 1, h: 1, help: 1, 'non-interactive': 1, status: 1, 'no-print': 1, 'no-store': 1, sync: 1 };
  function parse(a) {
    var pos = [], o = {};
    for (var i = 0; i < a.length; i++) {
      var t = a[i];
      if (/^-{1,2}[a-z]/i.test(t)) {
        var k = t.replace(/^-+/, ''), v, eq = k.indexOf('=');
        if (eq > 0) { v = k.slice(eq + 1); k = k.slice(0, eq); }
        else if (BOOL[k] || i + 1 >= a.length || /^-/.test(a[i + 1]) || /=/.test(a[i + 1])) v = true;
        else v = a[++i];
        (o[k] = o[k] || []).push(v);
      } else pos.push(t);
    }
    return {
      pos: pos,
      get: function (k) { return o[k] ? o[k][o[k].length - 1] : undefined; },
      all: function (k) { return (o[k] || []).reduce(function (acc, v) { return acc.concat(list(v)); }, []); },
      has: function (k) { return !!o[k]; }
    };
  }
  function kvArgs(arr) {
    var d = {};
    arr.forEach(function (x) {
      var i = x.indexOf('=');
      if (i <= 0) throw E('Failed to parse K=V data: invalid key/value pair "' + x + '": format must be key=value');
      var k = x.slice(0, i), v = x.slice(i + 1);
      if (v[0] === '@') { var f = readFile(v.slice(1)); if (f === null) throw E('Failed to parse K=V data: error reading file: open ' + v.slice(1) + ': no such file or directory'); v = f; }
      if (d[k] !== undefined) d[k] = [].concat(d[k], v); else d[k] = v;
    });
    return d;
  }
  function fmtApi(e) {
    var addr = (vEnv().VAULT_ADDR || '').replace(/\/+$/, '');
    var l = ['Error making API request.', '', 'URL: ' + (e.method === 'LIST' ? 'GET' : e.method) + ' ' + addr + '/v1/' + e.path + (e.method === 'LIST' ? '?list=true' : ''), 'Code: ' + e.code + '. Errors:', ''];
    if (e.msgs.length === 1 && /^permission denied$/.test(e.msgs[0])) l.push('* 1 error occurred:', '    * permission denied', '');
    else e.msgs.forEach(function (m) { l.push('* ' + m); });
    return l.join('\n').replace(/\n+$/, '');
  }
  function call(prefix, method, path, body, o) {
    try { return api(method, path, body, o); } catch (e) {
      if (e && e.net) throw E(prefix + e.msg, e.hint);
      if (e && e.api) { var x = E(prefix + fmtApi(e), e.hint); x.pline = e.pline; throw x; }
      throw e;
    }
  }
  function need(P, i, n) {
    var got = P.pos.length - i;
    if (got < n) throw E('Not enough arguments (expected ' + n + ', got ' + Math.max(0, got) + ')');
  }
  function vault(a) {
    var P = parse(a), c = P.pos[0];
    if (!c && P.has('version')) c = 'version';
    if (!c || c === 'help') { usage(); return; }
    var fn = {
      status: cStatus, operator: cOperator, login: cLogin, token: cToken, secrets: cSecrets, auth: cAuth, policy: cPolicy,
      kv: cKv, read: cRead, write: cWrite, list: cList, delete: cDelete, lease: cLease, audit: cAudit,
      version: function () { out('Vault v' + VERSION + ' (simulasi), built ' + BUILD); }
    }[c];
    if (!fn) {
      if (['agent', 'server', 'ssh', 'pki', 'transit', 'plugin', 'namespace', 'monitor', 'debug', 'path-help', 'unwrap', 'print', 'events', 'proxy'].indexOf(c) >= 0) throw E('perintah "vault ' + c + '" ada di Vault beneran, tapi belum ada di simulasi ini.');
      throw E('Usage: vault <command> [args]\n\nvault: unknown command "' + c + '". Ketik help buat daftar perintah.');
    }
    fn(P);
  }
  function usage() {
    out('Usage: vault <command> [args]\n\nCommon commands:\n    read        Read data and retrieves secrets\n    write       Write data, configuration, and secrets\n    delete      Delete secrets and configuration\n    list        List data or secrets\n    login       Authenticate locally\n    server      Start a Vault server\n    status      Print seal and HA status\n    unwrap      Unwrap a wrapped secret\n\nOther commands:\n    audit       Interact with audit devices\n    auth        Interact with auth methods\n    kv          Interact with Vault\'s Key-Value storage\n    lease       Interact with leases\n    operator    Perform operator-specific tasks\n    policy      Interact with policies\n    secrets     Interact with secrets engines\n    token       Interact with tokens\n    version     Prints the Vault CLI version');
  }
  function statusPairs() {
    var p = [['Seal Type', 'shamir'], ['Initialized', String(W.init)], ['Sealed', String(W.sealed)], ['Total Shares', W.shares], ['Threshold', W.threshold]];
    if (W.sealed) p.push(['Unseal Progress', W.parts.length + '/' + W.threshold], ['Unseal Nonce', W.parts.length ? W.nonce : 'n/a']);
    p.push(['Version', VERSION], ['Build Date', BUILD], ['Storage Type', 'raft']);
    if (!W.sealed) p.push(['Cluster Name', W.clusterName], ['Cluster ID', W.clusterId]);
    p.push(['HA Enabled', 'true']);
    if (!W.sealed) p.push(['HA Cluster', 'https://' + HOST + ':8201'], ['HA Mode', 'active'], ['Active Since', isoNano(W.activeSince)], ['Raft Committed Index', W.raftIdx], ['Raft Applied Index', W.raftIdx]);
    return p;
  }
  function cStatus(P) {
    var r = call('Error checking seal status: ', 'GET', 'sys/seal-status');
    show(P, r.data, statusPairs());
    if (!W.init) hint('# Vault belum di-init. Lanjut: vault operator init');
    else if (W.sealed) hint('# Vault tersegel. Lanjut: vault operator unseal (butuh ' + W.threshold + ' key)');
  }
  function cOperator(P) {
    var s = P.pos[1];
    if (s === 'init') {
      if (P.has('status')) { out(W.init ? 'Vault is initialized' : 'Vault is not initialized'); return; }
      var body = {};
      if (P.get('key-shares') !== undefined) body.secret_shares = +P.get('key-shares');
      if (P.get('key-threshold') !== undefined) body.secret_threshold = +P.get('key-threshold');
      var r = call('Error initializing: ', 'PUT', 'sys/init', body);
      var keys = r.data.keys_base64, n = keys.length, t = W.threshold;
      var lines = keys.map(function (k, i) { return 'Unseal Key ' + (i + 1) + ': ' + k; });
      lines.push('', 'Initial Root Token: ' + r.data.root_token, '',
        'Vault initialized with ' + n + ' key shares and a key threshold of ' + t + '. Please securely',
        'distribute the key shares printed above. When the Vault is re-sealed,',
        'restarted, or stopped, you must supply at least ' + t + ' of these keys to unseal it',
        'before it can start servicing requests.', '',
        'Vault does not store the generated root key. Without at least ' + t + ' keys to',
        'reconstruct the root key, Vault will remain permanently sealed!', '',
        'It is possible to generate new unseal keys, provided you have a quorum of',
        'existing unseal keys shares. See "vault operator rekey" for more information.');
      block(lines.join('\n'));
      if (!CAP) hint('# Vault sudah di-init tapi masih tersegel. Lanjut: vault operator unseal');
      return;
    }
    if (s === 'unseal') {
      if (P.has('reset')) { var rr = call('Error resetting unseal process: ', 'PUT', 'sys/unseal', { reset: true }); show(P, rr.data, statusPairs()); return; }
      if (!P.pos[2]) {
        call('Error checking seal status: ', 'GET', 'sys/seal-status');
        if (!W.init) throw E('Error unsealing: Error making API request.\n\nURL: PUT ' + ADDR_OK + '/v1/sys/unseal\nCode: 400. Errors:\n\n* Vault is not initialized', '# init dulu: vault operator init');
        if (!W.sealed) { show(P, sealStatus(), statusPairs()); return; }
        setPending('unseal');
        return;
      }
      unsealWith(P.pos[2], P);
      return;
    }
    if (s === 'seal') {
      call('Error sealing: ', 'PUT', 'sys/seal');
      ok('Success! Vault is sealed.');
      if (!CAP) hint('# semua permintaan sekarang ditolak sampai Vault di-unseal lagi pakai ' + W.threshold + ' key.');
      return;
    }
    if (s === 'raft') {
      if (P.pos[2] !== 'list-peers') throw E('Usage: vault operator raft list-peers');
      var rp = call('Error reading the raft cluster configuration: ', 'GET', 'sys/storage/raft/configuration');
      if (P.get('format') === 'json') { emit(JSON.stringify(rp, null, 2)); return; }
      cols([['Node', 'Address', 'State', 'Voter'], ['vault-1', HOST + ':8201', 'leader', 'true']]);
      return;
    }
    if (s === 'rekey' || s === 'generate-root' || s === 'step-down' || s === 'migrate' || s === 'members' || s === 'key-status') throw E('vault operator ' + s + ' ada di Vault beneran, tapi belum ada di simulasi ini.');
    throw E('Usage: vault operator <subcommand>\n\n    init       Initializes a server\n    unseal     Unseals the Vault server\n    seal       Seals the Vault server\n    raft       Interact with Vault\'s raft storage backend');
  }
  function unsealWith(key, P) {
    var r = call('Error unsealing: ', 'PUT', 'sys/unseal', { key: key });
    show(P || parse([]), r.data, statusPairs());
    if (CAP) return;
    if (W.dupKey) hint('# key ini sudah dimasukkan. Vault mengabaikannya; pakai key yang lain.');
    else if (W.sealed) hint('# progress ' + W.parts.length + '/' + W.threshold + '. Masukkan key berikutnya.');
    else ok(curTok() ? '# Vault terbuka lagi. Token kamu masih berlaku.' : '# Vault terbuka! Sekarang login: vault login');
  }
  function setPending(kind) {
    W.pending = { kind: kind, label: kind === 'unseal' ? 'Unseal Key (will be hidden):' : 'Token (will be hidden):' };
    setText($('vt-ps'), W.pending.label);
    var inp = $('vt-in');
    inp.type = 'password';
    inp.placeholder = kind === 'unseal' ? 'tempel unseal key, atau klik key di tab status' : 'tempel token, misal root token dari hasil init';
    inp.focus();
  }
  function clearPending() {
    W.pending = null;
    setText($('vt-ps'), prompt());
    var inp = $('vt-in');
    inp.type = 'text';
    inp.placeholder = 'ketik perintah, misal vault status';
  }
  function pendingInput(v) {
    var p = W.pending;
    if (term.hist[term.hist.length - 1] === v) term.hist.pop();
    term.hi = term.hist.length;
    term.line('<span class="sx-dim">' + esc(p.label) + '</span>');
    clearPending();
    if (v === '^C') { term.line('^C'); return; }
    try {
      if (p.kind === 'unseal') unsealWith(v);
      else doLogin(v);
    } catch (e) { report(e); }
  }
  function cLogin(P) {
    var m = P.get('method');
    if (m && m !== 'token') {
      throw E('Unknown auth method: ' + m + '. Use "vault auth list" to see the complete list of auth methods.\nAdditionally, some auth methods are only available via the HTTP API.',
        m === 'approle' ? '# AppRole ga punya helper login di CLI. Pakai: vault write auth/approle/login role_id=... secret_id=...' : '# simulasi ini login pakai token, atau AppRole lewat vault write auth/approle/login');
    }
    var t = P.pos[1];
    if (t && /=/.test(t)) t = t.replace(/^token=/, '');
    if (!t) { call('Error authenticating: ', 'GET', 'sys/seal-status'); if (W.sealed) throw E('Error authenticating: Error making API request.\n\nCode: 503. Errors:\n\n* Vault is sealed', '# unseal dulu sebelum login'); setPending('login'); return; }
    doLogin(t);
  }
  function doLogin(t) {
    var r = call('Error authenticating: error looking up token: ', 'GET', 'auth/token/lookup-self', null, { token: t });
    var tok = W.tokens[r.data.id];
    W.fileToken = t;
    if (W.env.VAULT_TOKEN && W.env.VAULT_TOKEN !== t) hint('WARNING! The VAULT_TOKEN environment variable is set! The value of this\nvariable will take precedence; if this is unwanted please unset VAULT_TOKEN or\nupdate its value accordingly.');
    ok('Success! You are now authenticated. The token information displayed below\nis already stored in the token helper. You do NOT need to run "vault login"\nagain. Future Vault requests will automatically use this token.');
    out('');
    kvt(authPairs(tok));
    M.hit('login');
  }
  function cToken(P) {
    var s = P.pos[1];
    if (s === 'lookup') {
      var r = P.pos[2] ? call('Error looking up token: ', 'PUT', 'auth/token/lookup', { token: P.pos[2] }) : call('Error looking up token: ', 'GET', 'auth/token/lookup-self');
      var d = r.data;
      show(P, respJSON(r), [['accessor', d.accessor], ['creation_time', d.creation_time], ['creation_ttl', dur(d.creation_ttl)], ['display_name', d.display_name], ['entity_id', 'n/a'],
        ['expire_time', d.expire_time || '<nil>'], ['explicit_max_ttl', '0s'], ['id', d.id], ['issue_time', d.issue_time], ['meta', d.meta], ['num_uses', 0], ['orphan', String(d.orphan)],
        ['path', d.path], ['policies', d.policies], ['renewable', String(d.renewable)], ['ttl', dur(d.ttl)], ['type', 'service']]);
      if (!P.pos[2] && !CAP) M.hit('login');
      return;
    }
    if (s === 'create') {
      var body = {};
      var pol = P.all('policy');
      if (pol.length) body.policies = pol;
      if (P.get('ttl') !== undefined) body.ttl = P.get('ttl');
      if (P.get('display-name')) body.display_name = P.get('display-name');
      if (P.has('orphan')) body.no_parent = true;
      var rc = call('Error creating token: ', 'POST', 'auth/token/create', body);
      show(P, respJSON(rc), authPairs(rc.auth));
      return;
    }
    if (s === 'revoke') {
      if (P.has('self')) call('Error revoking token: ', 'PUT', 'auth/token/revoke-self');
      else { need(P, 2, 1); call('Error revoking token: ', 'PUT', 'auth/token/revoke', { token: P.pos[2] }); }
      ok('Success! Revoked token (if it existed)');
      return;
    }
    if (s === 'renew') {
      var rn = call('Error renewing token: ', 'PUT', 'auth/token/renew-self');
      show(P, respJSON(rn), authPairs(rn.auth));
      return;
    }
    if (s === 'capabilities') {
      need(P, 2, 1);
      var two = P.pos.length > 3, path = (two ? P.pos[3] : P.pos[2]).replace(/^\/+/, '');
      var rc2 = two ? call('Error listing capabilities: ', 'PUT', 'sys/capabilities', { token: P.pos[2], paths: [path] }) : call('Error listing capabilities: ', 'PUT', 'sys/capabilities-self', { paths: [path] });
      var caps = rc2.data[path] || ['deny'];
      out(caps.slice().sort().join(', '));
      var mt = /^([^/]+\/)(?!data\/|metadata\/)(.+)$/.exec(path);
      if (!CAP && mt && W.mounts[mt[1]] && W.mounts[mt[1]].type === 'kv' && W.mounts[mt[1]].version === 2) hint('# ingat: ini KV v2, jadi vault kv get ' + path + ' dicek di path ' + mt[1] + 'data/' + mt[2]);
      return;
    }
    throw E('Usage: vault token <subcommand>\n\n    capabilities    Print capabilities of a token on a path\n    create          Create a new token\n    lookup          Display information about a token\n    renew           Renew a token lease\n    revoke          Revoke a token and its children');
  }
  function cSecrets(P) {
    var s = P.pos[1];
    if (s === 'enable') {
      need(P, 2, 1);
      var type = P.pos[2], orig = type, ver = P.get('version');
      if (type === 'kv-v2') { type = 'kv'; ver = 2; }
      var path = String(P.get('path') || orig).replace(/^\/+|\/+$/g, '') + '/';
      var body = { type: type, description: P.get('description') || '' };
      if (type === 'kv') body.options = { version: String(ver || 1) };
      call('Error enabling: ', 'POST', 'sys/mounts/' + path.slice(0, -1), body);
      ok('Success! Enabled the ' + orig + ' secrets engine at: ' + path);
      if (!CAP && type === 'kv' && +(ver || 1) !== 2) hint('# ini KV versi 1 (tanpa riwayat versi). Buat versi 2: vault secrets enable -path=' + path.slice(0, -1) + ' kv-v2');
      return;
    }
    if (s === 'disable') {
      need(P, 2, 1);
      var dp = P.pos[2].replace(/^\/+|\/+$/g, '');
      call('Error disabling secrets engine at ' + dp + '/: ', 'DELETE', 'sys/mounts/' + dp);
      ok('Success! Disabled the secrets engine (if it existed) at: ' + dp + '/');
      return;
    }
    if (s === 'list') {
      var r = call('Error listing secrets engines: ', 'GET', 'sys/mounts');
      if (P.get('format') === 'json') { emit(JSON.stringify(r.data, null, 2)); return; }
      var det = P.has('detailed');
      var rows = [det ? ['Path', 'Type', 'Accessor', 'Options', 'Description'] : ['Path', 'Type', 'Accessor', 'Description']];
      Object.keys(r.data).sort().forEach(function (k) {
        var m = r.data[k];
        var d = m.desc || 'n/a';
        rows.push(det ? [k, m.type, m.accessor, m.type === 'kv' ? 'map[version:' + m.version + ']' : 'n/a', d] : [k, m.type, m.accessor, d]);
      });
      cols(rows);
      return;
    }
    if (s === 'tune' || s === 'move') throw E('vault secrets ' + s + ' belum ada di simulasi ini.');
    throw E('Usage: vault secrets <subcommand>\n\n    enable     Enable a secrets engine\n    disable    Disable a secrets engine\n    list       List enabled secrets engines');
  }
  function cAuth(P) {
    var s = P.pos[1];
    if (s === 'enable') {
      need(P, 2, 1);
      var type = P.pos[2], path = String(P.get('path') || type).replace(/^\/+|\/+$/g, '') + '/';
      call('Error enabling ' + type + ' auth: ', 'POST', 'sys/auth/' + path.slice(0, -1), { type: type, description: P.get('description') || '' });
      ok('Success! Enabled ' + type + ' auth method at: ' + path);
      return;
    }
    if (s === 'disable') {
      need(P, 2, 1);
      var dp = P.pos[2].replace(/^\/+|\/+$/g, '');
      call('Error disabling auth method at ' + dp + ': ', 'DELETE', 'sys/auth/' + dp);
      ok('Success! Disabled the auth method (if it existed) at: ' + dp + '/');
      return;
    }
    if (s === 'list') {
      var r = call('Error listing enabled authentications: ', 'GET', 'sys/auth');
      var rows = [['Path', 'Type', 'Accessor', 'Description', 'Version']];
      Object.keys(r.data).sort().forEach(function (k) { var a = r.data[k]; rows.push([k, a.type, a.accessor, a.desc || 'n/a', 'n/a']); });
      cols(rows);
      return;
    }
    throw E('Usage: vault auth <subcommand>\n\n    enable     Enables a new auth method\n    disable    Disables an auth method\n    list       Lists enabled auth methods');
  }
  function cAudit(P) {
    var s = P.pos[1];
    if (s === 'enable') {
      need(P, 2, 1);
      var type = P.pos[2], path = String(P.get('path') || type).replace(/^\/+|\/+$/g, '') + '/';
      var opts = kvArgs(P.pos.slice(3));
      call('Error enabling audit device: ', 'PUT', 'sys/audit/' + path.slice(0, -1), { type: type, options: opts });
      ok('Success! Enabled the ' + type + ' audit device at: ' + path);
      if (!CAP) hint('# mulai sekarang tiap permintaan dicatat ke ' + opts.file_path + ', dengan nilai sensitif di-hash (HMAC).');
      return;
    }
    if (s === 'list') {
      var r = call('Error listing audits: ', 'GET', 'sys/audit');
      var ks = Object.keys(r.data);
      if (!ks.length) { out('No audit devices are enabled.'); return; }
      var rows = [['Path', 'Type', 'Description']];
      ks.forEach(function (k) { rows.push([k, r.data[k].type, 'n/a']); });
      cols(rows);
      return;
    }
    if (s === 'disable') { need(P, 2, 1); var dp = P.pos[2].replace(/^\/+|\/+$/g, ''); call('Error disabling audit device: ', 'DELETE', 'sys/audit/' + dp); ok('Success! Disabled audit device (if it was enabled) at: ' + dp + '/'); return; }
    throw E('Usage: vault audit <subcommand>\n\n    enable     Enables an audit device\n    disable    Disables an audit device\n    list       Lists enabled audit devices');
  }
  function cPolicy(P) {
    var s = P.pos[1];
    if (s === 'list') {
      var r = call('Error listing policies: ', 'LIST', 'sys/policies/acl');
      r.data.keys.forEach(function (k) { out(k); });
      return;
    }
    if (s === 'read') {
      need(P, 2, 1);
      var rr = call('Error reading policy named ' + P.pos[2] + ': ', 'GET', 'sys/policies/acl/' + P.pos[2]);
      if (rr.notFound) throw E('No policy named: ' + P.pos[2]);
      if (P.pos[2] === 'root') { out('No policy named: root'); return; }
      emitRaw(rr.data.policy.replace(/\n?$/, '\n'));
      return;
    }
    if (s === 'write') {
      need(P, 2, 2);
      var name = P.pos[2], file = P.pos[3];
      var text = file === '-' ? null : readFile(file);
      if (text === null) throw E('Error opening policy file: open ' + file + ': no such file or directory', '# file policy yang ada: app-read.hcl (edit di tab akses)');
      ed.mark([]);
      try { call('Error uploading policy: ', 'PUT', 'sys/policies/acl/' + name, { policy: text }); } catch (e) {
        if (e.pline && fileName(file) === 'app-read.hcl') { ed.mark([e.pline]); W.tab = 'akses'; }
        throw e;
      }
      ok('Success! Uploaded policy: ' + name);
      if (!CAP && name === 'app-read' && !W.last.token) hint('# lanjut: bikin token dengan policy ini, vault token create -policy=app-read -ttl=1h');
      return;
    }
    if (s === 'delete') {
      need(P, 2, 1);
      call('Error deleting ' + P.pos[2] + ': ', 'DELETE', 'sys/policies/acl/' + P.pos[2]);
      ok('Success! Deleted policy: ' + P.pos[2]);
      return;
    }
    if (s === 'fmt') { need(P, 2, 1); var t = readFile(P.pos[2]); if (t === null) throw E('Error opening policy file: open ' + P.pos[2] + ': no such file or directory'); try { parsePolicy(t); } catch (pe) { throw E('Error parsing policy: ' + pe.msg); } ok('Success! Formatted policy: ' + P.pos[2]); return; }
    throw E('Usage: vault policy <subcommand>\n\n    delete    Deletes a policy by name\n    fmt       Formats a policy on disk\n    list      Lists the installed policies\n    read      Prints the contents of a policy\n    write     Uploads a named policy from a file');
  }
  // kv helpers find the mount first, like the real CLI's preflight call
  function kvTarget(P, i) {
    var raw = P.pos[i];
    if (P.get('mount')) raw = String(P.get('mount')).replace(/\/+$/, '') + '/' + (raw || '');
    if (!raw) throw E('Not enough arguments (expected 1, got 0)');
    raw = raw.replace(/^\/+/, '').replace(/\/+$/, '');
    var r = call('', 'GET', 'sys/internal/ui/mounts/' + raw);
    var mp = r.data.path, rel = raw.slice(mp.length);
    var v2 = r.data.type === 'kv' && r.data.options && r.data.options.version === '2';
    if (r.data.type !== 'kv') throw E('Error: ' + mp + ' bukan secrets engine KV (tipenya ' + r.data.type + '). Pakai vault read/write.');
    return { mp: mp, rel: rel, v2: v2, full: raw };
  }
  function kvHead(path, md) {
    block('== Secret Path ==\n' + path);
    out('');
    block('======= Metadata =======');
    kvt(kvMetaPairs(md));
  }
  function cKv(P) {
    var s = P.pos[1], t, r;
    if (s === 'metadata') {
      var sub = P.pos[2];
      t = kvTarget(P, 3);
      if (!t.v2) throw E('Metadata not supported on KV Version 1');
      var mpath = t.mp + 'metadata/' + t.rel;
      if (sub === 'get') {
        r = call('Error reading ' + mpath + ': ', 'GET', mpath);
        if (r.notFound) throw E('No value found at ' + mpath);
        if (P.get('format') === 'json') { emit(JSON.stringify(respJSON(r), null, 2)); return; }
        var d = r.data;
        block('== Metadata Path ==\n' + mpath);
        out('');
        block('========== Metadata ==========');
        kvt([['cas_required', 'false'], ['created_time', d.created_time], ['current_version', d.current_version], ['custom_metadata', '<nil>'], ['delete_version_after', '0s'], ['max_versions', 0], ['oldest_version', 0], ['updated_time', d.updated_time]]);
        Object.keys(d.versions).forEach(function (n) {
          var v = d.versions[n];
          out('');
          block('====== Version ' + n + ' ======');
          kvt([['created_time', v.created_time], ['deletion_time', v.deletion_time || 'n/a'], ['destroyed', String(v.destroyed)]]);
        });
        return;
      }
      if (sub === 'delete') { call('Error deleting ' + mpath + ': ', 'DELETE', mpath); ok('Success! Data deleted (if it existed) at: ' + mpath); return; }
      throw E('Usage: vault kv metadata <get|delete> PATH');
    }
    if (['put', 'get', 'list', 'delete', 'undelete', 'destroy', 'rollback', 'patch'].indexOf(s) < 0) {
      throw E('Usage: vault kv <subcommand> [options] [args]\n\n    delete      Deletes versions in the KV store\n    destroy     Permanently removes one or more versions in the KV store\n    get         Retrieves data from the KV store\n    list        List data or secrets\n    metadata    Interact with Vault\'s Key-Value storage\n    patch       Sets or updates data in the KV store without overwriting\n    put         Sets or updates data in the KV store\n    rollback    Rolls back to a previous version of data\n    undelete    Undeletes versions in the KV store');
    }
    t = kvTarget(P, 2);
    var data = t.v2 ? t.mp + 'data/' + t.rel : t.full;
    if (s === 'put' || s === 'patch') {
      var body = kvArgs(P.pos.slice(3));
      if (!Object.keys(body).length) throw E('Must supply data');
      if (!t.v2) {
        if (s === 'patch') throw E('K/V engine mount must be version 2 for patch support');
        call('Error writing data to ' + data + ': ', 'PUT', data, body);
        ok('Success! Data written to: ' + data);
        return;
      }
      r = call('Error writing data to ' + data + ': ', s === 'patch' ? 'PATCH' : 'PUT', data, { data: body });
      if (r.notFound) throw E('No value found at ' + data);
      if (P.get('format') === 'json') { emit(JSON.stringify(respJSON(r), null, 2)); return; }
      kvHead(data, r.data);
      return;
    }
    if (s === 'get') {
      var q = {};
      if (P.get('version') !== undefined) {
        if (!t.v2) throw E('Metadata not supported on KV Version 1', '# -version cuma ada di KV v2');
        q.version = +P.get('version');
      }
      r = call('Error reading ' + data + ': ', 'GET', data, q);
      if (r.notFound) throw E('No value found at ' + data);
      var vals = t.v2 ? r.data.data : r.data;
      var pairs = vals ? Object.keys(vals).sort().map(function (k) { return [k, vals[k]]; }) : [];
      if (P.get('field')) { if (!vals) throw E('No value found at ' + data); show(P, null, pairs); }
      else if (P.get('format') === 'json') emit(JSON.stringify(respJSON(r), null, 2));
      else if (t.v2) {
        kvHead(data, r.data.metadata);
        if (vals) { out(''); block('====== Data ======'); kvt(pairs); }
      } else kvt(pairs);
      if (vals && !CAP) {
        if (t.v2) M.hit('kv');
        var s2 = W.mounts[t.mp].secrets[t.rel];
        if (t.v2 && q.version && s2 && q.version < s2.cur) M.hit('versi');
      } else if (vals && t.v2) M.hit('kv');
      if (!vals && !CAP) hint(r.data.metadata.destroyed ? '# versi ini sudah di-destroy. Datanya hilang permanen.' : '# versi ini sudah di-delete (soft delete). Balikin: vault kv undelete -versions=' + r.data.metadata.version + ' ' + t.full);
      return;
    }
    if (s === 'list') {
      var lp = t.v2 ? t.mp + 'metadata/' + t.rel : t.full;
      r = call('Error listing ' + lp + ': ', 'LIST', lp);
      if (r.notFound) throw E('No value found at ' + lp.replace(/\/?$/, '/'));
      block('Keys\n----\n' + r.data.keys.join('\n'));
      return;
    }
    if (s === 'delete') {
      if (t.v2 && P.get('versions')) {
        call('Error writing data to ' + t.mp + 'delete/' + t.rel + ': ', 'PUT', t.mp + 'delete/' + t.rel, { versions: P.get('versions') });
        ok('Success! Data deleted (if it existed) at: ' + data);
      } else {
        call('Error deleting ' + data + ': ', 'DELETE', data);
        ok('Success! Data deleted (if it existed) at: ' + data);
      }
      return;
    }
    if (s === 'undelete' || s === 'destroy') {
      if (!t.v2) throw E('Metadata not supported on KV Version 1');
      if (!P.get('versions')) throw E('No versions provided, use the "-versions" flag to specify the version to ' + s + '.');
      var up = t.mp + s + '/' + t.rel;
      call('Error writing data to ' + up + ': ', 'PUT', up, { versions: P.get('versions') });
      ok('Success! Data written to: ' + up);
      return;
    }
    if (s === 'rollback') {
      if (!t.v2) throw E('Metadata not supported on KV Version 1');
      var ver = +P.get('version');
      if (!ver) throw E('Must specify a version to rollback to');
      var old = call('Error reading ' + data + ': ', 'GET', data, { version: ver });
      if (old.notFound) throw E('No value found at ' + data);
      if (!old.data.data) throw E('Cannot roll back to a version that has been deleted or destroyed');
      r = call('Error writing data to ' + data + ': ', 'PUT', data, { data: old.data.data });
      kvt([['created_time', r.data.created_time], ['custom_metadata', '<nil>'], ['deletion_time', 'n/a'], ['destroyed', 'false'], ['version', r.data.version]]);
      if (!CAP) M.hit('versi');
    }
  }
  function cRead(P) {
    need(P, 1, 1);
    var path = P.pos[1].replace(/^\/+/, '');
    var body = kvArgs(P.pos.slice(2));
    var r = call('Error reading ' + path + ': ', 'GET', path, body);
    if (r.notFound) throw E('No value found at ' + path);
    printResp(P, r);
  }
  function printResp(P, r) {
    if (r.auth) { show(P, respJSON(r), authPairs(r.auth)); return; }
    var pairs = [];
    if (r.lease) pairs = leasePairs(r.lease);
    var d = r.data || {};
    Object.keys(d).sort().forEach(function (k) { pairs.push([k, d[k]]); });
    show(P, respJSON(r), pairs);
    if (r.warnings && !CAP) r.warnings.forEach(function (x) { hint('WARNING! The following warnings were returned from Vault:\n\n  * ' + x); });
  }
  function cWrite(P) {
    need(P, 1, 1);
    var path = P.pos[1].replace(/^\/+/, '');
    var body = kvArgs(P.pos.slice(2));
    if (!Object.keys(body).length && !P.has('f') && !P.has('force')) throw E('Must supply data or use -force');
    var r = call('Error writing data to ' + path + ': ', 'PUT', path, body);
    if (r.notFound) throw E('No value found at ' + path);
    if (!r.data && !r.auth && !r.lease) { ok('Success! Data written to: ' + path); return; }
    printResp(P, r);
  }
  function cList(P) {
    need(P, 1, 1);
    var path = P.pos[1].replace(/^\/+/, '').replace(/\/+$/, '');
    var r = call('Error listing ' + path + '/: ', 'LIST', path);
    if (r.notFound) throw E('No value found at ' + path + '/');
    if (P.get('format') === 'json') { emit(JSON.stringify(r.data.keys, null, 2)); return; }
    block('Keys\n----\n' + r.data.keys.join('\n'));
  }
  function cDelete(P) {
    need(P, 1, 1);
    var path = P.pos[1].replace(/^\/+/, '');
    call('Error deleting ' + path + ': ', 'DELETE', path);
    ok('Success! Data deleted (if it existed) at: ' + path);
  }
  function cLease(P) {
    var s = P.pos[1];
    if (s === 'revoke') {
      need(P, 2, 1);
      if (P.has('prefix')) call('Error revoking leases with prefix ' + P.pos[2] + ': ', 'PUT', 'sys/leases/revoke-prefix/' + P.pos[2].replace(/^\/+/, ''));
      else call('Error revoking lease ' + P.pos[2] + ': ', 'PUT', 'sys/leases/revoke', { lease_id: P.pos[2] });
      ok('All revocation operations queued successfully!');
      return;
    }
    if (s === 'renew') {
      need(P, 2, 1);
      var body = { lease_id: P.pos[2] };
      if (P.get('increment') !== undefined) body.increment = P.get('increment');
      var r = call('Error renewing ' + P.pos[2] + ': ', 'PUT', 'sys/leases/renew', body);
      show(P, respJSON(r), leasePairs(r.lease));
      if (r.warnings && !CAP) r.warnings.forEach(function (x) { hint('WARNING! The following warnings were returned from Vault:\n\n  * ' + x); });
      return;
    }
    if (s === 'lookup') {
      need(P, 2, 1);
      var rl = call('error looking up lease id ' + P.pos[2] + ': ', 'PUT', 'sys/leases/lookup', { lease_id: P.pos[2] });
      var d = rl.data;
      show(P, rl, [['expire_time', d.expire_time], ['id', d.id], ['issue_time', d.issue_time], ['last_renewal', d.last_renewal || '<nil>'], ['renewable', 'true'], ['ttl', dur(d.ttl)]]);
      return;
    }
    throw E('Usage: vault lease <subcommand>\n\n    lookup    Lookup the lease of a secret\n    renew     Renews the lease of a secret\n    revoke    Revokes leases and secrets');
  }

  // ---------- run loop ----------
  function report(e) {
    if (e && e.cli) { err(e.message); if (e.hint) hint(e.hint); }
    else if (e && (e.api || e.net)) { err(e.msg || fmtApi(e)); if (e.hint) hint(e.hint); }
    else { err('simulasi error: ' + (e && e.message || e)); if (window.console) console.error(e); }
  }
  function onCmd(line) {
    if (W.pending) { pendingInput(line); tick(); return; }
    term.echo(prompt(), line);
    if (!line) return;
    try { runLine(line, false); } catch (e) { report(e); }
    tick();
  }
  function tick() {
    if (!W.sealed) {
      var t = now();
      W.leases.slice().forEach(function (L) { if (L.expires <= t) endLease(L, 'kedaluwarsa'); });
      Object.keys(W.tokens).forEach(function (id) { var k = W.tokens[id]; if (k && k.expires && k.expires <= t) revokeToken(id, 'kedaluwarsa'); });
    }
    W.dbUsers = W.dbUsers.filter(function (u) { return !u.gone || now() - u.gone < 6000; });
    render();
  }

  // ---------- render ----------
  function cmdBtn(cmd, label, cls) { return '<button type="button" data-act="cmd" data-cmd="' + esc(cmd) + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(label || shortCmd(cmd)) + '</button>'; }
  function shortCmd(c) {
    return c.replace(/hvs\.[A-Za-z0-9]{24}/g, function (m) { return m.slice(0, 8) + '…'; })
      .replace(/(^|[\s=])[A-Za-z0-9+/]{44}(?=\s|$)/g, function (m, p) { return p + m.slice(p.length, p.length + 6) + '…'; })
      .replace(/vault:v\d+:[A-Za-z0-9+/=]+/g, function (m) { return m.slice(0, 12) + '…'; })
      .replace(/([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '$1…')
      .replace(/(creds\/[\w-]+\/)[A-Za-z0-9]{24}/g, '$1…')
      .replace(/creation_statements="[^"]*(\\"[^"]*)*"/, 'creation_statements="CREATE ROLE …"')
      .replace(/connection_url="[^"]*"/, 'connection_url="postgresql://…"');
  }
  function stateTxt() { return !W.init ? 'belum di-init' : W.sealed ? 'sealed ' + W.parts.length + '/' + W.threshold : 'unsealed'; }
  function tokLabel(t) {
    if (!t) return null;
    if (isRoot(t)) return 'root';
    return t.policies.filter(function (p) { return p !== 'default'; }).join(', ') || 'default';
  }
  function render() {
    var env = vEnv(), tok = curTok(), id = curTokId();
    var tl = !env.VAULT_ADDR ? 'VAULT_ADDR kosong' : tok ? 'token: ' + tokLabel(tok) : id ? 'token ga valid' : 'belum login';
    var tc = $('vt-tok');
    setText(tc, tl);
    tc.classList.toggle('is-on', !!tok && !W.sealed);
    var sc = $('vt-state');
    setText(sc, stateTxt());
    sc.dataset.s = !W.init ? '' : W.sealed ? 'bad' : 'ok';
    app.querySelectorAll('.vt-tabs [role="tab"]').forEach(function (b) {
      var on = b.dataset.tab === W.tab;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    app.querySelectorAll('.vt-view').forEach(function (v) { v.hidden = v.dataset.view !== W.tab; });
    var open = W.init && !W.sealed;
    var nSec = 0;
    Object.keys(W.mounts).forEach(function (k) { var m = W.mounts[k]; if (m.type === 'kv') nSec += Object.keys(m.secrets).length; if (m.type === 'transit') nSec += Object.keys(m.keys).length; });
    setText($('vt-n-sec'), open && nSec ? String(nSec) : '');
    var nPol = Object.keys(W.policies).length - 2;
    setText($('vt-n-pol'), open && nPol ? String(nPol) : '');
    setText($('vt-n-lease'), open && W.leases.length ? String(W.leases.length) : '');
    renderFlow(env, tok);
    renderQuick();
    if (W.tab === 'status') renderStatus(env);
    if (W.tab === 'secrets') renderSecrets();
    if (W.tab === 'akses') renderAkses(tok);
    if (W.tab === 'lease') renderLease();
  }
  function renderFlow(env, tok) {
    var c = $('vt-f-cli');
    setText(c, !env.VAULT_ADDR ? 'VAULT_ADDR kosong' : tok ? tokLabel(tok) : 'tanpa token');
    c.dataset.s = !env.VAULT_ADDR ? 'warn' : tok ? 'ok' : '';
    var v = $('vt-f-vault');
    setText(v, stateTxt());
    v.dataset.s = !W.init ? 'warn' : W.sealed ? 'bad' : 'ok';
    var s = $('vt-f-sto');
    setText(s, !W.init ? 'kosong' : W.sealed ? 'terkunci' : storeCount() + ' entri');
    s.dataset.s = !W.init ? '' : W.sealed ? 'warn' : 'ok';
    var d = $('vt-f-db');
    var db = W.mounts['database/'], cfg = db && Object.keys(db.configs).length;
    var live = W.dbUsers.filter(function (u) { return !u.gone; }).length;
    setText(d, live ? live + ' user dinamis' : cfg ? 'terhubung' : 'belum terhubung');
    d.dataset.s = live ? 'info' : cfg ? 'ok' : '';
  }
  function renderQuick() {
    var q;
    if (W.pending) {
      if (W.pending.kind === 'unseal') q = W.keys.filter(function (k) { return W.parts.indexOf(k) < 0; }).slice(0, 3).map(function (k) { return [k, 'isi key ' + (W.keys.indexOf(k) + 1) + ' (' + k.slice(0, 6) + '…)']; });
      else q = W.root && W.tokens[W.root] ? [[W.root, 'isi root token']] : [];
      q.push(['^C', 'batal (Ctrl+C)']);
      setHTML($('vt-quick'), q.map(function (x) { return '<button type="button" data-act="cmd" data-cmd="' + esc(x[0]) + '">' + esc(x[1]) + '</button>'; }).join(''));
      return;
    }
    q = nextSteps();
    setHTML($('vt-quick'), q.slice(0, 8).map(function (c) { return cmdBtn(c); }).join(''));
  }
  function appTok() {
    return Object.keys(W.tokens).map(function (k) { return W.tokens[k]; }).filter(function (t) { return t.policies.indexOf('app-read') >= 0 && t.path === 'auth/token/create'; })[0];
  }
  function nextSteps() {
    var q = [], env = vEnv();
    if (env.VAULT_ADDR !== ADDR_OK) return ['export VAULT_ADDR=' + ADDR_OK, 'vault status', 'help'];
    if (!W.init) return ['vault status', 'vault operator init', 'vault operator init -key-shares=3 -key-threshold=2'];
    if (W.sealed) {
      W.keys.filter(function (k) { return W.parts.indexOf(k) < 0; }).slice(0, W.threshold - W.parts.length).forEach(function (k) { q.push('vault operator unseal ' + k); });
      q.push('vault operator unseal', 'vault status');
      return q;
    }
    var tok = curTok(), root = W.tokens[W.root] ? W.root : null, d = M.done;
    if ((!tok || !isRoot(tok)) && root) q.push('vault login ' + root);
    if (tok && !d.login) q.push('vault token lookup');
    var kv = W.mounts['secret/'];
    if (!kv) q.push('vault secrets enable -path=secret kv-v2');
    else if (kv.type === 'kv') {
      var s = kv.secrets['app/db'];
      if (!s) q.push('vault kv put secret/app/db username=app password=rahasia123');
      else if (!d.kv) q.push('vault kv get secret/app/db');
      else if (s.versions.length < 2) q.push('vault kv put secret/app/db username=app password=GantiDong456');
      else if (!d.versi) q.push('vault kv get -version=1 secret/app/db');
    }
    if (d.kv) {
      var at = appTok();
      if (!W.policies['app-read']) q.push('vault policy write app-read app-read.hcl');
      else if (!at) q.push('vault token create -policy=app-read -ttl=1h');
      else if (!d.policy) {
        if (!at.okRead) q.push('VAULT_TOKEN=' + at.id + ' vault kv get secret/app/db');
        if (!at.denied) q.push('VAULT_TOKEN=' + at.id + ' vault kv put secret/app/db password=bobol');
        q.push('vault token capabilities ' + at.id + ' secret/data/app/db');
      }
    }
    if (d.policy || (d.kv && W.policies['app-read'] && appTok())) {
      var ar = W.auths['approle/'];
      if (!ar) q.push('vault auth enable approle');
      else if (!ar.roles.web) q.push('vault write auth/approle/role/web token_policies=app-read token_ttl=20m');
      else if (W.last.roleId !== ar.roles.web.roleId) q.push('vault read auth/approle/role/web/role-id');
      else if (!W.last.secretId || !ar.roles.web.sids.some(function (x) { return x.id === W.last.secretId; })) q.push('vault write -f auth/approle/role/web/secret-id');
      else if (!d.approle) q.push('vault write auth/approle/login role_id=' + W.last.roleId + ' secret_id=' + W.last.secretId);
    }
    if (d.kv) {
      var db = W.mounts['database/'];
      if (!db) q.push('vault secrets enable database');
      else if (!db.configs.postgres) q.push(DB_CMD);
      else if (!db.roles.readonly) q.push(ROLE_CMD);
      else {
        var L = W.leases.filter(function (x) { return x.info && x.info.kind === 'db'; })[0];
        if (!L) q.push('vault read database/creds/readonly');
        else q.push('vault lease revoke ' + L.id, 'vault lease renew ' + L.id);
      }
      var tr = W.mounts['transit/'];
      if (!tr) q.push('vault secrets enable transit');
      else if (!tr.keys.app) q.push('vault write -f transit/keys/app');
      else if (!W.last.ct || !W.ciphers[W.last.ct]) q.push('vault write transit/encrypt/app plaintext=$(echo -n "halo vault" | base64)');
      else if (!d.transit) q.push('vault write -field=plaintext transit/decrypt/app ciphertext=' + W.last.ct + ' | base64 -d');
      else if (tr.keys.app.latest < 2) q.push('vault write -f transit/keys/app/rotate');
    }
    var left = MISSIONS.filter(function (m) { return !d[m.id]; }).map(function (m) { return m.id; });
    if (left.length === 1 && left[0] === 'seal') q.push('vault operator seal');
    ['vault status', 'vault secrets list', 'vault policy list', 'vault token lookup'].forEach(function (c) { if (q.indexOf(c) < 0) q.push(c); });
    return q;
  }
  var LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path class="vt-shackle" d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2.5"/></svg>';
  function gate(txt, cmd) { return '<div class="vt-gate"><p>' + txt + '</p>' + (cmd ? cmdBtn(cmd, null, 'gx-primary') : '') + '</div>'; }
  function lockedGate() {
    if (!W.init) return gate('Vault belum di-init, jadi belum ada apa-apa di sini.', vEnv().VAULT_ADDR === ADDR_OK ? 'vault operator init' : 'export VAULT_ADDR=' + ADDR_OK);
    return gate('Vault <b>tersegel</b>. Semua data di storage terenkripsi, dan Vault sendiri ga bisa membacanya sampai di-unseal.', 'vault operator unseal');
  }
  function info(rows) { return '<div class="vt-info">' + rows.map(function (r) { return '<span>' + r[0] + '</span><b>' + r[1] + '</b>'; }).join('') + '</div>'; }
  function renderStatus(env) {
    var st = !W.init ? 'uninit' : W.sealed ? 'sealed' : 'open';
    var title = { uninit: 'BELUM DI-INIT', sealed: 'SEALED', open: 'UNSEALED' }[st];
    var desc = !W.init ? 'Storage masih kosong. <code>vault operator init</code> bakal membuat root key, memecahnya jadi unseal key, dan memberi kamu root token.'
      : W.sealed ? 'Data di storage terenkripsi dan Vault ga bisa membacanya. Masukkan ' + W.threshold + ' dari ' + W.shares + ' unseal key buat menyusun ulang root key.'
        : 'Vault terbuka dan melayani permintaan. Root key cuma ada di memori, ga pernah ditulis ke disk.';
    var h = '<div class="vt-seal" data-s="' + st + '">' + LOCK + '<div><b>' + title + '</b><span>' + desc + '</span></div></div>';
    if (env.VAULT_ADDR !== ADDR_OK) h += '<p class="vt-note is-warn">CLI di laptop belum tahu alamat Vault. Tanpa <code>VAULT_ADDR</code>, perintah vault mencoba https://127.0.0.1:8200. ' + cmdBtn('export VAULT_ADDR=' + ADDR_OK, 'set VAULT_ADDR') + '</p>';
    if (W.init) {
      h += '<p class="vt-sub">unseal key <span>butuh ' + W.threshold + ' dari ' + W.shares + '</span></p><div class="vt-keys">';
      W.keys.forEach(function (k, i) {
        var used = W.parts.indexOf(k) >= 0;
        h += '<button type="button" class="vt-key' + (used ? ' is-used' : '') + (W.sealed ? '' : ' is-open') + '" data-act="unseal" data-i="' + i + '"' + (W.sealed && !used ? '' : ' disabled') + ' aria-label="unseal pakai key ' + (i + 1) + '"><b>key ' + (i + 1) + '</b><small>' + esc(k.slice(0, 6)) + '…</small></button>';
      });
      h += '</div>';
      if (W.sealed) {
        var pct = W.parts.length / W.threshold * 100;
        h += '<div class="vt-prog" role="progressbar" aria-valuemin="0" aria-valuemax="' + W.threshold + '" aria-valuenow="' + W.parts.length + '"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
          '<p class="vt-note">Progress ' + W.parts.length + '/' + W.threshold + '. Klik key buat menjalankan <code>vault operator unseal</code>. Di dunia nyata, tiap key dipegang orang yang berbeda supaya ga ada satu orang pun yang bisa membuka Vault sendirian.</p>';
      }
    } else if (env.VAULT_ADDR === ADDR_OK) h += '<p class="vt-note">' + cmdBtn('vault operator init', 'vault operator init', 'gx-primary') + '</p>';
    var aud = Object.keys(W.audits);
    h += '<p class="vt-sub">server</p>' + info([
      ['node', 'vault-1 · ' + HOST],
      ['api', 'http://' + HOST + ':8200'],
      ['storage', 'raft · 1 node' + (W.init && !W.sealed ? ' · index ' + W.raftIdx : '')],
      ['mode HA', W.init && !W.sealed ? 'active' : 'standby (sealed)'],
      ['versi', VERSION],
      ['audit', aud.length ? aud.map(function (k) { return esc(W.audits[k].path) + ' (' + W.audits[k].n + ' entri)'; }).join(', ') : 'belum ada' + (W.init && !W.sealed ? ' ' + cmdBtn('vault audit enable file file_path=/var/log/vault_audit.log', 'aktifkan') : '')]
    ]);
    if (W.init && !W.sealed) h += '<p class="vt-note">Kalau ada insiden, satu perintah ini menghentikan semua akses: ' + cmdBtn('vault operator seal', 'vault operator seal', 'vt-del') + '</p>';
    setHTML($('vt-v-status'), h);
  }
  function mask(n) { return new Array(Math.min(8, Math.max(4, n)) + 1).join('•'); }
  function renderSecrets() {
    if (!W.init || W.sealed) { setHTML($('vt-v-secrets'), lockedGate()); return; }
    var ks = Object.keys(W.mounts).sort();
    var h = '<p class="vt-sub">secrets engine</p><div class="vt-chips">' + ks.map(function (k) {
      var m = W.mounts[k];
      return '<span class="vt-chip' + (/^(sys|identity|cubbyhole)\/$/.test(k) ? ' is-sys' : '') + '"><b>' + esc(k) + '</b> ' + m.type + (m.type === 'kv' ? ' v' + m.version : '') + '</span>';
    }).join('') + (W.mounts['secret/'] ? '' : cmdBtn('vault secrets enable -path=secret kv-v2', '+ kv-v2 di secret/')) + '</div>';
    var any = false;
    ks.forEach(function (k) {
      var m = W.mounts[k];
      if (m.type === 'kv') {
        any = true;
        var names = Object.keys(m.secrets).sort();
        h += '<p class="vt-sub"><b>' + esc(k) + '</b> kv v' + m.version + '</p>';
        if (!names.length) { h += '<p class="vt-none">Belum ada secret. ' + cmdBtn('vault kv put ' + k + 'app/db username=app password=rahasia123', 'simpan app/db') + '</p>'; return; }
        h += '<div class="vt-cards">' + names.map(function (n) {
          var s = m.secrets[n], full = k + n;
          if (m.version !== 2) {
            return '<div class="vt-card"><div class="vt-ch"><b>' + esc(n) + '</b><em>v1 engine</em></div><div class="vt-row">' + Object.keys(s).sort().map(function (x) { return '<span class="vt-k">' + esc(x) + ' <i>' + mask(String(s[x]).length) + '</i></span>'; }).join('') + '</div><div class="sw-act">' + cmdBtn('vault kv get ' + full, 'get') + '</div></div>';
          }
          var cur = s.versions[s.cur - 1];
          var vers = s.versions.map(function (v, i) {
            var cls = v.destroyed ? ' is-gone' : v.deleted ? ' is-del' : i + 1 === s.cur ? ' is-cur' : '';
            return '<span class="vt-ver' + cls + '" title="' + (v.destroyed ? 'destroyed' : v.deleted ? 'deleted' : 'versi ' + (i + 1)) + '">v' + (i + 1) + '</span>';
          }).join('');
          var data = cur.data || {};
          var acts = [cmdBtn('vault kv get ' + full, 'get')];
          if (s.cur > 1) acts.push(cmdBtn('vault kv get -version=' + (s.cur - 1) + ' ' + full, 'get v' + (s.cur - 1)));
          acts.push(cmdBtn('vault kv metadata get ' + full, 'metadata'));
          if (cur.deleted && !cur.destroyed) acts.push(cmdBtn('vault kv undelete -versions=' + s.cur + ' ' + full, 'undelete v' + s.cur));
          else if (!cur.destroyed) acts.push(cmdBtn('vault kv delete ' + full, 'delete', 'vt-del'));
          return '<div class="vt-card"><div class="vt-ch"><b>' + esc(n) + '</b><em>versi ' + s.cur + '</em></div><div class="vt-vers">' + vers + '</div>' +
            '<div class="vt-row">' + (cur.destroyed ? '<span class="vt-none">versi ini sudah di-destroy</span>' : cur.deleted ? '<span class="vt-none">versi terbaru di-delete (masih bisa di-undelete)</span>' : Object.keys(data).sort().map(function (x) { return '<span class="vt-k">' + esc(x) + ' <i>' + mask(String(data[x]).length) + '</i></span>'; }).join('')) + '</div>' +
            '<div class="sw-act">' + acts.join('') + '</div></div>';
        }).join('') + '</div>';
      }
      if (m.type === 'transit') {
        any = true;
        var tk = Object.keys(m.keys).sort();
        h += '<p class="vt-sub"><b>' + esc(k) + '</b> transit</p>';
        if (!tk.length) { h += '<p class="vt-none">Belum ada kunci. ' + cmdBtn('vault write -f ' + k + 'keys/app', 'bikin kunci app') + '</p>'; return; }
        h += '<div class="vt-cards">' + tk.map(function (n) {
          var key = m.keys[n], vs = [];
          for (var i = 1; i <= key.latest; i++) vs.push('<span class="vt-ver' + (i === key.latest ? ' is-cur' : i < key.minDec ? ' is-gone' : '') + '">v' + i + '</span>');
          return '<div class="vt-card"><div class="vt-ch"><b>' + esc(n) + '</b><em>aes256-gcm96</em></div><div class="vt-vers">' + vs.join('') + '</div>' +
            '<div class="vt-meta">' + key.count + ' kali enkripsi · datanya ga disimpan Vault</div><div class="sw-act">' +
            cmdBtn('vault write ' + k + 'encrypt/' + n + ' plaintext=$(echo -n "halo vault" | base64)', 'encrypt') + cmdBtn('vault write -f ' + k + 'keys/' + n + '/rotate', 'rotate') + cmdBtn('vault read ' + k + 'keys/' + n, 'info') + '</div></div>';
        }).join('') + '</div>';
      }
      if (m.type === 'database') {
        any = true;
        var cs = Object.keys(m.configs), rsn = Object.keys(m.roles);
        h += '<p class="vt-sub"><b>' + esc(k) + '</b> database</p>';
        if (!cs.length) { h += '<p class="vt-none">Belum terhubung ke database. ' + cmdBtn(DB_CMD, 'hubungkan postgres') + '</p>'; return; }
        h += '<div class="vt-cards">' + cs.map(function (n) {
          var c = m.configs[n];
          return '<div class="vt-card"><div class="vt-ch"><b>config/' + esc(n) + '</b><em>postgresql</em></div><div class="vt-meta">' + DB_HOST + ':5432/app · admin ' + esc(c.user) + '</div><div class="vt-row">allowed_roles ' + (c.roles.length ? c.roles.map(function (r) { return '<span class="vt-k">' + esc(r) + '</span>'; }).join('') : '<span class="vt-none">kosong, ga ada role yang boleh</span>') + '</div></div>';
        }).join('') + rsn.map(function (n) {
          var r = m.roles[n];
          return '<div class="vt-card"><div class="vt-ch"><b>roles/' + esc(n) + '</b><em>TTL ' + dur(r.ttl) + ' / maks ' + dur(r.max) + '</em></div><div class="vt-meta">db ' + esc(r.db) + ' · ' + esc(r.grant) + '</div><div class="sw-act">' + cmdBtn('vault read ' + k + 'creds/' + n, 'minta kredensial') + '</div></div>';
        }).join('') + (rsn.length ? '' : '<p class="vt-none">Belum ada role. ' + cmdBtn(ROLE_CMD, 'bikin role readonly') + '</p>') + '</div>';
      }
    });
    if (!any) h += '<p class="vt-none">Selain mount bawaan (sys, identity, cubbyhole), belum ada secrets engine. Aktifkan KV v2 dulu buat menyimpan secret.</p>';
    setHTML($('vt-v-secrets'), h);
  }
  function ttlBar(t0, t1) {
    var total = t1 - t0, left = Math.max(0, t1 - now()), pct = total > 0 ? left / total * 100 : 0;
    var s = pct < 20 ? 'bad' : pct < 50 ? 'warn' : 'ok';
    return '<div class="vt-ttl" data-s="' + s + '"><i style="width:' + pct.toFixed(1) + '%"></i></div>';
  }
  function renderAkses(tok) {
    if (!W.init || W.sealed) { setHTML($('vt-akses'), lockedGate()); return; }
    var h = '<p class="vt-sub">auth method</p><div class="vt-chips">' + Object.keys(W.auths).sort().map(function (k) { return '<span class="vt-chip"><b>' + esc(k) + '</b> ' + W.auths[k].type + '</span>'; }).join('') + (W.auths['approle/'] ? '' : cmdBtn('vault auth enable approle', '+ approle')) + '</div>';
    h += '<p class="vt-sub">policy</p><div class="vt-chips">' + Object.keys(W.policies).sort().map(function (k) {
      var sys = k === 'root' || k === 'default';
      return '<button type="button" class="vt-chip' + (sys ? ' is-sys' : '') + '" data-act="cmd" data-cmd="vault policy read ' + esc(k) + '"><b>' + esc(k) + '</b> ' + (k === 'root' ? 'boleh semua' : W.policies[k].rules.length + ' path') + '</button>';
    }).join('') + '</div>';
    var ar = W.auths['approle/'];
    if (ar) {
      var roles = Object.keys(ar.roles);
      h += '<p class="vt-sub">role approle</p>' + (roles.length ? '<div class="vt-cards">' + roles.map(function (n) {
        var r = ar.roles[n];
        return '<div class="vt-card"><div class="vt-ch"><b>' + esc(n) + '</b><em>TTL ' + dur(r.ttl || SYS_TTL) + '</em></div><div class="vt-row"><span class="vt-k">' + esc(r.policies.join(', ') || 'tanpa policy') + '</span><span class="vt-k">role_id ' + esc(r.roleId.slice(0, 8)) + '…</span><span class="vt-k">' + r.sids.length + ' secret-id</span></div><div class="sw-act">' +
          cmdBtn('vault read auth/approle/role/' + n + '/role-id', 'role-id') + cmdBtn('vault write -f auth/approle/role/' + n + '/secret-id', 'secret-id baru') + '</div></div>';
      }).join('') + '</div>' : '<p class="vt-none">Belum ada role. ' + cmdBtn('vault write auth/approle/role/web token_policies=app-read token_ttl=20m', 'bikin role web') + '</p>');
    }
    var toks = Object.keys(W.tokens).map(function (k) { return W.tokens[k]; });
    var cur = curTokId();
    h += '<p class="vt-sub">token aktif <span>' + toks.length + '</span></p><div class="vt-cards">' + toks.map(function (t) {
      var acts = [];
      if (t.id !== cur) acts.push(cmdBtn('vault login ' + t.id, 'login pakai ini'));
      if (!isRoot(t)) acts.push(cmdBtn('vault token revoke ' + t.id, 'revoke', 'vt-del'));
      return '<div class="vt-card' + (t.id === cur ? ' is-me' : '') + '"><div class="vt-ch"><b>' + esc(t.display) + '</b><em>' + (t.id === cur ? 'dipakai CLI' : esc(t.id.slice(0, 8)) + '…') + '</em></div>' +
        '<div class="vt-row">' + t.policies.map(function (p) { return '<span class="vt-k' + (p === 'root' ? ' is-root' : '') + '">' + esc(p) + '</span>'; }).join('') + '</div>' +
        '<div class="vt-meta">' + (t.expires ? 'sisa ' + dur((t.expires - now()) / 1000) + ' dari ' + dur(t.ttl) : 'ga pernah kedaluwarsa') + ' · ' + esc(t.path) + '</div>' + (t.expires ? ttlBar(t.created, t.expires) : '') +
        (acts.length ? '<div class="sw-act">' + acts.join('') + '</div>' : '') + '</div>';
    }).join('') + '</div>';
    setHTML($('vt-akses'), h);
  }
  function renderLease() {
    if (!W.init || W.sealed) { setHTML($('vt-v-lease'), lockedGate()); return; }
    var h = '<p class="vt-sub">lease aktif <span>' + W.leases.length + '</span></p>';
    if (!W.leases.length) h += '<p class="vt-none">Belum ada lease. Secret dinamis, misalnya kredensial database dari <code>vault read database/creds/readonly</code>, selalu datang dengan lease yang punya masa berlaku.</p>';
    else {
      h += '<div class="vt-cards">' + W.leases.map(function (L) {
        var left = (L.expires - now()) / 1000;
        return '<div class="vt-card"><div class="vt-ch"><b>' + esc(L.path) + '/' + esc(L.id.slice(-24, -18)) + '…</b><em>' + dur(left) + '</em></div>' + ttlBar(L.renewed || L.issued, L.expires) +
          '<div class="vt-meta">' + (L.info && L.info.user ? 'user ' + esc(L.info.user) : '') + ' · maks sampai ' + dur((L.maxAt - now()) / 1000) + ' lagi</div><div class="sw-act">' +
          cmdBtn('vault lease renew ' + L.id, 'renew') + cmdBtn('vault lease revoke ' + L.id, 'revoke', 'vt-del') + '</div></div>';
      }).join('') + '</div>';
    }
    var db = W.mounts['database/'];
    if (db && Object.keys(db.configs).length) {
      h += '<p class="vt-sub">user di PostgreSQL ' + DB_HOST + '</p><div class="vt-pg"><div class="vt-pgh"><span>role</span><span>dibuat oleh</span><span>izin</span></div>' +
        '<div><b>postgres</b><span>instalasi</span><span>superuser</span></div><div><b>vault</b><span>admin DB</span><span>CREATEROLE</span></div>' +
        W.dbUsers.map(function (u) {
          return '<div class="' + (u.gone ? 'is-gone' : 'is-new') + '"><b>' + esc(u.name) + '</b><span>Vault (' + esc(u.role) + ')</span><span>' + (u.gone ? 'dihapus, ' + esc(u.why || '') : esc(u.grant)) + '</span></div>';
        }).join('') + '</div>';
    }
    setHTML($('vt-v-lease'), h);
  }

  // ---------- wiring ----------
  ed = new K.Editor($('vt-ed'), { label: 'Editor app-read.hcl', value: SNIPS.ro, highlight: K.hlHCL });
  app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    var act = b.dataset.act;
    if (act === 'cmd') {
      if (W.pending && b.closest('.vt-dash')) { toast('jawab dulu prompt di terminal, atau klik batal'); return; }
      term.submit(b.dataset.cmd);
    }
    else if (act === 'tab') { W.tab = b.dataset.tab; render(); }
    else if (act === 'unseal') {
      var k = W.keys[+b.dataset.i];
      if (!k) return;
      term.submit(W.pending && W.pending.kind === 'unseal' ? k : 'vault operator unseal ' + k);
    }
    else if (act === 'snip') { ed.set(SNIPS[b.dataset.snip]); toast(b.dataset.snip === 'v1' ? 'Coba tulis policy ini, lalu baca secret pakai token-nya. Lihat apa yang terjadi.' : 'Contoh policy baca saja dimuat ke editor'); }
    else if (act === 'reset') reset();
  });
  app.querySelector('.vt-tabs').addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    var tabs = ['status', 'secrets', 'akses', 'lease'], i = tabs.indexOf(W.tab);
    W.tab = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    render();
    $('vt-tab-' + W.tab).focus();
  });
  $('vt-in').addEventListener('keydown', function (e) {
    if (e.key === 'c' && e.ctrlKey && W.pending) { e.preventDefault(); $('vt-in').value = ''; term.submit('^C'); }
  });
  setInterval(tick, 500);

  function reset() {
    initWorld();
    clearPending();
    term.clear();
    M.reset();
    ed.set(SNIPS.ro);
    term.lines([
      '<span class="sx-dim"># Lab Vault bohongan: server vault-1 di ' + HOST + ' (storage raft) dan PostgreSQL di ' + DB_HOST + '. Vault-nya baru diinstal: belum di-init dan masih tersegel.</span>',
      '<span class="sx-dim"># Ini terminal laptop kamu. Mulai dengan </span><b>export VAULT_ADDR=' + ADDR_OK + '</b><span class="sx-dim">, lalu </span><b>vault status</b><span class="sx-dim">. Ketik </span><b>help</b><span class="sx-dim"> buat daftar perintah.</span>'
    ]);
    render();
  }
  initWorld();
  reset();
})();
