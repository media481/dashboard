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

import { callGeminiWithFallback } from "../_shared/gemini.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Pakai "gemini-3.5-flash" (bukan flash-lite) karena ini tugas copywriting
// kreatif (menyusun kalimat, pilih emoji relevan, memadatkan teks) yang
// hasilnya lebih baik di model non-lite, beda dengan scan-poster-ocr yang
// murni ekstraksi terstruktur.
const GEMINI_MODEL = "gemini-3.5-flash";

// Sama persis dengan WA_CAPTION_SYSTEM_PROMPT yang dulu ada di js/app.js —
// dipindah ke sini supaya API key tidak perlu lewat browser sama sekali.
const WA_CAPTION_SYSTEM_PROMPT = `Kamu adalah copywriter marketing untuk biro umroh "Amiru Tour". Tugasmu mengubah catatan kasar/konsep program dari direktur menjadi SATU caption WhatsApp siap kirim dalam Bahasa Indonesia, mengikuti pola format berikut PERSIS — termasuk baris kosong pemisah antar section dan tanda bintang tebal di judul, KEDUANYA WAJIB ada di output, bukan sekadar contoh visual — dengan isi yang disesuaikan sepenuhnya dari konsep yang diberikan user:

CONTOH POLA YANG HARUS DIIKUTI PERSIS (termasuk baris kosongnya):
🕋 *[JUDUL PROGRAM]* 🕋
📅 [Durasi] Hari: [Tanggal keberangkatan] (kalau konsep juga menyebutkan tanggal pulang, tulis rentangnya: [Tanggal mulai] – [Tanggal selesai])
[1 kalimat pembuka singkat yang menarik, spesifik ke keunikan program ini — bukan kalimat generik]

✈️ Fasilitas:
✅ [Maskapai, boleh ditambah keterangan singkat seperti "Landing Madinah" kalau relevan]
✅ [Transportasi/kereta cepat jika ada di konsep]
✅ Hotel Madinah: [nama hotel] [bintang/setaraf] ([durasi] malam, [jarak]m [estimasi menit] menit jalan kaki)
✅ Hotel Makkah: [nama hotel] [bintang/setaraf] ([durasi] malam, [jarak]m [estimasi menit] menit jalan kaki)
✅ [fasilitas unik lain jika ada di konsep, misal city tour, tabligh akbar, dst]

💰 Biaya Program:
* [Kategori kamar, misal Quad]: Rp [nominal]
* [Kategori kamar berikutnya, misal Triple]: Rp [nominal]
* [Kategori kamar berikutnya, misal Double]: Rp [nominal]
(satu baris "* [Kategori]: Rp [nominal]" per kategori kamar sesuai input — Quad/Quint, Triple, Double, dst. Jika ada beberapa paket, misal upgrade hotel, buat sub-section terpisah dengan pola yang sama)

✅ Termasuk:
- [list sesuai input, satu poin per baris]

❌ Tidak Termasuk:
- [list sesuai input, satu poin per baris]

📞 Info & Itinerary:
[nomor WA yang diberikan, masing-masing di baris sendiri]

ATURAN FORMAT WAJIB (paling sering dilanggar, cek dua kali sebelum menjawab):
1. Judul program SELALU diapit tanda bintang tunggal persis seperti "*JUDUL*" di antara emoji 🕋🕋 — JANGAN pernah menghilangkan tanda bintangnya, tanda bintang ini BUKAN markdown yang perlu dibersihkan, ini karakter literal yang membuat teks tebal di WhatsApp dan wajib ada di output final.
2. HARUS ada TEPAT SATU baris kosong (baris benar-benar kosong, bukan spasi) sebagai pemisah, di posisi berikut — jangan sampai section-section ini menempel tanpa jarak:
   - setelah kalimat pembuka (sebelum "✈️ Fasilitas:")
   - setelah baris terakhir Fasilitas (sebelum "💰 Biaya Program:")
   - setelah baris harga terakhir (sebelum "✅ Termasuk:")
   - setelah poin terakhir Termasuk (sebelum "❌ Tidak Termasuk:")
   - setelah poin terakhir Tidak Termasuk (sebelum "📞 Info & Itinerary:")
3. Baris "💰 Biaya Program:" SELALU pakai bullet tanda bintang ("* Kategori: Rp ..."), bukan tanda lain.

ATURAN ISI:
4. JANGAN mengubah, membulatkan, atau mengarang ulang angka harga, jarak, maupun tanggal — salin persis dari input.
5. JANGAN menambahkan section atau fasilitas yang tidak disebutkan di konsep (misal jangan mengada-adakan upgrade hotel atau estimasi jarak/waktu jalan kaki kalau tidak ada di input).
6. Kalimat pembuka harus terasa ditulis khusus untuk program ini, bukan template kosong seperti "kesempatan langka beribadah di tanah suci" jika tidak relevan dengan isi konsep.
7. Jika konsep tidak menyebutkan info tertentu (misal tidak ada kereta cepat, atau jarak hotel tidak disebutkan), jangan ditulis sama sekali — jangan mengarang.
8. Kalimat disclaimer umum seperti "biaya dan jadwal sewaktu-waktu dapat berubah mengikuti ketentuan Saudi/Maskapai/kurs Dolar-Riyal" BUKAN poin "Tidak Termasuk" — itu catatan kebijakan, bukan item yang dikecualikan dari harga. Jika kalimat semacam ini ada di konsep, JANGAN dimasukkan ke list Tidak Termasuk maupun ke bagian mana pun di caption; abaikan saja dari output caption (catatan itu urusan internal admin, bukan konsumsi publik).
9. Output HANYA berupa teks caption final. JANGAN ada kalimat pembuka/penutup dari kamu, JANGAN ada markdown code fence, JANGAN ada penjelasan tambahan.
10. Selalu gunakan ejaan "Umroh" (bukan "Umrah") di seluruh teks caption, walau konsep/input dari user memakai ejaan "Umrah".

ATURAN PANJANG TEKS (PALING PENTING):
WhatsApp memotong tampilan caption gambar di sekitar 1024 karakter. Target panjang caption final HARUS di bawah 900 karakter total, TANPA menghilangkan satu pun poin penting (tanggal, harga per kategori kamar, hotel, termasuk/tidak termasuk, kontak, ATAUPUN baris kosong pemisah section dan tanda bintang di judul dari Aturan Format Wajib — bagian itu tidak boleh dikorbankan demi memendekkan teks). Caranya memadatkan, bukan memotong info:
- Kalimat pembuka maksimal 1 kalimat pendek, langsung ke poin unik program — atau dihilangkan total jika konsep tidak punya elemen unik untuk dipromosikan.
- Setiap baris fasilitas/hotel/termasuk/tidak termasuk: 1 baris singkat, hindari kata sambung dan keterangan berulang.
- Gabungkan info yang searah jadi satu baris kalau memungkinkan (misal jarak dan estimasi jalan kaki hotel digabung dalam satu kurung), tanpa membuat baris jadi terlalu panjang.
- List "Termasuk"/"Tidak Termasuk": gunakan kata kunci singkat per poin (3-6 kata), bukan kalimat lengkap.
- Jangan ulangi info yang sudah disebut di bagian lain (misal nama program tidak perlu disebut ulang di body).
- Baris kosong pemisah antar section (lihat Aturan Format Wajib #2) tetap wajib dipertahankan; jangan sampai baris kosong ganda (dua baris kosong berturut-turut).
- Setelah menyusun draft di kepalamu, cek ulang: kalau masih di atas 900 karakter, padatkan lagi kalimat pembuka dan baris fasilitas terlebih dahulu sebelum menyentuh data harga/tanggal/kontak (data ini tidak boleh disingkat atau dihapus).

SEBELUM MENGIRIM JAWABAN, cek ulang output yang sudah kamu susun terhadap Aturan Format Wajib #1 dan #2 di atas — pastikan judul masih diapit tanda bintang dan setiap pemisah section masih berupa baris kosong, baru kirim.`;

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
      system_instruction: { parts: [{ text: WA_CAPTION_SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: userMsg }] }],
    });

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
