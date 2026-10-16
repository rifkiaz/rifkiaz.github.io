// Terraform simulator for /terraform/. Parses a small subset of HCL from the
// editor, plans against a fake state, and applies to a fake AWS account in
// the browser. Nothing leaves the page and nothing is stored.
(function () {
  'use strict';

  var K = window.SimKit;
  var app = document.getElementById('tf');
  if (!app || !K) return;
  var esc = K.esc, setHTML = K.setHTML, setText = K.setText, hex = K.hex;
  function $(id) { return document.getElementById(id); }

  var TF_VER = '1.9.8', AWS_VER = '5.72.1';
  var ACCOUNT = '123456789012';
  var INSTANCE_TYPES = ['t3.nano', 't3.micro', 't3.small', 't3.medium', 't3.large'];
  var TAKEN_BUCKETS = ['test', 'backup', 'bucket', 'data', 'logs', 'my-bucket', 'terraform'];
  var DEF = { vpc: 'vpc-0def4017e5a6b7c8d', subnet: 'subnet-0def4017e5a6b7c8d', sg: 'sg-0def4017e5a6b7c8d' };
  var SPEED = 10; // one real second shows up as ten seconds of AWS time

  var STARTER = [
    'terraform {',
    '  required_providers {',
    '    aws = {',
    '      source  = "hashicorp/aws"',
    '      version = "~> 5.0"',
    '    }',
    '  }',
    '}',
    '',
    'provider "aws" {',
    '  region = "ap-southeast-3" # Jakarta',
    '}',
    '',
    'variable "env" {',
    '  type    = string',
    '  default = "lab"',
    '}',
    '',
    'resource "aws_vpc" "main" {',
    '  cidr_block = "10.0.0.0/16"',
    '',
    '  tags = {',
    '    Name = "${var.env}-vpc"',
    '  }',
    '}',
    '',
    'resource "aws_subnet" "app" {',
    '  vpc_id     = aws_vpc.main.id',
    '  cidr_block = "10.0.1.0/24"',
    '}',
    '',
    'resource "aws_instance" "web" {',
    '  # Ubuntu 24.04. Ubuntu 22.04: ami-0a9b8c7d6e5f40312',
    '  ami           = "ami-0f1e2d3c4b5a69788"',
    '  instance_type = "t3.micro"',
    '  subnet_id     = aws_subnet.app.id',
    '',
    '  tags = {',
    '    Name = "${var.env}-web"',
    '  }',
    '}',
    '',
    'output "web_id" {',
    '  value = aws_instance.web.id',
    '}',
    ''
  ].join('\n');

  var SNIPPETS = {
    bucket: function () {
      return 'resource "aws_s3_bucket" "logs" {\n  bucket = "${var.env}-logs-' + hex(6) + '"\n\n  tags = {\n    Name = "${var.env}-logs"\n  }\n}';
    },
    sg: function () {
      return 'resource "aws_security_group" "web" {\n  name   = "${var.env}-web-sg"\n  vpc_id = aws_vpc.main.id\n\n  ingress {\n    from_port   = 80\n    to_port     = 80\n    protocol    = "tcp"\n    cidr_blocks = ["0.0.0.0/0"]\n  }\n}';
    },
    count: null // handled in place: adds count to aws_instance.web
  };

  // ---------- provider schema ----------
  // t: type, req: required, fn: forces replacement, oc: optional + computed
  // (left out = keep whatever AWS picked), def: default when left out.
  var SCHEMA = {
    aws_vpc: { label: 'VPC', prefix: 'vpc', svc: 'ec2', path: 'vpc', time: 1200, del: 1000, attrs: {
      cidr_block: { t: 'string', req: 1, fn: 1 }, tags: { t: 'map' } } },
    aws_subnet: { label: 'subnet', prefix: 'subnet', svc: 'ec2', path: 'subnet', time: 900, del: 900, attrs: {
      vpc_id: { t: 'string', req: 1, fn: 1 }, cidr_block: { t: 'string', req: 1, fn: 1 },
      availability_zone: { t: 'string', fn: 1, oc: 1 }, tags: { t: 'map' } } },
    aws_security_group: { label: 'SG', prefix: 'sg', svc: 'ec2', path: 'security-group', time: 1100, del: 1000, attrs: {
      name: { t: 'string', req: 1, fn: 1 }, description: { t: 'string', fn: 1, def: 'Managed by Terraform' },
      vpc_id: { t: 'string', fn: 1, oc: 1 },
      ingress: { t: 'blocks', block: { from_port: { t: 'number', req: 1 }, to_port: { t: 'number', req: 1 }, protocol: { t: 'string', req: 1 }, cidr_blocks: { t: 'list' } } },
      tags: { t: 'map' } } },
    aws_instance: { label: 'EC2', prefix: 'i', svc: 'ec2', path: 'instance', time: 3200, del: 2400, upd: 1500, attrs: {
      ami: { t: 'string', req: 1, fn: 1 }, instance_type: { t: 'string', req: 1 },
      subnet_id: { t: 'string', fn: 1, oc: 1 }, vpc_security_group_ids: { t: 'list', oc: 1 }, tags: { t: 'map' } } },
    aws_s3_bucket: { label: 'S3', prefix: '', svc: 's3', path: '', time: 800, del: 700, attrs: {
      bucket: { t: 'string', req: 1, fn: 1 }, force_destroy: { t: 'bool', def: false }, tags: { t: 'map' } } }
  };
  var ORDER = ['aws_vpc', 'aws_subnet', 'aws_security_group', 'aws_instance', 'aws_s3_bucket'];

  var MISSIONS = [
    { id: 'plan', text: 'Jalankan <b>terraform init</b>, lalu <b>terraform plan</b>.' },
    { id: 'apply', text: '<b>terraform apply</b> dan lihat VPC, subnet, dan EC2 muncul.' },
    { id: 'update', text: 'Ganti <b>instance_type</b>, lalu apply. Perhatikan tanda <i>~</i> (update in-place).' },
    { id: 'replace', text: 'Ganti <b>ami</b>, lalu apply. Kenapa jadi <i>-/+</i> (replace)?' },
    { id: 'drift', text: 'Ubah sesuatu lewat <b>console AWS</b>, lalu balikin pakai plan + apply.' },
    { id: 'destroy', text: 'Bersihkan semuanya pakai <b>terraform destroy</b>.' }
  ];

  // ---------- small helpers ----------
  var UNK = { unknown: true };
  function clone(v) { return v === UNK || v === undefined ? v : JSON.parse(JSON.stringify(v)); }
  function hasUnk(v) {
    if (v === UNK) return true;
    if (v && typeof v === 'object') {
      for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k) && hasUnk(v[k])) return true;
    }
    return false;
  }
  function eq(a, b) {
    if (a === UNK || b === UNK) return false;
    return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
  }
  function norm(v) {
    if (v === undefined) return null;
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      var o = {};
      Object.keys(v).sort().forEach(function (k) { o[k] = norm(v[k]); });
      return o;
    }
    return v;
  }
  function lev(a, b) {
    var d = [], i, j;
    for (i = 0; i <= a.length; i++) d[i] = [i];
    for (j = 0; j <= b.length; j++) d[0][j] = j;
    for (i = 1; i <= a.length; i++) for (j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  function suggest(word, list) {
    var best = null, bd = 3;
    list.forEach(function (w) { var x = lev(word, w); if (x < bd) { bd = x; best = w; } });
    return best;
  }
  function E(line, summary, detail, where) { return { line: line, summary: summary, detail: detail, where: where }; }

  // ---------- HCL lexer + parser ----------
  function lex(src) {
    var toks = [], i = 0, line = 1, n = src.length;
    while (i < n) {
      var c = src[i];
      if (c === '\n') { toks.push({ t: 'nl', line: line }); line++; i++; continue; }
      if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
      if (c === '#' || (c === '/' && src[i + 1] === '/')) { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') {
        var e = src.indexOf('*/', i + 2);
        if (e < 0) throw E(line, 'Unterminated comment', 'Komentar /* belum ditutup dengan */.');
        line += src.slice(i, e).split('\n').length - 1;
        i = e + 2;
        continue;
      }
      if (c === '"') {
        var j = i + 1, depth = 0, raw = '';
        while (j < n) {
          var ch = src[j];
          if (ch === '\n') throw E(line, 'Unterminated template string', 'Tanda kutip belum ditutup sebelum akhir baris.');
          if (ch === '\\') { raw += ch + (src[j + 1] || ''); j += 2; continue; }
          if (ch === '$' && src[j + 1] === '{') { depth++; raw += '${'; j += 2; continue; }
          if (ch === '}' && depth) { depth--; raw += ch; j++; continue; }
          if (ch === '"' && !depth) break;
          raw += ch; j++;
        }
        if (j >= n) throw E(line, 'Unterminated template string', 'Tanda kutip belum ditutup.');
        toks.push({ t: 'str', v: raw, line: line });
        i = j + 1;
        continue;
      }
      var m;
      if ((m = /^\d+(\.\d+)?/.exec(src.slice(i, i + 32)))) { toks.push({ t: 'num', v: parseFloat(m[0]), line: line }); i += m[0].length; continue; }
      if ((m = /^[A-Za-z_][\w-]*/.exec(src.slice(i, i + 80)))) { toks.push({ t: 'id', v: m[0], line: line }); i += m[0].length; continue; }
      if (c === '<' && src[i + 1] === '<') throw E(line, 'Unsupported heredoc', 'Heredoc (<<EOT) belum didukung di simulasi ini.');
      if ('{}[]=,.:()*'.indexOf(c) >= 0) { toks.push({ t: 'p', v: c, line: line }); i++; continue; }
      throw E(line, 'Invalid character', 'Karakter "' + c + '" ga dikenali di sini.');
    }
    toks.push({ t: 'eof', line: line });
    return toks;
  }

  function Parser(toks) { this.t = toks; this.i = 0; }
  Parser.prototype.peek = function () { return this.t[this.i]; };
  Parser.prototype.next = function () { return this.t[this.i++]; };
  Parser.prototype.nl = function () { while (this.peek().t === 'nl') this.i++; };
  Parser.prototype.is = function (v) { var p = this.peek(); return p.t === 'p' && p.v === v; };
  Parser.prototype.expect = function (v, summary, detail) {
    var p = this.next();
    if (p.t !== 'p' || p.v !== v) throw E(p.line, summary, detail);
    return p;
  };
  Parser.prototype.body = function (open) {
    var items = [];
    for (;;) {
      this.nl();
      var tok = this.peek();
      if (open && this.is('}')) break;
      if (tok.t === 'eof') {
        if (open) throw E(open, 'Unclosed configuration block', 'Ada blok yang dibuka dengan { di baris ' + open + ' tapi belum ditutup dengan }.');
        break;
      }
      if (tok.t !== 'id') throw E(tok.line, 'Argument or block definition required', 'Di sini harusnya nama argumen (misal cidr_block = ...) atau awal blok.');
      this.next();
      if (this.is('=')) {
        this.next();
        var expr = this.expr();
        items.push({ k: 'attr', name: tok.v, expr: expr, line: tok.line });
        var after = this.peek();
        if (!(after.t === 'nl' || after.t === 'eof' || (after.t === 'p' && after.v === '}')))
          throw E(after.line, 'Missing newline after argument', 'Satu argumen satu baris. Ada sisa teks setelah nilai "' + tok.v + '".');
      } else {
        var labels = [];
        while (this.peek().t === 'str') labels.push(this.next().v);
        this.expect('{', 'Invalid block definition', 'Setelah "' + tok.v + '" harusnya ada = (argumen) atau label lalu { (blok).');
        var b = this.body(tok.line);
        this.expect('}', 'Unclosed configuration block', 'Blok belum ditutup.');
        items.push({ k: 'block', type: tok.v, labels: labels, body: b, line: tok.line });
      }
    }
    return items;
  };
  Parser.prototype.expr = function () {
    var tok = this.next();
    if (tok.t === 'str') return { t: 'tmpl', parts: template(tok.v, tok.line), line: tok.line };
    if (tok.t === 'num') return { t: 'lit', v: tok.v, line: tok.line };
    if (tok.t === 'id') {
      if (tok.v === 'true' || tok.v === 'false') return { t: 'lit', v: tok.v === 'true', line: tok.line };
      if (tok.v === 'null') return { t: 'lit', v: null, line: tok.line };
      if (this.is('(')) throw E(tok.line, 'Call to unsupported function', 'Fungsi "' + tok.v + '()" belum didukung di simulasi ini.');
      var path = [tok.v];
      for (;;) {
        if (this.is('.')) {
          this.next();
          var a = this.next();
          if (a.t === 'id') path.push(a.v);
          else if (a.t === 'num') path.push({ idx: a.v });
          else if (a.t === 'p' && a.v === '*') path.push('*');
          else throw E(a.line, 'Invalid attribute name', 'Setelah titik harusnya nama atribut.');
        } else if (this.is('[')) {
          this.next();
          var x = this.next();
          if (x.t === 'num') path.push({ idx: x.v });
          else if (x.t === 'p' && x.v === '*') path.push('*');
          else if (x.t === 'str') path.push(x.v);
          else throw E(x.line, 'Invalid index', 'Index harus angka, misal [0], atau [*].');
          this.expect(']', 'Missing close bracket on index', 'Index belum ditutup dengan ].');
        } else break;
      }
      return { t: 'ref', path: path, line: tok.line };
    }
    if (tok.t === 'p' && tok.v === '[') {
      var items = [];
      for (;;) {
        this.nl();
        if (this.is(']')) { this.next(); break; }
        items.push(this.expr());
        this.nl();
        if (this.is(',')) { this.next(); continue; }
        this.nl();
        if (this.is(']')) { this.next(); break; }
        throw E(this.peek().line, 'Missing item separator', 'Item list dipisah dengan koma dan ditutup dengan ].');
      }
      return { t: 'list', items: items, line: tok.line };
    }
    if (tok.t === 'p' && tok.v === '{') {
      var ents = [];
      for (;;) {
        this.nl();
        if (this.is('}')) { this.next(); break; }
        var k = this.next();
        if (k.t !== 'id' && k.t !== 'str') throw E(k.line, 'Invalid object key', 'Kunci map harus nama atau teks dalam kutip.');
        var eqTok = this.next();
        if (eqTok.t !== 'p' || (eqTok.v !== '=' && eqTok.v !== ':')) throw E(eqTok.line, 'Missing key/value separator', 'Setelah kunci "' + k.v + '" harusnya ada =.');
        ents.push({ key: k.v, expr: this.expr() });
        if (this.is(',')) this.next();
        var nx = this.peek();
        if (!(nx.t === 'nl' || (nx.t === 'p' && nx.v === '}'))) throw E(nx.line, 'Missing attribute separator', 'Tiap pasangan kunci = nilai di map harus di baris sendiri atau dipisah koma.');
      }
      return { t: 'obj', ents: ents, line: tok.line };
    }
    if (tok.t === 'eof' || tok.t === 'nl') throw E(tok.line, 'Missing expression', 'Setelah = harus ada nilainya.');
    throw E(tok.line, 'Invalid expression', 'Nilai "' + tok.v + '" ga dikenali. Kalau maksudnya teks, pakai tanda kutip.');
  };
  function template(raw, line) {
    var parts = [], i = 0, lit = '';
    function unesc(s) { return s.replace(/\\(.)/g, function (m, c) { return c === 'n' ? '\n' : c === 't' ? '\t' : c; }); }
    while (i < raw.length) {
      if (raw[i] === '\\') { lit += raw.slice(i, i + 2); i += 2; continue; }
      if (raw[i] === '$' && raw[i + 1] === '{') {
        var depth = 1, j = i + 2;
        while (j < raw.length && depth) { if (raw[j] === '{') depth++; else if (raw[j] === '}') depth--; j++; }
        if (depth) throw E(line, 'Unclosed template interpolation', '${ belum ditutup dengan }.');
        if (lit) { parts.push(unesc(lit)); lit = ''; }
        var inner = raw.slice(i + 2, j - 1);
        var toks = lex(inner).map(function (t) { t.line = line; return t; });
        var p = new Parser(toks);
        var ex = p.expr();
        if (p.peek().t !== 'eof') throw E(line, 'Extra characters in interpolation', 'Di dalam ${ } cuma boleh satu nilai.');
        parts.push(ex);
        i = j;
        continue;
      }
      lit += raw[i]; i++;
    }
    if (lit || !parts.length) parts.push(unesc(lit));
    return parts;
  }

  // ---------- config decoding ----------
  function attrsOf(body) {
    var o = {};
    body.forEach(function (it) { if (it.k === 'attr') o[it.name] = it; });
    return o;
  }
  function walkRefs(expr, fn) {
    if (!expr) return;
    if (expr.t === 'ref') fn(expr);
    else if (expr.t === 'tmpl') expr.parts.forEach(function (p) { if (typeof p !== 'string') walkRefs(p, fn); });
    else if (expr.t === 'list') expr.items.forEach(function (x) { walkRefs(x, fn); });
    else if (expr.t === 'obj') expr.ents.forEach(function (x) { walkRefs(x.expr, fn); });
  }
  function decode(src) {
    var cfg = { errs: [], region: 'ap-southeast-3', vars: {}, locals: {}, outputs: [], res: [], byAddr: {} };
    var items;
    try { items = new Parser(lex(src)).body(0); }
    catch (e) { if (e.summary) { cfg.errs.push(e); return cfg; } throw e; }

    items.forEach(function (b) {
      if (b.k === 'attr') { cfg.errs.push(E(b.line, 'Unsupported argument', 'Argumen "' + b.name + '" ga boleh di luar blok.')); return; }
      var where = b.type + (b.labels.length ? ' "' + b.labels.join('" "') + '"' : '');
      if (b.type === 'terraform') return;
      if (b.type === 'provider') {
        if (b.labels[0] !== 'aws') { cfg.errs.push(E(b.line, 'Provider not supported here', 'Simulasi ini cuma punya provider "aws".', where)); return; }
        var r = attrsOf(b.body).region;
        if (r && r.expr.t === 'tmpl' && typeof r.expr.parts[0] === 'string') cfg.region = r.expr.parts[0];
        return;
      }
      if (b.type === 'variable') {
        if (b.labels.length !== 1) { cfg.errs.push(E(b.line, 'Missing name for variable', 'Tulis seperti: variable "env" { ... }')); return; }
        var va = attrsOf(b.body);
        cfg.vars[b.labels[0]] = { def: va['default'] ? va['default'].expr : null, line: b.line };
        return;
      }
      if (b.type === 'locals') {
        b.body.forEach(function (it) { if (it.k === 'attr') cfg.locals[it.name] = it.expr; });
        return;
      }
      if (b.type === 'output') {
        var oa = attrsOf(b.body);
        if (!oa.value) { cfg.errs.push(E(b.line, 'Missing required argument', 'Output butuh argumen "value".', where)); return; }
        cfg.outputs.push({ name: b.labels[0], expr: oa.value.expr, line: b.line });
        return;
      }
      if (b.type === 'data' || b.type === 'module') {
        cfg.errs.push(E(b.line, 'Unsupported block type', 'Blok "' + b.type + '" belum didukung di simulasi ini. Pakai resource, variable, locals, atau output.'));
        return;
      }
      if (b.type !== 'resource') {
        var sg = suggest(b.type, ['resource', 'variable', 'output', 'provider', 'locals', 'terraform']);
        cfg.errs.push(E(b.line, 'Unsupported block type', 'Blok "' + b.type + '" ga dikenal di sini.' + (sg ? ' Maksudnya "' + sg + '"?' : '')));
        return;
      }
      if (b.labels.length !== 2) { cfg.errs.push(E(b.line, 'Missing name for resource', 'Resource butuh dua label: tipe dan nama. Misal resource "aws_vpc" "main".')); return; }
      var type = b.labels[0], name = b.labels[1];
      var sch = SCHEMA[type];
      if (!sch) {
        var st = suggest(type, Object.keys(SCHEMA));
        cfg.errs.push(E(b.line, 'Invalid resource type', 'Provider aws (versi simulasi) ga punya resource "' + type + '".' + (st ? ' Maksudnya "' + st + '"?' : ' Yang tersedia: ' + Object.keys(SCHEMA).join(', ') + '.'), where));
        return;
      }
      if (!/^[A-Za-z_][\w-]*$/.test(name)) { cfg.errs.push(E(b.line, 'Invalid resource name', 'Nama resource cuma boleh huruf, angka, _ dan -.', where)); return; }
      var addr = type + '.' + name;
      if (cfg.byAddr[addr]) { cfg.errs.push(E(b.line, 'Duplicate resource "' + type + '" configuration', 'Resource ' + addr + ' sudah dideklarasikan di baris ' + cfg.byAddr[addr].line + '.', where)); return; }
      var res = { type: type, name: name, addr: addr, line: b.line, where: where, attrs: {}, blocks: {}, count: null, lc: {}, deps: [] };
      b.body.forEach(function (it) {
        if (it.k === 'attr') {
          if (it.name === 'count') { res.count = it.expr; return; }
          if (it.name === 'depends_on') return;
          if (!sch.attrs[it.name] || sch.attrs[it.name].t === 'blocks') {
            var s = suggest(it.name, Object.keys(sch.attrs));
            cfg.errs.push(E(it.line, 'Unsupported argument', 'Argumen "' + it.name + '" ga dikenal di ' + type + '.' + (s ? ' Maksudnya "' + s + '"?' : ''), where));
            return;
          }
          res.attrs[it.name] = it;
        } else if (it.type === 'lifecycle') {
          var la = attrsOf(it.body);
          ['prevent_destroy', 'create_before_destroy'].forEach(function (k) {
            if (la[k] && la[k].expr.t === 'lit') res.lc[k] = !!la[k].expr.v;
          });
        } else if (sch.attrs[it.type] && sch.attrs[it.type].t === 'blocks') {
          var bs = sch.attrs[it.type].block, ba = attrsOf(it.body);
          Object.keys(ba).forEach(function (k) {
            if (!bs[k]) cfg.errs.push(E(ba[k].line, 'Unsupported argument', 'Argumen "' + k + '" ga dikenal di blok ' + it.type + '.', where));
          });
          Object.keys(bs).forEach(function (k) {
            if (bs[k].req && !ba[k]) cfg.errs.push(E(it.line, 'Missing required argument', 'Blok ' + it.type + ' butuh argumen "' + k + '".', where));
          });
          (res.blocks[it.type] = res.blocks[it.type] || []).push(ba);
        } else {
          cfg.errs.push(E(it.line, 'Unsupported block type', 'Blok "' + it.type + '" ga dikenal di ' + type + '.', where));
        }
      });
      Object.keys(sch.attrs).forEach(function (k) {
        if (sch.attrs[k].req && !res.attrs[k]) cfg.errs.push(E(b.line, 'Missing required argument', 'Argumen "' + k + '" wajib diisi di ' + addr + '.', where));
      });
      cfg.res.push(res);
      cfg.byAddr[addr] = res;
    });

    // static reference checks + dependency edges
    function check(expr, res, where) {
      walkRefs(expr, function (r) {
        var root = r.path[0];
        if (root === 'var') {
          if (typeof r.path[1] !== 'string' || !cfg.vars[r.path[1]]) cfg.errs.push(E(r.line, 'Reference to undeclared input variable', 'Variable "' + r.path[1] + '" belum dideklarasikan. Tambahkan blok variable "' + r.path[1] + '".', where));
        } else if (root === 'local') {
          if (!cfg.locals[r.path[1]]) cfg.errs.push(E(r.line, 'Reference to undeclared local value', 'local.' + r.path[1] + ' belum ada di blok locals.', where));
        } else if (root === 'count') {
          if (!res || !res.count) cfg.errs.push(E(r.line, 'Reference to "count" in non-counted context', 'count.index cuma bisa dipakai di resource yang punya argumen count.', where));
        } else if (SCHEMA[root]) {
          var a = root + '.' + r.path[1];
          if (!cfg.byAddr[a]) cfg.errs.push(E(r.line, 'Reference to undeclared resource', 'Resource ' + a + ' belum dideklarasikan.', where));
          else if (res && res.deps.indexOf(a) < 0 && a !== res.addr) res.deps.push(a);
          else if (res && a === res.addr) cfg.errs.push(E(r.line, 'Self-referential block', 'Resource ga bisa merujuk dirinya sendiri.', where));
        } else if (root.indexOf('aws_') === 0) {
          cfg.errs.push(E(r.line, 'Reference to undeclared resource', 'Tipe "' + root + '" ga ada di provider aws.', where));
        } else {
          cfg.errs.push(E(r.line, 'Invalid reference', '"' + root + '" bukan referensi yang valid. Kalau maksudnya teks, tulis dalam tanda kutip: "' + root + '".', where));
        }
      });
    }
    cfg.res.forEach(function (res) {
      Object.keys(res.attrs).forEach(function (k) { check(res.attrs[k].expr, res, res.where); });
      Object.keys(res.blocks).forEach(function (k) { res.blocks[k].forEach(function (ba) { Object.keys(ba).forEach(function (x) { check(ba[x].expr, res, res.where); }); }); });
      if (res.count) check(res.count, res, res.where);
    });
    Object.keys(cfg.locals).forEach(function (k) { check(cfg.locals[k], null, 'locals'); });
    cfg.outputs.forEach(function (o) { check(o.expr, null, 'output "' + o.name + '"'); });

    // topological order; a cycle is an error
    var order = [], mark = {};
    function visit(r, stack) {
      if (mark[r.addr] === 2) return;
      if (mark[r.addr] === 1) { cfg.errs.push(E(r.line, 'Cycle: ' + stack.concat(r.addr).join(', '), 'Resource saling bergantung dalam lingkaran, jadi Terraform ga bisa menentukan urutannya.')); return; }
      mark[r.addr] = 1;
      r.deps.forEach(function (d) { if (cfg.byAddr[d]) visit(cfg.byAddr[d], stack.concat(r.addr)); });
      mark[r.addr] = 2;
      order.push(r);
    }
    cfg.res.forEach(function (r) { visit(r, []); });
    cfg.res = order;
    return cfg;
  }

  // ---------- evaluation ----------
  function Ctx(cfg, values, countIndex, where) {
    this.cfg = cfg; this.values = values; this.ci = countIndex; this.where = where;
  }
  Ctx.prototype.eval = function (e) {
    var self = this;
    if (e.t === 'lit') return e.v;
    if (e.t === 'tmpl') {
      if (e.parts.length === 1 && typeof e.parts[0] !== 'string') return this.eval(e.parts[0]);
      var s = '', unk = false;
      e.parts.forEach(function (p) {
        if (typeof p === 'string') { s += p; return; }
        var v = self.eval(p);
        if (v === UNK) unk = true;
        else if (v !== null && typeof v === 'object') throw E(e.line, 'Invalid template interpolation value', 'Nilai list/map ga bisa disisipkan ke dalam teks.', self.where);
        else s += v === null ? '' : String(v);
      });
      return unk ? UNK : s;
    }
    if (e.t === 'list') {
      var l = e.items.map(function (x) { return self.eval(x); });
      return l.some(function (x) { return x === UNK; }) ? UNK : l;
    }
    if (e.t === 'obj') {
      var o = {}, u = false;
      e.ents.forEach(function (x) { var v = self.eval(x.expr); if (v === UNK) u = true; o[x.key] = v; });
      return u ? UNK : o;
    }
    if (e.t === 'ref') return this.ref(e);
    return null;
  };
  Ctx.prototype.ref = function (e) {
    var p = e.path, cfg = this.cfg;
    if (p[0] === 'var') {
      var v = cfg.vars[p[1]];
      if (!v.def) throw E(v.line, 'No value for required variable', 'Variable "' + p[1] + '" ga punya default. Di simulasi ini isi lewat default = ...', 'variable "' + p[1] + '"');
      return new Ctx(cfg, this.values, null, this.where).eval(v.def);
    }
    if (p[0] === 'local') return this.eval(cfg.locals[p[1]]);
    if (p[0] === 'count') {
      if (p[1] !== 'index') throw E(e.line, 'Invalid count attribute', 'Yang ada cuma count.index.', this.where);
      return this.ci;
    }
    var res = cfg.byAddr[p[0] + '.' + p[1]];
    var rest = p.slice(2);
    var insts;
    if (res.count) {
      var k = rest.shift();
      if (k === undefined || typeof k === 'string' && k !== '*') throw E(e.line, 'Missing resource instance key', res.addr + ' pakai count, jadi tulis index-nya: ' + res.addr + '[0]' + (k ? '.' + k : '') + ' atau ' + res.addr + '[*]' + (k ? '.' + k : '') + '.', this.where);
      if (k === '*') insts = Object.keys(this.values).filter(function (a) { return a.indexOf(res.addr + '[') === 0; }).sort();
      else {
        insts = [res.addr + '[' + k.idx + ']'];
        if (!this.values[insts[0]]) throw E(e.line, 'Invalid index', 'Index ' + k.idx + ' di luar jumlah count ' + res.addr + '.', this.where);
      }
    } else {
      if (rest[0] && typeof rest[0] === 'object') throw E(e.line, 'Unexpected resource instance key', res.addr + ' ga pakai count, jadi ga perlu index.', this.where);
      insts = [res.addr];
    }
    var attr = rest[0];
    if (typeof attr !== 'string') throw E(e.line, 'Missing attribute', 'Sebutkan atributnya, misal ' + res.addr + '.id.', this.where);
    var sch = SCHEMA[res.type];
    if (attr !== 'id' && attr !== 'arn' && !sch.attrs[attr]) throw E(e.line, 'Unsupported attribute', res.type + ' ga punya atribut "' + attr + '".', this.where);
    var self = this;
    var vals = insts.map(function (a) {
      var vv = self.values[a];
      if (!vv) return UNK;
      return vv[attr] === undefined ? null : vv[attr];
    });
    if (rest[1] !== undefined) throw E(e.line, 'Unsupported attribute', 'Referensi terlalu dalam untuk simulasi ini.', this.where);
    if (res.count && p.indexOf('*') >= 0) return vals.some(function (x) { return x === UNK; }) ? UNK : vals;
    return vals[0];
  };

  function coerce(v, s, e, where, key) {
    if (v === UNK || v === null) return v;
    var bad = function (want) {
      return E(e.line, 'Incorrect attribute value type', 'Atribut "' + key + '" harus berupa ' + want + '.', where);
    };
    if (s.t === 'string') {
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      if (typeof v !== 'string') throw bad('string (teks)');
    } else if (s.t === 'number') {
      if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v)) return parseFloat(v);
      if (typeof v !== 'number') throw bad('angka');
    } else if (s.t === 'bool') {
      if (v === 'true' || v === 'false') return v === 'true';
      if (typeof v !== 'boolean') throw bad('true/false');
    } else if (s.t === 'list') {
      if (!Array.isArray(v)) throw bad('list, misal ["a", "b"]');
      return v.map(function (x) { return typeof x === 'object' && x !== null ? x : String(x); });
    } else if (s.t === 'map') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad('map, misal { Name = "web" }');
      var o = {};
      Object.keys(v).forEach(function (k) { o[k] = v[k] === null || typeof v[k] === 'object' ? v[k] : String(v[k]); });
      return o;
    }
    return v;
  }
  // evaluate one resource instance's arguments
  function evalRes(cfg, res, idx, values) {
    var sch = SCHEMA[res.type];
    var ctx = new Ctx(cfg, values, idx, res.where);
    var out = {};
    Object.keys(sch.attrs).forEach(function (k) {
      var s = sch.attrs[k];
      if (s.t === 'blocks') {
        out[k] = (res.blocks[k] || []).map(function (ba) {
          var o = {};
          Object.keys(s.block).forEach(function (bk) {
            o[bk] = ba[bk] ? coerce(ctx.eval(ba[bk].expr), s.block[bk], ba[bk].expr, res.where, bk) : s.block[bk].t === 'list' ? [] : null;
          });
          return o;
        });
        if (out[k].some(hasUnk)) out[k] = UNK;
        return;
      }
      var a = res.attrs[k];
      if (a) out[k] = coerce(ctx.eval(a.expr), s, a.expr, res.where, k);
      else if ('def' in s) out[k] = clone(s.def);
      else if (s.oc) out[k] = undefined; // let AWS decide, keep what it picked
      else out[k] = s.t === 'map' ? {} : s.t === 'list' ? [] : null;
    });
    // provider-side validation (runs during plan, like the real provider)
    if (res.type === 'aws_s3_bucket' && typeof out.bucket === 'string' && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(out.bucket))
      throw E(res.attrs.bucket.line, 'invalid value for bucket', 'Nama bucket cuma boleh huruf kecil, angka, titik dan strip, 3 sampai 63 karakter. "' + out.bucket + '" ga memenuhi itu.', res.where);
    ['cidr_block'].forEach(function (k) {
      if (typeof out[k] === 'string' && !/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(out[k]))
        throw E(res.attrs[k].line, 'invalid CIDR address', '"' + out[k] + '" bukan CIDR yang valid. Contoh: "10.0.0.0/16".', res.where);
    });
    return out;
  }
  function countOf(cfg, res, values) {
    if (!res.count) return null;
    var v = new Ctx(cfg, values, null, res.where).eval(res.count);
    if (v === UNK) throw E(res.count.line, 'Invalid count argument', 'Nilai count harus sudah diketahui saat plan, ga boleh bergantung pada atribut yang baru ada setelah apply.', res.where);
    if (typeof v === 'string' && /^\d+$/.test(v)) v = +v;
    if (typeof v !== 'number' || v < 0 || v % 1) throw E(res.count.line, 'Invalid count argument', 'count harus bilangan bulat 0 atau lebih.', res.where);
    if (v > 6) throw E(res.count.line, 'Invalid count argument', 'Di simulasi ini count maksimal 6, biar tagihan AWS-nya ga bengkak 😄', res.where);
    return v;
  }

  // ---------- world: fake AWS + state ----------
  var REAL, ST, W; // REAL: id -> resource in "AWS"; ST: terraform.tfstate; W: everything else
  function initWorld() {
    REAL = {};
    ST = { serial: 0, lineage: hex(8) + '-' + hex(4) + '-' + hex(4) + '-' + hex(4) + '-' + hex(12), res: {}, outputs: {} };
    W = { inited: false, busy: null, confirm: null, plan: null, planSrc: null, lastSummary: null, driftSeen: false };
  }
  function newId(type, attrs) {
    if (type === 'aws_s3_bucket') return attrs.bucket;
    return SCHEMA[type].prefix + '-0' + hex(16);
  }
  function arnOf(type, id, region) {
    var s = SCHEMA[type];
    if (s.svc === 's3') return 'arn:aws:s3:::' + id;
    return 'arn:aws:ec2:' + region + ':' + ACCOUNT + ':' + s.path + '/' + id;
  }
  function stateValues() {
    var v = {};
    Object.keys(ST.res).forEach(function (a) { v[a] = ST.res[a].attrs; });
    return v;
  }

  // ---------- plan ----------
  function addrOf(res, i) { return i === null ? res.addr : res.addr + '[' + i + ']'; }
  function makePlan(cfg, opt) {
    var P = { errs: [], drift: [], moves: [], acts: [], outs: [], refreshed: {}, opt: opt, targetNote: !!opt.target };
    // refresh: read every resource in state back from AWS
    Object.keys(ST.res).forEach(function (a) {
      var s = ST.res[a], r = REAL[s.id];
      if (!r || r.status === 'deleting') { P.drift.push({ addr: a, type: s.type, gone: true, before: s.attrs }); return; }
      var now = clone(r.attrs);
      if (!eq(now, s.attrs)) P.drift.push({ addr: a, type: s.type, before: s.attrs, after: now });
      P.refreshed[a] = { type: s.type, name: s.name, index: s.index, id: s.id, attrs: now, deps: s.deps };
    });
    if (opt.refreshOnly) return P;

    // count index moves: web <-> web[0]
    cfg.res.forEach(function (res) {
      var plain = P.refreshed[res.addr], zero = P.refreshed[res.addr + '[0]'];
      if (res.count && plain && !zero) { P.moves.push([res.addr, res.addr + '[0]']); P.refreshed[res.addr + '[0]'] = plain; plain.index = 0; delete P.refreshed[res.addr]; }
      if (!res.count && zero && !plain) { P.moves.push([res.addr + '[0]', res.addr]); P.refreshed[res.addr] = zero; zero.index = null; delete P.refreshed[res.addr + '[0]']; }
    });

    var values = {};
    Object.keys(P.refreshed).forEach(function (a) { values[a] = P.refreshed[a].attrs; });
    var planned = {}, want = {};
    var tSet = opt.target ? targetSet(cfg, opt.target, opt.destroy) : null;

    try {
      if (opt.destroy) {
        Object.keys(P.refreshed).forEach(function (a) {
          var r = P.refreshed[a];
          var res = cfg.byAddr[r.type + '.' + r.name];
          if (tSet && !tSet[r.type + '.' + r.name] && !tSet[a]) return;
          if (res && res.lc.prevent_destroy) throw E(res.line, 'Instance cannot be destroyed', 'Resource ' + a + ' punya lifecycle.prevent_destroy = true, jadi Terraform menolak menghapusnya. Hapus atau ubah dulu setelan itu kalau memang mau di-destroy.', res.where);
          P.acts.push({ addr: a, type: r.type, name: r.name, index: r.index, act: 'delete', before: r.attrs, why: 'destroy' });
        });
      } else {
        cfg.res.forEach(function (res) {
          var n = countOf(cfg, res, values);
          var idxs = n === null ? [null] : Array.apply(null, Array(n)).map(function (_, i) { return i; });
          idxs.forEach(function (i) {
            var a = addrOf(res, i);
            want[a] = true;
            if (tSet && !tSet[res.addr] && !tSet[a]) { if (P.refreshed[a]) values[a] = P.refreshed[a].attrs; return; }
            var cv = evalRes(cfg, res, i, values);
            var prior = P.refreshed[a], sch = SCHEMA[res.type];
            var act, after = {}, ch = {};
            if (!prior) {
              act = 'create';
              Object.keys(cv).forEach(function (k) { after[k] = cv[k] === undefined ? UNK : cv[k]; });
              after.id = UNK; after.arn = UNK;
            } else {
              var forces = false;
              Object.keys(sch.attrs).forEach(function (k) {
                var c = cv[k], pv = prior.attrs[k];
                if (c === undefined) return; // optional+computed left out: keep
                if (!eq(c, pv)) { ch[k] = true; if (sch.attrs[k].fn) forces = true; }
              });
              if (opt.replace && (opt.replace === a || opt.replace === res.addr)) forces = true;
              if (forces) {
                act = 'replace';
                Object.keys(cv).forEach(function (k) { after[k] = cv[k] === undefined ? (sch.attrs[k].fn ? UNK : prior.attrs[k]) : cv[k]; });
                after.id = UNK; after.arn = UNK;
              } else {
                act = Object.keys(ch).length ? 'update' : 'noop';
                after = clone(prior.attrs);
                Object.keys(cv).forEach(function (k) { if (cv[k] !== undefined) after[k] = cv[k]; });
                if (cv.ingress === UNK) after.ingress = UNK;
              }
              if (act === 'replace' && res.lc.prevent_destroy) throw E(res.line, 'Instance cannot be destroyed', 'Perubahan ini butuh replace ' + a + ', tapi resource-nya punya lifecycle.prevent_destroy = true.', res.where);
            }
            values[a] = after;
            planned[a] = true;
            P.acts.push({ addr: a, type: res.type, name: res.name, index: i, act: act, before: prior ? prior.attrs : null, after: after, ch: ch, res: res, cbd: !!res.lc.create_before_destroy });
          });
        });
        Object.keys(P.refreshed).forEach(function (a) {
          if (want[a]) return;
          var r = P.refreshed[a];
          var decl = cfg.byAddr[r.type + '.' + r.name];
          if (tSet && !tSet[r.type + '.' + r.name] && !tSet[a]) return;
          P.acts.push({ addr: a, type: r.type, name: r.name, index: r.index, act: 'delete', before: r.attrs,
            why: decl ? 'index di luar count' : 'ga ada lagi di konfigurasi' });
        });
      }
      // outputs
      if (!opt.destroy) cfg.outputs.forEach(function (o) {
        var v = new Ctx(cfg, values, null, 'output "' + o.name + '"').eval(o.expr);
        var old = ST.outputs[o.name];
        if (old === undefined) P.outs.push({ name: o.name, sym: '+', to: v });
        else if (!eq(old, v)) P.outs.push({ name: o.name, sym: '~', from: old, to: v });
      });
      Object.keys(ST.outputs).forEach(function (n) {
        if (opt.destroy || !cfg.outputs.some(function (o) { return o.name === n; })) P.outs.push({ name: n, sym: '-', from: ST.outputs[n] });
      });
    } catch (e) {
      if (!e.summary) throw e;
      P.errs.push(e);
    }
    P.values = values;
    return P;
  }
  function targetSet(cfg, target, destroy) {
    var base = target.replace(/\[\d+\]$/, '');
    var set = {};
    set[target] = true; set[base] = true;
    var addTree = function (a) {
      var r = cfg.byAddr[a];
      if (!r) return;
      if (destroy) {
        cfg.res.forEach(function (x) { if (x.deps.indexOf(a) >= 0 && !set[x.addr]) { set[x.addr] = true; addTree(x.addr); } });
      } else {
        r.deps.forEach(function (d) { if (!set[d]) { set[d] = true; addTree(d); } });
      }
    };
    addTree(base);
    return set;
  }
  function counts(P) {
    var c = { add: 0, change: 0, destroy: 0 };
    P.acts.forEach(function (x) {
      if (x.act === 'create') c.add++;
      else if (x.act === 'update') c.change++;
      else if (x.act === 'delete') c.destroy++;
      else if (x.act === 'replace') { c.add++; c.destroy++; }
    });
    return c;
  }

  // ---------- plan rendering ----------
  var SYMCLS = { '+': 'sx-add', '-': 'sx-del', '~': 'sx-chg', '-/+': 'sx-rep', '+/-': 'sx-rep' };
  function fv(v) {
    if (v === UNK) return '<span class="sx-dim">(known after apply)</span>';
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'string') return esc(JSON.stringify(v));
    if (Array.isArray(v)) return v.length ? '[\n' + v.map(function (x) { return '  ' + fv(x) + ','; }).join('\n') + '\n]' : '[]';
    if (typeof v === 'object') return '{\n' + Object.keys(v).map(function (k) { return '  ' + esc(JSON.stringify(k)) + ' = ' + fv(v[k]); }).join('\n') + '\n}';
    return esc(String(v));
  }
  function isScalar(v) { return v === UNK || v === null || v === undefined || typeof v !== 'object'; }
  function ln(ind, sym, text) {
    var s = sym ? '<span class="' + SYMCLS[sym] + '">' + sym + '</span> ' : '  ';
    return [ind + s + text];
  }
  function sp(n) { return new Array(n + 1).join(' '); }
  // whole value being added (+) or removed (-)
  function valLines(ind, sym, key, v, pad, toNull) {
    var k = key + sp(Math.max(0, pad - key.length));
    var tail = toNull ? ' -&gt; null' : '';
    if (isScalar(v)) return ln(ind, sym, k + ' = ' + fv(v) + tail);
    var out;
    if (Array.isArray(v)) {
      if (!v.length) return ln(ind, sym, k + ' = []' + tail);
      out = ln(ind, sym, k + ' = [');
      v.forEach(function (x) {
        if (isScalar(x)) out = out.concat(ln(ind + '    ', sym, fv(x) + ','));
        else out = out.concat(objLines(ind + '    ', sym, x, toNull), [ind + '      },']);
      });
      return out.concat([ind + '  ]' + tail]);
    }
    var keys = Object.keys(v);
    if (!keys.length) return ln(ind, sym, k + ' = {}' + tail);
    var kp = Math.max.apply(null, keys.map(function (x) { return JSON.stringify(x).length; }));
    out = ln(ind, sym, k + ' = {');
    keys.forEach(function (x) {
      var q = JSON.stringify(x);
      out = out.concat(ln(ind + '    ', sym, esc(q) + sp(kp - q.length) + ' = ' + fv(v[x]) + tail));
    });
    return out.concat([ind + '  }']);
  }
  function objLines(ind, sym, o, toNull) {
    var keys = Object.keys(o);
    var kp = Math.max.apply(null, keys.map(function (x) { return x.length; }));
    var out = ln(ind, sym, '{');
    keys.forEach(function (k) {
      if (o[k] === null || (Array.isArray(o[k]) && !o[k].length && sym === '+')) return;
      out = out.concat(valLines(ind + '    ', sym, k, o[k], kp, toNull));
    });
    return out;
  }
  function diffLines(ind, key, from, to, pad, forces) {
    var k = key + sp(Math.max(0, pad - key.length));
    var fr = forces ? ' <span class="sx-del"># forces replacement</span>' : '';
    if (to === UNK || from === UNK || isScalar(from) && isScalar(to)) {
      if (from === null || from === undefined) return valLines(ind, '+', key, to, pad).map(function (l) { return l + fr; });
      if ((to === null || to === undefined) && !forces) return valLines(ind, '-', key, from, pad, true);
      return ln(ind, '~', k + ' = ' + fv(from) + ' -&gt; ' + fv(to) + fr);
    }
    var out;
    if (Array.isArray(from) || Array.isArray(to)) {
      from = from || []; to = to || [];
      out = ln(ind, '~', k + ' = [' + fr);
      from.forEach(function (x) {
        if (to.some(function (y) { return eq(x, y); })) return;
        out = isScalar(x) ? out.concat(ln(ind + '    ', '-', fv(x) + ',')) : out.concat(objLines(ind + '    ', '-', x, true), [ind + '      },']);
      });
      to.forEach(function (x) {
        if (from.some(function (y) { return eq(x, y); })) return;
        out = isScalar(x) ? out.concat(ln(ind + '    ', '+', fv(x) + ',')) : out.concat(objLines(ind + '    ', '+', x), [ind + '      },']);
      });
      return out.concat([ind + '  ]']);
    }
    from = from || {}; to = to || {};
    var keys = Object.keys(from).concat(Object.keys(to).filter(function (x) { return !(x in from); }));
    var kp = Math.max.apply(null, keys.map(function (x) { return JSON.stringify(x).length; }));
    out = ln(ind, '~', k + ' = {' + fr);
    keys.forEach(function (x) {
      var q = esc(JSON.stringify(x)) + sp(kp - JSON.stringify(x).length);
      if (!(x in to)) out = out.concat(ln(ind + '    ', '-', q + ' = ' + fv(from[x]) + ' -&gt; null'));
      else if (!(x in from)) out = out.concat(ln(ind + '    ', '+', q + ' = ' + fv(to[x])));
      else if (!eq(from[x], to[x])) out = out.concat(ln(ind + '    ', '~', q + ' = ' + fv(from[x]) + ' -&gt; ' + fv(to[x])));
    });
    return out.concat([ind + '  }']);
  }
  function resHead(sym, type, name) {
    var s = sym === '-/+' || sym === '+/-' ? sym : '  ' + sym;
    return ['<span class="' + SYMCLS[sym] + '">' + s + '</span> resource "' + type + '" "' + name + '" {'];
  }
  function actLines(x) {
    var sch = SCHEMA[x.type], keys, pad, out = [], hidden = 0;
    var ind = '      ';
    if (x.act === 'create') {
      out.push('<span class="sx-dim">  # </span><b>' + x.addr + '</b> will be created');
      out = out.concat(resHead('+', x.type, x.name));
      keys = Object.keys(x.after).filter(function (k) {
        var v = x.after[k];
        return !(v === null || (Array.isArray(v) && !v.length) || (v && typeof v === 'object' && v !== UNK && !Array.isArray(v) && !Object.keys(v).length));
      }).sort();
      pad = Math.max.apply(null, keys.map(function (k) { return k.length; }));
      keys.forEach(function (k) { out = out.concat(valLines(ind, '+', k, x.after[k], pad)); });
    } else if (x.act === 'delete') {
      out.push('<span class="sx-dim">  # </span><b>' + x.addr + '</b> will be destroyed');
      if (x.why && x.why !== 'destroy') out.push('<span class="sx-dim">  # (karena ' + x.addr + ' ' + x.why + ')</span>');
      out = out.concat(resHead('-', x.type, x.name));
      keys = Object.keys(x.before).filter(function (k) { var v = x.before[k]; return v !== null && !(Array.isArray(v) && !v.length) && !(v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length); }).sort();
      pad = Math.max.apply(null, keys.map(function (k) { return k.length; }));
      keys.forEach(function (k) { out = out.concat(valLines(ind, '-', k, x.before[k], pad, true)); });
    } else {
      var rep = x.act === 'replace';
      out.push('<span class="sx-dim">  # </span><b>' + x.addr + '</b> ' + (rep ? 'must be <span class="sx-del">replaced</span>' : 'will be updated in-place'));
      out = out.concat(resHead(rep ? (x.cbd ? '+/-' : '-/+') : '~', x.type, x.name));
      keys = Object.keys(sch.attrs).filter(function (k) { return x.ch[k]; });
      var all = keys.concat(rep ? ['arn', 'id'] : ['id']).sort();
      pad = Math.max.apply(null, all.map(function (k) { return k.length; }));
      all.forEach(function (k) {
        if (k === 'id' || k === 'arn') {
          if (rep) out = out.concat(ln(ind, '~', k + sp(pad - k.length) + ' = ' + fv(x.before[k]) + ' -&gt; ' + fv(UNK)));
          else out.push(ind + '  ' + k + sp(pad - k.length) + ' = ' + fv(x.before[k]));
        } else out = out.concat(diffLines(ind, k, x.before[k], x.after[k], pad, rep && sch.attrs[k].fn));
      });
      hidden = Object.keys(x.before).length - keys.length - (rep ? 2 : 1);
      if (hidden > 0) out.push('<span class="sx-dim">' + ind + '  # (' + hidden + ' unchanged attributes hidden)</span>');
    }
    out.push('    }');
    return out;
  }
  function driftLines(P) {
    if (!P.drift.length) return [];
    var out = ['', '<span class="sx-b">Note: Objects have changed outside of Terraform</span>', '',
      'Terraform detected the following changes made outside of Terraform since the',
      'last "terraform apply" which may have affected this plan:', ''];
    P.drift.forEach(function (d) {
      if (d.gone) {
        out.push('<span class="sx-dim">  # </span><b>' + d.addr + '</b> has been deleted');
        out = out.concat(resHead('-', d.type, d.addr.split('.')[1].replace(/\[.*$/, '')));
        out.push('      <span class="sx-del">-</span> id = ' + fv(d.before.id) + ' -&gt; null');
      } else {
        out.push('<span class="sx-dim">  # </span><b>' + d.addr + '</b> has changed');
        out = out.concat(resHead('~', d.type, d.addr.split('.')[1].replace(/\[.*$/, '')));
        var keys = Object.keys(d.after).filter(function (k) { return !eq(d.before[k], d.after[k]); });
        var pad = Math.max.apply(null, keys.concat(['id']).map(function (k) { return k.length; }));
        out.push('        id' + sp(pad - 2) + ' = ' + fv(d.before.id));
        keys.forEach(function (k) { out = out.concat(diffLines('      ', k, d.before[k], d.after[k], pad)); });
      }
      out.push('    }', '');
    });
    if (!P.opt.refreshOnly) out.push('Unless you have made equivalent changes to your configuration, or ignored the',
      'relevant attributes using ignore_changes, the following plan may include',
      'actions to undo or respond to these changes.', '', '<span class="sx-dim">' + new Array(61).join('─') + '</span>');
    return out;
  }
  function planLines(P) {
    var out = driftLines(P);
    P.moves.forEach(function (m) {
      out.push('', '<span class="sx-dim">  # </span><b>' + m[0] + '</b> has moved to <b>' + m[1] + '</b>');
    });
    var acts = P.acts.filter(function (x) { return x.act !== 'noop'; });
    if (P.opt.refreshOnly) {
      if (!P.drift.length) out.push('', '<span class="sx-ok sx-b">No changes.</span> Your infrastructure still matches the configuration.');
      else out.push('This is a refresh-only plan, so Terraform will not take any actions to undo',
        'these. If you were expecting these changes then you can apply this plan to',
        'record the updated values in the Terraform state without changing any remote objects.');
      return out;
    }
    if (!acts.length && !P.outs.length) {
      out.push('', '<span class="sx-ok sx-b">No changes.</span> Your infrastructure matches the configuration.', '',
        'Terraform has compared your real infrastructure against your configuration',
        'and found no differences, so no changes are needed.');
      return out;
    }
    if (acts.length) {
      var used = {};
      acts.forEach(function (x) { used[x.act === 'replace' ? (x.cbd ? 'cbd' : 'rep') : x.act] = true; });
      out.push('', 'Terraform used the selected providers to generate the following execution',
        'plan. Resource actions are indicated with the following symbols:');
      if (used.create) out.push('  <span class="sx-add">+</span> create');
      if (used.update) out.push('  <span class="sx-chg">~</span> update in-place');
      if (used['delete']) out.push('  <span class="sx-del">-</span> destroy');
      if (used.rep) out.push('<span class="sx-rep">-/+</span> destroy and then create replacement');
      if (used.cbd) out.push('<span class="sx-rep">+/-</span> create replacement and then destroy');
      out.push('', 'Terraform will perform the following actions:', '');
      acts.forEach(function (x) { out = out.concat(actLines(x), ['']); });
      var c = counts(P);
      out.push('<span class="sx-b">Plan:</span> ' + c.add + ' to add, ' + c.change + ' to change, ' + c.destroy + ' to destroy.');
    } else {
      out.push('', 'Changes to Outputs only. You can apply this plan to save these new output values to the Terraform state.');
    }
    if (P.outs.length) {
      out.push('', 'Changes to Outputs:');
      var pad = Math.max.apply(null, P.outs.map(function (o) { return o.name.length; }));
      P.outs.forEach(function (o) {
        var k = o.name + sp(pad - o.name.length);
        if (o.sym === '+') out = out.concat(ln('  ', '+', k + ' = ' + fv(o.to)));
        else if (o.sym === '-') out = out.concat(ln('  ', '-', k + ' = ' + fv(o.from) + ' -&gt; null'));
        else out = out.concat(ln('  ', '~', k + ' = ' + fv(o.from) + ' -&gt; ' + fv(o.to)));
      });
    }
    if (P.targetNote) out.push('', '<span class="sx-warn">╷</span>', '<span class="sx-warn">│ Warning: Resource targeting is in effect</span>', '<span class="sx-warn">│</span> Plan ini cuma mencakup sebagian resource. Pakai -target buat keadaan darurat saja,', '<span class="sx-warn">│</span> bukan kebiasaan sehari-hari.', '<span class="sx-warn">╵</span>');
    return out;
  }

  // ---------- terminal ----------
  var term = new K.Term($('tf-out'), $('tf-in'), { onCmd: run });
  var toast = K.makeToast($('tf-toast'));
  var M = new K.Missions($('tf-m-list'), $('tf-m-count'), MISSIONS, toast, '🎉 Semua misi beres. Kamu udah paham alur kerja Terraform!');
  var PS = 'lab@tf:~/infra$';
  function errBox(e, cls) {
    var lines = ['<span class="' + (cls || 'sx-err') + '">╷</span>', '<span class="' + (cls || 'sx-err') + '">│ <span class="sx-b">' + (cls ? 'Warning' : 'Error') + ':</span> ' + esc(e.summary) + '</span>', '<span class="' + (cls || 'sx-err') + '">│</span>'];
    if (e.line) {
      var src = ed.get().split('\n')[e.line - 1] || '';
      lines.push('<span class="sx-err">│</span>   on main.tf line ' + e.line + (e.where ? ', in ' + esc(e.where) : '') + ':');
      lines.push('<span class="sx-err">│</span>   ' + e.line + ': <span class="sx-u">' + esc(src.trim()) + '</span>');
      lines.push('<span class="sx-err">│</span>');
    }
    String(e.detail || '').split('\n').forEach(function (d) { lines.push('<span class="' + (cls || 'sx-err') + '">│</span> ' + esc(d)); });
    lines.push('<span class="' + (cls || 'sx-err') + '">╵</span>');
    term.lines(lines);
  }
  function showErrs(errs) {
    errs.forEach(function (e) { errBox(e); });
    ed.mark(errs.map(function (e) { return e.line; }));
  }
  function needInit() {
    if (W.inited) return false;
    errBox({ summary: 'Inconsistent dependency lock file', detail: 'Provider registry.terraform.io/hashicorp/aws dibutuhkan konfigurasi ini,\ntapi belum terpasang. Jalankan dulu:\n  terraform init' });
    return true;
  }
  function loadCfg() {
    var cfg = decode(ed.get());
    if (cfg.errs.length) { showErrs(cfg.errs); return null; }
    ed.mark([]);
    return cfg;
  }
  function parseArgs(args) {
    var o = { flags: {}, pos: [] };
    args.forEach(function (a) {
      var m = /^--?([\w-]+)(?:=(.*))?$/.exec(a);
      if (m) o.flags[m[1]] = m[2] === undefined ? true : m[2].replace(/^["']|["']$/g, '');
      else o.pos.push(a);
    });
    return o;
  }

  function run(line) {
    if (W.confirm) { answer(line); return; }
    term.echo(PS, line);
    if (!line) return;
    var words = line.match(/"[^"]*"|'[^']*'|\S+/g) || [];
    var cmd = words.shift();
    if (cmd === 'clear') { term.clear(); return; }
    if (cmd === 'help') { help(); return; }
    if (cmd === 'ls') { term.line('main.tf' + (W.inited ? '  .terraform/  .terraform.lock.hcl' : '') + (ST.serial ? '  terraform.tfstate' : '')); return; }
    if (cmd === 'cat' && words[0] === 'main.tf') { term.lines(ed.get().split('\n').map(K.hlHCL)); return; }
    if (cmd !== 'terraform' && cmd !== 'tf') {
      term.line('bash: ' + esc(cmd) + ': command not found', 'sx-err');
      term.line('<span class="sx-dim">Ketik <b>help</b> buat lihat perintah yang ada.</span>');
      return;
    }
    if (W.busy) {
      errBox({ summary: 'Error acquiring the state lock', detail: 'State lagi dikunci oleh operasi "' + W.busy + '" yang masih jalan.\nTunggu sampai selesai dulu ya.' });
      return;
    }
    var sub = words.shift() || 'help';
    var a = parseArgs(words);
    if (sub === 'init') init();
    else if (sub === 'validate') validate();
    else if (sub === 'fmt') fmt();
    else if (sub === 'plan') plan(a);
    else if (sub === 'apply') apply(a, false);
    else if (sub === 'destroy') apply(a, true);
    else if (sub === 'state') stateCmd(a);
    else if (sub === 'output') outputCmd(a);
    else if (sub === 'show') showCmd();
    else if (sub === 'version' || sub === '-v' || sub === '--version') {
      term.line('Terraform v' + TF_VER);
      term.line('on linux_amd64');
      if (W.inited) term.line('+ provider registry.terraform.io/hashicorp/aws v' + AWS_VER);
    } else if (sub === 'help' || sub === '-help') help();
    else if (sub === 'import' || sub === 'console' || sub === 'workspace' || sub === 'taint' || sub === 'graph' || sub === 'login') {
      term.line('Perintah <b>terraform ' + esc(sub) + '</b> ada di Terraform beneran, tapi belum dibuat di simulasi ini.', 'sx-warn');
    } else {
      term.line('Terraform has no command named "' + esc(sub) + '".', 'sx-err');
      term.line('<span class="sx-dim">To see all of Terraform\'s top-level commands, run: terraform -help</span>');
    }
  }
  function help() {
    term.lines([
      '<span class="sx-b">Perintah yang bisa dicoba:</span>',
      '  terraform init                    pasang provider aws',
      '  terraform plan [-destroy] [-target=ADDR] [-refresh-only]',
      '  terraform apply [-auto-approve] [-target=ADDR] [-replace=ADDR] [-refresh-only]',
      '  terraform destroy [-auto-approve] [-target=ADDR]',
      '  terraform validate | fmt | show | output [NAMA] | version',
      '  terraform state list | show ADDR | rm ADDR',
      '  ls, cat main.tf, clear',
      '<span class="sx-dim">Panah atas/bawah buat ambil perintah sebelumnya.</span>'
    ]);
  }

  function init() {
    var cfg = decode(ed.get());
    W.busy = 'init';
    var steps = [[150, '<span class="sx-b">Initializing the backend...</span>'], [250, ''], [100, '<span class="sx-b">Initializing provider plugins...</span>']];
    if (W.inited) {
      steps.push([300, '- Reusing previous version of hashicorp/aws from the dependency lock file'], [250, '- Using previously-installed hashicorp/aws v' + AWS_VER]);
    } else {
      steps.push([300, '- Finding hashicorp/aws versions matching "~&gt; 5.0"...'], [700, '- Installing hashicorp/aws v' + AWS_VER + '...'],
        [900, '- Installed hashicorp/aws v' + AWS_VER + ' (signed by HashiCorp)'], [200, ''],
        [150, 'Terraform has created a lock file <b>.terraform.lock.hcl</b> to record the provider'],
        [0, 'selections it made above. Include this file in your version control repository'],
        [0, 'so that Terraform can guarantee to make the same selections by default when'],
        [0, 'you run "terraform init" in the future.']);
    }
    steps.push([200, function () {
      W.busy = null;
      if (cfg.errs.length) {
        term.line('');
        showErrs(cfg.errs);
        term.line('<span class="sx-err">Terraform encountered problems during initialisation, including problems with the configuration, described above.</span>');
      } else {
        ed.mark([]);
      }
      W.inited = true;
      term.lines(['', '<span class="sx-ok sx-b">Terraform has been successfully initialized!</span>', '',
        'You may now begin working with Terraform. Try running "terraform plan" to see',
        'any changes that are required for your infrastructure.']);
      K.flash(app, 'code');
      render();
    }]);
    term.play(steps);
    render();
  }
  function validate() {
    if (needInit()) return;
    var cfg = loadCfg();
    if (!cfg) return;
    try {
      var vals = stateValues();
      cfg.res.forEach(function (r) { evalRes(cfg, r, r.count ? 0 : null, vals); });
    } catch (e) {
      if (!e.summary) throw e;
      if (!/known after apply/.test(e.detail)) { showErrs([e]); return; }
    }
    term.line('<span class="sx-ok sx-b">Success!</span> The configuration is valid.');
  }
  function fmt() {
    var src = ed.get(), out = fmtHCL(src);
    if (out !== src) { ed.set(out); term.line('main.tf'); toast('main.tf dirapikan oleh terraform fmt'); }
  }
  function fmtHCL(src) {
    var depth = 0;
    var lines = src.replace(/\t/g, '  ').split('\n').map(function (l) {
      var t = l.trim();
      var code = t.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/(#|\/\/).*$/, '');
      var lead = (/^[}\]]+/.exec(code) || [''])[0].length;
      depth = Math.max(0, depth - lead);
      var outL = t ? sp(depth * 2) + t : '';
      var opens = (code.match(/[{[]/g) || []).length, closes = (code.match(/[}\]]/g) || []).length - lead;
      depth = Math.max(0, depth + opens - closes);
      return outL;
    });
    // align "=" in runs of single-line arguments at the same indent
    var i = 0;
    while (i < lines.length) {
      var m = /^(\s*)([\w"-]+)\s*=(?!=)\s*(.*)$/.exec(lines[i]);
      if (!m) { i++; continue; }
      var j = i, run = [];
      while (j < lines.length) {
        var mm = /^(\s*)([\w"-]+)\s*=(?!=)\s*(.*)$/.exec(lines[j]);
        if (!mm || mm[1] !== m[1]) break;
        run.push(mm);
        j++;
        if (/[{[]\s*$/.test(mm[3])) break;
      }
      var w = Math.max.apply(null, run.map(function (x) { return x[2].length; }));
      run.forEach(function (x, k) { lines[i + k] = x[1] + x[2] + sp(w - x[2].length) + ' = ' + x[3]; });
      i = j;
    }
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s*$/, '\n');
  }

  function plan(a) {
    if (needInit()) return;
    var cfg = loadCfg();
    if (!cfg) return;
    var opt = { destroy: !!a.flags.destroy, target: a.flags.target || null, refreshOnly: !!a.flags['refresh-only'], replace: a.flags.replace || null };
    if (a.flags.target === true) { term.line('Error: -target butuh alamat, misal -target=aws_instance.web', 'sx-err'); return; }
    W.busy = 'plan';
    var steps = refreshSteps(), P;
    steps.push([400, function () {
      W.busy = null;
      P = makePlan(cfg, opt);
      if (P.errs.length) { showErrs(P.errs); return; }
      term.lines(planLines(P));
      if (P.acts.some(function (x) { return x.act !== 'noop'; })) {
        term.lines(['', '<span class="sx-dim">' + new Array(61).join('─') + '</span>', '',
          'Note: You didn\'t use the -out option to save this plan, so Terraform can\'t',
          'guarantee to take exactly these actions if you run "terraform apply" now.']);
      }
      W.plan = counts(P);
      W.plan.refresh = opt.refreshOnly;
      W.plan.none = !P.acts.some(function (x) { return x.act !== 'noop'; }) && !P.outs.length;
      W.planSrc = ed.get() + '|' + realSig();
      if (P.drift.length) { W.driftSeen = true; K.flash(app, 'aws', 'warn'); }
      K.pulse(app, 'plan');
      K.flash(app, 'plan');
      M.hit('plan');
      render();
    }]);
    term.play(steps);
    render();
  }
  function refreshSteps() {
    var steps = [];
    Object.keys(ST.res).sort().forEach(function (a) {
      steps.push([80, '<b>' + a + '</b>: Refreshing state... [id=' + esc(ST.res[a].id) + ']']);
    });
    if (steps.length) steps.push([0, '']);
    return steps;
  }
  function realSig() {
    return Object.keys(REAL).map(function (id) { return id + JSON.stringify(REAL[id].attrs); }).join(';');
  }

  function apply(a, destroy) {
    if (needInit()) return;
    var cfg = loadCfg();
    if (!cfg) return;
    var opt = { destroy: destroy, target: a.flags.target || null, refreshOnly: !!a.flags['refresh-only'], replace: a.flags.replace || null };
    var auto = !!a.flags['auto-approve'];
    W.busy = destroy ? 'destroy' : 'apply';
    var steps = refreshSteps();
    steps.push([400, function () {
      var P = makePlan(cfg, opt);
      if (P.errs.length) { W.busy = null; showErrs(P.errs); render(); return; }
      term.lines(planLines(P));
      var acts = P.acts.filter(function (x) { return x.act !== 'noop'; });
      if (opt.refreshOnly) {
        if (!P.drift.length) { W.busy = null; render(); return; }
      } else if (!acts.length && !P.outs.length) {
        W.busy = null;
        if (destroy) term.lines(['', '<span class="sx-ok sx-b">Destroy complete! Resources: 0 destroyed.</span>']);
        else term.lines(['', '<span class="sx-ok sx-b">Apply complete! Resources: 0 added, 0 changed, 0 destroyed.</span>']);
        if (P.drift.length) W.driftSeen = true;
        render();
        return;
      }
      if (P.drift.length) W.driftSeen = true;
      if (auto) { execute(P, cfg); return; }
      term.lines(['', '<span class="sx-b">' + (destroy ? 'Do you really want to destroy all resources?' : opt.refreshOnly ? 'Would you like to update the Terraform state to reflect these detected changes?' : 'Do you want to perform these actions?') + '</span>',
        '  ' + (destroy ? 'Terraform will destroy all your managed infrastructure, as shown above.' : 'Terraform will perform the actions described above.'),
        '  ' + (destroy ? 'There is no undo. ' : '') + 'Only \'yes\' will be accepted to approve.', '']);
      W.confirm = { P: P, cfg: cfg };
      $('tf-ps').textContent = 'Enter a value:';
      app.classList.add('is-confirm');
      $('tf-in').focus({ preventScroll: true });
      render();
    }]);
    term.play(steps);
    render();
  }
  function answer(v) {
    var c = W.confirm;
    W.confirm = null;
    $('tf-ps').textContent = PS;
    app.classList.remove('is-confirm');
    term.line('  <span class="sx-b">Enter a value:</span> ' + esc(v));
    term.line('');
    if (v !== 'yes') {
      W.busy = null;
      term.line('<span class="sx-err">' + (c.P.opt.destroy ? 'Destroy' : 'Apply') + ' cancelled.</span>');
      render();
      return;
    }
    execute(c.P, c.cfg);
  }

  // ---------- apply executor ----------
  function execute(P, cfg) {
    var opt = P.opt;
    var started = Date.now();
    if (opt.refreshOnly) {
      P.drift.forEach(function (d) {
        if (d.gone) delete ST.res[d.addr];
        else ST.res[d.addr].attrs = clone(d.after);
      });
      Object.keys(REAL).forEach(function (id) { REAL[id].drift = false; });
      ST.serial++;
      W.busy = null; W.plan = null;
      term.lines(['', '<span class="sx-ok sx-b">Apply complete! Resources: 0 added, 0 changed, 0 destroyed.</span>']);
      K.pulse(app, 'state'); K.flash(app, 'state');
      render();
      return;
    }
    P.moves.forEach(function (m) {
      var s = ST.res[m[0]];
      if (!s) return;
      delete ST.res[m[0]];
      s.index = /\[\d+\]$/.test(m[1]) ? 0 : null;
      ST.res[m[1]] = s;
    });
    var ops = [], byKey = {};
    function op(key, x, kind) {
      var o = { key: key, x: x, kind: kind, pre: [], state: 'wait' };
      ops.push(o); byKey[key] = o;
      return o;
    }
    P.acts.forEach(function (x) {
      if (x.act === 'noop') return;
      if (x.act === 'replace') {
        var d = op(x.addr + '#d', x, 'delete'), c = op(x.addr + '#c', x, 'create');
        if (x.cbd) d.pre.push(c.key); else c.pre.push(d.key);
      } else op(x.addr + '#' + (x.act === 'delete' ? 'd' : 'c'), x, x.act);
    });
    var resOf = function (addr) { return addr.replace(/\[\d+\]$/, ''); };
    ops.forEach(function (o) {
      var mine = resOf(o.x.addr);
      if (o.kind === 'delete') {
        // delete after everything that depends on this resource is gone or updated
        ops.forEach(function (p) {
          if (p === o) return;
          var deps = p.x.res ? p.x.res.deps : (ST.res[p.x.addr] ? ST.res[p.x.addr].deps : []);
          if (deps.indexOf(mine) >= 0 && (p.kind === 'delete' || p.kind === 'update')) o.pre.push(p.key);
        });
      } else {
        var deps = o.x.res ? o.x.res.deps : [];
        ops.forEach(function (p) {
          if (p === o || p.kind === 'delete') return;
          if (deps.indexOf(resOf(p.x.addr)) >= 0) o.pre.push(p.key);
        });
      }
    });

    var region = cfg.region, added = 0, changed = 0, destroyed = 0, errors = [];
    var timer = setInterval(step, 100);
    W.running = true;
    function step() {
      var now = Date.now(), active = 0;
      ops.forEach(function (o) { if (o.state === 'run') active++; });
      ops.forEach(function (o) {
        if (o.state === 'wait') {
          var bad = o.pre.some(function (k) { return byKey[k].state === 'fail' || byKey[k].state === 'skip'; });
          if (bad) { o.state = 'skip'; return; }
          if (active < 10 && o.pre.every(function (k) { return byKey[k].state === 'done'; })) { start(o, now); active++; }
        } else if (o.state === 'run') {
          var el = Math.floor((now - o.t0) / 1000) * SPEED;
          if (el >= 10 && el !== o.lastTick && now < o.end) {
            o.lastTick = el;
            term.line('<b>' + o.x.addr + '</b>: Still ' + (o.kind === 'create' ? 'creating' : o.kind === 'delete' ? 'destroying' : 'modifying') + '... [' + (o.idShow ? 'id=' + esc(o.idShow) + ', ' : '') + el + 's elapsed]');
          }
          if (now >= o.end) finish(o, now);
        }
      });
      // nothing running and nothing can start: the remaining ops wait on each other
      var settled = function (k) { return byKey[k].state !== 'wait' && byKey[k].state !== 'run'; };
      if (!ops.some(function (o) { return o.state === 'run' || (o.state === 'wait' && o.pre.every(settled)); })) {
        ops.forEach(function (o) {
          if (o.state !== 'wait') return;
          o.state = 'fail';
          errors.push({ summary: 'deleting ' + o.x.addr + ': DependencyViolation', detail: 'Resource ini masih dipakai resource lain, jadi AWS menolak menghapusnya. Coba lifecycle { create_before_destroy = true }.', line: o.x.res ? o.x.res.line : 0, where: o.x.res ? o.x.res.where : '' });
        });
      }
      if (ops.every(function (o) { return o.state !== 'wait' && o.state !== 'run'; })) done();
      render();
    }
    function start(o, now) {
      var x = o.x, sch = SCHEMA[x.type];
      o.state = 'run'; o.t0 = now;
      if (o.kind === 'delete') {
        var s = ST.res[x.addr];
        o.id = s ? s.id : x.before.id;
        o.idShow = o.id;
        if (REAL[o.id]) REAL[o.id].status = 'deleting';
        o.end = now + sch.del;
        term.line('<b>' + x.addr + '</b>: Destroying... [id=' + esc(o.id) + ']');
        if (x.type === 'aws_s3_bucket' && REAL[o.id] && REAL[o.id].objects && !REAL[o.id].attrs.force_destroy) o.fail = { s: 'deleting S3 Bucket (' + o.id + '): BucketNotEmpty', d: 'Bucket masih berisi file. Kosongkan dulu isinya, atau set force_destroy = true lalu apply sebelum destroy.' };
        return;
      }
      // resolve the final values now that dependencies exist in AWS
      var vals = stateValues(), attrs;
      try { attrs = evalRes(cfg, x.res, x.index, vals); }
      catch (e) { o.fail = { s: e.summary, d: e.detail }; o.end = now + 300; return; }
      var prior = ST.res[x.addr];
      if (o.kind === 'update') {
        o.id = prior.id; o.idShow = o.id;
        var nu = clone(REAL[o.id] ? REAL[o.id].attrs : prior.attrs);
        Object.keys(attrs).forEach(function (k) { if (attrs[k] !== undefined) nu[k] = attrs[k]; });
        o.attrs = nu;
        if (REAL[o.id]) REAL[o.id].status = 'updating';
        o.end = now + (sch.upd || 900);
        term.line('<b>' + x.addr + '</b>: Modifying... [id=' + esc(o.id) + ']');
        if (x.type === 'aws_instance' && INSTANCE_TYPES.indexOf(nu.instance_type) < 0) o.fail = { s: 'modifying EC2 Instance (' + o.id + '): InvalidParameterValue', d: 'Invalid value \'' + nu.instance_type + '\' for InstanceType. Yang ada di simulasi ini: ' + INSTANCE_TYPES.join(', ') + '.' };
        return;
      }
      // create
      Object.keys(sch.attrs).forEach(function (k) {
        if (attrs[k] !== undefined) return;
        if (k === 'availability_zone') attrs[k] = region + 'a';
        else if (k === 'vpc_id') attrs[k] = DEF.vpc;
        else if (k === 'subnet_id') attrs[k] = DEF.subnet;
        else if (k === 'vpc_security_group_ids') attrs[k] = [DEF.sg];
        else attrs[k] = null;
      });
      term.line('<b>' + x.addr + '</b>: Creating...');
      o.end = now + sch.time;
      var fail = null;
      if (x.type === 'aws_instance') {
        if (INSTANCE_TYPES.indexOf(attrs.instance_type) < 0) fail = { s: 'creating EC2 Instance: InvalidParameterValue', d: 'Invalid value \'' + attrs.instance_type + '\' for InstanceType. Yang ada di simulasi ini: ' + INSTANCE_TYPES.join(', ') + '.' };
        else if (!/^ami-[0-9a-f]{8,17}$/.test(attrs.ami)) fail = { s: 'creating EC2 Instance: InvalidAMIID.Malformed', d: 'Invalid id: "' + attrs.ami + '" (expecting "ami-..."). AMI ID itu ami- diikuti 8 sampai 17 karakter hex.' };
      }
      if (x.type === 'aws_s3_bucket') {
        var taken = TAKEN_BUCKETS.indexOf(attrs.bucket) >= 0;
        var mine = Object.keys(REAL).some(function (id) { return REAL[id].type === 'aws_s3_bucket' && id === attrs.bucket; });
        if (taken || mine) fail = { s: 'creating S3 Bucket (' + attrs.bucket + '): BucketAlreadyExists', d: 'Nama bucket S3 berlaku global untuk semua akun AWS, dan "' + attrs.bucket + '" sudah dipakai orang lain. Pilih nama yang lebih unik.' };
      }
      if (x.type === 'aws_subnet') {
        var clash = Object.keys(REAL).some(function (id) { var r = REAL[id]; return r.type === 'aws_subnet' && r.attrs.vpc_id === attrs.vpc_id && r.attrs.cidr_block === attrs.cidr_block && r.status !== 'deleting'; });
        if (clash) fail = { s: 'creating EC2 Subnet: InvalidSubnet.Conflict', d: 'The CIDR \'' + attrs.cidr_block + '\' conflicts with another subnet. Tiap subnet di satu VPC butuh CIDR yang beda.' };
      }
      if (fail) { o.fail = fail; o.end = now + 700; return; }
      var id = newId(x.type, attrs);
      attrs.id = id;
      attrs.arn = arnOf(x.type, id, region);
      o.id = id;
      o.attrs = attrs;
      REAL[id] = { id: id, type: x.type, addr: x.addr, attrs: clone(attrs), status: 'creating', born: now, drift: false };
    }
    function finish(o, now) {
      var x = o.x, secs = Math.max(1, Math.round((now - o.t0) / 1000 * SPEED));
      if (o.fail) {
        o.state = 'fail';
        errors.push({ summary: o.fail.s, detail: o.fail.d, line: x.res ? x.res.line : 0, where: x.res ? x.res.where : '' });
        if (o.kind !== 'create' && REAL[o.id]) REAL[o.id].status = 'ok';
        return;
      }
      o.state = 'done';
      if (o.kind === 'delete') {
        delete REAL[o.id];
        delete ST.res[x.addr];
        destroyed++;
        term.line('<b>' + x.addr + '</b>: Destruction complete after ' + secs + 's');
      } else if (o.kind === 'update') {
        if (REAL[o.id]) { REAL[o.id].attrs = clone(o.attrs); REAL[o.id].status = 'ok'; REAL[o.id].drift = false; }
        ST.res[x.addr].attrs = clone(o.attrs);
        ST.res[x.addr].deps = x.res.deps.slice();
        changed++;
        term.line('<b>' + x.addr + '</b>: Modifications complete after ' + secs + 's [id=' + esc(o.id) + ']');
      } else {
        REAL[o.id].status = 'ok';
        ST.res[x.addr] = { type: x.type, name: x.name, index: x.index, id: o.id, attrs: clone(o.attrs), deps: x.res.deps.slice() };
        added++;
        term.line('<b>' + x.addr + '</b>: Creation complete after ' + secs + 's [id=' + esc(o.id) + ']');
      }
    }
    function done() {
      clearInterval(timer);
      W.running = false;
      W.busy = null;
      W.plan = errors.length ? null : { applied: true };
      ST.serial++;
      // outputs from the new state
      var vals = stateValues();
      var outs = {};
      if (!opt.destroy) cfg.outputs.forEach(function (o) {
        try {
          var v = new Ctx(cfg, vals, null, '').eval(o.expr);
          if (v !== UNK) outs[o.name] = v;
        } catch (e) { /* a failed dependency leaves the output out */ }
      });
      ST.outputs = Object.keys(ST.res).length || !opt.destroy ? outs : {};
      if (opt.destroy) ST.outputs = {};
      ed.mark(errors.map(function (e) { return e.line; }));
      term.line('');
      errors.forEach(function (e) {
        errBox(e);
      });
      var skipped = ops.filter(function (o) { return o.state === 'skip'; }).length;
      if (errors.length) {
        term.line('<span class="sx-warn">Apply berhenti sebagian: ' + added + ' added, ' + changed + ' changed, ' + destroyed + ' destroyed' + (skipped ? ', ' + skipped + ' dilewati karena dependensinya gagal' : '') + '. Yang sudah jadi tetap tercatat di state. Perbaiki errornya, lalu apply lagi.</span>');
      } else if (opt.destroy) {
        term.line('<span class="sx-ok sx-b">Destroy complete! Resources: ' + destroyed + ' destroyed.</span>');
      } else {
        term.line('<span class="sx-ok sx-b">Apply complete! Resources: ' + added + ' added, ' + changed + ' changed, ' + destroyed + ' destroyed.</span>');
        var on = Object.keys(ST.outputs);
        if (on.length) {
          term.lines(['', '<span class="sx-ok sx-b">Outputs:</span>', '']);
          on.forEach(function (n) { term.line(n + ' = ' + fv(ST.outputs[n])); });
        }
      }
      K.pulse(app, 'state'); K.flash(app, 'state');
      // missions
      if (!errors.length) {
        var acts = P.acts;
        if (!opt.destroy && added) M.hit('apply');
        if (acts.some(function (x) { return x.act === 'update' && x.ch.instance_type; }) && M.done.apply) M.hit('update');
        if (acts.some(function (x) { return x.act === 'replace'; }) && M.done.apply) M.hit('replace');
        if (W.driftSeen && P.drift.length && (added || changed)) M.hit('drift');
        if (opt.destroy && destroyed && !Object.keys(ST.res).length) M.hit('destroy');
      }
      W.driftSeen = false;
      render();
      void started;
    }
    term.line('');
    K.pulse(app, 'apply');
    K.flash(app, 'aws');
    step();
  }

  // ---------- state commands ----------
  function stateCmd(a) {
    var sub = a.pos[0], addr = a.pos[1];
    var addrs = Object.keys(ST.res).sort(sortAddr);
    if (sub === 'list') {
      if (!addrs.length) return;
      term.lines(addrs.map(function (x) { return x; }));
      return;
    }
    if (sub === 'show' || sub === 'rm') {
      if (!addr) { term.line('Error: perlu alamat resource, misal terraform state ' + sub + ' aws_instance.web', 'sx-err'); return; }
      if (!ST.res[addr]) { errBox({ summary: 'No instance found for the given address!', detail: 'Ga ada ' + addr + ' di state. Cek pakai terraform state list.' }); return; }
      if (sub === 'show') { term.lines(stateShow(addr)); return; }
      delete ST.res[addr];
      ST.serial++;
      term.line('Removed ' + esc(addr));
      term.line('<span class="sx-ok">Successfully removed 1 resource instance(s).</span>');
      term.line('<span class="sx-dim"># Resource-nya masih jalan di AWS, cuma Terraform udah ga mengurusnya lagi.</span>');
      render();
      return;
    }
    term.line('Usage: terraform state &lt;list|show|rm&gt; [ADDR]', 'sx-warn');
  }
  function sortAddr(a, b) {
    var ta = ORDER.indexOf(a.split('.')[0]), tb = ORDER.indexOf(b.split('.')[0]);
    return ta - tb || (a < b ? -1 : 1);
  }
  function stateShow(addr) {
    var s = ST.res[addr];
    var keys = Object.keys(s.attrs).filter(function (k) { var v = s.attrs[k]; return v !== null && !(Array.isArray(v) && !v.length) && !(v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length); }).sort();
    var pad = Math.max.apply(null, keys.map(function (k) { return k.length; }));
    var out = ['<span class="sx-dim"># ' + addr + ':</span>', 'resource "' + s.type + '" "' + s.name + '" {'];
    keys.forEach(function (k) { out = out.concat(valLines('  ', '', k, s.attrs[k], pad).map(function (l) { return l.replace(/^(\s*)  /, '$1'); })); });
    out.push('}');
    return out;
  }
  function outputCmd(a) {
    var names = Object.keys(ST.outputs);
    if (a.pos[0]) {
      if (!(a.pos[0] in ST.outputs)) { errBox({ summary: 'Output "' + a.pos[0] + '" not found', detail: 'Output itu belum ada di state. Sudah di-apply?' }); return; }
      term.line(fv(ST.outputs[a.pos[0]]));
      return;
    }
    if (!names.length) {
      errBox({ summary: 'No outputs found', detail: 'State belum punya output. Jalankan terraform apply dulu.' }, 'sx-warn');
      return;
    }
    names.forEach(function (n) { term.line(n + ' = ' + fv(ST.outputs[n])); });
  }
  function showCmd() {
    var addrs = Object.keys(ST.res).sort(sortAddr);
    if (!addrs.length) { term.line('No state.'); return; }
    addrs.forEach(function (a) { term.lines(stateShow(a).concat([''])); });
    if (Object.keys(ST.outputs).length) {
      term.line('Outputs:');
      term.line('');
      Object.keys(ST.outputs).forEach(function (n) { term.line(n + ' = ' + fv(ST.outputs[n])); });
    }
  }

  // ---------- AWS console (drift) ----------
  function consoleAct(kind, id) {
    var r = REAL[id];
    if (!r || r.status !== 'ok') return;
    var nm = nameOf(r);
    var msg;
    if (kind === 'type') {
      var to = r.attrs.instance_type === 't3.large' ? 't3.small' : 't3.large';
      r.attrs.instance_type = to;
      msg = 'instance ' + nm + ' diganti ke ' + to;
    } else if (kind === 'tag') {
      var tags = r.attrs.tags = r.attrs.tags || {};
      if (tags.Owner) { delete tags.Owner; msg = 'tag Owner dihapus dari ' + nm; }
      else { tags.Owner = 'manual'; msg = 'tag Owner = manual ditambahkan ke ' + nm; }
    } else if (kind === 'del') {
      r.status = 'deleting';
      setTimeout(function () { delete REAL[id]; render(); }, 1200);
      msg = (r.type === 'aws_instance' ? 'instance ' : 'bucket ') + nm + ' dihapus';
    } else if (kind === 'obj') {
      r.objects = (r.objects || 0) + 1;
      msg = 'upload file ke bucket ' + nm + ' (' + r.objects + ' objek)';
      term.line('<span class="sx-dim"># [console AWS] ' + esc(msg) + '</span>');
      render();
      return;
    }
    r.drift = true;
    term.line('<span class="sx-warn"># [console AWS] ' + esc(msg) + '. Terraform belum tahu soal ini.</span>');
    K.flash(app, 'aws', 'warn');
    render();
  }
  function nameOf(r) {
    return (r.attrs.tags && r.attrs.tags.Name) || (r.type === 'aws_s3_bucket' ? r.id : r.type === 'aws_security_group' ? r.attrs.name : r.id);
  }

  // ---------- rendering ----------
  var ed;
  var els = {
    fCode: $('tf-f-code'), fPlan: $('tf-f-plan'), fAws: $('tf-f-aws'), fState: $('tf-f-state'),
    cloud: $('tf-cloud'), empty: $('tf-empty'), net: $('tf-net'), loose: $('tf-loose'), s3: $('tf-s3'),
    region: $('tf-region'), con: $('tf-con'), state: $('tf-state'), serial: $('tf-serial'), quick: $('tf-quick')
  };
  var cards = {};
  function card(r) {
    var c = cards[r.id];
    if (c) return c;
    var el = document.createElement('div');
    var kind = { aws_vpc: 'vpc', aws_subnet: 'subnet', aws_security_group: 'sg', aws_instance: 'ec2', aws_s3_bucket: 's3' }[r.type];
    el.className = 'tf-card tf-' + kind;
    el.innerHTML = '<div class="tf-ch"><span class="tf-kind">' + SCHEMA[r.type].label + '</span><b></b><em></em></div><div class="tf-meta"></div>' +
      (kind === 'vpc' ? '<div class="tf-sgs"></div><div class="tf-subs"></div>' : kind === 'subnet' ? '<div class="tf-insts"></div>' : '');
    c = cards[r.id] = { el: el, name: el.querySelector('b'), badge: el.querySelector('em'), meta: el.querySelector('.tf-meta'),
      sgs: el.querySelector('.tf-sgs'), subs: el.querySelector('.tf-subs'), insts: el.querySelector('.tf-insts') };
    return c;
  }
  function renderCloud() {
    var ids = Object.keys(REAL).sort(function (a, b) {
      return ORDER.indexOf(REAL[a].type) - ORDER.indexOf(REAL[b].type) || REAL[a].born - REAL[b].born;
    });
    var managed = {};
    Object.keys(ST.res).forEach(function (a) { managed[ST.res[a].id] = a; });
    ids.forEach(function (id) {
      var r = REAL[id], c = card(r), at = r.attrs, parent;
      if (r.type === 'aws_vpc') parent = els.net;
      else if (r.type === 'aws_subnet') parent = cards[at.vpc_id] && REAL[at.vpc_id] ? cards[at.vpc_id].subs : els.loose;
      else if (r.type === 'aws_security_group') parent = cards[at.vpc_id] && REAL[at.vpc_id] ? cards[at.vpc_id].sgs : els.loose;
      else if (r.type === 'aws_instance') parent = cards[at.subnet_id] && REAL[at.subnet_id] ? cards[at.subnet_id].insts : els.loose;
      else parent = els.s3;
      // only move a card when its parent changes, so its entry animation runs once
      if (c.el.parentNode !== parent) parent.appendChild(c.el);
      var cls = 'tf-card tf-' + c.el.className.split(' ')[1].slice(3) + (r.status !== 'ok' ? ' is-' + r.status : '') + (r.drift ? ' is-drift' : '') + (!managed[id] && r.status === 'ok' ? ' is-orphan' : '');
      if (c.el.className !== cls) c.el.className = cls;
      setText(c.name, nameOf(r));
      var badge = r.status === 'creating' ? 'creating…' : r.status === 'deleting' ? 'deleting…' : r.status === 'updating' ? 'modifying…' :
        r.drift ? 'diubah manual' : !managed[id] ? 'ga dikelola Terraform' : '';
      setText(c.badge, badge);
      var meta = [];
      if (managed[id]) meta.push('<span class="tf-addr">' + esc(managed[id]) + '</span>');
      if (r.type === 'aws_vpc' || r.type === 'aws_subnet') meta.push(esc(at.cidr_block));
      if (r.type === 'aws_subnet') meta.push(esc(at.availability_zone || ''));
      if (r.type === 'aws_instance') meta.push('<span class="tf-it">' + esc(at.instance_type) + '</span>', esc(at.ami));
      if (r.type === 'aws_security_group') meta.push((at.ingress || []).map(function (g) { return g.protocol + '/' + (g.from_port === g.to_port ? g.from_port : g.from_port + '-' + g.to_port); }).join(', ') || 'tanpa ingress');
      if (r.type === 'aws_s3_bucket' && r.objects) meta.push(r.objects + ' objek');
      if (r.type !== 'aws_s3_bucket' && r.status !== 'creating') meta.push('<span class="tf-id">' + esc(id) + '</span>');
      Object.keys(at.tags || {}).forEach(function (k) { if (k !== 'Name') meta.push('<span class="tf-tag">' + esc(k) + '=' + esc(at.tags[k]) + '</span>'); });
      setHTML(c.meta, meta.join(' · '));
    });
    Object.keys(cards).forEach(function (id) {
      if (!REAL[id]) { cards[id].el.remove(); delete cards[id]; }
    });
    var any = ids.length > 0;
    els.empty.hidden = any;
    els.loose.parentNode.hidden = !els.loose.children.length;
    els.s3.parentNode.hidden = !els.s3.children.length;
  }
  function renderConsole() {
    var acts = [];
    Object.keys(REAL).forEach(function (id) {
      var r = REAL[id];
      if (r.status !== 'ok') return;
      var nm = esc(nameOf(r));
      if (r.type === 'aws_instance') {
        acts.push(['type', id, 'ganti instance type <b>' + nm + '</b> ke ' + (r.attrs.instance_type === 't3.large' ? 't3.small' : 't3.large')]);
        acts.push(['tag', id, (r.attrs.tags && r.attrs.tags.Owner ? 'hapus' : 'tambah') + ' tag Owner di <b>' + nm + '</b>']);
        acts.push(['del', id, 'terminate instance <b>' + nm + '</b>']);
      } else if (r.type === 'aws_vpc') {
        acts.push(['tag', id, (r.attrs.tags && r.attrs.tags.Owner ? 'hapus' : 'tambah') + ' tag Owner di VPC <b>' + nm + '</b>']);
      } else if (r.type === 'aws_s3_bucket') {
        acts.push(['obj', id, 'upload file ke bucket <b>' + nm + '</b>']);
        acts.push(['del', id, 'hapus bucket <b>' + nm + '</b>']);
      }
    });
    setHTML(els.con, acts.length ? acts.map(function (a) {
      return '<button type="button" class="tf-con-b" data-act="con" data-k="' + a[0] + '" data-id="' + a[1] + '">' + a[2] + '</button>';
    }).join('') : '<p class="tf-con-empty">Belum ada resource buat diutak-atik. Apply dulu ya.</p>');
  }
  function renderState() {
    setText(els.serial, 'serial ' + ST.serial);
    var res = {};
    Object.keys(ST.res).sort(sortAddr).forEach(function (a) {
      var s = ST.res[a], key = s.type + '.' + s.name;
      res[key] = res[key] || { mode: 'managed', type: s.type, name: s.name, provider: 'provider["registry.terraform.io/hashicorp/aws"]', instances: [] };
      var inst = {};
      if (s.index !== null) inst.index_key = s.index;
      inst.attributes = s.attrs;
      if (s.deps.length) inst.dependencies = s.deps;
      res[key].instances.push(inst);
    });
    var outs = {};
    Object.keys(ST.outputs).forEach(function (n) { outs[n] = { value: ST.outputs[n], type: typeof ST.outputs[n] === 'string' ? 'string' : 'dynamic' }; });
    var doc = { version: 4, terraform_version: TF_VER, serial: ST.serial, lineage: ST.lineage, outputs: outs, resources: Object.keys(res).map(function (k) { return res[k]; }) };
    var json = ST.serial === 0 && !Object.keys(ST.res).length ? '' : JSON.stringify(doc, null, 2);
    setHTML(els.state, json ? json.split('\n').map(function (l) {
      return esc(l).replace(/^(\s*)(&quot;[^&]*&quot;)(:)/, '$1<span class="sx-a">$2</span>$3')
        .replace(/: (&quot;.*&quot;)(,?)$/, ': <span class="sx-s">$1</span>$2')
        .replace(/: (-?\d[\d.]*|true|false|null)(,?)$/, ': <span class="sx-n">$1</span>$2');
    }).join('\n') : '<span class="sx-dim">// terraform.tfstate belum ada. File ini dibuat saat apply pertama.</span>');
  }
  function render() {
    var src = ed.get();
    var nRes = (src.match(/^\s*resource\s+"/gm) || []).length;
    setText(els.fCode, nRes + ' resource');
    var stale = W.plan && !W.plan.applied && W.planSrc !== src + '|' + realSig();
    var pt = !W.plan ? 'belum di-plan' : W.plan.applied ? 'sudah di-apply' : W.plan.none ? 'ga ada perubahan' : W.plan.refresh ? 'refresh-only' : '+' + W.plan.add + ' ~' + W.plan.change + ' -' + W.plan.destroy;
    setText(els.fPlan, stale ? 'basi, plan lagi' : pt);
    els.fPlan.dataset.s = stale ? 'warn' : W.plan && !W.plan.none && !W.plan.applied ? 'info' : W.plan ? 'ok' : '';
    var live = Object.keys(REAL).filter(function (id) { return REAL[id].status !== 'deleting'; });
    var drift = live.some(function (id) { return REAL[id].drift; });
    var orphans = live.filter(function (id) { return !Object.keys(ST.res).some(function (a) { return ST.res[a].id === id; }); }).length;
    setText(els.fAws, W.running ? 'sedang berubah…' : drift ? 'drift!' : live.length + ' resource' + (orphans ? ', ' + orphans + ' yatim' : ''));
    els.fAws.dataset.s = W.running ? 'info' : drift ? 'warn' : live.length ? 'ok' : '';
    setText(els.fState, 'serial ' + ST.serial + ' · ' + Object.keys(ST.res).length + ' res');
    setText(els.region, 'region ' + decodeRegion(src));
    renderCloud();
    renderConsole();
    renderState();
    var busy = !!W.busy && !W.confirm;
    els.quick.classList.toggle('is-busy', busy);
  }
  function decodeRegion(src) {
    var m = /region\s*=\s*"([^"]+)"/.exec(src);
    return m ? m[1] : 'ap-southeast-3';
  }

  // ---------- wiring ----------
  ed = new K.Editor($('tf-ed'), {
    value: STARTER, label: 'Isi file main.tf', highlight: K.hlHCL,
    onChange: function () { if (els.fCode) render(); }
  });
  app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    var act = b.dataset.act;
    if (act === 'cmd') {
      if (W.confirm && b.dataset.cmd !== 'yes' && b.dataset.cmd !== 'no') return;
      term.submit(b.dataset.cmd);
    } else if (act === 'snip') {
      var k = b.dataset.k;
      if (k === 'count') addCount();
      else { ed.append(SNIPPETS[k]()); toast('Blok baru ditambahkan di akhir main.tf'); }
    } else if (act === 'con') consoleAct(b.dataset.k, b.dataset.id);
    else if (act === 'file-reset') { ed.set(STARTER); toast('main.tf balik ke versi awal'); }
    else if (act === 'reset') reset();
  });
  function addCount() {
    var src = ed.get();
    var m = /resource\s+"aws_instance"\s+"(\w+)"\s*\{\n/.exec(src);
    if (!m) { toast('Ga ketemu resource aws_instance di main.tf'); return; }
    if (/^\s*count\s*=/m.test(src.slice(m.index, src.indexOf('\n}', m.index)))) { toast('Instance-nya sudah pakai count'); return; }
    var at = m.index + m[0].length;
    src = src.slice(0, at) + '  count = 2\n\n' + src.slice(at);
    src = src.replace(/(Name\s*=\s*")\$\{var\.env\}-web"/, '$1${var.env}-web-${count.index}"');
    src = src.replace(/value\s*=\s*aws_instance\.web\.id/, 'value = aws_instance.web[*].id');
    ed.set(fmtHCL(src));
    toast('count = 2 ditambahkan ke aws_instance.' + m[1]);
  }

  function reset() {
    if (W.running) { toast('Tunggu apply-nya selesai dulu ya.'); return; }
    initWorld();
    Object.keys(cards).forEach(function (id) { cards[id].el.remove(); });
    cards = {};
    term.clear();
    W.confirm = null;
    $('tf-ps').textContent = PS;
    app.classList.remove('is-confirm');
    M.reset();
    term.lines([
      '<span class="sx-dim"># Ini akun AWS bohongan, region Jakarta. Ga ada yang beneran dibuat atau ditagih.</span>',
      '<span class="sx-dim"># Mulai dengan </span><b>terraform init</b><span class="sx-dim">, lalu </span><b>terraform plan</b><span class="sx-dim">. Ketik </span><b>help</b><span class="sx-dim"> buat daftar perintah.</span>'
    ]);
    render();
  }
  initWorld();
  reset();
})();
