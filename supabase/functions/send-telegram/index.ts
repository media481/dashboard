// Supabase Edge Function: send-telegram
// Menerima request dari js/app.js (sendTelegramNotif) dan meneruskannya
// ke Telegram Bot API. Dibuat sebagai proxy karena Telegram API tidak
// mengizinkan panggilan langsung dari browser (tidak ada CORS).
//
// Kontrak (dipakai oleh js/app.js -> sendTelegramNotif):
//   POST body: { bot_token, chat_id, message, parse_mode }
//   Response : { ok: boolean, description?: string, ... } (diteruskan apa adanya dari Telegram)
//
// Deploy:
//   supabase functions deploy send-telegram --no-verify-jwt

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
    const { bot_token, chat_id, message, parse_mode } = await req.json();

    if (!bot_token || !chat_id || !message) {
      return new Response(
        JSON.stringify({ ok: false, description: "bot_token, chat_id, dan message wajib diisi" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    const tgRes = await fetch(`https://api.telegram.org/bot${bot_token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id,
        text: message,
        parse_mode: parse_mode || "HTML",
        disable_web_page_preview: true,
      }),
    });

    const tgResult = await tgRes.json();

    return new Response(JSON.stringify(tgResult), {
      status: tgRes.ok ? 200 : 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, description: String(err?.message || err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
