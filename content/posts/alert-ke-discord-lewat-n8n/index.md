---
title: "Satu Pintu Alert ke Discord Pakai n8n: Sentry, Grafana, New Relic, dan Vercel"
date: 2026-10-09T11:00:00+07:00
categories: [tutorial]
tags: [n8n, discord, sentry, grafana, elasticsearch, new-relic, vercel, monitoring, alerting]
description: "Cara mengirim alert dari Sentry, Grafana (data Elasticsearch APM), New Relic, dan status deploy Vercel ke Discord sebagai embed card yang rapi dan informatif, semuanya lewat n8n."
ShowToc: true
---

Di tim, alert kami tersebar di mana-mana: error aplikasi di Sentry, APM di Elastic, sebagian service di New Relic, dan deploy frontend di Vercel. Masing-masing punya integrasi Discord sendiri, tapi ada yang berbayar, ada yang terkunci lisensi, dan tampilannya beda-beda semua.

Akhirnya saya pakai satu pola untuk semuanya:

```
Sumber alert → Webhook n8n → Code (format embed) → HTTP Request → Discord
```

n8n jadi "pintu" tunggal. Semua pesan dirapikan di node Code jadi **embed card** Discord dengan format yang konsisten: apa yang terjadi, di mana, kemungkinan penyebabnya, dan link untuk investigasi. Tulisan ini merangkum setup-nya, termasuk jebakan-jebakan yang saya temui.

> Semua URL, nama service, dan endpoint di tulisan ini contoh. Ganti dengan punya kamu.

## Pola dasar di n8n

Setiap sumber pakai tiga node:

1. **Webhook** (POST) untuk menerima payload.
2. **Code** (JavaScript, mode *Run Once for All Items*) untuk mengubah payload jadi `{ username, embeds }`.
3. **HTTP Request** untuk mengirim ke webhook Discord.

Setting HTTP Request-nya selalu sama:

| Setting | Nilai |
|---|---|
| Method | `POST` |
| URL | URL webhook Discord (Edit Channel → Integrations → Webhooks) |
| Send Body | ON, tipe **JSON** |
| Specify Body | **Using JSON** |
| JSON | `{{ JSON.stringify($json) }}` (mode *Expression*) |

Kenapa nggak pakai node Discord bawaan n8n? Karena dengan HTTP Request kamu punya kontrol penuh atas bentuk embed.

Beberapa hal yang sering bikin bingung di awal:

- **Kode JavaScript harus di node Code**, bukan di kolom JSON HTTP Request. Kolom JSON cuma menerima JSON atau ekspresi `{{ }}`.
- **URL test vs production.** `/webhook-test/...` cuma aktif waktu kamu menekan *Listen for test event*. Untuk dipakai sungguhan, **Publish** workflow dan pakai `/webhook/...`.
- **URL webhook Discord itu rahasia.** Siapa pun yang memegangnya bisa kirim pesan ke channel kamu. Hati-hati waktu berbagi screenshot.
- **Batas Discord:** title 256 karakter, description 4096, value field 1024, maksimal 10 embed per pesan. String kosong dan URL relatif ditolak dengan error 400.

Karena itu, semua node Code di bawah memakai tiga helper yang sama:

```js
// potong sesuai limit Discord; undefined kalau kosong (Discord menolak string kosong)
const trunc = (s, n) => {
  s = String(s ?? '').trim();
  if (!s) return undefined;
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

// Discord hanya menerima URL absolut
const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//.test(u) ? u : undefined);

// normalisasi timestamp ke ISO standar
const safeTs = (t) => {
  const d = new Date(Number(t) || t);
  return isNaN(d) ? new Date().toISOString() : d.toISOString();
};
```

Satu workflow boleh punya beberapa Webhook trigger. Saya taruh jalur Sentry dan Grafana di satu canvas dengan path berbeda, jadi kalau satu jalur perlu di-debug, jalur lain nggak tersentuh. Alternatifnya satu Webhook plus node **Switch** yang memilah berdasarkan header atau isi body, tapi menurut saya dua trigger lebih jelas.

## 1. Sentry → Discord

Payload webhook Sentry itu besar (bisa ratusan KB, kebanyakan stacktrace dan `debug_meta`). Kamu cukup ambil beberapa field penting.

