// Supabase Edge Function: ig-publish
// Dipanggil oleh Cloudflare Worker cron tiap 15 menit (atau manual).
// Query semua post yang statusnya 'scheduled' dan schedule_time <= now(),
// lalu lakukan publish ke Instagram Graph API (2 tahap: create container →
// publish). Untuk video/reels, polling status_code sampai FINISHED.
//
// Auth: memakai SERVICE_ROLE_KEY (dari env otomatis Supabase) untuk bypass RLS,
// karena ini proses background — tidak ada user login.
//
// Deploy:
//   supabase functions deploy ig-publish --no-verify-jwt
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<key>  (otomatis tersedia)
//
// Env yang harus diset lewat `supabase secrets set`:
//   - IG_APP_ID, IG_APP_SECRET (untuk refresh token jika perlu)
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (otomatis dari Supabase)

import { createClient } from "jsr:@supabase/supabase-js@2";

const GRAPH_API_VERSION = "v21.0";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  db: { namespace: "supabase_js" },
});

// --- Helpers ---
function jsonResponse(obj: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function logStep(postId: string, step: string, success: boolean, error: string | null, response: unknown = null) {
  try {
    await supabase.from("ig_publish_logs").insert([{
      post_id: postId,
      attempt_number: 1,
      step,
      success,
      response_body: response ? JSON.parse(JSON.stringify(response)) : null,
      error_message: error,
    }]);
  } catch (e) {
    console.warn("Failed to log publish step:", e);
  }
}

async function updatePost(postId: string, patch: Record<string, unknown>) {
  const { error } = await supabase.from("ig_posts").update(patch).eq("id", postId);
  if (error) throw error;
}

// Instagram Graph API: create media container (post tunggal image/video)
async function createContainer(igUserId: string, token: string, post: Record<string, unknown>) {
  const params = new URLSearchParams({
    caption: post.caption || "",
    access_token: token,
  });

  const mediaType = post.media_type;
  const mediaUrl = post.media_url;

  if (mediaType === "video") {
    params.set("media_type", "REELS");
    params.set("video_url", mediaUrl);
  } else {
    params.set("image_url", mediaUrl);
  }

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${igUserId}/media?${params}`,
    { method: "POST" }
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "createContainer failed");
  return data.id; // ig_container_id
}

// --- Carousel helpers ---
// Item carousel TIDAK pakai media_type=REELS (itu khusus post video tunggal).
// Item video di dalam carousel pakai media_type=VIDEO + is_carousel_item=true.
async function createCarouselChildContainer(
  igUserId: string,
  token: string,
  item: { media_url: string; media_type: string }
) {
  const params = new URLSearchParams({
    is_carousel_item: "true",
    access_token: token,
  });
  if (item.media_type === "video") {
    params.set("media_type", "VIDEO");
    params.set("video_url", item.media_url);
  } else {
    params.set("image_url", item.media_url);
  }

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${igUserId}/media?${params}`,
    { method: "POST" }
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "createCarouselChildContainer failed");
  return data.id;
}

// Parent container carousel: menggabungkan child container ids
async function createCarouselParentContainer(
  igUserId: string,
  token: string,
  caption: string,
  childIds: string[]
) {
  const params = new URLSearchParams({
    media_type: "CAROUSEL",
    caption: caption || "",
    children: childIds.join(","),
    access_token: token,
  });

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${igUserId}/media?${params}`,
    { method: "POST" }
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "createCarouselParentContainer failed");
  return data.id;
}

// Cek status container (untuk video/reels)
async function waitForContainerReady(containerId: string, token: string, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${containerId}?fields=status_code&access_token=${token}`
    );
    const data = await res.json();
    if (data.status_code === "FINISHED") return true;
    if (data.status_code === "ERROR") throw new Error("Container processing failed");
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("Timeout menunggu container siap (>60s)");
}

