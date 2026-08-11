/* ============================================================
   TAUTAN PENTING (BOOKMARK)
   Kumpulan link penting organisasi (grup WA, form pendaftaran,
   rekening donasi, dsb) — TIDAK terikat event 17-an manapun, sama
   seperti Agenda/Kas/Gudang/Dokumen. Semua orang (termasuk guest)
   bisa melihat & membuka link; hanya user yang login (atau petugas
   yang ditugaskan ke bidang "Tautan Penting") yang bisa
   menambah/mengedit/menghapus.
   ============================================================ */

// Pastikan URL yang disimpan selalu punya skema (http/https) supaya link
// bisa langsung diklik dan tidak dianggap path relatif oleh browser
// (mis. user cuma ngetik "wa.me/xxx" tanpa "https://").
function normalisasiUrlBookmark(url){
  const u = (url || '').trim();
  if(!u) return '';
  if(/^https?:\/\//i.test(u)) return u;
  return `https://${u}`;
}

// Warna aksen bergiliran per kartu (pakai token warna yang sudah ada di
// style.css) supaya grid tautan tidak terlihat monoton kalau isinya banyak.
const BOOKMARK_ACCENTS = ['biru', 'ungu', 'pink', 'orange', 'gold', 'hijau'];

function renderBookmark(){
  const list = gBookmark();
  const isLoggedIn = !!getCurrentUser();
  const canEdit = canEditSection('bookmark');

  const cards = list.map((b, idx) => {
    const accent = BOOKMARK_ACCENTS[idx % BOOKMARK_ACCENTS.length];
    // Ambil huruf pertama judul sebagai monogram di badge, cadangan kalau
    // ikon tautan generik terasa terlalu polos untuk kartu sebanyak ini.
    const monogram = (b.judul||'?').trim().charAt(0).toUpperCase() || '🔗';
    let host = '';
    try{ host = new URL(b.url).hostname.replace(/^www\./,''); }catch(e){ host = b.url; }
    return `
    <div class="bookmark-card accent-${accent}">
      <div class="bookmark-card-top">
        <div class="bookmark-badge">${esc(monogram)}</div>
        <div class="bookmark-card-actions">
          <button class="icon-btn" ${da('openBookmarkModal', b.id)} ${!canEdit ? 'disabled' : ''} title="Edit">✎</button>
          <button class="icon-btn" ${da('hapusBookmark', b.id)} ${!canEdit ? 'disabled' : ''} title="Hapus">🗑</button>
        </div>
      </div>
      <div class="bookmark-card-title">${esc(b.judul)}</div>
      ${b.deskripsi ? `<div class="bookmark-card-desc">${esc(b.deskripsi)}</div>` : ''}
      <a href="${esc(b.url)}" target="_blank" rel="noopener noreferrer" class="bookmark-card-link">
        <span class="bookmark-card-host">${esc(host)}</span>
        <span class="bookmark-card-cta">Buka Tautan <span aria-hidden="true">↗</span></span>
      </a>
    </div>`;
  }).join('');

  return `
  <div class="panel">
    <div class="panel-head">
      <div><h3>🔗 Tautan Penting</h3>
      <div class="desc">Link penting organisasi — grup WA, form, rekening, dsb</div></div>
      ${canEdit ? `<button class="btn" ${da('openBookmarkModal')}>+ Tambah Tautan</button>` : ''}
    </div>
    <div class="panel-body">
      ${list.length ? `<div class="bookmark-grid">${cards}</div>` : `<div class="empty-row" style="padding:30px;text-align:center;">Belum ada tautan. ${isLoggedIn ? 'Tambahkan tautan penting supaya mudah diakses semua orang.' : 'Login untuk menambah tautan.'}</div>`}
    </div>
  </div>`;
}

function openBookmarkModal(id){
  if (!canEditSection('bookmark')) { toast('⛔ Login untuk mengedit data'); return; }
  const editing = id ? db.bookmark.find(b=>b.id===id) : null;
  setModal(editing?'Edit Tautan':'Tambah Tautan', `
    <div class="field"><label>Judul</label><input id="f-bookmark-judul" value="${editing?esc(editing.judul):''}" placeholder="mis. Grup WA Panitia"></div>
    <div class="field"><label>URL</label><input id="f-bookmark-url" value="${editing?esc(editing.url):''}" placeholder="mis. https://chat.whatsapp.com/xxxxx"></div>
    <div class="field"><label>Deskripsi (opsional)</label>
      <textarea id="f-bookmark-deskripsi" rows="2" data-autoresize="true" placeholder="Keterangan singkat...">${editing?esc(editing.deskripsi||''):''}</textarea>
    </div>
  `, [
    {label:'Batal', cls:'secondary', onclick:closeModal},
    {label:editing?'Simpan':'Tambah', cls:'', onclick:()=>{
      const judul = document.getElementById('f-bookmark-judul').value.trim();
      const url = normalisasiUrlBookmark(document.getElementById('f-bookmark-url').value);
      const deskripsi = document.getElementById('f-bookmark-deskripsi').value.trim();
      if(!judul || !url){ toast('Judul & URL wajib diisi'); return; }
      let actionMsg = editing ? `✏️ Edit tautan: ${editing.judul} → ${judul}` : `➕ Tautan baru: ${judul}`;
      if(editing){ Object.assign(editing, {judul, url, deskripsi}); }
      else{ db.bookmark.push({id:uid(), judul, url, deskripsi}); }
      saveDB(); closeModal(); renderContent(); toast('Tautan disimpan');
      notifyTelegram(actionMsg, `URL: ${url}\nDeskripsi: ${deskripsi || '-'}`, 'umum');
    }}
  ]);
}

async function hapusBookmark(id){
  if (!canEditSection('bookmark')) { toast('⛔ Login untuk mengedit data'); return; }
  if(!(await confirmModal('Hapus tautan ini?'))) return;
  const b = db.bookmark.find(x=>x.id===id);
  db.bookmark = db.bookmark.filter(x=>x.id!==id);
  saveDB(); renderContent(); toast('Tautan dihapus');
  if(b) notifyTelegram(`🗑️ Hapus tautan: ${b.judul}`, `URL: ${b.url}`, 'umum');
}

/* ============================================================
   BACKUP / RESTORE TAUTAN PENTING (dipanggil dari menu Pengaturan >
   Cadangan Data, mengikuti pola kasExportJSON/kasImportJSON di
   js/12-jadwal-agenda-kas.js). Impor MENAMBAH (upsert by id),
   tidak menimpa/menghapus tautan yang sudah ada.
   ============================================================ */
function bookmarkExportJSON(){
  const payload = {exportedAt: new Date().toISOString(), bookmark: db.bookmark};
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tautan-penting-backup-${todayISO()}.json`;
  a.click();
  toast('✅ Backup Tautan Penting berhasil diekspor.');
}
function bookmarkImportJSON(input){
  if(!canEditSection('bookmark')){ toast('🔒 Anda tidak memiliki akses untuk mengimpor data Tautan Penting.'); input.value=''; return; }
  const file = input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async (e)=>{
    try{
      const parsed = JSON.parse(e.target.result);
      if(!Array.isArray(parsed.bookmark)) throw new Error('Format file backup tidak dikenali.');
      if(!(await confirmModal(`Import akan MENAMBAH ${parsed.bookmark.length} tautan baru (data lama tidak dihapus). Lanjutkan?`))) return;
      toast('⏳ Mengimpor data...');
      const rows = parsed.bookmark.map(b => ({
        id: b.id || uid(),
        judul: b.judul || '',
        url: b.url || '',
        deskripsi: b.deskripsi || '',
      }));
      const ins = await sb.from('kt_bookmark').upsert(rows, {onConflict:'id'});
      if(ins.error) throw new Error(ins.error.message);

      const res = await sb.from('kt_bookmark').select('*');
      if(res.error) throw new Error(res.error.message);
      db.bookmark = res.data || [];
      _lastKnownIds['kt_bookmark'] = new Set(db.bookmark.map(r=>r.id));
      _lastKnownUpdatedAt['kt_bookmark'] = new Map(db.bookmark.map(r=>[r.id, r.updated_at||null]));

      toast('✅ Import selesai.');
      renderContent();
    }catch(err){
      console.error(err);
      toast('⛔ Gagal import: ' + err.message);
    }
    input.value = '';
  };
  reader.readAsText(file);
}
