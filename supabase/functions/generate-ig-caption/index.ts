// Supabase Edge Function: generate-ig-caption
// Menyusun caption Instagram (feed post/carousel/reels) dari ide/konsep
// singkat, dipanggil oleh js/app.js (generateIgCaptionAI) lewat tombol
// "Generate dengan AI" di modal IG Scheduler. Aturan caption mengikuti pola-konten.md
// (gaya sastrawi membumi, 3-5 paragraf pendek 600-1200 karakter, 5 hashtag, tanpa video).
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
//     tujuan?: "storytelling"|"edukasi"|"manasik"|"kontemplasi"|"promo"|"testimoni"|"engagement"   (default "promo")
//              (pola 7 hari menyambung, lihat pola-konten.md: storytelling/edukasi/manasik/kontemplasi;
//               promo/testimoni/engagement sedang dijeda tapi tetap didukung)
//     mediaType?: "image"|"video"|"carousel"                               (default "image")
//     hindari?: string        // caption hasil generate sebelumnya -> AI wajib ganti sudut & pembuka
//     konteks?: string        // konteks seri mingguan dari rencana (hari/peran, Tema Minggu, teks di gambar,
//                             // tema hari sebelumnya & sesudahnya) -> caption menyambung, bukan berdiri sendiri
//   }
//   Response: { text: string, warnings: string[], versi: 2 }
//     text     = caption final (sudah dirapikan: ejaan "Umroh", 5 hashtag, <= 2200 karakter)
//     warnings = angka di caption yang tidak ada di konsep (cek manual sebelum posting)
//
// File ini BERDIRI SENDIRI (helper Gemini & pasca-proses digabung di bawah), jadi bisa dideploy
// lewat Supabase Dashboard (paste satu file) maupun CLI:
//   supabase functions deploy generate-ig-caption --no-verify-jwt
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ===== Helper Gemini (fallback multi-key + retry + model cadangan) =====
// Logika sama dengan _shared/gemini.ts, digabung di sini supaya tidak bergantung
// pada folder lain saat deploy lewat Dashboard.
// MARKER_BEGIN_PURE
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

// Opsi tambahan (OPT-IN — tanpa opsi, perilaku sama persis seperti sebelumnya):
//   fallbackModels : model cadangan yang dicoba kalau model utama gagal di SEMUA key
//                    (503 "high demand" berlaku untuk seluruh model, jadi memutar key saja
//                    tidak menolong).
//   retryDelaysMs  : jeda sebelum putaran ulang model utama, khusus kalau kegagalannya
//                    sementara (429/5xx/jaringan). Mis. [2500] = 1x ulang setelah 2,5 detik.
interface GeminiOptions {
  fallbackModels?: string[];
  retryDelaysMs?: number[];
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Panggil generateContent untuk 1 model, coba tiap key di getGeminiApiKeys()
// berurutan sampai ada yang berhasil (HTTP 2xx). Return JSON response Gemini
// mentah (pemanggil yang parsing candidates/parts sesuai kebutuhan masing-masing).
async function callGeminiWithFallback(
  model: string,
  body: Record<string, unknown>,
  options: GeminiOptions = {},
  // deno-lint-ignore no-explicit-any
): Promise<any> {
  const keys = getGeminiApiKeys();
  if (!keys.length) {
    throw new Error("GEMINI_API_KEY belum di-set di Supabase secrets");
  }

  let lastError = "";

  // Satu putaran = semua key untuk 1 model. data=null kalau gagal; retryable=true kalau
  // gagalnya sementara sehingga layak dicoba ulang.
  async function tryModel(m: string): Promise<{ data: unknown | null; retryable: boolean }> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
    let retryable = false;
    for (let i = 0; i < keys.length; i++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          // Key lewat header (bukan ?key=) supaya tidak ikut tercetak di log/URL error.
          headers: { "Content-Type": "application/json", "x-goog-api-key": keys[i] },
          body: JSON.stringify(body),
        });
        if (res.ok) return { data: await res.json(), retryable: false };

        const errText = await res.text();
        if (RETRYABLE_STATUS.has(res.status)) retryable = true;
        lastError = `Gemini API error (${res.status}) [${m}, key #${i + 1}/${keys.length}]: ${errText.slice(0, 300)}`;
        console.warn(lastError);
        // Lanjut ke key berikutnya — murah untuk dicoba, dan 1 key bermasalah
        // tidak boleh mematikan seluruh fitur AI.
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

