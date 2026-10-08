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
// multi-key, logikanya digabung inline di file ini).
//
// Kontrak (dipakai oleh js/app.js -> generateIgContentPlanAI):
//   POST body: {
//     bulanLabel: string,        // mis. "September 2026" (untuk konteks AI)
//     jumlahPost: number,        // target jumlah ide dalam 1 bulan
//     tanggalMulai: string,      // "2026-09-01"
//     tanggalAkhir: string,      // "2026-09-30"
//     konteksProgram: string,    // ringkasan program aktif/berangkat bulan ini
//     arahan?: string,           // arahan tambahan opsional dari admin (tema campaign, dst)
//     ideSudahAda?: string,      // (lama) daftar ide yang sudah ada di bulan itu ("YYYY-MM-DD — tema" per baris)
//     riwayatTema?: string,      // daftar tema yang SUDAH PERNAH dibuat (semua bulan, satu tema per baris)
//                                // -> AI wajib membuat ide yang benar-benar beda dari daftar ini
//     slots?: [{ tanggal, hari, pilar, tipe_konten }]
//                                // slot tanggal yang HARUS diisi (1 ide per slot). Kalau ada, jumlah ide = jumlah slot,
//                                // tanggal/pilar/tipe_konten dipaksa mengikuti slot (tanggal lain dibuang).
//   }
//   Response: { items: [{ tanggal, tema, tipe_konten, pilar, teks_gambar, draft_caption }, ...], versi: 2 }
//   (versi: 2 = function ini sudah mengenali slots & riwayatTema; frontend memakainya untuk mendeteksi
//    function lama yang belum di-deploy ulang)
//   (tanggal dijamin valid & di dalam tanggalMulai..tanggalAkhir, jumlah item <= jumlahPost,
//    pilar salah satu dari storytelling|edukasi|promo|testimoni|manasik|engagement|behind,
//    teks_gambar = teks pemancing 2-4 baris untuk ditaruh di gambar; caption melanjutkannya)
//
// Deploy:
//   supabase functions deploy generate-ig-content-plan --no-verify-jwt

// Helper Gemini (fallback multi-key) digabung langsung di sini, bukan import dari
// "../_shared/gemini.ts", supaya file ini berdiri sendiri dan bisa dideploy lewat
// Supabase Dashboard (paste/upload satu file) maupun CLI. Logikanya identik dengan
// _shared/gemini.ts (key: GEMINI_API_KEY, lalu GEMINI_API_KEY_2 s/d _5).
const MAX_FALLBACK_KEYS = 5;

function getGeminiApiKeys(): string[] {
  const keys: string[] = [];
  const primary = Deno.env.get("GEMINI_API_KEY");
  if (primary) keys.push(primary);
  for (let i = 2; i <= MAX_FALLBACK_KEYS; i++) {
    const k = Deno.env.get(`GEMINI_API_KEY_${i}`);
    if (k) keys.push(k);
  }
  return keys;
}

