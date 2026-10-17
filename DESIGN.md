# Design Direction: Echidna Local Chat

## 1. Identity & Character
- **Product:** Echidna Local Chat
- **Purpose:** Sistem chat lokal yang aman, cepat, dan ringan untuk komunikasi tim dalam jaringan LAN atau server pribadi tanpa ketergantungan cloud pihak ketiga.
- **Personality:** Tangguh, bersih, fungsional, responsif, dan menghormati privasi pengguna.
- **Visual Mood:** Minimalis modern bernuansa profesional, terinspirasi dari tool komunikasi teknis berkualitas tinggi tanpa elemen dekoratif berlebihan (*anti-slop*).

---

## 2. Antislop Dials
- **ENERGY: 2** (Fokus pada keterbacaan teks dan efisiensi komunikasi, menggunakan satu warna aksen terarah tanpa gradien warna-warni yang mengalihkan perhatian).
- **RHYTHM: 2** (Komposisi terstruktur: sidebar daftar kanal/DM + area obrolan terfokus dengan pemisahan hari dan pengelompokan balon pesan cerdas).
- **MOTION: 1** (Mikro-interaksi halus dan cepat 150ms–250ms untuk feedback klik, transisi tema, dan indikator mengetik; patuh pada `prefers-reduced-motion`).

---

## 3. Design System Tokens

### Typography
- **Primary Font:** `'Plus Jakarta Sans', system-ui, -apple-system, sans-serif` (tipografi modern dengan legibilitas tinggi untuk UI dan chat).
- **Monospace Font:** `'JetBrains Mono', 'Fira Code', monospace` (untuk kode program, inline code, dan token hash/pin).

### Color Palette & Semantics
Warna mengikuti tema **"warm bone + slate blue"** di mode terang dan **"deep midnight + indigo"** di mode gelap. Netral hangat dipilih agar tidak terasa seperti template SaaS biru-putih generik; aksen gelap bergeser ke indigo agar tetap hidup di latar gelap.

- **Neutral Background (Light):** `#f5f4f0` (Warm Bone)
- **Panel Surface (Light):** `#fcfbf9`
- **Neutral Background (Dark):** `#090d16` (Deep Midnight Slate)
- **Panel Surface (Dark):** `#111726` (Deep Navy)
- **Accent Primary (fill):** `#3b526d` (Slate Blue - Light), `#4f46e5` (Indigo 600 - Dark)
- **Accent as Text:** `#3b526d` (Light), `#8b9cf7` (Dark) — dipakai untuk teks/ikon beraksen, dijamin ≥ 4.5:1 di atas panel.
- **Status Online/Success:** `#047857` (Emerald 700 - Light), `#10b981` (Emerald 500 - Dark)
- **Status Danger/Delete:** `#dc2626` (Light) / `#f87171` (Dark)
- **Status Warning:** `#d97706` (Light) / `#fbbf24` (Dark)

> Semua pasangan warna teks/latar sudah divalidasi ≥ 4.5:1 (WCAG AA) dan indikator non-teks ≥ 3:1. Perubahan warna wajib dicek ulang dengan `contrast-check.py`.

### Elevation & Shadows
- `--shadow-sm`: `0 1px 2px 0 rgba(0, 0, 0, 0.05)`
- `--shadow-md`: `0 4px 12px -2px rgba(0, 0, 0, 0.08), 0 2px 6px -1px rgba(0, 0, 0, 0.04)`
- `--shadow-lg`: `0 12px 28px -4px rgba(0, 0, 0, 0.12), 0 6px 12px -3px rgba(0, 0, 0, 0.06)`

### Border Radii
- `--radius-sm`: `6px` (badge kecil, chip, icon buttons, thumbs)
- `--radius-md`: `10px` (inputs, button standar, tab admin, bubble)
- `--radius-lg`: `14px` (menu, cards, avatar chat)
- `--radius-xl`: `18px` (composer, modal kotak, surface besar)
- `--radius-2xl`: `24px` (dialog/hero container)
- `--radius-full`: `9999px` (pill tags, unread counter badge, lingkaran)

Radius selalu memakai token di atas; nilai hardcoded seperti `12px`/`20px` tidak dipakai lagi (kecuali `50%` untuk lingkaran dan bar indikator tipis).

### Iconography
- Ikon memakai satu sistem seragam: **SVG inline 24×24, `stroke-width: 2`, `stroke-linecap: round`, `stroke-linejoin: round`, `fill: none`** (gaya Lucide-like). Tujuannya agar bobot visual konsisten di seluruh UI tanpa memuat library ikon eksternal.
- Ikon hanya dipakai untuk kontrol/aksi yang bermakna (navigasi, aksi, status). Tidak ada emoji dekoratif di teks antarmuka — status ditulis sebagai kata (`AKTIF`/`MATI`) dan lampiran sebagai `[Gambar]`.

### Accessibility & Interaction
- **Minimum Tap Target:** 44px × 44px untuk semua kontrol interaktif di perangkat mobile.
- **Focus Rings:** `:focus-visible` memiliki ring kontras `2px solid var(--acc)` dengan `outline-offset: 2px`.
- **Keyboard Navigation:** Dukungan penuh tombol Tab, Shift+Tab, Enter, dan Escape untuk menutup seluruh modal/menu.
