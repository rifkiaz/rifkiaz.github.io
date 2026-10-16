// Topology sandbox for /topologi/. Everything lives in memory: nothing is
// saved or uploaded, the only way out is an image the visitor shares or
// downloads. Icons are simple line glyphs drawn here, not vendor logos.
(function () {
  'use strict';

  var app = document.getElementById('topo');
  if (!app) return;

  var NS = 'http://www.w3.org/2000/svg';
  var svg = document.getElementById('topo-svg');
  var world = document.getElementById('topo-world');
  var gridPat = document.getElementById('topo-grid');
  var stage = document.getElementById('topo-stage');
  var insp = document.getElementById('topo-insp');
  var labelIn = document.getElementById('topo-label');
  var emptyEl = document.getElementById('topo-empty');
  var hintEl = document.getElementById('topo-hint');
  var zoomEl = document.getElementById('topo-zoom-val');
  var toastEl = document.getElementById('topo-toast');
  var tplSel = document.getElementById('topo-tpl');
  var dialog = document.getElementById('topo-share');
  var PAGE_URL = app.dataset.url || location.href;

  // ---------- glyphs (24x24, stroked) ----------
  var G = {
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18"/>',
    server: '<rect x="4" y="3" width="16" height="7" rx="1.5"/><rect x="4" y="14" width="16" height="7" rx="1.5"/><path d="M8 6.5h.01M8 17.5h.01M12 6.5h5M12 17.5h5"/>',
    db: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    lb: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="12" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5v9M11 9.5l-5 7M13 9.5l5 7"/>',
    laptop: '<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M2.5 19h19"/>',
    git: '<circle cx="6" cy="5" r="2.2"/><circle cx="6" cy="19" r="2.2"/><circle cx="18" cy="8" r="2.2"/><path d="M6 7.2v9.6M18 10.2c0 4-6 3.5-11 7"/>',
    pipeline: '<rect x="2.5" y="9" width="5" height="6" rx="1"/><rect x="9.5" y="9" width="5" height="6" rx="1"/><rect x="16.5" y="9" width="5" height="6" rx="1"/><path d="M7.5 12h2M14.5 12h2"/>',
    chart: '<path d="M4 4v16h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    cloud: '<path d="M7 18h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.3 9.2 4.4 4.4 0 0 0 7 18z"/>',
    chip: '<rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
    stack: '<rect x="8" y="3" width="12" height="9" rx="1.5"/><path d="M5 7v9.5A1.5 1.5 0 0 0 6.5 18H16M2 10v9.5A1.5 1.5 0 0 0 3.5 21H13"/>',
    bucket: '<path d="M4 6l2 14.5h12L20 6"/><ellipse cx="12" cy="6" rx="8" ry="2.5"/>',
    lambda: '<path d="M6 4h3.5L17 20h2.5M12 11l-5.5 9"/>',
    cdn: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3v6.5M12 14.5V21M3 12h6.5M14.5 12H21"/>',
    dns: '<path d="M12 3v3M12 11v2M12 18v3M8 21h8M5 6h11l3 2.5-3 2.5H5zM19 13H8l-3 2.5L8 18h11z"/>',
    key: '<circle cx="8" cy="15" r="4.5"/><path d="M11.2 11.8L20 3M16 7l3 3M14 9l2 2"/>',
    queue: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M8 7v10M13 7v10"/>',
    cluster: '<path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z"/><circle cx="12" cy="12" r="3"/><path d="M12 6v3M12 15v3M6.8 9l2.6 1.5M14.6 13.5l2.6 1.5M6.8 15l2.6-1.5M14.6 10.5L17.2 9"/>',
    nat: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
    gateway: '<path d="M4 20V9l8-5 8 5v11"/><path d="M9 20v-6h6v6"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 10v10"/>',
    container: '<rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="M7.5 6v12M12 6v12M16.5 6v12"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M8 12.5v-2M10.5 12.5V8.5M13 12.5v-1"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3M12 14.5v2.5"/>',
    pod: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
    layers: '<path d="M12 3l9 4.5-9 4.5-9-4.5z"/><path d="M3 12l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5"/>',
    service: '<circle cx="12" cy="12" r="3"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="12" cy="20" r="2"/><path d="M9.9 9.9L6.4 6.4M14.1 9.9l3.5-3.5M12 15v3"/>',
    ingress: '<path d="M3 12h11M10 8l4 4-4 4"/><path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5"/>',
    config: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    disk: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="4"/><path d="M12 12h.01"/>',
    scale: '<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4M4 12h4M16 12h4"/>',
    module: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
    resource: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 12h6M12 9v6"/>',
    plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    braces: '<path d="M8 4c-2 0-3 1-3 3v2.5c0 1-1 2.5-2 2.5 1 0 2 1.5 2 2.5V17c0 2 1 3 3 3M16 4c2 0 3 1 3 3v2.5c0 1 1 2.5 2 2.5-1 0-2 1.5-2 2.5V17c0 2-1 3-3 3"/>',
    output: '<path d="M10 12h11M17 8l4 4-4 4"/><path d="M14 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h9"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l5.5-3.5z"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12 15h5"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
    doc: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    check: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7.5 12.5l3 3 6-6.5"/>',
    bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 21h4"/>',
    frame: '<rect x="3" y="5" width="18" height="14" rx="2" stroke-dasharray="3 2.5"/>'
  };

  // ---------- catalog ----------
  // d = colour on dark theme, l = colour on light theme
  var CATS = [
    { id: 'umum', name: 'Umum', d: '#3fb950', l: '#1a7f37' },
    { id: 'aws', name: 'AWS', d: '#f5a524', l: '#b45309' },
    { id: 'gcp', name: 'GCP', d: '#58a6ff', l: '#1d4ed8' },
    { id: 'k8s', name: 'Kubernetes', d: '#8b93ff', l: '#4338ca' },
    { id: 'tf', name: 'Terraform', d: '#c084fc', l: '#7e22ce' },
    { id: 'ans', name: 'Ansible', d: '#ff7b72', l: '#b91c1c' }
  ];
  var CAT = {};
  CATS.forEach(function (c) { CAT[c.id] = c; });

  // [type, category, name, glyph, isGroup]
  var ITEMS = [
    ['user', 'umum', 'Pengguna', 'user'], ['internet', 'umum', 'Internet', 'globe'],
    ['server', 'umum', 'Server', 'server'], ['db', 'umum', 'Database', 'db'],
    ['lb', 'umum', 'Load Balancer', 'lb'], ['fw', 'umum', 'Firewall', 'shield'],
    ['laptop', 'umum', 'Laptop Dev', 'laptop'], ['git', 'umum', 'Repo Git', 'git'],
    ['cicd', 'umum', 'CI/CD', 'pipeline'], ['monitor', 'umum', 'Monitoring', 'chart'],
    ['cron', 'umum', 'Cron Job', 'clock'], ['cloud', 'umum', 'Cloud', 'cloud'],
    ['zona', 'umum', 'Zona / Grup', 'frame', 1],

    ['aws-region', 'aws', 'Region', 'frame', 1], ['aws-vpc', 'aws', 'VPC', 'frame', 1],
    ['aws-subnet', 'aws', 'Subnet', 'frame', 1], ['ec2', 'aws', 'EC2', 'chip'],
    ['asg', 'aws', 'Auto Scaling', 'stack'], ['alb', 'aws', 'ALB', 'lb'],
    ['s3', 'aws', 'S3', 'bucket'], ['rds', 'aws', 'RDS', 'db'],
    ['dynamodb', 'aws', 'DynamoDB', 'table'], ['lambda', 'aws', 'Lambda', 'lambda'],
    ['cloudfront', 'aws', 'CloudFront', 'cdn'], ['route53', 'aws', 'Route 53', 'dns'],
    ['iam', 'aws', 'IAM', 'key'], ['sqs', 'aws', 'SQS', 'queue'],
    ['eks', 'aws', 'EKS', 'cluster'], ['cloudwatch', 'aws', 'CloudWatch', 'chart'],
    ['natgw', 'aws', 'NAT Gateway', 'nat'], ['igw', 'aws', 'Internet Gateway', 'gateway'],

    ['gcp-project', 'gcp', 'Project', 'frame', 1], ['gcp-vpc', 'gcp', 'VPC', 'frame', 1],
    ['gce', 'gcp', 'Compute Engine', 'chip'], ['gcs', 'gcp', 'Cloud Storage', 'bucket'],
    ['cloudsql', 'gcp', 'Cloud SQL', 'db'], ['gke', 'gcp', 'GKE', 'cluster'],
    ['cloudrun', 'gcp', 'Cloud Run', 'container'], ['gcf', 'gcp', 'Cloud Functions', 'lambda'],
    ['glb', 'gcp', 'Load Balancing', 'lb'], ['pubsub', 'gcp', 'Pub/Sub', 'queue'],
    ['bigquery', 'gcp', 'BigQuery', 'search'], ['clouddns', 'gcp', 'Cloud DNS', 'dns'],
    ['cloudcdn', 'gcp', 'Cloud CDN', 'cdn'], ['secretmgr', 'gcp', 'Secret Manager', 'lock'],

    ['k8s-cluster', 'k8s', 'Cluster', 'frame', 1], ['k8s-ns', 'k8s', 'Namespace', 'frame', 1],
    ['k8s-node', 'k8s', 'Node', 'server'], ['pod', 'k8s', 'Pod', 'pod'],
    ['deploy', 'k8s', 'Deployment', 'layers'], ['sts', 'k8s', 'StatefulSet', 'stack'],
    ['svc', 'k8s', 'Service', 'service'], ['ingress', 'k8s', 'Ingress', 'ingress'],
    ['configmap', 'k8s', 'ConfigMap', 'config'], ['secret', 'k8s', 'Secret', 'lock'],
    ['pvc', 'k8s', 'PVC', 'disk'], ['hpa', 'k8s', 'HPA', 'scale'],
    ['cronjob', 'k8s', 'CronJob', 'clock'], ['helm', 'k8s', 'Helm Release', 'module'],

    ['tf-ws', 'tf', 'Workspace', 'frame', 1], ['tf-module', 'tf', 'Module', 'module'],
    ['tf-res', 'tf', 'Resource', 'resource'], ['tf-data', 'tf', 'Data Source', 'search'],
    ['tf-provider', 'tf', 'Provider', 'plug'], ['tf-state', 'tf', 'State', 'file'],
    ['tf-backend', 'tf', 'Backend', 'db'], ['tf-var', 'tf', 'Variable', 'braces'],
    ['tf-output', 'tf', 'Output', 'output'], ['tf-plan', 'tf', 'Plan', 'doc'],
    ['tf-apply', 'tf', 'Apply', 'play'],

    ['ans-group', 'ans', 'Host Group', 'frame', 1], ['ans-control', 'ans', 'Control Node', 'terminal'],
    ['ans-inv', 'ans', 'Inventory', 'list'], ['ans-host', 'ans', 'Host', 'server'],
    ['ans-play', 'ans', 'Playbook', 'doc'], ['ans-role', 'ans', 'Role', 'gear'],
    ['ans-task', 'ans', 'Task', 'check'], ['ans-handler', 'ans', 'Handler', 'bell'],
    ['ans-vault', 'ans', 'Vault', 'lock'], ['ans-vars', 'ans', 'group_vars', 'braces'],
    ['ans-coll', 'ans', 'Collection', 'module']
  ];
  var TYPE = {};
  ITEMS.forEach(function (it) {
    TYPE[it[0]] = { type: it[0], cat: it[1], name: it[2], glyph: it[3], group: !!it[4] };
  });

  // ---------- state ----------
  var T = 52; // tile size
  var GRID = 10;
  var state = { nodes: [], edges: [] };
  var sel = null; // {kind: 'node'|'edge', id}
  var view = { x: 0, y: 0, k: 1 };
  var undoStack = [], redoStack = [];
  var seq = 1;
  var linkFrom = null; // node id waiting for a target (tap-to-connect)
  var drag = null;
  var dirty = false;

  function uid(p) { return p + (seq++); }
  function byId(id) {
    for (var i = 0; i < state.nodes.length; i++) if (state.nodes[i].id === id) return state.nodes[i];
    return null;
  }
  function edgeById(id) {
    for (var i = 0; i < state.edges.length; i++) if (state.edges[i].id === id) return state.edges[i];
    return null;
  }
  function snap(v) { return Math.round(v / GRID) * GRID; }

  function checkpoint() {
    undoStack.push(JSON.stringify(state));
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
    dirty = true;
  }
  function restore(json) {
    state = JSON.parse(json);
    if (sel && !(sel.kind === 'node' ? byId(sel.id) : edgeById(sel.id))) sel = null;
    linkFrom = null;
    render();
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(state));
    restore(undoStack.pop());
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(state));
    restore(redoStack.pop());
  }

  // ---------- theme ----------
  function isDark() { return document.documentElement.dataset.theme === 'dark'; }
  function palette() {
    return isDark()
      ? { bg: '#0d1117', tile: '#161b22', text: '#e6edf3', muted: '#8b949e', edge: '#8b949e', accent: '#3fb950', dark: true }
      : { bg: '#ffffff', tile: '#ffffff', text: '#1f2328', muted: '#57606a', edge: '#6e7781', accent: '#15803d', dark: false };
  }
  function catColor(cat, P) { var c = CAT[cat] || CAT.umum; return P.dark ? c.d : c.l; }

  // ---------- geometry ----------
  function wrap(text, max, lines) {
    var words = String(text || '').split(/\s+/).filter(Boolean);
    var out = [], cur = '';
    words.forEach(function (w) {
      while (w.length > max) {
        if (cur) { out.push(cur); cur = ''; }
        out.push(w.slice(0, max)); w = w.slice(max);
      }
      if (!cur) cur = w;
      else if ((cur + ' ' + w).length <= max) cur += ' ' + w;
      else { out.push(cur); cur = w; }
    });
    if (cur) out.push(cur);
    if (out.length > lines) {
      out = out.slice(0, lines);
      var last = out[lines - 1];
      out[lines - 1] = (last.length >= max ? last.slice(0, max - 1) : last) + '…';
    }
    return out;
  }
  function nodeBox(n) {
    if (n.group) return { x: n.x, y: n.y, w: n.w, h: n.h };
    var lines = wrap(n.label, 16, 2).length;
    return { x: n.x - 56, y: n.y - T / 2, w: 112, h: T + 8 + lines * 14 };
  }
  function shapeOf(n) {
    // box used to clip edges; for nodes the bottom side includes the label
    if (n.group) return { cx: n.x + n.w / 2, cy: n.y + n.h / 2, l: n.w / 2, r: n.w / 2, t: n.h / 2, b: n.h / 2 };
    var h = T / 2 + 3;
    return { cx: n.x, cy: n.y, l: h, r: h, t: h, b: T / 2 + 6 + wrap(n.label, 16, 2).length * 14 };
  }
  function clip(s, dx, dy) {
    var tx = dx > 0 ? s.r / dx : dx < 0 ? s.l / -dx : Infinity;
    var ty = dy > 0 ? s.b / dy : dy < 0 ? s.t / -dy : Infinity;
    var t = Math.min(tx, ty);
    return { x: s.cx + dx * t, y: s.cy + dy * t };
  }
  function edgePoints(e) {
    var a = byId(e.from), b = byId(e.to);
    if (!a || !b) return null;
    var sa = shapeOf(a), sb = shapeOf(b);
    var dx = sb.cx - sa.cx, dy = sb.cy - sa.cy;
    var len = Math.hypot(dx, dy) || 1;
    var ux = dx / len, uy = dy / len;
    var p1 = clip(sa, ux, uy), p2 = clip(sb, -ux, -uy);
    return { x1: p1.x + ux * 2, y1: p1.y + uy * 2, x2: p2.x - ux * 2, y2: p2.y - uy * 2 };
  }
  function bounds() {
    if (!state.nodes.length) return null;
    var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    state.nodes.forEach(function (n) {
      var b = nodeBox(n);
      x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y);
      x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h);
    });
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  function inside(n, g) {
    if (n === g) return false;
    if (n.group) return n.x >= g.x && n.y >= g.y && n.x + n.w <= g.x + g.w && n.y + n.h <= g.y + g.h;
    return n.x >= g.x && n.x <= g.x + g.w && n.y >= g.y && n.y <= g.y + g.h;
  }
  function hit(p) {
    var i, n;
    for (i = state.nodes.length - 1; i >= 0; i--) {
      n = state.nodes[i];
      if (n.group) continue;
      var b = nodeBox(n);
      if (p.x >= b.x + 12 && p.x <= b.x + b.w - 12 && p.y >= b.y - 4 && p.y <= b.y + b.h) return n;
    }
    var groups = state.nodes.filter(function (g) { return g.group; })
      .sort(function (a, b) { return a.w * a.h - b.w * b.h; });
    for (i = 0; i < groups.length; i++) {
      n = groups[i];
      if (p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + n.h) return n;
    }
    return null;
  }

  // ---------- drawing ----------
  function el(tag, attrs, parent, text) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function glyph(parent, name, x, y, size, color) {
    var g = el('g', {
      transform: 'translate(' + x + ' ' + y + ') scale(' + size / 24 + ')',
      fill: 'none', stroke: color, 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    }, parent);
    g.innerHTML = G[name] || G.resource;
    return g;
  }
  function markers(defs, P) {
    [['topo-arr', P.edge], ['topo-arr-sel', P.accent]].forEach(function (m) {
      var mk = el('marker', {
        id: m[0], viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7,
        orient: 'auto-start-reverse', markerUnits: 'strokeWidth'
      }, defs);
      el('path', { d: 'M0 0L10 5L0 10z', fill: m[1] }, mk);
    });
  }

  var FONT = 'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

  function drawScene(root, P, ui) {
    var groups = state.nodes.filter(function (n) { return n.group; })
      .sort(function (a, b) { return b.w * b.h - a.w * a.h; });
    var nodes = state.nodes.filter(function (n) { return !n.group; });
    var isSel = function (kind, id) { return ui && sel && sel.kind === kind && sel.id === id; };

    groups.forEach(function (n) {
      var c = catColor(n.cat, P);
      var g = el('g', ui ? { 'data-role': 'group', 'data-id': n.id } : {}, root);
      el('rect', {
        x: n.x, y: n.y, width: n.w, height: n.h, rx: 12, fill: c, 'fill-opacity': 0.06,
        stroke: isSel('node', n.id) ? P.accent : c, 'stroke-width': isSel('node', n.id) ? 2.2 : 1.4,
        'stroke-dasharray': '7 5'
      }, g);
      var tag = TYPE[n.type] ? TYPE[n.type].name : '';
      var title = n.label && n.label !== tag ? n.label : tag;
      var label = wrap(title, Math.max(6, Math.floor((n.w - 40) / 7.2)), 1)[0] || '';
      el('rect', { x: n.x + 10, y: n.y + 9, width: 18, height: 18, rx: 4, fill: c, 'fill-opacity': 0.16 }, g);
      glyph(g, TYPE[n.type] ? TYPE[n.type].glyph === 'frame' ? groupGlyph(n.cat) : TYPE[n.type].glyph : 'frame', n.x + 12, n.y + 11, 14, c);
      el('text', { x: n.x + 36, y: n.y + 22, fill: c, 'font-size': 12, 'font-weight': 700, 'font-family': FONT }, g, label);
      if (ui && isSel('node', n.id)) {
        el('rect', { x: n.x + n.w - 14, y: n.y + n.h - 14, width: 18, height: 18, rx: 4, fill: P.accent, 'data-role': 'resize', 'data-id': n.id, class: 'topo-resize' }, root);
        el('path', { d: 'M' + (n.x + n.w - 9) + ' ' + (n.y + n.h) + 'l9 -9M' + (n.x + n.w - 4) + ' ' + (n.y + n.h) + 'l4 -4', stroke: P.bg, 'stroke-width': 1.6, 'pointer-events': 'none' }, root);
        linkHandle(root, n.x + n.w + 14, n.y + 18, n.id, P);
      }
    });

    state.edges.forEach(function (e) {
      var p = edgePoints(e);
      if (!p) return;
      var s = isSel('edge', e.id);
      var g = el('g', ui ? { 'data-role': 'edge', 'data-id': e.id } : {}, root);
      var d = 'M' + p.x1 + ' ' + p.y1 + 'L' + p.x2 + ' ' + p.y2;
      if (ui) el('path', { d: d, stroke: 'transparent', 'stroke-width': 16, fill: 'none' }, g);
      var arrow = e.arrow || 'end';
      el('path', {
        d: d, fill: 'none', stroke: s ? P.accent : P.edge, 'stroke-width': s ? 2.4 : 1.6,
        'stroke-dasharray': e.dashed ? '6 5' : null, 'stroke-linecap': 'round',
        'marker-end': arrow !== 'none' ? 'url(#' + (s ? 'topo-arr-sel' : 'topo-arr') + ')' : null,
        'marker-start': arrow === 'both' ? 'url(#' + (s ? 'topo-arr-sel' : 'topo-arr') + ')' : null
      }, g);
      if (e.label) {
        var mx = (p.x1 + p.x2) / 2, my = (p.y1 + p.y2) / 2;
        var lbl = wrap(e.label, 24, 1)[0];
        var w = lbl.length * 6.6 + 12;
        el('rect', { x: mx - w / 2, y: my - 9, width: w, height: 18, rx: 5, fill: P.bg, stroke: s ? P.accent : P.edge, 'stroke-opacity': 0.5 }, g);
        el('text', { x: mx, y: my + 4, fill: s ? P.accent : P.muted, 'font-size': 11, 'text-anchor': 'middle', 'font-family': FONT }, g, lbl);
      }
    });

    nodes.forEach(function (n) {
      var c = catColor(n.cat, P);
      var s = isSel('node', n.id) || (ui && linkFrom === n.id);
      var hover = ui && drag && drag.mode === 'link' && drag.over === n.id;
      var g = el('g', ui ? { 'data-role': 'node', 'data-id': n.id } : {}, root);
      if (ui) {
        var b = nodeBox(n);
        el('rect', { x: b.x + 12, y: b.y - 4, width: b.w - 24, height: b.h + 4, fill: 'transparent' }, g);
      }
      el('rect', { x: n.x - T / 2, y: n.y - T / 2, width: T, height: T, rx: 12, fill: P.tile }, g);
      el('rect', {
        x: n.x - T / 2, y: n.y - T / 2, width: T, height: T, rx: 12, fill: c, 'fill-opacity': 0.12,
        stroke: s || hover ? P.accent : c, 'stroke-width': s || hover ? 2.4 : 1.4,
        'stroke-dasharray': ui && linkFrom === n.id ? '5 4' : null
      }, g);
      glyph(g, TYPE[n.type] ? TYPE[n.type].glyph : 'resource', n.x - 14, n.y - 14, 28, c);
      wrap(n.label, 16, 2).forEach(function (line, i) {
        el('text', {
          x: n.x, y: n.y + T / 2 + 16 + i * 14, fill: P.text, 'font-size': 11.5, 'font-weight': i ? 400 : 600,
          'text-anchor': 'middle', 'font-family': FONT
        }, g, line);
      });
      if (ui && isSel('node', n.id) && !linkFrom) linkHandle(root, n.x + T / 2 + 16, n.y, n.id, P);
    });

    if (ui && drag && drag.mode === 'link') {
      var a = byId(drag.from);
      if (a) {
        var sa = shapeOf(a);
        el('path', {
          d: 'M' + sa.cx + ' ' + sa.cy + 'L' + drag.p.x + ' ' + drag.p.y, stroke: P.accent, 'stroke-width': 2,
          'stroke-dasharray': '6 5', fill: 'none', 'marker-end': 'url(#topo-arr-sel)', 'pointer-events': 'none'
        }, root);
      }
    }
  }
  function groupGlyph(cat) {
    return { aws: 'cloud', gcp: 'cloud', k8s: 'cluster', tf: 'module', ans: 'list' }[cat] || 'frame';
  }
  function linkHandle(root, x, y, id, P) {
    var g = el('g', { 'data-role': 'link', 'data-id': id, class: 'topo-handle' }, root);
    el('circle', { cx: x, cy: y, r: 14, fill: 'transparent' }, g);
    el('circle', { cx: x, cy: y, r: 9, fill: P.accent }, g);
    el('path', { d: 'M' + (x - 4) + ' ' + y + 'h8M' + (x + 1) + ' ' + (y - 3.5) + 'l3.5 3.5-3.5 3.5', stroke: P.bg, 'stroke-width': 1.8, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
  }

  var defs = svg.querySelector('defs');
  var markerTheme = null;
  function render() {
    var P = palette();
    if (markerTheme !== P.dark) {
      defs.querySelectorAll('marker').forEach(function (m) { m.remove(); });
      markers(defs, P);
      markerTheme = P.dark;
    }
    world.textContent = '';
    drawScene(world, P, true);
    emptyEl.hidden = state.nodes.length > 0;
    updateInspector();
    hintEl.hidden = !linkFrom;
    app.querySelector('[data-act="undo"]').disabled = !undoStack.length;
    app.querySelector('[data-act="redo"]').disabled = !redoStack.length;
  }
  function applyView() {
    var t = 'translate(' + view.x + ' ' + view.y + ') scale(' + view.k + ')';
    world.setAttribute('transform', t);
    gridPat.setAttribute('patternTransform', t);
    zoomEl.textContent = Math.round(view.k * 100) + '%';
  }
  new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ---------- view ----------
  function stageSize() { var r = svg.getBoundingClientRect(); return { w: r.width, h: r.height, r: r }; }
  function toWorld(cx, cy) {
    var r = svg.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
  }
  function zoomAt(k, sx, sy) {
    k = Math.min(2.5, Math.max(0.25, k));
    var wx = (sx - view.x) / view.k, wy = (sy - view.y) / view.k;
    view.k = k;
    view.x = sx - wx * k;
    view.y = sy - wy * k;
    applyView();
  }
  function fit() {
    var b = bounds(), s = stageSize();
    if (!b || !s.w) { view = { x: s.w / 2 || 0, y: s.h / 2 || 0, k: 1 }; applyView(); return; }
    var pad = 40;
    var topPad = sel ? 56 : pad;
    var k = Math.min((s.w - pad * 2) / b.w, (s.h - pad - topPad) / b.h, 1.4);
    k = Math.max(0.25, k);
    view.k = k;
    view.x = (s.w - b.w * k) / 2 - b.x * k;
    view.y = topPad + (s.h - pad - topPad - b.h * k) / 2 - b.y * k;
    applyView();
  }

  // ---------- mutations ----------
  function addNode(type, at) {
    var t = TYPE[type];
    if (!t) return null;
    checkpoint();
    var n = { id: uid('n'), type: type, cat: t.cat, label: t.name };
    if (t.group) {
      n.group = true; n.w = 280; n.h = 180;
      n.x = snap(at.x - n.w / 2); n.y = snap(at.y - n.h / 2);
      state.nodes.unshift(n);
    } else {
      n.x = snap(at.x); n.y = snap(at.y);
      state.nodes.push(n);
    }
    sel = { kind: 'node', id: n.id };
    labelDirty = false;
    render();
    return n;
  }
  // centre of the visible canvas, nudged to the nearest free spot so taps
  // don't stack new components on top of each other
  function centerWorld(group) {
    var s = stageSize();
    var c = { x: (s.w / 2 - view.x) / view.k, y: (s.h / 2 - view.y) / view.k };
    if (group) return c;
    var free = function (x, y) {
      return !state.nodes.some(function (n) { return !n.group && Math.abs(n.x - x) < 110 && Math.abs(n.y - y) < 100; });
    };
    for (var r = 0; r < 8; r++) {
      for (var i = -r; i <= r; i++) {
        for (var j = -r; j <= r; j++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
          var x = c.x + j * 120, y = c.y + i * 110;
          if (free(x, y)) return { x: x, y: y };
        }
      }
    }
    return c;
  }
  function addEdge(from, to) {
    if (!from || !to || from === to) return;
    var dup = state.edges.some(function (e) {
      return (e.from === from && e.to === to) || (e.from === to && e.to === from);
    });
    if (dup) { toast('Dua komponen itu sudah tersambung.'); return; }
    checkpoint();
    var e = { id: uid('e'), from: from, to: to, label: '', arrow: 'end', dashed: false };
    state.edges.push(e);
    sel = { kind: 'edge', id: e.id };
    labelDirty = false;
  }
  function removeSelection() {
    if (!sel) return;
    checkpoint();
    if (sel.kind === 'node') {
      var id = sel.id;
      state.nodes = state.nodes.filter(function (n) { return n.id !== id; });
      state.edges = state.edges.filter(function (e) { return e.from !== id && e.to !== id; });
    } else {
      var eid = sel.id;
      state.edges = state.edges.filter(function (e) { return e.id !== eid; });
    }
    sel = null;
    linkFrom = null;
    render();
  }
  function duplicate() {
    var n = sel && sel.kind === 'node' && byId(sel.id);
    if (!n) return;
    checkpoint();
    var c = JSON.parse(JSON.stringify(n));
    c.id = uid('n');
    c.x += n.group ? 30 : 90;
    c.y += n.group ? 30 : 0;
    if (c.group) state.nodes.unshift(c); else state.nodes.push(c);
    sel = { kind: 'node', id: c.id };
    labelDirty = false;
    render();
  }
  function select(s) {
    var same = (!s && !sel) || (s && sel && s.kind === sel.kind && s.id === sel.id);
    sel = s;
    if (!same) labelDirty = false;
  }

  // ---------- inspector ----------
  var labelDirty = false;
  function updateInspector() {
    var item = sel && (sel.kind === 'node' ? byId(sel.id) : edgeById(sel.id));
    insp.hidden = !item;
    if (!item) return;
    insp.dataset.kind = sel.kind === 'edge' ? 'edge' : item.group ? 'group' : 'node';
    if (document.activeElement !== labelIn) labelIn.value = item.label || '';
    labelIn.placeholder = sel.kind === 'edge' ? 'label garis (opsional)' : 'nama komponen';
    if (sel.kind === 'edge') {
      app.querySelector('[data-act="arrow"]').textContent = { end: 'panah →', both: 'panah ↔', none: 'tanpa panah' }[item.arrow || 'end'];
      app.querySelector('[data-act="dash"]').textContent = item.dashed ? 'garis - -' : 'garis ──';
    }
    app.querySelector('[data-act="link"]').classList.toggle('is-on', !!linkFrom);
  }
  labelIn.addEventListener('input', function () {
    var item = sel && (sel.kind === 'node' ? byId(sel.id) : edgeById(sel.id));
    if (!item) return;
    if (!labelDirty) { checkpoint(); labelDirty = true; }
    item.label = labelIn.value.slice(0, 60);
    render();
  });
  labelIn.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); labelIn.blur(); }
  });

  // ---------- canvas pointer handling ----------
  var pointers = new Map();
  var lastTap = { id: null, t: 0 };

  svg.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (document.activeElement === labelIn) labelIn.blur();
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      if (drag && drag.mode === 'move' && !drag.moved) undoStack.pop();
      var pts = Array.from(pointers.values());
      var r = svg.getBoundingClientRect();
      drag = {
        mode: 'pinch', d0: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1, k0: view.k,
        mx: (pts[0].x + pts[1].x) / 2 - r.left, my: (pts[0].y + pts[1].y) / 2 - r.top, vx: view.x, vy: view.y
      };
      render();
      return;
    }
    if (pointers.size > 2) return;

    var t = e.target.closest('[data-role]');
    var role = t && t.dataset.role, id = t && t.dataset.id;
    var p = toWorld(e.clientX, e.clientY);

    if (role === 'link') {
      linkFrom = null;
      drag = { mode: 'link', from: id, p: p, s0: p, over: null };
      render();
      return;
    }
    if (role === 'resize') {
      var g = byId(id);
      checkpoint();
      drag = { mode: 'resize', id: id, start: p, w0: g.w, h0: g.h, moved: false };
      return;
    }
    if (role === 'node' || role === 'group') {
      if (linkFrom) {
        var from = linkFrom;
        linkFrom = null;
        if (from !== id) addEdge(from, id); else select({ kind: 'node', id: id });
        render();
        return;
      }
      var now = Date.now();
      if (lastTap.id === id && now - lastTap.t < 380) {
        lastTap.id = null;
        select({ kind: 'node', id: id });
        render();
        labelIn.focus();
        labelIn.select();
        return;
      }
      lastTap = { id: id, t: now };
      select({ kind: 'node', id: id });
      var n = byId(id);
      var items = [{ n: n, x0: n.x, y0: n.y }];
      if (n.group) {
        state.nodes.forEach(function (o) { if (inside(o, n)) items.push({ n: o, x0: o.x, y0: o.y }); });
      }
      checkpoint();
      drag = { mode: 'move', start: p, items: items, moved: false };
      render();
      return;
    }
    if (role === 'edge') {
      linkFrom = null;
      var nowE = Date.now();
      if (lastTap.id === id && nowE - lastTap.t < 380) {
        lastTap.id = null;
        select({ kind: 'edge', id: id });
        render();
        labelIn.focus();
        return;
      }
      lastTap = { id: id, t: nowE };
      select({ kind: 'edge', id: id });
      render();
      return;
    }
    // empty canvas: pan
    linkFrom = null;
    select(null);
    drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    render();
  });

  svg.addEventListener('pointermove', function (e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!drag) return;
    var p;
    if (drag.mode === 'pinch') {
      if (pointers.size < 2) return;
      var pts = Array.from(pointers.values());
      var r = svg.getBoundingClientRect();
      var d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      var mx = (pts[0].x + pts[1].x) / 2 - r.left, my = (pts[0].y + pts[1].y) / 2 - r.top;
      view.x = drag.vx + (mx - drag.mx);
      view.y = drag.vy + (my - drag.my);
      zoomAt(drag.k0 * d / drag.d0, mx, my);
      return;
    }
    if (drag.mode === 'pan') {
      view.x = drag.vx + (e.clientX - drag.sx);
      view.y = drag.vy + (e.clientY - drag.sy);
      applyView();
      return;
    }
    p = toWorld(e.clientX, e.clientY);
    if (drag.mode === 'move') {
      var dx = p.x - drag.start.x, dy = p.y - drag.start.y;
      if (!drag.moved && Math.hypot(dx, dy) * view.k < 4) return;
      drag.moved = true;
      var lead = drag.items[0];
      var nx = snap(lead.x0 + dx) - lead.x0, ny = snap(lead.y0 + dy) - lead.y0;
      drag.items.forEach(function (it) { it.n.x = it.x0 + nx; it.n.y = it.y0 + ny; });
      render();
    } else if (drag.mode === 'resize') {
      var g = byId(drag.id);
      g.w = Math.max(120, snap(drag.w0 + p.x - drag.start.x));
      g.h = Math.max(80, snap(drag.h0 + p.y - drag.start.y));
      drag.moved = true;
      render();
    } else if (drag.mode === 'link') {
      drag.p = p;
      var h = hit(p);
      drag.over = h && h.id !== drag.from ? h.id : null;
      render();
    }
  });

  function endPointer(e, cancelled) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (!drag) return;
    if (drag.mode === 'pinch') {
      if (pointers.size === 0) drag = null;
      return;
    }
    if (drag.mode === 'move' || drag.mode === 'resize') {
      if (!drag.moved) undoStack.pop();
    } else if (drag.mode === 'link') {
      var from = drag.from;
      var p = toWorld(e.clientX, e.clientY);
      var moved = Math.hypot(p.x - drag.s0.x, p.y - drag.s0.y) * view.k > 6;
      var target = cancelled ? null : hit(p);
      drag = null;
      if (target && target.id !== from) addEdge(from, target.id);
      // a plain tap on the handle switches to tap-to-connect, handy on phones
      else if (!moved && !cancelled) linkFrom = from;
      render();
      return;
    }
    drag = null;
  }
  svg.addEventListener('pointerup', function (e) { endPointer(e, false); });
  svg.addEventListener('pointercancel', function (e) { endPointer(e, true); });

  svg.addEventListener('wheel', function (e) {
    e.preventDefault();
    var r = svg.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      zoomAt(view.k * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    } else {
      var f = e.deltaMode === 1 ? 16 : 1;
      view.x -= e.deltaX * f;
      view.y -= e.deltaY * f;
      applyView();
    }
  }, { passive: false });

  // ---------- palette ----------
  var tabsEl = document.getElementById('topo-tabs');
  var itemsEl = document.getElementById('topo-items');
  var curCat = 'aws';

  function iconSVG(t, size) {
    var c = CAT[t.cat];
    return '<svg class="topo-ic" style="--c-d:' + c.d + ';--c-l:' + c.l + '" width="' + size + '" height="' + size +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (G[t.glyph] || G.resource) + '</svg>';
  }
  function buildTabs() {
    tabsEl.innerHTML = '';
    CATS.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', c.id === curCat ? 'true' : 'false');
      b.style.setProperty('--c-d', c.d);
      b.style.setProperty('--c-l', c.l);
      b.textContent = c.name;
      b.addEventListener('click', function () { curCat = c.id; buildTabs(); buildItems(); });
      tabsEl.appendChild(b);
    });
  }
  function buildItems() {
    itemsEl.innerHTML = '';
    ITEMS.forEach(function (it) {
      if (it[1] !== curCat) return;
      var t = TYPE[it[0]];
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'topo-item' + (t.group ? ' is-group' : '');
      b.dataset.type = t.type;
      b.title = 'Tambah ' + t.name + (t.group ? ' (area/grup)' : '');
      b.innerHTML = '<span class="topo-item-ic">' + iconSVG(t, 22) + '</span><span class="topo-item-name"></span>';
      b.querySelector('.topo-item-name').textContent = t.name;
      itemsEl.appendChild(b);
    });
  }
  buildTabs();
  buildItems();

  var pal = null, ghost = null, suppressClick = false;
  itemsEl.addEventListener('pointerdown', function (e) {
    var b = e.target.closest('.topo-item');
    if (!b || (e.pointerType === 'mouse' && e.button !== 0)) return;
    pal = { b: b, id: e.pointerId, x: e.clientX, y: e.clientY, dragging: false };
  });
  window.addEventListener('pointermove', function (e) {
    if (!pal || e.pointerId !== pal.id) return;
    if (!pal.dragging) {
      if (Math.hypot(e.clientX - pal.x, e.clientY - pal.y) < 8) return;
      pal.dragging = true;
      try { pal.b.setPointerCapture(e.pointerId); } catch (err) { /* not fatal */ }
      ghost = document.createElement('div');
      ghost.className = 'topo-ghost';
      ghost.innerHTML = pal.b.innerHTML;
      document.body.appendChild(ghost);
    }
    e.preventDefault();
    ghost.style.transform = 'translate(' + (e.clientX - 30) + 'px,' + (e.clientY - 30) + 'px)';
    var r = svg.getBoundingClientRect();
    var over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    stage.classList.toggle('is-drop', over);
  });
  function endPal(e, cancelled) {
    if (!pal || e.pointerId !== pal.id) return;
    if (pal.dragging) {
      suppressClick = true;
      setTimeout(function () { suppressClick = false; }, 0);
      var r = svg.getBoundingClientRect();
      if (!cancelled && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        addNode(pal.b.dataset.type, toWorld(e.clientX, e.clientY));
      }
      if (ghost) ghost.remove();
      ghost = null;
      stage.classList.remove('is-drop');
    }
    pal = null;
  }
  window.addEventListener('pointerup', function (e) { endPal(e, false); });
  window.addEventListener('pointercancel', function (e) { endPal(e, true); });
  itemsEl.addEventListener('click', function (e) {
    var b = e.target.closest('.topo-item');
    if (!b || suppressClick) return;
    var t = TYPE[b.dataset.type];
    addNode(b.dataset.type, centerWorld(t.group));
    if (window.matchMedia('(max-width: 760px)').matches) toast(t.name + ' ditambahkan ke kanvas');
  });

  // ---------- templates ----------
  var TPL = {
    aws: {
      g: [['rg', 'aws-region', 230, 40, 680, 460, 'Region'], ['vpc', 'aws-vpc', 255, 80, 630, 400, 'VPC 10.0.0.0/16'],
        ['pub', 'aws-subnet', 280, 130, 240, 320, 'Subnet publik'], ['prv', 'aws-subnet', 560, 130, 300, 320, 'Subnet privat']],
      n: [['u', 'user', 50, 270, 'Pengguna'], ['dns', 'route53', 50, 120, 'Route 53'], ['cf', 'cloudfront', 170, 270, 'CloudFront'],
        ['s3', 's3', 170, 430, 'S3 aset statis'], ['alb', 'alb', 400, 210, 'ALB'], ['nat', 'natgw', 400, 360, 'NAT Gateway'],
        ['a1', 'ec2', 640, 210, 'app-1'], ['a2', 'ec2', 640, 350, 'app-2'], ['db', 'rds', 790, 280, 'RDS Postgres']],
      e: [['u', 'dns', 'DNS', 1], ['u', 'cf', 'HTTPS'], ['cf', 'alb'], ['cf', 's3', '', 1], ['alb', 'a1'], ['alb', 'a2'],
        ['a1', 'db'], ['a2', 'db'], ['a2', 'nat', 'egress', 1]]
    },
    gcp: {
      g: [['pj', 'gcp-project', 190, 40, 800, 440, 'Project: demo-prod'], ['vpc', 'gcp-vpc', 400, 90, 420, 340, 'VPC']],
      n: [['u', 'user', 70, 250, 'Pengguna'], ['lb', 'glb', 280, 250, 'HTTPS LB'], ['gcs', 'gcs', 280, 400, 'Cloud Storage'],
        ['run', 'cloudrun', 500, 170, 'Cloud Run api'], ['gce', 'gce', 500, 340, 'worker VM'], ['sql', 'cloudsql', 710, 170, 'Cloud SQL'],
        ['ps', 'pubsub', 710, 340, 'Pub/Sub'], ['bq', 'bigquery', 910, 250, 'BigQuery']],
      e: [['u', 'lb', 'HTTPS'], ['lb', 'run'], ['lb', 'gcs', 'aset', 1], ['run', 'sql'], ['run', 'ps', 'event'],
        ['ps', 'gce', 'subscribe', 1], ['gce', 'bq', 'load']]
    },
    k8s: {
      g: [['cl', 'k8s-cluster', 150, 25, 820, 490, 'Cluster'], ['ns', 'k8s-ns', 180, 70, 760, 420, 'Namespace: shop']],
      n: [['net', 'internet', 60, 250, 'Internet'], ['ing', 'ingress', 260, 250, 'Ingress'], ['svc', 'svc', 410, 250, 'Service web'],
        ['dep', 'deploy', 570, 150, 'Deployment web'], ['p1', 'pod', 720, 200, 'web-pod-1'], ['p2', 'pod', 720, 320, 'web-pod-2'],
        ['hpa', 'hpa', 570, 400, 'HPA'], ['cm', 'configmap', 410, 400, 'ConfigMap'], ['sts', 'sts', 870, 200, 'StatefulSet db'],
        ['pvc', 'pvc', 870, 360, 'PVC data']],
      e: [['net', 'ing', 'HTTPS'], ['ing', 'svc'], ['svc', 'p1'], ['svc', 'p2'], ['dep', 'p1', '', 1], ['dep', 'p2', '', 1],
        ['hpa', 'dep', 'scale', 1], ['cm', 'dep', '', 1], ['p1', 'sts', 'query'], ['sts', 'pvc']]
    },
    tf: {
      g: [['ws', 'tf-ws', 440, 40, 520, 380, 'Workspace: prod']],
      n: [['lp', 'laptop', 70, 220, 'Laptop kamu'], ['git', 'git', 210, 220, 'Repo infra'], ['ci', 'cicd', 350, 220, 'Pipeline'],
        ['var', 'tf-var', 520, 110, 'variables'], ['plan', 'tf-plan', 520, 230, 'terraform plan'], ['apply', 'tf-apply', 520, 350, 'terraform apply'],
        ['mod', 'tf-module', 690, 110, 'module network'], ['st', 'tf-backend', 690, 350, 'Remote state'], ['out', 'tf-output', 690, 230, 'outputs'],
        ['paws', 'tf-provider', 870, 110, 'provider aws'], ['pgcp', 'tf-provider', 870, 270, 'provider google']],
      e: [['lp', 'git', 'push'], ['git', 'ci', 'trigger'], ['ci', 'plan'], ['var', 'plan', '', 1], ['plan', 'apply', 'approve'],
        ['apply', 'st', 'state + lock'], ['apply', 'mod'], ['mod', 'paws'], ['mod', 'pgcp'], ['apply', 'out', '', 1]]
    },
    ans: {
      g: [['web', 'ans-group', 560, 40, 320, 210, '[web]'], ['dbg', 'ans-group', 560, 290, 320, 190, '[db]']],
      n: [['ctl', 'ans-control', 90, 230, 'Control node'], ['inv', 'ans-inv', 260, 110, 'inventory.ini'],
        ['play', 'ans-play', 260, 340, 'site.yml'], ['vault', 'ans-vault', 90, 400, 'ansible-vault'],
        ['rc', 'ans-role', 420, 280, 'role common'], ['rn', 'ans-role', 420, 410, 'role nginx'],
        ['w1', 'ans-host', 640, 140, 'web-1'], ['w2', 'ans-host', 790, 140, 'web-2'], ['d1', 'ans-host', 720, 380, 'db-1']],
      e: [['ctl', 'inv', 'baca'], ['ctl', 'play', 'jalankan'], ['vault', 'play', 'decrypt', 1], ['play', 'rc'], ['play', 'rn'],
        ['ctl', 'web', 'SSH'], ['ctl', 'dbg', 'SSH']]
    }
  };
  function loadTemplate(key) {
    var t = TPL[key];
    if (!t) return;
    checkpoint();
    var ids = {};
    var nodes = [];
    t.g.forEach(function (g) {
      var id = uid('n'); ids[g[0]] = id;
      nodes.push({ id: id, type: g[1], cat: TYPE[g[1]].cat, group: true, x: g[2], y: g[3], w: g[4], h: g[5], label: g[6] });
    });
    t.n.forEach(function (n) {
      var id = uid('n'); ids[n[0]] = id;
      nodes.push({ id: id, type: n[1], cat: TYPE[n[1]].cat, x: n[2], y: n[3], label: n[4] });
    });
    state = {
      nodes: nodes,
      edges: t.e.map(function (e) {
        return { id: uid('e'), from: ids[e[0]], to: ids[e[1]], label: e[2] || '', arrow: 'end', dashed: !!e[3] };
      })
    };
    sel = null;
    linkFrom = null;
    curCat = key;
    buildTabs();
    buildItems();
    render();
    fit();
  }
  tplSel.addEventListener('change', function () {
    var v = tplSel.value;
    tplSel.value = '';
    if (!v) return;
    if (state.nodes.length && !window.confirm('Ganti isi kanvas dengan contoh ini? (masih bisa diurungkan)')) return;
    loadTemplate(v);
  });
  emptyEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-tpl]');
    if (b) loadTemplate(b.dataset.tpl);
  });

  // ---------- toolbar ----------
  app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b || !app.contains(b)) return;
    var act = b.dataset.act;
    var edge = sel && sel.kind === 'edge' && edgeById(sel.id);
    switch (act) {
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'clear':
        if (!state.nodes.length) break;
        if (!window.confirm('Kosongkan kanvas? (masih bisa diurungkan)')) break;
        checkpoint(); state = { nodes: [], edges: [] }; sel = null; linkFrom = null; render(); fit();
        break;
      case 'zin': zoomAt(view.k * 1.2, stageSize().w / 2, stageSize().h / 2); break;
      case 'zout': zoomAt(view.k / 1.2, stageSize().w / 2, stageSize().h / 2); break;
      case 'fit': fit(); break;
      case 'link':
        if (sel && sel.kind === 'node') { linkFrom = linkFrom ? null : sel.id; render(); }
        break;
      case 'dup': duplicate(); break;
      case 'del': removeSelection(); break;
      case 'arrow':
        if (edge) { checkpoint(); edge.arrow = { end: 'both', both: 'none', none: 'end' }[edge.arrow || 'end']; render(); }
        break;
      case 'dash':
        if (edge) { checkpoint(); edge.dashed = !edge.dashed; render(); }
        break;
      case 'flip':
        if (edge) { checkpoint(); var f = edge.from; edge.from = edge.to; edge.to = f; render(); }
        break;
      case 'cancel-link': linkFrom = null; render(); break;
      case 'share': openShare(); break;
      case 'close-share': dialog.close(); break;
    }
  });

  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    if (dialog.open) return;
    var mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (!sel && !linkFrom) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelection(); return; }
    if (e.key === 'Escape') { linkFrom = null; select(null); render(); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); return; }
    var mv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (mv && sel && sel.kind === 'node') {
      e.preventDefault();
      var n = byId(sel.id);
      checkpoint();
      var moving = [n];
      if (n.group) state.nodes.forEach(function (o) { if (inside(o, n)) moving.push(o); });
      moving.forEach(function (o) { o.x += mv[0] * GRID; o.y += mv[1] * GRID; });
      render();
    }
  });

  window.addEventListener('beforeunload', function (e) {
    if (dirty && state.nodes.length) { e.preventDefault(); e.returnValue = ''; }
  });

  // ---------- toast ----------
  var toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-on'); }, 2200);
  }

  // ---------- export ----------
  var fontCSS = null;
  function loadFont() {
    if (fontCSS !== null) return Promise.resolve(fontCSS);
    var url = app.dataset.font;
    if (!url || !window.fetch) { fontCSS = ''; return Promise.resolve(''); }
    return fetch(url).then(function (r) { return r.ok ? r.arrayBuffer() : Promise.reject(); }).then(function (buf) {
      var bytes = new Uint8Array(buf), bin = '';
      for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      fontCSS = '@font-face{font-family:"JetBrains Mono";font-weight:100 800;src:url(data:font/woff2;base64,' + btoa(bin) + ') format("woff2");}';
      return fontCSS;
    }).catch(function () { fontCSS = ''; return ''; });
  }

  function buildExport(title, font) {
    var b = bounds();
    if (!b) return null;
    var P = palette();
    var pad = 36, head = title ? 52 : 0, foot = 36;
    var cw = b.w + pad * 2;
    var W = Math.max(cw, 420), H = b.h + pad * 2 + head + foot;
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('xmlns', NS);
    s.setAttribute('width', W);
    s.setAttribute('height', H);
    s.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    if (font) el('style', {}, s, font);
    markers(el('defs', {}, s), P);
    el('rect', { width: W, height: H, fill: P.bg }, s);
    if (title) {
      var t = el('text', { x: pad, y: pad + 14, 'font-size': 19, 'font-weight': 700, 'font-family': FONT, fill: P.text }, s);
      el('tspan', { fill: P.accent }, t, '❯ ');
      el('tspan', {}, t, title);
    }
    var g = el('g', { transform: 'translate(' + ((W - cw) / 2 + pad - b.x) + ' ' + (pad + head - b.y) + ')' }, s);
    drawScene(g, P, false);
    el('line', { x1: pad, x2: W - pad, y1: H - foot, y2: H - foot, stroke: P.edge, 'stroke-opacity': 0.25 }, s);
    var ft = el('text', { x: pad, y: H - 14, 'font-size': 11, 'font-family': FONT, fill: P.muted }, s);
    el('tspan', { fill: P.accent, 'font-weight': 700 }, ft, '❯_ ');
    el('tspan', {}, ft, 'topologi');
    el('text', { x: W - pad, y: H - 14, 'font-size': 11, 'font-family': FONT, fill: P.muted, 'text-anchor': 'end' }, s,
      PAGE_URL.replace(/^https?:\/\//, '').replace(/\/$/, ''));
    return { svg: new XMLSerializer().serializeToString(s), w: W, h: H };
  }

  function renderPNG(title) {
    return loadFont().then(function (font) {
      var ex = buildExport(title, font);
      if (!ex) return null;
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () {
          var scale = Math.min(2, 4096 / Math.max(ex.w, ex.h));
          var c = document.createElement('canvas');
          c.width = Math.round(ex.w * scale);
          c.height = Math.round(ex.h * scale);
          var ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0, c.width, c.height);
          c.toBlob(function (blob) { blob ? resolve(blob) : reject(new Error('toBlob')); }, 'image/png');
        };
        img.onerror = function () { reject(new Error('render')); };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(ex.svg);
      });
    });
  }

  // ---------- share dialog ----------
  var titleIn = document.getElementById('topo-title');
  var previewEl = document.getElementById('topo-preview');
  var shareBtn = dialog.querySelector('[data-share="native"]');
  var copyBtn = dialog.querySelector('[data-share="copy"]');
  var current = { blob: null, url: null };
  var renderToken = 0;

  function fileName() {
    var d = new Date(), z = function (v) { return (v < 10 ? '0' : '') + v; };
    return 'topologi-' + d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + '-' + z(d.getHours()) + z(d.getMinutes()) + '.png';
  }
  function shareText() {
    var t = titleIn.value.trim();
    return (t ? 'Topologi "' + t + '" yang barusan aku gambar.' : 'Barusan iseng gambar topologi infra.') + ' Coba bikin punyamu di';
  }
  function refreshPreview() {
    var token = ++renderToken;
    previewEl.classList.add('is-busy');
    return renderPNG(titleIn.value.trim()).then(function (blob) {
      if (token !== renderToken) return;
      if (current.url) URL.revokeObjectURL(current.url);
      current.blob = blob;
      current.url = blob ? URL.createObjectURL(blob) : null;
      previewEl.src = current.url || '';
      previewEl.classList.remove('is-busy');
      var file = blob && new File([blob], fileName(), { type: 'image/png' });
      shareBtn.hidden = !(file && navigator.canShare && navigator.canShare({ files: [file] }));
    }).catch(function () {
      previewEl.classList.remove('is-busy');
      toast('Gagal bikin gambar, coba lagi ya.');
    });
  }
  function openShare() {
    if (!state.nodes.length) { toast('Kanvasnya masih kosong. Tambah komponen dulu, ya.'); return; }
    linkFrom = null;
    render();
    copyBtn.hidden = !(window.ClipboardItem && navigator.clipboard && navigator.clipboard.write);
    var enc = encodeURIComponent;
    var text = shareText();
    var links = {
      x: 'https://x.com/intent/tweet?text=' + enc(text) + '&url=' + enc(PAGE_URL),
      facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + enc(PAGE_URL),
      linkedin: 'https://www.linkedin.com/sharing/share-offsite/?url=' + enc(PAGE_URL),
      whatsapp: 'https://wa.me/?text=' + enc(text + ' ' + PAGE_URL),
      telegram: 'https://t.me/share/url?url=' + enc(PAGE_URL) + '&text=' + enc(text)
    };
    dialog.querySelectorAll('[data-net]').forEach(function (a) { a.href = links[a.dataset.net]; });
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    refreshPreview();
  }
  var titleTimer;
  titleIn.addEventListener('input', function () {
    clearTimeout(titleTimer);
    titleTimer = setTimeout(function () {
      refreshPreview();
      var text = shareText(), enc = encodeURIComponent;
      dialog.querySelector('[data-net="x"]').href = 'https://x.com/intent/tweet?text=' + enc(text) + '&url=' + enc(PAGE_URL);
      dialog.querySelector('[data-net="whatsapp"]').href = 'https://wa.me/?text=' + enc(text + ' ' + PAGE_URL);
      dialog.querySelector('[data-net="telegram"]').href = 'https://t.me/share/url?url=' + enc(PAGE_URL) + '&text=' + enc(text);
    }, 300);
  });
  titleIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') e.preventDefault(); });

  function download() {
    if (!current.url) return;
    var a = document.createElement('a');
    a.href = current.url;
    a.download = fileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('Gambar diunduh. Tinggal lampirkan di postinganmu.');
  }
  dialog.addEventListener('click', function (e) {
    if (e.target === dialog) { dialog.close(); return; }
    var b = e.target.closest('[data-share]');
    if (!b || !current.blob) return;
    var kind = b.dataset.share;
    if (kind === 'download') download();
    else if (kind === 'native') {
      var file = new File([current.blob], fileName(), { type: 'image/png' });
      navigator.share({ files: [file], title: 'Topologi', text: shareText() + ' ' + PAGE_URL }).catch(function (err) {
        if (err && err.name !== 'AbortError') toast('Gagal membagikan. Coba unduh gambarnya saja.');
      });
    } else if (kind === 'copy') {
      navigator.clipboard.write([new ClipboardItem({ 'image/png': current.blob })]).then(function () {
        toast('Gambar tersalin. Tempel (paste) langsung di postinganmu.');
      }, function () { toast('Browser ga ngizinin salin gambar. Unduh saja, ya.'); });
    }
  });
  // social networks only take a link, so hand over the image first
  dialog.querySelectorAll('[data-net]').forEach(function (a) {
    a.addEventListener('click', function () { if (current.url) download(); });
  });
  dialog.addEventListener('close', function () {
    if (current.url) URL.revokeObjectURL(current.url);
    current = { blob: null, url: null };
    previewEl.removeAttribute('src');
  });

  // ---------- init ----------
  render();
  fit();
  if (window.ResizeObserver) {
    var lastW = 0;
    new ResizeObserver(function () {
      var w = stageSize().w;
      if (!lastW || !state.nodes.length) fit();
      lastW = w;
    }).observe(stage);
  }
})();
