// Supabase Edge Function: generate-ig-content-plan
// Menyusun RENCANA KONTEN IG 1 BULAN (list ide + draft caption per
// tanggal) sekaligus, dipanggil oleh js/app.js (generateIgContentPlanAI)
// dari tombol "Generate Rencana Bulanan AI" di halaman IG Scheduler.
//
// Beda dengan generate-ig-caption (yang menyusun SATU caption dari SATU
// ide manual) — function ini yang MENGARANG daftar ide+jadwalnya sendiri,
// berdasarkan konteks program yang dikirim dari frontend (hasil query
// tabel `programs` yang jadwal keberangkatannya jatuh di bulan terkait).
//
// Pakai Gemini API dengan response_mime_type=application/json supaya
// hasilnya langsung JSON terstruktur (bukan teks bebas yang perlu di-parse
// manual). Secret GEMINI_API_KEY sama dengan fungsi AI lain (fallback
// multi-key lewat _shared/gemini.ts).
//
// Kontrak (dipakai oleh js/app.js -> generateIgContentPlanAI):
//   POST body: {
//     bulanLabel: string,        // mis. "September 2026" (untuk konteks AI)
//     jumlahPost: number,        // target jumlah ide dalam 1 bulan
//     tanggalMulai: string,      // "2026-09-01"
//     tanggalAkhir: string,      // "2026-09-30"
//     konteksProgram: string,    // ringkasan program aktif/berangkat bulan ini
//     arahan?: string,           // arahan tambahan opsional dari admin (tema campaign, dst)
//     ideSudahAda?: string       // daftar ide yang sudah ada di bulan itu ("YYYY-MM-DD — tema" per baris)
//                                // supaya AI tidak mengulang topik/tanggal yang sama
//   }
//   Response: { items: [{ tanggal, tema, tipe_konten, pilar, draft_caption }, ...] }
//   (tanggal dijamin valid & di dalam tanggalMulai..tanggalAkhir, jumlah item <= jumlahPost,
//    pilar salah satu dari edukasi|promo|testimoni|manasik|engagement|behind)
//
// Deploy:
//   supabase functions deploy generate-ig-content-plan --no-verify-jwt

import { callGeminiWithFallback } from "../_shared/gemini.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GEMINI_MODEL = "gemini-3.5-flash";

const CONTENT_PLAN_SYSTEM_PROMPT = `Kamu adalah social media strategist untuk biro umroh "Amiru Tour". Tugasmu menyusun RENCANA KONTEN INSTAGRAM 1 BULAN PENUH dalam Bahasa Indonesia, berupa daftar ide post yang tersebar merata sepanjang bulan.

ATURAN PENTING:
- Output HARUS berupa JSON array MURNI, tanpa markdown code fence, tanpa teks pembuka/penutup apa pun — cuma JSON.
- Setiap elemen array berbentuk: { "tanggal": "YYYY-MM-DD", "tema": string, "tipe_konten": "image"|"video"|"carousel", "pilar": "promo"|"edukasi"|"manasik"|"testimoni"|"engagement"|"behind", "draft_caption": string }.
- Isi "pilar" sesuai jenis kontennya: promosi program → "promo"; edukatif umum (FAQ, doa, adab) → "edukasi"; persiapan/tata cara manasik & perlengkapan → "manasik"; testimoni/social proof → "testimoni"; kuis/pertanyaan ke followers → "engagement"; momen di balik layar tim/kantor → "behind".
- Jumlah elemen HARUS sesuai jumlahPost yang diminta di prompt user.
- Semua "tanggal" HARUS berada di dalam rentang tanggalMulai..tanggalAkhir (inklusif) dan merupakan tanggal kalender yang valid.
- Kalau ada daftar IDE YANG SUDAH ADA, JANGAN mengulang topiknya dan hindari menaruh ide baru di tanggal yang sama dengan ide yang sudah ada.
- Sebar tanggal MERATA sepanjang rentang tanggalMulai..tanggalAkhir (jangan menumpuk di 1-2 hari), idealnya beda hari untuk tiap ide, prioritaskan hari kerja tapi boleh juga weekend sesekali.
- VARIASIKAN jenis konten — JANGAN semua jualan paket langsung. Campur proporsi kira-kira:
  - ~40% promosi program aktif (pakai data dari KONTEKS PROGRAM yang diberikan, sebut tanggal/harga PERSIS seperti di konteks — jangan mengarang angka)
  - ~25% edukatif (tips persiapan umroh, doa, adab di Tanah Suci, FAQ seputar umroh)
  - ~20% testimoni/social proof (boleh fiktif-generik tanpa nama spesifik, mis. "kesan jamaah setelah pulang dari Madinah" — jangan mengarang nama orang asli)
  - ~15% engagement/soft content (kuis ringan, pertanyaan ke followers, momen di balik layar kantor/tim)
- "tema" cukup 1 baris singkat (judul internal untuk admin, BUKAN caption).
- "draft_caption" ikuti gaya caption IG Amiru Tour: hook 1 baris di awal, body 2-4 kalimat pendek mengalir (bukan daftar fasilitas kaku), CTA jelas, ditutup blok hashtag maksimal 5 buah (campur brand/niche umroh/umum). Ejaan selalu "Umroh" (bukan "Umrah"). Target panjang tiap caption 400-800 karakter.
- JANGAN mengarang harga/tanggal keberangkatan yang tidak ada di KONTEKS PROGRAM — kalau konten edukatif/testimoni/engagement, tidak perlu sebut harga/tanggal spesifik sama sekali.
- Kalau KONTEKS PROGRAM kosong/tidak ada program aktif, tetap buat rencana penuh tapi fokuskan ke konten edukatif/testimoni/engagement (kurangi porsi promosi program, ganti dengan ajakan umum follow-up ke DM/WA).`;