// Model cadangan kalau model utama sedang overload (503 berlaku untuk SELURUH model, bukan per key,
// jadi memutar key saja tidak menolong). Model yang sama juga dipakai function lain di project ini.
const FALLBACK_MODELS = ["gemini-3.5-flash-lite"];
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [3000]; // jeda sebelum putaran ulang model utama (total 2 putaran)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// deno-lint-ignore no-explicit-any
async function callGeminiWithFallback(model: string, body: Record<string, unknown>): Promise<any> {
  const keys = getGeminiApiKeys();
  if (!keys.length) {
    throw new Error("GEMINI_API_KEY belum di-set di Supabase secrets");
  }

  let lastError = "";

  // Satu putaran = coba semua key untuk 1 model. Return hasil kalau berhasil, null kalau gagal.
  // retryable = true kalau kegagalannya sementara (overload / rate limit / jaringan) sehingga layak dicoba ulang.
  async function tryModel(m: string): Promise<{ data: unknown | null; retryable: boolean }> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
    let retryable = false;
    for (let i = 0; i < keys.length; i++) {
      try {
        const res = await fetch(`${url}?key=${keys[i]}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) return { data: await res.json(), retryable: false };

        const errText = await res.text();
        if (RETRYABLE_STATUS.has(res.status)) retryable = true;
        lastError = `Gemini API error (${res.status}) [${m}, key #${i + 1}/${keys.length}]: ${errText.slice(0, 300)}`;
        console.warn(lastError);
      } catch (networkErr) {
        retryable = true;
        lastError = `Network error saat panggil Gemini [${m}, key #${i + 1}/${keys.length}]: ${
          String((networkErr as Error)?.message || networkErr)
        }`;
        console.warn(lastError);
      }
    }
    return { data: null, retryable };
  }

  // 1) Model utama, dengan putaran ulang + jeda kalau gagalnya sementara (mis. 503 "high demand")
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const r = await tryModel(model);
    if (r.data) return r.data;
    if (!r.retryable || attempt === RETRY_DELAYS_MS.length) break;
    await sleep(RETRY_DELAYS_MS[attempt]);
  }

  // 2) Model cadangan
  for (const fb of FALLBACK_MODELS) {
    if (fb === model) continue;
    const r = await tryModel(fb);
    if (r.data) return r.data;
  }

  throw new Error(`Semua ${keys.length} GEMINI_API_KEY gagal dipakai (model utama & cadangan). Error terakhir: ${lastError}`);
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GEMINI_MODEL = "gemini-3.5-flash";

const CONTENT_PLAN_SYSTEM_PROMPT = `Kamu adalah social media strategist & copywriter untuk biro umroh "Amiru Tour". Tugasmu menyusun RENCANA KONTEN INSTAGRAM 1 BULAN PENUH dalam Bahasa Indonesia, berupa daftar ide post. Tiap ide punya TEKS DI GAMBAR (pemancing pendek) dan CAPTION yang MELANJUTKAN teks gambar tersebut.

ATURAN FORMAT:
- Output HARUS berupa JSON array MURNI, tanpa markdown code fence, tanpa teks pembuka/penutup apa pun — cuma JSON.
- Setiap elemen array berbentuk: { "tanggal": "YYYY-MM-DD", "tema": string, "tipe_konten": "image"|"carousel" (JANGAN pernah memakai "video"/Reels), "pilar": "storytelling"|"edukasi"|"promo"|"testimoni"|"manasik"|"engagement"|"behind", "teks_gambar": string, "draft_caption": string }.
- Jumlah elemen HARUS sesuai jumlah yang diminta di prompt user. Kalau prompt user memuat DAFTAR SLOT TANGGAL, buat TEPAT 1 ide per slot: "tanggal" harus persis sama dengan slot (jangan menambah, mengurangi, atau menggeser tanggal), serta ikuti pilar & tipe_konten yang tertera di slot itu.
- Semua "tanggal" HARUS berada di dalam rentang tanggalMulai..tanggalAkhir (inklusif) dan merupakan tanggal kalender yang valid.
- Kalau ada daftar IDE YANG SUDAH ADA, JANGAN mengulang topiknya dan hindari menaruh ide baru di tanggal yang sama dengan ide yang sudah ada.
- "tema" cukup 1 baris singkat (judul internal untuk admin, BUKAN caption).

ANTI-DUPLIKASI (PENTING):
- Prompt user bisa memuat RIWAYAT TEMA: daftar tema konten yang SUDAH PERNAH dibuat sebelumnya. Setiap ide baru HARUS benar-benar berbeda dari semua tema itu: beda topik inti, beda momen/sudut pandang, beda teks_gambar, dan beda kalimat pembuka caption. Mengganti beberapa kata saja TIDAK dianggap berbeda.
- Ide-ide dalam satu jawaban juga tidak boleh saling mirip.
- Kalau topik favorit sudah ada di riwayat, pilih sudut lain yang belum pernah dipakai (momen ibadah, lokasi, perasaan, kekhawatiran, atau pertanyaan jamaah yang berbeda). Kalau ragu sebuah ide mirip riwayat, ganti.

POLA MINGGUAN (acuan hari & jenis konten — ikuti sebisa mungkin, maksimal 7 ide per pekan; ambil dari awal pola kalau jumlah ide lebih sedikit dari jumlah slot):
- SENIN = storytelling (rasa rindu & kedekatan; momen ibadah atau suasana Tanah Suci) → tipe "image", pilar "storytelling"
- SELASA = manasik (tata cara, doa, perlengkapan; praktis & bisa disimpan) → tipe "image", pilar "manasik"
- RABU = edukasi (persiapan, kesalahan umum; bisa disimpan & dibagikan) → tipe "carousel", pilar "edukasi"
- KAMIS = storytelling bertahap (momen ibadah / suasana Tanah Suci, diceritakan per slide) → tipe "carousel", pilar "storytelling"
- JUMAT = bukti sosial (testimoni / momen jamaah, kartu kutipan) → tipe "image", pilar "testimoni"
- SABTU = engagement (pertanyaan ringan / polling yang mengajak jamaah bercerita di komentar) → tipe "image", pilar "engagement"
- MINGGU = info program (jadwal, seat, ajakan mendaftar / menabung niat) → tipe "image", pilar "promo"
Proporsi sehat: sekitar 6 konten non-jualan untuk setiap 1 konten info program. Kalau ada DAFTAR SLOT di prompt user, pilar & tipe_konten dari slot itulah yang dipakai. Pilar "behind" hanya dipakai kalau diminta di ARAHAN TAMBAHAN. Sebar tanggal merata sepanjang bulan, jangan menumpuk di 1-2 hari.

TEKS DI GAMBAR ("teks_gambar"):
- 2-4 baris pendek (pisahkan dengan \\n), jadi pemancing yang bikin orang berhenti scroll. Contoh: "Niat umroh itu muncul diam-diam.\\nPas dengar adzan.\\nPas lihat foto Ka'bah."
- Untuk carousel, tulis per slide: "Slide 1: ...\\nSlide 2-6: ...\\nSlide 7: ...".
- JANGAN diulang persis di caption — caption adalah lanjutannya.

CAPTION ("draft_caption") — GAYA BAHASA:
- Sastrawi tapi membumi: puitis, hangat, santai seperti ngobrol dengan teman. Sapa pembaca dengan "kamu"; pakai kata sehari-hari secukupnya (nggak, aja, banget) tapi tetap sopan.
- Utamakan momen konkret yang bisa dibayangkan (gerakan, suasana, ekspresi jamaah, kekhawatiran nyata), BUKAN klaim umum atau bahasa brosur. Hindari kata kaku seperti "tersedia", "silakan", "hubungi kami".
- Fokus ke perasaan: rindu, ketenangan, proses transisi jiwa, makna di balik ibadah. Pendekatan storytelling, bukan hard-selling.
- Struktur: pembukaan = suasana/refleksi tentang momen atau lokasi; isi = hubungkan dengan pengalaman batin jamaah (seolah kita melihat momennya langsung); penutup = ajakan ringan yang hangat (mis. "chat WA aja ya", atau pertanyaan tentang rindu/doa di kolom komentar) dan untuk konten storytelling tambahkan satu kalimat doa penutup sederhana dalam bahasa Indonesia.
- Panjang: JANGAN terlalu singkat. Target 600-1200 karakter, 3-5 paragraf pendek dipisah baris kosong.
- Ditutup tepat 5 hashtag di baris terakhir, relevan dengan topik; #UmrohBersamaAmiru dan #AmiruTour selalu ada.
- Ejaan selalu "Umroh" (bukan "Umrah"), termasuk di hashtag.
- JANGAN mengarang kutipan ayat, hadis, atau doa berbahasa Arab. JANGAN membuat janji berlebihan (mis. "pasti mabrur", "dijamin berangkat", "seat pasti ada").

DATA & KEJUJURAN:
- Untuk info program: sebut tanggal/harga PERSIS seperti di KONTEKS PROGRAM — JANGAN mengarang angka, tanggal, nama hotel, atau fasilitas yang tidak ada di konteks. Kalau datanya tidak ada, tulis placeholder seperti [bulan], [hotel], [nomor WA].
- Untuk testimoni/bukti sosial: JANGAN mengarang kutipan atau nama jamaah. Tulis placeholder "[isi kutipan asli jamaah]" dan "[nama jamaah, kota]" di teks_gambar, dan beri catatan di tema bahwa kutipan asli & izin jamaah wajib diisi sebelum diposting.
- Kalau KONTEKS PROGRAM kosong/tidak ada program aktif, tetap buat rencana penuh tapi kurangi porsi info program dan ganti dengan ajakan umum (tanya-tanya lewat WA, menabung niat).`;

interface PlanItem {
  tanggal: string;
  tema: string;
  tipe_konten: string;
  pilar?: string;
  teks_gambar?: string;
  draft_caption: string;
}

const VALID_PILARS = new Set(["storytelling", "edukasi", "promo", "testimoni", "manasik", "engagement", "behind"]);
// Konten video/Reels sengaja tidak dibuat dulu: hanya single post (image) & carousel.
const VALID_TYPES = new Set(["image", "carousel"]);
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
    const { bulanLabel, jumlahPost, tanggalMulai, tanggalAkhir, konteksProgram, arahan, ideSudahAda, riwayatTema, slots } = body || {};

    if (!bulanLabel || !jumlahPost || !tanggalMulai || !tanggalAkhir) {
      return new Response(JSON.stringify({ error: "bulanLabel, jumlahPost, tanggalMulai, tanggalAkhir wajib diisi" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Slot tanggal (opsional): hanya slot yang valid (tanggal nyata di dalam rentang, pilar & tipe dikenal) yang dipakai.
    const slotList: { tanggal: string; hari: string; pilar: string; tipe_konten: string }[] = Array.isArray(slots)
      ? slots
          .filter((s: { tanggal?: string; pilar?: string; tipe_konten?: string }) =>
            s && isRealDate(String(s.tanggal)) && String(s.tanggal) >= String(tanggalMulai) && String(s.tanggal) <= String(tanggalAkhir) &&
            VALID_PILARS.has(String(s.pilar)) && VALID_TYPES.has(String(s.tipe_konten)))
          .slice(0, 60)
          .map((s: { tanggal: string; hari?: string; pilar: string; tipe_konten: string }) => ({
            tanggal: String(s.tanggal), hari: String(s.hari || ""), pilar: String(s.pilar), tipe_konten: String(s.tipe_konten),
          }))
      : [];

    const jumlah = slotList.length ? slotList.length : Math.max(1, Math.min(60, Number(jumlahPost) || 12));

    const userMsg = `Susun rencana konten Instagram untuk bulan ${bulanLabel} (rentang tanggal ${tanggalMulai} s/d ${tanggalAkhir}), sebanyak TEPAT ${jumlah} ide post.

KONTEKS PROGRAM AKTIF/BERANGKAT BULAN INI:
${konteksProgram && String(konteksProgram).trim() ? konteksProgram : '(tidak ada data program spesifik untuk bulan ini)'}
${arahan && String(arahan).trim() ? `\nARAHAN TAMBAHAN DARI ADMIN:\n${arahan}` : ''}
${slotList.length ? `\nDAFTAR SLOT TANGGAL (isi TEPAT 1 ide per slot, tanggal persis sama, ikuti pilar & tipe_konten-nya):\n${slotList.map((s) => `- ${s.tanggal}${s.hari ? ` (${s.hari})` : ''} | pilar: ${s.pilar} | tipe_konten: ${s.tipe_konten}`).join('\n')}` : ''}
${ideSudahAda && String(ideSudahAda).trim() ? `\nIDE YANG SUDAH ADA BULAN INI (jangan diulang):\n${String(ideSudahAda).slice(0, 4000)}` : ''}
${riwayatTema && String(riwayatTema).trim() ? `\nRIWAYAT TEMA — SUDAH PERNAH DIBUAT (jangan diulang & jangan dibuat mirip):\n${String(riwayatTema).slice(0, 20000)}` : ''}

Ingat: balas HANYA dengan JSON array sesuai format yang sudah dijelaskan, tidak ada teks lain.`;

    const geminiData = await callGeminiWithFallback(GEMINI_MODEL, {
      system_instruction: { parts: [{ text: CONTENT_PLAN_SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: userMsg }] }],
      generationConfig: {
        response_mime_type: "application/json",
        temperature: 1,
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
    const rangeOk = (t: string) => isRealDate(t) && t >= String(tanggalMulai) && t <= String(tanggalAkhir);
    let cleaned = items
      .filter((it) => it && typeof it === "object" && it.tanggal && it.tema && it.draft_caption)
      .map((it) => ({
        tanggal: String(it.tanggal).slice(0, 10),
        tema: String(it.tema).trim().slice(0, 200),
        tipe_konten: VALID_TYPES.has(String(it.tipe_konten)) ? String(it.tipe_konten) : "image",
        pilar: VALID_PILARS.has(String(it.pilar)) ? String(it.pilar) : null,
        teks_gambar: it.teks_gambar ? String(it.teks_gambar).trim().slice(0, 300) : "",
        draft_caption: String(it.draft_caption).trim(),
      }))
      // Buang tanggal cacat / di luar rentang bulan, lalu batasi sesuai jumlah yang diminta
      .filter((it) => rangeOk(it.tanggal));

    if (slotList.length) {
      // Mode slot: hanya tanggal yang diminta, maksimal 1 ide per tanggal; pilar & tipe dipaksa mengikuti slot.
      const slotByDate = new Map(slotList.map((s) => [s.tanggal, s]));
      const sudah = new Set<string>();
      cleaned = cleaned
        .filter((it) => {
          if (!slotByDate.has(it.tanggal) || sudah.has(it.tanggal)) return false;
          sudah.add(it.tanggal);
          return true;
        })
        .map((it) => {
          const slot = slotByDate.get(it.tanggal)!;
          return { ...it, pilar: slot.pilar, tipe_konten: slot.tipe_konten };
        });
    }
    cleaned = cleaned.slice(0, jumlah);

    if (!cleaned.length) {
      throw new Error("Semua item hasil AI tidak valid (tanggal di luar rentang bulan atau data kurang lengkap). Coba generate ulang.");
    }

    return new Response(JSON.stringify({ items: cleaned, versi: 2 }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err as Error)?.message || err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
