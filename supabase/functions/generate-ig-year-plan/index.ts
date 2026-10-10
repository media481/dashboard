// Supabase Edge Function: generate-ig-year-plan
// Menyusun RENCANA TEMA PER PEKAN untuk setahun (atau sebagian) sekaligus: tema tiap pekan
// dipilih AI dengan memperhitungkan program keberangkatan (fase promosi), musim (Hijriah/Masehi),
// alur perjalanan jamaah, dan tema yang sudah dipakai. Dipanggil oleh js/app.js (igRtSusunAI)
// dari tombol "Susun Rencana Setahun" di modal Rencana Konten. Hasilnya disimpan frontend ke
// tabel ig_rencana_tahunan; isi harian TIDAK dibuat di sini (itu tugas generate-ig-content-plan).
//
// Kontrak (dipakai oleh js/app.js -> igRtPanggilAI):
//   POST body: {
//     pekan: [{ senin, minggu, hijri, masehi, program? }],  // pekan yang HARUS diisi (maks 30 per panggilan)
//                                  // hijri = nama bulan Hijriah tengah pekan (boleh kosong), masehi = nama bulan Masehi,
//                                  // program = teks fase promosi program pada pekan itu (boleh kosong)
//     konteksProgram?: string,     // ringkasan program aktif (nama, tanggal berangkat, harga, sisa seat)
//     riwayatTema?: string,        // tema yang SUDAH terpakai (satu per baris) -> wajib dihindari
//     konteksSekitar?: string,     // pekan lain yang sudah punya tema (terkunci / batch sebelumnya): "senin | tema"
//     bankAlur?: string[],         // daftar tema alur perjalanan jamaah (bahan, bukan keharusan)
//     bankMusim?: string,          // daftar tema musiman + kapan idealnya tayang (bahan)
//     arahan?: string              // arahan tambahan dari admin
//   }
//   Header: Authorization: Bearer <access_token sesi login dashboard> (admin/user). Anon key saja DITOLAK (401).
//   Response: { items: [{ senin, tema, alasan, fokus_program }], ditolak?: [...], versi: 1 }
//   Jaminan: senin = salah satu pekan yang diminta (tanpa duplikat), tema 1 baris <= 80 karakter dan tidak
//   kembar dengan riwayat/antarpekan (cek normalisasi sederhana; cek kemiripan lanjutan dilakukan frontend),
//   alasan <= 200 karakter tanpa tanda pisah panjang.
//
// Deploy:
//   supabase functions deploy generate-ig-year-plan --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Helper Gemini (fallback multi-key) digabung langsung di sini supaya file berdiri sendiri
// (pola sama dengan generate-ig-content-plan). Key: GEMINI_API_KEY, lalu GEMINI_API_KEY_2 s/d _5.
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

const FALLBACK_MODELS = ["gemini-3.5-flash-lite"];
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [3000];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// deno-lint-ignore no-explicit-any
async function callGeminiWithFallback(model: string, body: Record<string, unknown>): Promise<any> {
  const keys = getGeminiApiKeys();
  if (!keys.length) throw new Error("GEMINI_API_KEY belum di-set di Supabase secrets");
  let lastError = "";

  async function tryModel(m: string): Promise<{ data: unknown | null; retryable: boolean }> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
    let retryable = false;
    for (let i = 0; i < keys.length; i++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": keys[i] },
          body: JSON.stringify(body),
        });
        if (res.ok) return { data: await res.json(), retryable: false };
        const errText = await res.text();
        if (RETRYABLE_STATUS.has(res.status)) retryable = true;
        lastError = `Gemini API error (${res.status}) [${m}, key #${i + 1}/${keys.length}]: ${errText.slice(0, 300)}`;
        console.warn(lastError);
      } catch (networkErr) {
        retryable = true;
        lastError = `Network error saat panggil Gemini [${m}, key #${i + 1}/${keys.length}]: ${String((networkErr as Error)?.message || networkErr)}`;
        console.warn(lastError);
      }
    }
    return { data: null, retryable };
  }

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const r = await tryModel(model);
    if (r.data) return r.data;
    if (!r.retryable || attempt === RETRY_DELAYS_MS.length) break;
    await sleep(RETRY_DELAYS_MS[attempt]);
  }
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