interface PlanItem {
  tanggal: string;
  tema: string;
  tipe_konten: string;
  pilar?: string;
  draft_caption: string;
}

const VALID_PILARS = new Set(["edukasi", "promo", "testimoni", "manasik", "engagement", "behind"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// true kalau str adalah tanggal kalender nyata (bukan mis. 2026-02-31)
function isRealDate(str: string): boolean {
  if (!DATE_RE.test(str)) return false;
  const [y, m, d] = str.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function stripJsonFence(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
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
    const body = await req.json();
    const { bulanLabel, jumlahPost, tanggalMulai, tanggalAkhir, konteksProgram, arahan, ideSudahAda } = body || {};

    if (!bulanLabel || !jumlahPost || !tanggalMulai || !tanggalAkhir) {
      return new Response(JSON.stringify({ error: "bulanLabel, jumlahPost, tanggalMulai, tanggalAkhir wajib diisi" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const jumlah = Math.max(1, Math.min(60, Number(jumlahPost) || 12));

    const userMsg = `Susun rencana konten Instagram untuk bulan ${bulanLabel} (rentang tanggal ${tanggalMulai} s/d ${tanggalAkhir}), sebanyak TEPAT ${jumlah} ide post.

KONTEKS PROGRAM AKTIF/BERANGKAT BULAN INI:
${konteksProgram && String(konteksProgram).trim() ? konteksProgram : '(tidak ada data program spesifik untuk bulan ini)'}
${arahan && String(arahan).trim() ? `\nARAHAN TAMBAHAN DARI ADMIN:\n${arahan}` : ''}
${ideSudahAda && String(ideSudahAda).trim() ? `\nIDE YANG SUDAH ADA BULAN INI (jangan diulang):\n${String(ideSudahAda).slice(0, 4000)}` : ''}

Ingat: balas HANYA dengan JSON array sesuai format yang sudah dijelaskan, tidak ada teks lain.`;

    const geminiData = await callGeminiWithFallback(GEMINI_MODEL, {
      system_instruction: { parts: [{ text: CONTENT_PLAN_SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: userMsg }] }],
      generationConfig: {
        response_mime_type: "application/json",
      },
    });

    const parts = geminiData?.candidates?.[0]?.content?.parts || [];
    const rawText = parts.map((p: { text?: string }) => p?.text || "").join("").trim();

    if (!rawText) {
      const finishReason = geminiData?.candidates?.[0]?.finishReason;
      throw new Error(`Gemini tidak mengembalikan hasil.${finishReason ? ` (finishReason: ${finishReason})` : ""}`);
    }

    let items: PlanItem[];
    try {
      items = JSON.parse(stripJsonFence(rawText));
    } catch (parseErr) {
      throw new Error(`Gagal parse JSON dari Gemini: ${String((parseErr as Error)?.message || parseErr)}`);
    }

    if (!Array.isArray(items) || !items.length) {
      throw new Error("Gemini tidak menghasilkan daftar rencana yang valid (array kosong).");
    }

    // Validasi & bersihkan tiap item — buang yang cacat, jangan sampai 1 item
    // rusak menggagalkan seluruh batch.
    const validTypes = new Set(["image", "video", "carousel"]);
    const rangeOk = (t: string) => isRealDate(t) && t >= String(tanggalMulai) && t <= String(tanggalAkhir);
    const cleaned = items
      .filter((it) => it && typeof it === "object" && it.tanggal && it.tema && it.draft_caption)
      .map((it) => ({
        tanggal: String(it.tanggal).slice(0, 10),
        tema: String(it.tema).trim().slice(0, 200),
        tipe_konten: validTypes.has(String(it.tipe_konten)) ? String(it.tipe_konten) : "image",
        pilar: VALID_PILARS.has(String(it.pilar)) ? String(it.pilar) : null,
        draft_caption: String(it.draft_caption).trim(),
      }))
      // Buang tanggal cacat / di luar rentang bulan, lalu batasi sesuai jumlah yang diminta
      .filter((it) => rangeOk(it.tanggal))
      .slice(0, jumlah);

    if (!cleaned.length) {
      throw new Error("Semua item hasil AI tidak valid (tanggal di luar rentang bulan atau data kurang lengkap). Coba generate ulang.");
    }

    return new Response(JSON.stringify({ items: cleaned }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err as Error)?.message || err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
