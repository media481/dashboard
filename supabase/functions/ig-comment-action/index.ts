// Supabase Edge Function: ig-comment-action
// Dipanggil dari tombol "Balas" / "Sembunyikan" / "Hapus" di modal komentar
// (js/app.js -> igReplyComment / igHideComment / igDeleteComment).
//
// Kontrak:
//   POST body: { ig_comment_id, action: 'reply'|'hide'|'unhide'|'delete', reply_text? }
//   Header   : Authorization: Bearer <JWT user login> (WAJIB — bukan service role)
//
// Deploy:
//   supabase functions deploy ig-comment-action
//   (TIDAK pakai --no-verify-jwt karena wajib JWT authenticated, sama seperti ig-manual-retry)

import { createClient } from "jsr:@supabase/supabase-js@2";

const GRAPH_API_VERSION = "v21.0";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function jsonResponse(obj: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const CORS: Record<string, string> = {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  // Wajib JWT valid — TIDAK ada fallback service_role_key/apikey di sini,
  // karena aksi ini selalu dipicu manusia lewat tombol dashboard.
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthorized — login diperlukan" }, 401);
  }
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !user) {
    return jsonResponse({ error: "Unauthorized — JWT tidak valid" }, 401);
  }

  // Cek role dashboard (admin/user) — guest ditolak walau JWT sah.
  // Sama seperti current_dashboard_role() di SQL, dicek ulang di sini karena
  // function ini pakai service role client (bypass RLS) untuk update tabel.
  const { data: profile } = await supabase
    .from("dashboard_profiles")
    .select("dashboard_role")
    .eq("id", user.id)
    .single();
  if (!profile || !["admin", "user"].includes(profile.dashboard_role)) {
    return jsonResponse({ error: "Akun Anda tidak punya izin untuk aksi ini" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const { ig_comment_id, action, reply_text } = body;
  if (!ig_comment_id || !action) {
    return jsonResponse({ error: "ig_comment_id dan action wajib diisi" }, 400);
  }
  if (action === "reply" && !reply_text?.trim()) {
    return jsonResponse({ error: "reply_text wajib diisi untuk action reply" }, 400);
  }

  try {
    const { data: accounts } = await supabase.from("ig_accounts").select("access_token").eq("is_active", true).limit(1);
    if (!accounts || !accounts.length) {
      return jsonResponse({ error: "Tidak ada akun IG aktif" }, 400);
    }
    const igToken = accounts[0].access_token;

    if (action === "reply") {
      const params = new URLSearchParams({ message: reply_text, access_token: igToken });
      const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${ig_comment_id}/replies?${params}`, { method: "POST" });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || "Gagal membalas komentar");

      await supabase.from("ig_comments").update({
        replied: true,
        our_reply_text: reply_text,
        our_reply_ig_id: data.id,
        replied_at: new Date().toISOString(),
      }).eq("ig_comment_id", ig_comment_id);

      return jsonResponse({ ok: true, message: "Balasan terkirim", reply_id: data.id });
    }

    if (action === "hide" || action === "unhide") {
      const hidden = action === "hide";
      const params = new URLSearchParams({ hidden: String(hidden), access_token: igToken });
      const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${ig_comment_id}?${params}`, { method: "POST" });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || `Gagal ${action} komentar`);

      await supabase.from("ig_comments").update({ hidden }).eq("ig_comment_id", ig_comment_id);
      return jsonResponse({ ok: true, message: hidden ? "Komentar disembunyikan" : "Komentar ditampilkan lagi" });
    }

    if (action === "delete") {
      const params = new URLSearchParams({ access_token: igToken });
      const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${ig_comment_id}?${params}`, { method: "DELETE" });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || "Gagal menghapus komentar");

      await supabase.from("ig_comments").delete().eq("ig_comment_id", ig_comment_id);
      return jsonResponse({ ok: true, message: "Komentar dihapus" });
    }

    return jsonResponse({ error: `Action '${action}' tidak dikenali` }, 400);
  } catch (err: any) {
    console.error("ig-comment-action error:", err);
    return jsonResponse({ ok: false, error: err.message }, 500);
  }
});
