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
// Pakai Gemini API dengan responseMimeType=application/json + responseSchema (structured output) supaya hasilnya
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
//     slots?: [{ tanggal, hari, peran?, pilar, tipe_konten }]
//                                // slot yang HARUS diisi (1 ide per slot). Tanggal/pilar/tipe_konten dipaksa mengikuti slot.
//                                // peran (Rasakan..Renungkan) opsional, hanya diteruskan ke AI sebagai konteks.
//   }
//   Header: Authorization: Bearer <access_token sesi login dashboard> (admin/user). Anon key saja DITOLAK (401).
//   Response: { items: [{ tanggal, tema, tipe_konten, pilar, teks_gambar, draft_caption }, ...], ditolak?: ["tgl: alasan"], perbaikan: number, versi: 5 }
//   (versi >= 4 = pola 7 hari menyambung + pilar kontemplasi + carousel maks 5 slide; frontend memakainya untuk mendeteksi
//    function lama yang belum di-deploy ulang. versi 5 = mutu tulisan + perbaikan terarah; frontend tetap menerima >= 4,
//    jadi urutan deploy function/frontend bebas. ditolak = hari yang masih gagal validator setelah perbaikan; perbaikan =
//    jumlah putaran perbaikan yang dipakai)
//   Jaminan: tanggal valid & di dalam rentang, jumlah item <= jumlah diminta, pilar salah satu dari
//   storytelling|edukasi|manasik|kontemplasi|promo|testimoni|engagement|behind, carousel <= 5 slide,
//   caption sudah dirapikan (ejaan "Umroh", tepat 5 hashtag, <= 2200 karakter).
//
// Mutu (versi 5):
//   - Prompt memuat aturan mutu tulisan + dua contoh gaya; skema meminta rencana "sudut" & "jembatan" SEBELUM teks gambar
//     dan caption (field ini hanya untuk perencanaan & konteks perbaikan, tidak dikirim ke frontend).
//   - Validator server (selain hashtag/ejaan/panjang): tolak teks Arab, janji berlebihan, kutipan/atribusi ayat atau hadis,
//     placeholder [isi ...], statistik/klaim jumlah jamaah, kata kaku (silakan/hubungi kami/tersedia), format teks gambar yang
//     tidak cocok dengan tipe (carousel = "Slide n:" berurutan 3-5; single post = tanpa "Slide"), caption yang menyalin teks
//     gambar, dan rumus pembuka caption kembar antarhari. Angka & kata "tersedia" boleh kalau ARAHAN meminta info program.
//   - Perbaikan terarah (maks. 2 putaran, dibatasi anggaran waktu): hari yang ditolak ditulis ulang SENDIRI dengan alasan
//     penolakan + hari yang sudah lolos sebagai penyambung; hari yang sudah lolos tidak disentuh.
//   - Opsional: secret IG_PLAN_THINKING_LEVEL=low|medium|high menyalakan tingkat berpikir model (default mati).
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
        // Key lewat header (bukan ?key=) supaya tidak ikut tercetak di log/URL error (sama seperti _shared/gemini.ts).
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
- Setiap elemen array berbentuk: { "tanggal": "YYYY-MM-DD", "tema": string, "tipe_konten": "image"|"carousel" (JANGAN pernah video/Reels/live), "pilar": "storytelling"|"edukasi"|"manasik"|"kontemplasi", "sudut": string, "jembatan": string, "teks_gambar": string, "draft_caption": string }.
- Jumlah elemen HARUS sesuai jumlah yang diminta. Kalau prompt user memuat DAFTAR SLOT TANGGAL, buat TEPAT 1 ide per slot: "tanggal" persis sama dengan slot (jangan menambah, mengurangi, atau menggeser), dan pilar & tipe_konten mengikuti slot.
- Semua "tanggal" berada di dalam rentang tanggalMulai..tanggalAkhir (inklusif) dan merupakan tanggal kalender valid.
- "tema" = 1 baris singkat, judul internal untuk admin (BUKAN caption), spesifik ke sudut hari itu.
- "sudut" = 1 kalimat: apa yang BARU dibahas hari ini terhadap tema minggu (beda dari hari lain). "jembatan" = 1 kalimat: apa yang dijanjikan penutup caption untuk hari berikutnya (Minggu: teaser pekan depan). Isi keduanya DULU sebagai rencana, lalu tulis teks_gambar dan draft_caption yang konsisten dengan rencana itu. Keduanya hanya untuk perencanaan, tidak tampil di postingan.

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
- Konten emosional (Senin, Kamis, Sabtu, Minggu): pembukaan = suasana/refleksi; isi = hubungkan dengan pengalaman batin jamaah seolah kita melihat momennya; penutup = pertanyaan hangat (rindu/doa), dan doa singkat HANYA di sebagian hari (lihat SUARA MANUSIA); hari lain boleh berhenti dengan satu kalimat pendek yang menggantung.
- Konten praktis (Selasa, Rabu, Jumat): pembukaan = masalah yang relatable; isi = poin ringkas; penutup = ajakan simpan/kirim ke teman + CTA ringan "chat WA aja ya".
- Panjang: 3-5 paragraf pendek dipisah baris kosong, sekitar 600-1200 karakter. JANGAN terlalu singkat.
- Ditutup tepat 5 hashtag di baris terakhir, tanpa label "Hashtag:". #UmrohBersamaAmiru dan #AmiruTour selalu ada, 3 lainnya relevan dengan topik.
- Ejaan selalu "Umroh" (bukan "Umrah"), termasuk di hashtag.

