// Supabase Edge Function: ig-manual-retry
// Dipanggil dari tombol "Retry" di dashboard (js/app.js -> retryIgPost).
// Reset status post ke 'scheduled' + schedule_time = now() + retry_count = 0,
// lalu trigger publish cycle (ig-publish) untuk post ini.
//
// Deploy:
//   supabase functions deploy ig-manual-retry
//   (tidak perlu --no-verify-jwt karena butuh JWT authenticated)

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function jsonResponse(obj: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

  // Verifikasi JWT authenticated
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthorized — login diperlukan" }, 401);
  }

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !user) {
    return jsonResponse({ error: "Unauthorized — JWT tidak valid" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const { post_id } = body;

  if (!post_id) {
    return jsonResponse({ error: "post_id wajib diisi" }, 400);
  }

  try {
    // Cek apakah post ada & berada di status yang boleh di-retry
    const { data: post, error: fetchErr } = await supabase
      .from("ig_posts")
      .select("status, retry_count, max_retries")
      .eq("id", post_id)
      .single();

    if (fetchErr || !post) {
      return jsonResponse({ error: "Post tidak ditemukan" }, 404);
    }

    if (!["draft", "scheduled", "failed", "publishing"].includes(post.status)) {
      return jsonResponse({ error: `Post berstatus '${post.status}' tidak dapat di-retry` }, 400);
    }

    // Reset ke scheduled untuk diproses kembali oleh cron berikutnya
    const now = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from("ig_posts")
      .update({
        status: "scheduled",
        schedule_time: now,
        retry_count: 0,
        last_error: null,
        ig_container_id: null,
        ig_media_id: null,
        updated_at: now,
      })
      .eq("id", post_id);

    if (updateErr) throw updateErr;

    // Trigger publish cycle untuk post ini (langsungan)
    // Panggil ig-publish secara internal (service role, tidak perlu auth lagi)
    const publishRes = await fetch(`${SUPABASE_URL}/functions/v1/ig-publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ service_role_key: SERVICE_ROLE_KEY }),
    });

    const publishResult = await publishRes.json().catch(() => ({ ok: false }));

    return jsonResponse({
      success: true,
      message: "Post di-reset ke scheduled & publish cycle terpicu",
      publish_result: publishResult,
    });
  } catch (err: any) {
    console.error("ig-manual-retry error:", err);
    return jsonResponse({ ok: false, error: err.message }, 500);
  }
});
