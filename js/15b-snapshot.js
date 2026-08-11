/* ============================================================
   SNAPSHOT OTOMATIS (Admin only)
   ------------------------------------------------------------
   Pelengkap fitur "Backup Semua Data" (js/15-pengaturan-event.js)
   yang sudah ada. Bedanya: snapshot di sini TIDAK perlu diunduh/
   disimpan manual oleh admin — otomatis tersimpan sebagai baris
   di tabel kt_snapshot (lihat supabase-snapshot-migration.sql),
   jadi tetap aman walau device yang dipakai berganti.

   Payload snapshot persis sama seperti isi file "Backup Semua
   Data" (exportData() di js/15-pengaturan-event.js) — seluruh
   `db` minus token Telegram — supaya proses restore-nya juga bisa
   pakai jalur yang SAMA PERSIS dan sudah teruji seperti importData():
   db = Object.assign(defaultDB(), payload); saveDB();
   saveDB() lalu men-diff tiap tabel (syncArrayTable dkk, lihat
   js/03-db-core.js) — baris di server yang tidak ada di payload
   akan dihapus, yang ada akan di-upsert. Proses ini juga tetap
   melewati deteksi konflik bawaan (kalau ada device lain baru saja
   mengubah suatu baris, perubahan itu TIDAK ditimpa diam-diam —
   admin akan lihat toast peringatan & perlu muat ulang untuk cek).

   PENGECUALIAN — GUDANG: modul Gudang Aset Desa (js/17a-gudang-core.js)
   tidak menyimpan datanya di object `db`, jadi TIDAK ikut kebawa lewat
   JSON.stringify(db) di atas. Datanya diambil & dipulihkan terpisah
   lewat payload._gudang — lihat buildSnapshotPayload() dan
   restoreGudangFromPayload() di bawah. Snapshot lama (dibuat sebelum
   perbaikan ini) tidak punya payload._gudang — saat dipulihkan, data
   Gudang saat ini sengaja DIBIARKAN (tidak ikut ditimpa/dikosongkan).

   RETENSI: cuma 10 snapshot terakhir yang disimpan (dipilih sendiri
   oleh admin Karang Taruna Inti). Konsekuensinya: kalau snapshot
   harian + pra-aksi terjadi beruntun dalam waktu berdekatan, yang
   paling lama otomatis kepental duluan — kalau butuh riwayat lebih
   panjang, naikkan SNAPSHOT_RETAIN di bawah lalu jalankan ulang.

   PEMICU OTOMATIS:
   1. Harian — sekali per hari (device manapun, siapa pun admin
      yang membuka Pengaturan duluan hari itu) lewat
      cobaSnapshotHarian(), dipanggil dari initApp (js/19-init.js).
   2. Pra-aksi berisiko — tepat sebelum importData() (Impor "Timpa
      Semua") beneran menimpa data, dan tepat sebelum pulihkanSnapshot()
      sendiri — supaya restore yang ternyata salah pun masih bisa
      dibatalkan lagi.
   ============================================================ */

const SNAPSHOT_RETAIN = 10;
let snapshotList = [];
let snapshotListLoaded = false;
let snapshotListLoading = false;

// Ambil isi 4 tabel kt_gudang_* langsung dari Supabase (bukan dari variabel
// gudangInventory/gudangTransactions di memori — bisa kosong/basi kalau
// admin belum pernah membuka halaman Gudang di device ini). Dipakai bersama
// oleh snapshot otomatis (buildSnapshotPayload) DAN "Backup Semua Data"
// manual (exportData di js/15-pengaturan-event.js) supaya keduanya selalu
// konsisten mencakup data yang sama. Return null kalau gagal fetch (mis.
// koneksi putus) — caller wajib menangani null sebagai "gudang tidak
// tersedia untuk backup kali ini", BUKAN sebagai "gudang memang kosong".
async function fetchGudangBackupData(){
  try{
    const [invRes, trxRes, itemsRes, seqRes] = await Promise.all([
      sb.from('kt_gudang_inventory').select('*'),
      sb.from('kt_gudang_transactions').select('*'),
      sb.from('kt_gudang_transaction_items').select('*'),
      sb.from('kt_gudang_resi_seq').select('*'),
    ]);
    if (invRes.error || trxRes.error || itemsRes.error || seqRes.error) {
      throw new Error(invRes.error?.message || trxRes.error?.message || itemsRes.error?.message || seqRes.error?.message);
    }
    return {
      inventory: invRes.data || [],
      transactions: trxRes.data || [],
      transactionItems: itemsRes.data || [],
      resiSeq: seqRes.data || [],
    };
  }catch(e){
    console.error('Gagal mengambil data Gudang untuk backup:', e);
    return null;
  }
}