const jsonResp = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

// Hanya akun dashboard ber-role admin/user (pola sama dengan generate-ig-content-plan): token diverifikasi
// ke Supabase Auth + role dicek ke dashboard_profiles, supaya kuota Gemini tidak bisa dihabiskan orang luar.
async function requireStaff(req: Request): Promise<Response | null> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return jsonResp({ error: "Harus login dulu (token tidak ada)" }, 401);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { data: userRes, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userRes?.user) return jsonResp({ error: "Sesi login tidak valid atau sudah berakhir, silakan login ulang" }, 401);
  const { data: profile } = await admin.from("dashboard_profiles").select("dashboard_role").eq("id", userRes.user.id).single();
  if (!profile || !["admin", "user"].includes(profile.dashboard_role)) {
    return jsonResp({ error: "Akun Anda tidak punya izin memakai fitur AI ini" }, 403);
  }
  return null;
}

const GEMINI_MODEL = "gemini-3.5-flash";
const MAKS_PEKAN = 30;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SYSTEM_PROMPT = `Kamu adalah content strategist untuk biro umroh "Amiru Tour" (PT Amiru Haramain Indonesia). Tugasmu menyusun RENCANA TEMA PER PEKAN untuk akun Instagram selama berbulan-bulan ke depan. Satu pekan = satu tema; tujuh posting harian (Senin-Minggu) nanti dibuat dari tema itu oleh proses lain. Kamu HANYA menentukan tema tiap pekan.

TUJUAN RENCANA:
1. Menyambung: tema antarpekan terasa satu cerita perjalanan calon jamaah (niat > persiapan > ihram > thawaf > sa'i > Madinah > pulang), bukan loncat acak. Tapi boleh menyelipkan tema musiman atau tema program di tempat yang pas, lalu kembali ke alur.
2. Seimbang: campur tema yang menyentuh hati (rindu, niat, doa, keluarga, makna) dan tema yang praktis dan berpikir (dokumen, fisik, perlengkapan, biaya, manasik). Jangan tiga pekan berturut-turut bernuansa sama.
3. Mengarah ke penjualan secara halus: tema musiman yang laku dijual (Ramadhan, libur sekolah, libur akhir tahun, musim haji) ditayangkan 2-3 bulan SEBELUM musimnya, karena calon jamaah memesan jauh hari. Pekan menjelang keberangkatan sebuah program mengikuti fasenya (Kenalkan > Isi paket > Seat menipis > Penutupan): kalau sebuah pekan punya keterangan "program", tema pekan itu harus memberi ruang bagi program tersebut (misalnya tema persiapan atau tema yang relevan dengan jenis perjalanannya), tanpa memaksa semua pekan jadi jualan.
4. Tidak berulang: tiap tema BERBEDA dari RIWAYAT TEMA, dari tema di KONTEKS SEKITAR, dan dari tema pekan lain dalam jawabanmu (beda topik inti, bukan sekadar ganti kata). Satu topik inti hanya sekali dalam rentang yang diminta.

ATURAN TEMA:
- "tema" = frasa singkat 2-6 kata, seperti judul bab (contoh gaya: "Persiapan Fisik", "Miqat dan Ihram", "Umroh Bersama Orang Tua", "Rencanakan Umroh di Bulan Ramadhan"). Tanpa tanda baca di ujung, tanpa tanda pisah panjang, tanpa tanda kutip, tanpa nomor.
- Tema harus bisa dibahas dari tujuh sudut berbeda dalam seminggu, jadi jangan terlalu sempit (bukan satu doa tertentu) dan jangan terlalu lebar (bukan "Ibadah").
- Ejaan selalu "Umroh" (bukan "Umrah"). Pakai bahasa Indonesia.
- JANGAN mengarang ayat, hadis, doa berbahasa Arab, angka statistik, harga, atau fasilitas. Tema soal hukum/tata cara ibadah cukup judul umum.
- Tema pekan yang dekat Hari Besar (Ramadhan, Isra Miraj, awal tahun Hijriah, Dzulhijjah) boleh mengikuti bulan Hijriah yang diberikan di tiap pekan, tapi pakai HANYA bulan yang tertulis, jangan menghitung sendiri.
- Kalau ada ARAHAN dari admin, utamakan arahan itu selama tidak melanggar aturan di atas.

"alasan" = SATU kalimat (maks. 25 kata) kenapa tema ini cocok di pekan ini (musim, fase program, kelanjutan alur, atau penyeimbang pekan sebelumnya). Tulis jujur dan spesifik, tanpa tanda pisah panjang.
"fokus_program" = nama program (persis seperti di KONTEKS PROGRAM) yang menjadi jangkar pekan ini, atau string kosong kalau tidak ada.

FORMAT OUTPUT: JSON array murni (tanpa code fence, tanpa teks lain). Satu elemen per pekan yang diminta: { "senin": "YYYY-MM-DD" (persis seperti di daftar pekan), "tema": string, "alasan": string, "fokus_program": string }. Jumlah elemen HARUS sama dengan jumlah pekan yang diminta, tanpa duplikat tanggal, urut tanggal.`;

