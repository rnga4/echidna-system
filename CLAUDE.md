# CLAUDE.md — Echidna Local Chat

Proyek ini berisi **satu aplikasi chat lokal self-hosted** bernama **Echidna System**, dibangun sebagai monolit Node.js tanpa framework, di-deploy lewat Docker Compose di port `8101`.

## Ringkasan Singkat

Echidna adalah sistem chat tim untuk jaringan LAN / server pribadi yang tidak bergantung pada cloud pihak ketiga. Fokus utamanya: **privasi, retensi pesan sementara (ephemeral), keamanan berbasis password, dan tampilan mobile-first**. Seluruh logika ada di dua file utama: `server.js` (backend + WebSocket) dan `index.html` (frontend SPA sekaligus CSS + JS dalam satu file).

## Stack Teknologi

| Komponen | Teknologi |
|---|---|
| Runtime | Node.js 24 (Alpine), ESM (`"type": "module"`) |
| HTTP | `node:http` murni, tanpa Express |
| Realtime | `ws` (WebSocketServer), path `/ws`, max payload 32KB |
| Database | `node:sqlite` (`DatabaseSync`), file `chat.db`, mode WAL |
| Frontend | Single-file `index.html` (vanilla JS + CSS), PWA (manifest + service worker) |
| Deploy | Docker Compose (`compose.yml`), image build dari `Dockerfile`, volume `chat-data:/data` |

## Struktur File

```
server.js        # Backend lengkap: HTTP server, WebSocket, SQLite, admin, bot, upload
index.html       # Frontend SPA: HTML + CSS + vanilla JS dalam satu file (~130KB)
sw.js            # Service worker PWA (cache shell)
manifest.json    # PWA manifest ("Echidna System")
icon.svg         # Icon SVG (favicon + PWA icon)
compose.yml      # Docker Compose: service "chat", port 8101:3000, volume chat-data
Dockerfile       # Build image node:24-alpine, user non-root "node", healthcheck /healthz
DESIGN.md        # Design direction: identitas, dial antislop, token warna/tipografi
GEMINI.md        # Pointer ke skill antislop (untuk Gemini CLI)
```

## Model Database (SQLite)

| Tabel | Fungsi |
|---|---|
| `users` | Akun: `name` (PK, case-insensitive), `token`, `last_seen`, `bio`, `avatar` |
| `channels` | Kanal publik: `name` (PK), `created_by`, `ts`, `topic` |
| `messages` | Pesan: `id`, `ts`, `sender`, `chat` (nama kanal ATAU `userA\|userB` untuk DM), `text`, `reply_to`, `media` (path file upload) |
| `settings` | Key-value: `password`, `retention`, `spam_max`, `spam_window`, `typing_throttle`, `admin_ttl` |
| `bans` | Daftar ban: `name`, `reason`, `ts`, `by` |
| `device_pins` | PIN sekali pakai (10 menit) untuk login device baru tanpa password |
| `bots` | Bot terjadwal: `name`, `enabled`, `hour`, `minute`, `days`, `chat`, `text`, `pos` |
| `reactions` | Reaksi emoji per pesan: `msg_id`, `user`, `emoji` (UNIQUE per user+msg) |

**Chat key:** nama kanal (mis. `general`) untuk channel, atau `[userA,userB].sort().join('|')` untuk DM privat.

## Fitur Utama

### Autentikasi & Akun
- Login via WebSocket `join` dengan `name` + `token` (client generate token acak, disimpan di `localStorage`) + `password` (dari `settings`).
- Nama: regex `^[\w.-]{2,20}$`, case-insensitive unique.
- Token bisa dibawa ke device lain via **device PIN** (6 digit, expire 10 menit, sekali pakai) — endpoint HTTP `POST /api/device/pin` dan `/api/device/verify`.
- Profil: `bio` dan `avatar` (base64 data URL, disimpan langsung di DB).

### Chat
- **Kanal publik** + **DM privat** (multi-user: chat key `a|b`).
- **Reply/quote** pesan (`reply_to`).
- **Reaksi emoji** per pesan (UNIQUE per user+msg — satu reaksi per user per pesan, bisa diganti).
- **Upload gambar** (PNG/JPEG/WebP/GIF, maks 3MB via base64 data URL, disimpan ke `/data/uploads/`).
- **Typing indicator** (throttled).
- **Presence** (online/offline + `last_seen`).
- **Pesan sistem** otomatis (user join, retensi diubah, riwayat dibersihkan, dsb).
- **Markup ringan** di pesan: bold, italic, inline code, code block, link.

### Retensi Ephemeral (Ephemeral Messaging)
- Semua pesan otomatis dihapus setelah `retention` menit (default **48 menit**), dijalankan sweep berkala.
- Admin bisa ubah retensi 1–10080 menit.
- Export pesan sebelum terhapus via endpoint export.

### Anti-Spam
- Rate limit per koneksi: `spam_max` pesan per `spam_window` ms (default 6 pesan / 10 detik).

