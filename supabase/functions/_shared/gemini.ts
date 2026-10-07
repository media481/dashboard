// Shared helper: panggil Gemini API dengan fallback otomatis ke API key
// berikutnya kalau key yang dipakai kena limit/quota/error.
// Dipakai bareng oleh scan-poster-ocr, generate-wa-caption, dan
// generate-ig-caption — supaya logic fallback konsisten & tidak
// diduplikasi di 3 tempat berbeda.
//
// CARA NAMBAH KEY FALLBACK:
// Set sebanyak yang kamu mau lewat Supabase secrets, urut angka mulai dari
// GEMINI_API_KEY_2 (key pertama/utama tetap pakai nama GEMINI_API_KEY yang
// sudah ada supaya tidak mengubah setup lama):
//
//   supabase secrets set GEMINI_API_KEY=key_pertama       (wajib — key utama)
//   supabase secrets set GEMINI_API_KEY_2=key_kedua       (opsional — fallback 1)
//   supabase secrets set GEMINI_API_KEY_3=key_ketiga      (opsional — fallback 2)
//   supabase secrets set GEMINI_API_KEY_4=key_keempat     (opsional — fallback 3)
//   supabase secrets set GEMINI_API_KEY_5=key_kelima      (opsional — fallback 4)
//
// Urutan dicoba dari GEMINI_API_KEY, lalu _2, _3, dst. Kalau semua key gagal,
// error terakhir yang dilempar ke pemanggil (supaya pesan error di dashboard
// tetap informatif, bukan cuma "semua gagal").
//
// PENTING: ambil tiap API key dari akun Google/project GCP yang BERBEDA
// (atau minimal API key berbeda) — kalau semua key berasal dari 1 akun/1
// project yang sama, mereka berbagi kuota yang sama, jadi fallback ini
// tidak akan menolong saat kuota project itu habis.

const MAX_FALLBACK_KEYS = 5;

export function getGeminiApiKeys(): string[] {
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
export interface GeminiOptions {
  fallbackModels?: string[];
  retryDelaysMs?: number[];
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Panggil generateContent untuk 1 model, coba tiap key di getGeminiApiKeys()
// berurutan sampai ada yang berhasil (HTTP 2xx). Return JSON response Gemini
// mentah (pemanggil yang parsing candidates/parts sesuai kebutuhan masing-masing).
export async function callGeminiWithFallback(
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
