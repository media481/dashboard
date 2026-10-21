// ============================================================
// MODUL LAZY: SNAPSHOT BACKUP  (js/modules/snapshot.js)
// ============================================================
// Dipecah dari js/app.js dan dimuat HANYA saat dibutuhkan (ensureModuleLoaded('snapshot') di app.js).
// Dimuat sebagai <script> biasa (BUKAN ES module): satu lingkup global dengan app.js, jadi nama
// fungsi global dan onclick="..." tidak berubah.
// ATURAN: jangan mendeklarasikan ulang nama yang sudah ada di app.js (const/let ganda = SyntaxError).
// Fungsi yang dirujuk index.html / kode inti SEBELUM modul dimuat didaftarkan di LAZY_MODULES['snapshot'].api (app.js).
// Tetap di app.js: maybeDailySnapshot() + SNAP_DAILY_KEY (throttle harian dicek tanpa mengunduh modul).
// PENTING: ensureAutoSnapshot() dipakai clearAllAdminData() & importAdminData(); kalau modul gagal
// diunduh, stub mengembalikan undefined (falsy) sehingga kedua pemanggil MEMBATALKAN aksinya.
// ============================================================

// ============================================================
// 16B. SNAPSHOT BACKUP (cadangan harian semua data Umroh)
// ============================================================
// Menyimpan snapshot lengkap seluruh data Umroh ke tabel Supabase
// `snapshot_backup` (jsonb). Maksimal MAX_SNAPSHOTS snapshot terbaru
// (FIFO) — snapshot tertua otomatis dihapus saat batas tercapai.
// Snapshot otomatis diambil SEBELUM tindakan berisiko (hapus semua /
// import) supaya ada cadangan berjaga-jaga.
const MAX_SNAPSHOTS = 10;
const SNAPSHOT_TABLES = ['programs', 'kb_jamaah', 'jadwal_tamu', 'pendaftaran', 'pembayaran_jamaah', 'featured_programs'];

// Ambil seluruh baris dari semua tabel terkait dalam satu objek.
// strict=false (snapshot manual/harian): tabel yang gagal dimuat disimpan kosong.
// strict=true (snapshot pengaman sebelum Hapus Semua/Import): satu tabel gagal
// dimuat -> lempar error, supaya snapshot yang "berhasil" tidak pernah ternyata
// cadangan yang bolong (dan aksi berisiko di belakangnya ikut dibatalkan).
async function collectAllUmrohData(strict = false) {
    const data = {};
    for (const tbl of SNAPSHOT_TABLES) {
        try {
            const { data: rows, error } = await withRetry(
                () => supabaseClient.from(tbl).select('*'),
                { label: 'Snapshot: muat ' + tbl }
            );
            if (error) throw error;
            data[tbl] = rows || [];
        } catch (err) {
            console.error('collectAllUmrohData error on', tbl, err);
            if (strict) throw new Error('tabel ' + tbl + ' gagal dimuat (' + (err.message || err) + ')');
            data[tbl] = [];
        }
    }
    return data;
}

async function takeSnapshot(label = 'Snapshot', trigger = 'manual', strict = false) {
    try {
        showToast('Membuat snapshot...', 'info');
        const payload = await collectAllUmrohData(strict);
        const totalRows = SNAPSHOT_TABLES.reduce((s, t) => s + (payload[t] ? payload[t].length : 0), 0);
        const { error } = await supabaseClient.from('snapshot_backup').insert([{
            label: String(label).slice(0, 80),
            trigger: String(trigger).slice(0, 40),
            data: payload,
            meta: { total_rows: totalRows, tables: SNAPSHOT_TABLES }
        }]);
        if (error) throw error;

        // Trim FIFO: simpan hanya MAX_SNAPSHOTS terbaru
        const { data: all, error: listErr } = await supabaseClient
            .from('snapshot_backup').select('id, created_at').order('created_at', { ascending: true });
        if (!listErr && all && all.length > MAX_SNAPSHOTS) {
            const excess = all.slice(0, all.length - MAX_SNAPSHOTS);
            for (const row of excess) {
                await supabaseClient.from('snapshot_backup').delete().eq('id', row.id);
            }
        }
        showToast('✅ Snapshot tersimpan (' + totalRows + ' baris)');
        return true;
    } catch (err) {
        console.error('takeSnapshot error:', err);
        showToast('❌ Gagal membuat snapshot: ' + (err.message || err), 'error');
        return false;
    }
}

