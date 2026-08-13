// Cloudflare Worker: IG Scheduler Cron
// Cron trigger tiap 15 menit — memicu Supabase Edge Function ig-publish
// untuk memproses semua post yang sudah jatuh tempo.
//
// Deploy ke Cloudflare Workers menggunakan Wrangler CLI:
//   cd scheduler
//   npm install -g wrangler  (jika belum)
//   wrangler deploy
//
// Env vars (set via wrangler secret atau dashboard):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_FUNCTIONS_URL
//
// wrangler.toml sudah mengkonfigurasi cron trigger "*/15 * * * *"
// yang memanggil handler scheduled() di bawah.
//
// Untuk token refresh (mingguan), gunakan cron terpisah:
//   gunakan Worker yang sama tapi panggil ig-refresh-token
//   atau buat Worker kedua. Di sini, kami panggil refresh
//   tiap Minggu (cron "0 9 * * 1" = Senin jam 9).

export default {
  async scheduled(event, env, ctx) {
    const now = new Date();

    // --- Token refresh: tiap Senin pukul 09:00 UTC ---
    // (hari ini adalah Senin & jam 9) → trigger refresh mingguan
    const isMonday9am = now.getUTCDay() === 1 && now.getUTCHours() === 9;

    // --- ig-publish: tiap 15 menit ---
    // Selalu jalankan publish cycle setiap tick 15 menit
    const publishRes = await fetch(`${env.SUPABASE_FUNCTIONS_URL}/ig-publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ service_role_key: env.SUPABASE_SERVICE_ROLE_KEY }),
    });

    console.log(`[IG Scheduler] ig-publish triggered: ${publishRes.status}`);

    if (isMonday9am && env.SUPABASE_SERVICE_ROLE_KEY) {
      const refreshRes = await fetch(`${env.SUPABASE_FUNCTIONS_URL}/ig-refresh-token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ service_role_key: env.SUPABASE_SERVICE_ROLE_KEY }),
      });
      console.log(`[IG Scheduler] ig-refresh-token triggered: ${refreshRes.status}`);
    }
  },

  // Handler untuk testing manual lewat HTTP (opsional)
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/ig-publish" || url.searchParams.get("action") === "publish") {
      const res = await fetch(`${env.SUPABASE_FUNCTIONS_URL}/ig-publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ service_role_key: env.SUPABASE_SERVICE_ROLE_KEY }),
      });
      const result = await res.json().catch(() => ({ status: res.status }));
      return new Response(JSON.stringify({ action: "publish", ...result }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/ig-refresh" || url.searchParams.get("action") === "refresh") {
      const res = await fetch(`${env.SUPABASE_FUNCTIONS_URL}/ig-refresh-token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ service_role_key: env.SUPABASE_SERVICE_ROLE_KEY }),
      });
      const result = await res.json().catch(() => ({ status: res.status }));
      return new Response(JSON.stringify({ action: "refresh", ...result }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      message: "IG Scheduler Worker",
      endpoints: {
        "/ig-publish": "Trigger publish cycle sekarang",
        "/ig-refresh": "Trigger token refresh sekarang",
        "scheduled": "Cron tiap 15 menit (publish) + Senin jam 9 (refresh)",
      },
    }), { headers: { "Content-Type": "application/json" } });
  },
};
