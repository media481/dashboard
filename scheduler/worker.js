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
    // Dua cron di wrangler.toml: "*/15 * * * *" dan "0 9 * * 1". Setiap cron memicu
    // handler ini sendiri-sendiri, jadi bedakan lewat event.cron. Sebelumnya Senin 09:00
    // UTC memicu publish + sync DUA kali (kedua cron cocok), dan refresh token ikut
    // terpanggil di keempat tick 09:00/09:15/09:30/09:45.
    const call = async (name) => {
      try {
        const res = await fetch(`${env.SUPABASE_FUNCTIONS_URL}/${name}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({ service_role_key: env.SUPABASE_SERVICE_ROLE_KEY }),
        });
        if (!res.ok) {
          console.error(`[IG Scheduler] ${name} GAGAL: ${res.status} ${(await res.text()).slice(0, 300)}`);
        } else {
          console.log(`[IG Scheduler] ${name} OK: ${res.status}`);
        }
      } catch (err) {
        console.error(`[IG Scheduler] ${name} error jaringan:`, err);
      }
    };

    if (event.cron === "0 9 * * 1") {
      // Token refresh mingguan — cron terpisah, tidak ikut publish/sync
      await call("ig-refresh-token");
      return;
    }

    // Tiap 15 menit: publish dulu, baru sync komentar. Berurutan (bukan paralel) supaya
    // satu function tidak berebut waktu/rate limit Graph API dengan yang lain.
    await call("ig-publish");
    await call("ig-sync-comments");
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

    if (url.pathname === "/ig-sync-comments" || url.searchParams.get("action") === "sync-comments") {
      const res = await fetch(`${env.SUPABASE_FUNCTIONS_URL}/ig-sync-comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ service_role_key: env.SUPABASE_SERVICE_ROLE_KEY }),
      });
      const result = await res.json().catch(() => ({ status: res.status }));
      return new Response(JSON.stringify({ action: "sync-comments", ...result }), {
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
        "/ig-sync-comments": "Trigger sync komentar sekarang",
        "/ig-refresh": "Trigger token refresh sekarang",
        "scheduled": "Cron tiap 15 menit (publish + sync komentar) + Senin jam 9 (refresh)",
      },
    }), { headers: { "Content-Type": "application/json" } });
  },
};