// Ambil snapshot pengaman sebelum tindakan berisiko (mode strict: cadangan harus
// lengkap). Mengembalikan true/false -- PEMANGGIL WAJIB membatalkan aksinya kalau
// false (lihat clearAllAdminData() dan importAdminData()).
async function ensureAutoSnapshot(trigger, label) {
    const ok = await takeSnapshot(label || ('Auto: ' + trigger), trigger, true);
    if (!ok) console.warn('Auto-snapshot gagal, tindakan berisiko dibatalkan oleh pemanggil.');
    return ok;
}

async function listSnapshots() {
    const { data, error } = await supabaseClient
        .from('snapshot_backup').select('id, created_at, label, trigger, meta').order('created_at', { ascending: false });
    if (error) { console.error('listSnapshots error:', error); return []; }
    return data || [];
}

// Catatan keamanan: TIDAK ada fungsi hapus snapshot manual.
// Snapshot hanya boleh hilang secara otomatis (FIFO, lihat takeSnapshot())
// begitu jumlahnya melebihi MAX_SNAPSHOTS — supaya cadangan data tidak
// bisa dihapus sembarangan oleh admin maupun pihak lain yang menyusup.

// Pulihkan seluruh data dari satu snapshot ke semua tabel (upsert by id).
async function restoreSnapshot(id) {
    if (!(await openActionConfirm({
        title: 'Pulihkan dari Snapshot?',
        message: 'Semua tabel (program, jamaah, jadwal, pendaftaran, pembayaran, unggulan) akan di-update/insert dari snapshot ini.<br><br>Baris yang ada di DB tapi tidak ada di snapshot <strong>TIDAK</strong> dihapus.',
        confirmLabel: 'Pulihkan Snapshot',
        danger: true
    }))) return;
    try {
        showToast('Memulihkan snapshot...', 'info');
        const { data: snap, error } = await supabaseClient
            .from('snapshot_backup').select('*').eq('id', id).single();
        if (error) throw error;
        const payload = (snap && snap.data) || {};
        for (const tbl of SNAPSHOT_TABLES) {
            const rows = payload[tbl] || [];
            if (!rows.length) continue;
            const clean = rows.filter(r => r && r.id).map(r => {
                const c = { ...r };
                if (c.id && !isValidUUID(c.id)) delete c.id;
                return c;
            });
            if (!clean.length) continue;
            const { error: upErr } = await supabaseClient.from(tbl).upsert(clean, { onConflict: 'id' });
            if (upErr) console.error('restoreSnapshot upsert', tbl, upErr);
        }
        await loadDataFromSupabase(true);
        if (typeof loadKbJamaah === 'function') { try { await loadKbJamaah(); } catch (e) {} }
        if (typeof loadJadwal === 'function') { try { await loadJadwal(); } catch (e) {} }
        if (typeof loadPendaftaran === 'function') { try { await loadPendaftaran(); } catch (e) {} }
        if (typeof loadFeaturedIds === 'function') { try { await loadFeaturedIds(); } catch (e) {} }
        await renderAdminPanel();
        showToast('✅ Data dipulihkan dari snapshot');
        if (adminSubTab === 'snapshot') renderSnapshotAdminTable();
    } catch (err) {
        console.error('restoreSnapshot error:', err);
        showToast('❌ Gagal pulihkan: ' + (err.message || err), 'error');
    }
}

const SNAPSHOT_TRIGGER_LABEL = {
    'manual': { text: 'Manual', color: '#1a355b', tint: '#dbe4ee' },
    'auto-daily': { text: 'Harian', color: '#279E70', tint: '#E1F5EC' },
    'auto-pre-clear': { text: 'Auto · sebelum hapus', color: '#C0392B', tint: '#FBE3E0' },
    'auto-pre-import': { text: 'Auto · sebelum import', color: '#E07B2E', tint: '#FBEBD9' }
};

