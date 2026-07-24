    async function loadDataFromSupabase(forceRefresh = false) {
        const loadingEl = document.getElementById('loadingState'), tableEl = document.getElementById('packageTable');
        loadingEl.style.display = 'block'; tableEl.style.display = 'none';
        renderSkeleton();
        
        if (!forceRefresh) {
            const cached = sessionStorage.getItem(CACHE_KEY), cacheTime = sessionStorage.getItem(CACHE_TIME_KEY);
            if (cached && cacheTime && (Date.now() - parseInt(cacheTime) < CACHE_DURATION)) {
                dataUmroh = JSON.parse(cached);
                dataUmroh.forEach(p => { if (p.tgl && !p.dateObj) p.dateObj = parseDateFromString(p.tgl); p.isAvailable = p.dateObj >= new Date(); });
                currentData = dataUmroh.filter(p => p.is_active !== false).sort((a,b) => (a.dateObj||0) - (b.dateObj||0));
                renderTable(currentData); renderStats(); initTicker(); renderFeaturedSection();
                loadingEl.style.display = 'none'; tableEl.style.display = 'table';
                return;
            }
        }
        
        try {
            const { data, error } = await supabaseClient.from('programs').select('*').order('created_at', { ascending: true });
            if (error) throw error;            // Simpan hanya field plain (tanpa dateObj/isAvailable) ke cache agar JSON.stringify aman
            const plainData = (data || []).map(p => ({
                id: p.id, nama: p.nama, tgl: p.tgl, durasi: p.durasi, maskapai: p.maskapai,
                harga_quint: p.harga_quint, teks_wa: p.teks_wa,
                link_form: p.link_form, link_itinerary: p.link_itinerary,
                link_poster: p.link_poster, link_metaads: p.link_metaads,
                link_dokumentasi: p.link_dokumentasi, created_at: p.created_at,
                is_active: p.is_active !== false
            }));
            sessionStorage.setItem(CACHE_KEY, JSON.stringify(plainData));
            sessionStorage.setItem(CACHE_TIME_KEY, Date.now().toString());
            dataUmroh = plainData;
            dataUmroh.forEach(p => { p.dateObj = parseDateFromString(p.tgl); p.isAvailable = p.dateObj >= new Date(); });
            currentData = dataUmroh.filter(p => p.is_active !== false).sort((a,b) => (a.dateObj||0) - (b.dateObj||0));
            renderTable(currentData); renderStats(); initTicker(); renderFeaturedSection();
            loadingEl.style.display = 'none'; tableEl.style.display = 'table';
        } catch (err) {
            const msg = err?.message || String(err);
            if (msg.includes('DataCloneError') || msg.includes('postMessage')) {
                // Fallback: REST API langsung, bypass SDK sepenuhnya
                try {
                    const res = await fetch(`${SUPABASE_URL}/rest/v1/programs?select=*&order=created_at.asc`, {
                        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }
                    });
                    if (res.ok) {
                        const raw = await res.json();
                        const plainData = (raw || []).map(p => ({
                            id: p.id, nama: p.nama, tgl: p.tgl, durasi: p.durasi, maskapai: p.maskapai,
                            harga_quint: p.harga_quint, teks_wa: p.teks_wa,
                            link_form: p.link_form, link_itinerary: p.link_itinerary,
                            link_poster: p.link_poster, link_metaads: p.link_metaads,
                            link_dokumentasi: p.link_dokumentasi, created_at: p.created_at,
                            is_active: p.is_active !== false
                        }));
                        sessionStorage.setItem(CACHE_KEY, JSON.stringify(plainData));
                        sessionStorage.setItem(CACHE_TIME_KEY, Date.now().toString());
                        dataUmroh = plainData;
                        dataUmroh.forEach(p => { p.dateObj = parseDateFromString(p.tgl); p.isAvailable = p.dateObj >= new Date(); });
                        currentData = dataUmroh.filter(p => p.is_active !== false).sort((a,b) => (a.dateObj||0) - (b.dateObj||0));
                        renderTable(currentData); renderStats(); initTicker(); renderFeaturedSection();
                        loadingEl.style.display = 'none'; tableEl.style.display = 'table';
                        return;
                    }
                } catch (_) {}
            }
            loadingEl.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>Gagal memuat data: ${sanitizeHtml(msg)}</p><button class="btn-reset" onclick="location.reload()">Coba Lagi</button></div>`;
        }
    }

    async function insertProgram(programData) { const { data, error } = await supabaseClient.from('programs').insert([programData]).select(); if (error) throw error; sessionStorage.removeItem(CACHE_KEY); return data[0]; }
    async function upsertProgram(programData) { const { data, error } = await supabaseClient.from('programs').upsert([programData], { onConflict: 'id' }).select(); if (error) throw error; sessionStorage.removeItem(CACHE_KEY); return data[0]; }
    async function updateProgramById(id, programData) { const { data, error } = await supabaseClient.from('programs').update(programData).eq('id', id).select(); if (error) throw error; sessionStorage.removeItem(CACHE_KEY); return data[0]; }
    async function deleteProgramById(id) { const { error } = await supabaseClient.from('programs').delete().eq('id', id); if (error) throw error; sessionStorage.removeItem(CACHE_KEY); }

