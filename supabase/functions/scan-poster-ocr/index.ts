// Supabase Edge Function: scan-poster-ocr
// Membaca gambar poster program umroh lalu mengekstrak data terstruktur
// memakai Gemini Vision, dipanggil otomatis oleh js/app.js (cxRunOcr)
// setiap kali program dengan link_poster disimpan.
//
// Kontrak (dipakai oleh js/app.js -> cxRunOcr):
//   POST body: { imageUrl }
//   Response : { fields: { nama, tgl, durasi, maskapai, harga_quint,
//                           harga_quad, harga_triple, harga_double,
//                           hotel_makkah, hotel_madinah }, raw_text }
//
// Env var yang wajib di-set (supabase secrets set GEMINI_API_KEY=...):
//   GEMINI_API_KEY  -> API key dari https://aistudio.google.com/apikey
//
// Deploy:
//   supabase functions deploy scan-poster-ocr --no-verify-jwt
//   supabase secrets set GEMINI_API_KEY=xxxxx

import { callGeminiWithFallback } from "../_shared/gemini.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// [FIX] "gemini-2.0-flash" resmi di-shutdown Google per 1 Juni 2026 (lihat
// https://ai.google.dev/gemini-api/docs/models/gemini-2.0-flash) — setiap
// request ke model ini akan gagal (404/error). Diganti ke "gemini-3.5-flash-lite",
// model GA (stable) termurah & tercepat di keluarga 3.x, cocok untuk tugas
// ekstraksi terstruktur seperti OCR poster ini.
const GEMINI_MODEL = "gemini-3.5-flash-lite";

const EXTRACTION_PROMPT = `Kamu membaca poster promosi program umroh/haji berbahasa Indonesia.
Baca seluruh teks pada gambar, lalu kembalikan HANYA JSON valid (tanpa markdown, tanpa penjelasan)
dengan struktur persis seperti ini:

{
  "fields": {
    "nama": "",
    "tgl": "",
    "durasi": "",
    "maskapai": "",
    "harga_quint": "",
    "harga_quad": "",
    "harga_triple": "",
    "harga_double": "",
    "hotel_makkah": "",
    "hotel_madinah": ""
  },
  "raw_text": ""
}

Ketentuan:
- "nama": nama program/paket (contoh: "Umroh Reguler Plus Turki").
- "tgl": tanggal keberangkatan apa adanya seperti tertulis di poster.
- "durasi": jumlah hari, format "X Hari".
- "maskapai": nama maskapai penerbangan.
- "harga_*": harga per tipe kamar, format "Rp 00.000.000". Kosongkan jika tipe kamar itu tidak tercantum.
- "hotel_makkah" / "hotel_madinah": nama hotel di kota tersebut.
- "raw_text": seluruh teks yang berhasil dibaca dari poster apa adanya (untuk arsip).
- Jika suatu field tidak ditemukan di poster, kosongkan string-nya ("").
- Jangan mengarang data yang tidak ada di gambar.`;

async function fetchImageAsBase64(imageUrl: string): Promise<{ data: string; mimeType: string }> {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Gagal mengambil gambar poster (status ${res.status})`);
  const mimeType = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
  // [FIX] Validasi: kalau URL poster ternyata bukan gambar langsung (mis. link Google
  // Drive/halaman web yang belum di-resolve ke direct link), fetch di atas akan sukses
  // (200 OK) tapi isinya HTML, bukan gambar — dan Gemini akan gagal/salah baca tanpa
  // pesan error yang jelas. Ketahuan lebih awal di sini supaya pesannya jelas.
  if (!mimeType.startsWith("image/")) {
    throw new Error(
      `URL poster tidak mengarah ke file gambar langsung (content-type: ${mimeType}). ` +
      `Pastikan link poster berupa direct image link, bukan link halaman/viewer.`,
    );
  }
  const buffer = new Uint8Array(await res.arrayBuffer());
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < buffer.length; i += chunkSize) {
    binary += String.fromCharCode(...buffer.subarray(i, i + chunkSize));
  }
  return { data: btoa(binary), mimeType };
}

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
    const { imageUrl } = await req.json();
    if (!imageUrl) {
      return new Response(JSON.stringify({ error: "imageUrl wajib diisi" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const { data: base64Image, mimeType } = await fetchImageAsBase64(imageUrl);

    const geminiData = await callGeminiWithFallback(GEMINI_MODEL, {
      contents: [
        {
          parts: [
            { text: EXTRACTION_PROMPT },
            { inline_data: { mime_type: mimeType, data: base64Image } },
          ],
        },
      ],
      generationConfig: {
        // [FIX] "temperature"/"top_p"/"top_k" sudah deprecated untuk model
        // keluarga Gemini 3.x (gemini-3.5-flash-lite) — cukup andalkan default
        // model untuk task ekstraksi. responseMimeType tetap dipakai supaya
        // output selalu berupa JSON valid tanpa perlu strip markdown fences.
        responseMimeType: "application/json",
      },
    });

    // [FIX] Gabungkan semua part teks (bukan cuma ambil parts[0]) — model keluarga
    // Gemini 3.x kadang mengembalikan lebih dari satu part (mis. bila thinking
    // level tidak minimal), jadi ambil part[0] saja bisa memotong hasil JSON.
    const parts = geminiData?.candidates?.[0]?.content?.parts || [];
    const textOut = parts.map((p: { text?: string }) => p?.text || "").join("").trim();
    if (!textOut) {
      const finishReason = geminiData?.candidates?.[0]?.finishReason;
      throw new Error(`Gemini tidak mengembalikan hasil bacaan.${finishReason ? ` (finishReason: ${finishReason})` : ""}`);
    }

    let parsed: { fields?: Record<string, string>; raw_text?: string };
    try {
      parsed = JSON.parse(textOut);
    } catch {
      throw new Error("Respons Gemini bukan JSON valid.");
    }

    if (!parsed.fields) throw new Error("Struktur respons Gemini tidak sesuai (field 'fields' hilang).");

    return new Response(
      JSON.stringify({ fields: parsed.fields, raw_text: parsed.raw_text || "" }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
