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
//   POST body: {
//     userMsg: string,        // ide/konsep mentah (WAJIB; awalan "KONSEP/IDE:" opsional)
//     tujuan?: "promo"|"storytelling"|"edukasi"|"testimoni"|"engagement"   (default "promo")
//     mediaType?: "image"|"video"|"carousel"                               (default "image")
//     hindari?: string        // caption hasil generate sebelumnya -> AI wajib ganti sudut & pembuka
//   }
//   Response: { text: string, warnings: string[], versi: 2 }
//     text     = caption final (sudah dirapikan: ejaan "Umroh", 5 hashtag, <= 2200 karakter)
//     warnings = angka di caption yang tidak ada di konsep (cek manual sebelum posting)
//
// Deploy (postprocess.ts ikut ter-bundle otomatis oleh CLI):
//   supabase functions deploy generate-ig-caption --no-verify-jwt

import { callGeminiWithFallback } from "../_shared/gemini.ts";
import { findUnknownNumbers, normalizeCaption } from "./postprocess.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GEMINI_MODEL = "gemini-3.5-flash";
const FALLBACK_MODELS = ["gemini-3.5-flash-lite"];
const RETRY_DELAYS_MS = [2500];
const MAX_INPUT_CHARS = 4000;

type Tujuan = "promo" | "storytelling" | "edukasi" | "testimoni" | "engagement";
type MediaType = "image" | "video" | "carousel";

const TUJUAN_GUIDE: Record<Tujuan, string> = {
  promo:
    "IKLAN/PROMO. Tonjolkan 1-2 hal paling menjual dari konsep (harga mulai dari, tanggal berangkat, fasilitas unggulan). Boleh ada urgensi HANYA kalau konsep menyebut kuota/seat terbatas — jangan mengarang kelangkaan. CTA tegas dan mudah dilakukan (chat WA/DM).",
  storytelling:
    "STORYTELLING. Bangun suasana & perasaan (rindu, tenang, haru) dari satu momen konkret. Jualan sangat halus; CTA ringan dan hangat. Tutup dengan satu kalimat doa sederhana dalam Bahasa Indonesia.",
  edukasi:
    "EDUKASI. Beri 1-3 poin praktis yang berguna dan layak disimpan (persiapan, manasik, kesalahan umum). CTA: ajak simpan/bagikan dan tanya di komentar atau WA.",
  testimoni:
    "BUKTI SOSIAL. Sorot pengalaman jamaah. JANGAN mengarang kutipan atau nama jamaah — kalau tidak ada di konsep, tulis placeholder [isi kutipan asli jamaah] dan [nama jamaah, kota].",
  engagement:
    "ENGAGEMENT. Ajukan satu pertanyaan/ajakan yang mudah dijawab di kolom komentar. Hampir tanpa jualan.",
};

const MEDIA_GUIDE: Record<MediaType, string> = {
  image: "Konten FOTO tunggal: hook harus bisa berdiri sendiri karena orang melihat gambarnya lebih dulu.",
  video:
    "Konten REELS/VIDEO: caption jadi pelengkap video. Hook SANGAT singkat (<= 10 kata) dan selaras dengan 3 detik pertama video; body lebih ringkas dari feed biasa.",
  carousel:
    "Konten CAROUSEL: hook memancing orang menggeser. Sebut ada beberapa slide/poin, dan akhiri CTA dengan ajakan simpan atau bagikan.",
};

