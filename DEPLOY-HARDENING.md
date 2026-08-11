# Cara Deploy Perbaikan Keamanan

Perbaikan prioritas 1–4 dari `AUDIT-STANDAR-SAAS.md` sudah diterapkan.
Ikuti urutan ini — **jangan dibalik**.

## Ringkasan perubahan

| File | Perubahan |
|---|---|
| `supabase-hardening-migration.sql` | **BARU** — RLS berbasis sesi, tabel `kt_sessions`, bcrypt, rate limit login |
| `src/worker.js` | **BARU** — Worker `/api/telegram` yang memegang bot token sebagai secret |
| `wrangler.jsonc` | tambah `main` + binding `ASSETS` |
| `_headers` | CSP lengkap + Permissions-Policy (sebelumnya tidak ada CSP sama sekali) |
| `js/sw-register.js` | **BARU** — inline script dipindah ke sini supaya CSP tanpa `unsafe-inline` |
| `js/02-auth.js` | `validateSession()` — sesi diverifikasi ke server |
| `js/19-init.js` | panggil `validateSession()` sebelum `loadDB()` |
| `js/03-db-core.js` | bot token tidak lagi dibaca/ditulis klien |
| `js/04-event-settings.js` | Telegram lewat `/api/telegram`, bukan `api.telegram.org` |
| `js/15-pengaturan-event.js` | field Bot Token jadi keterangan (tidak diinput lagi) |
| `.github/workflows/ci.yml` | **BARU** — build-check + deploy |
| `api/emas.js`, `SECURITY_AUDIT.md` | **DIHAPUS** — sisa proyek SinarKeu, bukan milik repo ini |

Bundle sudah di-rebuild (`npm run build`) dan `CACHE_VERSION` sw.js dinaikkan ke `v47`.

---

## Langkah 1 — Jalankan SQL

Supabase Dashboard → SQL Editor → New query → tempel isi
`supabase-hardening-migration.sql` → Run.

Aman dijalankan berkali-kali. Setelah selesai, verifikasi tidak ada lagi
policy tulis yang terbuka:

```sql
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public' and qual = 'true' and cmd <> 'SELECT';
```

Hasilnya harus **kosong**.

## Langkah 2 — Pasang secret Worker

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN   # token dari @BotFather
npx wrangler secret put SUPABASE_URL         # https://tykahltxzlpctfqdylno.supabase.co
npx wrangler secret put SUPABASE_ANON_KEY    # anon key yang sama dengan js/00-config.js
```

Bot token yang lama sudah pernah terekspos ke publik — **buat token baru
lewat `/revoke` di @BotFather**, jangan pakai ulang yang lama.

## Langkah 3 — Deploy

```bash
npm install
npm run build
npx wrangler deploy
```

## Langkah 4 — Uji

1. **Login normal** — masih bisa masuk dengan password lama (hash sha256 lama
   otomatis di-upgrade ke bcrypt saat login pertama, tidak perlu reset).
2. **Rate limit** — salah password 6×, percobaan ke-6 harus muncul pesan
   "Terlalu banyak percobaan login gagal".
3. **Tulis tanpa login** — buka DevTools, jalankan:
   ```js
   await sb.from('kt_anggota').delete().eq('id','apa-saja')
   ```
   dalam keadaan logout. Harus **gagal** (sebelumnya berhasil).
4. **Telegram** — Pengaturan → Test Telegram, pesan harus tetap masuk.
5. **CSP** — Console tidak boleh ada error `Refused to load/execute`.

---

## Yang berubah untuk pengguna

- **Tidak ada reset password.** Password lama tetap berlaku.
- **Wajib login untuk mengubah data.** Sebelumnya mode tamu diam-diam masih
  bisa menulis lewat API; sekarang tamu benar-benar read-only. Melihat data
  tetap bisa tanpa login (mode Guest yang memang disengaja tidak diubah).
- **Field Bot Token hilang dari halaman Pengaturan.** Diganti keterangan.
  Token sekarang dipasang sekali lewat wrangler, bukan lewat UI.
- **Password baru minimal 8 karakter** saat admin menambah/mengubah user.
- **Ganti password user = sesi user itu dicabut**, dia harus login ulang.
- Sesi berlaku 30 hari, lalu login ulang.

## Catatan penting soal `_headers`

`connect-src` di CSP mengunci koneksi ke domain Supabase yang tertulis di
`js/00-config.js`. Kalau suatu saat pindah project Supabase, **URL di
`_headers` harus ikut diubah**, kalau tidak semua request akan diblokir
browser.

## Yang BELUM dikerjakan (prioritas 5–7 audit)

- Test otomatis untuk lapisan sync (`syncArrayTable`) — §14
- Alert Telegram untuk uptime & error harian — §13
- Retensi otomatis `kt_error_log` — §5
- Migrasi ke Supabase CLI (`supabase/migrations/`) — §5
- Filter `select` per `event_id` untuk mengurangi payload — §15
