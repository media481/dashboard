// Supabase Edge Function: admin-change-password
// Menggantikan RPC set_admin_password (yang menulis ke app_config) sekarang
// setelah migrasi ke Supabase Auth asli. Tidak ada penandatanganan JWT sama
// sekali di sini -> tidak tersentuh isu kid/JWT Signing Key.
//
// Alur:
//   1. Client (yang sudah login sebagai admin) kirim Authorization: Bearer <access_token>
//      hasil signInWithPassword, plus { role: 'admin'|'user'|'guest', new_password }.
//   2. Function verifikasi token itu benar & pemiliknya dashboard_role = 'admin'
//      (query ke dashboard_profiles pakai service role, tidak percaya klaim dari client).
//   3. Kalau valid, pakai Admin API (service role) untuk update password akun
//      role target (admin@..., cs@..., dst).
//
// Deploy: supabase functions deploy admin-change-password
// (JWT verification bawaan Supabase boleh dibiarkan aktif untuk function ini,
//  karena sekarang token yang dikirim adalah token authenticated asli.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// role dashboard -> email akun bersama yang passwordnya mau diubah
const ROLE_EMAIL: Record<string, string> = {
  admin: "epuser.ad@gmail.com", // akun admin nyata
  user: "user@amiru-dashboard.internal", // dipakai juga untuk akun "cs" jika kamu pisah nanti
  guest: "guest@amiru-dashboard.internal",
};

function supabaseAdmin() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, { auth: { persistSession: false } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, description: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    return new Response(JSON.stringify({ ok: false, description: "Tidak ada token" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const admin = supabaseAdmin();

  // Verifikasi token & ambil user pemiliknya langsung dari Supabase Auth (bukan dari klaim JWT mentah).
  const { data: userRes, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userRes?.user) {
    return new Response(JSON.stringify({ ok: false, description: "Token tidak valid" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Pastikan pemanggil benar-benar admin (cek ke tabel, bukan percaya user_metadata dari client).
  const { data: profile, error: profileErr } = await admin
    .from("dashboard_profiles")
    .select("dashboard_role")
    .eq("id", userRes.user.id)
    .single();
  if (profileErr || profile?.dashboard_role !== "admin") {
    return new Response(JSON.stringify({ ok: false, description: "Hanya admin yang boleh mengubah password" }), {
      status: 403,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const { role, new_password } = await req.json().catch(() => ({}));
  const targetEmail = ROLE_EMAIL[role];
  if (!targetEmail || !new_password || typeof new_password !== "string" || new_password.length < 6) {
    return new Response(JSON.stringify({ ok: false, description: "role tidak dikenal atau password terlalu pendek (min 6 karakter)" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const { data: list, error: listErr } = await admin.auth.admin.listUsers();
  if (listErr) {
    return new Response(JSON.stringify({ ok: false, description: "Gagal mencari akun target" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
  const targetUser = list.users.find((u) => u.email === targetEmail);
  if (!targetUser) {
    return new Response(JSON.stringify({ ok: false, description: "Akun role tersebut belum di-setup (jalankan scripts/setup-auth-accounts.mjs)" }), {
      status: 404,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const { error: updateErr } = await admin.auth.admin.updateUserById(targetUser.id, { password: new_password });
  if (updateErr) {
    return new Response(JSON.stringify({ ok: false, description: updateErr.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
