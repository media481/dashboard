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

// Panggil generateContent untuk 1 model, coba tiap key di getGeminiApiKeys()
// berurutan sampai ada yang berhasil (HTTP 2xx). Return JSON response Gemini
// mentah (pemanggil yang parsing candidates/parts sesuai kebutuhan masing-masing).
export async function callGeminiWithFallback(
  model: string,
  body: Record<string, unknown>,
  // deno-lint-ignore no-explicit-any
): Promise<any> {
  const keys = getGeminiApiKeys();
  if (!keys.length) {
    throw new Error("GEMINI_API_KEY belum di-set di Supabase secrets");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  let lastError = "";

  for (let i = 0; i < keys.length; i++) {
    try {
      const res = await fetch(`${url}?key=${keys[i]}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        return await res.json();
      }

      const errText = await res.text();
      lastError = `Gemini API error (${res.status}) [key #${i + 1}/${keys.length}]: ${errText.slice(0, 300)}`;
      console.warn(lastError);
      // Lanjut coba key berikutnya (kalau ada) — baik untuk error kuota/rate
      // limit (429) maupun error lain, karena murah untuk dicoba ulang dan
      // kita tidak mau 1 key bermasalah bikin seluruh fitur AI mati total.
    } catch (networkErr) {
      lastError = `Network error saat panggil Gemini [key #${i + 1}/${keys.length}]: ${
        String((networkErr as Error)?.message || networkErr)
      }`;
      console.warn(lastError);
    }
  }

  throw new Error(`Semua ${keys.length} GEMINI_API_KEY gagal dipakai. Error terakhir: ${lastError}`);
}