// Label hari untuk header grup timeline: "Hari ini" / "Kemarin" / nama hari
// lengkap -- supaya lebih cepat dipindai dibanding tanggal mentah, terutama
// waktu ada beberapa snapshot dalam satu hari (harian + manual, dst).
function formatSnapDayLabel(d) {
    if (isNaN(d)) return '-';
    const startOfDay = x => { const c = new Date(x); c.setHours(0, 0, 0, 0); return c.getTime(); };
    const today = startOfDay(new Date());
    const yesterday = today - 86400000;
    const tglLengkap = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    if (startOfDay(d) === today) return `Hari ini &middot; ${tglLengkap}`;
    if (startOfDay(d) === yesterday) return `Kemarin &middot; ${tglLengkap}`;
    return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function renderSnapshotAdminTable() {
    const wrap = document.getElementById('snapshotTableWrap');
    if (!wrap) return;
    wrap.innerHTML = '<div style="text-align:center;padding:18px;color:var(--ink-soft);font-size:12px;"><i class="bi bi-arrow-repeat bi-spin"></i> Memuat...</div>';
    listSnapshots().then(rows => {
        // ---- Reel kapasitas: 10 "frame" seperti gulungan film -- kiri = paling
        // tua, kanan = slot kosong yang masih tersisa. Begitu 10 slot penuh,
        // frame paling kiri (tertua) ditandai sebagai kandidat berikutnya yang
        // otomatis tergantikan (FIFO), sesuai perilaku nyata di takeSnapshot().
        const oldestToNewest = [...rows].reverse();
        const reelSlots = oldestToNewest.slice();
        while (reelSlots.length < MAX_SNAPSHOTS) reelSlots.push(null);
        const reelHtml = reelSlots.map((r, i) => {
            if (!r) return `<span class="snap-frame snap-frame-empty" title="Slot kosong"></span>`;
            const trig = SNAPSHOT_TRIGGER_LABEL[r.trigger] || { text: r.trigger || 'manual', color: '#64758A', tint: '#F4F7FB' };
            const d = new Date(r.created_at);
            const tstr = isNaN(d) ? '' : d.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
            const isOldest = i === 0 && oldestToNewest.length >= MAX_SNAPSHOTS;
            const tip = `${r.label || 'Snapshot'} &middot; ${tstr}${isOldest ? ' &middot; akan digantikan snapshot berikutnya' : ''}`;
            return `<span class="snap-frame${isOldest ? ' snap-frame-oldest' : ''}" style="background:${trig.color};" title="${escapeHtml(tip)}"></span>`;
        }).join('');
        const reelGaugeHtml = `
            <div class="snap-reel-wrap">
                <div class="snap-reel-track">${reelHtml}</div>
                <span class="snap-reel-count">${rows.length}<em>/${MAX_SNAPSHOTS}</em></span>
            </div>`;

        if (!rows.length) {
            wrap.innerHTML = `
                ${reelGaugeHtml}
                <div class="snap-empty"><i class="bi bi-camera2"></i><span>Belum ada snapshot. Klik <b>Ambil</b> di kanan atas untuk membuat cadangan pertama.</span></div>`;
            return;
        }

        // ---- Kelompokkan per hari (data sudah urut terbaru -> tertua) ----
        const groups = [];
        let curKey = null, curGroup = null;
        rows.forEach(r => {
            const d = new Date(r.created_at);
            const key = isNaN(d) ? 'unknown' : d.toISOString().slice(0, 10);
            if (key !== curKey) {
                curGroup = { date: d, items: [] };
                groups.push(curGroup);
                curKey = key;
            }
            curGroup.items.push(r);
        });

        const groupsHtml = groups.map(g => {
            const itemsHtml = g.items.map(r => {
                const d = new Date(r.created_at);
                const tstr = isNaN(d) ? '-' : d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
                const total = (r.meta && r.meta.total_rows != null) ? r.meta.total_rows : '-';
                const trig = SNAPSHOT_TRIGGER_LABEL[r.trigger] || { text: r.trigger || 'manual', color: '#64758A', tint: '#F4F7FB' };
                return `
                <div class="snap-card">
                    <span class="snap-card-dot" style="background:${trig.color};"></span>
                    <div class="snap-card-main">
                        <div class="snap-card-top">
                            <span class="snap-card-label" title="${escapeHtml(r.label || 'Snapshot')}">${escapeHtml(r.label || 'Snapshot')}</span>
                            <span class="snap-card-badge" style="color:${trig.color};background:${trig.tint};">${escapeHtml(trig.text)}</span>
                        </div>
                        <div class="snap-card-meta">${tstr} &middot; ${total} baris</div>
                    </div>
                    <button class="snap-card-restore" title="Pulihkan snapshot ini" onclick="restoreSnapshot('${r.id}')"><i class="bi bi-arrow-counterclockwise"></i></button>
                </div>`;
            }).join('');
            return `
            <div class="snap-day-group">
                <div class="snap-day-label">${formatSnapDayLabel(g.date)}</div>
                <div class="snap-timeline">${itemsHtml}</div>
            </div>`;
        }).join('');

        wrap.innerHTML = `${reelGaugeHtml}<div class="snap-groups">${groupsHtml}</div>`;
    }).catch(err => {
        wrap.innerHTML = '<div style="text-align:center;padding:18px;color:var(--danger);font-size:12px;">Gagal memuat: ' + escapeHtml(err.message || err) + '</div>';
    });
}
