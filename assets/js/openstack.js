// OpenStack simulator for /openstack/. A small private cloud with two
// projects (demo, admin): Keystone tokens and quotas, Nova servers on two
// compute nodes, Neutron networks, subnets, routers, floating IPs and
// security groups, keypairs, Glance images and Cinder volumes. A laptop
// shell runs the openstack CLI and ssh; after ssh you get a tiny shell inside
// the server. Time is sped up. Nothing is stored.
(function () {
  'use strict';

  var K = window.SimKit;
  var app = document.getElementById('os');
  if (!app || !K) return;
  var esc = K.esc, setHTML = K.setHTML, setText = K.setText, words = K.words, digest = K.digest, pad = K.pad;
  function $(id) { return document.getElementById(id); }
  function rnd(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function rep(c, n) { return new Array(n + 1).join(c); }

  var LAPTOP_IP = '198.51.100.23';
  var PUB_CIDR = '203.0.113.0/24';
  var BOOT_MS = 3500, VOL_MS = 1500, ATTACH_MS = 1500, POWER_MS = 1600, DEL_MS = 1400;
  var IMAGES = [
    { name: 'ubuntu-24.04', user: 'ubuntu', os: 'Ubuntu 24.04.1 LTS', kernel: '6.8.0-45-generic', size: 0.58, minDisk: 3, fmt: 'qcow2' },
    { name: 'debian-12', user: 'debian', os: 'Debian GNU/Linux 12 (bookworm)', kernel: '6.1.0-26-cloud-amd64', size: 0.41, minDisk: 2, fmt: 'qcow2' },
    { name: 'cirros-0.6.2', user: 'cirros', os: 'CirrOS 0.6.2', kernel: '5.15.0-71-generic', size: 0.02, minDisk: 1, fmt: 'qcow2' }
  ];
  var FLAVORS = [
    { name: 'm1.tiny', vcpu: 1, ram: 512, disk: 1 },
    { name: 'm1.small', vcpu: 1, ram: 2048, disk: 20 },
    { name: 'm1.medium', vcpu: 2, ram: 4096, disk: 40 },
    { name: 'm1.large', vcpu: 4, ram: 8192, disk: 80 },
    { name: 'm1.xlarge', vcpu: 8, ram: 16384, disk: 160 }
  ];
  var QUOTA0 = {
    demo: { instances: 10, cores: 8, ram: 16384, volumes: 10, gigabytes: 100, 'floating-ips': 5, networks: 10, routers: 5, 'secgroups': 10 },
    admin: { instances: 50, cores: 64, ram: 131072, volumes: 50, gigabytes: 1000, 'floating-ips': 20, networks: 50, routers: 20, 'secgroups': 50 }
  };
  var HYPERS = [{ name: 'compute1', ip: '10.20.0.11', vcpu: 16, ram: 32768 }, { name: 'compute2', ip: '10.20.0.12', vcpu: 16, ram: 32768 }];
  var OPENRC = {
    demo: { project: 'demo', user: 'demo', pass: 'lab-demo' },
    admin: { project: 'admin', user: 'admin', pass: 'lab-admin' }
  };

  var MISSIONS = [
    { id: 'login', text: 'Login ke Keystone: <b>source demo-openrc</b>, lalu <i>openstack token issue</i>.' },
    { id: 'net', text: 'Bikin network privat dan subnet-nya, misal <b>10.0.0.0/24</b>.' },
    { id: 'router', text: 'Bikin router, pasang gateway ke <b>public</b>, lalu sambungkan ke subnetmu.' },
    { id: 'akses', text: 'Siapkan akses: security group yang membuka <b>port 22</b> dan sebuah <b>keypair</b>.' },
    { id: 'server', text: 'Luncurkan server pakai keypair itu sampai statusnya <b>ACTIVE</b>.' },
    { id: 'ssh', text: 'Pasang <b>floating IP</b> ke server, lalu <i>ssh</i> masuk dari laptop.' },
    { id: 'volume', text: 'Tempel volume Cinder ke server, lalu cek dari dalam pakai <b>lsblk</b>.' },
    { id: 'quota', text: 'Kena <b>quota</b> vCPU project demo, lalu naikkan quota-nya sebagai admin.' },
    { id: 'cleanup', text: 'Bersih-bersih: hapus server, floating IP, volume, router, dan network tanpa sisa.' }
  ];

  // ---------- small helpers ----------
  var seq = 0;
  function uuid() {
    var d = digest('u' + (seq++) + '|' + Math.random());
    return d.slice(0, 8) + '-' + d.slice(8, 12) + '-' + d.slice(12, 16) + '-' + d.slice(16, 20) + '-' + d.slice(20, 32);
  }
  function hexid(s) { return digest('id|' + s).slice(0, 32); }
  var PROJ_ID = { demo: hexid('project demo'), admin: hexid('project admin') };
  var USER_ID = { demo: hexid('user demo'), admin: hexid('user admin') };
  function iso(t) { return new Date(t || Date.now()).toISOString().replace(/\.\d+Z$/, 'Z'); }
  function ipToInt(s) {
    var p = String(s).split('.');
    if (p.length !== 4) return null;
    var n = 0;
    for (var i = 0; i < 4; i++) {
      if (!/^\d{1,3}$/.test(p[i]) || +p[i] > 255) return null;
      n = n * 256 + +p[i];
    }
    return n;
  }
  function intToIp(n) { return [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255].join('.'); }
  function parseCidr(s) {
    var m = /^([\d.]+)\/(\d{1,2})$/.exec(String(s || ''));
    if (!m) return null;
    var ip = ipToInt(m[1]), pre = +m[2];
    if (ip === null || pre > 32) return null;
    var size = Math.pow(2, 32 - pre);
    var base = Math.floor(ip / size) * size;
    return { base: base, pre: pre, size: size, str: intToIp(base) + '/' + pre };
  }
  function inCidr(ip, c) {
    var n = ipToInt(ip), p = typeof c === 'string' ? parseCidr(c) : c;
    return n !== null && p && n >= p.base && n < p.base + p.size;
  }
  function overlaps(a, b) { return a.base < b.base + b.size && b.base < a.base + a.size; }
  function mac() { return 'fa:16:3e:' + [K.hex(2), K.hex(2), K.hex(2)].join(':'); }
  function isPrivate(ip) { return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip); }

  // CLI errors are thrown and printed in red by onCmd
  function E(msg, hintTxt) { var e = new Error(msg); e.cli = true; e.hint = hintTxt; return e; }
  function H(msg, code, hintTxt) { return E(msg + ' (HTTP ' + code + ') (Request-ID: req-' + uuid() + ')', hintTxt); }
  function argErr(cmd, what) { return E('usage: openstack ' + cmd + ' [-h] ...\nopenstack ' + cmd + ': error: the following arguments are required: ' + what); }

  // ---------- state ----------
  var W;
  function initWorld() {
    W = {
      run: (W ? W.run : 0) + 1, busy: false, project: null, ssh: null, tab: W ? W.tab : 'ringkasan',
      servers: [], nets: [], subnets: [], routers: [], fips: [], sgs: [], keys: [], vols: [], images: [],
      quota: { demo: Object.assign({}, QUOTA0.demo), admin: Object.assign({}, QUOTA0.admin) },
      files: {}, hostsKnown: {}, fipNext: rnd(120, 170), sawQuota: false, hadServer: false, tokenAt: 0
    };
    IMAGES.forEach(function (im) { W.images.push(Object.assign({ id: uuid() }, im)); });
    FLAVORS.forEach(function (f, i) { f.id = String(i + 1); });
    // the provider network every project can use for floating IPs
    var pub = { id: uuid(), name: 'public', project: 'admin', ext: true, shared: false, created: Date.now() };
    W.nets.push(pub);
    var pc = parseCidr(PUB_CIDR);
    W.subnets.push({ id: uuid(), name: 'public-subnet', net: pub.id, project: 'admin', cidr: pc, gw: pc.base + 1, next: 0, dhcp: false });
    ['demo', 'admin'].forEach(function (p) { W.sgs.push(defaultSg(p)); });
  }
  function defaultSg(p) {
    return {
      id: uuid(), name: 'default', project: p, desc: 'Default security group',
      rules: [
        { id: uuid(), dir: 'egress', eth: 'IPv4', proto: null, port: null, remote: null, group: null },
        { id: uuid(), dir: 'egress', eth: 'IPv6', proto: null, port: null, remote: null, group: null },
        { id: uuid(), dir: 'ingress', eth: 'IPv4', proto: null, port: null, remote: null, group: 'default' },
        { id: uuid(), dir: 'ingress', eth: 'IPv6', proto: null, port: null, remote: null, group: 'default' }
      ]
    };
  }
  function pub() { return W.nets[0]; }
  function mine(list) { return list.filter(function (x) { return x.project === W.project; }); }
  function visibleNets() { return W.nets.filter(function (n) { return n.project === W.project || n.ext || n.shared; }); }
  function subnetsOf(net) { return W.subnets.filter(function (s) { return s.net === net.id; }); }
  function netOf(sub) { return W.nets.filter(function (n) { return n.id === sub.net; })[0]; }
  function imageById(id) { return W.images.filter(function (i) { return i.id === id; })[0]; }
  function flavorBy(ref) { return FLAVORS.filter(function (f) { return f.name === ref || f.id === ref; })[0]; }
  function srvById(id) { return W.servers.filter(function (s) { return s.id === id; })[0]; }
  function volById(id) { return W.vols.filter(function (v) { return v.id === id; })[0]; }
  function subById(id) { return W.subnets.filter(function (s) { return s.id === id; })[0]; }
  // find by name or ID inside a list; names may repeat in OpenStack
  function find(list, ref, kind, label) {
    if (!ref) throw E('Missing ' + kind.toLowerCase() + ' name or ID');
    var byId = list.filter(function (x) { return x.id === ref; });
    if (byId.length) return byId[0];
    var byName = list.filter(function (x) { return x.name === ref; });
    if (byName.length > 1) throw E('More than one ' + kind + ' exists with the name \'' + ref + '\'.', '# nama di OpenStack boleh kembar. Pakai ID-nya biar jelas.');
    if (!byName.length) throw E('No ' + (label || kind) + ' found for ' + ref);
    return byName[0];
  }
  function ref(x, list) { return list.filter(function (y) { return y.name === x.name && y.project === x.project; }).length > 1 ? x.id : x.name; }

  function usage(p) {
    var u = { instances: 0, cores: 0, ram: 0, volumes: 0, gigabytes: 0, 'floating-ips': 0, networks: 0, routers: 0, secgroups: 0 };
    W.servers.forEach(function (s) { if (s.project !== p) return; u.instances++; u.cores += s.flavor.vcpu; u.ram += s.flavor.ram; });
    W.vols.forEach(function (v) { if (v.project !== p) return; u.volumes++; u.gigabytes += v.size; });
    W.fips.forEach(function (f) { if (f.project === p) u['floating-ips']++; });
    W.nets.forEach(function (n) { if (n.project === p && !n.ext) u.networks++; });
    W.routers.forEach(function (r) { if (r.project === p) u.routers++; });
    W.sgs.forEach(function (g) { if (g.project === p) u.secgroups++; });
    return u;
  }
  function hyperUse(h) {
    var u = { vcpu: 0, ram: 0, n: 0 };
    W.servers.forEach(function (s) { if (s.host === h.name && s.status !== 'ERROR') { u.vcpu += s.flavor.vcpu; u.ram += s.flavor.ram; u.n++; } });
    return u;
  }
  function nextIp(sub) {
    var used = {};
    portsOn(sub).forEach(function (p) { used[p.ip] = true; });
    if (!sub.next) sub.next = rnd(10, 40);
    for (var tries = 0; tries < sub.cidr.size; tries++) {
      var n = sub.cidr.base + sub.next;
      sub.next += rnd(1, 6);
      if (sub.next >= sub.cidr.size - 1) sub.next = 3;
      if (!used[intToIp(n)] && n !== sub.gw) return intToIp(n);
    }
    throw H('No more IP addresses available on network ' + sub.net + '.', 409);
  }
  function nextFip() {
    var used = {};
    W.fips.forEach(function (f) { used[f.ip] = true; });
    W.routers.forEach(function (r) { if (r.gw) used[r.gw.ip] = true; });
    var c = parseCidr(PUB_CIDR);
    for (var i = 0; i < 250; i++) {
      var ip = intToIp(c.base + W.fipNext);
      W.fipNext = W.fipNext >= 250 ? 10 : W.fipNext + rnd(1, 9);
      if (!used[ip]) return ip;
    }
    throw H('No more IP addresses available on network ' + pub().id + '.', 409);
  }
  // every port Neutron knows about: dhcp, router interfaces, router gateways, server NICs
  function allPorts() {
    var out = [];
    W.subnets.forEach(function (s) {
      if (s.dhcp) out.push({ id: s.dhcpPort, owner: 'network:dhcp', sub: s, ip: intToIp(s.cidr.base + 2), mac: s.dhcpMac, project: s.project, status: 'ACTIVE' });
    });
    W.routers.forEach(function (r) {
      r.ifs.forEach(function (f) { out.push({ id: f.port, owner: 'network:router_interface', sub: subById(f.sub), ip: f.ip, mac: f.mac, project: r.project, status: 'ACTIVE', router: r }); });
      if (r.gw) out.push({ id: r.gw.port, owner: 'network:router_gateway', sub: W.subnets[0], ip: r.gw.ip, mac: r.gw.mac, project: r.project, status: 'ACTIVE', router: r });
    });
    W.servers.forEach(function (s) {
      s.nics.forEach(function (n) { out.push({ id: n.port, owner: 'compute:nova', sub: subById(n.sub), ip: n.ip, mac: n.mac, project: s.project, status: s.status === 'ACTIVE' ? 'ACTIVE' : 'DOWN', server: s }); });
    });
    return out;
  }
  function portsOn(sub) { return allPorts().filter(function (p) { return p.sub === sub; }); }
  function blockingPorts(sub) { return portsOn(sub).filter(function (p) { return p.owner !== 'network:dhcp'; }); }
  // a router of this project that has a gateway on public and an interface on sub
  function routerFor(sub) {
    return W.routers.filter(function (r) { return r.gw && r.ifs.some(function (f) { return f.sub === sub.id; }); })[0];
  }
  function fipOfPort(port) { return W.fips.filter(function (f) { return f.port === port; })[0]; }
  function fipsOf(s) {
    var o = [];
    s.nics.forEach(function (n) { var f = fipOfPort(n.port); if (f) o.push(f); });
    return o;
  }

  // ---------- terminal ----------
  var term = new K.Term($('os-out'), $('os-in'), { onCmd: onCmd });
  var toast = K.makeToast($('os-toast'));
  var M = new K.Missions($('os-m-list'), $('os-m-count'), MISSIONS, toast, '☁️ Semua misi OpenStack beres. Cloud kamu sendiri, nih!');
  function err(t) { term.line('<span class="sx-err">' + esc(t) + '</span>'); }
  function dim(t) { term.line('<span class="sx-dim">' + esc(t) + '</span>'); }
  function hint(t) { term.line('<span class="sx-warn">' + esc(t) + '</span>'); }
  function out(t) { term.line(esc(t)); }
  function prompt() {
    if (W.ssh) { var s = srvById(W.ssh.srv); return W.ssh.user + '@' + (s ? s.name : 'server') + ':~$'; }
    return 'kamu@laptop:~$';
  }

  // OpenStack-client style ASCII table; cells may hold several lines
  function box(rows) {
    var w = [], R = rows.map(function (r) { return r.map(function (c) { return String(c === null || c === undefined ? '' : c).split('\n'); }); });
    R.forEach(function (r) { r.forEach(function (c, i) { c.forEach(function (l) { w[i] = Math.max(w[i] || 0, l.length); }); }); });
    var sep = '+' + w.map(function (n) { return rep('-', n + 2); }).join('+') + '+';
    function lines(r) {
      var h = Math.max.apply(null, r.map(function (c) { return c.length; })), o = [];
      for (var j = 0; j < h; j++) o.push('| ' + r.map(function (c, i) { return pad(c[j] || '', w[i]); }).join(' | ') + ' |');
      return o.join('\n');
    }
    var o = [sep, lines(R[0]), sep];
    R.slice(1).forEach(function (r) { o.push(lines(r)); });
    if (R.length > 1) o.push(sep);
    return o.join('\n');
  }
  // list output honouring -f value and -c COLUMN
  function table(rows, P, emptyTxt) {
    var cols = P ? P.all('c') : [];
    if (cols.length) {
      var idx = cols.map(function (c) { return rows[0].map(function (h) { return h.toLowerCase(); }).indexOf(String(c).toLowerCase()); });
      if (idx.some(function (i) { return i < 0; })) throw E('No recognized column names in [\'' + cols.join("', '") + '\']. Recognized columns are (\'' + rows[0].join("', '") + '\').');
      rows = rows.map(function (r) { return idx.map(function (i) { return r[i]; }); });
    }
    if (P && P.get('f') === 'value') { rows.slice(1).forEach(function (r) { out(r.join(' ')); }); return; }
    if (rows.length === 1) { if (emptyTxt) dim(emptyTxt); return; }
    term.line(esc(box(rows)), 'sx-tbl');
  }
  function fv(pairs, P) {
    if (P && P.get('f') === 'value') {
      var c = P.all('c');
      pairs.forEach(function (p) { if (!c.length || c.indexOf(p[0]) >= 0) out(p[1]); });
      return;
    }
    table([['Field', 'Value']].concat(pairs), null);
  }

  // ---------- option parsing ----------
  var BOOL = { wait: 1, 'all-projects': 1, ingress: 1, egress: 1, absolute: 1, long: 1, external: 1, share: 1, 'no-dhcp': 1, dhcp: 1, force: 1, hard: 1, soft: 1, 'fit-width': 1, 'no-share': 1, internal: 1, h: 1, help: 1, 'external-gateway-none': 1 };
  var ALIAS = { proto: 'protocol', 'nic-net': 'network' };
  function parse(a) {
    var pos = [], o = {};
    for (var i = 0; i < a.length; i++) {
      var t = a[i];
      if (t === '>' || t === '>>') { o['>'] = [a[++i]]; continue; }
      if (/^>\S/.test(t)) { o['>'] = [t.slice(1)]; continue; }
      if (/^-{1,2}[a-z]/i.test(t)) {
        var k = t.replace(/^-+/, ''), v;
        var eq = k.indexOf('=');
        if (eq > 0 && t.slice(0, 2) === '--') { v = k.slice(eq + 1); k = k.slice(0, eq); }
        else if (BOOL[k] || i + 1 >= a.length || /^--/.test(a[i + 1])) v = true;
        else v = a[++i];
        k = ALIAS[k] || k;
        (o[k] = o[k] || []).push(v);
      } else pos.push(t);
    }
    return {
      pos: pos, o: o,
      get: function (k) { return o[k] ? o[k][o[k].length - 1] : undefined; },
      all: function (k) { return o[k] || []; },
      has: function (k) { return !!o[k]; }
    };
  }

  // ---------- commands ----------
  function onCmd(line) {
    term.echo(prompt(), line);
    if (!line) return;
    if (W.busy) { dim('# tunggu perintah sebelumnya selesai dulu'); return; }
    var w = words(line);
    try {
      if (W.ssh) inServer(w, line);
      else laptop(w, line);
    } catch (e) {
      if (e && e.cli) { err(e.message); if (e.hint) hint(e.hint); }
      else { err('simulasi error: ' + (e && e.message || e)); if (window.console) console.error(e); }
    }
    tick();
  }

  function laptop(w, line) {
    var c = w[0];
    if (c === 'clear') { term.clear(); return; }
    if (c === 'help') { help(); return; }
    if (c === 'openstack') { osc(w.slice(1)); return; }
    if (c === 'source' || c === '.') { source(w[1]); return; }
    if (c === 'ls') { ls(w.slice(1)); return; }
    if (c === 'cat') { cat(w[1]); return; }
    if (c === 'env' || c === 'printenv' || /^env\s*\|/.test(line)) { envVars().forEach(out); if (!W.project) dim('# belum ada variabel OS_*. Jalankan source demo-openrc dulu.'); return; }
    if (c === 'echo') { out(w.slice(1).join(' ').replace(/\$\{?(OS_[A-Z_]+)\}?/g, function (m, k) { var v = envMap()[k]; return v === undefined ? '' : v; })); return; }
    if (c === 'unset') { if (w.some(function (x) { return /^OS_/.test(x); })) { W.project = null; dim('# variabel OS_* dihapus. Kamu logout dari OpenStack.'); } return; }
    if (c === 'chmod') { chmod(w[1], w[2]); return; }
    if (c === 'ssh') { ssh(w.slice(1)); return; }
    if (c === 'ping') { pingFromLaptop(w.slice(1)); return; }
    if (c === 'whoami') { out('kamu'); return; }
    if (c === 'hostname') { out('laptop'); return; }
    if (c === 'curl' || c === 'wget') { curlLaptop(line); return; }
    if (c === 'exit' || c === 'logout') { dim('# ini terminal laptop kamu. Ga ada yang perlu di-exit.'); return; }
    if (c === 'ssh-keygen') { dim('# kunci ~/.ssh/id_ed25519 sudah ada. Pakai: openstack keypair create --public-key ~/.ssh/id_ed25519.pub kunci'); return; }
    if (['nova', 'neutron', 'glance', 'cinder', 'keystone'].indexOf(c) >= 0) {
      err('bash: ' + c + ': command not found');
      hint('# CLI per-service (' + c + ') sudah lama digantikan satu perintah: openstack. Contoh: openstack server list');
      return;
    }
    if (c === 'sudo') { dim('# ga perlu sudo buat openstack CLI'); return; }
    err('bash: ' + c + ': command not found');
  }

  function help() {
    if (W.ssh) {
      term.lines(['<b>Kamu ada di dalam server.</b> Perintah yang bisa dicoba:', '  lsblk  ·  df -h  ·  ip a  ·  hostname  ·  uptime  ·  cat /etc/os-release', '  curl ifconfig.me  ·  ping -c 3 8.8.8.8  ·  sudo apt update', '  sudo mkfs.ext4 /dev/vdb  ·  sudo mount /dev/vdb /mnt  ·  exit']);
      return;
    }
    term.lines([
      '<b>Perintah yang bisa dicoba</b> (di laptop)',
      '  source demo-openrc | admin-openrc  ·  ls  ·  cat demo-openrc  ·  env',
      '  openstack token issue  ·  openstack catalog list  ·  openstack quota show  ·  openstack limits show --absolute',
      '  openstack flavor list  ·  openstack image list  ·  openstack server list',
      '  openstack network create NET  ·  openstack subnet create --network NET --subnet-range 10.0.0.0/24 SUB',
      '  openstack router create R  ·  router set --external-gateway public R  ·  router add subnet R SUB',
      '  openstack security group create SG  ·  security group rule create --protocol tcp --dst-port 22 SG',
      '  openstack keypair create --public-key ~/.ssh/id_ed25519.pub KUNCI  ·  keypair create KUNCI > kunci.pem',
      '  openstack server create --flavor m1.small --image ubuntu-24.04 --network NET --key-name KUNCI --security-group SG NAMA',
      '  openstack server show|stop|start|reboot|delete NAMA  ·  openstack console log show NAMA',
      '  openstack floating ip create public  ·  openstack server add floating ip NAMA IP',
      '  openstack volume create --size 10 VOL  ·  openstack server add volume NAMA VOL',
      '  openstack port list  ·  openstack security group rule list SG  ·  ... delete',
      '  admin: openstack project list  ·  hypervisor list  ·  quota set --cores 16 demo  ·  server list --all-projects',
      '  ssh [-i kunci.pem] ubuntu@FLOATING_IP  ·  ping IP  ·  chmod 600 FILE  ·  clear'
    ]);
  }

  function envMap() {
    if (!W.project) return {};
    var r = OPENRC[W.project];
    return { OS_AUTH_URL: 'http://controller:5000/v3', OS_PROJECT_NAME: r.project, OS_USERNAME: r.user, OS_PASSWORD: r.pass, OS_USER_DOMAIN_NAME: 'Default', OS_PROJECT_DOMAIN_NAME: 'Default', OS_REGION_NAME: 'RegionOne', OS_IDENTITY_API_VERSION: '3' };
  }
  function envVars() { var m = envMap(); return Object.keys(m).map(function (k) { return k + '=' + m[k]; }); }
  function source(f) {
    if (!f) { err('bash: source: filename argument required'); return; }
    var n = f.replace(/^(\.\/|~\/)/, '');
    var p = n === 'demo-openrc' || n === 'demo-openrc.sh' ? 'demo' : n === 'admin-openrc' || n === 'admin-openrc.sh' ? 'admin' : null;
    if (!p) { err('bash: ' + f + ': No such file or directory'); return; }
    W.project = p;
    W.tokenAt = 0;
    dim('# variabel OS_* terpasang. Perintah openstack sekarang jalan sebagai user ' + p + ' di project ' + p + '.');
    K.flash(app, 'keystone');
  }
  function ls(a) {
    var all = a.some(function (x) { return /^-\w*a/.test(x); });
    if (a.some(function (x) { return /\.ssh/.test(x); })) { out('id_ed25519  id_ed25519.pub  known_hosts'); return; }
    var names = ['admin-openrc', 'demo-openrc'].concat(Object.keys(W.files));
    if (a.some(function (x) { return /^-\w*l/.test(x); })) {
      out('total ' + (names.length * 4));
      if (all) out('drwx------ 2 kamu kamu 4096 ' + lsDate() + ' .ssh');
      names.forEach(function (n) { var f = W.files[n]; out((f ? modeStr(f.mode) : '-rw-r--r--') + ' 1 kamu kamu ' + (f ? ' 387' : ' 412') + ' ' + lsDate() + ' ' + n); });
      return;
    }
    out((all ? '.ssh  ' : '') + names.join('  '));
  }
  function lsDate() { var d = new Date(); return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()] + ' ' + pad(String(d.getDate()), 2) + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function modeStr(m) {
    return '-' + String(m).split('').map(function (d) { d = +d; return (d & 4 ? 'r' : '-') + (d & 2 ? 'w' : '-') + (d & 1 ? 'x' : '-'); }).join('');
  }
  function cat(f) {
    if (!f) { dim('# cat NAMA_FILE'); return; }
    var n = f.replace(/^(\.\/)/, '');
    if (/^(demo|admin)-openrc(\.sh)?$/.test(n)) {
      var r = OPENRC[n.split('-')[0]];
      ['export OS_AUTH_URL=http://controller:5000/v3', 'export OS_PROJECT_NAME=' + r.project, 'export OS_USERNAME=' + r.user, 'export OS_PASSWORD=' + r.pass, 'export OS_USER_DOMAIN_NAME=Default', 'export OS_PROJECT_DOMAIN_NAME=Default', 'export OS_REGION_NAME=RegionOne', 'export OS_IDENTITY_API_VERSION=3'].forEach(out);
      return;
    }
    if (/id_ed25519\.pub$/.test(n)) { out('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI' + digest('laptop key').slice(0, 43) + ' kamu@laptop'); return; }
    if (W.files[n]) { pem().forEach(out); return; }
    if (/id_ed25519$/.test(n)) { dim('# itu private key kamu. Jangan dipamerkan, bahkan di simulasi :)'); return; }
    err('cat: ' + f + ': No such file or directory');
  }
  function pem() {
    var d = digest('pem' + W.run) + digest('pem2' + W.run);
    return ['-----BEGIN OPENSSH PRIVATE KEY-----', 'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW', d.slice(0, 70), d.slice(70, 128) + '… (dipotong, ini kunci bohongan)', '-----END OPENSSH PRIVATE KEY-----'];
  }
  function chmod(mode, f) {
    if (!mode || !f) { err('chmod: missing operand'); return; }
    var n = f.replace(/^\.\//, '');
    if (!W.files[n]) { err("chmod: cannot access '" + f + "': No such file or directory"); return; }
    if (/^[0-7]{3,4}$/.test(mode)) W.files[n].mode = mode.slice(-3);
    else if (mode === 'go-rwx' || mode === 'og-rwx') W.files[n].mode = W.files[n].mode[0] + '00';
    else if (mode === 'u=r' || mode === '400') W.files[n].mode = '400';
    else { err("chmod: invalid mode: '" + mode + "'"); return; }
  }

  // ---------- openstack ----------
  var RES = ['security group rule', 'security group', 'floating ip', 'console log', 'console url', 'compute service', 'network agent', 'availability zone', 'role assignment',
    'server', 'network', 'subnet', 'router', 'port', 'keypair', 'flavor', 'image', 'volume', 'token', 'catalog', 'quota', 'limits', 'project', 'user', 'hypervisor', 'endpoint'];
  function osc(a) {
    if (!a.length || a[0] === 'help' || a[0] === '--help' || a[0] === '-h') { help(); return; }
    if (a[0] === '--version') { out('openstack 7.2.1'); return; }
    if (!W.project) throw E('Missing value auth-url required for auth plugin password', '# OpenStack belum tahu kamu siapa. Jalankan dulu: source demo-openrc');
    var r = null;
    for (var i = 0; i < RES.length; i++) {
      var p = RES[i].split(' ');
      if (p.every(function (x, j) { return a[j] === x; })) { r = RES[i]; a = a.slice(p.length); break; }
    }
    if (!r) throw E("openstack: '" + a.join(' ') + "' is not an openstack command. See 'openstack --help'.");
    K.pulse(app, 'token');
    var act = a[0], P = parse(a.slice(1));
    var fn = {
      'token': cToken, 'catalog': cCatalog, 'endpoint': cEndpoint, 'project': cProject, 'user': cUser, 'role assignment': cRole,
      'flavor': cFlavor, 'image': cImage, 'server': cServer, 'network': cNetwork, 'subnet': cSubnet, 'router': cRouter,
      'port': cPort, 'floating ip': cFip, 'security group': cSg, 'security group rule': cRule, 'keypair': cKey,
      'volume': cVolume, 'quota': cQuota, 'limits': cLimits, 'hypervisor': cHyper, 'compute service': cCompute,
      'network agent': cAgent, 'console log': cConsole, 'console url': cConsoleUrl, 'availability zone': cAz
    }[r];
    fn(act, P, a.slice(1));
  }
  function bad(r, act) { throw E("openstack: '" + r + ' ' + (act || '') + "' is not an openstack command. See 'openstack --help'."); }
  function adminOnly(rule) {
    if (W.project !== 'admin') throw H('Policy doesn\'t allow ' + rule + ' to be performed.', 403, '# perintah ini cuma buat admin. Coba source admin-openrc.');
  }

  function cToken(act, P) {
    if (act !== 'issue') bad('token', act);
    W.tokenAt = Date.now();
    fv([['expires', iso(Date.now() + 3600e3)], ['id', 'gAAAAAB' + digest('tok' + Date.now()).slice(0, 40) + '…'], ['project_id', PROJ_ID[W.project]], ['user_id', USER_ID[W.project]]], P);
    K.flash(app, 'keystone');
    if (W.project === 'demo') M.hit('login');
    else hint('# kamu login sebagai admin. Misi login dihitung kalau pakai project demo.');
  }
  var SERVICES = [['keystone', 'identity', 'http://controller:5000/v3/'], ['nova', 'compute', 'http://controller:8774/v2.1'], ['neutron', 'network', 'http://controller:9696'], ['glance', 'image', 'http://controller:9292'], ['cinderv3', 'volumev3', 'http://controller:8776/v3/' + 'PROJ'], ['placement', 'placement', 'http://controller:8778']];
  function cCatalog(act, P) {
    if (act !== 'list') bad('catalog', act);
    table([['Name', 'Type', 'Endpoints']].concat(SERVICES.map(function (s) {
      var u = s[2].replace('PROJ', PROJ_ID[W.project]);
      return [s[0], s[1], 'RegionOne\n  public: ' + u + '\nRegionOne\n  internal: ' + u + '\nRegionOne\n  admin: ' + u];
    })), P);
    dim('# tiap service punya endpoint sendiri. Perintah openstack mencari alamatnya di katalog ini, lalu memanggil API-nya pakai token.');
  }
  function cEndpoint(act, P) {
    if (act !== 'list') bad('endpoint', act);
    adminOnly('identity:list_endpoints');
    var rows = [['ID', 'Region', 'Service Name', 'Service Type', 'Enabled', 'Interface', 'URL']];
    SERVICES.forEach(function (s) { ['public', 'internal', 'admin'].forEach(function (i) { rows.push([hexid(s[0] + i), 'RegionOne', s[0], s[1], 'True', i, s[2].replace('PROJ', '%(project_id)s')]); }); });
    table(rows, P);
  }
  function cProject(act, P) {
    if (act === 'list') {
      if (W.project !== 'admin') throw H('You are not authorized to perform the requested action: identity:list_projects.', 403, '# user demo cuma boleh lihat project-nya sendiri. Coba source admin-openrc.');
      table([['ID', 'Name'], [PROJ_ID.admin, 'admin'], [PROJ_ID.demo, 'demo'], [hexid('service'), 'service']], P);
      return;
    }
    if (act === 'show') {
      var n = P.pos[0] || W.project;
      if (n !== W.project && W.project !== 'admin') throw H('You are not authorized to perform the requested action: identity:get_project.', 403);
      if (!PROJ_ID[n]) throw E('No project with a name or ID of \'' + n + '\' exists.');
      fv([['description', n === 'demo' ? 'Project buat latihan' : 'Bootstrap project for initializing the cloud.'], ['domain_id', 'default'], ['enabled', 'True'], ['id', PROJ_ID[n]], ['is_domain', 'False'], ['name', n], ['options', '{}'], ['parent_id', 'default'], ['tags', '[]']], P);
      return;
    }
    if (act === 'create') { adminOnly('identity:create_project'); dim('# simulasi ini cuma punya project demo dan admin'); return; }
    bad('project', act);
  }
  function cUser(act, P) {
    if (act !== 'list') bad('user', act);
    if (W.project !== 'admin') throw H('You are not authorized to perform the requested action: identity:list_users.', 403);
    table([['ID', 'Name'], [USER_ID.admin, 'admin'], [USER_ID.demo, 'demo'], [hexid('nova'), 'nova'], [hexid('neutron'), 'neutron'], [hexid('glance'), 'glance'], [hexid('cinder'), 'cinder'], [hexid('placement'), 'placement']], P);
  }
  function cRole(act, P) {
    if (act !== 'list') bad('role assignment', act);
    table([['Role', 'User', 'Group', 'Project', 'Domain', 'System', 'Inherited'], ['member', W.project + '@Default', '', W.project + '@Default', '', '', 'False']].concat(W.project === 'admin' ? [['admin', 'admin@Default', '', 'admin@Default', '', '', 'False']] : []), P);
  }
  function cAz(act, P) {
    if (act !== 'list') bad('availability zone', act);
    table([['Zone Name', 'Zone Status'], ['nova', 'available'], ['nova', 'available']], P);
  }

  function cFlavor(act, P) {
    if (act === 'list') { table([['ID', 'Name', 'RAM', 'Disk', 'Ephemeral', 'VCPUs', 'Is Public']].concat(FLAVORS.map(function (f) { return [f.id, f.name, f.ram, f.disk, 0, f.vcpu, 'True']; })), P); return; }
    if (act === 'show') {
      var f = find(FLAVORS, P.pos[0], 'Flavor', 'flavor');
      fv([['OS-FLV-DISABLED:disabled', 'False'], ['OS-FLV-EXT-DATA:ephemeral', '0'], ['disk', f.disk], ['id', f.id], ['name', f.name], ['os-flavor-access:is_public', 'True'], ['ram', f.ram], ['rxtx_factor', '1.0'], ['swap', '0'], ['vcpus', f.vcpu]], P);
      return;
    }
    if (act === 'create' || act === 'delete') { adminOnly('os_compute_api:os-flavor-manage:' + act); dim('# flavor di simulasi ini tetap lima itu saja'); return; }
    bad('flavor', act);
  }
  function cImage(act, P) {
    if (act === 'list') { table([['ID', 'Name', 'Status']].concat(W.images.map(function (i) { return [i.id, i.name, 'active']; })), P); return; }
    if (act === 'show') {
      var i = find(W.images, P.pos[0], 'Image', 'image');
      fv([['container_format', 'bare'], ['created_at', iso(Date.now() - 86400e3 * 9)], ['disk_format', i.fmt], ['id', i.id], ['min_disk', i.minDisk], ['min_ram', '0'], ['name', i.name], ['os_distro', i.user], ['owner', PROJ_ID.admin], ['protected', 'False'], ['size', Math.round(i.size * 1073741824)], ['status', 'active'], ['visibility', 'public']], P);
      if (i.minDisk > 1) dim('# min_disk ' + i.minDisk + ' GB: flavor dengan disk lebih kecil (m1.tiny) bakal ditolak untuk image ini.');
      return;
    }
    if (act === 'create') { dim('# upload image belum didukung di simulasi. Pakai salah satu dari openstack image list.'); return; }
    bad('image', act);
  }

  // ---------- servers ----------
  function myServers() { return mine(W.servers); }
  function findServer(r) { return find(myServers(), r, 'Server', 'server'); }
  function addrs(s) {
    var by = {};
    s.nics.forEach(function (n) {
      var net = W.nets.filter(function (x) { return x.id === n.net; })[0];
      var nm = net ? net.name : n.net;
      (by[nm] = by[nm] || []).push(n.ip);
      var f = fipOfPort(n.port);
      if (f) by[nm].push(f.ip);
    });
    return Object.keys(by).map(function (k) { return k + '=' + by[k].join(', '); }).join('; ');
  }
  function cServer(act, P, raw) {
    if (act === 'list') {
      var all = P.has('all-projects');
      if (all) adminOnly('os_compute_api:servers:index:get_all_tenants');
      var list = all ? W.servers : myServers();
      var rows = [['ID', 'Name', 'Status', 'Networks', 'Image', 'Flavor']];
      if (P.has('long')) rows[0] = rows[0].concat(['Host', 'Project ID']);
      list.slice().reverse().forEach(function (s) {
        var r = [s.id, s.name, s.status, addrs(s), s.image.name, s.flavor.name];
        if (P.has('long')) r = r.concat([s.host || '', PROJ_ID[s.project]]);
        rows.push(r);
      });
      table(rows, P, all ? '# belum ada server di project mana pun' : '# belum ada server di project ' + W.project);
      return;
    }
    if (act === 'create') { serverCreate(P); return; }
    if (act === 'show') { serverShow(findServer(P.pos[0]), P); return; }
    if (act === 'delete') {
      if (!P.pos.length) throw argErr('server delete', '<server>');
      P.pos.forEach(function (n) {
        var s = findServer(n);
        s.task = 'deleting'; s.until = Date.now() + DEL_MS;
      });
      K.pulse(app, 'port');
      return;
    }
    if (act === 'stop' || act === 'start' || act === 'reboot') {
      if (!P.pos.length) throw argErr('server ' + act, '<server>');
      P.pos.forEach(function (n) {
        var s = findServer(n);
        if (s.task === 'deleting') throw H('Cannot \'' + act + '\' instance ' + s.id + ' while it is in task_state deleting', 409);
        if (act === 'stop' && s.status !== 'ACTIVE') throw H('Cannot \'stop\' instance ' + s.id + ' while it is in vm_state ' + s.status.toLowerCase(), 409);
        if (act === 'start' && s.status !== 'SHUTOFF') throw H('Cannot \'start\' instance ' + s.id + ' while it is in vm_state ' + (s.status === 'ACTIVE' ? 'active' : s.status.toLowerCase()), 409);
        if (act === 'reboot' && s.status !== 'ACTIVE') throw H('Cannot \'reboot\' instance ' + s.id + ' while it is in vm_state ' + s.status.toLowerCase(), 409);
        s.task = act === 'stop' ? 'powering-off' : act === 'start' ? 'powering-on' : 'rebooting';
        if (act === 'reboot') s.status = 'REBOOT';
        s.until = Date.now() + POWER_MS;
      });
      return;
    }
    if (act === 'add' || act === 'remove') {
      var what = raw.slice(0, 2).join(' ');
      if (what === 'floating ip') { fipServer(act, parse(raw.slice(2))); return; }
      if (what === 'security group') { sgServer(act, parse(raw.slice(2))); return; }
      if (raw[0] === 'volume') { volServer(act, parse(raw.slice(1))); return; }
      if (raw[0] === 'port' || raw[0] === 'network') { dim('# hot-plug NIC belum didukung. Pilih network-nya waktu server create.'); return; }
      bad('server ' + act, raw[0]);
    }
    if (act === 'rebuild' || act === 'resize') { dim('# server ' + act + ' belum didukung di simulasi. Hapus lalu bikin ulang servernya.'); return; }
    if (act === 'ssh') { dim('# openstack server ssh ada, tapi di sini pakai ssh biasa ke floating IP-nya'); return; }
    bad('server', act);
  }
  function serverCreate(P) {
    var name = P.pos[0];
    if (!name) throw argErr('server create', '<server-name>');
    if (!P.get('flavor')) throw E('openstack server create: error: the following arguments are required: --flavor');
    if (!P.get('image') && !P.get('volume')) throw E('An image (--image, --image-property) or bootable volume (--volume, --snapshot) is required');
    if (P.get('volume')) throw E('boot dari volume belum didukung di simulasi', '# pakai --image ubuntu-24.04');
    var fl = flavorBy(P.get('flavor'));
    if (!fl) throw E('No Flavor found for ' + P.get('flavor'), '# lihat pilihan: openstack flavor list');
    var im = W.images.filter(function (i) { return i.name === P.get('image') || i.id === P.get('image'); })[0];
    if (!im) throw E('No Image found for ' + P.get('image'), '# lihat pilihan: openstack image list');
    var refs = P.all('network').slice();
    P.all('nic').forEach(function (v) {
      if (v === 'none' || v === 'auto') return;
      var m = /net-id=([^,]+)/.exec(v);
      if (!m) throw E('Invalid --nic argument \'' + v + '\'. Nic arguments must be of the form --nic <auto,none,net-id=net-uuid,port-id=port-uuid>.');
      refs.push(m[1]);
    });
    var nets = refs.map(function (r) { return find(visibleNets(), r, 'Network', 'network'); });
    if (!nets.length && P.get('nic') !== 'none') {
      var cand = visibleNets().filter(function (n) { return !n.ext; });
      if (cand.length > 1) throw H('Multiple possible networks found, use a Network ID to be more specific.', 409, '# project kamu punya lebih dari satu network. Tambahkan --network NAMA.');
      if (!cand.length) throw H('It is not allowed to create an interface on external network ' + pub().id, 403, '# network yang kelihatan cuma public (eksternal). Bikin network privat dulu: openstack network create net-app');
      nets = cand;
    }
    nets.forEach(function (n) {
      if (n.ext && W.project !== 'admin') throw H('It is not allowed to create an interface on external network ' + n.id, 403, '# server ga dipasang langsung ke public. Pasang ke network privat, lalu kasih floating IP.');
      if (!subnetsOf(n).length) throw H('Network ' + n.id + ' requires a subnet in order to boot instances on.', 400, '# network ' + n.name + ' belum punya subnet. Bikin dulu: openstack subnet create --network ' + n.name + ' --subnet-range 10.0.0.0/24 sub-app');
    });
    var key = null;
    if (P.get('key-name')) {
      key = mine(W.keys).filter(function (k) { return k.name === P.get('key-name'); })[0];
      if (!key) throw H('Invalid key_name provided.', 400, '# keypair ' + P.get('key-name') + ' belum ada. Cek: openstack keypair list');
    }
    var sgs = P.all('security-group').length ? P.all('security-group') : ['default'];
    var sgObjs = sgs.map(function (g) {
      var o = mine(W.sgs).filter(function (x) { return x.name === g || x.id === g; });
      if (!o.length) throw H('Security group ' + g + ' not found for project ' + PROJ_ID[W.project] + '.', 400);
      return o[0];
    });
    if (fl.disk < im.minDisk) throw H('Flavor\'s disk is too small for requested image. Flavor disk is ' + fl.disk * 1073741824 + ' bytes, image is ' + im.minDisk * 1073741824 + ' bytes.', 400, '# image ' + im.name + ' butuh disk minimal ' + im.minDisk + ' GB. Pilih flavor yang lebih besar, misal m1.small.');
    var q = W.quota[W.project], u = usage(W.project);
    if (u.instances + 1 > q.instances) throw H('Quota exceeded for instances: Requested 1, but already used ' + u.instances + ' of ' + q.instances + ' instances', 403);
    if (u.cores + fl.vcpu > q.cores) {
      if (W.project === 'demo') W.sawQuota = true;
      throw H('Quota exceeded for cores: Requested ' + fl.vcpu + ', but already used ' + u.cores + ' of ' + q.cores + ' cores', 403, '# quota vCPU project ' + W.project + ' cuma ' + q.cores + '. Hapus server lain, pakai flavor lebih kecil, atau minta admin menaikkan quota (openstack quota set --cores 16 ' + W.project + ').');
    }
    if (u.ram + fl.ram > q.ram) {
      if (W.project === 'demo') W.sawQuota = true;
      throw H('Quota exceeded for ram: Requested ' + fl.ram + ', but already used ' + u.ram + ' of ' + q.ram + ' ram', 403, '# quota RAM habis. Minta admin: openstack quota set --ram 32768 ' + W.project);
    }
    // the scheduler picks the compute node with the most free RAM that fits
    var host = HYPERS.map(function (h) { var x = hyperUse(h); return { h: h, free: h.ram * 1.5 - x.ram }; }).filter(function (c) { return c.free >= fl.ram; }).sort(function (a, b) { return b.free - a.free; })[0];
    var s = {
      id: uuid(), name: name, project: W.project, flavor: fl, image: im, status: 'BUILD', task: 'spawning', until: Date.now() + BOOT_MS,
      nics: [], sgs: sgObjs.map(function (g) { return g.id; }), key: key ? key.name : null, host: host ? host.h.name : null,
      keyPub: key ? key.pub : false, keyFp: key ? key.fp : null,
      vols: [], created: Date.now(), pass: digest('pw' + Math.random()).slice(0, 12).replace(/[0-9a-f]/g, function (c) { return 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[parseInt(c, 16) * 3 % 55]; }), fs: {}, mounts: {}
    };
    nets.forEach(function (n) {
      var sub = subnetsOf(n)[0];
      s.nics.push({ net: n.id, sub: sub.id, ip: n.ext ? nextFip() : nextIp(sub), mac: mac(), port: uuid() });
    });
    if (!host) { s.status = 'ERROR'; s.task = null; s.fault = 'No valid host was found. There are not enough hosts available.'; }
    W.servers.push(s);
    if (W.project === 'demo') W.hadServer = true;
    K.pulse(app, 'port'); K.flash(app, 'nova');
    var show = function () {
      fv([['OS-DCF:diskConfig', 'MANUAL'], ['OS-EXT-AZ:availability_zone', ''], ['OS-EXT-STS:power_state', 'NOSTATE'], ['OS-EXT-STS:task_state', s.task || ''], ['OS-EXT-STS:vm_state', s.status === 'ERROR' ? 'error' : s.status === 'ACTIVE' ? 'active' : 'building'],
        ['accessIPv4', ''], ['addresses', s.status === 'ACTIVE' ? addrs(s) : ''], ['adminPass', s.pass], ['created', iso(s.created)], ['flavor', fl.name + ' (' + fl.id + ')'], ['id', s.id], ['image', im.name + ' (' + im.id + ')'],
        ['key_name', s.key || 'None'], ['name', s.name], ['progress', s.status === 'ACTIVE' ? '0' : '0'], ['project_id', PROJ_ID[W.project]], ['security_groups', sgObjs.map(function (g) { return "name='" + g.name + "'"; }).join('\n')], ['status', s.status], ['updated', iso()], ['user_id', USER_ID[W.project]], ['volumes_attached', '']], P);
      if (s.status === 'ERROR') { err('# ' + s.fault); hint('# compute node penuh. Hapus server lain atau pakai flavor lebih kecil.'); }
      else if (s.status === 'BUILD') dim('# server lagi dibangun di ' + s.host + ' (status BUILD). Pantau dengan openstack server list.');
      if (!s.key && s.status !== 'ERROR') hint('# server ini dibuat tanpa --key-name. Nanti SSH pakai kunci bakal ditolak.');
    };
    if (P.has('wait') && s.status === 'BUILD') {
      W.busy = true;
      var run = W.run;
      term.play([[400, '<span class="sx-dim">Progress: 0</span>'], [1200, '<span class="sx-dim">Progress: 50</span>'], [BOOT_MS - 1500, function () {
        if (run !== W.run) return;
        s.until = 0; tick(); W.busy = false; show();
      }]]);
      return;
    }
    show();
  }
  function serverShow(s, P) {
    var admin = W.project === 'admin';
    var pairs = [['OS-DCF:diskConfig', 'MANUAL'], ['OS-EXT-AZ:availability_zone', 'nova']];
    if (admin) pairs.push(['OS-EXT-SRV-ATTR:host', s.host || 'None'], ['OS-EXT-SRV-ATTR:hypervisor_hostname', s.host ? s.host + '.lab' : 'None']);
    pairs.push(['OS-EXT-STS:power_state', s.status === 'ACTIVE' ? 'Running' : s.status === 'SHUTOFF' ? 'Shutdown' : 'NOSTATE'], ['OS-EXT-STS:task_state', s.task || 'None'], ['OS-EXT-STS:vm_state', s.status === 'SHUTOFF' ? 'stopped' : s.status.toLowerCase()],
      ['addresses', addrs(s)], ['created', iso(s.created)], ['flavor', 'disk=\'' + s.flavor.disk + '\', ephemeral=\'0\', original_name=\'' + s.flavor.name + '\', ram=\'' + s.flavor.ram + '\', swap=\'0\', vcpus=\'' + s.flavor.vcpu + '\'']);
    if (s.fault) pairs.push(['fault', "code='500', created='" + iso(s.created) + "', message='" + s.fault + "'"]);
    pairs.push(['hostId', s.host ? digest(s.host + s.project).slice(0, 56) : ''], ['id', s.id], ['image', s.image.name + ' (' + s.image.id + ')'], ['key_name', s.key || 'None'], ['name', s.name], ['project_id', PROJ_ID[s.project]],
      ['security_groups', s.sgs.map(function (id) { var g = W.sgs.filter(function (x) { return x.id === id; })[0]; return "name='" + (g ? g.name : id) + "'"; }).join('\n')], ['status', s.status], ['user_id', USER_ID[s.project]],
      ['volumes_attached', s.vols.map(function (id) { return "delete_on_termination='False', id='" + id + "'"; }).join('\n')]);
    fv(pairs, P);
    if (!admin) dim('# kolom host (compute node) cuma kelihatan oleh admin');
  }

  // ---------- networks ----------
  function cNetwork(act, P) {
    if (act === 'list') {
      var ext = P.has('external');
      table([['ID', 'Name', 'Subnets']].concat(visibleNets().filter(function (n) { return !ext || n.ext; }).map(function (n) { return [n.id, n.name, subnetsOf(n).map(function (s) { return s.id; }).join(', ')]; })), P);
      return;
    }
    if (act === 'create') {
      var name = P.pos[0];
      if (!name) throw argErr('network create', '<name>');
      if (P.has('external') || P.has('share')) adminOnly('create_network:' + (P.has('external') ? 'router:external' : 'shared'));
      var q = W.quota[W.project], u = usage(W.project);
      if (u.networks + 1 > q.networks) throw H('Quota exceeded for resources: [\'network\'].', 409);
      var n = { id: uuid(), name: name, project: W.project, ext: P.has('external'), shared: P.has('share'), created: Date.now() };
      W.nets.push(n);
      netShow(n, P);
      K.flash(app, 'neutron');
      dim('# network ini masih kosong. Kasih subnet supaya server bisa dapat IP.');
      return;
    }
    if (act === 'show') { netShow(find(visibleNets(), P.pos[0], 'Network', 'network'), P); return; }
    if (act === 'delete') {
      if (!P.pos.length) throw argErr('network delete', '<network>');
      P.pos.forEach(function (r) {
        var n = find(visibleNets(), r, 'Network', 'network');
        if (n.project !== W.project) throw E('Failed to delete network with name or ID \'' + r + '\': ForbiddenException: 403: Client Error for url: http://controller:9696/v2.0/networks/' + n.id + ', (rule:delete_network) is disallowed by policy');
        var subs = subnetsOf(n);
        if (subs.some(function (s) { return blockingPorts(s).length; })) {
          throw E('Failed to delete network with name or ID \'' + r + '\': ConflictException: 409: Client Error for url: http://controller:9696/v2.0/networks/' + n.id + ', Unable to complete operation on network ' + n.id + '. There are one or more ports still in use on the network.', '# masih ada port di network ini: ' + whoUses(subs) + '. Hapus server-nya dan lepas subnet dari router dulu.');
        }
        W.subnets = W.subnets.filter(function (s) { return s.net !== n.id; });
        W.nets = W.nets.filter(function (x) { return x !== n; });
      });
      return;
    }
    bad('network', act);
  }
  function whoUses(subs) {
    var o = [];
    subs.forEach(function (s) { blockingPorts(s).forEach(function (p) { o.push(p.server ? 'server ' + p.server.name : 'router ' + p.router.name); }); });
    return o.filter(function (x, i) { return o.indexOf(x) === i; }).join(', ');
  }
  function netShow(n, P) {
    fv([['admin_state_up', 'UP'], ['availability_zones', ''], ['created_at', iso(n.created)], ['id', n.id], ['mtu', n.ext ? '1500' : '1442'], ['name', n.name], ['port_security_enabled', 'True'], ['project_id', PROJ_ID[n.project]], ['provider:network_type', n.ext ? 'flat' : 'geneve'], ['router:external', n.ext ? 'External' : 'Internal'], ['shared', n.shared ? 'True' : 'False'], ['status', 'ACTIVE'], ['subnets', subnetsOf(n).map(function (s) { return s.id; }).join(', ')]], P);
  }
  function cSubnet(act, P) {
    var vis = W.subnets.filter(function (s) { return s.project === W.project || netOf(s).ext; });
    if (act === 'list') { table([['ID', 'Name', 'Network', 'Subnet']].concat(vis.map(function (s) { return [s.id, s.name, s.net, s.cidr.str]; })), P); return; }
    if (act === 'create') {
      var name = P.pos[0];
      if (!name) throw argErr('subnet create', '<name>');
      if (!P.get('network')) throw E('openstack subnet create: error: the following arguments are required: --network');
      var n = find(visibleNets(), P.get('network'), 'Network', 'network');
      if (n.project !== W.project) throw H('(rule:create_subnet and rule:create_subnet:network) is disallowed by policy', 403, '# network ' + n.name + ' milik project lain. Bikin network sendiri.');
      if (!P.get('subnet-range')) throw H('Bad subnets request: a subnetpool must be specified in the absence of a cidr.', 400, '# tambahkan --subnet-range, misal --subnet-range 10.0.0.0/24');
      var c = parseCidr(P.get('subnet-range'));
      if (!c) throw H('Invalid input for cidr. Reason: \'' + P.get('subnet-range') + '\' is not a valid IP subnet.', 400);
      if (c.pre < 16 || c.pre > 29) throw E('subnet /' + c.pre + ' ga didukung di simulasi', '# pakai prefix /16 sampai /29, misal 10.0.0.0/24');
      if (c.str !== P.get('subnet-range')) hint('# ' + P.get('subnet-range') + ' dinormalkan jadi ' + c.str);
      subnetsOf(n).forEach(function (s) { if (overlaps(s.cidr, c)) throw H('Invalid input for operation: Requested subnet with cidr: ' + c.str + ' for network: ' + n.id + ' overlaps with another subnet.', 400); });
      var gw = c.base + 1;
      if (P.get('gateway') === 'none') gw = null;
      else if (P.get('gateway')) {
        gw = ipToInt(P.get('gateway'));
        if (gw === null || !inCidr(P.get('gateway'), c)) throw H('Invalid input for operation: Gateway is not valid on subnet.', 400);
      }
      var s = { id: uuid(), name: name, net: n.id, project: W.project, cidr: c, gw: gw, next: 0, dhcp: !P.has('no-dhcp'), dns: P.all('dns-nameserver'), dhcpPort: uuid(), dhcpMac: mac() };
      W.subnets.push(s);
      subShow(s, P);
      K.flash(app, 'neutron');
      if (isPrivate(intToIp(c.base))) dim('# subnet privat. Server di sini dapat IP ' + intToIp(c.base + 2).replace(/\.\d+$/, '.x') + ', tapi belum bisa ke internet sampai disambung ke router.');
      else hint('# ' + c.str + ' bukan rentang privat. Untuk network project biasanya pakai 10.x, 172.16-31.x, atau 192.168.x.');
      return;
    }
    if (act === 'show') { subShow(find(vis, P.pos[0], 'Subnet', 'subnet'), P); return; }
    if (act === 'delete') {
      if (!P.pos.length) throw argErr('subnet delete', '<subnet>');
      P.pos.forEach(function (r) {
        var s = find(vis, r, 'Subnet', 'subnet');
        if (s.project !== W.project) throw H('(rule:delete_subnet) is disallowed by policy', 403);
        if (blockingPorts(s).length) throw E('Failed to delete subnet with name or ID \'' + r + '\': ConflictException: 409: Client Error for url: http://controller:9696/v2.0/subnets/' + s.id + ', Unable to complete operation on subnet ' + s.id + ': One or more ports have an IP allocation from this subnet.', '# subnet ini masih dipakai: ' + whoUses([s]) + '.');
        W.subnets = W.subnets.filter(function (x) { return x !== s; });
      });
      return;
    }
    bad('subnet', act);
  }
  function subShow(s, P) {
    var c = s.cidr;
    fv([['allocation_pools', intToIp(c.base + 2) + '-' + intToIp(c.base + c.size - 2)], ['cidr', c.str], ['created_at', iso()], ['dns_nameservers', (s.dns || []).join(', ')], ['enable_dhcp', s.dhcp ? 'True' : 'False'], ['gateway_ip', s.gw === null ? 'None' : intToIp(s.gw)], ['id', s.id], ['ip_version', '4'], ['name', s.name], ['network_id', s.net], ['project_id', PROJ_ID[s.project]]], P);
  }

  function cRouter(act, P, raw) {
    var list = mine(W.routers);
    if (act === 'list') { table([['ID', 'Name', 'Status', 'State', 'Project']].concat(list.map(function (r) { return [r.id, r.name, 'ACTIVE', 'UP', PROJ_ID[r.project]]; })), P); return; }
    if (act === 'create') {
      var name = P.pos[0];
      if (!name) throw argErr('router create', '<name>');
      var q = W.quota[W.project], u = usage(W.project);
      if (u.routers + 1 > q.routers) throw H('Quota exceeded for resources: [\'router\'].', 409);
      var r = { id: uuid(), name: name, project: W.project, gw: null, ifs: [], created: Date.now() };
      W.routers.push(r);
      if (P.get('external-gateway')) setGw(r, P.get('external-gateway'));
      routerShow(r, P);
      K.flash(app, 'neutron');
      if (!r.gw) dim('# router ini belum punya gateway ke internet. Lanjut: openstack router set --external-gateway public ' + name);
      return;
    }
    if (act === 'show') { routerShow(find(list, P.pos[0], 'Router', 'router'), P); return; }
    if (act === 'set') {
      var r2 = find(list, P.pos[0], 'Router', 'router');
      if (P.get('external-gateway')) { setGw(r2, P.get('external-gateway')); K.pulse(app, 'fip'); }
      else if (P.get('name')) r2.name = P.get('name');
      else dim('# ga ada yang diubah. Contoh: openstack router set --external-gateway public ' + r2.name);
      return;
    }
    if (act === 'unset') {
      var r3 = find(list, P.pos[0], 'Router', 'router');
      if (!P.has('external-gateway')) { dim('# contoh: openstack router unset --external-gateway ' + r3.name); return; }
      if (r3.gw && W.fips.some(function (f) { return f.port && r3.ifs.some(function (i) { return i.sub === f.sub; }); })) {
        throw H('Gateway cannot be updated for router ' + r3.id + ', since a gateway to external network ' + pub().id + ' is required by one or more floating IPs.', 409, '# lepas dulu floating IP dari server di belakang router ini.');
      }
      r3.gw = null;
      return;
    }
    if (act === 'add' || act === 'remove') {
      if (raw[0] !== 'subnet' && raw[0] !== 'port') bad('router ' + act, raw[0]);
      if (raw[0] === 'port') { dim('# di simulasi ini pakai: openstack router ' + act + ' subnet ROUTER SUBNET'); return; }
      var Q = parse(raw.slice(1));
      if (Q.pos.length < 2) throw argErr('router ' + act + ' subnet', '<router>, <subnet>');
      var rr = find(list, Q.pos[0], 'Router', 'router');
      var sb = find(mine(W.subnets), Q.pos[1], 'Subnet', 'subnet');
      if (act === 'add') {
        if (rr.ifs.some(function (f) { return f.sub === sb.id; })) throw H('Bad router request: Router already has a port on subnet ' + sb.id + '.', 400);
        rr.ifs.forEach(function (f) { var o = subById(f.sub); if (o && overlaps(o.cidr, sb.cidr)) throw H('Bad router request: Cidr ' + sb.cidr.str + ' of subnet ' + sb.id + ' overlaps with cidr ' + o.cidr.str + ' of subnet ' + o.id + '.', 400, '# dua subnet di router yang sama ga boleh tumpang tindih. Pakai rentang lain, misal 10.0.1.0/24.'); });
        if (sb.gw === null) throw H('Bad router request: Subnet ' + sb.id + ' does not have a gateway IP.', 400);
        if (allPorts().some(function (p) { return p.sub === sb && p.ip === intToIp(sb.gw); })) throw H('IP address ' + intToIp(sb.gw) + ' already allocated in subnet ' + sb.id, 409);
        rr.ifs.push({ sub: sb.id, ip: intToIp(sb.gw), mac: mac(), port: uuid() });
        K.pulse(app, 'port');
        dim('# router ' + rr.name + ' sekarang punya kaki di ' + sb.cidr.str + ' (IP ' + intToIp(sb.gw) + ', jadi gateway server di subnet itu).');
      } else {
        var idx = -1;
        rr.ifs.forEach(function (f, i) { if (f.sub === sb.id) idx = i; });
        if (idx < 0) throw H('Router ' + rr.id + ' has no interface on subnet ' + sb.id, 404);
        if (W.fips.some(function (f) { return f.port && f.sub === sb.id; })) throw H('Router interface for subnet ' + sb.id + ' on router ' + rr.id + ' cannot be deleted, as it is required by one or more floating IPs.', 409, '# lepas dulu floating IP dari server di subnet ini.');
        rr.ifs.splice(idx, 1);
      }
      return;
    }
    if (act === 'delete') {
      if (!P.pos.length) throw argErr('router delete', '<router>');
      P.pos.forEach(function (x) {
        var r4 = find(list, x, 'Router', 'router');
        if (r4.ifs.length) throw E('Failed to delete router with name or ID \'' + x + '\': ConflictException: 409: Client Error for url: http://controller:9696/v2.0/routers/' + r4.id + ', Router ' + r4.id + ' still has ports', '# lepas subnet-nya dulu: openstack router remove subnet ' + r4.name + ' ' + subById(r4.ifs[0].sub).name);
        W.routers = W.routers.filter(function (y) { return y !== r4; });
      });
      return;
    }
    bad('router', act);
  }
  function setGw(r, netRef) {
    var n = find(visibleNets(), netRef, 'Network', 'network');
    if (!n.ext) throw H('Bad router request: Network ' + n.id + ' is not an external network.', 400, '# gateway router harus ke network eksternal: public');
    if (r.gw) return;
    r.gw = { net: n.id, ip: nextFip(), mac: mac(), port: uuid() };
    dim('# router ' + r.name + ' dapat IP ' + r.gw.ip + ' di network public. Trafik keluar dari subnet di belakangnya di-SNAT lewat IP ini.');
  }
  function routerShow(r, P) {
    var info = r.gw ? '{"network_id": "' + r.gw.net + '", "external_fixed_ips": [{"ip_address": "' + r.gw.ip + '"}], "enable_snat": true}' : 'null';
    fv([['admin_state_up', 'UP'], ['created_at', iso(r.created)], ['external_gateway_info', info], ['id', r.id], ['interfaces_info', r.ifs.map(function (f) { return '{"port_id": "' + f.port + '", "ip_address": "' + f.ip + '", "subnet_id": "' + f.sub + '"}'; }).join('\n')], ['name', r.name], ['project_id', PROJ_ID[r.project]], ['status', 'ACTIVE']], P);
  }
  function cPort(act, P) {
    if (act !== 'list' && act !== 'show') bad('port', act);
    var ps = allPorts().filter(function (p) { return p.project === W.project || p.owner === 'network:router_gateway' && p.router.project === W.project; });
    if (act === 'show') {
      var p = find(ps.map(function (x) { x.name = ''; return x; }), P.pos[0], 'Port', 'port');
      fv([['device_owner', p.owner], ['fixed_ips', "ip_address='" + p.ip + "', subnet_id='" + p.sub.id + "'"], ['id', p.id], ['mac_address', p.mac], ['network_id', p.sub.net], ['status', p.status]], P);
      return;
    }
    var rows = [['ID', 'Name', 'MAC Address', 'Fixed IP Addresses', 'Status']];
    if (P.has('long')) rows[0].push('Device Owner');
    ps.forEach(function (p) { var r = [p.id, '', p.mac, "ip_address='" + p.ip + "', subnet_id='" + p.sub.id + "'", p.status]; if (P.has('long')) r.push(p.owner); rows.push(r); });
    table(rows, P, '# belum ada port');
    if (rows.length > 1 && !P.has('long')) dim('# tambah --long buat lihat pemilik tiap port (dhcp, router, atau server)');
  }

  // ---------- floating IPs ----------
  function cFip(act, P) {
    var list = mine(W.fips);
    if (act === 'list') {
      table([['ID', 'Floating IP Address', 'Fixed IP Address', 'Port', 'Floating Network', 'Project']].concat(list.map(function (f) { return [f.id, f.ip, f.fixed || 'None', f.port || 'None', pub().id, PROJ_ID[f.project]]; })), P, '# belum ada floating IP di project ini');
      return;
    }
    if (act === 'create') {
      if (!P.pos[0]) throw argErr('floating ip create', '<network>');
      var n = find(visibleNets(), P.pos[0], 'Network', 'network');
      if (!n.ext) throw H('Bad floatingip request: Network ' + n.id + ' is not a valid external network.', 400, '# floating IP diambil dari network eksternal: openstack floating ip create public');
      var q = W.quota[W.project], u = usage(W.project);
      if (u['floating-ips'] + 1 > q['floating-ips']) throw H('Quota exceeded for resources: [\'floatingip\'].', 409, '# quota floating IP project ini ' + q['floating-ips'] + '. Hapus yang ga dipakai: openstack floating ip delete IP');
      var f = { id: uuid(), ip: nextFip(), project: W.project, port: null, fixed: null, sub: null, created: Date.now() };
      W.fips.push(f);
      fv([['created_at', iso()], ['fixed_ip_address', 'None'], ['floating_ip_address', f.ip], ['floating_network_id', n.id], ['id', f.id], ['port_id', 'None'], ['project_id', PROJ_ID[W.project]], ['router_id', 'None'], ['status', 'DOWN']], P);
      dim('# IP publik ' + f.ip + ' sudah jadi milik project ' + W.project + ' (ngitung quota walau belum dipakai). Pasang ke server: openstack server add floating ip NAMA ' + f.ip);
      return;
    }
    if (act === 'delete') {
      if (!P.pos.length) throw argErr('floating ip delete', '<floating-ip>');
      P.pos.forEach(function (r) {
        var x = list.filter(function (y) { return y.ip === r || y.id === r; })[0];
        if (!x) throw E('Failed to delete floating_ip with ID \'' + r + '\': No FloatingIP found for ' + r);
        W.fips = W.fips.filter(function (y) { return y !== x; });
      });
      return;
    }
    if (act === 'show') {
      var y = list.filter(function (z) { return z.ip === P.pos[0] || z.id === P.pos[0]; })[0];
      if (!y) throw E('No FloatingIP found for ' + (P.pos[0] || ''));
      fv([['fixed_ip_address', y.fixed || 'None'], ['floating_ip_address', y.ip], ['id', y.id], ['port_id', y.port || 'None'], ['status', y.port ? 'ACTIVE' : 'DOWN']], P);
      return;
    }
    if (act === 'set' || act === 'unset') { dim('# di simulasi ini pakai openstack server add/remove floating ip NAMA IP'); return; }
    bad('floating ip', act);
  }
  function fipServer(act, P) {
    if (P.pos.length < 2) throw argErr('server ' + act + ' floating ip', '<server>, <ip-address>');
    var s = findServer(P.pos[0]);
    var f = mine(W.fips).filter(function (x) { return x.ip === P.pos[1] || x.id === P.pos[1]; })[0];
    if (!f) throw E('No FloatingIP found for ' + P.pos[1], '# alokasikan dulu: openstack floating ip create public');
    if (act === 'remove') {
      if (!s.nics.some(function (n) { return n.port === f.port; })) throw E('Floating IP ' + f.ip + ' ga terpasang di server ' + s.name);
      f.port = null; f.fixed = null; f.sub = null;
      return;
    }
    if (!s.nics.length) throw H('Instance network is not ready yet', 400);
    if (f.port) {
      if (s.nics.some(function (n) { return n.port === f.port; })) { dim('# floating IP itu sudah terpasang di ' + s.name); return; }
      throw H('Floating IP ' + f.id + ' is associated with port ' + f.port + '.', 409, '# IP itu sedang dipakai server lain. Lepas dulu atau alokasikan IP baru.');
    }
    var nic = s.nics.filter(function (n) { return P.get('fixed-ip-address') ? n.ip === P.get('fixed-ip-address') : true; })[0];
    if (!nic) throw E('server ga punya fixed IP ' + P.get('fixed-ip-address'));
    if (fipOfPort(nic.port)) throw H('Cannot associate floating IP ' + f.ip + ' (' + f.id + ') with port ' + nic.port + ' using fixed IP ' + nic.ip + ', as that fixed IP already has a floating IP on external network ' + pub().id + '.', 409);
    var sub = subById(nic.sub);
    if (!routerFor(sub)) {
      throw H('External network ' + pub().id + ' is not reachable from subnet ' + sub.id + '.  Therefore, cannot associate Port ' + nic.port + ' with a Floating IP.', 404, '# floating IP butuh router: subnet ' + sub.name + ' harus tersambung ke router yang punya gateway ke public.');
    }
    f.port = nic.port; f.fixed = nic.ip; f.sub = sub.id;
    K.pulse(app, 'fip');
    dim('# ' + f.ip + ' sekarang di-NAT router ' + routerFor(sub).name + ' ke ' + nic.ip + ' milik ' + s.name + '.');
  }

  // ---------- security groups ----------
  function findSg(r) { return find(mine(W.sgs), r, 'SecurityGroup', 'SecurityGroup'); }
  function ruleTxt(r) {
    var p = r.proto || 'any';
    return r.dir + ' ' + p + (r.port ? ' ' + (r.port[0] === r.port[1] ? r.port[0] : r.port[0] + ':' + r.port[1]) : '') + (r.remote ? ' dari ' + r.remote : r.group ? ' dari grup ' + r.group : '');
  }
  function cSg(act, P) {
    var list = mine(W.sgs);
    if (act === 'list') { table([['ID', 'Name', 'Description', 'Project', 'Tags']].concat(list.map(function (g) { return [g.id, g.name, g.desc, PROJ_ID[g.project], '[]']; })), P); return; }
    if (act === 'create') {
      var name = P.pos[0];
      if (!name) throw argErr('security group create', '<name>');
      var q = W.quota[W.project], u = usage(W.project);
      if (u.secgroups + 1 > q.secgroups) throw H('Quota exceeded for resources: [\'security_group\'].', 409);
      var g = { id: uuid(), name: name, project: W.project, desc: P.get('description') || name, rules: [
        { id: uuid(), dir: 'egress', eth: 'IPv4', proto: null, port: null, remote: null, group: null },
        { id: uuid(), dir: 'egress', eth: 'IPv6', proto: null, port: null, remote: null, group: null }] };
      W.sgs.push(g);
      sgShow(g, P);
      dim('# grup baru cuma mengizinkan trafik keluar. Buka port yang perlu: openstack security group rule create --protocol tcp --dst-port 22 ' + name);
      return;
    }
    if (act === 'show') { sgShow(findSg(P.pos[0]), P); return; }
    if (act === 'delete') {
      if (!P.pos.length) throw argErr('security group delete', '<group>');
      P.pos.forEach(function (r) {
        var g = findSg(r);
        if (g.name === 'default') throw H('Insufficient rights for removing default security group.', 409);
        if (W.servers.some(function (s) { return s.sgs.indexOf(g.id) >= 0; })) throw H('Security Group ' + g.id + ' in use.', 409, '# masih dipakai server. Lepas dulu: openstack server remove security group SERVER ' + g.name);
        W.sgs = W.sgs.filter(function (x) { return x !== g; });
      });
      return;
    }
    bad('security group', act);
  }
  function sgShow(g, P) {
    fv([['created_at', iso()], ['description', g.desc], ['id', g.id], ['name', g.name], ['project_id', PROJ_ID[g.project]], ['rules', g.rules.map(function (r) { return "direction='" + r.dir + "', ethertype='" + r.eth + "', id='" + r.id + "'" + (r.proto ? ", protocol='" + r.proto + "'" : '') + (r.port ? ", port_range_max='" + r.port[1] + "', port_range_min='" + r.port[0] + "'" : '') + (r.remote ? ", remote_ip_prefix='" + r.remote + "'" : '') + (r.group ? ", remote_group_id='" + r.group + "'" : ''); }).join('\n')]], P);
  }
  function cRule(act, P) {
    if (act === 'list') {
      var gs = P.pos[0] ? [findSg(P.pos[0])] : mine(W.sgs);
      var rows = [['ID', 'IP Protocol', 'Ethertype', 'IP Range', 'Port Range', 'Direction', 'Remote Security Group'].concat(P.pos[0] ? [] : ['Security Group'])];
      gs.forEach(function (g) {
        g.rules.forEach(function (r) {
          var row = [r.id, r.proto || 'None', r.eth, r.remote || (r.group ? 'None' : r.eth === 'IPv4' ? '0.0.0.0/0' : '::/0'), r.port ? r.port[0] + ':' + r.port[1] : '', r.dir, r.group ? (mine(W.sgs).filter(function (x) { return x.name === r.group; })[0] || {}).id || r.group : 'None'];
          if (!P.pos[0]) row.push(g.id);
          rows.push(row);
        });
      });
      table(rows, P);
      return;
    }
    if (act === 'create') {
      if (!P.pos[0]) throw argErr('security group rule create', '<group>');
      var g = findSg(P.pos[0]);
      var proto = P.get('protocol');
      if (proto === 'any' || proto === undefined || proto === true) proto = null;
      if (proto && ['tcp', 'udp', 'icmp'].indexOf(proto) < 0) throw H('Security group rule protocol ' + proto + ' not supported. Only protocol values [None, tcp, udp, icmp] and integer representations [0 to 255] are supported.', 400);
      var port = null;
      if (P.get('dst-port')) {
        var m = /^(\d+)(?::(\d+))?$/.exec(P.get('dst-port'));
        if (!m) throw E('argument --dst-port: Port range harus berbentuk 22 atau 8000:8080');
        if (!proto) throw H('Must also specify protocol if port range is given.', 400, '# tambahkan --protocol tcp');
        if (proto === 'icmp') throw E('--dst-port ga berlaku buat icmp');
        port = [+m[1], +(m[2] || m[1])];
      }
      var dir = P.has('egress') ? 'egress' : 'ingress';
      var remote = P.get('remote-ip') || null, grp = P.get('remote-group') || null;
      if (remote) { var c = parseCidr(/\//.test(remote) ? remote : remote + '/32'); if (!c) throw H('Invalid input for remote_ip_prefix. Reason: \'' + remote + '\' is not a valid IP subnet.', 400); remote = c.str; }
      if (!remote && !grp) remote = '0.0.0.0/0';
      var dup = g.rules.filter(function (r) { return r.dir === dir && r.eth === 'IPv4' && r.proto === proto && JSON.stringify(r.port) === JSON.stringify(port) && r.remote === remote && (r.group || null) === grp; })[0];
      if (dup) throw H('Security group rule already exists. Rule id is ' + dup.id + '.', 409);
      var nr = { id: uuid(), dir: dir, eth: 'IPv4', proto: proto, port: port, remote: remote, group: grp };
      g.rules.push(nr);
      fv([['direction', dir], ['ethertype', 'IPv4'], ['id', nr.id], ['port_range_max', port ? port[1] : 'None'], ['port_range_min', port ? port[0] : 'None'], ['protocol', proto || 'None'], ['remote_group_id', grp || 'None'], ['remote_ip_prefix', remote || 'None'], ['security_group_id', g.id]], P);
      dim('# rule berlaku langsung ke semua server yang memakai grup ' + g.name + ', tanpa restart.');
      return;
    }
    if (act === 'delete') {
      if (!P.pos.length) throw argErr('security group rule delete', '<rule>');
      P.pos.forEach(function (id) {
        var hit = false;
        mine(W.sgs).forEach(function (g) { var n = g.rules.length; g.rules = g.rules.filter(function (r) { return r.id !== id; }); if (g.rules.length !== n) hit = true; });
        if (!hit) throw E('Failed to delete rule with ID \'' + id + '\': No SecurityGroupRule found for ' + id);
      });
      return;
    }
    bad('security group rule', act);
  }
  function sgServer(act, P) {
    if (P.pos.length < 2) throw argErr('server ' + act + ' security group', '<server>, <group>');
    var s = findServer(P.pos[0]), g = findSg(P.pos[1]);
    if (act === 'add') {
      if (s.sgs.indexOf(g.id) >= 0) { dim('# ' + s.name + ' sudah pakai grup ' + g.name); return; }
      s.sgs.push(g.id);
    } else {
      if (s.sgs.indexOf(g.id) < 0) throw H('Security group ' + g.name + ' not associated with the instance ' + s.id, 404);
      s.sgs = s.sgs.filter(function (x) { return x !== g.id; });
    }
  }
  // does any security group on this server let this packet in?
  function allows(s, proto, port, fromIp) {
    return s.sgs.some(function (id) {
      var g = W.sgs.filter(function (x) { return x.id === id; })[0];
      return g && g.rules.some(function (r) {
        if (r.dir !== 'ingress' || r.eth !== 'IPv4' || r.group) return false;
        if (r.proto && r.proto !== proto) return false;
        if (r.port && proto !== 'icmp' && (port < r.port[0] || port > r.port[1])) return false;
        return !r.remote || inCidr(fromIp, r.remote);
      });
    });
  }

  // ---------- keypairs ----------
  function cKey(act, P) {
    var list = mine(W.keys);
    if (act === 'list') { table([['Name', 'Fingerprint', 'Type']].concat(list.map(function (k) { return [k.name, k.fp, 'ssh']; })), P, '# belum ada keypair'); return; }
    if (act === 'create') {
      var name = P.pos[0];
      if (!name) throw argErr('keypair create', '<name>');
      if (list.some(function (k) { return k.name === name; })) throw H('Key pair \'' + name + '\' already exists.', 409);
      var pubf = P.get('public-key'), k = { id: name, name: name, project: W.project, fp: '', pub: false, created: Date.now() };
      if (pubf) {
        if (!/^(~\/\.ssh\/|\/home\/kamu\/\.ssh\/|\.ssh\/)?id_ed25519\.pub$/.test(pubf)) throw E('Key file ' + pubf + ' not found', '# public key kamu ada di ~/.ssh/id_ed25519.pub');
        k.pub = true;
        k.fp = digest('laptop key').slice(0, 32).replace(/(..)(?!$)/g, '$1:');
        W.keys.push(k);
        fv([['created_at', iso()], ['fingerprint', k.fp], ['id', name], ['is_deleted', 'False'], ['name', name], ['type', 'ssh'], ['user_id', USER_ID[W.project]]], P);
        dim('# public key laptop kamu tersimpan di Nova. Private key-nya tetap cuma di laptop.');
      } else {
        k.fp = digest('gen' + name + Date.now()).slice(0, 32).replace(/(..)(?!$)/g, '$1:');
        W.keys.push(k);
        var dest = P.get('>');
        if (dest) {
          W.files[dest.replace(/^\.\//, '')] = { mode: '644', key: name, fp: k.fp };
          dim('# private key disimpan ke ' + dest + '. Ingat: OpenStack ga menyimpan salinannya. Hilang ya hilang.');
          hint('# izin file-nya masih 644. SSH bakal menolak kunci yang bisa dibaca orang lain: chmod 600 ' + dest);
        } else {
          pem().forEach(out);
          hint('# private key cuma ditampilkan sekali dan ga disimpan ke file. Biasanya: openstack keypair create ' + name + '2 > ' + name + '.pem');
        }
      }
      return;
    }
    if (act === 'show') { var k2 = find(list, P.pos[0], 'Keypair', 'keypair'); fv([['created_at', iso(k2.created)], ['fingerprint', k2.fp], ['id', k2.name], ['name', k2.name], ['type', 'ssh'], ['user_id', USER_ID[W.project]]], P); return; }
    if (act === 'delete') {
      if (!P.pos.length) throw argErr('keypair delete', '<key>');
      P.pos.forEach(function (r) { var k3 = find(list, r, 'Keypair', 'keypair'); W.keys = W.keys.filter(function (x) { return x !== k3; }); });
      dim('# server yang sudah jalan tetap menyimpan kuncinya. Keypair cuma dipakai saat boot.');
      return;
    }
    bad('keypair', act);
  }

  // ---------- volumes ----------
  function findVol(r) { return find(mine(W.vols), r, 'Volume', 'volume'); }
  function cVolume(act, P) {
    var list = mine(W.vols);
    if (act === 'list') {
      table([['ID', 'Name', 'Status', 'Size', 'Attached to']].concat(list.slice().reverse().map(function (v) { var s = srvById(v.server); return [v.id, v.name, v.status, v.size, s && v.status === 'in-use' ? 'Attached to ' + s.name + ' on ' + v.dev + ' ' : '']; })), P, '# belum ada volume');
      return;
    }
    if (act === 'create') {
      var name = P.pos[0];
      if (!name) throw argErr('volume create', '<name>');
      if (!P.get('size')) throw E('openstack volume create: error: --size is required unless --snapshot or --source is given');
      var sz = parseInt(P.get('size'), 10);
      if (!(sz > 0)) throw H('Invalid input received: Volume size \'' + P.get('size') + '\' must be an integer and greater than 0', 400);
      var q = W.quota[W.project], u = usage(W.project);
      if (u.volumes + 1 > q.volumes) throw H('VolumeLimitExceeded: Maximum number of volumes allowed (' + q.volumes + ') exceeded for quota \'volumes\'.', 413);
      if (u.gigabytes + sz > q.gigabytes) throw H('VolumeSizeExceedsAvailableQuota: Requested volume or snapshot exceeds allowed gigabytes quota. Requested ' + sz + 'G, quota is ' + q.gigabytes + 'G and ' + u.gigabytes + 'G has been consumed.', 413);
      var v = { id: uuid(), name: name, project: W.project, size: sz, status: 'creating', until: Date.now() + VOL_MS, server: null, dev: null, created: Date.now() };
      W.vols.push(v);
      fv([['attachments', '[]'], ['availability_zone', 'nova'], ['bootable', 'false'], ['created_at', iso()], ['id', v.id], ['multiattach', 'False'], ['name', name], ['size', sz], ['status', 'creating'], ['type', 'lvmdriver-1']], P);
      return;
    }
    if (act === 'show') {
      var x = findVol(P.pos[0]), s = srvById(x.server);
      fv([['attachments', s ? "[{'server_id': '" + s.id + "', 'device': '" + x.dev + "', 'volume_id': '" + x.id + "'}]" : '[]'], ['bootable', 'false'], ['id', x.id], ['name', x.name], ['size', x.size], ['status', x.status], ['type', 'lvmdriver-1']], P);
      return;
    }
    if (act === 'delete') {
      if (!P.pos.length) throw argErr('volume delete', '<volume>');
      P.pos.forEach(function (r) {
        var y = findVol(r);
        if (y.status !== 'available' && y.status !== 'error') throw E('Failed to delete volume with name or ID \'' + r + '\': Invalid volume: Volume status must be available or error or error_restoring or error_extending or error_managing and must not be migrating, attached, belong to a group, have snapshots or be disassociated from snapshots after volume transfer. (HTTP 400) (Request-ID: req-' + uuid() + ')', y.status === 'in-use' ? '# volume masih terpasang. Lepas dulu: openstack server remove volume ' + srvById(y.server).name + ' ' + y.name : null);
        y.status = 'deleting'; y.until = Date.now() + VOL_MS;
      });
      return;
    }
    if (act === 'set' || act === 'extend') { dim('# resize volume belum didukung di simulasi'); return; }
    bad('volume', act);
  }
  function volServer(act, P) {
    if (P.pos.length < 2) throw argErr('server ' + act + ' volume', '<server>, <volume>');
    var s = findServer(P.pos[0]), v = findVol(P.pos[1]);
    if (act === 'add') {
      if (v.status === 'in-use') throw H('Invalid volume: volume ' + v.id + ' is already attached', 400);
      if (v.status !== 'available') throw H('Invalid volume: Volume ' + v.id + ' status must be available or downloading, but current status is: ' + v.status + '.', 400, v.status === 'creating' ? '# volume-nya masih dibuat. Tunggu sebentar.' : null);
      if (s.status !== 'ACTIVE' && s.status !== 'SHUTOFF') throw H('Cannot \'attach_volume\' instance ' + s.id + ' while it is in vm_state ' + s.status.toLowerCase(), 409);
      var used = { vda: 1 };
      s.vols.forEach(function (id) { var o = volById(id); if (o && o.dev) used[o.dev.slice(5)] = 1; });
      var dev = 'vd' + 'bcdefgh'.split('').filter(function (c) { return !used['vd' + c]; })[0];
      v.status = 'attaching'; v.until = Date.now() + ATTACH_MS; v.server = s.id; v.dev = '/dev/' + dev;
      s.vols.push(v.id);
      fv([['ID', v.id], ['Server ID', s.id], ['Volume ID', v.id], ['Device', v.dev], ['Tag', 'None'], ['Delete On Termination', 'False']], P);
      dim('# volume dipasang sebagai ' + v.dev + '. Di dalam server, cek dengan lsblk. Belum ada filesystem-nya, jadi perlu mkfs dulu sebelum di-mount.');
    } else {
      if (v.server !== s.id) throw H('Volume ' + v.id + ' is not attached to server ' + s.id, 400);
      if (s.mounts[v.dev]) hint('# ' + v.dev + ' masih ter-mount di ' + s.mounts[v.dev] + '. Di server beneran, umount dulu biar data ga rusak.');
      delete s.mounts[v.dev];
      v.status = 'detaching'; v.until = Date.now() + ATTACH_MS;
    }
  }

  // ---------- quota & admin ----------
  function cQuota(act, P) {
    if (act === 'show') {
      var p = P.pos[0] || W.project;
      if (!W.quota[p]) throw E('No project with a name or ID of \'' + p + '\' exists.');
      if (p !== W.project && W.project !== 'admin') throw H('Policy doesn\'t allow os_compute_api:os-quota-sets:show to be performed.', 403);
      var q = W.quota[p];
      table([['Resource', 'Limit'], ['cores', q.cores], ['instances', q.instances], ['ram', q.ram], ['volumes', q.volumes], ['gigabytes', q.gigabytes], ['floating-ips', q['floating-ips']], ['networks', q.networks], ['routers', q.routers], ['secgroups', q.secgroups], ['ports', 500], ['subnets', 100], ['key-pairs', 100]], P);
      if (P.has('usage')) dim('# pemakaian: lihat openstack limits show --absolute');
      return;
    }
    if (act === 'set') {
      if (W.project !== 'admin') throw H('Policy doesn\'t allow os_compute_api:os-quota-sets:update to be performed.', 403, '# cuma admin yang boleh mengubah quota. Coba source admin-openrc.');
      var t = P.pos[0];
      if (!t) throw argErr('quota set', '<project>');
      if (!W.quota[t]) throw E('No project with a name or ID of \'' + t + '\' exists.');
      var keys = ['cores', 'instances', 'ram', 'volumes', 'gigabytes', 'floating-ips', 'networks', 'routers', 'secgroups'], any = false;
      keys.forEach(function (k) {
        if (P.get(k) === undefined) return;
        var v = parseInt(P.get(k), 10);
        if (!(v >= -1)) throw E('argument --' + k + ': invalid int value: \'' + P.get(k) + '\'');
        var u = usage(t)[k];
        if (v !== -1 && v < u) throw H('Quota value ' + v + ' for ' + k + ' is less than already used and reserved ' + u, 400);
        W.quota[t][k] = v === -1 ? 99999 : v;
        any = true;
      });
      if (!any) { dim('# contoh: openstack quota set --cores 16 demo'); return; }
      dim('# quota project ' + t + ' diubah. Berlaku langsung' + (t !== W.project ? '. Balik ke user demo: source demo-openrc' : '') + '.');
      return;
    }
    bad('quota', act);
  }
  function cLimits(act, P) {
    if (act !== 'show') bad('limits', act);
    var q = W.quota[W.project], u = usage(W.project);
    table([['Name', 'Value'], ['maxTotalCores', q.cores], ['maxTotalInstances', q.instances], ['maxTotalRAMSize', q.ram], ['maxTotalFloatingIps', q['floating-ips']], ['maxSecurityGroups', q.secgroups], ['maxTotalKeypairs', 100], ['totalCoresUsed', u.cores], ['totalInstancesUsed', u.instances], ['totalRAMUsed', u.ram], ['totalFloatingIpsUsed', u['floating-ips']], ['totalSecurityGroupsUsed', u.secgroups]], P);
  }
  function cHyper(act, P) {
    adminOnly('os_compute_api:os-hypervisors:list');
    if (act === 'list') { table([['ID', 'Hypervisor Hostname', 'Hypervisor Type', 'Host IP', 'State']].concat(HYPERS.map(function (h) { return [hexid(h.name).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5'), h.name + '.lab', 'QEMU', h.ip, 'up']; })), P); return; }
    if (act === 'show') {
      var h = HYPERS.filter(function (x) { return x.name === P.pos[0] || x.name + '.lab' === P.pos[0]; })[0];
      if (!h) throw E('No hypervisor with a name or ID of \'' + (P.pos[0] || '') + '\' exists.');
      var x = hyperUse(h);
      fv([['hypervisor_hostname', h.name + '.lab'], ['host_ip', h.ip], ['running_vms', x.n], ['vcpus', h.vcpu], ['vcpus_used', x.vcpu], ['memory_mb', h.ram], ['memory_mb_used', x.ram + 512], ['state', 'up'], ['status', 'enabled']], P);
      return;
    }
    if (act === 'stats') { var a = HYPERS.reduce(function (o, hh) { var y = hyperUse(hh); o.v += y.vcpu; o.r += y.ram; o.n += y.n; return o; }, { v: 0, r: 0, n: 0 }); fv([['count', 2], ['vcpus', 32], ['vcpus_used', a.v], ['memory_mb', 65536], ['memory_mb_used', a.r + 1024], ['running_vms', a.n]], P); return; }
    bad('hypervisor', act);
  }
  function cCompute(act, P) {
    if (act !== 'list') bad('compute service', act);
    adminOnly('os_compute_api:os-services:list');
    table([['ID', 'Binary', 'Host', 'Zone', 'Status', 'State', 'Updated At'], ['1', 'nova-scheduler', 'controller', 'internal', 'enabled', 'up', iso()], ['2', 'nova-conductor', 'controller', 'internal', 'enabled', 'up', iso()], ['5', 'nova-compute', 'compute1', 'nova', 'enabled', 'up', iso()], ['6', 'nova-compute', 'compute2', 'nova', 'enabled', 'up', iso()]], P);
  }
  function cAgent(act, P) {
    if (act !== 'list') bad('network agent', act);
    adminOnly('get_agent');
    table([['ID', 'Agent Type', 'Host', 'Availability Zone', 'Alive', 'State', 'Binary'], [hexid('a1').slice(0, 8), 'OVN Controller Gateway agent', 'controller', '', ':-)', 'UP', 'ovn-controller'], [hexid('a2').slice(0, 8), 'OVN Controller agent', 'compute1', '', ':-)', 'UP', 'ovn-controller'], [hexid('a3').slice(0, 8), 'OVN Controller agent', 'compute2', '', ':-)', 'UP', 'ovn-controller'], [hexid('a4').slice(0, 8), 'OVN Metadata agent', 'compute1', '', ':-)', 'UP', 'neutron-ovn-metadata-agent']], P);
  }
  function cConsole(act, P) {
    if (act !== 'show') bad('console log', act);
    var s = findServer(P.pos[0]);
    if (s.status === 'BUILD') { dim('# server masih booting, log-nya belum ada'); return; }
    if (s.status === 'ERROR') { err('# server ERROR: ' + s.fault); return; }
    var n = s.nics[0];
    var L = ['[    0.000000] Linux version ' + s.image.kernel + ' (buildd@lcy02-amd64) #1 SMP', '[    0.000000] Command line: BOOT_IMAGE=/vmlinuz root=LABEL=cloudimg-rootfs ro console=tty1 console=ttyS0', '[    1.204411] virtio_net virtio0 ens3: renamed from eth0'];
    L.push('[   ' + rnd(5, 9) + '.' + rnd(100000, 999999) + '] cloud-init[612]: Cloud-init v. 24.3.1 running \'init\'');
    L.push('ci-info: ++++++++++++++++++++++++Net device info+++++++++++++++++++++++++');
    if (n) L.push('ci-info: | ens3   | True |  ' + n.ip + '  | ' + n.mac + ' |');
    L.push('ci-info: +--------+------+---------------+-------------------+');
    if (s.key) L.push('ci-info: ++++++Authorized keys from /home/' + s.image.user + '/.ssh/authorized_keys for user ' + s.image.user + '+++++++', 'ci-info: | ssh-ed25519 | ' + (mine(W.keys).filter(function (k) { return k.name === s.key; })[0] || { fp: s.key }).fp.slice(0, 23) + '… | ' + s.key + ' |');
    else L.push('ci-info: no authorized SSH keys fingerprints found for user ' + s.image.user + '.');
    L.push('<14>' + s.name + ' cloud-init: #############################################################', '-----BEGIN SSH HOST KEY FINGERPRINTS-----', '256 SHA256:' + digest(s.id).slice(0, 43) + ' root@' + s.name + ' (ED25519)', '-----END SSH HOST KEY FINGERPRINTS-----');
    L.push('Cloud-init v. 24.3.1 finished. Datasource DataSourceOpenStackLocal [net,ver=2].', '', s.image.os + ' ' + s.name + ' ttyS0', '', s.name + ' login:');
    L.forEach(out);
    dim('# console log berguna kalau SSH gagal: kelihatan apakah server dapat IP dan kuncinya ikut terpasang.');
  }
  function cConsoleUrl(act, P) {
    if (act !== 'show') bad('console url', act);
    var s = findServer(P.pos[0]);
    fv([['protocol', 'vnc'], ['type', 'novnc'], ['url', 'http://controller:6080/vnc_lite.html?path=%3Ftoken%3D' + digest(s.id + 'vnc').slice(0, 36)]], P);
    dim('# di cloud beneran, URL ini membuka layar server di browser. Di simulasi cuma pajangan.');
  }

  // ---------- ssh ----------
  function ssh(a) {
    var idf = null, target = null;
    for (var i = 0; i < a.length; i++) {
      if (a[i] === '-i') idf = a[++i];
      else if (a[i] === '-o' || a[i] === '-p' || a[i] === '-l') i++;
      else if (/^-/.test(a[i])) continue;
      else if (!target) target = a[i];
    }
    if (!target) { out('usage: ssh [-46AaCfGgKkMNnqsTtVvXxYy] [-i identity_file] [user@]hostname [command]'); return; }
    var user = 'kamu', host = target;
    if (target.indexOf('@') >= 0) { user = target.split('@')[0]; host = target.split('@')[1]; }
    if (ipToInt(host) === null) { err('ssh: Could not resolve hostname ' + host + ': Name or service not known'); hint('# pakai IP-nya, misal ssh ubuntu@203.0.113.x (floating IP server)'); return; }
    var run = W.run;
    W.busy = true;
    function done(fn, ms) {
      term.play([[ms || 900, function () {
        W.busy = false;
        if (run !== W.run) return;
        fn();
        tick();
      }]]);
    }
    function timeout(h) { done(function () { err('ssh: connect to host ' + host + ' port 22: Connection timed out'); hint(h); }, 2400); }
    if (isPrivate(host)) { timeout('# ' + host + ' itu IP privat di network project. Dari laptop ga bisa dijangkau. Pasang floating IP ke server, lalu ssh ke IP itu.'); return; }
    var f = W.fips.filter(function (x) { return x.ip === host; })[0];
    var rt = W.routers.filter(function (r) { return r.gw && r.gw.ip === host; })[0];
    if (rt) { done(function () { err('ssh: connect to host ' + host + ' port 22: Connection refused'); hint('# ' + host + ' itu IP gateway router ' + rt.name + ', bukan server.'); }); return; }
    if (!f) { timeout('# ga ada apa-apa di ' + host + '. Cek floating IP-mu: openstack floating ip list'); return; }
    var s = W.servers.filter(function (x) { return x.nics.some(function (n) { return n.port === f.port; }); })[0];
    if (!s) { timeout('# floating IP ' + host + ' belum dipasang ke server mana pun. Pasang: openstack server add floating ip NAMA ' + host); return; }
    K.pulse(app, 'fip');
    if (s.status === 'BUILD' || s.task === 'rebooting' || s.task === 'powering-on') { done(function () { err('ssh: connect to host ' + host + ' port 22: Connection refused'); hint('# ' + s.name + ' masih booting. Tunggu sampai ACTIVE, lalu coba lagi.'); }); return; }
    if (s.status !== 'ACTIVE') { timeout('# ' + s.name + ' lagi ' + s.status + '. Nyalakan dulu: openstack server start ' + s.name); return; }
    if (!allows(s, 'tcp', 22, LAPTOP_IP)) { timeout('# paket SSH dibuang security group. ' + s.name + ' cuma pakai grup ' + s.sgs.map(sgName).join(', ') + ', yang belum membuka tcp 22 dari ' + LAPTOP_IP + ' (IP laptopmu). Tambah rule atau pasang grup yang benar.'); return; }
    done(function () {
      var known = W.hostsKnown[host];
      if (known && known !== s.id) {
        term.lines(['@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@', '@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @', '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@'].map(function (l) { return '<span class="sx-err">' + l + '</span>'; }));
        dim('# floating IP ini dulu dipakai server lain, jadi host key-nya beda. Di simulasi, known_hosts diperbarui otomatis.');
      } else if (!known) out("Warning: Permanently added '" + host + "' (ED25519) to the list of known hosts.");
      W.hostsKnown[host] = s.id;
      function denied(h) { err(user + '@' + host + ': Permission denied (publickey).'); if (h) hint(h); }
      if (!s.key) { denied('# ' + s.name + ' dibuat tanpa --key-name, jadi ga ada kunci yang dipercaya di dalamnya. Kunci ga bisa ditambah setelah boot: hapus dan bikin ulang servernya dengan --key-name.'); return; }
      var fname = idf ? idf.replace(/^\.\//, '') : null;
      if (idf && !W.files[fname] && !/id_ed25519$/.test(idf)) out('Warning: Identity file ' + idf + ' not accessible: No such file or directory.');
      if (!s.keyPub) {
        var mineFile = Object.keys(W.files).filter(function (n) { return W.files[n].fp === s.keyFp; })[0];
        if (!mineFile) { denied('# private key untuk keypair ' + s.key + ' ga pernah disimpan ke file (atau sudah ditimpa). Server ini ga bisa dimasuki. Bikin keypair baru dengan > kunci.pem, lalu bikin ulang servernya.'); return; }
        if (!idf || !W.files[fname]) { denied('# ' + s.name + ' pakai keypair ' + s.key + ', bukan ~/.ssh/id_ed25519. Tunjuk file private key-nya: ssh -i ' + mineFile + ' ' + target); return; }
        var fo = W.files[fname];
        if (/[1-7]/.test(fo.mode.slice(1))) {
          term.lines(['@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@', '@         WARNING: UNPROTECTED PRIVATE KEY FILE!          @', '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@'].map(function (l) { return '<span class="sx-err">' + l + '</span>'; }));
          out("Permissions 0" + fo.mode + " for '" + idf + "' are too open.");
          out('It is required that your private key files are NOT accessible by others.');
          out('This private key will be ignored.');
          out('Load key "' + idf + '": bad permissions');
          denied('# rapikan izinnya dulu: chmod 600 ' + idf);
          return;
        }
        if (fo.fp !== s.keyFp) { denied('# ' + idf + ' itu private key untuk keypair lain, bukan ' + s.key + '. Coba: ssh -i ' + mineFile + ' ' + target); return; }
      }
      if (user !== s.image.user) { denied('# image ' + s.image.name + ' memasang kunci untuk user ' + s.image.user + ', bukan ' + user + '. Coba: ssh ' + (idf ? '-i ' + idf + ' ' : '') + s.image.user + '@' + host); return; }
      W.ssh = { srv: s.id, user: user, host: host };
      term.lines(['Welcome to ' + s.image.os + ' (GNU/Linux ' + s.image.kernel + ' x86_64)', '', '  System information as of ' + new Date().toUTCString(), '', '  System load:  0.08      Processes:     ' + rnd(98, 120), '  Usage of /:   ' + rnd(8, 14) + '.' + rnd(1, 9) + '% of ' + (s.flavor.disk - 1) + 'GB   Users logged in: 0', '  IPv4 address for ens3: ' + s.nics[0].ip, '']);
      dim('# kamu sekarang di dalam ' + s.name + '. Coba lsblk, ip a, curl ifconfig.me. Ketik exit buat balik ke laptop.');
      M.hit('ssh');
      K.flash(app, 'internet');
    }, 1100);
  }
  function curlLaptop(line) {
    if (/ifconfig|ipinfo|icanhazip/.test(line)) { out(LAPTOP_IP); return; }
    var m = /(\d+\.\d+\.\d+\.\d+)(?::(\d+))?/.exec(line);
    if (!m) { err('curl: (6) Could not resolve host'); return; }
    var port = +(m[2] || (/https:/.test(line) ? 443 : 80));
    var f = W.fips.filter(function (x) { return x.ip === m[1]; })[0];
    var s = f && W.servers.filter(function (x) { return x.nics.some(function (n) { return n.port === f.port; }); })[0];
    if (s && s.status === 'ACTIVE' && allows(s, 'tcp', port, LAPTOP_IP)) { err('curl: (7) Failed to connect to ' + m[1] + ' port ' + port + ' after 4 ms: Connection refused'); hint('# paketnya sampai ke ' + s.name + ' (security group oke), tapi belum ada web server yang jalan di port ' + port + '.'); return; }
    err('curl: (28) Failed to connect to ' + m[1] + ' port ' + port + ' after 10002 ms: Timeout was reached');
    if (s) hint('# security group ' + s.name + ' belum membuka tcp ' + port + '.');
  }
  function sgName(id) { var g = W.sgs.filter(function (x) { return x.id === id; })[0]; return g ? g.name : id; }
  function pingFromLaptop(a) {
    var host = a.filter(function (x) { return !/^-/.test(x) && !/^\d+$/.test(x) || ipToInt(x) !== null; }).pop();
    if (!host) { out('ping: usage error: Destination address required'); return; }
    if (ipToInt(host) === null) { if (/\./.test(host)) { host = '142.250.4.100'; } else { err('ping: ' + host + ': Name or service not known'); return; } }
    var ok = false, why = '';
    var f = W.fips.filter(function (x) { return x.ip === host; })[0];
    var s = f && W.servers.filter(function (x) { return x.nics.some(function (n) { return n.port === f.port; }); })[0];
    var rt = W.routers.filter(function (r) { return r.gw && r.gw.ip === host; })[0];
    if (rt) ok = true;
    else if (s) { ok = s.status === 'ACTIVE' && allows(s, 'icmp', 0, LAPTOP_IP); if (!ok) why = s.status !== 'ACTIVE' ? '# ' + s.name + ' lagi ' + s.status : '# security group ' + s.name + ' belum mengizinkan icmp. Tambah: openstack security group rule create --protocol icmp ' + sgName(s.sgs[0]); }
    else if (isPrivate(host)) why = '# ' + host + ' IP privat, ga kelihatan dari laptop';
    else if (inCidr(host, PUB_CIDR)) why = '# ga ada server di balik ' + host;
    else ok = true;
    W.busy = true;
    var run = W.run, rows = [[0, 'PING ' + esc(host) + ' (' + esc(host) + ') 56(84) bytes of data.']];
    for (var i = 1; i <= 3; i++) rows.push([ok ? 420 : 900, ok ? '64 bytes from ' + esc(host) + ': icmp_seq=' + i + ' ttl=' + (s ? 61 : 117) + ' time=' + rnd(1, 30) + '.' + rnd(1, 9) + ' ms' : function () {}]);
    rows.push([300, function () {
      W.busy = false;
      if (run !== W.run) return;
      out('');
      out('--- ' + host + ' ping statistics ---');
      out('3 packets transmitted, ' + (ok ? 3 : 0) + ' received, ' + (ok ? '0' : '100') + '% packet loss, time 2003ms');
      if (why) hint(why);
    }]);
    term.play(rows);
  }

  // ---------- inside a server ----------
  function inServer(w, line) {
    var s = srvById(W.ssh.srv), c = w[0];
    if (c === 'sudo') { w = w.slice(1); c = w[0]; if (!c) { out('usage: sudo -h | -K | -k | -V'); return; } }
    if (c === 'exit' || c === 'logout') { out('logout'); out('Connection to ' + W.ssh.host + ' closed.'); W.ssh = null; return; }
    if (c === 'clear') { term.clear(); return; }
    if (c === 'help') { help(); return; }
    if (c === 'hostname') { out(s.name); return; }
    if (c === 'whoami') { out(W.ssh.user); return; }
    if (c === 'uptime') { out(' ' + new Date().toTimeString().slice(0, 8) + ' up ' + Math.max(1, Math.round((Date.now() - s.bootAt) / 60000)) + ' min,  1 user,  load average: 0.02, 0.05, 0.01'); return; }
    if (c === 'cat' && /os-release/.test(line)) { out('PRETTY_NAME="' + s.image.os + '"'); out('ID=' + s.image.user); return; }
    if (c === 'ip' || c === 'ifconfig') {
      out('1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN');
      out('    inet 127.0.0.1/8 scope host lo');
      s.nics.forEach(function (n, i) {
        var sub = subById(n.sub);
        out((i + 2) + ': ens' + (3 + i) + ': <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1442 qdisc fq_codel state UP');
        out('    link/ether ' + n.mac + ' brd ff:ff:ff:ff:ff:ff');
        out('    inet ' + n.ip + '/' + (sub ? sub.cidr.pre : 24) + ' metric 100 brd ' + (sub ? intToIp(sub.cidr.base + sub.cidr.size - 1) : '') + ' scope global dynamic ens' + (3 + i));
      });
      var f = fipsOf(s)[0];
      if (f) dim('# floating IP ' + f.ip + ' ga muncul di sini. NAT-nya terjadi di router, server cuma tahu IP privatnya.');
      return;
    }
    if (c === 'lsblk') {
      var rows = [['NAME', 'MAJ:MIN', 'RM', 'SIZE', 'RO', 'TYPE', 'MOUNTPOINTS'], ['vda', '253:0', '0', s.flavor.disk + 'G', '0', 'disk', ''], ['├─vda1', '253:1', '0', (s.flavor.disk - 1) + '.9G', '0', 'part', '/'], ['├─vda14', '253:14', '0', '4M', '0', 'part', ''], ['└─vda15', '253:15', '0', '106M', '0', 'part', '/boot/efi']];
      var vs = s.vols.map(volById).filter(function (v) { return v && v.status === 'in-use'; });
      vs.forEach(function (v, i) { rows.push([v.dev.slice(5), '253:' + (16 * (i + 1)), '0', v.size + 'G', '0', 'disk', s.mounts[v.dev] || '']); });
      term.table(rows);
      if (vs.length) { dim('# ' + vs.map(function (v) { return v.dev + ' = volume ' + v.name; }).join(', ') + '. Disk dari Cinder, nyambung lewat jaringan storage.'); M.hit('volume'); }
      else if (s.vols.length) dim('# volume masih dipasang, tunggu statusnya in-use');
      else dim('# cuma ada vda (disk root dari flavor). Tempel volume: openstack server add volume ' + s.name + ' NAMA_VOLUME (dari laptop)');
      return;
    }
    if (c === 'mkfs.ext4' || c === 'mkfs') {
      var dev = w[w.length - 1], v = s.vols.map(volById).filter(function (x) { return x && x.dev === dev && x.status === 'in-use'; })[0];
      if (!v) { err('mke2fs: No such file or directory while trying to determine filesystem size'); return; }
      ['mke2fs 1.47.0 (5-Feb-2023)', 'Creating filesystem with ' + v.size * 262144 + ' 4k blocks and ' + v.size * 65536 + ' inodes', 'Writing superblocks and filesystem accounting information: done'].forEach(out);
      s.fs[v.id] = true;
      return;
    }
    if (c === 'mount') {
      if (w.length < 3) { s.vols.forEach(function (id) { var v2 = volById(id); if (v2 && s.mounts[v2.dev]) out(v2.dev + ' on ' + s.mounts[v2.dev] + ' type ext4 (rw,relatime)'); }); return; }
      var v3 = s.vols.map(volById).filter(function (x) { return x && x.dev === w[1] && x.status === 'in-use'; })[0];
      if (!v3) { err('mount: ' + w[2] + ': special device ' + w[1] + ' does not exist.'); return; }
      if (!s.fs[v3.id]) { err('mount: ' + w[2] + ': wrong fs type, bad option, bad superblock on ' + w[1] + ', missing codepage or helper program, or other error.'); hint('# volume baru masih kosong tanpa filesystem. Format dulu: sudo mkfs.ext4 ' + w[1]); return; }
      s.mounts[w[1]] = w[2];
      return;
    }
    if (c === 'umount') { Object.keys(s.mounts).forEach(function (d) { if (d === w[1] || s.mounts[d] === w[1]) delete s.mounts[d]; }); return; }
    if (c === 'df') {
      var r = [['Filesystem', 'Size', 'Used', 'Avail', 'Use%', 'Mounted on'], ['/dev/vda1', (s.flavor.disk - 1) + 'G', '1.8G', (s.flavor.disk - 3) + 'G', '9%', '/'], ['tmpfs', Math.round(s.flavor.ram / 2048 * 10) / 10 + 'G', '0', Math.round(s.flavor.ram / 2048 * 10) / 10 + 'G', '0%', '/dev/shm'], ['/dev/vda15', '105M', '6.1M', '99M', '6%', '/boot/efi']];
      Object.keys(s.mounts).forEach(function (d) { var v4 = s.vols.map(volById).filter(function (x) { return x && x.dev === d; })[0]; if (v4) r.push([d, (v4.size - 0.2).toFixed(1) + 'G', '24K', (v4.size - 0.7).toFixed(1) + 'G', '1%', s.mounts[d]]); });
      term.table(r);
      return;
    }
    var sub0 = s.nics.length ? subById(s.nics[0].sub) : null;
    var online = sub0 && routerFor(sub0);
    if (c === 'curl' || c === 'wget') {
      if (!online) { err('curl: (7) Failed to connect to ifconfig.me port 80 after 3 ms: Couldn\'t connect to server'); hint('# subnet server ini ga tersambung ke router yang punya gateway. Ga ada jalan keluar ke internet.'); return; }
      var f2 = fipsOf(s)[0];
      out(f2 ? f2.ip : routerFor(sub0).gw.ip);
      dim(f2 ? '# dunia luar melihat server ini sebagai floating IP-nya.' : '# tanpa floating IP, trafik keluar di-SNAT pakai IP gateway router.');
      return;
    }
    if (c === 'ping') {
      var host = w.filter(function (x) { return !/^-/.test(x) && x !== 'ping' && !/^\d+$/.test(x) || ipToInt(x) !== null; }).pop() || '';
      var inside = ipToInt(host) !== null && sub0 && inCidr(host, sub0.cidr);
      var ok = inside ? allPorts().some(function (p) { return p.ip === host && p.sub === sub0; }) : !!online;
      var run = W.run;
      W.busy = true;
      var steps = [[0, 'PING ' + esc(host) + ' 56(84) bytes of data.']];
      if (!ok && !inside) { W.busy = false; err('ping: connect: Network is unreachable'); hint('# subnet ini belum disambung ke router dengan gateway public.'); return; }
      for (var i = 1; i <= 3; i++) steps.push([ok ? 380 : 900, ok ? '64 bytes from ' + esc(host) + ': icmp_seq=' + i + ' ttl=' + (inside ? 64 : 116) + ' time=' + (inside ? '0.' + rnd(3, 9) : rnd(8, 25) + '.' + rnd(1, 9)) + ' ms' : 'From ' + s.nics[0].ip + ' icmp_seq=' + i + ' Destination Host Unreachable']);
      steps.push([200, function () { W.busy = false; if (run !== W.run) return; out('--- ' + host + ' ping statistics ---'); out('3 packets transmitted, ' + (ok ? 3 : 0) + ' received, ' + (ok ? 0 : 100) + '% packet loss'); }]);
      term.play(steps);
      return;
    }
    if (c === 'apt' || c === 'apt-get') {
      if (!online) { err('Err:1 http://archive.ubuntu.com/ubuntu noble InRelease'); err('  Temporary failure resolving \'archive.ubuntu.com\''); hint('# ga ada akses internet dari subnet ini. Cek router dan gateway-nya.'); return; }
      ['Hit:1 http://archive.ubuntu.com/ubuntu noble InRelease', 'Get:2 http://security.ubuntu.com/ubuntu noble-security InRelease [126 kB]', 'Fetched 126 kB in 1s (148 kB/s)', 'Reading package lists... Done'].forEach(out);
      return;
    }
    if (c === 'openstack') { err('Command \'openstack\' not found, but can be installed with:'); out('sudo apt install python3-openstackclient'); hint('# CLI-nya ada di laptop. Ketik exit dulu.'); return; }
    if (c === 'ls') { out(''); return; }
    err(c + ': command not found');
  }

  // ---------- simulation ----------
  function tick() {
    var now = Date.now(), changed = false;
    W.servers.slice().forEach(function (s) {
      if (!s.until || now < s.until) return;
      s.until = 0; changed = true;
      if (s.task === 'spawning') { s.status = 'ACTIVE'; s.task = null; s.bootAt = now; if (!W.ssh) dim('# ' + s.name + ' sekarang ACTIVE'); }
      else if (s.task === 'powering-off') { s.status = 'SHUTOFF'; s.task = null; }
      else if (s.task === 'powering-on' || s.task === 'rebooting') { s.status = 'ACTIVE'; s.task = null; s.bootAt = now; }
      else if (s.task === 'deleting') {
        W.fips.forEach(function (f) { if (s.nics.some(function (n) { return n.port === f.port; })) { f.port = null; f.fixed = null; f.sub = null; } });
        W.vols.forEach(function (v) { if (v.server === s.id) { v.server = null; v.dev = null; v.status = 'available'; } });
        W.servers = W.servers.filter(function (x) { return x !== s; });
        if (W.ssh && W.ssh.srv === s.id) W.ssh = null;
      }
    });
    if (W.ssh) {
      var cs = srvById(W.ssh.srv);
      if (!cs || cs.status !== 'ACTIVE') { out('Connection to ' + W.ssh.host + ' closed by remote host.'); W.ssh = null; }
      else if (!fipsOf(cs).some(function (f) { return f.ip === W.ssh.host; })) { out('client_loop: send disconnect: Broken pipe'); dim('# floating IP-nya dilepas, sesi SSH putus.'); W.ssh = null; }
    }
    W.vols.slice().forEach(function (v) {
      if (!v.until || now < v.until) return;
      v.until = 0; changed = true;
      if (v.status === 'creating') v.status = 'available';
      else if (v.status === 'attaching') v.status = 'in-use';
      else if (v.status === 'detaching') {
        var s2 = srvById(v.server);
        if (s2) s2.vols = s2.vols.filter(function (id) { return id !== v.id; });
        v.status = 'available'; v.server = null; v.dev = null;
      } else if (v.status === 'deleting') W.vols = W.vols.filter(function (x) { return x !== v; });
    });
    void changed;
    checkMissions();
    render();
  }
  function checkMissions() {
    var d = function (x) { return x.project === 'demo'; };
    var nets = W.nets.filter(function (n) { return d(n) && !n.ext; });
    if (nets.some(function (n) { return subnetsOf(n).length; })) M.hit('net');
    if (W.routers.some(function (r) { return d(r) && r.gw && r.ifs.length; })) M.hit('router');
    var sg22 = W.sgs.some(function (g) { return d(g) && g.rules.some(function (r) { return r.dir === 'ingress' && !r.group && (!r.proto || r.proto === 'tcp') && (!r.port || r.port[0] <= 22 && r.port[1] >= 22) && (!r.remote || inCidr(LAPTOP_IP, r.remote)); }); });
    if (sg22 && W.keys.some(d)) M.hit('akses');
    if (W.servers.some(function (s) { return d(s) && s.status === 'ACTIVE' && s.key; })) M.hit('server');
    if (W.sawQuota && W.quota.demo.cores > QUOTA0.demo.cores) M.hit('quota');
    if (W.hadServer && !W.servers.some(d) && !W.fips.some(d) && !W.vols.some(d) && !W.routers.some(d) && !nets.length) M.hit('cleanup');
  }

  // ---------- render ----------
  var STATUS_S = { ACTIVE: 'ok', BUILD: 'info', REBOOT: 'info', SHUTOFF: 'warn', ERROR: 'bad' };
  function render() {
    var p = W.project;
    // prompt
    setText($('os-ps'), prompt());
    setText($('os-where'), W.ssh ? 'ssh · ' + (srvById(W.ssh.srv) || {}).name : 'laptop');
    $('os-where').classList.toggle('is-ssh', !!W.ssh);
    var pj = $('os-proj');
    setText(pj, p ? 'project ' + p + ' · user ' + p : 'belum login');
    pj.classList.toggle('is-on', !!p);
    $('os-gate').hidden = !!p;
    app.querySelectorAll('.os-view').forEach(function (v) { v.hidden = !p || v.dataset.view !== W.tab; });
    app.querySelectorAll('.os-tabs [data-tab]').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === W.tab)); b.tabIndex = b.dataset.tab === W.tab ? 0 : -1; });
    var srv = p ? myServers() : [], vols = p ? mine(W.vols) : [];
    setText($('os-n-inst'), srv.length ? String(srv.length) : '');
    setText($('os-n-vol'), vols.length ? String(vols.length) : '');
    renderFlow();
    renderQuick();
    if (!p) return;
    if (W.tab === 'ringkasan') renderSummary();
    if (W.tab === 'instance') { renderServers(srv); renderForm(); }
    if (W.tab === 'topologi') renderTopo();
    if (W.tab === 'volume') renderVols(vols);
  }
  function renderFlow() {
    var p = W.project;
    var fk = $('os-f-key');
    setText(fk, !p ? 'belum login' : W.tokenAt ? p + ' · token' : p);
    fk.dataset.s = p ? 'ok' : 'warn';
    var srv = p ? myServers() : [];
    var act = srv.filter(function (s) { return s.status === 'ACTIVE'; }).length;
    var fn = $('os-f-nova');
    setText(fn, !p ? '-' : srv.length ? srv.length + ' server · ' + act + ' aktif' : 'belum ada server');
    fn.dataset.s = srv.some(function (s) { return s.status === 'ERROR'; }) ? 'bad' : srv.some(function (s) { return s.status === 'BUILD'; }) ? 'info' : act ? 'ok' : '';
    var nets = p ? mine(W.nets).filter(function (n) { return !n.ext; }) : [], rts = p ? mine(W.routers) : [];
    var fnet = $('os-f-net');
    setText(fnet, !p ? '-' : nets.length + ' net · ' + rts.length + ' router');
    fnet.dataset.s = rts.some(function (r) { return r.gw && r.ifs.length; }) ? 'ok' : nets.length ? 'warn' : '';
    var fips = p ? mine(W.fips) : [], used = fips.filter(function (f) { return f.port; }).length;
    var fi = $('os-f-inet');
    setText(fi, W.ssh ? 'SSH tersambung' : !p ? '-' : fips.length ? used + '/' + fips.length + ' floating IP' : 'tertutup');
    fi.dataset.s = W.ssh ? 'ok' : used ? 'info' : '';
  }
  function cmdBtn(cmd, label, cls) { return '<button type="button" data-act="cmd" data-cmd="' + esc(cmd) + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(label || cmd) + '</button>'; }
  function short(cmd) { return cmd.replace(/^openstack /, ''); }
  function renderQuick() {
    var q = [];
    if (W.ssh) {
      var s = srvById(W.ssh.srv);
      q = ['lsblk', 'df -h', 'ip a', 'curl ifconfig.me', 'ping -c 3 8.8.8.8'];
      var v = s && s.vols.map(volById).filter(function (x) { return x && x.status === 'in-use'; })[0];
      if (v && !s.fs[v.id]) q.push('sudo mkfs.ext4 ' + v.dev);
      else if (v && !s.mounts[v.dev]) q.push('sudo mount ' + v.dev + ' /mnt');
      q.push('exit');
    } else if (!W.project) q = ['source demo-openrc', 'ls', 'cat demo-openrc', 'openstack server list'];
    else q = nextSteps();
    setHTML($('os-quick'), q.slice(0, 9).map(function (c) { return cmdBtn(c, short(c)); }).join(''));
  }
  function nextSteps() {
    var q = [], p = W.project;
    var nets = mine(W.nets).filter(function (n) { return !n.ext; });
    var net = nets.filter(function (n) { return subnetsOf(n).length; })[0] || nets[0];
    var sub = net && subnetsOf(net)[0];
    var rt = mine(W.routers)[0];
    var sgs = mine(W.sgs);
    var sg = sgs.filter(function (g) { return g.name !== 'default'; })[0];
    var key = mine(W.keys)[0];
    var srv = myServers();
    if (!W.tokenAt) q.push('openstack token issue');
    if (!net) q.push('openstack network create net-app');
    else if (!sub) q.push('openstack subnet create --network ' + net.name + ' --subnet-range 10.0.0.0/24 sub-app');
    if (sub && !rt) q.push('openstack router create r1');
    else if (rt && !rt.gw) q.push('openstack router set --external-gateway public ' + rt.name);
    else if (rt && sub && !rt.ifs.length) q.push('openstack router add subnet ' + rt.name + ' ' + sub.name);
    if (!sg) q.push('openstack security group create web');
    else if (!sg.rules.some(function (r) { return r.port && r.port[0] <= 22 && r.port[1] >= 22; })) q.push('openstack security group rule create --protocol tcp --dst-port 22 ' + sg.name);
    else if (!sg.rules.some(function (r) { return r.proto === 'icmp'; })) q.push('openstack security group rule create --protocol icmp ' + sg.name);
    if (!key) q.push('openstack keypair create --public-key ~/.ssh/id_ed25519.pub kunci');
    if (sub && !srv.length) q.push('openstack server create --flavor m1.small --image ubuntu-24.04 --network ' + net.name + (key ? ' --key-name ' + key.name : '') + (sg ? ' --security-group ' + sg.name : '') + ' web1');
    var a = srv.filter(function (s) { return s.status === 'ACTIVE'; })[0];
    if (a) {
      var f = fipsOf(a)[0];
      var free = mine(W.fips).filter(function (x) { return !x.port; })[0];
      if (f) {
        var kf = a.key && W.keys.filter(function (k) { return k.name === a.key && k.project === a.project; })[0];
        var file = kf && !kf.pub ? Object.keys(W.files).filter(function (n) { return W.files[n].key === kf.name; })[0] : null;
        q.push('ssh ' + (file ? '-i ' + file + ' ' : '') + a.image.user + '@' + f.ip);
      } else if (free) q.push('openstack server add floating ip ' + ref(a, W.servers) + ' ' + free.ip);
      else q.push('openstack floating ip create public');
      var v = mine(W.vols).filter(function (x) { return x.status === 'available'; })[0];
      if (!mine(W.vols).length) q.push('openstack volume create --size 10 data1');
      else if (v && !a.vols.length) q.push('openstack server add volume ' + ref(a, W.servers) + ' ' + v.name);
    }
    if (p === 'demo' && W.sawQuota && W.quota.demo.cores <= QUOTA0.demo.cores) q.push('source admin-openrc');
    if (p === 'admin' && W.sawQuota && W.quota.demo.cores <= QUOTA0.demo.cores) q.push('openstack quota set --cores 16 demo');
    if (p === 'admin' && W.quota.demo.cores > QUOTA0.demo.cores) q.push('source demo-openrc');
    if (p === 'demo' && srv.length && !W.sawQuota) q.push('openstack server create --flavor m1.xlarge --image ubuntu-24.04 --network ' + (net ? net.name : 'net-app') + ' besar1');
    ['openstack server list', 'openstack flavor list', 'openstack image list', 'openstack limits show --absolute', 'openstack network list', 'openstack port list --long'].forEach(function (c) { if (q.indexOf(c) < 0) q.push(c); });
    return q;
  }

  function meter(label, used, max, unit) {
    var pct = max ? Math.min(100, used / max * 100) : 0;
    var s = pct >= 100 ? 'bad' : pct >= 75 ? 'warn' : 'ok';
    return '<div class="os-q" data-s="' + s + '"><div class="os-qh"><span>' + label + '</span><b>' + used + (unit || '') + ' / ' + (max >= 99999 ? '∞' : max + (unit || '')) + '</b></div><div class="os-qbar"><i style="width:' + pct.toFixed(1) + '%"></i></div></div>';
  }
  function renderSummary() {
    var p = W.project, q = W.quota[p], u = usage(p);
    var h = '<p class="os-sub">pemakaian quota project <b>' + p + '</b></p><div class="os-qs">' +
      meter('instance', u.instances, q.instances) + meter('vCPU', u.cores, q.cores) + meter('RAM', Math.round(u.ram / 1024 * 10) / 10, Math.round(q.ram / 1024), ' GB') +
      meter('volume', u.volumes, q.volumes) + meter('storage volume', u.gigabytes, q.gigabytes, ' GB') + meter('floating IP', u['floating-ips'], q['floating-ips']) +
      meter('security group', u.secgroups, q.secgroups) + meter('network', u.networks, q.networks) + '</div>';
    var sgs = mine(W.sgs), keys = mine(W.keys);
    h += '<p class="os-sub">security group</p><div class="os-chips">' + sgs.map(function (g) {
      var ing = g.rules.filter(function (r) { return r.dir === 'ingress'; });
      return '<span class="os-chip"><b>' + esc(g.name) + '</b> ' + (ing.length ? ing.map(function (r) { return esc(r.group ? 'dari grup ' + r.group : (r.proto || 'semua') + (r.port ? ' ' + (r.port[0] === r.port[1] ? r.port[0] : r.port[0] + '-' + r.port[1]) : '') + (r.remote && r.remote !== '0.0.0.0/0' ? ' dari ' + r.remote : '')); }).filter(function (t, i, all) { return all.indexOf(t) === i; }).join(', ') : 'masuk ditolak semua') + '</span>';
    }).join('') + '</div>';
    h += '<p class="os-sub">keypair</p><div class="os-chips">' + (keys.length ? keys.map(function (k) { return '<span class="os-chip"><b>' + esc(k.name) + '</b> ' + (k.pub ? '~/.ssh/id_ed25519' : (Object.keys(W.files).filter(function (n) { return W.files[n].key === k.name; })[0] || 'private key ga disimpan')) + '</span>'; }).join('') : '<span class="os-none">belum ada. ' + cmdBtn('openstack keypair create --public-key ~/.ssh/id_ed25519.pub kunci', 'bikin keypair') + '</span>') + '</div>';
    h += '<p class="os-sub">image &amp; flavor</p><div class="os-chips">' + W.images.map(function (i) { return '<span class="os-chip"><b>' + esc(i.name) + '</b> min ' + i.minDisk + ' GB · user ' + i.user + '</span>'; }).join('') + FLAVORS.map(function (f) { return '<span class="os-chip"><b>' + f.name + '</b> ' + f.vcpu + ' vCPU · ' + (f.ram >= 1024 ? f.ram / 1024 + ' GB' : f.ram + ' MB') + ' · ' + f.disk + ' GB</span>'; }).join('') + '</div>';
    if (p === 'admin') {
      h += '<p class="os-sub">compute node (cuma kelihatan admin)</p><div class="os-hvs">' + HYPERS.map(function (hv) {
        var x = hyperUse(hv);
        return '<div class="os-hv"><b>' + hv.name + '</b><span>' + x.n + ' server</span>' + meter('vCPU', x.vcpu, hv.vcpu) + meter('RAM', x.ram / 1024, hv.ram / 1024, ' GB') + '</div>';
      }).join('') + '</div>';
    }
    setHTML($('os-v-ringkasan'), h);
  }
  function renderServers(srv) {
    var u = usage(W.project), q = W.quota[W.project];
    setText($('os-inst-sum'), srv.length + ' server · ' + u.cores + '/' + q.cores + ' vCPU');
    if (!srv.length) { setHTML($('os-vms'), '<p class="os-none">Belum ada server. Pakai tombol di atas atau <code>openstack server create</code>.</p>'); return; }
    var free = mine(W.fips).filter(function (x) { return !x.port; })[0];
    setHTML($('os-vms'), srv.map(function (s) {
      var r = ref(s, W.servers), st = s.task === 'deleting' ? 'deleting' : s.task === 'powering-off' ? 'stopping' : s.task === 'powering-on' ? 'starting' : s.status;
      var f = fipsOf(s)[0];
      var ips = s.nics.map(function (n) { return '<span class="os-ip">' + n.ip + '</span>'; }).join('') + (f ? '<span class="os-ip is-fip" title="floating IP">' + f.ip + '</span>' : '');
      var vols = s.vols.map(volById).filter(Boolean).map(function (v) { return '<span class="os-ip is-vol">' + esc(v.name) + ' ' + (v.dev || '').replace('/dev/', '') + '</span>'; }).join('');
      var acts = [];
      if (s.task === 'deleting') acts = [];
      else {
        if (s.status === 'ACTIVE') acts.push(cmdBtn('openstack server stop ' + r, 'stop'));
        if (s.status === 'SHUTOFF') acts.push(cmdBtn('openstack server start ' + r, 'start'));
        if (s.status === 'ACTIVE' && !f) acts.push(free ? cmdBtn('openstack server add floating ip ' + r + ' ' + free.ip, 'pasang ' + free.ip) : cmdBtn('openstack floating ip create public', 'alokasi floating IP'));
        if (f) acts.push(cmdBtn('openstack server remove floating ip ' + r + ' ' + f.ip, 'lepas FIP'));
        if (s.status !== 'BUILD' && s.status !== 'ERROR') acts.push(cmdBtn('openstack console log show ' + r, 'log'));
        acts.push(cmdBtn('openstack server delete ' + r, 'hapus', 'os-del'));
      }
      return '<div class="os-vm" data-s="' + (s.task === 'deleting' ? 'bad' : STATUS_S[s.status] || '') + '">' +
        '<div class="os-vh"><i class="os-dot" aria-hidden="true"></i><b>' + esc(s.name) + '</b><em>' + esc(st) + '</em></div>' +
        '<div class="os-meta">' + s.flavor.name + ' · ' + s.image.name + (W.project === 'admin' && s.host ? ' · ' + s.host : '') + '</div>' +
        (s.fault ? '<div class="dk-log">' + esc(s.fault) + '</div>' : '') +
        '<div class="os-row"><small>IP</small>' + (ips || '<span class="os-none">-</span>') + '</div>' +
        '<div class="os-row"><small>akses</small><span class="os-ip">' + (s.key ? '🔑 ' + esc(s.key) : 'tanpa keypair') + '</span>' + s.sgs.map(function (id) { return '<span class="os-ip is-sg">' + esc(sgName(id)) + '</span>'; }).join('') + '</div>' +
        (vols ? '<div class="os-row"><small>volume</small>' + vols + '</div>' : '') +
        (acts.length ? '<div class="sw-act">' + acts.join('') + '</div>' : '') + '</div>';
    }).join(''));
  }
  function setOpts(sel, opts) {
    var v = sel.value;
    setHTML(sel, opts.map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>'; }).join(''));
    if (opts.some(function (o) { return o[0] === v; })) sel.value = v;
  }
  function renderForm() {
    if ($('os-form').hidden) return;
    setOpts($('os-fm-image'), W.images.map(function (i) { return [i.name, i.name]; }));
    setOpts($('os-fm-flavor'), FLAVORS.map(function (f) { return [f.name, f.name + ' (' + f.vcpu + ' vCPU, ' + (f.ram >= 1024 ? f.ram / 1024 + ' GB' : f.ram + ' MB') + ', ' + f.disk + ' GB)']; }));
    var nets = visibleNets();
    var nopt = nets.filter(function (n) { return !n.ext; }).map(function (n) { return [n.name, n.name + (subnetsOf(n).length ? ' (' + subnetsOf(n)[0].cidr.str + ')' : ' (tanpa subnet)')]; });
    setOpts($('os-fm-net'), nopt.concat([['public', 'public (eksternal)']]));
    setOpts($('os-fm-key'), [['', '(tanpa keypair)']].concat(mine(W.keys).map(function (k) { return [k.name, k.name]; })));
    setOpts($('os-fm-sg'), mine(W.sgs).map(function (g) { return [g.name, g.name]; }));
  }
  function renderTopo() {
    var p = W.project, pb = pub();
    var nets = mine(W.nets).filter(function (n) { return !n.ext; });
    var rts = mine(W.routers);
    var h = '<div class="os-net is-ext"><div class="os-nh"><b>public</b><span>' + PUB_CIDR + ' · eksternal</span></div><div class="os-att">' +
      rts.filter(function (r) { return r.gw; }).map(function (r) { return '<span class="os-ip">' + esc(r.name) + ' gw ' + r.gw.ip + '</span>'; }).join('') +
      mine(W.fips).map(function (f) { return '<span class="os-ip is-fip">' + f.ip + (f.fixed ? ' → ' + f.fixed : ' (nganggur)') + '</span>'; }).join('') + '</div></div>';
    void pb;
    if (rts.length) {
      h += '<div class="os-rts">' + rts.map(function (r) {
        return '<div class="os-rt' + (r.gw ? ' is-gw' : '') + '"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M8.5 12h7M13 9.5l2.5 2.5-2.5 2.5M12 4v3M12 17v3"/></svg><div><b>' + esc(r.name) + '</b><span>' + (r.gw ? 'gateway ' + r.gw.ip : 'belum ada gateway') + '</span><span>' + (r.ifs.length ? r.ifs.map(function (f) { var s = subById(f.sub); return (s ? esc(s.name) : '?') + ' ' + f.ip; }).join(', ') : 'belum ada interface') + '</span></div>' +
          (!r.gw ? cmdBtn('openstack router set --external-gateway public ' + r.name, 'pasang gateway') : '') + '</div>';
      }).join('') + '</div>';
    }
    if (!nets.length) h += '<p class="os-none">Project ' + p + ' belum punya network sendiri. ' + cmdBtn('openstack network create net-app', 'bikin net-app') + '</p>';
    nets.forEach(function (n, i) {
      var subs = subnetsOf(n);
      var rt = subs.map(routerFor).filter(Boolean)[0];
      var anyRt = rts.filter(function (r) { return r.ifs.some(function (f) { return subs.some(function (s) { return s.id === f.sub; }); }); })[0];
      var vms = W.servers.filter(function (s) { return s.nics.some(function (x) { return x.net === n.id; }); });
      h += '<div class="os-net" data-hue="' + 'abcd'[i % 4] + '"><div class="os-nh"><b>' + esc(n.name) + '</b><span>' + (subs.length ? subs.map(function (s) { return s.cidr.str; }).join(', ') : 'tanpa subnet') + '</span>' +
        '<em data-s="' + (rt ? 'ok' : anyRt ? 'warn' : 'bad') + '">' + (rt ? 'ke internet via ' + esc(rt.name) : anyRt ? esc(anyRt.name) + ' tanpa gateway' : 'terisolasi') + '</em></div><div class="os-att">' +
        vms.map(function (s) {
          var nic = s.nics.filter(function (x) { return x.net === n.id; })[0], f = fipOfPort(nic.port);
          return '<span class="os-tvm" data-s="' + (STATUS_S[s.status] || '') + '"><i class="os-dot" aria-hidden="true"></i><b>' + esc(s.name) + '</b> ' + nic.ip + (f ? ' <span class="os-fipt">⇄ ' + f.ip + '</span>' : '') + '</span>';
        }).join('') + (vms.length ? '' : '<span class="os-none">belum ada server</span>') + '</div>' +
        (!subs.length ? '<div class="sw-act">' + cmdBtn('openstack subnet create --network ' + n.name + ' --subnet-range 10.0.' + i + '.0/24 sub-' + n.name.replace(/^net-/, ''), 'tambah subnet') + '</div>' : !anyRt && rts.length ? '<div class="sw-act">' + cmdBtn('openstack router add subnet ' + rts[0].name + ' ' + subs[0].name, 'sambung ke ' + rts[0].name) + '</div>' : '') +
        '</div>';
    });
    setHTML($('os-topo'), h);
  }
  function renderVols(vols) {
    var u = usage(W.project), q = W.quota[W.project];
    setText($('os-vol-sum'), vols.length + ' volume · ' + u.gigabytes + '/' + q.gigabytes + ' GB');
    if (!vols.length) { setHTML($('os-vols'), '<p class="os-none">Belum ada volume. Volume Cinder itu disk tambahan yang bisa dicopot-pasang ke server mana pun di project ini.</p>'); return; }
    var srv = myServers().filter(function (s) { return s.status === 'ACTIVE' || s.status === 'SHUTOFF'; });
    setHTML($('os-vols'), vols.map(function (v) {
      var s = srvById(v.server), acts = [];
      if (v.status === 'available') {
        srv.slice(0, 3).forEach(function (x) { acts.push(cmdBtn('openstack server add volume ' + ref(x, W.servers) + ' ' + ref(v, W.vols), 'pasang ke ' + x.name)); });
        acts.push(cmdBtn('openstack volume delete ' + ref(v, W.vols), 'hapus', 'os-del'));
      }
      if (v.status === 'in-use' && s) acts.push(cmdBtn('openstack server remove volume ' + ref(s, W.servers) + ' ' + ref(v, W.vols), 'lepas'));
      var st = v.status === 'in-use' ? 'ok' : v.status === 'available' ? 'warn' : 'info';
      return '<div class="os-vm" data-s="' + st + '"><div class="os-vh"><i class="os-dot" aria-hidden="true"></i><b>' + esc(v.name) + '</b><em>' + v.status + '</em></div>' +
        '<div class="os-meta">' + v.size + ' GB · lvmdriver-1' + (s ? ' · di ' + esc(s.name) + ' sebagai ' + v.dev : '') + '</div>' +
        (acts.length ? '<div class="sw-act">' + acts.join('') + '</div>' : '') + '</div>';
    }).join(''));
  }

  // ---------- wiring ----------
  app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    var act = b.dataset.act;
    if (act === 'cmd') {
      if (W.busy) toast('tunggu perintah sebelumnya selesai');
      else if (W.ssh && b.closest('.os-dash')) toast('kamu lagi di dalam ' + ((srvById(W.ssh.srv) || {}).name || 'server') + '. Ketik exit dulu buat balik ke laptop.');
      else term.submit(b.dataset.cmd);
    }
    else if (act === 'tab') { W.tab = b.dataset.tab; render(); }
    else if (act === 'launch') {
      var f = $('os-form');
      f.hidden = !f.hidden;
      if (!f.hidden) {
        var names = myServers().map(function (s) { return s.name; }), n = 1;
        while (names.indexOf('web' + n) >= 0) n++;
        $('os-fm-name').value = 'web' + n;
        renderForm();
        if ($('os-fm-flavor').value === 'm1.tiny') $('os-fm-flavor').value = 'm1.small';
        var k = mine(W.keys)[0]; if (k) $('os-fm-key').value = k.name;
        var g = mine(W.sgs).filter(function (x) { return x.name !== 'default'; })[0]; if (g) $('os-fm-sg').value = g.name;
        $('os-fm-name').focus();
      }
    }
    else if (act === 'vol-new' && W.ssh) toast('ketik exit dulu buat balik ke laptop');
    else if (act === 'vol-new') {
      var names2 = mine(W.vols).map(function (v) { return v.name; }), m = 1;
      while (names2.indexOf('data' + m) >= 0) m++;
      if (!W.busy) term.submit('openstack volume create --size 10 data' + m);
    }
    else if (act === 'reset') reset();
  });
  app.querySelector('.os-tabs').addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    var tabs = ['ringkasan', 'instance', 'topologi', 'volume'], i = tabs.indexOf(W.tab);
    W.tab = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    render();
    $('os-tab-' + W.tab).focus();
  });
  $('os-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (W.busy) { toast('tunggu perintah sebelumnya selesai'); return; }
    if (W.ssh) { toast('ketik exit dulu buat balik ke laptop'); return; }
    var name = $('os-fm-name').value.trim().replace(/\s+/g, '-') || 'web1';
    var cmd = 'openstack server create --flavor ' + $('os-fm-flavor').value + ' --image ' + $('os-fm-image').value + ' --network ' + $('os-fm-net').value +
      ($('os-fm-key').value ? ' --key-name ' + $('os-fm-key').value : '') + ' --security-group ' + $('os-fm-sg').value + ' ' + name;
    $('os-form').hidden = true;
    term.submit(cmd);
  });
  setInterval(tick, 300);

  function reset() {
    initWorld();
    term.clear();
    M.reset();
    $('os-form').hidden = true;
    term.lines([
      '<span class="sx-dim"># Cloud OpenStack bohongan: 1 controller, 2 compute node, network eksternal public (' + PUB_CIDR + '). Ada dua project: demo dan admin.</span>',
      '<span class="sx-dim"># Ini terminal laptop kamu. Mulai dengan </span><b>source demo-openrc</b><span class="sx-dim">. Ketik </span><b>help</b><span class="sx-dim"> buat daftar perintah.</span>'
    ]);
    render();
  }
  initWorld();
  reset();
})();