MUTU TULISAN (periksa diam-diam sebelum menjawab):
- Hook = baris pertama teks_gambar, maksimal sekitar 9 kata: adegan konkret, pengakuan jujur, kontras, atau pertanyaan yang spesifik. Tiap hari pakai rumus hook yang BERBEDA; rumus "Pernahkah kamu..." atau "Tahukah kamu..." maksimal sekali dalam seminggu.
- Hindari klise pembuka: "Di tengah hiruk pikuk", "Umroh bukan sekadar", "Ibadah umroh adalah", "Setiap muslim pasti", "Siapa yang tidak ingin".
- Paragraf pertama caption langsung masuk ke adegan atau masalah nyata, bukan definisi atau pengantar umum. Satu paragraf maksimal 3 kalimat, kalimat rata-rata pendek (sekitar 18 kata) supaya enak dibaca di HP.
- Satu hari = SATU gagasan utama. Jangan menumpuk beberapa topik dalam satu caption.
- Hari emosional: minimal satu detail konkret yang bisa dirasakan (suara, hawa, sentuhan, gerakan) dan satu kegelisahan yang jujur. Hari praktis: poin spesifik yang bisa langsung dikerjakan (bukan "persiapkan dirimu dengan baik") beserta alasan singkat kenapa penting.
- Kata kunci tema minggu jangan diulang-ulang; ganti dengan gambaran atau sinonim. Jangan menaruh label seperti "Hook:" atau "Caption:" di dalam isi.
- Penutup dan CTA divariasikan antarhari: "chat WA aja ya" hanya di hari praktis, dan redaksinya tidak boleh sama dua kali dalam sepekan.
- Penutup caption harus selaras dengan "jembatan" hari itu, dan pembuka caption hari berikutnya benar-benar menyambungnya.

CONTOH GAYA (hanya untuk meniru nada, kerapatan detail, dan susunan paragraf; topik contoh JANGAN dipakai sebagai ide dan kalimatnya JANGAN disalin):
[hari emosional, image, topik contoh "malam sebelum berangkat"]
teks_gambar:
Koper sudah tertutup.
Tapi hatimu belum mau tidur.
draft_caption:
Jam sebelas malam, lampu kamar tinggal satu yang menyala. Koper sudah rapi di dekat pintu, tapi kamu malah duduk di tepi kasur, memandanginya lama-lama.

Aneh ya. Berbulan-bulan menunggu hari ini, dan sekarang yang terasa justru campur aduk: senang, gugup, sedikit takut, dan rindu yang belum tahu alamatnya.

Mungkin begitulah rasanya dipanggil. Bukan cuma badan yang bersiap, tapi hati yang pelan-pelan belajar melepas semua yang ia genggam di rumah. Nggak apa-apa kalau malam ini matamu basah tanpa alasan yang jelas.

Kalau boleh menitipkan satu doa malam ini, apa yang ingin kamu titipkan? Semoga langkah pertamamu besok diringankan dan hatimu dilapangkan.

#UmrohBersamaAmiru #AmiruTour #MalamSebelumBerangkat #PersiapanUmroh #CeritaUmroh

[hari praktis, carousel, topik contoh "salinan dokumen"]
teks_gambar:
Slide 1: Satu hal kecil yang sering bikin panik di bandara
Slide 2: Foto paspor dan dokumen perjalananmu sekarang
Slide 3: Simpan di HP, kirim juga ke satu anggota keluarga
Slide 4: Catat nomor penting di kertas, jaga-jaga HP mati
Slide 5: Simpan postingan ini biar nggak lupa
draft_caption:
Pernah nggak, tanganmu refleks menepuk saku berkali-kali cuma buat memastikan dokumen masih ada? Di perjalanan sepanjang itu, rasa waswas kecil begini bisa mencuri ketenangan yang seharusnya kamu simpan untuk ibadah.

Kabar baiknya, ketenangan itu bisa dicicil dari rumah. Foto dokumen pentingmu sekarang, simpan di HP, lalu kirim juga ke satu orang yang kamu percaya. Tulis nomor-nomor penting di selembar kertas kecil, karena baterai HP kadang habis di saat yang paling nggak tepat.

Nggak butuh waktu lama, mungkin sepuluh menit sambil menunggu nasi matang. Tapi nanti di sana, kamu bisa melangkah dengan dada yang lebih ringan.

Simpan postingan ini dan kirim ke temanmu yang juga lagi bersiap. Kalau ada yang masih bikin ragu, chat WA aja ya.

#UmrohBersamaAmiru #AmiruTour #PersiapanUmroh #TipsUmroh #SiapBerangkat

SUARA MANUSIA (supaya tidak terasa buatan AI):
- Tulis seperti teman yang bercerita lewat chat, bukan pidato atau brosur. Detail harus spesifik dan agak tak terduga: benda, bau, suara, kejadian kecil (sandal tertukar di depan pintu masjid, antre wudhu, kaki pegal, air zamzam yang dingin, tas kecil yang dipeluk terus). Hindari kata abstrak berlapis ("keindahan spiritual", "kedamaian jiwa").
- Ritme kalimat jangan seragam: campur kalimat agak panjang dengan yang sangat pendek, sesekali kalimat tanpa subjek ("Pelan-pelan aja."). Paragraf boleh hanya satu kalimat. Boleh ada sikap atau pendapat kecil yang lembut, tidak semuanya netral dan manis.
- DILARANG: pola kontras "bukan sekadar X, tapi Y" / "bukan hanya X melainkan Y"; daftar tiga kata berirama ("rindu, tenang, dan syukur") lebih dari sekali dalam satu caption; kalimat penutup ala kata mutiara; "Mari kita"; kata/frasa "relung hati", "hiruk pikuk", "perjalanan spiritual", "tak terhingga", "senantiasa", "tentunya", "sejatinya", "di sanalah", "di situlah"; tanda pisah panjang (em dash dan en dash) dan titik koma (pakai titik atau koma); tanda seru beruntun; huruf kapital semua.
- Maksimal 2 tanda tanya dalam satu caption. Emoji maksimal 1, boleh nol.
- Jangan satu cetakan tiap hari (adegan > refleksi > pertanyaan > doa). Ganti bentuknya antarhari: ada yang dibuka dialog singkat, ada pengakuan jujur, ada daftar pendek, ada yang berhenti menggantung tanpa doa. Doa penutup TIDAK wajib tiap hari: pakai hanya di sebagian hari emosional (maksimal 3 dari 7 hari dalam sepekan).
- Jangan mengaku pengalaman pribadi atau kejadian nyata yang dikarang ("dulu aku...", "seorang jamaah kami bilang..."). Pakai "kamu" dan "kita".
- Uji akhir: bacakan dalam hati. Kalau terdengar seperti pidato atau iklan, tulis ulang lebih pendek dan lebih spesifik.