```js
const body = $input.first().json.body;
const ev = body?.data?.event ?? {};

// tags di Sentry berbentuk array of [key, value]
const tags = Object.fromEntries(ev.tags ?? []);

const exc = ev.exception?.values?.[0] ?? {};
const frames = exc.stacktrace?.frames ?? [];
// frame in_app terakhir = lokasi kode kita yang paling dekat dengan crash
const appFrame = [...frames].reverse().find(f => f.in_app && f.filename);

const project = ev.url?.match(/\/projects\/[^/]+\/([^/]+)\//)?.[1] ?? '-';

const trunc = (s, n) => {
  if (s === null || s === undefined || s === '') return '-';
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

const levelColor = {
  fatal: 0x8B0000, error: 0xE03E2F, warning: 0xF5A623, info: 0x3498DB, debug: 0x95A5A6,
};

const level = ev.level ?? tags.level ?? 'error';
const isTest = tags.sample_event === 'yes' || !!ev.occurrence;

const errType  = ev.metadata?.type ?? exc.type;
const errValue = ev.metadata?.value ?? exc.value;
let title = errType ? `${errType}: ${errValue ?? ''}` : (ev.message || ev.title || 'Sentry Issue');
if (isTest) title = `[TEST] ${title}`;

const location = appFrame
  ? `\`${appFrame.filename}:${appFrame.lineno ?? '?'}\`\n${appFrame.function ?? ''}`
  : (ev.culprit ?? '-');

const embed = {
  title: trunc(title, 250),
  url: ev.web_url,
  color: levelColor[level] ?? levelColor.error,
  description: trunc(ev.culprit ? `**Culprit:** \`${ev.culprit}\`` : '', 4000),
  fields: [
    { name: '📦 Project',     value: trunc(project, 1000),        inline: true },
    { name: '🌍 Environment', value: trunc(ev.environment, 1000), inline: true },
    { name: '🚨 Level',       value: level.toUpperCase(),         inline: true },
    { name: '🏷️ Release',     value: trunc(ev.release, 1000),     inline: true },
    { name: '📱 Device',      value: trunc(ev.contexts?.device?.model ?? tags.device, 1000), inline: true },
    { name: '💻 OS',          value: trunc(ev.contexts?.os?.os ?? tags.os, 1000),            inline: true },
    { name: '📍 Location',    value: trunc(location, 1000),       inline: false },
  ],
  footer: { text: `Rule: ${body?.data?.triggered_rule ?? '-'} • Issue #${ev.issue_id ?? '-'}` },
  timestamp: ev.datetime ?? new Date().toISOString(),
};

// @here hanya untuk error production yang bukan test
const mention = (ev.environment === 'production' && ['error', 'fatal'].includes(level) && !isTest)
  ? '@here' : '';

return [{
  json: {
    username: 'Sentry',
    content: mention,
    embeds: [embed],
    allowed_mentions: { parse: ['everyone'] },
  },
}];
```

Beberapa catatan:

- **Test notification dari Sentry itu sample event** (tag `sample_event: yes`), jadi datanya dummy. Kode di atas memberi prefix `[TEST]` supaya nggak bikin panik.
- Saya sengaja **tidak menampilkan data user** (email, id) di Discord. Channel Discord biasanya lebih luas aksesnya daripada Sentry.
- Tambahkan node **IF** sebelum Code dengan kondisi `{{ $json.body.action }}` sama dengan `triggered`, supaya event lain nggak ikut terkirim.
- Untuk keamanan, verifikasi header `sentry-hook-signature` (HMAC-SHA256 dari body memakai Client Secret integrasi Sentry) supaya orang lain nggak bisa spam webhook kamu.

## 2. Elasticsearch APM → Discord (lewat Grafana)

Ini bagian yang paling banyak jebakannya.

### Kenapa nggak langsung dari Kibana?

Rencana awalnya Kibana Alerting dengan connector Webhook ke n8n. Ternyata di lisensi **Basic** (gratis), connector yang tersedia cuma *Index* dan *Server log*. Webhook butuh lisensi Gold ke atas. Tombol *Start trial* juga bukan solusi, karena cuma 30 hari dan nggak bisa diulang.

Pilihan yang tersisa:

| | n8n polling ke Elasticsearch | ElastAlert2 | Grafana Alerting |
|---|---|---|---|
| Infra tambahan | Tidak ada | Satu service lagi | Tidak ada kalau sudah punya Grafana |
| Dedup / grouping / resolved | Atur sendiri | Built-in | Built-in |
| Biaya | Gratis | Gratis | Gratis (OSS) |

Karena kami sudah punya Grafana untuk Prometheus, jalan paling ringan adalah **menambahkan Elasticsearch sebagai data source di Grafana** dan membuat alert di sana. Data nggak perlu diduplikasi, config OTel Collector nggak berubah, dan Kibana APM tetap jadi tempat investigasi.

```
Aplikasi → OTel Collector → APM Server / Elasticsearch
                                     ▲
                       Grafana (data source Elasticsearch)
                                     │ alert rule
                                     ▼
                          Webhook → n8n → Discord
