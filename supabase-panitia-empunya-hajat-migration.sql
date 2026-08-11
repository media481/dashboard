-- ============================================================
-- MIGRASI: tambah field "Nama Keluarga yang Punya Hajat" di
-- generator Panitia / Sinoman.
-- Jalankan di Supabase Dashboard project MERDEKA > SQL Editor > Run.
-- Aman dijalankan berkali-kali (idempotent).
--
-- PENTING: WAJIB dijalankan sebelum upload script.js yang baru.
-- syncArrayTable() di script.js mengirim SELURUH field dokumen
-- (termasuk field baru `empunya_hajat`) setiap kali menyimpan --
-- kalau kolom ini belum ada di tabel, PostgREST akan menolak
-- request upsert-nya (bukan cuma dokumen baru, dokumen Panitia/
-- Sinoman LAMA yang diedit pun akan gagal tersimpan sampai
-- migrasi ini dijalankan).
-- ============================================================

alter table kt_panitia_sinoman add column if not exists empunya_hajat text default '';