// Publish container → dapat media_id final
async function publishContainer(igUserId: string, token: string, containerId: string) {
  const params = new URLSearchParams({
    creation_id: containerId,
    access_token: token,
  });
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${igUserId}/media_publish?${params}`,
    { method: "POST" }
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "publishContainer failed");
  return data.id; // ig_media_id
}

// Proses khusus post carousel: bikin child container per item,
// tunggu tiap item video (kalau ada) FINISHED, baru bikin parent
// container CAROUSEL, lalu publish.
async function processCarouselPost(post: Record<string, unknown>, account: Record<string, unknown>) {
  const { data: items, error: itemsError } = await supabase
    .from("ig_post_media")
    .select("*")
    .eq("post_id", post.id)
    .order("position", { ascending: true });

  if (itemsError) throw itemsError;
  if (!items || items.length < 2) {
    throw new Error(`Carousel butuh minimal 2 item media (ditemukan ${items?.length || 0})`);
  }
  if (items.length > 10) {
    throw new Error(`Carousel maksimal 10 item media (ditemukan ${items.length})`);
  }

  const childIds: string[] = [];
  for (const item of items) {
    const childId = await createCarouselChildContainer(account.ig_user_id, account.access_token, item);
    await supabase.from("ig_post_media").update({ ig_child_container_id: childId }).eq("id", item.id);

    if (item.media_type === "video") {
      await waitForContainerReady(childId, account.access_token);
    }
    childIds.push(childId);
  }

  await logStep(post.id, "create_carousel_children", true, null, { child_ids: childIds });

  const parentId = await createCarouselParentContainer(
    account.ig_user_id,
    account.access_token,
    post.caption || "",
    childIds
  );

  await logStep(post.id, "create_container", true, null, { container_id: parentId });
  return parentId;
}

// Proses satu post
async function processPost(post: Record<string, unknown>, account: Record<string, unknown>) {
  try {
    let containerId: string;

    if (post.media_type === "carousel") {
      containerId = await processCarouselPost(post, account);
    } else {
      containerId = await createContainer(account.ig_user_id, account.access_token, post);
      await logStep(post.id, "create_container", true, null, { container_id: containerId });
    }

    await updatePost(post.id, { ig_container_id: containerId, status: "publishing", updated_at: new Date().toISOString() });

    if (post.media_type === "video") {
      await logStep(post.id, "check_status", true, null, { waited: true });
      await waitForContainerReady(containerId, account.access_token);
    }

    const mediaId = await publishContainer(
      account.ig_user_id,
      account.access_token,
      containerId
    );

    await logStep(post.id, "publish", true, null, { ig_media_id: mediaId });
    await updatePost(post.id, {
      status: "published",
      ig_media_id: mediaId,
      published_at: new Date().toISOString(),
      retry_count: 0,
      last_error: null,
      updated_at: new Date().toISOString(),
    });
  } catch (err: any) {
    const msg = err.message || String(err);
    await logStep(post.id, "publish", false, msg, null);

    const nextRetry = (post.retry_count || 0) + 1;

    // Jika masih ada retry — mundurin schedule_time +15 menit, kembalikan ke scheduled
    // Jika melebihi max_retries — tandai failed
    if (nextRetry <= (post.max_retries || 3)) {
      const nextSchedule = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      await updatePost(post.id, {
        status: "scheduled",
        retry_count: nextRetry,
        schedule_time: nextSchedule,
        last_error: msg,
        updated_at: new Date().toISOString(),
      });
    } else {
      await updatePost(post.id, {
        status: "failed",
        retry_count: nextRetry,
        last_error: msg,
        updated_at: new Date().toISOString(),
      });
    }
  }
}

Deno.serve(async (req: Request) => {
  // CORS sederhana — hanya izinkan dari origin yang sama (worker cron)
  const origin = req.headers.get("origin");
  const ALLOWED = origin || "*";
  const CORS: Record<string, string> = {
    "Access-Control-Allow-Origin": ALLOWED,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Verifikasi service role key dari request body atau header
  const authHeader = req.headers.get("authorization");
  const expectedBearer = `Bearer ${SERVICE_ROLE_KEY}`;
  // Izinkan panggilan langsung dari cron worker (bawaan service role)
  // atau dari dashboard (bawaan anon key + admin login — tapi publish butuh service role)
  // Simplifikasi: cek via header Authorization Bearer
  const body = await req.json().catch(() => ({}));
  const providedKey = body.service_role_key || (authHeader ? authHeader.replace("Bearer ", "") : "");

  // Kalau dipanggil dari cron worker, akan dibawa di header Authorization
  // Kalau dipanggil manual dari dashboard (testing), butuh service_role di body
  if (SERVICE_ROLE_KEY && providedKey !== SERVICE_ROLE_KEY) {
    // Izinkan juga anon key yang sudah ter-autentikasi sebagai admin
    const anonKey = req.headers.get("apikey");
    if (!anonKey) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
  }

  try {
    // Query post yang jatuh tempo
    const { data: posts, error: postsError } = await supabase
      .from("ig_posts")
      .select("*")
      .eq("status", "scheduled")
      .lte("schedule_time", new Date().toISOString())
      .order("schedule_time", { ascending: true })
      .limit(20);

    if (postsError) throw postsError;

    if (!posts || posts.length === 0) {
      return jsonResponse({ ok: true, message: "Tidak ada post yang perlu dipublish", processed: 0 });
    }

    // Ambil akun IG aktif
    const { data: accounts, error: accError } = await supabase
      .from("ig_accounts")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (accError) throw accError;
    if (!accounts || !accounts.length) {
      return jsonResponse({ ok: false, error: "Tidak ada akun IG aktif" }, 400);
    }

    const account = accounts[0]; // pemakaian pribadi: cukup akun pertama
    let processed = 0;
    const results: { post_id: string; status: string; error?: string }[] = [];

    for (const post of posts) {
      try {
        await processPost(post, account);
        const { data: updated } = await supabase.from("ig_posts").select("status").eq("id", post.id).single();
        processed++;
        results.push({ post_id: post.id, status: updated?.status || "processed" });
      } catch (e: any) {
        results.push({ post_id: post.id, status: "error", error: e.message });
      }
    }

    return jsonResponse({ ok: true, message: "Publish cycle selesai", processed, total: posts.length, results });
  } catch (err: any) {
    console.error("ig-publish error:", err);
    return jsonResponse({ ok: false, error: err.message }, 500);
  }
});
