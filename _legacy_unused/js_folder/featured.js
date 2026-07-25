
    // ========== PROGRAM UNGGULAN (Supabase) ==========
    const MAX_FEATURED = 3;
    let featuredIds = [];

    async function loadFeaturedIds() {
        try {
            const res = await fetch(`${SUPABASE_URL}/rest/v1/featured_programs?select=program_id`, {
                headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }
            });
            featuredIds = res.ok ? (await res.json()).map(r => String(r.program_id)) : [];
        } catch (err) {
            console.error('loadFeaturedIds error:', err?.message || err);
            featuredIds = [];
        }
    }

    function getFeaturedIds() { return featuredIds; }
    function isFeatured(id) { return featuredIds.includes(String(id)); }

    async function toggleFeatured(id) {
        id = String(id);
        if (isFeatured(id)) {
            const { error } = await supabaseClient.from('featured_programs').delete().eq('program_id', id);
            if (error) { showToast('❌ Gagal: ' + error.message); return; }
            featuredIds = featuredIds.filter(i => i !== id);
            showToast('⭐ Program dihapus dari unggulan');
        } else {
            if (featuredIds.length >= MAX_FEATURED) { showToast('⚠️ Maksimal ' + MAX_FEATURED + ' program unggulan!'); return; }
            const { error } = await supabaseClient.from('featured_programs').insert([{ program_id: id }]);
            if (error) { showToast('❌ Gagal: ' + error.message); return; }
            featuredIds.push(id);
            showToast('⭐ Program ditambahkan ke unggulan!');
        }
        renderFeaturedSection();
        renderFeaturedAdminTable();
    }

    function renderFeaturedSection() {
        const ids = getFeaturedIds();
        const grid = document.getElementById('featuredGrid');
        if (!grid) return;

        const featuredPrograms = dataUmroh.filter(p => ids.includes(String(p.id)) && p.is_active !== false);

        if (!featuredPrograms.length) {
            grid.innerHTML = '<div class="featured-empty"><i class="fa-solid fa-star"></i>Belum ada program unggulan yang dipilih.</div>';
            return;
        }

        grid.innerHTML = featuredPrograms.map(p => {
            const isAvailable = p.isAvailable;
            return `<div class="featured-card" onclick="openDetailModal('${p.id}')">
                <div class="featured-badge"><i class="fas fa-star"></i> Unggulan</div>
                <div class="featured-card-name">${escapeHtml(p.nama||'')}</div>
                <div class="featured-card-meta">
                    ${p.tgl ? `<div class="featured-meta-row"><i class="fas fa-calendar"></i>${escapeHtml(p.tgl)}</div>` : ''}
                    ${p.durasi ? `<div class="featured-meta-row"><i class="fas fa-clock"></i>${escapeHtml(p.durasi)}</div>` : ''}
                    ${p.maskapai ? `<div class="featured-meta-row"><i class="fas fa-plane"></i>${escapeHtml(p.maskapai)}</div>` : ''}
                </div>
                ${p.harga_quint ? `<div class="featured-card-price">
                    <div><span class="featured-price-main">${escapeHtml(p.harga_quint)}</span><br><span class="featured-price-sub">per orang (Quint)</span></div>
                    <span class="status-pill ${isAvailable ? 'status-available' : 'status-expired'}" style="font-size:9px;">${isAvailable ? 'Tersedia' : 'Expired'}</span>
                </div>` : ''}
                <div class="featured-card-actions" onclick="event.stopPropagation()">
                    <button class="featured-btn featured-btn-detail" onclick="openDetailModal('${p.id}')"><i class="fas fa-info-circle"></i> Detail</button>
                    ${p.link_form ? `<button class="featured-btn featured-btn-wa" onclick="window.open('${escapeHtml(p.link_form)}','_blank')"><i class="fas fa-edit"></i> Daftar</button>` : ''}
                </div>
            </div>`;
        }).join('');
    }

    function renderFeaturedAdminTable() {
        const tbody = document.getElementById('featuredAdminTableBody');
        if (!tbody) return;
        if (!adminPrograms.length) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--text-3)">Belum ada program.</td></tr>';
            return;
        }
        const currentCount = getFeaturedIds().length;
        const isFull = currentCount >= MAX_FEATURED;
        // update counter badge if exists
        const counter = document.getElementById('featuredCounter');
        if (counter) counter.textContent = currentCount + '/' + MAX_FEATURED;
        const tabBadge = document.getElementById('tabCountUnggulan');
        if (tabBadge) tabBadge.textContent = currentCount + '/3';
        tbody.innerHTML = adminPrograms.map(p => {
            const featured = isFeatured(p.id);
            const canAdd = featured || !isFull;
            return `<tr>
                <td><strong>${escapeHtml(p.nama||'-')}</strong></td>
                <td>${escapeHtml(p.tgl||'-')}</td>
                <td>
                    <button class="featured-toggle-btn ${featured ? 'on' : 'off'}" 
                        ${!canAdd ? 'disabled style="opacity:.4;cursor:not-allowed;"' : ''}
                        onclick="toggleFeatured('${p.id}'); renderFeaturedAdminTable();">
                        ${featured ? '⭐ Tampil di Unggulan' : (isFull ? '🚫 Slot Penuh' : '☆ Jadikan Unggulan')}
                    </button>
                </td>
            </tr>`;
        }).join('');
    }

    // ========== JADWAL BERKUNJUNG TAMU (Supabase) ==========
    let jadwalList = [];
    let editingJadwalId = null;
