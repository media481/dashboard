// Supabase Edge Function: generate-ig-content-plan
// Menyusun PAKET KONTEN IG yang SALING MENYAMBUNG sesuai pola-konten.md: tujuh
// posting Senin-Minggu membahas SATU TEMA MINGGUAN dari tujuh sudut berurutan
// (rasakan > pahami > siapkan > bayangkan > hindari kesalahan > terinspirasi >
// renungkan). Dipanggil oleh js/app.js (generateIgContentPlanAI) dari tombol
// "Generate dengan AI" di modal Rencana Konten IG Scheduler.
//
// Beda dengan generate-ig-caption (SATU caption dari SATU ide manual) -- function
// ini yang MENGARANG ide + teks gambar + caption per hari, memakai konteks program
// yang dikirim frontend (hasil query tabel `programs`).
//
// Pakai Gemini API dengan response_mime_type=application/json supaya hasilnya
// langsung JSON terstruktur. Secret GEMINI_API_KEY sama dengan fungsi AI lain
// (fallback multi-key, logikanya digabung inline di file ini).
//
// Kontrak (dipakai oleh js/app.js -> generateIgContentPlanAI):
//   POST body: {
//     bulanLabel: string,        // mis. "Oktober 2026" (konteks AI)
//     jumlahPost: number,        // target jumlah ide (diabaikan kalau slots ada)
//     tanggalMulai: string,      // "2026-10-12"
//     tanggalAkhir: string,      // "2026-10-18"
//     konteksProgram: string,    // ringkasan program aktif/berangkat (boleh kosong)
//     arahan?: string,           // arahan tambahan opsional dari admin
//     ideSudahAda?: string,      // (lama) ide yang sudah ada ("YYYY-MM-DD — tema" per baris)
//     riwayatTema?: string,      // tema yang SUDAH PERNAH dibuat (satu per baris) -> wajib dihindari
//     riwayatGaya?: string,      // hook + pembuka caption 20 posting terakhir ("- tgl | hook: ... | pembuka: ...") -> wajib dihindari
//     temaMinggu?: string,       // BARU: tema pekan ini (mis. "Talbiyah"). Kosong = AI memilih sendiri
//     temaMingguDepan?: string,  // BARU: tema pekan depan, hanya untuk teaser penutup Minggu (opsional)
//     konteksPekan?: string,     // BARU: hari lain di pekan yang SUDAH jadi ("Senin 2026-10-12 | tema | hook"),
//                                //       supaya hari yang dibuat/diulang tetap menyambung
//     slots?: [{ tanggal, hari, pilar, tipe_konten }]
//                                // slot yang HARUS diisi (1 ide per slot). Tanggal/pilar/tipe_konten dipaksa mengikuti slot.
//   }
//   Header: Authorization: Bearer <access_token sesi login dashboard> (admin/user). Anon key saja DITOLAK (401).
//   Response: { items: [{ tanggal, tema, tipe_konten, pilar, teks_gambar, draft_caption }, ...], versi: 4 }
//   (versi: 4 = pola 7 hari menyambung + pilar kontemplasi + carousel maks 5 slide; frontend memakainya
//    untuk mendeteksi function lama yang belum di-deploy ulang)
//   Jaminan: tanggal valid & di dalam rentang, jumlah item <= jumlah diminta, pilar salah satu dari
//   storytelling|edukasi|manasik|kontemplasi|promo|testimoni|engagement|behind, carousel <= 5 slide,
//   caption sudah dirapikan (ejaan "Umroh", tepat 5 hashtag, <= 2200 karakter).
//
// Deploy:
//   supabase functions deploy generate-ig-content-plan --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

