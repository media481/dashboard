/* ============================================================
   CLOUDFLARE WORKER — Merdeka / Taruna Inti
   ============================================================
   Sebelumnya situs ini murni static assets (tidak ada `main` di
   wrangler.jsonc). Worker ini ditambahkan untuk SATU alasan:
   mencabut bot token Telegram dari browser.

   Sebelum: js/04-event-settings.js memanggil
     https://api.telegram.org/bot${botToken}/sendMessage
   langsung dari klien, dengan botToken dibaca dari tabel
   kt_telegram_settings yang bisa dibaca anon. Siapa pun yang membuka
   DevTools bisa mengambil token dan mengambil alih bot.

   Sesudah: klien POST ke /api/telegram (same-origin, tanpa token).
   Worker memegang token sebagai secret, memverifikasi sesi login ke
   Supabase dulu, menerapkan rate limit, baru meneruskan ke Telegram.

   Semua request lain diteruskan ke static assets seperti biasa
   (env.ASSETS.fetch) — perilaku situs tidak berubah.

   SETUP SEKALI:
     npx wrangler secret put TELEGRAM_BOT_TOKEN
     npx wrangler secret put SUPABASE_URL
     npx wrangler secret put SUPABASE_ANON_KEY
   ============================================================ */

const RATE_LIMIT_MAX = 20;          // maksimum pesan
const RATE_LIMIT_WINDOW_MS = 60_000; // per 1 menit, per sesi

// Rate limit in-memory per isolate. Ini bukan penjaga yang sempurna
// (Cloudflare bisa punya banyak isolate), tapi cukup untuk mencegah
// satu klien yang bug/nakal membanjiri bot. Kalau nanti butuh yang
// benar-benar global, ganti dengan Durable Object atau KV.
const rateBuckets = new Map();

function rateLimited(key) {
  const now = Date.now();
  const hits = (rateBuckets.get(key) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (hits.length >= RATE_LIMIT_MAX) {
    rateBuckets.set(key, hits);
    return true;
  }
  hits.push(now);
  rateBuckets.set(key, hits);
  // Jaga Map tidak tumbuh tanpa batas di isolate yang berumur panjang.
  if (rateBuckets.size > 1000) {
    for (const [k, v] of rateBuckets) {
      if (!v.length || now - v[v.length - 1] > RATE_LIMIT_WINDOW_MS) rateBuckets.delete(k);
    }
  }
  return false;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/* Verifikasi token sesi ke Supabase lewat rpc_session_user.
   Worker tidak memegang service key — dia memanggil RPC yang sama
   seperti klien, jadi kalau sesi tidak valid Supabase sendiri yang
   menolak. Mengembalikan objek user atau null. */
async function verifySession(env, token) {
  if (!token) return null;
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/rpc_session_user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        'x-session-token': token,
      },
      body: '{}',
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  } catch (e) {
    console.error('verifySession gagal:', e);
    return null;
  }
}

async function handleTelegram(request, env) {
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }

  // Same-origin saja — tidak ada header CORS yang dikirim sama sekali,
  // jadi situs lain tidak bisa memakai endpoint ini sebagai relay.
  const origin = request.headers.get('Origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return json({ ok: false, error: 'Origin tidak diizinkan' }, 403);
  }

  if (!env.TELEGRAM_BOT_TOKEN) {
    return json({ ok: false, error: 'Bot token belum dikonfigurasi di server' }, 503);
  }

  const token = request.headers.get('x-session-token');
  const user = await verifySession(env, token);
  if (!user) {
    return json({ ok: false, error: 'Sesi tidak valid, silakan login ulang' }, 401);
  }

  if (rateLimited(token)) {
    return json({ ok: false, error: 'Terlalu banyak notifikasi, coba sebentar lagi' }, 429);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: 'Body bukan JSON yang valid' }, 400);
  }

  const chatId = String(payload.chat_id || '').trim();
  const text = String(payload.text || '');
  if (!chatId) return json({ ok: false, error: 'chat_id wajib diisi' }, 400);
  if (!text) return json({ ok: false, error: 'text wajib diisi' }, 400);
  // Batas Telegram sendiri 4096; potong di sini supaya tidak buang-buang
  // round-trip untuk pesan yang pasti ditolak.
  if (text.length > 4096) return json({ ok: false, error: 'Pesan terlalu panjang' }, 400);

  try {
    const tg = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
      }
    );
    const result = await tg.json();
    // Teruskan apa adanya (termasuk error_code 429 + parameters.retry_after)
    // supaya logika retry/backoff yang sudah ada di klien tetap bekerja —
    // tapi tanpa pernah menyentuh bot token.
    return json(result, tg.ok ? 200 : tg.status);
  } catch (e) {
    return json({ ok: false, error: 'Gagal menghubungi Telegram', detail: e.message }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/telegram') {
      return handleTelegram(request, env);
    }

    // Endpoint kesehatan untuk uptime monitor (lihat §13 audit).
    if (url.pathname === '/api/health') {
      return json({ ok: true, ts: new Date().toISOString() });
    }

    return env.ASSETS.fetch(request);
  },
};
