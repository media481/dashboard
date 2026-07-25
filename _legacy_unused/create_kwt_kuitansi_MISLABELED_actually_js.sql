
    async function loadKbJamaah() {
        try {
            const { data, error } = await supabaseClient.from('kb_jamaah').select('*').order('nama', { ascending: true });
            if (error) throw error;
            kbJamaahList = data || [];
        } catch (err) {
            const msg = err?.message || String(err);
            if (msg.includes('DataCloneError') || msg.includes('postMessage')) {
                try {
                    const res = await fetch(`${SUPABASE_URL}/rest/v1/kb_jamaah?select=*&order=nama.asc`, {
                        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }
                    });
                    kbJamaahList = res.ok ? (await res.json()) : [];
                    return;
                } catch (_) {}
            }
            console.error('loadKbJamaah error:', msg);
            kbJamaahList = [];
        }
    }

    function renderKbProgramSelector() {
        const sel = document.getElementById('kbProgramSelector');
        if (!sel) return;
        if (!dataUmroh || dataUmroh.length === 0) {
            sel.innerHTML = '<div style="padding:10px;color:var(--text-3);font-size:13px;font-style:italic;">Belum ada data program. Silakan muat ulang halaman.</div>';
            return;
        }
        // Hanya tampilkan program yang sudah ada data jamaahnya
        const programs = dataUmroh
            .filter(p => kbJamaahList.some(j => String(j.program_id) === String(p.id)))
            .sort((a,b) => (a.dateObj||0) - (b.dateObj||0));
        if (programs.length === 0) {
            sel.innerHTML = '<div style="padding:10px;color:var(--text-3);font-size:13px;font-style:italic;">Belum ada data jamaah yang diinput.</div>';
            const content = document.getElementById('kbJamaahContent');
            if (content) content.innerHTML = `<div class="kb-no-program"><i class="fa-solid fa-plane-departure"></i><p>Belum ada data jamaah. Silakan input melalui Admin Panel.</p></div>`;
            return;
        }
        // Jika program yang dipilih sudah tidak ada di list, reset
        if (kbSelectedProgram && !programs.find(p => String(p.id) === String(kbSelectedProgram))) {
            kbSelectedProgram = null;
        }
        sel.innerHTML = programs.map(p => {
            const count = kbJamaahList.filter(j => String(j.program_id) === String(p.id)).length;
            const isActive = String(kbSelectedProgram) === String(p.id);
            return `<button class="kb-program-pill${isActive?' active':''}" onclick="selectKbProgram('${escapeHtml(String(p.id))}')">
                ${escapeHtml(p.nama||'Program')}
                <span class="pill-count">${count}</span>
            </button>`;
        }).join('');
        renderKbJamaahContent();
    }

    function selectKbProgram(id) {
        kbSelectedProgram = id;
        renderKbProgramSelector();
    }

    function renderKbJamaahContent() {
        const content = document.getElementById('kbJamaahContent');
        if (!content) return;
        if (!kbSelectedProgram) {
            content.innerHTML = `<div class="kb-no-program"><i class="fa-solid fa-plane-departure"></i><p>Pilih program di atas untuk melihat daftar jamaah yang berangkat.</p></div>`;
            return;
        }
        const prog = dataUmroh.find(p => String(p.id) === String(kbSelectedProgram));
        if (!prog) {
            content.innerHTML = `<div class="kb-no-program"><i class="fa-solid fa-triangle-exclamation"></i><p>Program tidak ditemukan.</p></div>`;
            return;
        }
        const jamaah = kbJamaahList.filter(j => String(j.program_id) === String(kbSelectedProgram));
        const totalLunas = jamaah.filter(j => j.status === 'lunas').length;
        const totalDp = jamaah.filter(j => j.status === 'dp').length;

        let tableRows = '';
        if (jamaah.length === 0) {
            tableRows = `<tr><td colspan="6"><div class="kb-empty"><i class="fa-solid fa-users"></i><p>Belum ada data jamaah untuk program ini.</p></div></td></tr>`;
        } else {
            const sorted = [...jamaah].sort((a,b) => (a.nama||'').localeCompare(b.nama||''));
            tableRows = sorted.map((j,i) => {
                const statusClass = j.status === 'lunas' ? 'kb-status-lunas' : j.status === 'dp' ? 'kb-status-dp' : 'kb-status-pending';
                const statusLabel = j.status === 'lunas' ? 'Lunas' : j.status === 'dp' ? 'DP / Cicil' : 'Pending';
                return `<tr>
                    <td style="color:var(--text-3);font-size:12px;">${i+1}</td>
                    <td><span class="kb-jamaah-name">${escapeHtml(j.nama||'-')}</span>${j.nik?`<span class="kb-jamaah-nik">NIK: ${escapeHtml(j.nik)}</span>`:''}</td>
                    <td style="font-size:12.5px;font-weight:600;">${escapeHtml(j.paspor||'-')}</td>
                    <td style="font-size:12.5px;">${escapeHtml(j.asal||'-')}</td>
                    <td style="font-size:12.5px;">${j.wa ? escapeHtml(j.wa) : '-'}</td>
                    <td><span class="kb-status-pill ${statusClass}">${statusLabel}</span></td>
                </tr>`;
            }).join('');
        }

        const tglDisplay = prog.tgl ? prog.tgl : '-';
        content.innerHTML = `
        <div class="kb-section-header">
            <div class="kb-section-title">
                <div>
                    <div class="kb-prog-name">${escapeHtml(prog.nama||'Program')}</div>
                    <div class="kb-prog-date">${tglDisplay} &nbsp;·&nbsp; ${escapeHtml(prog.maskapai||'-')} &nbsp;·&nbsp; ${escapeHtml(prog.durasi||'-')}</div>
                </div>
            </div>
            <div class="kb-section-meta">
                <span class="kb-chip total">${jamaah.length} Jamaah</span>
                <span class="kb-chip lunas">${totalLunas} Lunas</span>
                ${totalDp>0?`<span class="kb-chip dp">${totalDp} DP</span>`:''}
            </div>
        </div>
        <div class="kb-jamaah-table-wrap">
            <table class="kb-jamaah-table">
                <thead><tr>
                    <th>#</th>
                    <th>Nama Jamaah</th>
                    <th>No. Paspor</th>
                    <th>Asal Daerah</th>
                    <th>WhatsApp</th>
                    <th>Status Bayar</th>
                </tr></thead>
                <tbody>${tableRows}</tbody>
            </table>
        </div>`;
    }

    function openKbModal(id) {
        editingKbId = id || null;
        const modal = document.getElementById('kbModal');
        const titleEl = document.getElementById('kbModalTitle');
        // Populate program dropdown
        const progSel = document.getElementById('kb_program');
        if (!dataUmroh || dataUmroh.length === 0) {
            showToast('⚠️ Data program belum dimuat, coba lagi sebentar');
            return;
        }
        progSel.innerHTML = dataUmroh.map(p => `<option value="${escapeHtml(String(p.id))}">${escapeHtml(p.nama||'Program')}</option>`).join('');
        if (editingKbId) {
            const j = kbJamaahList.find(x => x.id === editingKbId);
            if (j) {
                titleEl.textContent = 'Edit Data Jamaah';
                progSel.value = String(j.program_id);
                document.getElementById('kb_nama').value = j.nama || '';
                document.getElementById('kb_nik').value = j.nik || '';
                document.getElementById('kb_paspor').value = j.paspor || '';
                document.getElementById('kb_wa').value = j.wa || '';
                document.getElementById('kb_asal').value = j.asal || '';
                document.getElementById('kb_status').value = j.status || 'lunas';
                document.getElementById('kb_catatan').value = j.catatan || '';
            }
        } else {
            titleEl.textContent = 'Tambah Data Jamaah';
            // Pre-select program: gunakan kbSelectedAdminProgram jika modal dibuka dari admin panel
            const preselect = kbEditFromAdmin || document.getElementById('adminModal')?.classList.contains('show')
                ? (kbSelectedAdminProgram || kbSelectedProgram)
                : kbSelectedProgram;
            if (preselect) progSel.value = String(preselect);
            document.getElementById('kb_nama').value = '';
            document.getElementById('kb_nik').value = '';
            document.getElementById('kb_paspor').value = '';
            document.getElementById('kb_wa').value = '';
            document.getElementById('kb_asal').value = '';
            document.getElementById('kb_status').value = 'lunas';
            document.getElementById('kb_catatan').value = '';
        }
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    function closeKbModal() {
        document.getElementById('kbModal').classList.remove('show');
        document.body.style.overflow = '';
        editingKbId = null;
        kbEditFromAdmin = false;
    }

    async function saveKbJamaah() {
        const nama = document.getElementById('kb_nama').value.trim();
        if (!nama) { showToast('⚠️ Nama jamaah wajib diisi'); return; }
        const progId = document.getElementById('kb_program').value;
        if (!progId) { showToast('⚠️ Pilih program keberangkatan'); return; }
        const entry = {
            program_id: progId,
            nama,
            nik: document.getElementById('kb_nik').value.trim(),
            paspor: document.getElementById('kb_paspor').value.trim(),
            wa: document.getElementById('kb_wa').value.trim(),
            asal: document.getElementById('kb_asal').value.trim(),
            status: document.getElementById('kb_status').value,
            catatan: document.getElementById('kb_catatan').value.trim(),
        };
        let err = null;
        if (editingKbId) {
            const { error } = await supabaseClient.from('kb_jamaah').update(entry).eq('id', editingKbId);
            err = error;
        } else {
            const { error } = await supabaseClient.from('kb_jamaah').insert([{ ...entry, id: crypto.randomUUID(), created_at: new Date().toISOString() }]);
            err = error;
        }
        if (err) { showToast('❌ Gagal simpan: ' + err.message); return; }
        await loadKbJamaah();
        closeKbModal();
        // Refresh tampilan sesuai konteks (public atau admin)
        if (kbEditFromAdmin || document.getElementById('adminModal')?.classList.contains('show')) {
            kbSelectedAdminProgram = progId;
            renderKbAdminSelector(progId);
        } else {
            kbSelectedProgram = progId;
            renderKbProgramSelector();
        }
        kbEditFromAdmin = false;
        showToast('✈️ Data jamaah berhasil disimpan!');
    }

    async function deleteKbJamaah(id) {
        if (!confirm('Hapus data jamaah ini?')) return;
        const { error } = await supabaseClient.from('kb_jamaah').delete().eq('id', id);
        if (error) { showToast('❌ Gagal hapus: ' + error.message); return; }
        kbJamaahList = kbJamaahList.filter(j => j.id !== id);
        renderKbProgramSelector();
        if (document.getElementById('adminModal')?.classList.contains('show')) {
            renderKbAdminSelector(kbSelectedAdminProgram);
        }
        showToast('🗑️ Data jamaah dihapus');
    }

    function kbHubungi(wa, nama) {
        const no = wa.replace(/\D/g,'');
        const pesan = encodeURIComponent(`Assalamualaikum ${nama}, kami dari PT Amiru Haramain Indonesia. Kami menghubungi terkait persiapan keberangkatan umroh Anda. Terima kasih 🕋`);
        window.open(`https://wa.me/${no}?text=${pesan}`, '_blank');
    }

    window.openKbModal = openKbModal;
    window.closeKbModal = closeKbModal;
    window.saveKbJamaah = saveKbJamaah;
    window.deleteKbJamaah = deleteKbJamaah;
    window.kbHubungi = kbHubungi;
    window.selectKbProgram = selectKbProgram;

    window.openJadwalModal = openJadwalModal;
    window.closeJadwalModal = closeJadwalModal;
    window.saveJadwalTamu = saveJadwalTamu;
    window.deleteJadwalTamu = deleteJadwalTamu;
    window.hubungiTamu = hubungiTamu;
    window.renderJadwalAdminTable = renderJadwalAdminTable;

    window.toggleFeatured = toggleFeatured;
    window.renderFeaturedAdminTable = renderFeaturedAdminTable;

    // ========== TELEGRAM NOTIFIKASI ==========
    const TG_REMINDER_KEY = 'amiru_tg_reminder_sent'; // { programId: 'YYYY-MM-DD' }
    let _tgConfigCache = null;