function buildSystemPrompt(tujuan: Tujuan, mediaType: MediaType): string {
  return `Kamu adalah social media specialist & copywriter untuk biro umroh "Amiru Tour". Tugasmu mengubah ide/konsep mentah menjadi SATU caption Instagram siap posting dalam Bahasa Indonesia. Ini caption feed IG, BUKAN broadcast WhatsApp: santai, hangat, mengalir — bukan daftar fasilitas berformat kaku.

TUJUAN POST: ${TUJUAN_GUIDE[tujuan]}
FORMAT MEDIA: ${MEDIA_GUIDE[mediaType]}

STRUKTUR:
1. HOOK — 1 baris pembuka yang menahan scroll dalam 3 detik: momen konkret, pertanyaan, atau pernyataan yang dekat dengan pembaca. Jangan mulai dengan sapaan generik ("Halo sahabat", "Assalamualaikum") atau "Siapa yang ingin...".
2. BODY — 2-4 kalimat pendek, mengalir natural (bukan bullet panjang). Utamakan gambaran konkret (suasana, gerakan, perasaan) daripada klaim umum ala brosur. Sapa pembaca dengan "kamu".
3. CTA — 1 baris ajakan yang jelas dan spesifik. Kalau ada nomor WA di konsep, sebut ringkas; kalau tidak ada, JANGAN mengarang nomor — pakai "chat WA kami" atau "klik link di bio".
4. HASHTAG — blok terpisah di akhir (1 baris kosong sebelumnya), tepat 5 hashtag: #UmrohBersamaAmiru, #AmiruTour, ditambah 3 hashtag topikal yang relevan dengan konten. Tanpa spasi di dalam hashtag.

ATURAN ISI (WAJIB):
- Angka harga, tanggal, durasi, dan kuota disalin PERSIS dari konsep. JANGAN membulatkan, menghitung ulang, atau mengarang. Kalau data penting tidak ada di konsep, tulis placeholder seperti [tanggal], [harga], [nomor WA] — jangan ditebak.
- JANGAN mengarang fasilitas, nama hotel, maskapai, atau info yang tidak ada di konsep.
- JANGAN membuat janji berlebihan ("pasti mabrur", "dijamin berangkat", "seat pasti ada") dan JANGAN mengarang kutipan ayat, hadis, atau doa berbahasa Arab.
- Highlight cukup 1-2 poin paling menjual; jangan jadi daftar harga per kategori kamar.
- Ejaan selalu "Umroh" (bukan "Umrah"), termasuk di hashtag.
- Emoji secukupnya (maks 3-4 di seluruh caption).
- Panjang total termasuk hashtag: 500-900 karakter.

OUTPUT: HANYA teks caption final. Tanpa kalimat pembuka/penutup dari kamu, tanpa code fence, tanpa label seperti "Hook:" atau "CTA:".`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const userMsg = typeof body?.userMsg === "string" ? body.userMsg.trim() : "";
    if (!userMsg) return json({ error: "userMsg wajib diisi" }, 400);
    if (userMsg.length > MAX_INPUT_CHARS) {
      return json({ error: `Konsep terlalu panjang (maks ${MAX_INPUT_CHARS} karakter)` }, 400);
    }

    const tujuan: Tujuan = Object.hasOwn(TUJUAN_GUIDE, String(body?.tujuan)) ? body.tujuan : "promo";
    const mediaType: MediaType = Object.hasOwn(MEDIA_GUIDE, String(body?.mediaType)) ? body.mediaType : "image";
    const hindari = typeof body?.hindari === "string" ? body.hindari.trim().slice(0, 1500) : "";

    // Frontend lama mengirim awalan "KONSEP/IDE:" sendiri; yang baru mengirim teks mentah.
    let prompt = /^KONSEP\/IDE:/i.test(userMsg) ? userMsg : `KONSEP/IDE:\n${userMsg}`;
    if (hindari) {
      prompt += `\n\nCAPTION SEBELUMNYA (JANGAN diulang — buat hook, sudut pandang, dan kalimat pembuka yang benar-benar berbeda):\n${hindari}`;
    }

    const geminiData = await callGeminiWithFallback(
      GEMINI_MODEL,
      {
        system_instruction: { parts: [{ text: buildSystemPrompt(tujuan, mediaType) }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.85, topP: 0.95, maxOutputTokens: 4096 },
      },
      { fallbackModels: FALLBACK_MODELS, retryDelaysMs: RETRY_DELAYS_MS },
    );

    const parts = geminiData?.candidates?.[0]?.content?.parts || [];
    const raw = parts.map((p: { text?: string }) => p?.text || "").join("").trim();

    if (!raw) {
      const finishReason = geminiData?.candidates?.[0]?.finishReason;
      throw new Error(`Gemini tidak mengembalikan hasil teks.${finishReason ? ` (finishReason: ${finishReason})` : ""}`);
    }

    const text = normalizeCaption(raw);
    const warnings = findUnknownNumbers(userMsg, text).map(
      (n) => `Angka "${n}" ada di caption tapi tidak ada di konsep — cek sebelum posting`,
    );

    return json({ text, warnings, versi: 2 });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