### Admin Panel (login dengan password yang sama)
- **Ganti password** sistem.
- **Atur retensi** pesan (menit).
- **Atur anti-spam** (`spamMax`, `spamWin`).
- **Atur typing throttle** & **admin session TTL**.
- **Ban / unban** user (ban mengakhiri koneksi aktif).
- **Reset** seluruh riwayat percakapan.
- **Kelola bot terjadwal** (CRUD).
- **Export** seluruh chat atau per-chat ke JSON / TXT (`/export/all`, `/export/chat`, `/export/chat.txt`) — butuh auth admin.
- Admin session punya TTL (`admin_ttl`, default 10 menit), disimpan client-side dengan expiry.

### Bot Terjadwal
- Bot kirim pesan otomatis ke kanal tertentu pada jam/hari yang ditentukan (`hour`, `minute`, `days` — format `*` atau daftar hari).
- Diurutkan berdasarkan `pos`, dicek berkala di server.

### PWA & Mobile
- Bisa di-install sebagai app (manifest + service worker).
- **Dark/light theme** dengan preferensi tersimpan di `localStorage`.
- Layout responsif mobile-first (sidebar collapsible, bottom sheet, tap target 44px).
- **Web notification** + **sound beep** untuk pesan masuk.
- **Unread counter** per kanal/DM.

## Cara Menjalankan

### Docker (rekomendasi, production)
```bash
docker compose up -d --build
# Akses: http://localhost:8101
# Healthcheck: http://localhost:8101/healthz
```

### Lokal (development)
```bash
npm install
node server.js
# PORT bisa di-override via env PORT (default 3000)
# DB_PATH bisa di-override via env DB_PATH (default: /data/chat.db jika ada, selain itu chat.db di direktori kerja)
```

**Password admin default:** `anjir445566` (di-set otomatis saat pertama jalankan via `INSERT OR IGNORE` ke tabel `settings`).

## Konvensi & Catatan Penting

- **Tanpa framework:** semua routing HTTP manual di `http.createServer` callback, semua query WS manual via `switch/if` pada `d.t`.
- **Prepared statements:** semua query DB dikumpulkan di objek `q` (dan `qBot`) sebagai `db.prepare(...)` — kalau tambah query baru, tambahkan di sana.
- **Case-insensitive names:** nama user dan channel di-set `COLLATE NOCASE`, perhatikan saat bikin query baru.
- **DM dienkripsi tidak** — hanya dipisah by chat key, bukan enkripsi end-to-end. Ini chat LAN tepercaya, bukan produk E2E.
- **Frontend single-file:** semua HTML + CSS + JS ada di `index.html` — tidak ada build step, tidak ada bundler. Edit langsung.
- **Design direction** ada di `DESIGN.md` (warna, tipografi, dial antislop: ENERGY 2 / RHYTHM 2 / MOTION 1). Ikuti token di sana kalau ubah UI.
- **antislop** terpasang sebagai skill di `.agents/skills/` — kalau kerja UI/copy, baca `DESIGN.md` dulu sebagai arah, lalu `antislop.md` sebagai filter.
- **Berkas DB (`chat.db`) tidak di-commit** — sudah di-`.gitignore`, data vial volume Docker `chat-data`.
- **Jangan commit file upload** (`uploads/`) juga.
- Path upload dilindungi path-traversal guard (resolve + prefix check).

## Endpoint HTTP Penting

| Method & Path | Fungsi | Auth |
|---|---|---|
| `GET /healthz` | Health check (untuk Docker healthcheck) | — |
| `GET /` | Sajikan `index.html` (SPA) | — |
| `GET /manifest.json`, `/sw.js`, `/icon.svg` | Aset PWA | — |
| `GET /uploads/:file` | Sajikan file gambar yang di-upload | — |
| `POST /api/upload` | Upload gambar (base64 data URL) | User token |
| `POST /api/device/pin` | Generate PIN login device baru | User token |
| `POST /api/device/verify` | Verifikasi PIN, dapatkan token | — (PIN) |
| `GET /export/all?pw=...` | Export semua pesan (JSON) | Admin password |
| `GET /export/chat?chat=...&pw=...` | Export per-chat (JSON) | Admin password |
| `GET /export/chat.txt?chat=...&pw=...` | Export per-chat (plain text) | Admin password |

Admin bisa auth via header `Authorization: Bearer <pw>`, header `X-Admin-Password: <pw>`, atau query param `?pw=...`.

## WebSocket Message Types (ringkas)

**Client → Server:** `join`, `msg`, `del`, `typing`, `channel_create`, `react`, `user_bio`, `user_avatar`, dan tipe `admin_*` (verify, setpw, setret, reset, ban, unban, setcfg, export_*, bot_add/upd/del/list).

**Server → Client:** `init`, `msg`, `presence`, `online_count`, `typing`, `channel_created`, `react`, `del`, `reset`, `cfg_update`, `ban`/`unban`, `bot_list`, `err`, `admin_ok`/`admin_err`, `purge`, dan lainnya.

## State Saat Ini

- Berdiri sebagai **single-container service** dengan data persist di volume Docker.
- Belum ada autentikasi per-message signature, E2E encryption, atau federation — sesuai tujuan sebagai chat LAN tepercaya.
- Audit antislop sudah pernah dilakukan (lihat `anti-slop/audit-*.md`), beberapa temuan mungkin masih terbuka.
