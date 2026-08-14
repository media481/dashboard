// Supabase Edge Function: ig-sync-comments
// Ditambahkan sebagai bagian dari IG Scheduler — memaksimalkan fitur GRATIS
// Instagram Graph API (permission instagram_manage_comments, tidak ada
// biaya per-call dari Meta) yang belum dipakai sebelumnya (sebelumnya cuma
// content publishing).
//
// Tugas:
//   1. Ambil komentar terbaru untuk tiap post yang sudah published (30 hari
//      terakhir) via GET /{ig-media-id}/comments.
//   2. Simpan/refresh ke tabel ig_comments (lihat sql/tambah_ig_comments.sql).
//   3. Kirim notifikasi Telegram untuk komentar BARU (reuse tabel tg_config
//      yang sudah dipakai fitur notifikasi program/jadwal — tinggal tambah
//      tipe 'ig_comment' di checkbox recipient).
//
// Dipanggil oleh Cloudflare Worker cron (bareng ig-publish, tiap 15 menit)
// ATAU manual dari tombol "Sync Komentar" di dashboard.
//
// Deploy:
//   supabase functions deploy ig-sync-comments --no-verify-jwt
//
// [KEAMANAN] Auth di sini TIDAK memakai fallback header `apikey` seperti
// ig-publish/ig-refresh-token versi awal (itu bug — apikey selalu ikut di
// tiap request Supabase client sehingga fallback itu efektif tidak memblokir
// siapa pun). Di sini hanya 2 jalur yang diterima:
//   a) Bearer = SERVICE_ROLE_KEY persis (dipanggil oleh cron worker)
//   b) Bearer = JWT user yang valid & sudah login (dipanggil manual dari dashboard)
// Sebaiknya pola yang sama diterapkan juga ke ig-publish & ig-refresh-token.

import { createClient } from "jsr:@supabase/supabase-js@2";

const GRAPH_API_VERSION = "v21.0";
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

async function isAuthorized(req: Request, body: Record<string, unknown>): Promise<boolean> {
  const authHeader = req.headers.get("authorization");
  const providedKey = body.service_role_key || (authHeader ? authHeader.replace("Bearer ", "") : "");

  // Jalur 1: dipanggil cron worker (service role key persis)
  if (SERVICE_ROLE_KEY && providedKey === SERVICE_ROLE_KEY) return true;

  // Jalur 2: dipanggil dashboard (JWT user yang login)
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    const { data, error } = await supabase.auth.getUser(token);
    if (!error && data?.user) return true;
  }
  return false;
}

