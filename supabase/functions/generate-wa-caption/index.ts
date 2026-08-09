// Supabase Edge Function: generate-wa-caption
// Menyusun caption WhatsApp promosi program umroh dari konsep mentah,
// dipanggil oleh js/app.js (generateCaptionAI) lewat tombol "Generate dengan AI".
// Pakai Gemini API (bukan Anthropic) supaya cukup 1 secret (GEMINI_API_KEY)
// yang dipakai bareng dengan scan-poster-ocr.
//
// KENAPA FUNGSI INI ADA (bug fix):
//   generateCaptionAI() sebelumnya fetch LANGSUNG ke https://api.anthropic.com
//   dari browser. Itu selalu gagal di luar sandbox artifact claude.ai:
//   browser tidak punya API key, dan api.anthropic.com tidak mengirim header
//   Access-Control-Allow-Origin untuk request dari domain lain (CORS block).
//   Fungsi ini memindahkan panggilan AI ke server (Edge Function), memakai
//   GEMINI_API_KEY yang disimpan sebagai secret, lalu meneruskan hasilnya ke
//   browser dengan header CORS yang benar. Pola ini sama persis dengan
//   scan-poster-ocr yang sudah lebih dulu ada di project ini.
//
// Kontrak (dipakai oleh js/app.js -> generateCaptionAI):
//   POST body: { userMsg: string }
//   Response : { text: string }
//
// Env var yang wajib di-set (kalau belum pernah di-set untuk scan-poster-ocr):
//   supabase secrets set GEMINI_API_KEY=xxxxx
//   (ambil gratis di https://aistudio.google.com/apikey)
//
// Deploy:
//   supabase functions deploy generate-wa-caption --no-verify-jwt

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
// Pakai "gemini-3.5-flash" (bukan flash-lite) karena ini tugas copywriting
// kreatif (menyusun kalimat, pilih emoji relevan, memadatkan teks) yang
// hasilnya lebih baik di model non-lite, beda dengan scan-poster-ocr yang
// murni ekstraksi terstruktur.
const GEMINI_MODEL = "gemini-3.5-flash";
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Sama persis dengan WA_CAPTION_SYSTEM_PROMPT yang dulu ada di js/app.js —
// dipindah ke sini supaya API key tidak perlu lewat browser sama sekali.
const WA_CAPTION_SYSTEM_PROMPT = `Kamu adalah copywriter marketing untuk biro umroh "Amiru Tour". Tugasmu mengubah catatan kasar/konsep program dari direktur menjadi SATU caption WhatsApp siap kirim dalam Bahasa Indonesia, mengikuti pola format berikut secara konsisten (struktur section, gaya bullet/emoji), dengan isi yang disesuaikan sepenuhnya dari konsep yang diberikan user:

CONTOH POLA YANG HARUS DIIKUTI STRUKTURNYA:
🕋 [JUDUL PROGRAM DENGAN EMOJI RELEVAN] 🕋
📅 [Durasi] Hari: [Tanggal mulai] – [Tanggal selesai]
[1-2 kalimat pembuka yang menarik, spesifik ke keunikan program ini — bukan kalimat generik]

✈️ Fasilitas:
✅ [Maskapai]
✅ [Transportasi/kereta jika ada]
✅ Hotel Madinah: [nama hotel] [bintang] ([durasi malam])
✅ Hotel Makkah: [nama hotel] [bintang] ([durasi malam])
✅ [fasilitas unik lain jika ada di konsep, misal city tour, tabligh akbar, dst]

💰 Biaya Program:
[Tulis tiap kategori/paket harga sesuai input, dengan format rapi per kategori kamar: Quad/Quint, Triple, Double, dst. Jika ada beberapa paket (misal upgrade hotel), buat sub-section terpisah]

✅ Termasuk:
- [list sesuai input]

❌ Tidak Termasuk:
- [list sesuai input]

📞 Info & Itinerary:
[nomor WA yang diberikan, masing-masing di baris sendiri]

ATURAN KETAT:
1. JANGAN mengubah, membulatkan, atau mengarang ulang angka harga maupun tanggal — salin persis dari input.
2. JANGAN menambahkan section atau fasilitas yang tidak disebutkan di konsep (misal jangan mengada-adakan upgrade hotel kalau tidak ada di input).
3. Pilih emoji header dan emoji fasilitas yang relevan dengan tema spesifik program ini (city tour, tabligh akbar, Al Ula, dst), jangan asal tempel emoji.
4. Kalimat pembuka harus terasa ditulis khusus untuk program ini, bukan template kosong seperti "kesempatan langka beribadah di tanah suci" jika tidak relevan dengan isi konsep.
5. Jika konsep tidak menyebutkan info tertentu (misal tidak ada kereta cepat), jangan ditulis sama sekali.
6. Output HANYA berupa teks caption final. JANGAN ada kalimat pembuka/penutup dari kamu, JANGAN ada markdown code fence, JANGAN ada penjelasan tambahan.
7. Selalu gunakan ejaan "Umroh" (bukan "Umrah") di seluruh teks caption, walau konsep/input dari user memakai ejaan "Umrah".

ATURAN PANJANG TEKS (PALING PENTING):
WhatsApp memotong tampilan caption gambar di sekitar 1024 karakter. Target panjang caption final HARUS di bawah 900 karakter total, TANPA menghilangkan satu pun poin penting (tanggal, harga per kategori kamar, hotel, termasuk/tidak termasuk, kontak). Caranya memadatkan, bukan memotong info:
- Kalimat pembuka maksimal 1 kalimat pendek (bukan 2), langsung ke poin unik program — atau dihilangkan total jika konsep tidak punya elemen unik untuk dipromosikan.
- Setiap baris fasilitas/hotel/termasuk/tidak termasuk: 1 baris singkat, hindari kata sambung dan keterangan berulang (misal jarak hotel cukup "350m dari Masjid Nabawi", tidak perlu ditambah "menit jalan kaki" kalau sudah jelas).
- Gabungkan info yang searah jadi satu baris kalau memungkinkan, tanpa membuat baris jadi terlalu panjang.
- List "Termasuk"/"Tidak Termasuk": gunakan kata kunci singkat per poin (3-6 kata), bukan kalimat lengkap.
- Jangan ulangi info yang sudah disebut di bagian lain (misal nama program tidak perlu disebut ulang di body).
- Spasi/baris kosong antar section tetap dipertahankan secukupnya untuk keterbacaan, tapi jangan ada baris kosong ganda.
- Setelah menyusun draft di kepalamu, cek ulang: kalau masih di atas 900 karakter, padatkan lagi kalimat pembuka dan baris fasilitas terlebih dahulu sebelum menyentuh data harga/tanggal/kontak (data ini tidak boleh disingkat atau dihapus).`;

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
    const { userMsg } = await req.json();
    if (!userMsg || typeof userMsg !== "string") {
      return new Response(JSON.stringify({ error: "userMsg wajib diisi" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const geminiRes = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: WA_CAPTION_SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: userMsg }] }],
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      throw new Error(`Gemini API error (${geminiRes.status}): ${errText.slice(0, 300)}`);
    }

    const geminiData = await geminiRes.json();
    // Gabungkan semua part teks (bukan cuma parts[0]) — sama seperti di
    // scan-poster-ocr, model kadang mengembalikan lebih dari satu part.
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
