// Supabase Edge Function: radar-risiko-jamaah
//
// RADAR RISIKO KEBERANGKATAN. Setiap kali dipanggil (manual atau cron harian) fungsi ini:
//   1. Mencari program aktif yang belum berangkat dan berangkat dalam `horizon_hari` ke depan.
//   2. Menilai tiap jamaah aktif (bukan arsip/batal) dari 4 faktor: pembayaran, visa, dokumen, paspor.
//      Bobot makin besar makin dekat tanggal berangkat (lihat `faktorUrgensi`).
//   3. Merangkum per program (skor, level, berapa jamaah siap) dan mengurutkan dari yang paling terancam.
//   4. Menyusun DRAF pengingat WA per jamaah (tautan wa.me siap klik). Tidak ada pesan yang terkirim
//      ke jamaah otomatis: admin yang menekan kirim.
//   5. Opsional: kirim ringkasan ke Telegram admin (`kirim_telegram: true`).
//
// Skor dihitung dengan aturan tetap (bukan tebakan AI) supaya bisa diaudit dan hasilnya sama untuk data yang sama.
// Fungsi ini HANYA MEMBACA data. Satu-satunya tulisan keluar adalah pesan Telegram (kalau diminta).
//
// Request  (POST, JSON, semua field opsional):
//   { program_id?: string,            // nilai satu program saja (abaikan horizon)
//     horizon_hari?: number,          // default 60, maks 365
//     kirim_telegram?: boolean,       // kirim ringkasan ke penerima Telegram (tipe 'radar', fallback 'program')
//     hanya_jika_ada_masalah?: boolean // dengan kirim_telegram: lewati kirim kalau tidak ada jamaah level tinggi/kritis
//   }
// Response: { ok, dibuat_pada, horizon_hari, programs: [...], ringkasan_teks, telegram? }
//
// Auth (salah satu):
//   a) Bearer = SUPABASE_SERVICE_ROLE_KEY persis (cron worker)
//   b) Bearer = token user yang dashboard_profiles.dashboard_role = 'admin' (data pembayaran: khusus admin)
// Header `apikey` TIDAK diterima sebagai kredensial.
//
// Butuh: sql/59_tambah_view_total_bayar.sql sudah dijalankan (view v_total_bayar).
// Deploy: supabase functions deploy radar-risiko-jamaah
//         (tanpa --no-verify-jwt: pengecekan token & role sudah di dalam kode, flag itu tidak diperlukan)
//
// ATURAN REPO: file ini berdiri sendiri (tanpa import lokal). Daftar dokumen & aturan paspor/harga di bawah
// adalah SALINAN dari js/app.js (DOKUMEN_JENIS, pasporMepetInfo, getHargaKamarJamaah). Kalau aturan di app.js
// berubah, perbarui juga di sini.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// ============================================================
// LOGIKA MURNI (diuji di test-core.mjs; tidak menyentuh jaringan/DB)
// ============================================================

// Salinan DOKUMEN_JENIS di js/app.js
export const DOKUMEN_JENIS = [
  { key: "ktp", label: "KTP", type: "copy" },
  { key: "kk", label: "KK", type: "copy" },
  { key: "paspor", label: "Paspor", type: "copy" },
  { key: "buku_nikah", label: "Buku Nikah", type: "copy" },
  { key: "akta_lahir", label: "Akta Lahir", type: "copy" },
  { key: "ijazah", label: "Ijazah", type: "copy" },
  { key: "kartu_vaksin", label: "Kartu Vaksin", type: "copy" },
  { key: "pas_photo", label: "Pas Photo 4x6", type: "single" },
];

const BULAN: Record<string, number> = {
  januari: 0, jan: 0, februari: 1, pebruari: 1, feb: 1, maret: 2, mar: 2, april: 3, apr: 3,
  mei: 4, juni: 5, jun: 5, juli: 6, jul: 6, agustus: 7, agu: 7, agt: 7, ags: 7, aug: 7,
  september: 8, sep: 8, sept: 8, oktober: 9, okt: 9, oct: 9, november: 10, nov: 10, nopember: 10,
  desember: 11, des: 11, dec: 11,
};

const MS_HARI = 86400000;