ANTI-PENGULANGAN (PENTING):
- Satu topik hanya sekali dalam 6 bulan terakhir; sudut baru atas topik lama baru boleh muncul setelah jeda minimal 6 bulan (RIWAYAT TEMA hanya memuat 6 bulan terakhir). Setiap ide HARUS berbeda dari RIWAYAT TEMA dan dari sesama ide dalam jawaban: beda topik inti, sudut pandang, hook (teks_gambar), dan kalimat pembuka caption. Mengganti beberapa kata TIDAK dianggap berbeda. Kalau ragu sebuah ide mirip riwayat, ganti.
- Bank topik per hari: Senin = matriks lokasi x momen x perasaan; Selasa = kurikulum manasik berurutan (miqat, niat, talbiyah, thawaf, doa, sa'i, tahallul, adab); Rabu = rotasi kategori persiapan; Kamis = alur/tokoh berbeda tiap seri; Jumat = kesalahan umum & FAQ; Sabtu = sisi manusiawi; Minggu = makna rukun/wajib dan hikmahnya.
- Topik yang SUDAH PERNAH dipakai (awal pola, sebelum 12 Oktober 2026; jangan diulang sebelum 12 April 2027): niat umroh; pertama kali lihat Ka'bah; sa'i dan kisah Siti Hajar; Raudhah; subuh di Madinah; bawaan yang sering ketinggalan; kesalahan umum thawaf; urutan umroh (ihram, thawaf, sa'i, tahallul); larangan ihram; persiapan fisik; hari terakhir di Makkah; Makkah atau Madinah; umroh bersama orang tua; mulai dari yang kecil / menabung niat.
- Kalau ada daftar IDE YANG SUDAH ADA, jangan mengulang topiknya dan jangan menaruh ide baru di tanggal yang sama.
- Kalau ada daftar HOOK & PEMBUKA CAPTION 20 POSTING TERAKHIR, hook (teks_gambar baris pertama) dan 3 kata pertama pembuka caption TIDAK boleh sama atau mirip dengan daftar itu, juga tidak antarhari dalam jawaban yang sama. Variasikan rumus pembuka (jangan terus memakai "Kemarin kita bahas").

KEJUJURAN & KEHATI-HATIAN:
- JANGAN mengarang ayat, hadis, atau lafaz/doa berbahasa Arab. Untuk lafaz dan tata cara tulis "sesuai manasik dari pembimbing". Soal agama dan hukum ibadah tulis secara umum, tanpa fatwa; tandai di akhir kolom "tema" dengan "[cek pembimbing]" kalau memuat tata cara/hukum/doa.
- JANGAN menulis kalimat bertanda "Rasulullah bersabda", "Allah berfirman", "QS.", "HR." ataupun terjemahan ayat/hadis. Cukup sampaikan makna secara umum dan arahkan ke pembimbing.
- JANGAN menulis statistik, persentase, atau klaim jumlah jamaah ("ribuan jamaah", "98%").
- JANGAN mengarang testimoni, nama jamaah, angka, harga, tanggal, hotel, atau fasilitas. Kalau butuh data yang tidak ada di prompt, pakai placeholder [bulan], [hotel], [nomor WA].
- Cerita Sabtu dan renungan Minggu bersifat ilustrasi/umum, bukan klaim kejadian nyata.
- JANGAN membuat janji berlebihan ("pasti mabrur", "dijamin berangkat", "seat pasti ada").
- KONTEKS PROGRAM hanya dipakai kalau ARAHAN TAMBAHAN meminta menyelipkan info program; kalau dipakai, sebut tanggal/harga/sisa seat PERSIS seperti di konteks, utamakan keberangkatan yang masih jauh, jangan menawarkan program yang sudah berangkat atau penuh (sisa 0), dan jangan menulis "seat tinggal sedikit" kecuali sisa seat <= 10.`;

interface PlanItem {
  tanggal: string;
  tema: string;
  tipe_konten: string;
  pilar?: string;
  sudut?: string;
  jembatan?: string;
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

// Skema respons Gemini (structured output): memaksa bentuk JSON array berisi 8 field bertipe string dengan nilai
// pilar/tipe_konten dari daftar yang dikenal, jadi hampir tidak ada lagi item cacat atau teks pembuka/penutup nyasar.
// Validasi & pembersihan di bawah tetap jalan (skema tidak menjamin tanggal valid, panjang caption, dst).
// Kill switch tanpa deploy ulang kode: set secret IG_PLAN_RESPONSE_SCHEMA=off kalau model/API menolak skema ini.
function buildPlanResponseSchema() {
  return {
    type: "ARRAY",
    items: {
      type: "OBJECT",
      properties: {
        tanggal: { type: "STRING", description: "YYYY-MM-DD, persis sama dengan slot" },
        tema: { type: "STRING", description: "Judul internal 1 baris untuk admin" },
        tipe_konten: { type: "STRING", enum: Array.from(VALID_TYPES) },
        pilar: { type: "STRING", enum: Array.from(VALID_PILARS) },
        sudut: { type: "STRING", description: "1 kalimat: sudut baru hari ini terhadap tema minggu (rencana, tidak tampil)" },
        jembatan: { type: "STRING", description: "1 kalimat: janji penutup caption untuk hari berikutnya (rencana, tidak tampil)" },
        teks_gambar: { type: "STRING", description: "Teks di gambar; carousel: satu baris per slide, maksimal 5 slide" },
        draft_caption: { type: "STRING", description: "Caption 3-5 paragraf pendek, ditutup 5 hashtag" },
      },
      required: ["tanggal", "tema", "tipe_konten", "pilar", "sudut", "jembatan", "teks_gambar", "draft_caption"],
      // Urutan penulisan = urutan di sini: rencana (sudut, jembatan) ditulis SEBELUM teks gambar & caption.
      propertyOrdering: ["tanggal", "tema", "tipe_konten", "pilar", "sudut", "jembatan", "teks_gambar", "draft_caption"],
    },
  };
}

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
  const cleaned = fixSpelling(String(raw || "").replace(/\s*[\u2014\u2013]\s*/g, ", ").replace(/;\s*/g, ", ").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim());
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


// ===== Validator kejujuran & mutu (aturan pola-konten.md bagian 4, 5, 7, ditegakkan di server) =====
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
const PROMISE_RE = /pasti\s+(mabrur|berangkat|diterima|dikabulkan|ada)|dijamin|jaminan\s+(berangkat|mabrur)|100\s*%\s*(mabrur|berangkat)/i;
// Kutipan ayat/hadis (termasuk terjemahan) dilarang: model tidak boleh mengarang atribusi. Lafaz Arab sudah ditolak ARABIC_RE.
const SCRIPTURE_RE = /(bersabda|berfirman|firman\s+allah|sabda\s+(?:rasul|nabi)|hadis\s+riwayat|riwayat\s+(?:bukhari|muslim|tirmidzi|abu\s+dawud|ahmad)|\b(?:QS|HR)\.\s?[A-Za-z]|\bsurah?\s+[A-Za-z'\u2019-]+\s*(?:ayat|:)\s*\d)/i;
const PLACEHOLDER_RE = /\[(?:isi|diisi|tulis|contoh)\b[^\]]*\]|lorem ipsum|\bTODO\b/i;
const KAKU_RE = /\b(silakan|silahkan|hubungi\s+kami|tersedia)\b/i; // kata kaku ala brosur (pola-konten.md bagian 4)
const KLAIM_ANGKA_RE = /\b\d[\d.,]*\s*%|\b\d{2,}[\d.,]*\s+(?:jamaah|jemaah|peserta)\b|\b(?:ribuan|ratusan|jutaan)\s+(?:jamaah|jemaah|peserta)\b/i;
const IBADAH_RE = /\b(doa|tata\s*cara|niat|lafaz|talbiyah|hukum|wajib|rukun|sunnah|sunah|haram|ihram|thawaf|tawaf|sa'?i|tahallul|miqat)\b/i;
// Penanda "terasa buatan AI" (ditegakkan di server; item yang kena ditulis ulang SENDIRI lewat putaran perbaikan terarah).
const POLA_KONTRAS_RE = /\bbukan\s+(?:sekadar|sekedar|hanya|cuma)\b[^.!?\n]{0,90}?\b(?:tapi|tetapi|melainkan|namun)\b/i;
const KLISE_AI_RE = /\b(?:relung\s+hati|hiruk\s*pikuk|perjalanan\s+spiritual|tak\s+terhingga|senantiasa|tentunya|sejatinya|mari\s+kita|di\s+sanalah|di\s+situlah|sejuta\s+rasa|samudra\s+(?:rindu|cinta|kasih))\b/i;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const DOA_PENUTUP_RE = /\b(?:semoga|ya\s+allah|ya\s+rabb|aamiin|amin)\b/i;
const MAKS_DOA_PEKAN = 3;
const MAKS_TANDA_TANYA = 2;
const MAKS_EMOJI = 1;
const CAPTION_MIN = 500; // pola: sekitar 600-1200 karakter; toleransi sedikit
const CAPTION_MAX = 1500;
const MIN_CAROUSEL_SLIDES = 3; // pemancing + minimal 1 isi + penutup
const MAX_TEKS_GAMBAR_BARIS = 6; // single post: 2-4 baris pendek, toleransi sedikit
const CEK_PEMBIMBING = "[cek pembimbing]";

const NAMA_HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
function namaHari(tgl: string): string {
  const [y, m, d] = tgl.split("-").map(Number);
  return NAMA_HARI[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

// Teks bandingkan: huruf kecil, tanpa apostrof & tanda baca (sama dengan igRumusPembuka di js/app.js).
function norm(t: string): string {
  return String(t || "").toLowerCase().replace(/[\u2019'`\u02bc]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function rumusPembuka(teks: string): string {
  const w = norm(teks).split(" ").filter(Boolean);
  return w.length >= 3 ? w.slice(0, 3).join(" ") : "";
}
function captionTanpaTag(caption: string): string {
  return caption.replace(TAG_RE, "").replace(/[ \t]+$/gm, "").trim();
}
function barisPertamaCaption(caption: string): string {
  return captionTanpaTag(caption).split("\n").map((x) => x.trim()).find(Boolean) || "";
}
// Penutup caption (sebelum hashtag): paragraf terakhir, diambil ujungnya saja.
function penutupCaption(caption: string): string {
  const paras = captionTanpaTag(caption).split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  const last = paras[paras.length - 1] || "";
  return last.length > 140 ? last.slice(last.length - 140).replace(/^\S*\s/, "") : last;
}
// Hook = baris pertama teks gambar (carousel: isi Slide 1 tanpa awalan "Slide 1:").
function hookDari(teksGambar: string): string {
  const baris = String(teksGambar || "").split("\n").map((x) => x.trim()).find(Boolean) || "";
  return baris.replace(/^slide\s*\d+\s*[:.)\-\u2013]\s*/i, "").trim();
}

