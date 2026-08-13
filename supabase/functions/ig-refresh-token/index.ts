// Supabase Edge Function: ig-refresh-token
// Dipanggil oleh Cloudflare Worker cron mingguan untuk memperpanjang
// long-lived token Instagram (~60 hari). Hanya refresh jika
// token_expires_at < 10 hari lagi.
//
// Deploy:
//   supabase functions deploy ig-refresh-token --no-verify-jwt
//   supabase secrets set IG_APP_ID=<app_id> IG_APP_SECRET=<app_secret>

import { createClient } from "jsr:@supabase/supabase-js@2";

const GRAPH_API_VERSION = "v21.0";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const IG_APP_ID = Deno.env.get("IG_APP_ID") || "";
const IG_APP_SECRET = Deno.env.get("IG_APP_SECRET") || "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function jsonResponse(obj: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function refreshLongLivedToken(currentToken: string) {
  const params = new URLSearchParams({
    grant_type: "ig_refresh_token", // Instagram Login token refresh
    access_token: currentToken,
  });

  const res = await fetch(
    `https://graph.instagram.com/refresh_access_token?${params}`
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "refresh failed");

  return {
    accessToken: data.access_token,
    expiresInSeconds: data.expires_in, // biasanya 60 hari = 5184000
  };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const ALLOWED = origin || "*";
  const CORS: Record<string, string> = {
    "Access-Control-Allow-Origin": ALLOWED,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  // Auth
  const authHeader = req.headers.get("authorization");
  const body = await req.json().catch(() => ({}));
  const providedKey = body.service_role_key || (authHeader ? authHeader.replace("Bearer ", "") : "");
  if (SERVICE_ROLE_KEY && providedKey !== SERVICE_ROLE_KEY) {
    const anonKey = req.headers.get("apikey");
    if (!anonKey) return jsonResponse({ error: "Unauthorized" }, 401);
  }

  // Optional: bisa specifik refresh akun tertentu via body { account_id }
  const accountId = body.account_id;

  try {
    let query = supabase
      .from("ig_accounts")
      .select("*")
      .eq("is_active", true);

    if (accountId) query = query.eq("id", accountId);

    const { data: accounts, error } = await query.order("created_at", { ascending: false });
    if (error) throw error;
    if (!accounts || !accounts.length) {
      return jsonResponse({ ok: true, message: "Tidak ada akun IG aktif" });
    }

    let refreshed = 0;
    for (const account of accounts) {
      const expiresAt = new Date(account.token_expires_at);
      const now = new Date();
      const daysLeft = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));

      // Hanya refresh jika < 10 hari tersisa (refresh window)
      if (daysLeft >= 10) {
        continue;
      }

      try {
        const { accessToken, expiresInSeconds } = await refreshLongLivedToken(account.access_token);

        await supabase.from("ig_accounts").update({
          access_token: accessToken,
          token_expires_at: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", account.id);

        await supabase.from("ig_publish_logs").insert([{
          post_id: null,
          attempt_number: 1,
          step: "refresh_token",
          success: true,
          response_body: { expires_in: expiresInSeconds },
          error_message: null,
        }]);

        refreshed++;
      } catch (err: any) {
        // Log failure
        await supabase.from("ig_publish_logs").insert([{
          post_id: null,
          attempt_number: 1,
          step: "refresh_token",
          success: false,
          error_message: err.message,
        }]);
        console.error(`Token refresh gagal untuk akun ${account.id}:`, err.message);
      }
    }

    return jsonResponse({
      ok: true,
      message: `Refresh selesai — ${refreshed} token diperbarui`,
      refreshed,
    });
  } catch (err: any) {
    console.error("ig-refresh-token error:", err);
    return jsonResponse({ ok: false, error: err.message }, 500);
  }
});