// Tanggal berangkat dari teks bebas `programs.tgl`: "17-26 SEPTEMBER 2026", "4 & 11 Oktober 2026",
// "28 September - 2 Oktober 2026". Yang dipakai adalah tanggal PERTAMA. Hasil: ms UTC tengah malam, atau null.
export function parseTglBerangkat(str: unknown): number | null {
  const s = String(str ?? "");
  const tahunM = s.match(/\b(20\d{2})\b/g);
  if (!tahunM) return null;
  const hariM = s.match(/(?<![\d])(\d{1,2})(?![\d])/);
  if (!hariM || hariM.index === undefined) return null;
  const hari = parseInt(hariM[1], 10);
  const setelah = s.slice(hariM.index + hariM[0].length);
  const kata = (setelah.match(/[a-zA-Z]+/g) || []).map((k) => BULAN[k.toLowerCase()]).filter((v) => v !== undefined);
  if (!kata.length) return null;
  const bulan = kata[0];
  let tahun = parseInt(tahunM[0], 10);
  // "28 Desember - 3 Januari 2027": hanya satu tahun, bulan awal lebih besar dari bulan akhir -> mulai di tahun sebelumnya
  if (tahunM.length === 1 && kata.length > 1 && bulan > kata[kata.length - 1]) tahun -= 1;
  if (hari < 1 || hari > 31) return null;
  const ms = Date.UTC(tahun, bulan, hari);
  return isNaN(ms) ? null : ms;
}

// Selisih hari dari HARI INI (zona Asia/Jakarta, UTC+7) ke tanggal berangkat. Negatif = sudah lewat.
export function hariMenuju(berangkatMs: number, nowMs: number): number {
  const jkt = new Date(nowMs + 7 * 3600000);
  const hariIni = Date.UTC(jkt.getUTCFullYear(), jkt.getUTCMonth(), jkt.getUTCDate());
  return Math.round((berangkatMs - hariIni) / MS_HARI);
}

export function parseRupiah(val: unknown): number {
  if (val === null || val === undefined || val === "") return 0;
  if (typeof val === "number") return val;
  const digits = String(val).replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : 0;
}