// Format teks gambar harus cocok dengan tipe slot: carousel = "Slide 1..n:" berurutan (3-5), single post = 2-4 baris tanpa "Slide".
function periksaFormatGambar(tipe: string, teks: string): string {
  const t = String(teks || "").trim();
  if (!t) return "teks gambar kosong (wajib diisi)";
  const nomor = Array.from(t.matchAll(/^\s*slide\s*(\d+)\s*[:.)\-\u2013]/gim)).map((m) => Number(m[1]));
  if (tipe === "carousel") {
    if (/slide\s*\d+\s*[-\u2013]\s*\d+/i.test(t)) return 'teks gambar memakai rentang "Slide 2-4" (tulis satu baris per slide)';
    if (Math.max(0, ...nomor, maxSlideNumber(t)) > MAX_CAROUSEL_SLIDES) return `carousel melebihi ${MAX_CAROUSEL_SLIDES} slide`;
    if (nomor.length < MIN_CAROUSEL_SLIDES) return `format carousel tidak sesuai (butuh minimal ${MIN_CAROUSEL_SLIDES} baris "Slide n: ...")`;
    if (!nomor.every((n, i) => n === i + 1)) return "nomor slide tidak berurutan dari 1";
    return "";
  }
  if (nomor.length) return 'single post tidak boleh memakai format "Slide n:" (tulis 2-4 baris pendek)';
  if (t.split("\n").map((x) => x.trim()).filter(Boolean).length > MAX_TEKS_GAMBAR_BARIS) return "teks gambar single post terlalu panjang (maksimal 4 baris pendek)";
  return "";
}