async function buildSnapshotPayload(){
  // Sama persis seperti exportData() — redaksi token Telegram karena
  // itu kredensial live, bukan "data" yang perlu dikembalikan saat restore.
  const payload = JSON.parse(JSON.stringify(db));
  if (payload.telegram) payload.telegram.botToken = '';

  // Gudang Aset Desa (js/17a-gudang-core.js) TIDAK menyimpan datanya di
  // object `db` — dia punya variabel modul sendiri (gudangInventory dkk)
  // yang dibaca langsung dari/ke Supabase. Kalau kita ambil dari variabel
  // itu, snapshot bisa kosong/basi kalau admin yang membuat snapshot belum
  // pernah membuka halaman Gudang di device ini. Makanya di sini datanya
  // di-fetch FRESH langsung dari tabel kt_gudang_* setiap snapshot dibuat,
  // termasuk kt_gudang_resi_seq (counter nomor resi) supaya penomoran resi
  // tidak kacau kalau nanti dipulihkan. Kalau fetch gagal, `_gudang` sengaja
  // dibiarkan absen (bukan array kosong) — jangan sampai gagal ambil data
  // Gudang menggagalkan seluruh snapshot; lebih baik snapshot tetap dibuat
  // tanpa data gudang daripada tidak ada jaring pengaman sama sekali.
  // Absennya `_gudang` ditangani sebagai kasus "snapshot lama" oleh
  // restoreGudangFromPayload().
  const gudangData = await fetchGudangBackupData();
  if (gudangData) payload._gudang = gudangData;
  return payload;
}

async function buatSnapshot(trigger, label){
  if (!canEdit()) return null;
  try{
    const payload = await buildSnapshotPayload();
    const json = JSON.stringify(payload);
    const { error } = await sb.from('kt_snapshot').insert({
      trigger, label: label || null, payload,
      size_kb: Math.round(new Blob([json]).size / 1024 * 10) / 10
    });
    if (error) { console.error('Gagal membuat snapshot:', error); return null; }
    await pruneSnapshotLama();
    snapshotListLoaded = false; // paksa refresh berikutnya kali panel dibuka
    return true;
  }catch(e){ console.error('Gagal membuat snapshot:', e); return null; }
}

async function pruneSnapshotLama(){
  const { data, error } = await sb.from('kt_snapshot').select('id, created_at').order('created_at', { ascending:false });
  if (error || !data) return;
  const kelebihan = data.slice(SNAPSHOT_RETAIN).map(r=>r.id);
  if (kelebihan.length) await sb.from('kt_snapshot').delete().in('id', kelebihan);
}

// Dipanggil sekali per pemuatan halaman (dari initApp) — bikin snapshot
// "harian" hanya kalau belum ada snapshot APAPUN yang tercatat hari ini,
// supaya tidak numpuk tiap kali admin login berkali-kali di hari yang sama.
async function cobaSnapshotHarian(){
  if (!canEdit()) return;
  try{
    const { data, error } = await sb.from('kt_snapshot').select('created_at').order('created_at', { ascending:false }).limit(1);
    if (error) return;
    const sudahHariIni = data && data[0] && (data[0].created_at || '').slice(0,10) === todayISO();
    if (!sudahHariIni) await buatSnapshot('harian');
  }catch(e){ console.error('Gagal cek snapshot harian:', e); }
}

async function muatDaftarSnapshot(){
  if (snapshotListLoading) return;
  snapshotListLoading = true;
  const { data, error } = await sb.from('kt_snapshot').select('id, created_at, trigger, label, size_kb').order('created_at', { ascending:false });
  snapshotListLoading = false;
  if (error){ console.error('Gagal memuat riwayat snapshot:', error); return; }
  snapshotList = data || [];
  snapshotListLoaded = true;
  if (currentSection === 'pengaturan') renderContent();
}

function labelTriggerSnapshot(t){
  return t === 'harian' ? '🕗 Otomatis harian' : t === 'pra-aksi' ? '⚠️ Sebelum aksi berisiko' : '📸 Manual';
}

function renderSnapshotPanel(){
  if (!snapshotListLoaded && !snapshotListLoading) muatDaftarSnapshot();
  const rows = snapshotList.map(s => `
    <tr>
      <td>${fmtDateJam((s.created_at||'').slice(0,10), new Date(s.created_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}))}</td>
      <td>${labelTriggerSnapshot(s.trigger)}${s.label ? ` — ${esc(s.label)}` : ''}</td>
      <td>${s.size_kb ?? '-'} KB</td>
      <td style="text-align:right;white-space:nowrap;">
        <button class="btn secondary small" ${da('pulihkanSnapshot', s.id)}>↺ Pulihkan</button>
        <button class="btn secondary small" ${da('hapusSnapshotManual', s.id)}>🗑️</button>
      </td>
    </tr>`).join('');

  return `
  <div class="panel">
    <div class="panel-head">
      <div><h3>🧷 Snapshot Otomatis</h3><div class="desc">Cadangan penuh seluruh data, tersimpan otomatis di server (bukan file manual) — retensi ${SNAPSHOT_RETAIN} snapshot terakhir. Dibuat otomatis 1×/hari dan tepat sebelum aksi yang berisiko menimpa data (mis. Impor "Timpa Semua").</div></div>
    </div>
    <div class="panel-body">
      <button class="btn secondary small" ${da('buatSnapshotManualUI')}>📸 Buat Snapshot Sekarang</button>
      <div style="overflow-x:auto;margin-top:12px;">
        <table class="table">
          <thead><tr><th>Waktu</th><th>Jenis</th><th>Ukuran</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4" style="text-align:center;color:var(--ink-soft);">Belum ada snapshot</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  </div>`;
}