export function formatRupiah(n: number): string {
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

function parseAdl(v: unknown): Record<string, unknown> {
  try {
    if (!v) return {};
    const o = typeof v === "string" ? JSON.parse(v) : v;
    return o && typeof o === "object" ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// Salinan getHargaKamarJamaah di js/app.js: harga_custom > harga sesuai tipe kamar > harga Quad.
export function hargaJamaah(program: any, jamaah: any): number {
  const custom = parseRupiah(jamaah?.harga_custom);
  if (custom > 0) return custom;
  const adl = parseAdl(program?.admin_data_lengkap);
  const quad = parseRupiah(adl.harga_quad || program?.harga_quint);
  const triple = parseRupiah(adl.harga_triple);
  const dbl = parseRupiah(adl.harga_double);
  switch (jamaah?.tipe_kamar) {
    case "triple": return triple || quad;
    case "double": return dbl || quad;
    default: return quad;
  }
}

export function dokumenKurang(dok: any): string[] {
  const d = dok && typeof dok === "object" ? dok : {};
  return DOKUMEN_JENIS.filter((j) =>
    j.type === "copy" ? !(d[j.key + "_fc"] || d[j.key + "_asli"]) : !d[j.key]
  ).map((j) => j.label);
}

// Salinan pasporMepetInfo di js/app.js (ambang 7 bulan dari tanggal berangkat).
export function statusPaspor(pasporExp: unknown, berangkatMs: number): "belum_diisi" | "expired" | "mepet" | "ok" {
  if (!pasporExp) return "belum_diisi";
  const exp = new Date(String(pasporExp));
  if (isNaN(exp.getTime())) return "belum_diisi";
  const expMs = Date.UTC(exp.getUTCFullYear(), exp.getUTCMonth(), exp.getUTCDate());
  if (expMs < berangkatMs) return "expired";
  const batas = new Date(berangkatMs);
  batas.setUTCMonth(batas.getUTCMonth() + 7);
  return expMs < batas.getTime() ? "mepet" : "ok";
}

// Makin dekat berangkat, makin besar bobot kekurangan. Hari-H atau sudah lewat = 1.
export function faktorUrgensi(hari: number): number {
  if (hari <= 14) return 1; // dua minggu terakhir: kekurangan apa pun dihitung penuh
  if (hari <= 30) return 0.75;
  if (hari <= 45) return 0.5;
  return 0.25;
}

export function levelDariSkor(skor: number): "kritis" | "tinggi" | "sedang" | "aman" {
  if (skor >= 70) return "kritis";
  if (skor >= 40) return "tinggi";
  if (skor >= 20) return "sedang";
  return "aman";
}

export type Alasan = { kode: string; teks: string; poin: number };

// Nilai satu jamaah. Poin maksimum per faktor (sebelum dikali urgensi):
//   pembayaran 35 (sisa tagihan), visa 25 (ditolak 40 tetap), dokumen 20, paspor 20 (kadaluarsa 40 tetap).
export function nilaiJamaah(jamaah: any, program: any, totalDibayar: number, hari: number, berangkatMs: number) {
  const u = faktorUrgensi(hari);
  const alasan: Alasan[] = [];
  const harga = hargaJamaah(program, jamaah);
  const sisa = harga - totalDibayar;

  if (harga <= 0) {
    alasan.push({ kode: "harga_kosong", teks: "Harga program belum diisi, status bayar tidak bisa dinilai", poin: 0 });
  } else if (sisa > 0) {
    const rasio = sisa / harga;
    const poin = Math.round(35 * u * (0.5 + 0.5 * Math.min(1, rasio)));
    alasan.push({ kode: "belum_lunas", teks: `Sisa tagihan ${formatRupiah(sisa)} (${Math.round(rasio * 100)}% dari harga)`, poin });
  } else if (sisa < 0) {
    alasan.push({ kode: "kelebihan_bayar", teks: `Kelebihan bayar ${formatRupiah(-sisa)}, perlu dicek/refund`, poin: 0 });
  }

  const visa = jamaah?.visa_status || "belum_diajukan";
  if (visa === "ditolak") {
    alasan.push({ kode: "visa_ditolak", teks: "Visa ditolak", poin: 40 });
  } else if (visa === "belum_diajukan") {
    alasan.push({ kode: "visa_belum", teks: "Visa belum diajukan", poin: Math.round(25 * u) });
  } else if (visa === "diproses") {
    alasan.push({ kode: "visa_proses", teks: "Visa masih diproses", poin: Math.round(12 * u) });
  }

  const kurang = dokumenKurang(jamaah?.dokumen);
  if (kurang.length) {
    alasan.push({
      kode: "dokumen_kurang",
      teks: `Dokumen belum lengkap (${kurang.length}/${DOKUMEN_JENIS.length}): ${kurang.join(", ")}`,
      poin: Math.round(20 * u * (kurang.length / DOKUMEN_JENIS.length)),
    });
  }

  const sp = statusPaspor(jamaah?.paspor_exp, berangkatMs);
  if (sp === "expired") alasan.push({ kode: "paspor_expired", teks: "Paspor kadaluarsa sebelum keberangkatan", poin: 40 });
  else if (sp === "mepet") alasan.push({ kode: "paspor_mepet", teks: "Paspor berlaku kurang dari 7 bulan dari keberangkatan", poin: 20 });
  else if (sp === "belum_diisi") alasan.push({ kode: "paspor_kosong", teks: "Masa berlaku paspor belum diisi", poin: Math.round(8 * u) });

  const skor = Math.min(100, alasan.reduce((a, r) => a + r.poin, 0));
  const siap = !alasan.some((r) => r.poin > 0) && harga > 0 && sisa <= 0;
  alasan.sort((a, b) => b.poin - a.poin);
  return { skor, level: levelDariSkor(skor), alasan, siap, harga, sisa: Math.max(0, sisa) };
}

export function normalisasiWa(raw: unknown): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("0")) d = "62" + d.slice(1);
  else if (d.startsWith("8")) d = "62" + d;
  return d.startsWith("62") && d.length >= 10 && d.length <= 15 ? d : null;
}

// Draf pengingat WA untuk jamaah. Hanya memuat hal yang bisa ditindaklanjuti jamaah sendiri
// (dokumen, pelunasan, paspor); status visa urusan internal sehingga tidak dicantumkan.
// Mengembalikan null kalau tidak ada yang perlu diingatkan.
export function susunDrafWa(
  jamaah: any,
  program: any,
  nilai: ReturnType<typeof nilaiJamaah>,
  hari: number,
  profil: { brand?: string; kontakWa?: string },
): string | null {
  const baris: string[] = [];
  const kurang = dokumenKurang(jamaah?.dokumen);
  if (kurang.length) baris.push(`• Dokumen yang belum kami terima: ${kurang.join(", ")}`);
  if (nilai.harga > 0 && nilai.sisa > 0 && hari <= 45) baris.push(`• Sisa pembayaran: ${formatRupiah(nilai.sisa)}`);
  if (nilai.alasan.some((r) => r.kode === "paspor_expired" || r.kode === "paspor_mepet")) {
    baris.push("• Masa berlaku paspor perlu diperpanjang (minimal 7 bulan dari tanggal keberangkatan)");
  } else if (nilai.alasan.some((r) => r.kode === "paspor_kosong") && hari <= 45) {
    baris.push("• Mohon kirim foto halaman data paspor agar masa berlakunya bisa kami cek");
  }
  if (!baris.length) return null;
  const brand = profil.brand || "Amiru Tour";
  const penutup = profil.kontakWa ? `Jika ada kendala, hubungi kami di wa.me/${profil.kontakWa}.` : "Jika ada kendala, silakan balas pesan ini.";
  return [
    `Assalamu'alaikum Bapak/Ibu ${jamaah?.nama || ""},`,
    "",
    `Kami dari ${brand}. Keberangkatan umroh program ${program?.nama || "-"} (${program?.tgl || "-"}) tinggal ${Math.max(0, hari)} hari lagi. Agar persiapan lancar, mohon dilengkapi:`,
    "",
    ...baris,
    "",
    `Jika sudah dikirim/dilunasi, mohon abaikan pesan ini. ${penutup}`,
    "",
    "Jazakumullahu khairan.",
  ].join("\n");
}

// Ringkasan satu program dari daftar hasil nilai jamaah.
export function nilaiProgram(jamaahNilai: { skor: number; level: string; siap: boolean }[]) {
  const n = jamaahNilai.length;
  const hitung = (lv: string) => jamaahNilai.filter((j) => j.level === lv).length;
  const kritis = hitung("kritis"), tinggi = hitung("tinggi"), sedang = hitung("sedang"), aman = hitung("aman");
  const mean = n ? jamaahNilai.reduce((a, j) => a + j.skor, 0) / n : 0;
  const pctTinggi = n ? (kritis + tinggi) / n : 0;
  const skor = Math.round(0.6 * mean + 0.4 * pctTinggi * 100);
  return {
    skor,
    level: levelDariSkor(skor),
    jumlah_jamaah: n,
    siap: jamaahNilai.filter((j) => j.siap).length,
    kritis, tinggi, sedang, aman,
  };
}

// Inti penilaian: data mentah -> hasil radar. Murni, jadi mudah diuji.
export function hitungRadar(
  input: { programs: any[]; jamaah: any[]; totalBayar: Record<string, number>; profil?: { brand?: string; kontakWa?: string } },
  opsi: { nowMs: number; horizonHari: number; programId?: string },
) {
  const profil = input.profil || {};
  const hasil: any[] = [];
  for (const p of input.programs) {
    const berangkatMs = parseTglBerangkat(p.tgl);
    if (berangkatMs === null) continue; // tanggal tidak terbaca: tidak bisa dinilai
    const hari = hariMenuju(berangkatMs, opsi.nowMs);
    if (!opsi.programId && (hari > opsi.horizonHari || hari < -1)) continue;

    const daftar = input.jamaah.filter((j) => String(j.program_id) === String(p.id) && !j.diarsipkan && j.status !== "batal");
    const rincian = daftar.map((j) => {
      const nilai = nilaiJamaah(j, p, input.totalBayar[String(j.id)] || 0, hari, berangkatMs);
      const draf = susunDrafWa(j, p, nilai, hari, profil);
      const wa = normalisasiWa(j.wa);
      return {
        id: j.id,
        nama: j.nama,
        skor: nilai.skor,
        level: nilai.level,
        siap: nilai.siap,
        sisa_tagihan: nilai.sisa,
        alasan: nilai.alasan,
        wa: wa,
        draf_wa: draf,
        wa_link: draf && wa ? `https://wa.me/${wa}?text=${encodeURIComponent(draf)}` : null,
        catatan: draf && !wa ? "Nomor WA kosong/tidak valid, draf tidak bisa dikirim" : null,
      };
    }).sort((a, b) => b.skor - a.skor);

    const ringkas = nilaiProgram(rincian);
    const kuota = Number(p.kuota_pax) || 0;
    const adaHargaKosong = rincian.some((r) => r.alasan.some((a) => a.kode === "harga_kosong"));
    const hitungKode = (kode: string) => rincian.filter((r) => r.alasan.some((a) => a.kode === kode)).length;
    hasil.push({
      id: p.id,
      nama: p.nama,
      tgl: p.tgl,
      berangkat: new Date(berangkatMs).toISOString().slice(0, 10),
      hari_menuju: hari,
      kuota,
      terisi: rincian.length,
      ...ringkas,
      total_sisa_tagihan: rincian.reduce((a, r) => a + r.sisa_tagihan, 0),
      belum_lunas: hitungKode("belum_lunas"),
      dokumen_belum_lengkap: hitungKode("dokumen_kurang"),
      visa_belum_terbit: hitungKode("visa_belum") + hitungKode("visa_proses") + hitungKode("visa_ditolak"),
      paspor_bermasalah: hitungKode("paspor_expired") + hitungKode("paspor_mepet"),
      peringatan_data: adaHargaKosong ? "Harga program belum diisi: status pembayaran tidak bisa dinilai" : null,
      jamaah: rincian,
    });
  }
  hasil.sort((a, b) => b.skor - a.skor || a.hari_menuju - b.hari_menuju);
  return hasil;
}

const IKON_LEVEL: Record<string, string> = { kritis: "🔴", tinggi: "🟠", sedang: "🟡", aman: "🟢" };

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Ringkasan teks (HTML Telegram) maksimal ~3800 karakter.
export function susunRingkasanTeks(programs: any[], nowMs: number): string {
  if (!programs.length) return "🟢 <b>Radar Risiko</b>\nTidak ada program berangkat dalam rentang pantauan.";
  const tgl = new Date(nowMs + 7 * 3600000).toISOString().slice(0, 10);
  const out: string[] = [`📡 <b>RADAR RISIKO KEBERANGKATAN</b> · ${tgl}`, ""];
  for (const p of programs) {
    out.push(`${IKON_LEVEL[p.level]} <b>${esc(p.nama)}</b> · H-${p.hari_menuju} · skor ${p.skor}`);
    out.push(`   ${p.siap}/${p.jumlah_jamaah} jamaah siap · belum lunas ${p.belum_lunas} (${formatRupiah(p.total_sisa_tagihan)}) · dokumen ${p.dokumen_belum_lengkap} · visa ${p.visa_belum_terbit} · paspor ${p.paspor_bermasalah}`);
    for (const j of p.jamaah.filter((x: any) => x.level === "kritis" || x.level === "tinggi").slice(0, 3)) {
      out.push(`   ${IKON_LEVEL[j.level]} ${esc(j.nama)}: ${esc(j.alasan.filter((a: any) => a.poin > 0).slice(0, 2).map((a: any) => a.teks).join("; "))}`);
    }
    if (p.peringatan_data) out.push(`   ⚠️ ${esc(p.peringatan_data)}`);
    out.push("");
  }
  let teks = out.join("\n").trim();
  if (teks.length > 3800) teks = teks.slice(0, 3780).replace(/\n[^\n]*$/, "") + "\n… (dipotong, buka dashboard untuk lengkapnya)";
  return teks;
}

// ============================================================
// AKSES DATA & HANDLER
// ============================================================

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function isAuthorized(req: Request): Promise<boolean> {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  if (SERVICE_ROLE_KEY && token === SERVICE_ROLE_KEY) return true;
  const { data: userRes, error } = await supabase.auth.getUser(token);
  if (error || !userRes?.user) return false;
  const { data: profil } = await supabase
    .from("dashboard_profiles")
    .select("dashboard_role")
    .eq("id", userRes.user.id)
    .single();
  return profil?.dashboard_role === "admin";
}

// Supabase memotong hasil di 1000 baris tanpa error, jadi baca per halaman.
async function ambilSemua(buat: () => any): Promise<any[]> {
  const semua: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await buat().range(from, from + 999);
    if (error) throw new Error(error.message || "Gagal membaca data");
    semua.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return semua;
}

async function ambilConfig(): Promise<Record<string, any>> {
  const { data } = await supabase.from("tg_config").select("key, value");
  const cfg: Record<string, any> = {};
  for (const row of data || []) {
    try { cfg[row.key] = JSON.parse(row.value); } catch { cfg[row.key] = row.value; }
  }
  return cfg;
}

async function kirimTelegram(cfg: Record<string, any>, teks: string) {
  const token = cfg.botToken;
  if (!token) return { terkirim: 0, gagal: 0, catatan: "Bot Telegram belum dikonfigurasi" };
  const penerima: any[] = typeof cfg.recipients === "string" ? JSON.parse(cfg.recipients) : (cfg.recipients || []);
  let target = penerima.filter((r) => (r.types || []).includes("radar"));
  if (!target.length) target = penerima.filter((r) => (r.types || []).includes("program"));
  if (!target.length) return { terkirim: 0, gagal: 0, catatan: "Tidak ada penerima bertipe 'radar' atau 'program'" };
  let terkirim = 0, gagal = 0;
  for (const t of target) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: t.chatId, text: teks, parse_mode: "HTML", disable_web_page_preview: true }),
      });
      const r = await res.json().catch(() => ({}));
      if (res.ok && r.ok !== false) terkirim++; else gagal++;
    } catch { gagal++; }
  }
  return { terkirim, gagal };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ ok: false, description: "Method not allowed" }, 405);
  if (!(await isAuthorized(req))) return json({ ok: false, description: "Tidak diizinkan (khusus admin)" }, 401);

  const body = await req.json().catch(() => ({}));
  const horizon = Math.min(365, Math.max(1, Number(body.horizon_hari) || 60));
  const programId = typeof body.program_id === "string" && body.program_id ? body.program_id : undefined;

  try {
    let programs = await ambilSemua(() => {
      let q = supabase.from("programs")
        .select("id, nama, tgl, harga_quint, admin_data_lengkap, is_active, status_kepulangan, kuota_pax")
        .order("created_at", { ascending: true });
      q = programId ? q.eq("id", programId) : q.eq("is_active", true).eq("status_kepulangan", "belum_berangkat");
      return q;
    });
    if (!programId) programs = programs.filter((p) => p.is_active !== false);
    if (!programs.length) {
      return json({ ok: true, dibuat_pada: new Date().toISOString(), horizon_hari: horizon, programs: [], ringkasan_teks: susunRingkasanTeks([], Date.now()) });
    }
    const ids = programs.map((p) => p.id);

    const jamaah = await ambilSemua(() =>
      supabase.from("kb_jamaah")
        .select("id, program_id, nama, wa, tipe_kamar, harga_custom, status, dokumen, paspor_exp, visa_status, diarsipkan")
        .in("program_id", ids).eq("diarsipkan", false).order("id", { ascending: true })
    );
    const barisBayar = await ambilSemua(() =>
      supabase.from("v_total_bayar").select("jamaah_id, total_dibayar").in("program_id", ids).order("jamaah_id", { ascending: true })
    );
    const totalBayar: Record<string, number> = {};
    for (const b of barisBayar) totalBayar[String(b.jamaah_id)] = Number(b.total_dibayar) || 0;

    const cfg = await ambilConfig();
    const prof = cfg.company_profile && typeof cfg.company_profile === "object" ? cfg.company_profile : {};
    const profil = { brand: prof.brand, kontakWa: Array.isArray(prof.kontak_wa) ? String(prof.kontak_wa[0] || "").replace(/\D/g, "") : "" };

    const nowMs = Date.now();
    const hasil = hitungRadar({ programs, jamaah, totalBayar, profil }, { nowMs, horizonHari: horizon, programId });
    const ringkasanTeks = susunRingkasanTeks(hasil, nowMs);

    const respons: Record<string, unknown> = {
      ok: true,
      dibuat_pada: new Date(nowMs).toISOString(),
      horizon_hari: horizon,
      programs: hasil,
      ringkasan_teks: ringkasanTeks,
    };
    if (body.kirim_telegram === true) {
      const adaMasalah = hasil.some((p) => p.kritis + p.tinggi > 0);
      respons.telegram = body.hanya_jika_ada_masalah === true && !adaMasalah
        ? { terkirim: 0, gagal: 0, catatan: "Dilewati: tidak ada jamaah level tinggi/kritis" }
        : await kirimTelegram(cfg, ringkasanTeks);
    }
    return json(respons);
  } catch (err) {
    const pesan = err instanceof Error ? err.message : String(err);
    const petunjuk = /v_total_bayar/.test(pesan) ? " (jalankan sql/59_tambah_view_total_bayar.sql dulu)" : "";
    return json({ ok: false, description: pesan + petunjuk }, 500);
  }
});
