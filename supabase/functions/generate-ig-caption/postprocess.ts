// Pasca-proses caption IG hasil AI — fungsi MURNI (tanpa API Deno) supaya mudah diuji.
// Model bahasa kadang melanggar aturan (ejaan "Umrah", hashtag >5, kebablasan 2200
// karakter, label "Hook:"). Aturan yang bisa dicek pakai kode DIJAGA di sini, bukan
// cuma diminta lewat prompt.

export const IG_MAX_CHARS = 2200;
export const MAX_HASHTAGS = 5;
// Selalu ada di setiap caption (sesuai Pola Amiru di generate-ig-content-plan).
export const REQUIRED_HASHTAGS = ["#UmrohBersamaAmiru", "#AmiruTour"];

const TAG_RE = /#[\p{L}\p{N}_]+/gu;
const TAG_ONLY_LINE_RE = /^\s*(#[\p{L}\p{N}_]+\s*)+$/u;

// Ejaan resmi "Umroh" — termasuk di dalam hashtag (#UmrahMurah -> #UmrohMurah).
export function fixSpelling(t: string): string {
  return t.replace(/umrah/gi, (m) => (m === m.toUpperCase() ? "UMROH" : m[0] === "U" ? "Umroh" : "umroh"));
}

// Buang code fence & label struktur ("Hook:", "CTA:", ...) yang bocor ke output.
export function stripWrappers(raw: string): string {
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

export function normalizeCaption(raw: string): string {
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

export function findUnknownNumbers(input: string, output: string): string[] {
  const known = numbersIn(input);
  return [...numbersIn(output)].filter((n) => !known.has(n));
}