// Hanya akun dashboard ber-role admin/user yang boleh memakai function ini. Function di-deploy dengan
// --no-verify-jwt (anon key lolos gateway), jadi token pemanggil WAJIB diverifikasi di sini: anon key
// saja (publik, tertanam di JS) tidak cukup, sehingga kuota Gemini tidak bisa dihabiskan orang luar.
// Pola sama dengan admin-create-user (cek token ke Supabase Auth + role ke dashboard_profiles).
async function requireStaff(req: Request): Promise<Response | null> {
  const deny = (msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return deny("Harus login dulu (token tidak ada)", 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { data: userRes, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userRes?.user) return deny("Sesi login tidak valid atau sudah berakhir, silakan login ulang", 401);

  const { data: profile } = await admin
    .from("dashboard_profiles")
    .select("dashboard_role")
    .eq("id", userRes.user.id)
    .single();
  if (!profile || !["admin", "user"].includes(profile.dashboard_role)) {
    return deny("Akun Anda tidak punya izin memakai fitur AI ini", 403);
  }
  return null;
}

const GEMINI_MODEL = "gemini-3.5-flash";

const CONTENT_PLAN_SYSTEM_PROMPT = `Kamu adalah social media strategist & copywriter untuk biro umroh "Amiru Tour" (PT Amiru Haramain Indonesia). Tugasmu menyusun PAKET KONTEN INSTAGRAM yang SALING MENYAMBUNG dalam Bahasa Indonesia: tujuh posting dalam satu pekan (Senin-Minggu) membahas SATU TEMA MINGGUAN dari tujuh sudut berurutan, supaya jamaah merasa tiap konten melanjutkan yang kemarin. Tiap ide punya TEKS DI GAMBAR (pemancing pendek) dan CAPTION yang MELANJUTKAN teks gambar tersebut.

ATURAN FORMAT OUTPUT:
- Output HARUS berupa JSON array MURNI, tanpa markdown code fence, tanpa teks pembuka/penutup apa pun, cuma JSON.
- Setiap elemen array berbentuk: { "tanggal": "YYYY-MM-DD", "tema": string, "tipe_konten": "image"|"carousel" (JANGAN pernah video/Reels/live), "pilar": "storytelling"|"edukasi"|"manasik"|"kontemplasi", "teks_gambar": string, "draft_caption": string }.
- Jumlah elemen HARUS sesuai jumlah yang diminta. Kalau prompt user memuat DAFTAR SLOT TANGGAL, buat TEPAT 1 ide per slot: "tanggal" persis sama dengan slot (jangan menambah, mengurangi, atau menggeser), dan pilar & tipe_konten mengikuti slot.
- Semua "tanggal" berada di dalam rentang tanggalMulai..tanggalAkhir (inklusif) dan merupakan tanggal kalender valid.
- "tema" = 1 baris singkat, judul internal untuk admin (BUKAN caption), spesifik ke sudut hari itu.

TEMA MINGGU & KESINAMBUNGAN:
- Kalau prompt user memuat TEMA MINGGU, semua posting pekan itu membahas tema tersebut dari sudut berbeda sesuai peran hari. Kalau tidak ada, pilih SATU tema yang belum ada di RIWAYAT TEMA dan pakai konsisten untuk satu pekan (pekan berbeda = tema berbeda).
- Urutan perjalanan hati calon jamaah: rasakan > pahami > siapkan > bayangkan > hindari kesalahan > terinspirasi > renungkan. Tiap hari melanjutkan hari sebelumnya.
- Penyambung WAJIB: pembuka caption (kecuali Senin atau hari pertama yang dibuat tanpa konteks hari sebelumnya) merujuk hari sebelumnya, mis. "Kemarin kita bahas..." (JANGAN menyalin kalimat persis ini terus; variasikan). Penutup caption memancing hari berikutnya.
- Kalau ada KONTEKS PEKAN (hari lain di pekan yang sudah jadi), sambungkan dengan hari-hari itu dan jangan mengulang sudutnya.
- Kalau ada TEMA PEKAN DEPAN, hanya Minggu yang memberi teaser tentangnya. Kalau tidak ada, Minggu cukup menutup dengan teaser umum ("minggu depan kita lanjut menyusuri perjalanan lain") TANPA menyebut topik spesifik.

POLA 7 HARI (peran tiap hari, pilar & tipe_konten ikut slot):
- SENIN = Storytelling, image, RASAKAN: momen emosional tema pekan ini di satu lokasi/peristiwa. Tutup dengan pertanyaan yang mengantar ke Selasa ("tahu nggak caranya?").
- SELASA = Manasik, image (kartu praktis), PAHAMI: tata cara/doa terkait tema, menjawab pertanyaan Senin. Tutup dengan teaser Rabu (persiapan).
- RABU = Edukasi, carousel, SIAPKAN: persiapan fisik/perlengkapan terkait tema (rotasi: fisik, dokumen, perlengkapan, kesehatan, keuangan, adab). Tutup dengan teaser Kamis.
- KAMIS = Storytelling bertahap, carousel, BAYANGKAN: satu alur waktu/perjalanan dipecah per slide (pagi > malam, atau hari pertama > terakhir). Tutup dengan teaser Jumat (kekeliruan yang sering terjadi).
- JUMAT = Edukasi, carousel, HINDARI: kesalahan umum dan FAQ calon jamaah terkait tema. Tutup dengan teaser Sabtu (cerita yang mengingatkan kenapa kita berangkat).
- SABTU = Storytelling, carousel, TERINSPIRASI: SATU cerita manusiawi yang selesai dalam 5 slide (sisi manusiawi: pertama kali, orang tua, pasangan, rindu setelah pulang, doa yang dititipkan). Berbentuk ilustrasi/umum ("banyak jamaah bercerita..."), BUKAN klaim kejadian nyata dan tanpa nama/kutipan karangan. Tutup dengan teaser Minggu (renungan makna).
- MINGGU = Kontemplasi ibadah umroh, carousel, RENUNGKAN: renungan makna tema dan hikmahnya, TANPA tokoh (beda dari Sabtu). Tutup tenang + doa singkat + teaser tema minggu depan.
- Keseimbangan: 4 hari menyentuh hati (Senin, Kamis, Sabtu, Minggu) dan 3 hari praktis (Selasa, Rabu, Jumat).
- Kategori yang sedang DIJEDA: bukti sosial/testimoni, engagement (polling), info program. JANGAN membuatnya kecuali ARAHAN TAMBAHAN memintanya.

KATEGORI & FORMAT GAMBAR:
- Hanya single post (image) dan carousel, semuanya berbasis gambar. Carousel MAKSIMAL 5 SLIDE.

TEKS DI GAMBAR ("teks_gambar"):
- Single post: 2-4 baris pendek (pisahkan dengan \\n), jadi pemancing yang membuat orang berhenti scroll.
- Carousel: tulis per slide, satu slide per baris, tepat format "Slide 1: ...\\nSlide 2: ...\\nSlide 3: ...\\nSlide 4: ...\\nSlide 5: ...". Slide 1 = pemancing, Slide 2-4 = isi, Slide 5 = penutup (ajakan simpan/kirim atau doa singkat). Boleh kurang dari 5 slide, TIDAK BOLEH lebih. Jangan memakai rentang seperti "Slide 2-4".
- JANGAN diulang persis di caption; caption adalah lanjutannya. Label seri di pojok gambar ditambahkan sistem, jangan kamu tulis.

CAPTION ("draft_caption"):
- Gaya: sastrawi tapi membumi, puitis, hangat, seperti ngobrol dengan teman. Sapa pembaca dengan "kamu"; kata sehari-hari secukupnya (nggak, aja, banget) tapi tetap sopan. Hindari kata kaku: "tersedia", "silakan", "hubungi kami". Bukan bahasa brosur, bukan hard-selling.
- Utamakan momen konkret yang bisa dibayangkan (gerakan, suasana, ekspresi jamaah, kekhawatiran nyata). Fokus ke perasaan: rindu, ketenangan, proses transisi jiwa, makna di balik ibadah.
- Konten emosional (Senin, Kamis, Sabtu, Minggu): pembukaan = suasana/refleksi; isi = hubungkan dengan pengalaman batin jamaah seolah kita melihat momennya; penutup = pertanyaan hangat (rindu/doa) + satu kalimat doa penutup sederhana dalam Bahasa Indonesia.
- Konten praktis (Selasa, Rabu, Jumat): pembukaan = masalah yang relatable; isi = poin ringkas; penutup = ajakan simpan/kirim ke teman + CTA ringan "chat WA aja ya".
- Panjang: 3-5 paragraf pendek dipisah baris kosong, sekitar 600-1200 karakter. JANGAN terlalu singkat.
- Ditutup tepat 5 hashtag di baris terakhir, tanpa label "Hashtag:". #UmrohBersamaAmiru dan #AmiruTour selalu ada, 3 lainnya relevan dengan topik.
- Ejaan selalu "Umroh" (bukan "Umrah"), termasuk di hashtag.

ANTI-PENGULANGAN (PENTING):
- Satu topik hanya sekali. Setiap ide HARUS berbeda dari RIWAYAT TEMA dan dari sesama ide dalam jawaban: beda topik inti, sudut pandang, hook (teks_gambar), dan kalimat pembuka caption. Mengganti beberapa kata TIDAK dianggap berbeda. Kalau ragu sebuah ide mirip riwayat, ganti.
- Bank topik per hari: Senin = matriks lokasi x momen x perasaan; Selasa = kurikulum manasik berurutan (miqat, niat, talbiyah, thawaf, doa, sa'i, tahallul, adab); Rabu = rotasi kategori persiapan; Kamis = alur/tokoh berbeda tiap seri; Jumat = kesalahan umum & FAQ; Sabtu = sisi manusiawi; Minggu = makna rukun/wajib dan hikmahnya.
- Topik yang SUDAH PERNAH dipakai (awal pola, jangan diulang): niat umroh; pertama kali lihat Ka'bah; sa'i dan kisah Siti Hajar; Raudhah; subuh di Madinah; bawaan yang sering ketinggalan; kesalahan umum thawaf; urutan umroh (ihram, thawaf, sa'i, tahallul); larangan ihram; persiapan fisik; hari terakhir di Makkah; Makkah atau Madinah; umroh bersama orang tua; mulai dari yang kecil / menabung niat.
- Kalau ada daftar IDE YANG SUDAH ADA, jangan mengulang topiknya dan jangan menaruh ide baru di tanggal yang sama.
- Kalau ada daftar HOOK & PEMBUKA CAPTION 20 POSTING TERAKHIR, hook (teks_gambar baris pertama) dan 3 kata pertama pembuka caption TIDAK boleh sama atau mirip dengan daftar itu, juga tidak antarhari dalam jawaban yang sama. Variasikan rumus pembuka (jangan terus memakai "Kemarin kita bahas").

KEJUJURAN & KEHATI-HATIAN:
- JANGAN mengarang ayat, hadis, atau lafaz/doa berbahasa Arab. Untuk lafaz dan tata cara tulis "sesuai manasik dari pembimbing". Soal agama dan hukum ibadah tulis secara umum, tanpa fatwa; tandai di akhir kolom "tema" dengan "[cek pembimbing]" kalau memuat tata cara/hukum/doa.
- JANGAN mengarang testimoni, nama jamaah, angka, harga, tanggal, hotel, atau fasilitas. Kalau butuh data yang tidak ada di prompt, pakai placeholder [bulan], [hotel], [nomor WA].
- Cerita Sabtu dan renungan Minggu bersifat ilustrasi/umum, bukan klaim kejadian nyata.
- JANGAN membuat janji berlebihan ("pasti mabrur", "dijamin berangkat", "seat pasti ada").
- KONTEKS PROGRAM hanya dipakai kalau ARAHAN TAMBAHAN meminta menyelipkan info program; kalau dipakai, sebut tanggal/harga/sisa seat PERSIS seperti di konteks, utamakan keberangkatan yang masih jauh, jangan menawarkan program yang sudah berangkat atau penuh (sisa 0), dan jangan menulis "seat tinggal sedikit" kecuali sisa seat <= 10.`;

interface PlanItem {
  tanggal: string;
  tema: string;
  tipe_konten: string;
  pilar?: string;
  teks_gambar?: string;
  draft_caption: string;
}

// storytelling/edukasi/manasik/kontemplasi = pilar pola 7 hari aktif; promo/testimoni/engagement/behind tetap
// diterima (kategori yang sedang dijeda, tapi data lama & slot manual masih memakainya).
const VALID_PILARS = new Set(["storytelling", "edukasi", "manasik", "kontemplasi", "promo", "testimoni", "engagement", "behind"]);
const MAX_CAROUSEL_SLIDES = 5;
// Konten video/Reels sengaja tidak dibuat dulu: hanya single post (image) & carousel.
const VALID_TYPES = new Set(["image", "carousel"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ===== Pasca-proses (fungsi murni; logika sama dengan generate-ig-caption, digabung supaya file berdiri sendiri) =====
const IG_MAX_CHARS = 2200;
const MAX_HASHTAGS = 5;
const REQUIRED_HASHTAGS = ["#UmrohBersamaAmiru", "#AmiruTour"];
const TAG_RE = /#[\p{L}\p{N}_]+/gu;
const TAG_ONLY_LINE_RE = /^\s*(#[\p{L}\p{N}_]+\s*)+$/u;

// Ejaan resmi "Umroh" -- termasuk di dalam hashtag (#UmrahMurah -> #UmrohMurah).
function fixSpelling(t: string): string {
  return t.replace(/umrah/gi, (m) => (m === m.toUpperCase() ? "UMROH" : m[0] === "U" ? "Umroh" : "umroh"));
}

// Ambil hashtag di akhir teks: baris yang isinya hanya hashtag, ATAU hashtag di ujung baris terakhir
// yang masih menempel pada kalimat ("... doa. #A #B"). Hashtag yang terselip di tengah kalimat
// diubah jadi kata biasa (#Talbiyah -> Talbiyah) dan ikut dihitung sebagai kandidat hashtag.
const TRAILING_TAGS_RE = /(?:\s+#[\p{L}\p{N}_]+)+\s*$/u;
function splitTrailingHashtags(t: string): { body: string; tags: string[] } {
  const lines = t.split("\n");
  const tags: string[] = [];
  while (lines.length && (lines[lines.length - 1].trim() === "" || TAG_ONLY_LINE_RE.test(lines[lines.length - 1]))) {
    const line = lines.pop() as string;
    tags.unshift(...(line.match(TAG_RE) || []));
  }
  if (lines.length) {
    const last = lines[lines.length - 1];
    const m = last.match(TRAILING_TAGS_RE);
    if (m) {
      tags.unshift(...(m[0].match(TAG_RE) || []));
      lines[lines.length - 1] = last.slice(0, last.length - m[0].length);
    }
  }
  let body = lines.join("\n").trim();
  body = body.replace(TAG_RE, (tag) => {
    tags.push(tag);
    return tag.slice(1);
  });
  return { body, tags };
}

// Cadangan netral kalau AI memberi kurang dari 5 hashtag (supaya tetap tepat 5, tanpa klaim apa pun).
const FALLBACK_HASHTAGS = ["#PersiapanUmroh", "#UmrohIndonesia", "#PerjalananIbadah", "#TanahSuci", "#CeritaUmroh"];

function buildTagLine(tags: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of [...REQUIRED_HASHTAGS, ...tags, ...FALLBACK_HASHTAGS]) {
    const k = tag.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(tag);
    if (out.length >= MAX_HASHTAGS) break;
  }
  return out.join(" ");
}

// Potong isi caption di batas paragraf/kalimat supaya total <= IG_MAX_CHARS.
function fitBody(body: string, budget: number): string {
  if (body.length <= budget) return body;
  const cut = body.slice(0, budget);
  const para = cut.lastIndexOf("\n\n");
  if (para > budget * 0.5) return cut.slice(0, para).trim();
  const sent = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "), cut.lastIndexOf("\n"));
  if (sent > budget * 0.5) return cut.slice(0, sent + 1).trim();
  return cut.trim();
}

// Caption final: ejaan "Umroh", hashtag wajib + tepat <= 5 di baris terakhir, <= 2200 karakter.
function normalizeCaption(raw: string): string {
  const cleaned = fixSpelling(String(raw || "").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim());
  const { body, tags } = splitTrailingHashtags(cleaned);
  const tagLine = buildTagLine(tags);
  const fitted = fitBody(body, IG_MAX_CHARS - tagLine.length - 2);
  return fitted ? `${fitted}\n\n${tagLine}` : tagLine;
}

// Jumlah slide tertinggi yang disebut di teks gambar carousel ("Slide 5: ..." atau rentang "Slide 2-4").
function maxSlideNumber(teks: string): number {
  let max = 0;
  for (const m of teks.matchAll(/slide\s*(\d+)(?:\s*[-\u2013]\s*(\d+))?/gi)) {
    max = Math.max(max, Number(m[1]), m[2] ? Number(m[2]) : 0);
  }
  return max;
}


// ===== Validator kejujuran (aturan pola-konten.md bagian 7, ditegakkan di server) =====
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
const PROMISE_RE = /pasti\s+(mabrur|berangkat|diterima|dikabulkan|ada)|dijamin|jaminan\s+(berangkat|mabrur)|100\s*%\s*(mabrur|berangkat)/i;
const IBADAH_RE = /\b(doa|tata\s*cara|niat|lafaz|talbiyah|hukum|wajib|rukun|sunnah|sunah|haram|ihram|thawaf|tawaf|sa'?i|tahallul|miqat)\b/i;
const CAPTION_MIN = 500; // pola: sekitar 600-1200 karakter; toleransi sedikit
const CAPTION_MAX = 1500;
const CEK_PEMBIMBING = "[cek pembimbing]";

// Return alasan penolakan (string) atau "" kalau lolos. Item yang ditolak dibuang; slotnya dicoba ulang frontend.
function tolakAlasan(it: { tema: string; teks_gambar: string; draft_caption: string }): string {
  const all = `${it.tema}\n${it.teks_gambar}\n${it.draft_caption}`;
  if (ARABIC_RE.test(all)) return "memuat teks Arab (dilarang mengarang lafaz/ayat/doa)";
  if (PROMISE_RE.test(all)) return "memuat janji berlebihan";
  const bodyLen = it.draft_caption.replace(TAG_RE, "").trim().length;
  if (bodyLen < CAPTION_MIN) return `caption terlalu pendek (${bodyLen} karakter)`;
  if (bodyLen > CAPTION_MAX) return `caption terlalu panjang (${bodyLen} karakter)`;
  return "";
}

// Tandai "[cek pembimbing]" otomatis di akhir tema kalau isinya soal tata cara/hukum/doa.
function tandaiCekPembimbing(tema: string, teksGambar: string, caption: string): string {
  if (/\[cek pembimbing\]/i.test(tema)) return tema;
  if (!IBADAH_RE.test(`${tema}\n${teksGambar}\n${caption}`)) return tema;
  const base = tema.slice(0, 200 - CEK_PEMBIMBING.length - 1).trim();
  return `${base} ${CEK_PEMBIMBING}`;
}

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

  const authFail = await requireStaff(req);
  if (authFail) return authFail;

  try {
    const body = await req.json();
    const { bulanLabel, jumlahPost, tanggalMulai, tanggalAkhir, konteksProgram, arahan, ideSudahAda, riwayatTema, riwayatGaya, slots, temaMinggu, temaMingguDepan, konteksPekan } = body || {};

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

    const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
    const tema = clip(temaMinggu, 120);
    const temaDepan = clip(temaMingguDepan, 120);
    const pekanCtx = clip(konteksPekan, 3000);
    const programCtx = konteksProgram && String(konteksProgram).trim() ? String(konteksProgram) : "(tidak ada data program spesifik untuk periode ini)";

    const userMsg = `Susun paket konten Instagram yang saling menyambung untuk ${bulanLabel} (rentang tanggal ${tanggalMulai} s/d ${tanggalAkhir}), sebanyak TEPAT ${jumlah} ide post.

${tema ? `TEMA MINGGU: ${tema}` : "TEMA MINGGU: (tidak diisi, pilih sendiri satu tema yang belum ada di riwayat)"}
${temaDepan ? `TEMA PEKAN DEPAN (untuk teaser penutup Minggu): ${temaDepan}` : ""}
${slotList.length ? `\nDAFTAR SLOT TANGGAL (isi TEPAT 1 ide per slot, tanggal persis sama, ikuti pilar & tipe_konten-nya):\n${slotList.map((s) => `- ${s.tanggal}${s.hari ? ` (${s.hari})` : ""} | pilar: ${s.pilar} | tipe_konten: ${s.tipe_konten}`).join("\n")}` : ""}
${pekanCtx ? `\nKONTEKS PEKAN (hari lain di pekan ini yang sudah jadi; sambungkan, jangan ulangi sudutnya):\n${pekanCtx}` : ""}
${arahan && String(arahan).trim() ? `\nARAHAN TAMBAHAN DARI ADMIN:\n${String(arahan).slice(0, 1500)}` : ""}

KONTEKS PROGRAM (hanya dipakai kalau ARAHAN TAMBAHAN meminta info program):
${programCtx}
${ideSudahAda && String(ideSudahAda).trim() ? `\nIDE YANG SUDAH ADA (jangan diulang):\n${String(ideSudahAda).slice(0, 4000)}` : ""}
${riwayatTema && String(riwayatTema).trim() ? `\nRIWAYAT TEMA, SUDAH PERNAH DIBUAT (jangan diulang & jangan dibuat mirip):\n${String(riwayatTema).slice(0, 20000)}` : ""}
${riwayatGaya && String(riwayatGaya).trim() ? `\nHOOK & PEMBUKA CAPTION 20 POSTING TERAKHIR (hook dan 3 kata pertama pembuka caption TIDAK boleh sama atau mirip dengan ini):\n${String(riwayatGaya).slice(0, 6000)}` : ""}

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
        tema: fixSpelling(String(it.tema).trim().slice(0, 200)),
        tipe_konten: VALID_TYPES.has(String(it.tipe_konten)) ? String(it.tipe_konten) : "image",
        pilar: VALID_PILARS.has(String(it.pilar)) ? String(it.pilar) : null,
        teks_gambar: it.teks_gambar ? fixSpelling(String(it.teks_gambar).trim().slice(0, 700)) : "",
        draft_caption: normalizeCaption(String(it.draft_caption)),
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
    // Validator kejujuran & panjang caption; tandai [cek pembimbing] otomatis.
    const ditolak: string[] = [];
    cleaned = cleaned
      .filter((it) => {
        const alasan = tolakAlasan(it);
        if (alasan) ditolak.push(`${it.tanggal}: ${alasan}`);
        return !alasan;
      })
      .map((it) => ({ ...it, tema: tandaiCekPembimbing(it.tema, it.teks_gambar, it.draft_caption) }));
    if (ditolak.length) console.warn("generate-ig-content-plan: item ditolak validator ->", ditolak.join(" | "));
    // Carousel maksimal 5 slide (dicek SETELAH tipe dipaksa mengikuti slot): ide yang melebihi dibuang,
    // slotnya dicoba ulang oleh frontend.
    cleaned = cleaned.filter((it) => it.tipe_konten !== "carousel" || maxSlideNumber(it.teks_gambar) <= MAX_CAROUSEL_SLIDES);
    cleaned = cleaned.slice(0, jumlah);

    if (!cleaned.length && ditolak.length) {
      // Semua ditolak validator (bukan error): kembalikan kosong supaya frontend mencoba ulang slotnya.
      return new Response(JSON.stringify({ items: [], ditolak, versi: 4 }), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    if (!cleaned.length) {
      throw new Error("Semua item hasil AI tidak valid (tanggal di luar rentang bulan atau data kurang lengkap). Coba generate ulang.");
    }

    return new Response(JSON.stringify({ items: cleaned, versi: 4 }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err as Error)?.message || err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
