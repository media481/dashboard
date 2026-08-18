// Supabase Edge Function: generate-ig-caption
// Menyusun caption Instagram (feed post/carousel/reels) dari ide/konsep
// singkat, dipanggil oleh js/app.js (generateIgCaptionAI) lewat tombol
// "Generate dengan AI" di modal IG Scheduler.
//
// Sengaja dipisah dari generate-wa-caption: gaya IG beda total dari
// broadcast WA — pendek, hook di baris pertama, nada santai untuk feed,
// diakhiri hashtag — bukan daftar fasilitas/harga yang panjang & formal.
// Pakai Gemini API, secret GEMINI_API_KEY yang sama dengan
// generate-wa-caption & scan-poster-ocr (tidak perlu secret baru).
//
// Kontrak (dipakai oleh js/app.js -> generateIgCaptionAI):
//   POST body: { userMsg: string }
//   Response : { text: string }
//
// Deploy:
//   supabase functions deploy generate-ig-caption --no-verify-jwt

import { callGeminiWithFallback } from "../_shared/gemini.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GEMINI_MODEL = "gemini-3.5-flash";

const IG_CAPTION_SYSTEM_PROMPT = `Kamu adalah social media specialist untuk biro umroh "Amiru Tour". Tugasmu mengubah ide/konsep mentah menjadi SATU caption Instagram siap posting dalam Bahasa Indonesia, untuk feed post/carousel/reels — BUKAN broadcast WhatsApp, jadi gayanya harus terasa beda: santai, hangat, mengalir seperti caption IG asli, bukan daftar fasilitas berformat kaku.

STRUKTUR YANG HARUS DIIKUTI:
1. HOOK — 1 baris pembuka yang menarik perhatian dalam 3 detik pertama (pertanyaan, ajakan, atau pernyataan yang related ke pembaca). Boleh pakai 1 emoji relevan di awal atau akhir hook.
2. BODY — 2-4 kalimat pendek yang mengalir natural (bukan bullet list panjang), menonjolkan 1-2 hal paling menarik dari konsep (misal: harga mulai dari, tanggal keberangkatan, fasilitas unggulan, atau momen spesial). Boleh sisipkan emoji sewajarnya, jangan berlebihan.
3. CTA — 1 baris ajakan bertindak yang jelas (contoh: "DM/WA kami sekarang buat info lengkap & kuota" atau "Klik link di bio buat detail paketnya"). Kalau ada nomor WA di konsep, boleh disebut di sini secara ringkas.
4. HASHTAG — di baris/blok terpisah setelah CTA (dipisah 1 baris kosong), MAKSIMAL 5 hashtag relevan campuran: nama/brand ("#AmiruTour"), niche umroh ("#UmrohMurah #TravelUmroh #UmrohSemarang" dst sesuaikan kalau ada info lokasi), dan umum ("#UmrohIndonesia #WisataReligi"). Jangan lebih dari 5. Tanpa spasi di dalam tiap hashtag, dipisah spasi antar hashtag.

ATURAN ISI:
- JANGAN mengubah, membulatkan, atau mengarang angka harga maupun tanggal — salin persis dari konsep kalau disebutkan.
- JANGAN membuat caption jadi daftar fasilitas/harga per kategori kamar yang lengkap seperti broadcast WA — itu bukan gaya IG. Cukup highlight 1-2 poin paling menjual.
- JANGAN mengarang fasilitas/info yang tidak ada di konsep.
- Selalu gunakan ejaan "Umroh" (bukan "Umrah"), walau konsep memakai ejaan lain.
- Total panjang caption (termasuk hashtag) target 500-900 karakter — cukup pendek untuk feed IG, jangan sepanjang broadcast WA.
- Output HANYA berupa teks caption final siap post. JANGAN ada kalimat pembuka/penutup dari kamu, JANGAN ada markdown code fence, JANGAN ada label seperti "Hook:" atau "CTA:" di output — langsung teks captionnya saja.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    const { userMsg } = await req.json();
    if (!userMsg || typeof userMsg !== "string") {
      return new Response(JSON.stringify({ error: "userMsg wajib diisi" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const geminiData = await callGeminiWithFallback(GEMINI_MODEL, {
      system_instruction: { parts: [{ text: IG_CAPTION_SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: userMsg }] }],
    });

    const parts = geminiData?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p: { text?: string }) => p?.text || "").join("").trim();

    if (!text) {
      const finishReason = geminiData?.candidates?.[0]?.finishReason;
      throw new Error(`Gemini tidak mengembalikan hasil teks.${finishReason ? ` (finishReason: ${finishReason})` : ""}`);
    }

    return new Response(JSON.stringify({ text }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