// Ambil semua komentar (termasuk replies bertingkat 1 level) untuk 1 media
async function fetchCommentsForMedia(igMediaId: string, token: string) {
  const fields = "id,text,timestamp,username,like_count,replies{id,text,timestamp,username,like_count}";
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${igMediaId}/comments?fields=${fields}&access_token=${token}`
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || `Gagal ambil komentar media ${igMediaId}`);
  return data.data || [];
}

async function notifyTelegramNewComments(items: { username: string; text: string; postCaption: string }[]) {
  if (!items.length) return;
  try {
    const { data: cfgRows } = await supabase.from("tg_config").select("key, value");
    if (!cfgRows || !cfgRows.length) return;
    const cfg: Record<string, any> = {};
    for (const row of cfgRows) {
      try { cfg[row.key] = JSON.parse(row.value); } catch { cfg[row.key] = row.value; }
    }
    if (!cfg.botToken) return;
    const recipients: any[] = typeof cfg.recipients === "string" ? JSON.parse(cfg.recipients) : (cfg.recipients || []);
    const targets = recipients.filter((r) => (r.types || []).includes("ig_comment"));
    if (!targets.length) return;

    for (const item of items) {
      const message =
        `💬 <b>Komentar baru di IG</b>\n\n` +
        `👤 <b>${item.username || "seseorang"}</b>: ${item.text}\n\n` +
        `📌 Post: <i>${(item.postCaption || "(tanpa caption)").slice(0, 80)}</i>\n\n` +
        `Balas dari tab IG Scheduler di dashboard.`;

      for (const target of targets) {
        try {
          await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: target.chatId, text: message, parse_mode: "HTML", disable_web_page_preview: true }),
          });
        } catch (e) {
          console.warn("Gagal kirim notif telegram komentar:", e);
        }
      }
    }
  } catch (e) {
    console.warn("notifyTelegramNewComments error:", e);
  }
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

  const body = await req.json().catch(() => ({}));
  if (!(await isAuthorized(req, body))) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  try {
    // Akun IG aktif (butuh access_token untuk panggil Graph API)
    const { data: accounts } = await supabase.from("ig_accounts").select("*").eq("is_active", true).limit(1);
    if (!accounts || !accounts.length) {
      return jsonResponse({ ok: false, error: "Tidak ada akun IG aktif" }, 400);
    }
    const token = accounts[0].access_token;

    // Post published dalam 30 hari terakhir (hindari sync post lawas terus-menerus)
    const { data: posts, error: postsErr } = await supabase
      .from("ig_posts")
      .select("id, caption, ig_media_id, published_at")
      .eq("status", "published")
      .not("ig_media_id", "is", null)
      .gte("published_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .order("published_at", { ascending: false })
      .limit(50);

    if (postsErr) throw postsErr;
    if (!posts || !posts.length) {
      return jsonResponse({ ok: true, message: "Tidak ada post published untuk disinkron", synced: 0 });
    }

    let totalSynced = 0;
    const newForNotify: { username: string; text: string; postCaption: string }[] = [];

    for (const post of posts) {
      let comments;
      try {
        comments = await fetchCommentsForMedia(post.ig_media_id, token);
      } catch (e: any) {
        console.warn(`Skip media ${post.ig_media_id}:`, e.message);
        continue;
      }
      if (!comments.length) continue;

      // Kumpulkan semua id (top-level + reply) supaya tahu mana yang benar-benar baru
      const flatRows: Record<string, unknown>[] = [];
      for (const c of comments) {
        const hasReply = Array.isArray(c.replies?.data) && c.replies.data.length > 0;
        flatRows.push({
          post_id: post.id,
          ig_media_id: post.ig_media_id,
          ig_comment_id: c.id,
          parent_ig_comment_id: null,
          username: c.username || null,
          comment_text: c.text || "",
          like_count: c.like_count || 0,
          commented_at: c.timestamp || null,
          is_our_reply: false,
          replied: hasReply,
          synced_at: new Date().toISOString(),
        });
        for (const r of c.replies?.data || []) {
          flatRows.push({
            post_id: post.id,
            ig_media_id: post.ig_media_id,
            ig_comment_id: r.id,
            parent_ig_comment_id: c.id,
            username: r.username || null,
            comment_text: r.text || "",
            like_count: r.like_count || 0,
            commented_at: r.timestamp || null,
            is_our_reply: true, // asumsi: balasan di bawah komentar adalah balasan akun kita
            replied: true,
            synced_at: new Date().toISOString(),
          });
        }
      }

      const ids = flatRows.map((r) => r.ig_comment_id as string);
      const { data: existing } = await supabase.from("ig_comments").select("ig_comment_id").in("ig_comment_id", ids);
      const existingIds = new Set((existing || []).map((e: any) => e.ig_comment_id));
      const newRows = flatRows.filter((r) => !existingIds.has(r.ig_comment_id as string));

      const { error: upsertErr } = await supabase
        .from("ig_comments")
        .upsert(flatRows, { onConflict: "ig_comment_id" });
      if (upsertErr) {
        console.warn(`Gagal upsert komentar media ${post.ig_media_id}:`, upsertErr.message);
        continue;
      }
      totalSynced += flatRows.length;

      for (const row of newRows) {
        if (!row.is_our_reply && !existingIds.has(row.ig_comment_id as string)) {
          newForNotify.push({
            username: (row.username as string) || "",
            text: (row.comment_text as string) || "",
            postCaption: post.caption || "",
          });
        }
      }
    }

    if (newForNotify.length) {
      await notifyTelegramNewComments(newForNotify);
    }

    return jsonResponse({ ok: true, message: "Sync komentar selesai", synced: totalSynced, new_comments: newForNotify.length });
  } catch (err: any) {
    console.error("ig-sync-comments error:", err);
    return jsonResponse({ ok: false, error: err.message }, 500);
  }
});
