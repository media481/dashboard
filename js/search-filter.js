    // Sorting with debounce
    function sortTable(column) {
        currentSort.asc = currentSort.column === column ? !currentSort.asc : true;
        currentSort.column = column;
        currentData.sort((a,b) => {
            if (column === 'tgl') return currentSort.asc ? a.dateObj - b.dateObj : b.dateObj - a.dateObj;
            if (column === 'isAvailable') return currentSort.asc ? (a.isAvailable?1:0)-(b.isAvailable?1:0) : (b.isAvailable?1:0)-(a.isAvailable?1:0);
            const vA = String(a[column]||'').toLowerCase(), vB = String(b[column]||'').toLowerCase();
            return currentSort.asc ? vA.localeCompare(vB) : vB.localeCompare(vA);
        });
        document.querySelectorAll('.sort-icon').forEach(el=>el.textContent="↕");
        const iconSpan = document.getElementById(`icon-${column}`); iconSpan && (iconSpan.innerHTML = currentSort.asc?"▲":"▼");
        renderTable(currentData);
    }

    // Search with DEBOUNCE (300ms)
    function filterData(term) {
        const t = term.toLowerCase().trim(), now = new Date();
        const visiblePrograms = dataUmroh.filter(p => p.is_active !== false);
        if (!t) { currentData = [...visiblePrograms].sort((a,b) => (a.dateObj||0) - (b.dateObj||0)); }
        else {
            currentData = visiblePrograms.filter(item => {
                const status = item.dateObj >= now ? 'tersedia' : 'expired';
                // Pecah kata kunci: semua kata harus match di field manapun
                const keywords = t.split(/\s+/).filter(Boolean);
                const haystack = [
                    item.nama || '',
                    item.maskapai || '',
                    item.tgl || '',
                    item.durasi || '',
                    item.harga_quint || '',
                    item.teks_wa || '',
                    status
                ].join(' ').toLowerCase();
                return keywords.every(kw => haystack.includes(kw));
            });
        }
        if (currentSort.column) sortTable(currentSort.column);
        else renderTable(currentData);
    }

    function resetSearch() { document.getElementById('searchInput').value = ''; document.getElementById('searchInputMobile').value = ''; currentData = dataUmroh.filter(p => p.is_active !== false).sort((a,b) => (a.dateObj||0) - (b.dateObj||0)); renderTable(currentData); }

    // Debounce untuk search
    function handleSearchInput(e) { clearTimeout(debounceTimer); debounceTimer = setTimeout(() => filterData(e.target.value), 300); }
    document.getElementById('searchInput')?.addEventListener('input', handleSearchInput);
    document.getElementById('searchInputMobile')?.addEventListener('input', (e) => { document.getElementById('searchInput').value = e.target.value; clearTimeout(debounceTimer); debounceTimer = setTimeout(() => filterData(e.target.value), 300); });
    document.querySelectorAll('th.sortable').forEach(th => { const key = th.getAttribute('data-sort'); if (key) th.onclick = () => sortTable(key); });

    // Modal Detail
    function openDetailModal(programId) {
        const program = dataUmroh.find(p => String(p.id) === String(programId));
        if (!program) return;
        const waText = program.teks_wa || generateAutoWAText(program);
        document.getElementById('detailModalBody').innerHTML = `
            <div class="detail-info-grid"><div class="detail-info-item"><span class="detail-info-label">Nama Program</span><span class="detail-info-value">${escapeHtml(program.nama||'-')}</span></div><div class="detail-info-item"><span class="detail-info-label">Tanggal</span><span class="detail-info-value">${escapeHtml(program.tgl||'-')}</span></div><div class="detail-info-item"><span class="detail-info-label">Durasi</span><span class="detail-info-value">${escapeHtml(program.durasi||'-')}</span></div><div class="detail-info-item"><span class="detail-info-label">Maskapai</span><span class="detail-info-value">${escapeHtml(program.maskapai||'-')}</span></div><div class="detail-info-item"><span class="detail-info-label">Harga</span><span class="detail-info-value">${escapeHtml(program.harga_quint||'-')}</span></div><div class="detail-info-item"><span class="detail-info-label">Status</span><span class="detail-info-value" style="color:${program.isAvailable?'#16a34a':'#dc2626'}">${program.isAvailable?'Tersedia':'Expired'}</span></div></div>
            <div class="detail-wa-section"><div class="label"><i class="fab fa-whatsapp"></i> Teks Marketing WhatsApp</div><div class="detail-wa-text" id="detailWAText">${escapeHtml(waText).replace(/\n/g,'<br>').replace(/javascript:/gi,'blocked:')}</div><button class="btn btn-wa-copy" onclick="copyDetailWAText()"><i class="fas fa-copy"></i> Salin Teks WA</button></div>
            <div class="detail-actions">${program.link_form?`<a href="${escapeHtml(program.link_form)}" target="_blank" class="btn btn-register"><i class="fas fa-edit"></i> Form Pendaftaran</a>`:''}${program.link_itinerary?`<a href="${escapeHtml(program.link_itinerary)}" target="_blank" class="btn btn-link"><i class="fas fa-map"></i> Itinerary</a>`:''}${program.link_poster?`<a href="${escapeHtml(program.link_poster)}" target="_blank" class="btn btn-link"><i class="fas fa-image"></i> Poster</a>`:''}${program.link_metaads?`<a href="${escapeHtml(program.link_metaads)}" target="_blank" class="btn btn-link"><i class="fas fa-chart-line"></i> Meta Ads</a>`:''}${program.link_dokumentasi?`<a href="${escapeHtml(program.link_dokumentasi)}" target="_blank" class="btn btn-link"><i class="fas fa-folder"></i> Dokumentasi</a>`:''}</div>`;
        window.currentDetailWAText = waText;
        document.getElementById('detailModal').classList.add('show');
        document.body.style.overflow = 'hidden';
    }
    function closeDetailModal() { document.getElementById('detailModal').classList.remove('show'); document.body.style.overflow = ''; }
    function copyDetailWAText() { const text = window.currentDetailWAText; if (!text) return; navigator.clipboard.writeText(text).then(()=>showToast('Teks berhasil disalin!')).catch(()=>{const ta=document.createElement('textarea');ta.value=text;ta.style.cssText='position:fixed;opacity:0';document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);showToast('Teks berhasil disalin!');}); }

