
    async function loadJadwal() {
        try {
            const { data, error } = await supabaseClient.from('jadwal_tamu').select('*').order('tgl', { ascending: true });
            if (error) throw error;
            jadwalList = data || [];
        } catch (err) {
            const msg = err?.message || String(err);
            if (msg.includes('DataCloneError') || msg.includes('postMessage')) {
                // Fallback: REST API langsung
                try {
                    const res = await fetch(`${SUPABASE_URL}/rest/v1/jadwal_tamu?select=*&order=tgl.asc`, {
                        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }
                    });
                    jadwalList = res.ok ? (await res.json()) : [];
                    return;
                } catch (_) {}
            }
            console.error('loadJadwal error:', msg);
            jadwalList = [];
        }
    }

    function getJadwalById(id) { return jadwalList.find(j => j.id === id); }

    async function saveJadwalTamu() {
        const nama = document.getElementById('jf_nama').value.trim();
        const tgl = document.getElementById('jf_tgl').value;
        if (!nama) { alert('Nama tamu wajib diisi!'); return; }
        if (!tgl) { alert('Tanggal kunjungan wajib diisi!'); return; }
        const entry = {
            nama,
            asal: document.getElementById('jf_asal').value.trim(),
            tgl,
            jam: document.getElementById('jf_jam').value,
            jumlah: document.getElementById('jf_jumlah').value ? parseInt(document.getElementById('jf_jumlah').value) : null,
            keperluan: document.getElementById('jf_keperluan').value,
            wa: document.getElementById('jf_wa').value.trim(),
            catatan: document.getElementById('jf_catatan').value.trim(),
        };
        let err = null;
        if (editingJadwalId) {
            const { error } = await supabaseClient.from('jadwal_tamu').update(entry).eq('id', editingJadwalId);
            err = error;
        } else {
            const { error } = await supabaseClient.from('jadwal_tamu').insert([{ ...entry, id: crypto.randomUUID(), created_at: new Date().toISOString() }]);
            err = error;
        }
        if (err) { showToast('❌ Gagal simpan: ' + err.message); return; }
        const isEdit = !!editingJadwalId;
        await loadJadwal();
        closeJadwalModal();
        renderJadwalSection();
        renderJadwalAdminTable();
        showToast('📅 Jadwal tamu berhasil disimpan!');
        // Kirim notif Telegram
        sendTelegramNotif(formatTgJadwal(entry, isEdit), 'jadwal');
    }

    async function deleteJadwalTamu(id) {
        if (!confirm('Hapus jadwal tamu ini?')) return;
        const { error } = await supabaseClient.from('jadwal_tamu').delete().eq('id', id);
        if (error) { showToast('❌ Gagal hapus: ' + error.message); return; }
        jadwalList = jadwalList.filter(j => j.id !== id);
        renderJadwalSection();
        renderJadwalAdminTable();
        showToast('🗑️ Jadwal tamu dihapus');
    }

    function renderJadwalSection() {
        const grid = document.getElementById('jadwalGrid');
        const todayBadge = document.getElementById('jadwalTodayCount');
        const todayNum = document.getElementById('jadwalTodayNum');
        if (!grid) return;

        const today = new Date(); today.setHours(0,0,0,0);
        const todayStr = formatJadwalDate(today);

        // Sort: hari ini dan mendatang dulu, lalu lampau
        const upcoming = jadwalList.filter(j => {
            const d = new Date(j.tgl); d.setHours(0,0,0,0);
            return d >= today;
        }).sort((a,b) => new Date(a.tgl) - new Date(b.tgl));
        const past = jadwalList.filter(j => {
            const d = new Date(j.tgl); d.setHours(0,0,0,0);
            return d < today;
        }).sort((a,b) => new Date(b.tgl) - new Date(a.tgl));
        const sorted = [...upcoming, ...past];

        const todayCount = jadwalList.filter(j => {
            const d = new Date(j.tgl); d.setHours(0,0,0,0);
            return d.getTime() === today.getTime();
        }).length;

        if (todayCount > 0) {
            todayBadge.style.display = 'flex';
            todayNum.textContent = todayCount;
        } else {
            todayBadge.style.display = 'none';
        }

        if (!sorted.length) {
            grid.innerHTML = '<div class="jadwal-empty"><i class="fa-solid fa-calendar-xmark"></i>Belum ada jadwal tamu yang tercatat.</div>';
            return;
        }

        grid.innerHTML = sorted.map(j => {
            const d = new Date(j.tgl); d.setHours(0,0,0,0);
            const isToday = d.getTime() === today.getTime();
            const isPast = d < today;
            let statusClass = isToday ? 'today' : (isPast ? 'past' : 'upcoming');
            let statusLabel = isToday ? '🟣 Hari Ini' : (isPast ? 'Selesai' : 'Mendatang');
            const cardClass = isToday ? 'today-card' : (isPast ? 'past-card' : '');
            const tglFormatted = formatJadwalDateDisplay(j.tgl);
            return `<div class="jadwal-card ${cardClass}">
                <div class="jadwal-card-head">
                    <span class="jadwal-card-name">${escapeHtml(j.nama||'')}</span>
                    <span class="jadwal-status-pill ${statusClass}">${statusLabel}</span>
                </div>
                <div class="jadwal-meta">
                    <div class="jadwal-meta-row"><i class="fas fa-calendar"></i>${escapeHtml(tglFormatted)}${j.jam ? ' · ' + escapeHtml(j.jam) : ''}</div>
                    ${j.asal ? `<div class="jadwal-meta-row"><i class="fas fa-map-marker-alt"></i>${escapeHtml(j.asal)}</div>` : ''}
                    ${j.jumlah ? `<div class="jadwal-meta-row"><i class="fas fa-users"></i>${escapeHtml(String(j.jumlah))} orang</div>` : ''}
                    ${j.keperluan ? `<div class="jadwal-meta-row"><i class="fas fa-briefcase"></i>${escapeHtml(j.keperluan)}</div>` : ''}
                    ${j.catatan ? `<div class="jadwal-meta-row"><i class="fas fa-sticky-note"></i>${escapeHtml(j.catatan)}</div>` : ''}
                </div>
                <div class="jadwal-card-footer">
                    ${j.wa ? `<button class="jadwal-btn jadwal-btn-wa" onclick="hubungiTamu('${escapeHtml(j.wa)}','${escapeHtml(j.nama||'')}')"><i class="fab fa-whatsapp"></i> WA</button>` : ''}
                </div>
            </div>`;
        }).join('');
    }

    function formatJadwalDate(d) {
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
    function formatJadwalDateDisplay(isoStr) {
        if (!isoStr) return '-';
        const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des'];
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) return isoStr;
        const days = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
        return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
    }

    function openJadwalModal(id = null) {
        editingJadwalId = id;
        const title = document.getElementById('jadwalModalTitle');
        if (id) {
            const j = getJadwalById(id);
            if (!j) return;
            title.textContent = 'Edit Jadwal Tamu';
            document.getElementById('jf_nama').value = j.nama || '';
            document.getElementById('jf_asal').value = j.asal || '';
            document.getElementById('jf_tgl').value = j.tgl || '';
            document.getElementById('jf_jam').value = j.jam || '';
            document.getElementById('jf_jumlah').value = j.jumlah || '';
            document.getElementById('jf_keperluan').value = j.keperluan || '';
            document.getElementById('jf_wa').value = j.wa || '';
            document.getElementById('jf_catatan').value = j.catatan || '';
        } else {
            title.textContent = 'Tambah Jadwal Tamu';
            ['jf_nama','jf_asal','jf_tgl','jf_jam','jf_jumlah','jf_wa','jf_catatan'].forEach(id => document.getElementById(id).value = '');
            document.getElementById('jf_keperluan').value = '';
        }
        document.getElementById('jadwalModal').classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    function closeJadwalModal() {
        document.getElementById('jadwalModal').classList.remove('show');
        document.body.style.overflow = '';
        editingJadwalId = null;
    }

    function hubungiTamu(wa, nama) {
        const no = wa.replace(/\D/g,'');
        const pesan = encodeURIComponent(`Assalamualaikum ${nama}, kami dari PT Amiru Haramain Indonesia mengingatkan jadwal kunjungan Anda. Terima kasih 🕋`);
        window.open(`https://wa.me/${no}?text=${pesan}`, '_blank');
    }

    function renderJadwalAdminTable() {
        const tbody = document.getElementById('jadwalAdminTableBody');
        if (!tbody) return;
        const tabBadge = document.getElementById('tabCountJadwal');
        if (tabBadge) tabBadge.textContent = jadwalList.length;
        const today = new Date(); today.setHours(0,0,0,0);
        if (!jadwalList.length) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-3)">Belum ada jadwal tamu.</td></tr>';
            return;
        }
        const sorted = [...jadwalList].sort((a,b) => new Date(a.tgl) - new Date(b.tgl));
        tbody.innerHTML = sorted.map(j => {
            const d = new Date(j.tgl); d.setHours(0,0,0,0);
            const isToday = d.getTime() === today.getTime();
            const isPast = d < today;
            const statusLabel = isToday ? '🟣 Hari Ini' : (isPast ? 'Selesai' : '🔵 Mendatang');
            return `<tr ${isToday ? 'style="background:#faf5ff;"' : ''}>
                <td><strong>${escapeHtml(j.nama||'-')}</strong>${j.asal ? `<br><small style="color:var(--text-3)">${escapeHtml(j.asal)}</small>` : ''}</td>
                <td style="white-space:nowrap">${escapeHtml(formatJadwalDateDisplay(j.tgl))}${j.jam ? '<br><small>'+escapeHtml(j.jam)+'</small>' : ''}</td>
                <td>${j.jumlah ? escapeHtml(String(j.jumlah)) + ' orang' : '-'}</td>
                <td>${escapeHtml(j.keperluan||'-')}</td>
                <td>${statusLabel}</td>
                <td><div class="admin-action-btns">
                    <button onclick="openJadwalModal('${j.id}')" style="background:#ede9fe;color:#7c3aed;"><i class="fas fa-edit"></i> Edit</button>
                    ${j.wa ? `<button onclick="hubungiTamu('${escapeHtml(j.wa)}','${escapeHtml(j.nama||'')}')" style="background:#dcfce7;color:#16a34a;"><i class="fab fa-whatsapp"></i> WA</button>` : ''}
                    <button onclick="deleteJadwalTamu('${j.id}')" style="background:#fee2e2;color:#dc2626;"><i class="fas fa-trash"></i></button>
                </div></td>
            </tr>`;
        }).join('');
    }

    function switchPubTab(name, btn) {
        document.querySelectorAll('.pub-tab-panel').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.pub-tab-btn').forEach(b => b.classList.remove('active'));
        const panel = document.getElementById('pub-tab-' + name);
        if (panel) panel.classList.add('active');
        if (btn) btn.classList.add('active');
        // reinit sort listeners if switching to umroh tab
        if (name === 'umroh') {
            document.querySelectorAll('th.sortable').forEach(th => {
                const key = th.getAttribute('data-sort');
                if (key) th.onclick = () => sortTable(key);
            });
        }
        // re-render featured if switching to unggulan tab
        if (name === 'unggulan') {
            renderFeaturedSection();
        }
        // render keberangkatan if switching to keberangkatan tab
        if (name === 'keberangkatan') {
            renderKbProgramSelector();
        }
    }
    window.switchPubTab = switchPubTab;

    // ========== DETAIL KEBERANGKATAN (Supabase) ==========
    let kbJamaahList = [];
    let kbSelectedProgram = null;
    let editingKbId = null;
