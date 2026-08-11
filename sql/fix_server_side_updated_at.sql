-- ============================================================
-- FIX: updated_at SELALU dari jam SERVER, bukan jam device
-- Jalankan sekali di Supabase SQL Editor
-- ============================================================
--
-- MASALAH:
-- Selama ini kolom `updated_at` di transactions/settings/payment_reminders
-- diisi oleh APLIKASI (new Date().toISOString() di device pengguna) lalu
-- dikirim ke Supabase apa adanya. Kolom ini dipakai untuk DUA hal penting:
--   1. Menentukan siapa yang "menang" saat dua device mengubah baris yang
--      sama (last-write-wins, lihat pullFromCloudSilently di transaction.js
--      dan pullAllSettings di db.js).
--   2. Sebagai cursor sinkronisasi incremental ("ambil semua baris yang
--      berubah setelah waktu X").
-- Kalau jam salah satu device meleset (zona waktu salah, jam HP tidak
-- ter-sync, dsb), kedua hal di atas bisa salah TANPA ERROR SAMA SEKALI:
-- perubahan device lain bisa hilang diam-diam, atau perubahan lama bisa
-- "menang" menimpa perubahan baru hanya karena jam device-nya lebih maju.
--
-- PERBAIKAN:
-- Trigger di bawah membuat SETIAP insert/update selalu memakai now() milik
-- SERVER Postgres, mengabaikan apa pun yang dikirim aplikasi untuk kolom
-- updated_at. Semua device otomatis memakai "jam" yang sama (jam server),
-- terlepas dari jam device itu sendiri benar atau tidak.
--
-- Ini AMAN dijalankan berkali-kali (CREATE OR REPLACE / DROP...IF EXISTS).
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at_from_server_clock()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── transactions ─────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_transactions_updated_at ON transactions;
CREATE TRIGGER trg_transactions_updated_at
    BEFORE INSERT OR UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_from_server_clock();

-- ── settings ─────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_settings_updated_at ON settings;
CREATE TRIGGER trg_settings_updated_at
    BEFORE INSERT OR UPDATE ON settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_from_server_clock();

-- ── payment_reminders (jalankan blok ini HANYA jika tabel ini ada) ──
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payment_reminders') THEN
        EXECUTE 'DROP TRIGGER IF EXISTS trg_payment_reminders_updated_at ON payment_reminders';
        EXECUTE 'CREATE TRIGGER trg_payment_reminders_updated_at
                    BEFORE INSERT OR UPDATE ON payment_reminders
                    FOR EACH ROW EXECUTE FUNCTION set_updated_at_from_server_clock()';
    END IF;
END $$;

-- ============================================================
-- Setelah SQL ini dijalankan:
--   - updated_at yang dikirim dari aplikasi (device mana pun, jam benar
--     atau salah) akan SELALU ditimpa oleh jam server saat baris disimpan.
--   - Kode di js/transaction.js sudah disesuaikan untuk memakai updated_at
--     hasil kembalian server (bukan menyimpan nilai kiriman device sendiri)
--     sebagai acuan cursor sinkronisasi & perbandingan versi.
--   - Tidak perlu ubah skema tabel apa pun -- hanya menambah trigger.
-- ============================================================