  // 1) Model utama (+ putaran ulang berjeda kalau gagalnya sementara)
  const delays = options.retryDelaysMs ?? [];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const r = await tryModel(model);
    if (r.data) return r.data;
    if (!r.retryable || attempt === delays.length) break;
    await sleep(delays[attempt]);
  }

  // 2) Model cadangan
  for (const fb of options.fallbackModels ?? []) {
    if (fb === model) continue;
    const r = await tryModel(fb);
    if (r.data) return r.data;
  }

  throw new Error(`Semua ${keys.length} GEMINI_API_KEY gagal dipakai. Error terakhir: ${lastError}`);
}

// ===== Pasca-proses caption (fungsi murni) =====
const IG_MAX_CHARS = 2200;
const MAX_HASHTAGS = 5;
// Selalu ada di setiap caption (sesuai Pola Amiru di generate-ig-content-plan).
const REQUIRED_HASHTAGS = ["#UmrohBersamaAmiru", "#AmiruTour"];

const TAG_RE = /#[\p{L}\p{N}_]+/gu;
const TAG_ONLY_LINE_RE = /^\s*(#[\p{L}\p{N}_]+\s*)+$/u;

// Ejaan resmi "Umroh" — termasuk di dalam hashtag (#UmrahMurah -> #UmrohMurah).
function fixSpelling(t: string): string {
  return t.replace(/umrah/gi, (m) => (m === m.toUpperCase() ? "UMROH" : m[0] === "U" ? "Umroh" : "umroh"));
}

// Buang code fence & label struktur ("Hook:", "CTA:", ...) yang bocor ke output.
function stripWrappers(raw: string): string {
  let t = (raw || "").trim();
  t = t.replace(/^```[a-z]*\s*\n?/i, "").replace(/\n?```\s*$/, "").trim();
  t = t.replace(/^\s*\**(caption|hook|body|isi|cta|hashtags?)\**\s*:\s*\**/gim, "");
  return t.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}

// Pisahkan blok hashtag di akhir dari isi caption.
function splitTrailingHashtags(t: string): { body: string; tags: string[] } {
  const lines = t.split("\n");
  const tags: string[] = [];
  while (lines.length && (lines[lines.length - 1].trim() === "" || TAG_ONLY_LINE_RE.test(lines[lines.length - 1]))) {
    const line = lines.pop() as string;
    tags.unshift(...(line.match(TAG_RE) || []));
  }
  return { body: lines.join("\n").trim(), tags };
}

function buildTagLine(tags: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of [...REQUIRED_HASHTAGS, ...tags]) {
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

function normalizeCaption(raw: string): string {
  const cleaned = fixSpelling(stripWrappers(raw));
  const { body, tags } = splitTrailingHashtags(cleaned);
  const tagLine = buildTagLine(tags);
  const fitted = fitBody(body, IG_MAX_CHARS - tagLine.length - 2);
  return fitted ? `${fitted}\n\n${tagLine}` : tagLine;
}

// Angka (>= 2 digit) di output yang TIDAK ada di input = kandidat angka karangan
// (harga/tanggal/kuota). Hanya peringatan, bukan pemblokiran: format bisa beda
// ("28 juta" vs "28.000.000"), jadi keputusan akhir tetap di admin.
function numbersIn(s: string): Set<string> {
  const noTags = s.replace(TAG_RE, " ");
  const found = noTags.match(/\d[\d.,]*/g) || [];
  return new Set(found.map((x) => x.replace(/[.,]+$/, "").replace(/[.,]/g, "")).filter((x) => x.length >= 2));
}

function findUnknownNumbers(input: string, output: string): string[] {
  const known = numbersIn(input);
  return [...numbersIn(output)].filter((n) => !known.has(n));
}
// MARKER_END_PURE


const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GEMINI_MODEL = "gemini-3.5-flash";
const FALLBACK_MODELS = ["gemini-3.5-flash-lite"];
const RETRY_DELAYS_MS = [2500];
const MAX_INPUT_CHARS = 4000;

type Tujuan = "promo" | "storytelling" | "edukasi" | "manasik" | "kontemplasi" | "testimoni" | "engagement";
type MediaType = "image" | "video" | "carousel";

const TUJUAN_GUIDE: Record<Tujuan, string> = {
  storytelling:
    "STORYTELLING (peran Rasakan / Bayangkan / Terinspirasi). Bangun suasana & perasaan (rindu, tenang, haru) dari satu momen konkret yang bisa dibayangkan. EMOSIONAL: pembukaan = suasana/refleksi; isi = hubungkan dengan pengalaman batin jamaah seolah kita melihat momennya; penutup = pertanyaan hangat tentang rindu/doa + satu kalimat doa penutup sederhana dalam Bahasa Indonesia. Jualan sangat halus, CTA ringan. Kalau berupa cerita manusiawi, tulis sebagai ilustrasi/umum (\"banyak jamaah bercerita...\"), BUKAN klaim kejadian nyata.",
  edukasi:
    "EDUKASI (peran Siapkan / Hindari). PRAKTIS: pembukaan = masalah yang relatable; isi = 1-3 poin ringkas yang berguna dan layak disimpan (persiapan, kesalahan umum); penutup = ajakan simpan/kirim ke teman + CTA ringan \"chat WA aja ya\".",
  manasik:
    "MANASIK (peran Pahami). PRAKTIS: kartu tata cara/doa yang mudah disimpan. Pembukaan = masalah relatable (mis. bingung caranya); isi = poin ringkas; penutup = ajakan simpan/kirim + CTA ringan. Soal lafaz, doa, dan tata cara tulis secara umum dan sebut \"sesuai manasik dari pembimbing\" — tanpa fatwa dan tanpa mengarang lafaz Arab.",
  kontemplasi:
    "KONTEMPLASI (peran Renungkan). Renungan makna ibadah umroh dan hikmahnya, TANPA tokoh/cerita orang, ritme tenang dan pelan. EMOSIONAL: pembukaan = pertanyaan atau suasana renungan; isi = makna yang disentuh pelan-pelan; penutup = pertanyaan hangat + doa singkat sederhana dalam Bahasa Indonesia. Tanpa jualan.",
  promo:
    "IKLAN/PROMO (sedang dijeda dalam pola mingguan; dipakai hanya bila diminta). Tonjolkan 1-2 hal paling menjual dari konsep (harga mulai dari, tanggal berangkat, fasilitas unggulan). Boleh ada urgensi HANYA kalau konsep menyebut kuota/seat terbatas — jangan mengarang kelangkaan. CTA tegas dan mudah dilakukan (chat WA/DM).",
  testimoni:
    "BUKTI SOSIAL (sedang dijeda; dipakai hanya bila diminta). Sorot pengalaman jamaah. JANGAN mengarang kutipan atau nama jamaah — kalau tidak ada di konsep, tulis placeholder [isi kutipan asli jamaah] dan [nama jamaah, kota].",
  engagement:
    "ENGAGEMENT (sedang dijeda; dipakai hanya bila diminta). Ajukan satu pertanyaan/ajakan yang mudah dijawab di kolom komentar. Hampir tanpa jualan.",
};

const MEDIA_GUIDE: Record<MediaType, string> = {
  image: "Konten FOTO tunggal: pembuka harus bisa berdiri sendiri karena orang melihat gambarnya lebih dulu.",
  video:
    "Konten VIDEO/REELS (di luar pola mingguan yang berbasis gambar): caption jadi pelengkap video. Pembuka SANGAT singkat (<= 10 kata) dan selaras dengan 3 detik pertama video; boleh lebih ringkas dari panjang standar.",
  carousel:
    "Konten CAROUSEL (maksimal 5 slide): pembuka memancing orang menggeser dan menyebut ada beberapa slide/poin. Caption melanjutkan teks di slide, JANGAN mengulangnya.",
};

function buildSystemPrompt(tujuan: Tujuan, mediaType: MediaType): string {
  return `Kamu adalah social media specialist & copywriter untuk biro umroh "Amiru Tour" (PT Amiru Haramain Indonesia). Tugasmu mengubah ide/konsep mentah menjadi SATU caption Instagram siap posting dalam Bahasa Indonesia. Ini caption feed IG, BUKAN broadcast WhatsApp: hangat, mengalir, seperti ngobrol dengan teman — bukan daftar fasilitas berformat kaku dan bukan hard-selling.

TUJUAN POST: ${TUJUAN_GUIDE[tujuan]}
FORMAT MEDIA: ${MEDIA_GUIDE[mediaType]}

GAYA BAHASA:
- Sastrawi tapi membumi: puitis, hangat, santai. Sapa pembaca dengan "kamu". Kata sehari-hari secukupnya (nggak, aja, banget) tapi tetap sopan.
- Utamakan momen konkret yang bisa dibayangkan (gerakan, suasana, ekspresi jamaah, kekhawatiran nyata), bukan klaim umum ala brosur. Fokus ke perasaan: rindu, ketenangan, proses transisi jiwa, makna di balik ibadah.
- Terdengar manusia, bukan AI: detail spesifik (benda, bau, suara, kejadian kecil), ritme kalimat dicampur panjang dan sangat pendek, maksimal 2 tanda tanya dan 1 emoji. DILARANG pola "bukan sekadar X, tapi Y", kata "relung hati/hiruk pikuk/perjalanan spiritual/senantiasa/tentunya/sejatinya/mari kita", tanda pisah panjang, dan titik koma. Doa penutup tidak wajib; boleh berhenti dengan kalimat pendek yang menggantung. Jangan mengaku pengalaman pribadi yang dikarang.
- Hindari kata kaku: "tersedia", "silakan", "hubungi kami". Jangan membuka dengan sapaan generik ("Halo sahabat", "Assalamualaikum") atau "Siapa yang ingin...".

STRUKTUR:
1. 3-5 paragraf pendek (1-3 kalimat tiap paragraf), dipisah SATU baris kosong. Panjang isi caption (di luar hashtag) sekitar 600-1200 karakter — jangan terlalu singkat.
2. Pembukaan, isi, dan penutup mengikuti pola pada TUJUAN POST di atas.
3. Kalau konsep menyebut hari/seri mingguan (mis. "Selasa, Seri Talbiyah"), pembukaan merujuk hari sebelumnya ("Kemarin kita bahas...") dan penutup memancing hari berikutnya. Kalau konsep memuat teks di gambar, caption adalah LANJUTANNYA, bukan pengulangan.
4. CTA ringan. Kalau ada nomor WA di konsep, sebut ringkas; kalau tidak ada, JANGAN mengarang nomor — pakai "chat WA aja ya" atau "klik link di bio".
5. HASHTAG — blok terpisah di akhir (1 baris kosong sebelumnya), langsung tanpa tulisan "Hashtag:", tepat 5 hashtag: #UmrohBersamaAmiru, #AmiruTour, ditambah 3 hashtag topikal yang relevan. Tanpa spasi di dalam hashtag.

ATURAN ISI (WAJIB):
- Angka harga, tanggal, durasi, dan kuota disalin PERSIS dari konsep. JANGAN membulatkan, menghitung ulang, atau mengarang. Kalau data penting tidak ada di konsep, tulis placeholder seperti [tanggal], [harga], [nomor WA] — jangan ditebak.
- JANGAN mengarang fasilitas, nama hotel, maskapai, testimoni, nama jamaah, atau info yang tidak ada di konsep.
- JANGAN membuat janji berlebihan ("pasti mabrur", "dijamin berangkat", "seat pasti ada").
- JANGAN mengarang kutipan ayat, hadis, atau lafaz/doa berbahasa Arab. Untuk lafaz dan tata cara tulis "sesuai manasik dari pembimbing". Soal hukum ibadah tulis secara umum, tanpa fatwa.
- Ejaan selalu "Umroh" (bukan "Umrah"), termasuk di hashtag.
- Emoji secukupnya (maks 3-4 di seluruh caption).

OUTPUT: HANYA teks caption final. Tanpa kalimat pembuka/penutup dari kamu, tanpa code fence, tanpa label seperti "Hook:" atau "CTA:".`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// Hanya akun dashboard ber-role admin/user yang boleh memakai function ini. Function di-deploy dengan
// --no-verify-jwt (anon key lolos gateway), jadi token pemanggil WAJIB diverifikasi di sini: anon key
// saja (publik, tertanam di JS) tidak cukup, sehingga kuota Gemini tidak bisa dihabiskan orang luar.
// Pola sama dengan admin-create-user (cek token ke Supabase Auth + role ke dashboard_profiles).
async function requireStaff(req: Request): Promise<Response | null> {
  const deny = (msg: string, status: number) => json({ error: msg }, status);
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authFail = await requireStaff(req);
  if (authFail) return authFail;

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
    const konteks = typeof body?.konteks === "string" ? body.konteks.trim().slice(0, 1500) : "";

    // Frontend lama mengirim awalan "KONSEP/IDE:" sendiri; yang baru mengirim teks mentah.
    let prompt = /^KONSEP\/IDE:/i.test(userMsg) ? userMsg : `KONSEP/IDE:\n${userMsg}`;
    if (konteks) {
      prompt += `\n\nKONTEKS SERI MINGGUAN (caption harus menyambung dengan ini; jangan menyalin teks di gambar, jangan mengarang isi hari lain):\n${konteks}`;
    }
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
    const warnings = findUnknownNumbers(`${userMsg}\n${konteks}`, text).map(
      (n) => `Angka "${n}" ada di caption tapi tidak ada di konsep — cek sebelum posting`,
    );

    return json({ text, warnings, versi: 2 });
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