```

Sempat juga terpikir pindah ke LGTM (Loki, Grafana, Tempo, Mimir), atau kirim paralel lewat *collector chaining*. Itu bisa dan cukup umum, tapi kalau kebutuhan APM sudah terpenuhi oleh Elastic, yang sebenarnya kurang cuma alerting. Jadi nggak perlu bangun stack baru hanya untuk itu.

### Cari nama field status code

Dokumen APM yang punya status HTTP adalah **transaction**, bukan span. Di Grafana Explore, cek field mana yang terisi:

```
processor.event:transaction AND service.environment:PROD AND _exists_:http.response.status_code
```

Kalau kosong, coba `labels.http_response_status_code`. Itu terjadi kalau APM Server versi lama belum mengenali nama atribut OTel baru, sehingga atributnya masuk ke `labels.*`.

Lalu lihat volume 4xx dan 5xx dalam 30 hari untuk menentukan threshold. Di kasus saya, 5xx jarang (kurang dari satu per hari), sementara 4xx didominasi **401** dari token expired. Kalau 401 digabung ke rule 4xx biasa, alert bakal bunyi terus.

### Tiga rule

| Rule | Query tambahan | Threshold / 5 menit | Pending | Severity |
|---|---|---|---|---|
| HTTP 5xx - PROD | `http.response.status_code:[500 TO 599]` | > 0 | None | critical |
| HTTP 4xx - PROD | `http.response.status_code:[400 TO 499] AND NOT http.response.status_code:401` | > 3 | 2m | warning |
| HTTP 401 spike - PROD | `http.response.status_code:401` | > 20 | 1m | warning |

Semua query diawali `processor.event:transaction AND service.environment:PROD AND ...`. Rule 401 spike bukan untuk menangkap token expired biasa, tapi untuk mendeteksi masalah autentikasi massal, misalnya auth service down atau JWT secret berubah.

Setting rule 5xx di Grafana:

- **Query A** (Elasticsearch, Query type *Metrics*), time range **now-5m**, metric **Count**.
- **Group by**, urutannya penting: Terms `service.name` → Terms `transaction.name` → Terms `http.response.status_code` (semua *Order by Doc Count*) → **Date Histogram** `@timestamp` dengan interval **1m**.
- **Expression B**: Reduce, **Sum**, mode **Drop Non-numeric Values** (mode *Strict* bisa menghasilkan NaN).
- **Expression C**: Threshold, input B, **IS ABOVE 0**, jadi alert condition.
- **No data handling: Normal.** Ini wajib. Tanpa ini, setiap periode tanpa error akan mengirim alert `DatasourceNoData`.
- Labels: `severity=critical`, `env=PROD`, `team=backend`.
- Custom annotation `count`: `{{ humanize $values.B.Value }}`, plus `apm_transaction_url` dan `apm_errors_url` yang mengarah ke halaman APM di Kibana:

```
https://kibana.example.com/app/apm/services/{{ index $labels "service.name" }}/transactions/view?transactionName={{ urlquery (index $labels "transaction.name") }}&transactionType=request&environment=PROD&rangeFrom=now-30m&rangeTo=now
```

```
https://kibana.example.com/app/apm/services/{{ index $labels "service.name" }}/errors?environment=PROD&rangeFrom=now-30m&rangeTo=now
```

Untuk rule 401 spike, hapus Terms `transaction.name` supaya lonjakan yang tersebar di banyak endpoint tetap terhitung per service.

Grouping notifikasi: group by `alertname`, `service.name`, `transaction.name`, `http.response.status_code`, dengan Group wait 30s, Group interval 5m, Repeat interval 1h. Hasilnya satu card per kombinasi service + endpoint + status, diulang paling cepat tiap jam, plus card resolved saat error berhenti.

### Jebakan: "too many buckets"

Untuk mengetes rule dengan data asli, trik yang saya pakai adalah mengubah time range sementara ke **now-30d**. Hasilnya malah error:

```
Trying to create too many buckets. Must be less than or equal to: [65536]
```

Penyebabnya Date Histogram dengan interval *auto*. Untuk rentang 30 hari, interval auto dihitung sekitar 1 menit, jadi ada 43.200 bucket per kombinasi service × endpoint × status. Dua kombinasi saja sudah lewat batas.

Solusinya, set interval eksplisit:

| Setting | Tes | Produksi |
|---|---|---|
| Time range | now-30d | **now-5m** |
| Date Histogram interval | 1d | **1m** |

Karena reduce-nya **Sum**, besar kecilnya interval nggak mengubah hasil hitungan. Dan jangan lupa kembalikan ke setting produksi setelah tes, kalau nggak alert lama akan dikirim ulang tiap jam selama sebulan.

### Dari template teks ke embed card

Integration Discord bawaan Grafana bisa dikustom pakai notification template (Go template), tapi hasilnya tetap teks biasa. Saya sempat beberapa kali iterasi template dan hasilnya selalu terasa berantakan. Akhirnya contact point saya ganti ke **Webhook → n8n** supaya bisa jadi embed card seperti Sentry.

Node Code untuk payload Grafana:

```js
const p = $input.first().json.body;