interface CekOpsi { bolehProgram: boolean }

// Return alasan penolakan (string, berisi petunjuk perbaikan) atau "" kalau lolos. Item yang ditolak dibuang & dicoba ulang.
function tolakAlasan(it: { tipe_konten: string; tema: string; teks_gambar: string; draft_caption: string }, opsi: CekOpsi): string {
  const all = `${it.tema}\n${it.teks_gambar}\n${it.draft_caption}`;
  if (ARABIC_RE.test(all)) return "memuat teks Arab (dilarang mengarang lafaz/ayat/doa; tulis \"sesuai manasik dari pembimbing\")";
  if (PROMISE_RE.test(all)) return "memuat janji berlebihan (buang \"pasti/dijamin\")";
  if (SCRIPTURE_RE.test(all)) return "memuat kutipan/atribusi ayat atau hadis (\"bersabda\", \"berfirman\", \"QS.\", \"HR.\"); sampaikan makna secara umum tanpa kutipan";
  if (PLACEHOLDER_RE.test(all)) return "masih memuat placeholder [isi ...]; tulis isinya sungguhan";
  if (KLAIM_ANGKA_RE.test(`${it.teks_gambar}\n${it.draft_caption}`) && !opsi.bolehProgram) return "memuat statistik/persentase/klaim jumlah jamaah yang tidak ada datanya; hapus angkanya";
  if (KAKU_RE.test(it.draft_caption) && !opsi.bolehProgram) return "memakai kata kaku ala brosur (silakan/hubungi kami/tersedia); ganti dengan bahasa ngobrol";
  const fmt = periksaFormatGambar(it.tipe_konten, it.teks_gambar);
  if (fmt) return fmt;
  const tulisan = `${it.teks_gambar}\n${captionTanpaTag(it.draft_caption)}`;
  if (POLA_KONTRAS_RE.test(tulisan)) return 'memakai pola "bukan sekadar X, tapi Y" yang terasa buatan AI; tulis langsung apa adanya';
  const klise = tulisan.match(KLISE_AI_RE);
  if (klise) return `memakai frasa klise "${klise[0]}" yang terasa buatan AI; ganti dengan detail konkret`;
  const nTanya = (captionTanpaTag(it.draft_caption).match(/\?/g) || []).length;
  if (nTanya > MAKS_TANDA_TANYA) return `terlalu banyak tanda tanya (${nTanya}; maksimal ${MAKS_TANDA_TANYA}); ubah sebagian jadi pernyataan`;
  const nEmoji = (tulisan.match(EMOJI_RE) || []).length;
  if (nEmoji > MAKS_EMOJI) return `terlalu banyak emoji (${nEmoji}; maksimal ${MAKS_EMOJI})`;
  const bodyLen = captionTanpaTag(it.draft_caption).length;
  if (bodyLen < CAPTION_MIN) return `caption terlalu pendek (${bodyLen} karakter; tulis 600-1200 karakter, 3-5 paragraf)`;
  if (bodyLen > CAPTION_MAX) return `caption terlalu panjang (${bodyLen} karakter; ringkas ke 600-1200 karakter)`;
  const hook = norm(hookDari(it.teks_gambar));
  if (hook.length >= 15 && norm(captionTanpaTag(it.draft_caption)).includes(hook)) return "caption mengulang teks gambar persis (caption harus lanjutannya, bukan salinan)";
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

// ===== Pipeline: susun pesan -> panggil Gemini -> olah & validasi -> perbaikan terarah =====
interface Slot { tanggal: string; hari: string; peran: string; pilar: string; tipe_konten: string }
interface Diterima {
  tanggal: string; tema: string; tipe_konten: string; pilar: string | null;
  teks_gambar: string; draft_caption: string; sudut: string; jembatan: string;
}
interface Konteks {
  bulanLabel: string; tanggalMulai: string; tanggalAkhir: string; tema: string; temaDepan: string;
  programCtx: string; arahan: unknown; ideSudahAda: unknown; riwayatTema: unknown; riwayatGaya: unknown;
}

// Putaran perbaikan terarah: hari yang ditolak validator ditulis ulang SENDIRI (dengan alasan penolakan + hari lain yang
// sudah jadi sebagai penyambung), tanpa membuang hari-hari yang sudah lolos. Anggaran waktu dijaga supaya tidak melewati
// batas waktu Edge Function.
const MAKS_PERBAIKAN = 2;
const BATAS_WAKTU_PERBAIKAN_MS = 75_000;

function susunPesan(c: Konteks, slots: Slot[], jumlah: number, konteksPekan: string, catatan: string): string {
  return `Susun paket konten Instagram yang saling menyambung untuk ${c.bulanLabel} (rentang tanggal ${c.tanggalMulai} s/d ${c.tanggalAkhir}), sebanyak TEPAT ${jumlah} ide post.

${c.tema ? `TEMA MINGGU: ${c.tema}` : "TEMA MINGGU: (tidak diisi, pilih sendiri satu tema yang belum ada di riwayat)"}
${c.temaDepan ? `TEMA PEKAN DEPAN (untuk teaser penutup Minggu): ${c.temaDepan}` : ""}
${slots.length ? `\nDAFTAR SLOT TANGGAL (isi TEPAT 1 ide per slot, tanggal persis sama, ikuti pilar & tipe_konten-nya):\n${slots.map((s) => `- ${s.tanggal}${s.hari ? ` (${s.hari})` : ""}${s.peran ? ` | peran: ${s.peran}` : ""} | pilar: ${s.pilar} | tipe_konten: ${s.tipe_konten}`).join("\n")}` : ""}
${konteksPekan ? `\nKONTEKS PEKAN (hari lain di pekan ini yang sudah jadi; sambungkan, jangan ulangi sudutnya):\n${konteksPekan}` : ""}
${c.arahan && String(c.arahan).trim() ? `\nARAHAN TAMBAHAN DARI ADMIN:\n${String(c.arahan).slice(0, 1500)}` : ""}

KONTEKS PROGRAM (hanya dipakai kalau ARAHAN TAMBAHAN meminta info program):
${c.programCtx}
${c.ideSudahAda && String(c.ideSudahAda).trim() ? `\nIDE YANG SUDAH ADA (jangan diulang):\n${String(c.ideSudahAda).slice(0, 4000)}` : ""}
${c.riwayatTema && String(c.riwayatTema).trim() ? `\nRIWAYAT TEMA, SUDAH PERNAH DIBUAT (jangan diulang & jangan dibuat mirip):\n${String(c.riwayatTema).slice(0, 20000)}` : ""}
${c.riwayatGaya && String(c.riwayatGaya).trim() ? `\nHOOK & PEMBUKA CAPTION 20 POSTING TERAKHIR (hook dan 3 kata pertama pembuka caption TIDAK boleh sama atau mirip dengan ini):\n${String(c.riwayatGaya).slice(0, 6000)}` : ""}${catatan ? `\n\n${catatan}` : ""}

Ingat: balas HANYA dengan JSON array sesuai format yang sudah dijelaskan, tidak ada teks lain.`;
}

// Satu baris konteks untuk hari yang sudah lolos: hook, pembuka, penutup, dan janji ke hari berikutnya.
function barisKonteks(it: Diterima): string {
  const hook = hookDari(it.teks_gambar).slice(0, 90);
  const buka = barisPertamaCaption(it.draft_caption).slice(0, 90);
  const tutup = penutupCaption(it.draft_caption).slice(0, 140);
  return `${namaHari(it.tanggal)} ${it.tanggal} | ${it.tema.slice(0, 90)}${hook ? ` | hook: ${hook}` : ""}${buka ? ` | caption dibuka: ${buka}` : ""}${tutup ? ` | caption ditutup: ${tutup}` : ""}${it.jembatan ? ` | janji ke hari berikutnya: ${it.jembatan.slice(0, 120)}` : ""}`;
}

// deno-lint-ignore no-explicit-any
function ambilTeks(geminiData: any): string {
  const parts = geminiData?.candidates?.[0]?.content?.parts || [];
  return parts.map((p: { text?: string }) => p?.text || "").join("").trim();
}

function bangunKonfigGenerasi() {
  // Opsional (default mati, perilaku lama): IG_PLAN_THINKING_LEVEL=low|medium|high menyalakan tingkat berpikir model
  // untuk hasil yang lebih rapi, dengan biaya waktu & token lebih besar. Hanya nilai yang dikenal yang diteruskan.
  const think = String(Deno.env.get("IG_PLAN_THINKING_LEVEL") || "").toLowerCase();
  return {
    responseMimeType: "application/json",
    ...(Deno.env.get("IG_PLAN_RESPONSE_SCHEMA") === "off" ? {} : { responseSchema: buildPlanResponseSchema() }),
    // Seri Gemini 3: Google menyarankan temperature tetap 1.0 (menurunkannya berisiko perulangan/hasil menurun).
    temperature: 1,
    ...(["low", "medium", "high"].includes(think) ? { thinkingConfig: { thinkingLevel: think } } : {}),
  };
}

async function panggilItems(userMsg: string): Promise<unknown[]> {
  const geminiData = await callGeminiWithFallback(GEMINI_MODEL, {
    system_instruction: { parts: [{ text: CONTENT_PLAN_SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: userMsg }] }],
    generationConfig: bangunKonfigGenerasi(),
  });
  const rawText = ambilTeks(geminiData);
  if (!rawText) {
    const finishReason = geminiData?.candidates?.[0]?.finishReason;
    throw new Error(`Gemini tidak mengembalikan hasil.${finishReason ? ` (finishReason: ${finishReason})` : ""}`);
  }
  let items: unknown;
  try {
    items = JSON.parse(stripJsonFence(rawText));
  } catch (parseErr) {
    throw new Error(`Gagal parse JSON dari Gemini: ${String((parseErr as Error)?.message || parseErr)}`);
  }
  if (!Array.isArray(items) || !items.length) {
    throw new Error("Gemini tidak menghasilkan daftar rencana yang valid (array kosong).");
  }
  return items;
}