async function buatSnapshotManualUI(){
  if (!canEdit()) { toast('⛔ Login untuk membuat snapshot'); return; }
  const label = (await promptModal({title:'Buat Snapshot', label:'Label snapshot (opsional)', hint:'Boleh dikosongkan.'})) || '';
  toast('⏳ Membuat snapshot...');
  const ok = await buatSnapshot('manual', label.trim());
  if (ok){ toast('✅ Snapshot dibuat'); muatDaftarSnapshot(); }
  else toast('⛔ Gagal membuat snapshot');
}

// Menimpa isi tabel kt_gudang_* di server dengan isi payload._gudang, lewat
// RPC atomik `kt_gudang_restore_snapshot` (lihat
// supabase-gudang-restore-snapshot-migration.sql) — SATU transaksi server,
// bukan beberapa delete()/insert() terpisah dari JS. Kalau ada langkah yang
// gagal di tengah jalan (mis. koneksi putus), PostgreSQL rollback semuanya
// dan tabel Gudang tetap dalam kondisi SEMULA, tidak berakhir kosong separuh.
// Dipakai baik oleh pulihkanSnapshot() di sini maupun importData() di
// js/15-pengaturan-event.js (Impor "Timpa Semua").
// Return: true = ada data gudang yang dipulihkan, false = payload lama
// (snapshot/file backup dibuat sebelum fitur ini ada) sehingga data Gudang
// saat ini DIBIARKAN apa adanya, tidak ikut ditimpa/dikosongkan.
async function restoreGudangFromPayload(payload){
  const g = payload && payload._gudang;
  if (!g) return false;
  try{
    const { error } = await sb.rpc('kt_gudang_restore_snapshot', {
      p_inventory: g.inventory || [],
      p_transactions: g.transactions || [],
      p_items: g.transactionItems || [],
      p_resi_seq: g.resiSeq || [],
    });
    if (error) throw new Error(error.message);
    // Paksa reload berikutnya kali halaman Gudang dibuka, jangan pakai
    // gudangInventory/gudangTransactions lama yang masih di memori.
    gudangLoaded = false;
    return true;
  }catch(e){
    console.error('Gagal memulihkan data Gudang dari snapshot:', e);
    toast('⚠️ Data lain sudah dipulihkan, tapi data Gudang GAGAL dipulihkan (tidak ada perubahan, aman dicoba ulang) — cek konsol.', 7000);
    return false;
  }
}

async function pulihkanSnapshot(id){
  if (!isAdmin()) { toast('⛔ Hanya Admin'); return; }
  const s = snapshotList.find(x=>x.id===id); if(!s) return;
  const waktu = fmtDateJam((s.created_at||'').slice(0,10));
  if (!(await confirmModal(`Pulihkan ke snapshot "${waktu}" (${labelTriggerSnapshot(s.trigger)}${s.label?` — ${s.label}`:''})?\n\nSeluruh data SAAT INI akan ditimpa kembali ke kondisi snapshot tersebut. Sebuah snapshot "pra-aksi" dari kondisi sekarang akan dibuat otomatis dulu sebagai jaring pengaman sebelum restore dijalankan.`))) return;

  toast('⏳ Menyimpan kondisi saat ini sebagai jaring pengaman...');
  await buatSnapshot('pra-aksi', `Sebelum pulih ke ${waktu}`);

  toast('⏳ Mengambil data snapshot...');
  const { data, error } = await sb.from('kt_snapshot').select('payload').eq('id', id).maybeSingle();
  if (error || !data){ toast('⛔ Gagal mengambil data snapshot'); return; }

  toast('⏳ Memulihkan data...');
  db = Object.assign(defaultDB(), data.payload);
  saveDB();
  const gudangDipulihkan = await restoreGudangFromPayload(data.payload);
  renderSidebar(); goSection('dashboard');
  toast('✅ Data dipulihkan dari snapshot. Muat ulang halaman disarankan untuk memastikan tampilan segar.', 6000);
  if (!gudangDipulihkan) {
    toast('ℹ️ Snapshot ini dibuat sebelum data Gudang ikut dicadangkan — data Gudang saat ini tidak diubah.', 8000);
  }
  notifyTelegram('↺ Pulihkan snapshot', `Waktu snapshot: ${waktu}`, 'sistem');
  snapshotListLoaded = false;
}

async function hapusSnapshotManual(id){
  if (!isAdmin()) { toast('⛔ Hanya Admin'); return; }
  if (!(await confirmModal('Hapus snapshot ini? Tidak bisa dibatalkan.'))) return;
  const { error } = await sb.from('kt_snapshot').delete().eq('id', id);
  if (error){ toast('⛔ Gagal menghapus snapshot'); return; }
  toast('🗑️ Snapshot dihapus'); muatDaftarSnapshot();
}
