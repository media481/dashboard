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

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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
  const mimeType = res.headers.get("content-type") || "image/jpeg";
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

  if (!GEMINI_API_KEY) {
    return new Response(
      JSON.stringify({ error: "GEMINI_API_KEY belum di-set di Supabase secrets" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
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

    const geminiRes = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: EXTRACTION_PROMPT },
              { inline_data: { mime_type: mimeType, data: base64Image } },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      throw new Error(`Gemini API error (${geminiRes.status}): ${errText.slice(0, 300)}`);
    }

    const geminiData = await geminiRes.json();
    const textOut = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textOut) throw new Error("Gemini tidak mengembalikan hasil bacaan.");

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