// Olah satu putaran hasil AI: bersihkan, paksa mengikuti slot, validasi. Return yang lolos + alasan penolakan per tanggal.
function olahHasil(
  items: unknown[],
  o: { tanggalMulai: string; tanggalAkhir: string; slotByDate: Map<string, Slot> | null; sudahLolos: Diterima[]; opsi: CekOpsi },
): { lolos: Diterima[]; alasan: Map<string, string> } {
  const rangeOk = (t: string) => isRealDate(t) && t >= o.tanggalMulai && t <= o.tanggalAkhir;
  const str = (v: unknown, n: number) => (typeof v === "string" ? fixSpelling(v.trim().slice(0, n)) : "");
  let cleaned: Diterima[] = (items as PlanItem[])
    .filter((it) => it && typeof it === "object" && it.tanggal && it.tema && it.draft_caption)
    .map((it) => ({
      tanggal: String(it.tanggal).slice(0, 10),
      tema: fixSpelling(String(it.tema).trim().slice(0, 200)),
      tipe_konten: VALID_TYPES.has(String(it.tipe_konten)) ? String(it.tipe_konten) : "image",
      pilar: VALID_PILARS.has(String(it.pilar)) ? String(it.pilar) : null,
      teks_gambar: it.teks_gambar ? fixSpelling(String(it.teks_gambar).trim().slice(0, 700)) : "",
      draft_caption: normalizeCaption(String(it.draft_caption)),
      sudut: str(it.sudut, 300),
      jembatan: str(it.jembatan, 300),
    }))
    // Buang tanggal cacat / di luar rentang, lalu batasi sesuai jumlah yang diminta
    .filter((it) => rangeOk(it.tanggal));

  if (o.slotByDate) {
    // Mode slot: hanya tanggal yang diminta, maksimal 1 ide per tanggal; pilar & tipe dipaksa mengikuti slot.
    const slotByDate = o.slotByDate;
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
  cleaned.sort((a, b) => a.tanggal.localeCompare(b.tanggal));

  const lolos: Diterima[] = [];
  const alasan = new Map<string, string>();
  // Rumus pembuka ("kemarin kita bahas") yang sudah dipakai hari lain di pekan ini: tidak boleh sama.
  const rumusTerpakai = new Map<string, string>();
  for (const x of o.sudahLolos) {
    const r = rumusPembuka(barisPertamaCaption(x.draft_caption));
    if (r) rumusTerpakai.set(r, x.tanggal);
  }
  const doaPekan = (o.sudahLolos as { draft_caption: string }[]).filter((x) => DOA_PENUTUP_RE.test(penutupCaption(x.draft_caption))).length;
  let jumlahDoa = doaPekan;
  for (const it of cleaned) {
    let why = tolakAlasan(it, o.opsi);
    if (!why && DOA_PENUTUP_RE.test(penutupCaption(it.draft_caption)) && jumlahDoa >= MAKS_DOA_PEKAN) {
      why = `penutup berupa doa sudah dipakai ${jumlahDoa} hari di pekan ini (maksimal ${MAKS_DOA_PEKAN}); ganti penutup dengan kalimat pendek yang menggantung atau pertanyaan`;
    }
    if (!why) {
      const r = rumusPembuka(barisPertamaCaption(it.draft_caption));
      const pemakai = r ? rumusTerpakai.get(r) : undefined;
      if (r && pemakai && pemakai !== it.tanggal) {
        why = `pembuka caption memakai rumus yang sama dengan ${pemakai} ("${r} ..."); ganti dengan rumus pembuka lain`;
      }
    }
    if (why) {
      alasan.set(it.tanggal, why);
      continue;
    }
    const r = rumusPembuka(barisPertamaCaption(it.draft_caption));
    if (r) rumusTerpakai.set(r, it.tanggal);
    if (DOA_PENUTUP_RE.test(penutupCaption(it.draft_caption))) jumlahDoa++;
    lolos.push({ ...it, tema: tandaiCekPembimbing(it.tema, it.teks_gambar, it.draft_caption) });
  }
  return { lolos, alasan };
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
    const mulai = Date.now();
    const body = await req.json();
    const { bulanLabel, jumlahPost, tanggalMulai, tanggalAkhir, konteksProgram, arahan, ideSudahAda, riwayatTema, riwayatGaya, slots, temaMinggu, temaMingguDepan, konteksPekan } = body || {};

    if (!bulanLabel || !jumlahPost || !tanggalMulai || !tanggalAkhir) {
      return new Response(JSON.stringify({ error: "bulanLabel, jumlahPost, tanggalMulai, tanggalAkhir wajib diisi" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Slot tanggal (opsional): hanya slot yang valid (tanggal nyata di dalam rentang, pilar & tipe dikenal) yang dipakai.
    const slotList: Slot[] = Array.isArray(slots)
      ? slots
          .filter((s: { tanggal?: string; pilar?: string; tipe_konten?: string }) =>
            s && isRealDate(String(s.tanggal)) && String(s.tanggal) >= String(tanggalMulai) && String(s.tanggal) <= String(tanggalAkhir) &&
            VALID_PILARS.has(String(s.pilar)) && VALID_TYPES.has(String(s.tipe_konten)))
          .slice(0, 60)
          .map((s: { tanggal: string; hari?: string; peran?: string; pilar: string; tipe_konten: string }) => ({
            tanggal: String(s.tanggal), hari: String(s.hari || ""), peran: String(s.peran || "").slice(0, 30),
            pilar: String(s.pilar), tipe_konten: String(s.tipe_konten),
          }))
      : [];

    const jumlah = slotList.length ? slotList.length : Math.max(1, Math.min(60, Number(jumlahPost) || 12));

    const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
    const konteks: Konteks = {
      bulanLabel, tanggalMulai, tanggalAkhir,
      tema: clip(temaMinggu, 120),
      temaDepan: clip(temaMingguDepan, 120),
      programCtx: konteksProgram && String(konteksProgram).trim() ? String(konteksProgram) : "(tidak ada data program spesifik untuk periode ini)",
      arahan, ideSudahAda, riwayatTema, riwayatGaya,
    };
    const pekanCtx = clip(konteksPekan, 3000);
    // Angka/kata "tersedia" wajar kalau admin memang meminta info program lewat arahan.
    const opsi: CekOpsi = { bolehProgram: /program|seat|harga|keberangkatan|promo/i.test(String(arahan || "")) };

    // ---- Putaran 0: generate semua slot ----
    const items0 = await panggilItems(susunPesan(konteks, slotList, jumlah, pekanCtx, ""));
    const slotByDate0 = slotList.length ? new Map(slotList.map((s) => [s.tanggal, s])) : null;
    const r0 = olahHasil(items0, { tanggalMulai, tanggalAkhir, slotByDate: slotByDate0, sudahLolos: [], opsi });

    let lolos: Diterima[] = r0.lolos;
    const alasanAkhir = new Map<string, string>(r0.alasan);
    let putaranPerbaikan = 0;

    // ---- Putaran perbaikan terarah: hanya slot yang ditolak validator (mode slot) ----
    if (slotList.length) {
      for (let k = 1; k <= MAKS_PERBAIKAN; k++) {
        const sudahAda = new Set(lolos.map((x) => x.tanggal));
        // Hanya slot yang BENAR-BENAR ditolak validator yang diperbaiki; slot yang hilang dari jawaban dibiarkan ke percobaan ulang frontend.
        const perlu = slotList.filter((s) => !sudahAda.has(s.tanggal) && alasanAkhir.has(s.tanggal));
        if (!perlu.length || Date.now() - mulai > BATAS_WAKTU_PERBAIKAN_MS) break;

        const catatan = `CATATAN PERBAIKAN (putaran ${k}): slot di bawah ini DITOLAK pemeriksa otomatis pada percobaan sebelumnya. Tulis ulang HANYA slot yang ada di DAFTAR SLOT TANGGAL, dan perbaiki sebab penolakannya:\n`
          + perlu.map((s) => `- ${s.tanggal} (${s.hari || namaHari(s.tanggal)}): ${alasanAkhir.get(s.tanggal)}`).join("\n")
          + "\nHari lain di pekan ini yang sudah lolos ada di KONTEKS PEKAN: sambungkan dengan penutup hari sebelumnya, siapkan jalan untuk pembuka hari sesudahnya, dan jangan mengulang sudut maupun rumus pembuka mereka.";
        const baris = [
          ...(pekanCtx ? [pekanCtx] : []),
          ...lolos.slice().sort((a, b) => a.tanggal.localeCompare(b.tanggal)).map(barisKonteks),
        ].join("\n");

        try {
          const itemsK = await panggilItems(susunPesan(konteks, perlu, perlu.length, baris.slice(0, 6000), catatan));
          putaranPerbaikan = k;
          const rk = olahHasil(itemsK, {
            tanggalMulai, tanggalAkhir, slotByDate: new Map(perlu.map((s) => [s.tanggal, s])), sudahLolos: lolos, opsi,
          });
          lolos = [...lolos, ...rk.lolos].sort((a, b) => a.tanggal.localeCompare(b.tanggal));
          rk.lolos.forEach((x) => alasanAkhir.delete(x.tanggal));
          rk.alasan.forEach((v, tgl) => alasanAkhir.set(tgl, v));
        } catch (e) {
          // Perbaikan hanya bonus: kalau gagal, hasil putaran sebelumnya tetap dipakai.
          console.warn("generate-ig-content-plan: putaran perbaikan gagal ->", String((e as Error)?.message || e));
          break;
        }
      }
    }

    const ditolak: string[] = [];
    alasanAkhir.forEach((v, tgl) => { if (!lolos.some((x) => x.tanggal === tgl)) ditolak.push(`${tgl}: ${v}`); });
    if (ditolak.length) console.warn("generate-ig-content-plan: item ditolak validator ->", ditolak.join(" | "));

    // sudut/jembatan hanya untuk perencanaan & konteks perbaikan; tidak dikirim ke frontend.
    const keluar = lolos.slice(0, jumlah).map(({ sudut: _s, jembatan: _j, ...selebihnya }) => selebihnya);

    if (!keluar.length && ditolak.length) {
      // Semua ditolak validator (bukan error): kembalikan kosong supaya frontend mencoba ulang slotnya.
      return new Response(JSON.stringify({ items: [], ditolak, perbaikan: putaranPerbaikan, versi: 5 }), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    if (!keluar.length) {
      throw new Error("Semua item hasil AI tidak valid (tanggal di luar rentang bulan atau data kurang lengkap). Coba generate ulang.");
    }

    return new Response(JSON.stringify({ items: keluar, ...(ditolak.length ? { ditolak } : {}), perbaikan: putaranPerbaikan, versi: 5 }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err as Error)?.message || err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
