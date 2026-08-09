// Supabase Edge Function: admin-create-user
//
// Dipakai dari tab "Pengaturan User" (khusus admin) untuk membuat akun baru
// per-orang, dengan role 'admin' atau 'user'. Berbeda dari 3 akun tetap
// (admin@..., user@..., guest@...) yang dibuat lewat scripts/setup-auth-accounts.mjs
// -- fungsi ini membuat akun BARU untuk orang lain, dan akun-akun itu berdampingan
// dengan akun tetap yang sudah ada (dashboard_profiles menyimpan satu baris per user,
// bukan satu baris per role).
//
// Alur:
//   1. Client (yang sudah login sebagai admin) kirim Authorization: Bearer <access_token>
//      hasil signInWithPassword, plus { email, password, label, dashboard_role }.
//   2. Function verifikasi token itu benar & pemiliknya dashboard_role = 'admin'
//      (query ke dashboard_profiles pakai service role, tidak percaya klaim dari client).
//   3. Kalau valid, buat user baru lewat Supabase Auth Admin API (service role),
//      lalu isi dashboard_profiles untuk user baru itu.
//
// Deploy: supabase functions deploy admin-create-user
// Butuh sql/tambah_kelola_user.sql sudah dijalankan (kolom email + policy baca).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_ROLES = ["admin", "user"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function supabaseAdmin() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, { auth: { persistSession: false } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") {
    return json({ ok: false, description: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    return json({ ok: false, description: "Tidak ada token" }, 401);
  }

  const admin = supabaseAdmin();

  // Verifikasi token & ambil user pemiliknya langsung dari Supabase Auth (bukan dari klaim JWT mentah).
  const { data: userRes, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userRes?.user) {
    return json({ ok: false, description: "Token tidak valid" }, 401);
  }

  // Pastikan pemanggil benar-benar admin (cek ke tabel, bukan percaya user_metadata dari client).
  const { data: callerProfile, error: callerErr } = await admin
    .from("dashboard_profiles")
    .select("dashboard_role")
    .eq("id", userRes.user.id)
    .single();
  if (callerErr || callerProfile?.dashboard_role !== "admin") {
    return json({ ok: false, description: "Hanya admin yang boleh menambah user" }, 403);
  }

  const { email, password, label, dashboard_role } = await req.json().catch(() => ({}));

  const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  const cleanLabel = typeof label === "string" ? label.trim() : "";

  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return json({ ok: false, description: "Email tidak valid" }, 400);
  }
  if (!cleanLabel) {
    return json({ ok: false, description: "Nama/label user wajib diisi" }, 400);
  }
  if (!password || typeof password !== "string" || password.length < 6) {
    return json({ ok: false, description: "Password minimal 6 karakter" }, 400);
  }
  if (!ALLOWED_ROLES.includes(dashboard_role)) {
    return json({ ok: false, description: "Role harus 'admin' atau 'user'" }, 400);
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: cleanEmail,
    password,
    email_confirm: true,
    user_metadata: { dashboard_role, label: cleanLabel },
  });

  if (createErr || !created?.user) {
    const msg = String(createErr?.message || "");
    const friendly = msg.toLowerCase().includes("already registered")
      ? "Email ini sudah terdaftar"
      : (msg || "Gagal membuat user");
    return json({ ok: false, description: friendly }, 400);
  }

  const { error: profileErr } = await admin
    .from("dashboard_profiles")
    .upsert(
      { id: created.user.id, dashboard_role, label: cleanLabel, email: cleanEmail },
      { onConflict: "id" }
    );

  if (profileErr) {
    // User Auth sudah terlanjur dibuat tapi profil gagal -- hapus lagi supaya tidak nyangkut setengah jadi.
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    return json({ ok: false, description: "Gagal menyimpan profil user: " + profileErr.message }, 500);
  }

  return json({ ok: true, user: { id: created.user.id, email: cleanEmail, label: cleanLabel, dashboard_role } });
});
