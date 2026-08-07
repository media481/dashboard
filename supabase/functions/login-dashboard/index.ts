// Supabase Edge Function: login-dashboard
// Menggantikan pemanggilan RPC verify_dashboard_password langsung dari browser.
// Alur:
//   1. Client kirim { password } ke function ini.
//   2. Function memanggil RPC verify_dashboard_password (SECURITY DEFINER) untuk cek.
//   3. Jika ok, function membuat JWT Supabase (role: authenticated) dengan menandatangani
//      pakai SUPABASE_JWT_SECRET, supaya client bisa WRITE ke tabel yang RLS-nya
//      butuh auth.role()='authenticated'.
//   4. Return { ok, role, label, access_token, expires_at }.
//
// Deploy:
//   supabase functions deploy login-dashboard --no-verify-jwt
//
// WAJIB set secret (di Supabase Dashboard > Project Settings > API > JWT Secret):
//   supabase secrets set SUPABASE_JWT_SECRET=<JWT_SECRET_ANDA>
// CATATAN: --no-verify-jwt WAJIB karena client belum punya JWT saat login.
// Function tetap aman: password diverifikasi di server (tidak dikembalikan).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SignJWT } from "https://esm.sh/jose";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Client dengan service role untuk memanggil RPC verify_dashboard_password.
function supabaseAdmin() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, { auth: { persistSession: false } });
}

// Buat JWT Supabase (role: authenticated) yang diterima RLS.
// Ditandatangani HMAC-SHA256 pakai SUPABASE_JWT_SECRET (sama dengan JWT Secret project).
async function signDashboardJwt(dashboardRole: string, expiresInSec: number): Promise<string> {
  const secret = new TextEncoder().encode(Deno.env.get("SUPABASE_JWT_SECRET")!);
  return await new SignJWT({ role: "authenticated", dashboard_role: dashboardRole })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setIssuer("supabase")
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSec)
    .sign(secret);
}

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
    const expiresIn = 60 * 60; // 1 jam
    let token: string;
    try {
      token = await signDashboardJwt(data.role, expiresIn);
    } catch (jwtErr) {
      return new Response(
        JSON.stringify({ ok: false, description: "Gagal membuat token (cek SUPABASE_JWT_SECRET)" }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

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