interface Pekan { senin: string; minggu: string; hijri: string; masehi: string; program: string }
interface Item { senin: string; tema: string; alasan: string; fokus_program: string }

function isRealDate(str: string): boolean {
  if (!DATE_RE.test(str)) return false;
  const [y, m, d] = str.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function isMonday(str: string): boolean {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1;
}

// Rapikan teks: buang tanda pisah panjang/titik koma, ejaan Umroh, spasi ganda.
function rapikan(t: unknown, maks: number): string {
  if (typeof t !== "string") return "";
  return t
    .replace(/[\u2013\u2014]/g, ",")
    .replace(/;/g, ",")
    .replace(/\bUmrah\b/g, "Umroh").replace(/\bumrah\b/g, "umroh")
    .replace(/["\u201c\u201d]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/[.,:\s]+$/g, "")
    .trim()
    .slice(0, maks);
}
function norm(t: string): string {
  return t.toLowerCase().replace(/['`\u2019]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function susunPesan(p: {
  pekan: Pekan[]; konteksProgram: string; riwayatTema: string; konteksSekitar: string;
  bankAlur: string[]; bankMusim: string; arahan: string; catatan: string;
}): string {
  const daftar = p.pekan.map((w, i) =>
    `${i + 1}. ${w.senin} s/d ${w.minggu} | Hijriah: ${w.hijri || "-"} | Masehi: ${w.masehi || "-"}${w.program ? ` | Program: ${w.program}` : ""}`).join("\n");
  const bagian = [
    `DAFTAR PEKAN YANG HARUS DIISI (${p.pekan.length} pekan, isi TEPAT satu tema per pekan):\n${daftar}`,
    `KONTEKS PROGRAM (jangan mengarang data di luar daftar ini):\n${p.konteksProgram || "(tidak ada program aktif yang akan berangkat)"}`,
    p.konteksSekitar ? `KONTEKS SEKITAR (pekan lain yang sudah punya tema; sambungkan, jangan diulang):\n${p.konteksSekitar}` : "",
    p.riwayatTema ? `RIWAYAT TEMA (sudah terpakai, WAJIB dihindari):\n${p.riwayatTema}` : "RIWAYAT TEMA: (belum ada)",
    p.bankAlur.length ? `BAHAN ALUR PERJALANAN JAMAAH (urutan kasar; boleh dipakai, diubah, atau diganti tema lain yang setara):\n${p.bankAlur.join("; ")}` : "",
    p.bankMusim ? `BAHAN TEMA MUSIMAN (kapan idealnya tayang):\n${p.bankMusim}` : "",
    p.arahan ? `ARAHAN DARI ADMIN:\n${p.arahan}` : "",
    p.catatan,
  ].filter(Boolean);
  return bagian.join("\n\n");
}

function skemaRespons() {
  return {
    type: "ARRAY",
    items: {
      type: "OBJECT",
      properties: {
        senin: { type: "STRING", description: "YYYY-MM-DD persis seperti di daftar pekan" },
        tema: { type: "STRING", description: "Tema pekan, 2-6 kata" },
        alasan: { type: "STRING", description: "Satu kalimat alasan" },
        fokus_program: { type: "STRING", description: "Nama program jangkar atau string kosong" },
      },
      required: ["senin", "tema", "alasan", "fokus_program"],
    },
  };
}

// deno-lint-ignore no-explicit-any
function ambilTeks(g: any): string {
  const parts = g?.candidates?.[0]?.content?.parts || [];
  return parts.map((p: { text?: string }) => p?.text || "").join("").trim();
}
function stripJsonFence(t: string): string {
  return t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

async function panggilItems(pesan: string): Promise<unknown[]> {
  const think = String(Deno.env.get("IG_PLAN_THINKING_LEVEL") || "").toLowerCase();
  const g = await callGeminiWithFallback(GEMINI_MODEL, {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: pesan }] }],
    generationConfig: {
      responseMimeType: "application/json",
      ...(Deno.env.get("IG_PLAN_RESPONSE_SCHEMA") === "off" ? {} : { responseSchema: skemaRespons() }),
      temperature: 1,
      ...(["low", "medium", "high"].includes(think) ? { thinkingConfig: { thinkingLevel: think } } : {}),
    },
  });
  const raw = ambilTeks(g);
  if (!raw) {
    const fr = g?.candidates?.[0]?.finishReason;
    throw new Error(`Gemini tidak mengembalikan hasil.${fr ? ` (finishReason: ${fr})` : ""}`);
  }
  let items: unknown;
  try { items = JSON.parse(stripJsonFence(raw)); }
  catch (e) { throw new Error(`Gagal parse JSON dari Gemini: ${String((e as Error)?.message || e)}`); }
  if (!Array.isArray(items) || !items.length) throw new Error("Gemini tidak menghasilkan daftar tema yang valid (array kosong).");
  return items;
}

// Bersihkan & validasi satu putaran. Return item lolos + alasan penolakan per tanggal.
function olahHasil(items: unknown[], pekan: Pekan[], terpakai: Set<string>): { lolos: Item[]; alasan: Map<string, string> } {
  const valid = new Set(pekan.map((w) => w.senin));
  const alasan = new Map<string, string>();
  const lolos: Item[] = [];
  const dipakai = new Set(terpakai);
  for (const raw of items as Record<string, unknown>[]) {
    if (!raw || typeof raw !== "object") continue;
    const senin = typeof raw.senin === "string" ? raw.senin.trim() : "";
    if (!valid.has(senin)) continue;                               // tanggal di luar daftar: abaikan
    if (lolos.some((x) => x.senin === senin)) continue;            // duplikat tanggal: ambil yang pertama
    const tema = rapikan(raw.tema, 80);
    if (!tema || tema.split(" ").length > 8) { alasan.set(senin, "tema kosong atau terlalu panjang (maks. 6 kata)"); continue; }
    const n = norm(tema);
    if (dipakai.has(n)) { alasan.set(senin, `tema "${tema}" sudah dipakai, pilih topik inti yang berbeda`); continue; }
    dipakai.add(n);
    lolos.push({
      senin, tema,
      alasan: rapikan(raw.alasan, 200),
      fokus_program: rapikan(raw.fokus_program, 120),
    });
    alasan.delete(senin);
  }
  return { lolos, alasan };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);

  const authFail = await requireStaff(req);
  if (authFail) return authFail;

  try {
    const body = await req.json();
    const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

    const pekan: Pekan[] = (Array.isArray(body?.pekan) ? body.pekan : [])
      .filter((w: Record<string, unknown>) => w && isRealDate(String(w.senin)) && isMonday(String(w.senin)) && isRealDate(String(w.minggu)))
      .slice(0, MAKS_PEKAN)
      .map((w: Record<string, unknown>) => ({
        senin: String(w.senin), minggu: String(w.minggu),
        hijri: clip(w.hijri, 30), masehi: clip(w.masehi, 30), program: clip(w.program, 300),
      }));
    if (!pekan.length) return jsonResp({ error: "pekan wajib diisi (tanggal Senin yang valid)" }, 400);
    pekan.sort((a, b) => a.senin.localeCompare(b.senin));

    const dasar = {
      konteksProgram: clip(body?.konteksProgram, 4000),
      konteksSekitar: clip(body?.konteksSekitar, 3000),
      bankAlur: (Array.isArray(body?.bankAlur) ? body.bankAlur : []).map((x: unknown) => clip(x, 60)).filter(Boolean).slice(0, 80),
      bankMusim: clip(body?.bankMusim, 2500),
      arahan: clip(body?.arahan, 800),
    };
    const riwayat = clip(body?.riwayatTema, 5000);
    const terpakai = new Set<string>(riwayat.split("\n").map((l) => norm(l)).filter(Boolean));

    // Putaran 0: semua pekan.
    const items0 = await panggilItems(susunPesan({ ...dasar, pekan, riwayatTema: riwayat, catatan: "" }));
    const r0 = olahHasil(items0, pekan, terpakai);
    let lolos = r0.lolos;
    const alasanAkhir = new Map<string, string>(r0.alasan);

    // Pekan yang hilang dari jawaban ikut dianggap perlu diisi.
    const kurang = () => pekan.filter((w) => !lolos.some((x) => x.senin === w.senin));
    kurang().forEach((w) => { if (!alasanAkhir.has(w.senin)) alasanAkhir.set(w.senin, "tidak ada tema untuk pekan ini"); });

    // Satu putaran perbaikan terarah: hanya pekan yang gagal, dengan alasan + tema yang sudah lolos sebagai konteks.
    const perlu = kurang();
    if (perlu.length) {
      try {
        const catatan = "CATATAN PERBAIKAN: pekan di bawah ini gagal pada percobaan sebelumnya. Isi HANYA pekan yang ada di DAFTAR PEKAN, dan perbaiki sebabnya:\n"
          + perlu.map((w) => `- ${w.senin}: ${alasanAkhir.get(w.senin)}`).join("\n");
        const sekitar = [dasar.konteksSekitar, ...lolos.map((x) => `${x.senin} | ${x.tema}`)].filter(Boolean).join("\n").slice(0, 3500);
        const riwayatK = [riwayat, ...lolos.map((x) => x.tema)].filter(Boolean).join("\n").slice(0, 5500);
        const itemsK = await panggilItems(susunPesan({ ...dasar, pekan: perlu, konteksSekitar: sekitar, riwayatTema: riwayatK, catatan }));
        const terpakaiK = new Set<string>([...terpakai, ...lolos.map((x) => norm(x.tema))]);
        const rk = olahHasil(itemsK, perlu, terpakaiK);
        lolos = [...lolos, ...rk.lolos];
        rk.lolos.forEach((x) => alasanAkhir.delete(x.senin));
        rk.alasan.forEach((v, k) => alasanAkhir.set(k, v));
      } catch (e) {
        // Perbaikan hanya bonus: hasil putaran pertama tetap dipakai.
        console.warn("generate-ig-year-plan: putaran perbaikan gagal ->", String((e as Error)?.message || e));
      }
    }

    lolos.sort((a, b) => a.senin.localeCompare(b.senin));
    const ditolak: string[] = [];
    alasanAkhir.forEach((v, k) => { if (!lolos.some((x) => x.senin === k)) ditolak.push(`${k}: ${v}`); });
    if (ditolak.length) console.warn("generate-ig-year-plan: pekan ditolak ->", ditolak.join(" | "));

    if (!lolos.length) {
      return jsonResp({ items: [], ditolak, versi: 1 });
    }
    return jsonResp({ items: lolos, ...(ditolak.length ? { ditolak } : {}), versi: 1 });
  } catch (err) {
    return jsonResp({ error: String((err as Error)?.message || err) }, 500);
  }
});
