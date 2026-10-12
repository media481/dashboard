// Supabase Edge Function: sync-rekap-program
//
// Menyinkronkan daftar gambar "Rekap Program" dari folder Google Drive
// (lewat Apps Script web app, lihat apps-script/rekap-program-drive-listing.gs)
// ke tabel `rekap_program_items` (lihat sql/52_tambah_rekap_program_items.sql).
// Polanya sama dengan sync-infografis, tapi memakai folder Drive yang berbeda.
//
// Dipanggil dari js/app.js (loadRekapProgram) lewat tombol "Refresh" di modal
// Rekap Program.
//   POST  Authorization: Bearer <access_token user yang login>
//   Response: { ok: true, synced: <jumlah gambar> } atau { ok: false, error }
//
// Hak akses: hanya role 'admin' / 'user' (guest read-only, tidak boleh sync).
// Role dicek ke dashboard_profiles pakai service role, bukan dari klaim client.
//
// Secret yang dibutuhkan:
//   REKAP_PROGRAM_API_URL  = URL web app Apps Script (diakhiri /exec)
//
// Deploy:
//   supabase secrets set REKAP_PROGRAM_API_URL=https://script.google.com/macros/s/XXXX/exec
//   supabase functions deploy sync-rekap-program

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "Tidak ada token" }, 401);

  const apiUrl = Deno.env.get("REKAP_PROGRAM_API_URL");
  if (!apiUrl) return json({ ok: false, error: "Secret REKAP_PROGRAM_API_URL belum di-set" }, 500);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // 1. Verifikasi token & role pemiliknya
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return json({ ok: false, error: "Token tidak valid" }, 401);

  const { data: profile } = await admin
    .from("dashboard_profiles")
    .select("dashboard_role")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (!profile || !["admin", "user"].includes(profile.dashboard_role)) {
    return json({ ok: false, error: "Hanya admin/user yang boleh sinkron" }, 403);
  }

  try {
    // 2. Tarik daftar gambar dari Apps Script (redirect Google diikuti otomatis)
    const res = await fetch(apiUrl, { redirect: "follow" });
    const listing = await res.json();
    if (!listing?.ok || !Array.isArray(listing.items)) {
      return json({ ok: false, error: "Respons Apps Script tidak valid" }, 502);
    }

    const rows = listing.items.map((it: any) => ({
      id: String(it.id),
      name: it.name ?? null,
      thumb_url: it.thumbUrl ?? null,
      full_url: it.fullUrl ?? null,
      drive_updated_at: it.updatedAt ?? null,
      synced_at: new Date().toISOString(),
    }));

    // 3. Upsert gambar yang ada di folder
    if (rows.length) {
      const { error: upErr } = await admin.from("rekap_program_items").upsert(rows, { onConflict: "id" });
      if (upErr) return json({ ok: false, error: upErr.message }, 500);
    }

    // 4. Hapus baris untuk file yang sudah tidak ada di folder Drive
    const keepIds = rows.map((r: any) => r.id);
    const delQuery = admin.from("rekap_program_items").delete();
    const { error: delErr } = keepIds.length
      ? await delQuery.not("id", "in", `(${keepIds.map((i: string) => `"${i}"`).join(",")})`)
      : await delQuery.neq("id", "");
    if (delErr) return json({ ok: false, error: delErr.message }, 500);

    return json({ ok: true, synced: rows.length });
  } catch (err) {
    return json({ ok: false, error: String((err as Error)?.message || err) }, 500);
  }
});
