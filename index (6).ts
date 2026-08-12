// Supabase Edge Function: admin-reset-user-password
//
// Dipakai dari tab "Pengaturan User" (khusus admin) untuk MENGGANTI password
// user lain, TANPA perlu tahu password lama mereka.
//
// Catatan penting: password di Supabase Auth disimpan dalam bentuk hash
// (satu arah), jadi password ASLI/lama tidak pernah bisa "dilihat" oleh
// siapapun (admin, developer, bahkan Supabase sendiri) -- ini standar
// keamanan dan bukan keterbatasan aplikasi ini. Yang bisa dilakukan admin
// adalah RESET/ganti ke password baru, bukan melihat password lama.
//
// Alur:
//   1. Client (yang sudah login sebagai admin) kirim Authorization: Bearer <access_token>
//      hasil signInWithPassword, plus { target_user_id, new_password }.
//   2. Function verifikasi token itu benar & pemiliknya dashboard_role = 'admin'
//      (query ke dashboard_profiles pakai service role, tidak percaya klaim dari client).
//   3. Kalau valid, ganti password user target lewat Supabase Auth Admin API
//      (service role) -- admin.auth.admin.updateUserById(id, { password }).
//
// Deploy: supabase functions deploy admin-reset-user-password

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
    return json({ ok: false, description: "Hanya admin yang boleh mengganti password user" }, 403);
  }

  const { target_user_id, new_password } = await req.json().catch(() => ({}));

  const targetId = typeof target_user_id === "string" ? target_user_id.trim() : "";
  if (!targetId) {
    return json({ ok: false, description: "User target tidak ditemukan" }, 400);
  }
  if (!new_password || typeof new_password !== "string" || new_password.length < 6) {
    return json({ ok: false, description: "Password baru minimal 6 karakter" }, 400);
  }

  const { data: updated, error: updateErr } = await admin.auth.admin.updateUserById(targetId, {
    password: new_password,
  });

  if (updateErr || !updated?.user) {
    return json({ ok: false, description: updateErr?.message || "Gagal mengganti password" }, 400);
  }

  return json({ ok: true, user: { id: updated.user.id } });
});
