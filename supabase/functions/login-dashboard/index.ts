// Supabase Edge Function: login-dashboard
// Menggantikan pemanggilan RPC verify_dashboard_password langsung dari browser.
// Alur:
//   1. Client kirim { password } ke function ini.
//   2. Function memanggil RPC verify_dashboard_password (SECURITY DEFINER) untuk cek.
//   3. Jika ok, function membuat JWT Supabase (role: authenticated) via supabaseAuth()
//      supaya client bisa melakukan operasi WRITE ke tabel yang RLS-nya butuh auth.
//   4. Return { ok, role, label, access_token, expires_at }.
//
// Deploy:
//   supabase functions deploy login-dashboard --no-verify-jwt
//
// CATATAN: --no-verify-jwt WAJIB karena client belum punya JWT saat login.
// Function ini AMAN karena tetap memverifikasi password di server (tidak mengembalikan
// password), dan JWT yang dihasilkan hanya berguna untuk WRITE yang sudah di-guard RLS.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, description: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    const { password } = await req.json();
    if (!password || typeof password !== "string") {
      return new Response(JSON.stringify({ ok: false, description: "password wajib diisi" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Verifikasi password lewat RPC SECURITY DEFINER (tidak mengembalikan password).
    const { data, error } = await supabaseAdmin().rpc("verify_dashboard_password", {
      p_pass: password,
    });
    if (error) {
      return new Response(JSON.stringify({ ok: false, description: "Verifikasi gagal" }), {
        status: 401,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    if (!data || data.ok !== true) {
      // Rate-limit ringan: tunda response supaya brute-force lebih sulit.
      await new Promise((r) => setTimeout(r, 500));
      return new Response(JSON.stringify({ ok: false, description: "Password salah" }), {
        status: 401,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Buat JWT Supabase (role authenticated) untuk client melakukan WRITE ter-guard.
    const auth = supabaseAuth();
    const expiresIn = 60 * 60; // 1 jam
    const token = await auth.generateUserToken({
      role: "authenticated",
      dashboard_role: data.role, // diteruskan sebagai custom claim (tidak wajib dipakai RLS)
    }, expiresIn);

    return new Response(
      JSON.stringify({
        ok: true,
        role: data.role,
        label: data.label,
        access_token: token,
        expires_at: Date.now() + expiresIn * 1000,
      }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, description: String(err?.message || err) }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }
});

// Helper: admin client (pakai service role) untuk memanggil RPC.
function supabaseAdmin() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, { auth: { persistSession: false } });
}

// Helper: auth admin untuk generate JWT.
function supabaseAuth() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, { auth: { persistSession: false } }).auth.admin;
}

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