const CODE_NAME = {
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
  409: 'Conflict', 422: 'Unprocessable Entity', 429: 'Too Many Requests',
  500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
};

const HINT = {
  400: 'Validasi request gagal, cek payload dari client',
  401: 'Token invalid/expired; kalau massal, cek auth service',
  403: 'User tidak punya akses ke resource',
  404: 'Resource/URL tidak ditemukan',
  409: 'Konflik data/status (duplikat atau status sudah berubah)',
  422: 'Validasi bisnis gagal',
  429: 'Kena rate limit',
  500: 'Bug/exception di aplikasi, cek stack trace di Errors APM',
  502: 'Upstream/dependency membalas tidak valid',
  503: 'Service/dependency down atau overload',
  504: 'Timeout ke dependency (DB/Redis/API)',
};

const COLOR = { critical: 0xE03E2F, warning: 0xF5A623, resolved: 0x2ECC71, system: 0x95A5A6 };

const trunc = (s, n) => {
  s = String(s ?? '').trim();
  if (!s) return undefined;
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//.test(u) ? u : undefined);
const safeTs = (t) => {
  const d = new Date(t);
  return isNaN(d) ? new Date().toISOString() : d.toISOString();
};

const embeds = (p?.alerts ?? []).map(a => {
  const L = a.labels ?? {};
  const A = a.annotations ?? {};
  const resolved = a.status === 'resolved';
  const ts = safeTs(resolved && a.endsAt && !a.endsAt.startsWith('0001') ? a.endsAt : a.startsAt);
  const svc = L['service.name'];

  // alert sistem (DatasourceNoData / DatasourceError / TestAlert)
  if (!svc) {
    return {
      title: trunc(`⚠️ ${L.alertname ?? 'Grafana alert'}${resolved ? ' · resolved' : ''}`, 250),
      url: safeUrl(a.generatorURL),
      color: resolved ? COLOR.resolved : COLOR.system,
      description: trunc([
        L.rulename && `Rule: **${L.rulename}**`,
        A.summary,
        A.Error && '```' + A.Error + '```',
      ].filter(Boolean).join('\n'), 4000),
      footer: { text: 'Grafana Alerting' },
      timestamp: ts,
    };
  }

  const code = String(L['http.response.status_code'] ?? '');
  const name = CODE_NAME[code] ?? 'HTTP Error';
  const endpoint = L['transaction.name'];
  const sev = L.severity ?? 'warning';
  const count = A.count ?? a.values?.B ?? '-';
  const where = `**${svc}**${endpoint ? `\n\`${endpoint}\`` : ''}`;

  if (resolved) {
    return {
      title: trunc(`✅ Resolved · ${code} ${name}`, 250),
      description: trunc(where, 4000),
      color: COLOR.resolved,
      footer: { text: trunc(`${L.alertname ?? 'Grafana'} · Grafana`, 2000) },
      timestamp: ts,
    };
  }

  const trace = safeUrl(A.apm_transaction_url);
  const error = safeUrl(A.apm_errors_url);
  const links = [trace && `[Trace](${trace})`, error && `[Error](${error})`].filter(Boolean).join(' · ');

  const fields = [
    { name: 'Jumlah', value: `${count}x / 5 menit`, inline: true },
    { name: 'Env', value: trunc(L.env, 100) ?? '-', inline: true },
    { name: 'Severity', value: sev, inline: true },
    { name: '💡 Kemungkinan penyebab', value: HINT[code] ?? 'Cek detail transaksi di APM', inline: false },
  ];
  if (links) fields.push({ name: '🔗 Link', value: links, inline: false });

  return {
    title: trunc(`${sev === 'critical' ? '🔴' : '🟠'} ${code} ${name}`, 250),
    url: trace,
    description: trunc(where, 4000),
    color: COLOR[sev] ?? COLOR.warning,
    fields,
    footer: { text: trunc(`${L.alertname ?? 'Grafana'} · Grafana`, 2000) },
    timestamp: ts,
  };
});

// Discord maksimal 10 embed per pesan
const out = [];
for (let i = 0; i < embeds.length; i += 10) {
  out.push({ json: { username: 'Grafana Alert', embeds: embeds.slice(i, i + 10) } });
}
if (!out.length) {
  out.push({ json: { username: 'Grafana Alert', content: '⚠️ Grafana mengirim notifikasi tanpa alert.' } });
}
return out;
```

Hasilnya kira-kira begini:

```
┃ 🔴 504 Gateway Timeout                ← judul bisa diklik ke APM
┃ orders-service
┃ /v1/orders/:id
┃
┃ Jumlah          Env      Severity
┃ 6x / 5 menit    PROD     critical
┃
┃ 💡 Kemungkinan penyebab
┃ Timeout ke dependency (DB/Redis/API)
┃ 🔗 Trace · Error
┃ HTTP 5xx - PROD · Grafana
```

Dua jebakan di bagian ini:

- **Error 400 `{"embeds": ["0"]}` dari Discord.** Tombol Test di contact point Grafana mengirim `generatorURL` relatif (`?orgId=1`), dan Discord menolak URL yang bukan absolut. Makanya ada `safeUrl`. Kalau link dari alert asli juga relatif, set `root_url` Grafana (`GF_SERVER_ROOT_URL`).
- **Tombol Test (Predefined) nggak punya label `service.name`**, jadi yang muncul selalu card "alert sistem" abu-abu. Pakai **Test → Custom** dengan label dan annotation buatan untuk melihat card lengkap.

### Pause vs Silence

Kalau satu rule terlalu berisik (misalnya 400 dari validasi client), ada dua pilihan:

| | Pause evaluation | Silence |
|---|---|---|
| Rule tetap dievaluasi | Tidak | Ya |
| Status alert tetap terlihat di Grafana | Tidak | Ya, tapi tidak dikirim |
| Cocok untuk | Berhenti sampai waktu yang belum ditentukan | Menahan notifikasi selama durasi tertentu |

Kalau cuma kode 400 yang mau dimatikan, ubah query jadi `... AND NOT http.response.status_code:(400 OR 401)`.

## 3. New Relic → Discord

Polanya sama: **NRQL Condition → Alert Policy → Workflow → Destination (Webhook) → n8n**. Alerting sudah termasuk di plan New Relic tanpa biaya tambahan.

### Jebakan: `http.statusCode` bertipe string

Query `WHERE http.statusCode >= 500` saya hasilnya kosong, padahal datanya ada. Ternyata atribut itu tersimpan sebagai **string** di sebagian event, dan perbandingan `>=` hanya berlaku untuk numerik. Di tampilan FACET hal ini nggak kelihatan karena string dan angka ditampilkan sama. Solusinya bungkus dengan `numeric()`:

```sql
SELECT count(*) FROM Transaction
WHERE appName LIKE 'Prod-%' AND numeric(http.statusCode) >= 500
FACET appName, name, http.statusCode
```

Cek tipe atribut dengan `SELECT keyset() FROM Transaction ...`; atributnya akan masuk ke `stringKeys` atau `numericKeys`.

Waktu breakdown, 4xx di New Relic ternyata hampir semuanya noise (health check yang memanggil path salah, polling dengan token invalid), jadi untuk New Relic saya cukup pantau **5xx saja**. Filter `appName` juga wajib, karena app dev punya puluhan ribu 4xx per hari.

### Setting condition

| Bagian | Nilai |
|---|---|
| Window duration | 1 minute |
| Streaming method | Event timer, 1 minute (cocok untuk data jarang) |
| Fill data gaps with | **Custom static value: 0** |
| Threshold | Critical, above 0, at least once in 1 minute |
| Signal loss | Jangan buka incident saat signal hilang |

**Fill data gaps = 0** itu penting. Tanpa itu, saat nggak ada 5xx sama sekali New Relic nggak punya data untuk dievaluasi, incident nggak pernah tertutup, dan card resolved nggak pernah terkirim.

Alert Policy pakai *One issue per condition and signal*, supaya setiap kombinasi app, endpoint, dan status jadi alert sendiri.

### Payload template

Di Workflow, ganti payload template default dengan ini, lalu centang notify on **Activated** dan **Closed**:

```json
{
  "source": "newrelic",
  "issueUrl": {{json issuePageUrl}},
  "title": {{json annotations.title.[0]}},
  "state": {{json state}},
  "priority": {{json priority}},
  "createdAt": {{json createdAt}},
  "updatedAt": {{json updatedAt}},
  "totalIncidents": {{json totalIncidents}},
  "policyName": {{json accumulations.policyName.[0]}},
  "conditionName": {{json accumulations.conditionName.[0]}},
  "entityNames": {{json entitiesData.names}},
  "accumulations": {
    "rawTag": {{json accumulations.rawTag}},
    "deepLinkUrl": {{json accumulations.deepLinkUrl}}
  }
}
```

Nilai FACET (app, nama transaksi, status code) ada di `accumulations.rawTag`, dengan nama atribut sebagai key. Saran saya, tangkap dulu payload asli sebelum menulis kode. Paling gampang: Publish workflow n8n, arahkan Destination ke URL production, lalu lihat tab **Executions** di n8n. Cara ini menangkap payload Activated dan Closed sekaligus.

### Node Code

```js
const b = $input.first().json.body ?? {};
const acc = b.accumulations ?? {};
const raw = acc.rawTag ?? {};
const first = (v) => (Array.isArray(v) ? v[0] : v);

const CODE_NAME = {
  500: 'Internal Server Error', 501: 'Not Implemented', 502: 'Bad Gateway',
  503: 'Service Unavailable', 504: 'Gateway Timeout',
};
const HINT = {
  500: 'Bug/exception di aplikasi, cek error trace di New Relic',
  501: 'Endpoint/method belum diimplementasikan',
  502: 'Upstream/dependency membalas tidak valid',
  503: 'Service/dependency down atau overload',
  504: 'Timeout ke dependency (DB/Redis/API pihak ketiga)',
};
const COLOR = { CRITICAL: 0xE03E2F, HIGH: 0xF5A623, MEDIUM: 0xF5A623, LOW: 0x3498DB, resolved: 0x2ECC71 };

const trunc = (s, n) => {
  s = String(s ?? '').trim();
  if (!s) return undefined;
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//.test(u) ? u : undefined);
const safeTs = (t) => {
  const d = new Date(Number(t) || t);
  return isNaN(d) ? new Date().toISOString() : d.toISOString();
};

const app = first(raw.appName) ?? first(b.entityNames) ?? '-';
const txn = first(raw.name);
const code = String(first(raw['http.statusCode']) ?? '');

// "WebTransaction/Expressjs/POST//api/v1/x" -> "POST /api/v1/x"
const endpoint = txn
  ? String(txn).replace(/^WebTransaction\/[^/]+\//, '').replace(/^([A-Z]+)\/\//, '$1 /')
  : undefined;

const closed = b.state === 'CLOSED';
const priority = b.priority ?? 'CRITICAL';
const label = code
  ? `${code} ${CODE_NAME[code] ?? 'HTTP Error'}`
  : (b.conditionName ?? b.title ?? 'New Relic alert');

const where = `**${app}**${endpoint ? `\n\`${endpoint}\`` : ''}`;
const footer = { text: trunc(`${b.policyName ?? 'New Relic'} · New Relic`, 2000) };

const issue = safeUrl(b.issueUrl);
const query = safeUrl(first(acc.deepLinkUrl));
let links = issue ? `[Issue](${issue})` : '';
if (query && (links.length + query.length + 15) <= 1000) {
  links += `${links ? ' · ' : ''}[Query](${query})`;
}

let embed;
if (closed) {
  const mins = b.createdAt && b.updatedAt
    ? Math.max(1, Math.round((Number(b.updatedAt) - Number(b.createdAt)) / 60000))
    : null;
  embed = {
    title: trunc(`✅ Resolved · ${label}`, 250),
    url: issue,
    description: trunc(`${where}${mins ? `\nDurasi: ${mins} menit` : ''}`, 4000),
    color: COLOR.resolved,
    footer,
    timestamp: safeTs(b.updatedAt),
  };
} else {
  const fields = [
    { name: 'Priority', value: priority, inline: true },
    { name: 'Incident', value: String(b.totalIncidents ?? 1), inline: true },
    { name: 'Condition', value: trunc(b.conditionName, 100) ?? '-', inline: true },
  ];
  if (code) fields.push({ name: '💡 Kemungkinan penyebab', value: HINT[code] ?? 'Cek detail error di New Relic', inline: false });
  if (links) fields.push({ name: '🔗 Link', value: links, inline: false });

  embed = {
    title: trunc(`${priority === 'CRITICAL' ? '🔴' : '🟠'} ${label}`, 250),
    url: issue,
    description: trunc(where, 4000),
    color: COLOR[priority] ?? COLOR.CRITICAL,
    fields,
    footer,
    timestamp: safeTs(b.createdAt),
  };
}

return [{ json: { username: 'New Relic Alert', embeds: [embed] } }];
```

Payload New Relic nggak menyertakan jumlah error, jadi card menampilkan jumlah incident dan, saat resolved, durasinya.

### Cara tes tanpa menunggu error asli

1. **Pin data palsu di node Webhook.** Di panel Output node Webhook, klik ikon pensil, isi payload tiruan (misalnya `state: "ACTIVATED"` dengan `rawTag` berisi app, nama transaksi, dan `"http.statusCode": ["500"]`), lalu Execute node Code dan HTTP Request. Ubah ke `CLOSED` untuk melihat card resolved. **Jangan lupa Unpin** setelahnya, kalau nggak workflow akan terus memakai data palsu.
2. **End-to-end dengan condition sementara**, misalnya query 400 dari satu app, tunggu card masuk, lalu hapus condition-nya dan tunggu card resolved.

Kalau output node Code ada field `myNewField: 1`, berarti yang jalan masih kode contoh bawaan n8n. Kalau muncul `Unexpected token '}'`, kemungkinan kodenya terpotong waktu di-paste; pastikan baris terakhir editor adalah `return ...`.

## 4. Notifikasi deploy Vercel → Discord

Webhook akun Vercel cuma tersedia di plan Pro dan Enterprise. Jalan gratisnya lewat **GitHub**: kalau project Vercel terhubung ke repo GitHub, Vercel selalu melaporkan status deploy ke GitHub sebagai *deployment status*, dan webhook GitHub itu gratis.

```
Push → Vercel deploy → Vercel lapor status ke GitHub
  → GitHub Webhook (deployment_status) → n8n → Discord
```

### Webhook GitHub

Di **Settings → Webhooks** repo (atau di level organisasi supaya semua repo ikut):

- Payload URL: `https://n8n.example.com/webhook/github-vercel`
- Content type: **`application/json`** (default-nya form-urlencoded, ini sering kelewat)
- Events: *Let me select individual events*, uncheck **Pushes**, centang **Deployment statuses** saja

### Workflow n8n

Saya juga ingin card menampilkan **siapa yang commit** dan judul commit-nya. Masalahnya, di event `deployment_status` pembuat deploy tercatat sebagai `vercel[bot]`. Jadi perlu satu panggilan ke GitHub API:

```
Webhook → Code "Filter Deploy" → HTTP Request "GitHub Commit" → Code "Format Card" → HTTP Request (Discord)
```

**Code `Filter Deploy`** (namanya harus persis, karena dibaca node berikutnya):

```js
// set true kalau hanya ingin notifikasi deploy Production (tanpa Preview)
const ONLY_PRODUCTION = false;

const h = $input.first().json.headers ?? {};
const b = $input.first().json.body ?? {};

// abaikan event selain deployment_status (termasuk "ping")
if (h['x-github-event'] !== 'deployment_status') return [];

const ds = b.deployment_status ?? {};
const dep = b.deployment ?? {};

// hanya deploy dari Vercel
if (ds.creator?.login !== 'vercel[bot]') return [];

// hanya saat deploy selesai
if (!['success', 'failure', 'error'].includes(ds.state)) return [];

// "Production – nama-project" / "Preview – nama-project"
const envRaw = ds.environment ?? dep.environment ?? '';
const [envName, projectFromEnv] = envRaw.split(/\s+[–-]\s+/);
const isProd = /production/i.test(envName ?? '');
if (ONLY_PRODUCTION && !isProd) return [];

const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//.test(u) ? u : undefined);
const repo = b.repository?.full_name ?? '';

return [{
  json: {
    ok: ds.state === 'success',
    isProd,
    project: projectFromEnv || b.repository?.name || repo,
    repo,
    sha: dep.sha ?? '',
    ref: dep.ref ?? '-',
    siteUrl: safeUrl(ds.environment_url),
    logUrl: safeUrl(ds.target_url),
    createdAt: ds.created_at,
  },
}];
```

**HTTP Request `GitHub Commit`:**

- Method **GET**, URL `https://api.github.com/repos/{{ $json.repo }}/commits/{{ $json.sha }}`
- Auth: Header Auth `Authorization: Bearer <token>`, pakai fine-grained token dengan permission **Contents: Read-only** saja
- Header `Accept: application/vnd.github+json` dan `User-Agent` bebas
- **Settings → On Error: Continue**, supaya kalau token kedaluwarsa atau kena rate limit, notifikasi tetap terkirim tanpa nama author

**Code `Format Card`:**

```js
const d = $('Filter Deploy').first().json;
const c = $input.first().json ?? {};

const trunc = (s, n) => {
  s = String(s ?? '').trim();
  if (!s) return undefined;
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

const login = c.author?.login;                              // username GitHub
const name = c.commit?.author?.name;                        // nama di git config
const avatar = c.author?.avatar_url;
const message = (c.commit?.message ?? '').split('\n')[0];   // judul commit

const shortSha = d.sha.slice(0, 7);
const commitUrl = d.sha && d.repo ? `https://github.com/${d.repo}/commit/${d.sha}` : undefined;

const links = [
  d.siteUrl && `[Buka website](${d.siteUrl})`,
  d.logUrl && `[Log Vercel](${d.logUrl})`,
  commitUrl && `[Commit](${commitUrl})`,
].filter(Boolean).join(' · ');

const fields = [
  { name: 'Environment', value: d.isProd ? '🚀 Production' : '🧪 Preview', inline: true },
  { name: 'Branch', value: `\`${d.ref}\``, inline: true },
  { name: 'Commit', value: shortSha ? `\`${shortSha}\`` : '-', inline: true },
];
if (!d.ok) fields.push({ name: '💡 Langkah', value: 'Cek build log di Vercel untuk melihat error-nya', inline: false });
if (links) fields.push({ name: '🔗 Link', value: links, inline: false });

const embed = {
  title: `${d.ok ? '✅ Deploy berhasil' : '❌ Deploy gagal'} · ${d.project}`,
  url: d.ok ? (d.siteUrl ?? d.logUrl) : d.logUrl,
  description: [message && `**${trunc(message, 200)}**`, `Repo ${d.repo}`].filter(Boolean).join('\n'),
  color: d.ok ? 0x2ECC71 : 0xE03E2F,
  fields,
  footer: { text: 'Vercel via GitHub' },
  timestamp: new Date(d.createdAt ?? Date.now()).toISOString(),
};

if (login || name) {
  embed.author = {
    name: login ? `${name ?? login} (@${login})` : name,
    url: login ? `https://github.com/${login}` : undefined,
    icon_url: avatar,
  };
}

return [{ json: { username: 'Vercel Deploy', embeds: [embed] } }];
```

Catatan:

- **Preview deploy bisa ramai.** Satu PR bisa menghasilkan beberapa deploy preview. Kalau channel-nya cuma untuk rilis, set `ONLY_PRODUCTION = true`.
- **Author yang tampil adalah author commit.** Untuk squash merge, itu pembuat PR. Kalau username GitHub nggak muncul dan cuma nama, berarti email git config orang itu nggak terhubung ke akun GitHub-nya.
- Untuk tes ulang tanpa deploy baru, buka **Recent Deliveries** di halaman webhook GitHub, pilih event `deployment_status` yang sukses, lalu **Redeliver**.
- Cara ini cuma berlaku untuk deploy dari integrasi Git Vercel. Deploy lewat CLI dari pipeline CI nggak lewat GitHub, jadi notifikasinya lebih gampang ditambahkan di pipeline itu sendiri.

## Checklist produksi

Setelah semua jalur jalan:

1. **Amankan webhook n8n.** Saat ini siapa pun yang tahu URL bisa mengirim card palsu. Pasang Header Auth di node Webhook (`Authorization: Bearer <token>`, generate dengan `openssl rand -hex 24`) dan isi token yang sama di contact point Grafana atau Destination New Relic. Untuk GitHub, isi *Secret* dan verifikasi signature-nya.
2. **Siapkan Error Workflow di n8n.** Karena semua alert lewat n8n, kalau n8n bermasalah alert nggak sampai. Buat workflow kecil dengan *Error Trigger* yang mengirim pesan ke Discord, lalu pasang sebagai Error Workflow.
3. **Kembalikan semua rule ke setting produksi** setelah tes (time range 5 menit, interval 1m).
4. **Backup rule.** Export alert rules Grafana ke YAML dan simpan di repo.
5. **Evaluasi setelah seminggu.** Terlalu berisik? Naikkan threshold atau kecualikan endpoint tertentu. Deploy rutin sering memicu 502/503? Buat *mute timing* untuk jam deploy.

## Bonus: cek isi log kamu

Waktu ngoprek ini saya sempat menemukan log level **debug** di production yang mencatat request/response lengkap ke pihak ketiga, termasuk data pribadi customer, dan satu baris yang mencatat nilai token rahasia secara plaintext. Siapa pun yang punya akses Kibana bisa membacanya.

Kalau kamu pakai OTel Collector, pasang redaksi sebagai jaring pengaman sebelum data dikirim ke backend:

```yaml
processors:
  transform/redact:
    log_statements:
      - context: log
        statements:
          - replace_pattern(body, "\"email\":\"[^\"]*\"", "\"email\":\"***\"")
          - replace_pattern(body, "\"phone_number\":\"[^\"]*\"", "\"phone_number\":\"***\"")
          - replace_pattern(body, "expected \\S+", "expected ***")
```

Tapi perbaikan utamanya tetap di aplikasi: set log level production ke `info`, jangan pernah log nilai secret, dan rotasi secret yang sempat tercatat.

Sekarang semua alert masuk ke Discord dengan format yang sama, apa pun sumbernya. Menambah sumber baru juga gampang: tinggal satu Webhook trigger dan satu node Code lagi.
