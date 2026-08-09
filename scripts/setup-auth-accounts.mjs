// scripts/setup-auth-accounts.mjs
//
// Jalankan SEKALI SAJA untuk membuat 4 akun Supabase Auth yang menggantikan
// password di tabel app_config (pass_admin, pass_cs, pass_user, pass_guest).
//
// URUTAN LANGKAH MIGRASI:
//   1. Jalankan sql/migrate_supabase_auth.sql di SQL Editor Supabase.
//   2. Jalankan script ini (butuh SERVICE ROLE KEY, JANGAN taruh di kode client!).
//   3. Deploy Edge Function admin-change-password (menggantikan set_admin_password).
//   4. Ganti kode login di js/app.js (lihat panduan terpisah).
//   5. Hapus/undeploy Edge Function login-dashboard yang lama, dan hapus secrets
//      DASHBOARD_JWT_SECRET / DASHBOARD_JWT_KID (sudah tidak dipakai).
//
// CARA JALANKAN (lokal, Node 18+):
//   npm install @supabase/supabase-js
//   SUPABASE_URL="https://vlrizloxsjejcfuxuyju.supabase.co" \
//   SUPABASE_SERVICE_ROLE_KEY="<service_role_key_dari_dashboard>" \
//   ADMIN_PASSWORD="password_admin_baru" \
//   CS_PASSWORD="password_cs_baru" \
//   USER_PASSWORD="password_user_baru" \
//   GUEST_PASSWORD="password_guest_baru" \
//   node scripts/setup-auth-accounts.mjs
//
// CATATAN: email di bawah ini FIKTIF (domain .internal) — tidak akan dikirimi
// email verifikasi apa pun karena email_confirm di-set true langsung saat dibuat.
// Password BOLEH diganti kapan saja lewat Edge Function admin-change-password
// setelah migrasi selesai, tidak perlu jalankan script ini lagi.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib diisi sebagai env var.');
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ACCOUNTS = [
  { email: 'admin@amiru-dashboard.internal', password: process.env.ADMIN_PASSWORD, dashboard_role: 'admin', label: 'Admin' },
  { email: 'cs@amiru-dashboard.internal',    password: process.env.CS_PASSWORD,    dashboard_role: 'user',  label: 'CS / Customer Service' },
  { email: 'user@amiru-dashboard.internal',  password: process.env.USER_PASSWORD,  dashboard_role: 'user',  label: 'User' },
  { email: 'guest@amiru-dashboard.internal', password: process.env.GUEST_PASSWORD, dashboard_role: 'guest', label: 'Guest' },
];

async function main() {
  for (const acc of ACCOUNTS) {
    if (!acc.password) {
      console.warn(`Lewati ${acc.email}: password tidak diisi di env var.`);
      continue;
    }

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: acc.email,
      password: acc.password,
      email_confirm: true, // wajib true, akun internal ini tidak pernah mengecek email asli
      user_metadata: { dashboard_role: acc.dashboard_role, label: acc.label },
    });

    let userId;
    if (createErr) {
      // Kemungkinan besar akun sudah ada (jalan ulang script) -> cari & update saja.
      if (String(createErr.message || '').toLowerCase().includes('already registered')) {
        const { data: list, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
        if (listErr) { console.error(`Gagal listUsers untuk ${acc.email}:`, listErr.message); continue; }
        const existing = list.users.find(u => u.email === acc.email);
        if (!existing) { console.error(`Akun ${acc.email} dilaporkan sudah ada tapi tidak ditemukan.`); continue; }
        userId = existing.id;
        const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
          password: acc.password,
          user_metadata: { dashboard_role: acc.dashboard_role, label: acc.label },
        });
        if (updateErr) { console.error(`Gagal update password ${acc.email}:`, updateErr.message); continue; }
        console.log(`Update: ${acc.email} (password direset, role=${acc.dashboard_role})`);
      } else {
        console.error(`Gagal membuat ${acc.email}:`, createErr.message);
        continue;
      }
    } else {
      userId = created.user.id;
      console.log(`Dibuat: ${acc.email} (id=${userId}, role=${acc.dashboard_role})`);
    }

    // Isi/perbarui dashboard_profiles supaya current_dashboard_role() bekerja.
    const { error: profileErr } = await supabaseAdmin
      .from('dashboard_profiles')
      .upsert({ id: userId, dashboard_role: acc.dashboard_role, label: acc.label }, { onConflict: 'id' });
    if (profileErr) {
      console.error(`Gagal upsert dashboard_profiles untuk ${acc.email}:`, profileErr.message);
    }
  }

  console.log('\nSelesai. Simpan baik-baik password yang dipakai (ADMIN_PASSWORD, dst) — itu password login dashboard yang baru.');
}

main();
