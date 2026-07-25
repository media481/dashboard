    // ========== SUPABASE CONFIG ==========
    const SUPABASE_URL = "https://rkdhssbyqqyheczejtix.supabase.co";
    const SUPABASE_ANON_KEY = "sb_publishable_YzVUaQ-f53v3JId4art8zg_AQWSSMU_";
    const MASKAPAI_LIST = ["Oman Air","Saudia Airlines","Lion Air","Garuda Indonesia","Emirates","Qatar Airways","Etihad Airways","Malindo Air","Air Asia","IndiGo"];
    const CACHE_KEY = 'amiru_cached_data';
    const CACHE_TIME_KEY = 'amiru_cache_time';
    const CACHE_DURATION = 60000; // 60 detik (sebelumnya 5 menit — terlalu lama, bikin teks WA yang baru diedit tidak langsung muncul di halaman publik)
    const DATA_DIRTY_KEY = 'amiru_data_dirty'; // dipakai untuk broadcast antar-tab: begitu ada perubahan (insert/update/delete), tab lain (mis. halaman publik yang sudah terbuka) langsung ikut refresh
    const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB max file import
    const SESSION_DURATION = 30 * 60 * 1000; // 30 menit

    // Hindari DataCloneError: gunakan fetch native langsung, tanpa wrapper tambahan
    const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            storageKey: 'amiru_supabase_auth',
            storage: window.sessionStorage,
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false,
        },
        realtime: { enabled: false },
        global: {
            fetch: (...args) => fetch(...args),
        },
    });

    // ========== USER ROLES ==========
    // Password disimpan di Supabase tabel app_config, bukan di sini
    let USER_ROLES = {};
    async function loadUserRoles() {
        try {
            const { data, error } = await supabaseClient.from('app_config').select('key, value');
            if (error || !data) return;
            data.forEach(row => {
                if (row.key === 'pass_administrator') USER_ROLES[row.value] = { role: 'administrator', label: 'Administrator' };
                if (row.key === 'pass_cs')            USER_ROLES[row.value] = { role: 'cs',            label: 'CS / Customer Service' };
            });
        } catch (_) {}
    }

    let dataUmroh = [], currentData = [], currentSort = { column: null, asc: true };
    let adminLoggedIn = false, currentRole = null, editingProgramId = null, adminSortColumn = null, adminSortAsc = true, adminPrograms = [];
    let debounceTimer = null, sessionTimeout = null;

    // Security: Rate limiting untuk login
    let loginAttempts = 0;
    let loginLockTime = 0;
    
    // ========== SECURITY: VALIDASI URL ==========
    function isValidUrl(string) {
        if (!string) return true; // kosong dianggap valid
        try {
            const url = new URL(string);
            return url.protocol === 'http:' || url.protocol === 'https:';
        } catch (_) {
            return false;
        }
    }
    
    // ========== SECURITY: SANITASI INPUT (Double Escape) ==========
    function sanitizeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>]/g, (m) => {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            return m;
        }).replace(/javascript:/gi, 'blocked:');
    }
    
    // ========== SECURITY: VALIDASI NAMA PROGRAM ==========
    function isValidProgramName(name) {
        if (!name) return false;
        // Hanya huruf, angka, spasi, dan karakter umum yang aman
        // Izinkan huruf Latin, Arab, angka, dan karakter umum nama program
        const validPattern = /^[\p{L}\p{N}\s\-.,()+&:!?\/]+$/u;
        return validPattern.test(name);
    }
    
    // ========== SESSION MANAGEMENT ==========
    function setAdminSession(role) {
        adminLoggedIn = true;
        currentRole = role;
        sessionStorage.setItem('admin_logged_in', 'true');
        sessionStorage.setItem('admin_role', role);
        sessionStorage.setItem('admin_login_time', Date.now().toString());
        
        if (sessionTimeout) clearTimeout(sessionTimeout);
        sessionTimeout = setTimeout(() => {
            if (adminLoggedIn) {
                adminLoggedIn = false;
                currentRole = null;
                sessionStorage.removeItem('admin_logged_in');
                sessionStorage.removeItem('admin_role');
                sessionStorage.removeItem('admin_login_time');
                const modal = document.getElementById('adminModal');
                if (modal.classList.contains('show')) {
                    closeAdminModal();
                }
                showToast('⏰ Sesi berakhir, silakan login ulang.');
            }
        }, SESSION_DURATION);
    }
    
    function checkSession() {
        const loggedIn = sessionStorage.getItem('admin_logged_in');
        const loginTime = sessionStorage.getItem('admin_login_time');
        const savedRole = sessionStorage.getItem('admin_role');
        if (loggedIn === 'true' && loginTime && (Date.now() - parseInt(loginTime) < SESSION_DURATION)) {
            adminLoggedIn = true;
            currentRole = savedRole || 'administrator';
            setAdminSession(currentRole); // refresh session
        } else {
            sessionStorage.removeItem('admin_logged_in');
            sessionStorage.removeItem('admin_role');
            sessionStorage.removeItem('admin_login_time');
            adminLoggedIn = false;
            currentRole = null;
        }
    }
    
    // ========== FUNGSI UTAMA ==========
    function parseDateFromString(dateStr) {
        if (!dateStr) return new Date();
        const months = {'Januari':0,'Februari':1,'Maret':2,'April':3,'Mei':4,'Juni':5,'Juli':6,'Agustus':7,'September':8,'Oktober':9,'November':10,'Desember':11};
        for (const [month, idx] of Object.entries(months))
            if (dateStr.includes(month)) {
                const parts = dateStr.split(' ');
                let day = parseInt(parts[0]), year = parseInt(parts[2]);
                if (isNaN(day)) day = parseInt(parts[0].replace(/^0+/, ''));
                return new Date(year, idx, day);
            }
        return new Date(dateStr);
    }

    function formatDateToIndonesian(date) {
        if (!date || isNaN(date.getTime())) return '';
        const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
        return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
    }

    // ========== GENERATE TEKS WA (native, tanpa AI) ==========
    // Mengikuti pola struktur yang sama dengan tool "Generator Caption — Amiru Tour":
    // 🕋 Judul -> 📅 Tanggal -> kalimat pembuka -> ✈️ Fasilitas -> 💰 Biaya -> ✅ Termasuk -> ❌ Tidak Termasuk -> 📞 Kontak
    // Semua disusun murni dari field form, tanpa memanggil API/AI.

    // Hash string sederhana & deterministik, dipakai untuk memilih variasi kalimat pembuka generik
    function simpleStringHash(str) {
        let h = 0;
        for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) >>> 0; }
        return h;
    }

    // Pilih emoji tema header berdasarkan kata kunci yang ada di nama program / catatan admin
    function detectThemeEmoji(text) {
        const t = text.toLowerCase();
        if (t.includes('al ula') || t.includes('alula')) return '🏜️';
        if (t.includes('tabligh')) return '📢';
        if (t.includes('dubai')) return '🏙️';
        if (t.includes('turki') || t.includes('turkey')) return '🕌';
        if (t.includes('ramadhan') || t.includes('ramadan')) return '🌙';
        if (t.includes('aqsa') || t.includes('al-aqsa')) return '🕌';
        return '🕋';
    }

    // Deteksi keunikan program (city tour, Al Ula, tabligh akbar, dst) dari nama/catatan/termasuk
    function detectProgramHighlights(text) {
        const t = text.toLowerCase();
        const map = [
            ['tabligh akbar', 'Tabligh Akbar bersama ulama'],
            ['al ula', 'wisata Al Ula'],
            ['alula', 'wisata Al Ula'],
            ['city tour', 'City Tour'],
            ['dubai', 'wisata Dubai'],
            ['turki', 'wisata Turki'],
            ['aqsa', 'ziarah Masjid Al-Aqsa'],
            ['kereta cepat', 'kereta cepat Haramain'],
        ];
        const found = [];
        map.forEach(([key, label]) => { if (t.includes(key) && !found.includes(label)) found.push(label); });
        return found;
    }

    const WA_OPENERS_GENERIC = [
        'Wujudkan niat suci ke Tanah Suci bersama pelayanan terbaik Amiru Tour.',
        'Perjalanan ibadah yang nyaman, aman, dan penuh berkah bersama Amiru Tour.',
        'Kesempatan beribadah dengan bimbingan pembimbing berpengalaman — kuota terbatas!',
        'Rasakan pengalaman umroh yang khusyuk dengan fasilitas terbaik dari Amiru Tour.',
        'Jangan tunda niat baik — daftar sekarang sebelum kuota penuh!',
    ];

    // Susun kalimat pembuka: pakai keunikan program kalau terdeteksi, kalau tidak fallback ke variasi generik (dipilih deterministik per nama program)
    function buildOpeningSentence(data) {
        const text = [data.nama, data.catatan_cx, data.termasuk].filter(Boolean).join(' ');
        const highlights = detectProgramHighlights(text);
        if (highlights.length) {
            return `Program spesial dengan tambahan ${highlights.join(' & ')} — kuota terbatas, segera daftar!`;
        }
        const idx = simpleStringHash(data.nama || 'amiru') % WA_OPENERS_GENERIC.length;
        return WA_OPENERS_GENERIC[idx];
    }

    function generateAutoWAText(data) {
        const s = v => (v || '').toString().replace(/javascript:/gi, 'blocked:');
        const namaUpper = s(data.nama || 'PROGRAM UMROH').toUpperCase();
        const emoji = detectThemeEmoji(s(data.nama) + ' ' + s(data.catatan_cx));

        // Judul
        let teks = `${emoji} *${namaUpper}* ${emoji}\n`;

        // Tanggal & durasi
        const durasi = data.durasi ? data.durasi.replace(/\s*hari/i, '').trim() : '';
        if (data.tgl && durasi) teks += `📅 ${durasi} Hari: ${s(data.tgl)}\n`;
        else if (data.tgl) teks += `📅 ${s(data.tgl)}\n`;

        // Kalimat pembuka
        teks += `${buildOpeningSentence(data)}\n\n`;

        // Fasilitas
        const fasilitas = [];
        if (data.maskapai) fasilitas.push(`✅ ${s(data.maskapai)}`);
        if (data.hotel_madinah) fasilitas.push(`✅ Hotel Madinah: ${s(data.hotel_madinah)}${data.makan_madinah ? ` (Makan ${s(data.makan_madinah)})` : ''}`);
        if (data.hotel_makkah) fasilitas.push(`✅ Hotel Makkah: ${s(data.hotel_makkah)}${data.makan_makkah ? ` (Makan ${s(data.makan_makkah)})` : ''}`);
        if (fasilitas.length) teks += `✈️ Fasilitas:\n${fasilitas.join('\n')}\n\n`;

        // Biaya
        const hargaLines = [];
        if (data.harga_quad) hargaLines.push(`* Quad: ${s(data.harga_quad)}`);
        if (data.harga_triple) hargaLines.push(`* Triple: ${s(data.harga_triple)}`);
        if (data.harga_double) hargaLines.push(`* Double: ${s(data.harga_double)}`);
        if (!hargaLines.length && data.harga_quint) hargaLines.push(`* Quad: ${s(data.harga_quint)}`);
        if (hargaLines.length) teks += `💰 Biaya Program:\n${hargaLines.join('\n')}\n\n`;

        // Termasuk
        const termasukList = data.termasuk
            ? data.termasuk.split('\n').map(i => i.trim()).filter(Boolean)
            : ['Tiket Pesawat PP', 'Visa Umroh', 'Fullboard Hotel', 'Perlengkapan Dasar', 'Handling Bandara', 'Asuransi', 'Zamzam 5L'];
        if (termasukList.length) teks += `✅ Termasuk:\n${termasukList.map(i => '- ' + s(i)).join('\n')}\n\n`;

        // Tidak termasuk
        const tidakList = data.tidak_termasuk
            ? data.tidak_termasuk.split('\n').map(i => i.trim()).filter(Boolean)
            : ['Paspor', 'Vaksin', 'Tiket Domestik', 'Hotel Transit', 'Pengeluaran pribadi'];
        if (tidakList.length) teks += `❌ Tidak Termasuk:\n${tidakList.map(i => '- ' + s(i)).join('\n')}\n\n`;

        // Footer
        teks += `📞 Info & Itinerary:\nwa.me/6285122336300\nwa.me/6285196241819`;

        return teks;
    }

    // Dipanggil dari tombol "Refresh Teks WA" di form — instan, tanpa panggilan jaringan
    function generateAIWAText() {
        const data = getAdminFormData();
        if (!data.nama) {
            alert('Isi dulu Nama Program sebelum generate teks WA.');
            return;
        }
        const status = document.getElementById('aiGenerateWaStatus');
        const textarea = document.getElementById('admin_teks_wa');
        if (!textarea) return;

        textarea.value = generateAutoWAText(data);
        if (status) { status.textContent = '✅ Teks berhasil dibuat dari data form, cek & sunting bila perlu.'; status.style.color = '#16a34a'; }
    }
    window.generateAIWAText = generateAIWAText;
    // ========== END GENERATE TEKS WA ==========


    function formatHargaJuta(hargaStr) {
        // Input: "Rp 28.950.000" atau "28950000" → output: "Rp28,95 jt"
        if (!hargaStr) return '';
        const num = parseInt(String(hargaStr).replace(/[^\d]/g, ''));
        if (!num) return hargaStr;
        const juta = num / 1000000;
        // Format: hilangkan desimal nol (30.5 jt, bukan 30.50 jt)
        const formatted = juta % 1 === 0 ? juta.toFixed(0) : juta.toFixed(2).replace(/\.?0+$/, '');
        return `Rp${formatted} jt`;
    }

    function escapeHtml(str) { if (!str) return ''; return str.replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[m]); }
    function showToast(msg) { const t = document.getElementById('toast'); t.innerHTML = '<i class="fas fa-check"></i> '; const span = document.createElement('span'); span.textContent = msg; t.appendChild(span); t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2500); }

    // ===== SKELETON LOADER =====
    function renderSkeleton(rows = 6) {
        const tbody = document.getElementById('skeletonBody');
        if (!tbody) return;
        tbody.innerHTML = Array.from({length: rows}, () => `
            <tr>
                <td><span class="sk sk-name"></span><span class="sk sk-badge"></span></td>
                <td><span class="sk sk-price"></span><span class="sk sk-price-sub"></span></td>
                <td><span class="sk sk-date"></span></td>
                <td><span class="sk sk-dur"></span></td>
                <td><span class="sk sk-airline"></span></td>
                <td><div class="sk-icons"><span class="sk sk-icon"></span><span class="sk sk-icon"></span><span class="sk sk-icon"></span></div></td>
                <td><span class="sk sk-status"></span></td>
            </tr>`).join('');
    }

    // Database dengan CACHE
    async function loadDataFromSupabase(forceRefresh = false) {
        const loadingEl = document.getElementById('loadingState'), tableEl = document.getElementById('packageTable');
        loadingEl.style.display = 'block'; tableEl.style.display = 'none';
        renderSkeleton();
        
        if (!forceRefresh) {
            const cached = sessionStorage.getItem(CACHE_KEY), cacheTime = sessionStorage.getItem(CACHE_TIME_KEY);
            if (cached && cacheTime && (Date.now() - parseInt(cacheTime) < CACHE_DURATION)) {
                dataUmroh = JSON.parse(cached);
                dataUmroh.forEach(p => { if (p.tgl && !p.dateObj) p.dateObj = parseDateFromString(p.tgl); p.isAvailable = p.dateObj >= new Date(); });
                currentData = dataUmroh.filter(p => p.is_active !== false && p.isAvailable).sort((a,b) => (a.dateObj||0) - (b.dateObj||0));
                renderTable(currentData); renderStats(); renderFeaturedSection();
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
            currentData = dataUmroh.filter(p => p.is_active !== false && p.isAvailable).sort((a,b) => (a.dateObj||0) - (b.dateObj||0));
            renderTable(currentData); renderStats(); renderFeaturedSection();
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
                        currentData = dataUmroh.filter(p => p.is_active !== false && p.isAvailable).sort((a,b) => (a.dateObj||0) - (b.dateObj||0));
                        renderTable(currentData); renderStats(); renderFeaturedSection();
                        loadingEl.style.display = 'none'; tableEl.style.display = 'table';
                        return;
                    }
                } catch (_) {}
            }
            loadingEl.innerHTML = `<div class="empty-state"><div class="empty-icon"><i class="fa-solid fa-triangle-exclamation"></i></div><p>Gagal memuat data: ${sanitizeHtml(msg)}</p><button class="btn-reset" onclick="location.reload()">Coba Lagi</button></div>`;
        }
    }

    // Broadcast ke tab lain (mis. halaman publik yang sudah terbuka duluan) bahwa data berubah,
    // supaya tab tersebut langsung buang cache & ambil data terbaru tanpa nunggu 60 detik.
    function broadcastDataDirty() { try { localStorage.setItem(DATA_DIRTY_KEY, Date.now().toString()); } catch (_) {} }

    async function insertProgram(programData) { const { data, error } = await supabaseClient.from('programs').insert([programData]).select(); if (error) throw error; sessionStorage.removeItem(CACHE_KEY); broadcastDataDirty(); return data[0]; }
    async function upsertProgram(programData) { const { data, error } = await supabaseClient.from('programs').upsert([programData], { onConflict: 'id' }).select(); if (error) throw error; sessionStorage.removeItem(CACHE_KEY); broadcastDataDirty(); return data[0]; }
    async function updateProgramById(id, programData) { const { data, error } = await supabaseClient.from('programs').update(programData).eq('id', id).select(); if (error) throw error; sessionStorage.removeItem(CACHE_KEY); broadcastDataDirty(); return data[0]; }
    async function deleteProgramById(id) { const { error } = await supabaseClient.from('programs').delete().eq('id', id); if (error) throw error; sessionStorage.removeItem(CACHE_KEY); broadcastDataDirty(); }

    // Tab lain (mis. halaman publik yang dibuka duluan di tab terpisah) mendengar perubahan ini
    // dan langsung refresh data — tanpa perlu reload manual atau nunggu cache expired.
    window.addEventListener('storage', (e) => {
        if (e.key === DATA_DIRTY_KEY && e.newValue) {
            sessionStorage.removeItem(CACHE_KEY);
            loadDataFromSupabase(true);
        }
    });

    // Render Functions
    function renderTable(data) {
        const tbody = document.getElementById('tableBody'); if (!tbody) return;
        const now = new Date();
        if (!data || !data.length) { tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon"><i class="fa-solid fa-inbox"></i></div><p>Belum ada program. Klik "Admin" untuk menambah.</p></div></td></tr>`; return; }
        tbody.innerHTML = '';
        data.forEach(item => {
            const isAvailable = item.dateObj >= now, statusClass = isAvailable ? "status-available" : "status-expired";
            const diffMs = item.dateObj - now;
            let cdText = "sudah berangkat", cdClass = "expired";
            if (diffMs >= 0) {
                const diffDays = Math.floor(diffMs / (1000*60*60*24));
                const years = Math.floor(diffDays/365), remDays = diffDays%365, months = Math.floor(remDays/30), days = remDays%30;
                const parts = []; if (years) parts.push(`${years}th`); if (months) parts.push(`${months}bl`); if (days) parts.push(`${days}hr`);
                if (!parts.length) parts.push("hari ini!");
                cdText = parts.join(" ") + (diffDays>0?" lagi":""); cdClass = diffDays<=30?"soon":diffDays<=90?"medium":"far";
            }
            const maskapaiLower = (item.maskapai||'').toLowerCase();
            let maskapaiDot = 'oman';
            if (maskapaiLower.includes('saudia')) maskapaiDot='saudia';
            else if (maskapaiLower.includes('lion')) maskapaiDot='lion';
            else if (maskapaiLower.includes('garuda')) maskapaiDot='garuda';
            else if (maskapaiLower.includes('emirates')) maskapaiDot='emirates';
            else if (maskapaiLower.includes('qatar')) maskapaiDot='qatar';
            else if (maskapaiLower.includes('etihad')) maskapaiDot='etihad';
            else if (maskapaiLower.includes('malindo')) maskapaiDot='malindo';
            else if (maskapaiLower.includes('air asia') || maskapaiLower.includes('airasia')) maskapaiDot='airasia';
            const row = document.createElement('tr');
            if (diffMs >= 0 && Math.floor(diffMs / (1000*60*60*24)) <= 30) row.classList.add('row-urgent');
            row.innerHTML = `<td><span class="package-name${item.link_poster?' has-poster':''}" onclick="openDetailModal('${item.id}')"${item.link_poster?` data-poster="${escapeHtml(item.link_poster)}" data-nama="${escapeHtml(item.nama||'')}" onmouseenter="showPosterPopup(event,this)" onmouseleave="hidePosterPopup()"`:''} title="${item.link_poster?'Hover untuk preview poster — ':''}${escapeHtml(item.nama||'')}">${escapeHtml(item.nama||'')}</span><span class="countdown ${cdClass}"><i class="fa-solid fa-clock"></i> ${escapeHtml(cdText)}</span>${(diffMs >= 0 && Math.floor(diffMs/(1000*60*60*24))<=30)?'<span class="urgent-badge"><i class="fa-solid fa-bolt"></i> Segera!</span>':''}</td>
                <td class="col-harga">${item.harga_quint?`<span class="price-main">${escapeHtml(item.harga_quint)}</span>`:'<span style="color:var(--text-3);">—</span>'}</td>
                <td class="date-cell">${escapeHtml(item.tgl||'')}</td>
                <td class="col-durasi"><span class="badge">⏱ ${escapeHtml(item.durasi||'')}</span></td>
                <td class="col-maskapai"><div class="maskapai-cell"><span class="maskapai-dot ${maskapaiDot}"></span>${escapeHtml(item.maskapai||'')}</div></td>
                <td><div class="actions-cell">${item.link_itinerary?`<a href="${escapeHtml(item.link_itinerary)}" target="_blank" class="btn-icon" data-tip="Itinerary"><i class="fa-solid fa-file-lines"></i></a>`:'<span class="btn-icon disabled"><i class="fa-solid fa-file-lines"></i></span>'}${item.link_poster?`<a href="${escapeHtml(item.link_poster)}" target="_blank" class="btn-icon" data-tip="Poster"><i class="fa-solid fa-image"></i></a>`:'<span class="btn-icon disabled"><i class="fa-solid fa-image"></i></span>'}${item.link_metaads?`<a href="${escapeHtml(item.link_metaads)}" target="_blank" class="btn-icon" data-tip="Meta Ads"><i class="fa-solid fa-link"></i></a>`:'<span class="btn-icon disabled"><i class="fa-solid fa-link"></i></span>'}${item.link_dokumentasi?`<a href="${escapeHtml(item.link_dokumentasi)}" target="_blank" class="btn-icon" data-tip="Dokumentasi"><i class="fa-solid fa-folder-open"></i></a>`:'<span class="btn-icon disabled"><i class="fa-solid fa-folder-open"></i></span>'}</div></td>
                <td><span class="status-pill ${statusClass}">${isAvailable?"Tersedia":"Expired"}</span></td>`;
            tbody.appendChild(row);
        });
    }

    function renderStats() { const now = new Date(); const visible = dataUmroh.filter(p=>p.is_active!==false); const total = visible.length, active = visible.filter(i=>i.dateObj>=now).length, past = total-active; document.getElementById('statsRow') && (document.getElementById('statsRow').innerHTML = `<span class="stat-chip total"><i class="fa-solid fa-layer-group"></i> ${total} Paket</span><span class="stat-chip active"><i class="fa-solid fa-circle-check"></i> ${active} Tersedia</span><span class="stat-chip inactive"><i class="fa-solid fa-clock-rotate-left"></i> ${past} Expired</span>`); }

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
        const t = term.toLowerCase().trim();
        const visiblePrograms = dataUmroh.filter(p => p.is_active !== false && p.isAvailable);
        if (!t) { currentData = [...visiblePrograms].sort((a,b) => (a.dateObj||0) - (b.dateObj||0)); }
        else {
            currentData = visiblePrograms.filter(item => {
                // Pecah kata kunci: semua kata harus match di field manapun
                const keywords = t.split(/\s+/).filter(Boolean);
                const haystack = [
                    item.nama || '',
                    item.maskapai || '',
                    item.tgl || '',
                    item.durasi || '',
                    item.harga_quint || '',
                    item.teks_wa || ''
                ].join(' ').toLowerCase();
                return keywords.every(kw => haystack.includes(kw));
            });
        }
        if (currentSort.column) sortTable(currentSort.column);
        else renderTable(currentData);
    }

    function resetSearch() { document.getElementById('searchInput').value = ''; document.getElementById('searchInputMobile').value = ''; currentData = dataUmroh.filter(p => p.is_active !== false && p.isAvailable).sort((a,b) => (a.dateObj||0) - (b.dateObj||0)); renderTable(currentData); }

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
            <div class="detail-actions">${program.link_itinerary?`<a href="${escapeHtml(program.link_itinerary)}" target="_blank" class="btn btn-link"><i class="fas fa-map"></i> Itinerary</a>`:''}${program.link_poster?`<a href="${escapeHtml(program.link_poster)}" target="_blank" class="btn btn-link"><i class="fas fa-image"></i> Poster</a>`:''}${program.link_metaads?`<a href="${escapeHtml(program.link_metaads)}" target="_blank" class="btn btn-link"><i class="fas fa-chart-line"></i> Meta Ads</a>`:''}${program.link_dokumentasi?`<a href="${escapeHtml(program.link_dokumentasi)}" target="_blank" class="btn btn-link"><i class="fas fa-folder"></i> Dokumentasi</a>`:''}</div>`;
        window.currentDetailWAText = waText;
        const detailModalEl = document.getElementById('detailModal');
        detailModalEl.style.display = '';
        detailModalEl.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
    function closeDetailModal() { document.getElementById('detailModal').classList.remove('show'); document.body.style.overflow = ''; }
    function copyDetailWAText() { const text = window.currentDetailWAText; if (!text) return; navigator.clipboard.writeText(text).then(()=>showToast('Teks berhasil disalin!')).catch(()=>{const ta=document.createElement('textarea');ta.value=text;ta.style.cssText='position:fixed;opacity:0';document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);showToast('Teks berhasil disalin!');}); }

    // Admin Panel (dengan cache refresh)
    function openAdminModal() { 
        checkSession();
        const adminModalEl = document.getElementById('adminModal');
        adminModalEl.style.display = '';
        adminModalEl.classList.add('show'); 
        const pubWrapper = document.getElementById('pubTabsWrapper');
        if (pubWrapper) pubWrapper.style.display = 'none';
        renderAdminPanel(); 
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    function closeAdminModal() { 
        document.getElementById('adminModal').classList.remove('show'); 
        const pubWrapper = document.getElementById('pubTabsWrapper');
        if (pubWrapper) pubWrapper.style.display = '';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    function renderMaskapaiOptions(selected='') { let opts='<option value="">-- Pilih Maskapai --</option>'; MASKAPAI_LIST.forEach(m=>opts+=`<option value="${escapeHtml(m)}" ${selected===m?'selected':''}>${escapeHtml(m)}</option>`); return opts; }
    
    async function renderAdminPanel() {
        const container = document.getElementById('adminModalBody');
        if (adminLoggedIn) {
            const isAdmin = currentRole === 'administrator';

            // Tampilkan role badge & tombol logout di header modal
            const roleBadge = document.getElementById('adminRoleBadge');
            if (roleBadge) {
                roleBadge.style.display = 'inline';
                roleBadge.textContent = isAdmin ? 'Administrator' : 'CS';
            }
            const headerLogoutBtn = document.getElementById('adminHeaderLogoutBtn');
            if (headerLogoutBtn) headerLogoutBtn.style.display = 'flex';

            const { data } = await supabaseClient.from('programs').select('*').order('created_at');
            adminPrograms = data || [];
            const featuredCount = getActiveFeaturedCount();
            const jadwalCount = jadwalList.length;
            const programCount = adminPrograms.length;

            const lockIcon = `<i class="fas fa-lock" style="font-size:10px;opacity:.55;margin-left:2px;" title="Hanya Administrator"></i>`;

            container.innerHTML = `
            <!-- TOOLBAR -->
            ${isAdmin ? '' : `
            <div class="admin-toolbar" style="background:#faf5ff;border-color:#c4b5fd;align-items:center;">
                <span style="font-size:13px;font-weight:600;color:#5b21b6;"><i class="fas fa-headset"></i> Login sebagai CS &mdash; hanya dapat mengelola Jadwal Tamu</span>
            </div>`}

            <!-- FORM TAMBAH/EDIT (hanya administrator) -->
            ${isAdmin ? `
            <div id="adminFormContainer" style="display:none;" class="admin-form">
                <div class="admin-form-header">
                    <span><i class="fas fa-edit"></i> <span id="adminFormTitle">Tambah Program Baru</span></span>
                    <button class="admin-btn" onclick="hideAdminForm()">&times;</button>
                </div>
                <!-- PARSE DARI TEKS -->
                <div id="parseBroadcastBox" style="padding:16px 20px;background:#f0fdf4;border-bottom:1px solid #bbf7d0;">
                    <div style="font-size:12px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;display:flex;align-items:center;gap:6px;"><i class="fas fa-magic"></i> Auto-isi dari Teks Broadcast</div>
                    <textarea id="parseBroadcastInput" rows="4" placeholder="Paste teks broadcast program umroh di sini, lalu klik Isi Otomatis..." style="width:100%;padding:8px 12px;border:1px solid #86efac;border-radius:6px;font-size:12.5px;resize:vertical;font-family:inherit;background:#fff;outline:none;line-height:1.6;"></textarea>
                    <div style="display:flex;gap:8px;margin-top:8px;align-items:center;">
                        <button onclick="parseBroadcastText()" style="background:#16a34a;color:#fff;border:none;padding:7px 16px;border-radius:6px;font-size:12.5px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;"><i class="fas fa-wand-magic-sparkles"></i> Isi Otomatis</button>
                        <button onclick="document.getElementById('parseBroadcastInput').value=''" style="background:transparent;color:#16a34a;border:1px solid #86efac;padding:7px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">Hapus</button>
                        <span id="parseStatus" style="font-size:12px;color:#15803d;font-weight:600;display:none;"></span>
                    </div>
                </div>
                <div class="admin-form-body">
                    <div class="admin-form-group admin-full-width"><label>Nama Program *</label><input type="text" id="admin_nama" placeholder="Contoh: Umroh Akbar Bareng UAS" maxlength="200"></div>
                    <div class="admin-form-group"><label>Tanggal</label><input type="date" id="admin_tgl_date"><input type="hidden" id="admin_tgl"><small style="color:#64748b">Pilih tanggal dari kalender</small></div>
                    <div class="admin-form-group"><label>Durasi</label><input type="text" id="admin_durasi" placeholder="9 Hari" maxlength="50"></div>
                    <div class="admin-form-group"><label>Maskapai</label><select id="admin_maskapai">${renderMaskapaiOptions()}</select></div>
                    <div class="admin-form-group"><label>Harga</label><input type="text" id="admin_harga_quint" placeholder="Rp 32.500.000" maxlength="50"></div>
                    <div class="admin-form-group"><label>Link Itinerary</label><input type="url" id="admin_link_itinerary" placeholder="https://..."></div>
                    <div class="admin-form-group"><label>Link Poster</label><input type="url" id="admin_link_poster" placeholder="https://..."></div>
                    <div class="admin-form-group"><label>Link Meta Ads</label><input type="url" id="admin_link_metaads" placeholder="https://..."></div>
                    <div class="admin-form-group"><label>Link Dokumentasi</label><input type="url" id="admin_link_dokumentasi" placeholder="https://..."></div>
                    <div class="admin-form-group admin-full-width">
                        <label>Teks WA</label>
                        <div id="aiGenerateWaStatus" style="font-size:11.5px;color:#64748b;margin-bottom:4px;min-height:14px;"></div>
                        <textarea id="admin_teks_wa" rows="4" placeholder="Kosongkan untuk generate otomatis, atau isi field lain lalu klik 'Refresh Teks WA' di bawah" maxlength="5000"></textarea>
                    </div>
                </div>
                <!-- ADMIN-ONLY: Data Lengkap untuk Crosscheck -->
                <div style="padding:0 20px;margin-bottom:4px;">
                    <div style="font-size:11px;font-weight:800;color:#7c3aed;text-transform:uppercase;letter-spacing:.5px;display:flex;align-items:center;gap:6px;padding:10px 0 8px;border-top:1px dashed #c4b5fd;margin-top:4px;">
                        <i class="fas fa-lock" style="font-size:10px;"></i> Data Lengkap Admin (untuk Crosscheck — tidak tampil di publik)
                    </div>
                </div>
                <div class="admin-form-body" style="background:#faf5ff;border-top:1px solid #ede9fe;padding-top:16px;">
                    <div class="admin-form-group"><label style="color:#7c3aed;">Harga Quad</label><input type="text" id="admin_harga_quad" placeholder="Rp 35.000.000" maxlength="50"></div>
                    <div class="admin-form-group"><label style="color:#7c3aed;">Harga Triple</label><input type="text" id="admin_harga_triple" placeholder="Rp 37.500.000" maxlength="50"></div>
                    <div class="admin-form-group"><label style="color:#7c3aed;">Harga Double</label><input type="text" id="admin_harga_double" placeholder="Rp 42.000.000" maxlength="50"></div>
                    <div class="admin-form-group"><label style="color:#7c3aed;">Hotel Makkah</label><input type="text" id="admin_hotel_makkah" placeholder="Nama hotel & bintang" maxlength="100"></div>
                    <div class="admin-form-group"><label style="color:#7c3aed;">Hotel Madinah</label><input type="text" id="admin_hotel_madinah" placeholder="Nama hotel & bintang" maxlength="100"></div>
                    <div class="admin-form-group"><label style="color:#7c3aed;">Makan Makkah</label><input type="text" id="admin_makan_makkah" placeholder="3x Sehari / 2x Sehari" maxlength="80"></div>
                    <div class="admin-form-group"><label style="color:#7c3aed;">Makan Madinah</label><input type="text" id="admin_makan_madinah" placeholder="3x Sehari / 2x Sehari" maxlength="80"></div>
                    <div class="admin-form-group admin-full-width"><label style="color:#7c3aed;">Fasilitas / Termasuk</label><textarea id="admin_termasuk" rows="4" placeholder="Tiket pesawat PP&#10;Visa umroh&#10;Hotel bintang 4&#10;Muthawwif berpengalaman" maxlength="2000" style="background:#fff;"></textarea></div>
                    <div class="admin-form-group admin-full-width"><label style="color:#7c3aed;">Tidak Termasuk</label><textarea id="admin_tidak_termasuk" rows="3" placeholder="Airport tax&#10;Biaya pengurusan paspor&#10;Pengeluaran pribadi" maxlength="1000" style="background:#fff;"></textarea></div>
                    <div class="admin-form-group admin-full-width"><label style="color:#7c3aed;">Catatan Tambahan Admin</label><textarea id="admin_catatan_cx" rows="2" placeholder="Catatan internal untuk crosscheck..." maxlength="500" style="background:#fff;"></textarea></div>
                </div>
                <div class="form-actions">
                    <button class="admin-btn admin-btn-primary" onclick="saveAdminProgram()"><i class="fas fa-save"></i> Simpan</button>
                    <button class="admin-btn" id="aiGenerateWaBtn" onclick="generateAIWAText()"><i class="fas fa-rotate"></i> <span id="aiGenerateWaBtnText">Refresh Teks WA</span></button>
                    <button class="admin-btn" onclick="hideAdminForm()">Batal</button>
                </div>
            </div>` : ''}

            <!-- TABS -->
            <div class="admin-tabs-bar">
                <button class="admin-tab-btn ${isAdmin ? 'active' : ''}" style="${!isAdmin ? 'opacity:.5;cursor:not-allowed;' : ''}" onclick="${isAdmin ? "switchAdminTab('umroh',this)" : 'showCsLockWarning()'}">
                    <i class="fas fa-kaaba"></i> Program Umroh ${!isAdmin ? lockIcon : ''}
                    <span class="tab-count" id="tabCountUmroh">${programCount}</span>
                </button>
                <button class="admin-tab-btn tab-star" style="${!isAdmin ? 'opacity:.5;cursor:not-allowed;' : ''}" onclick="${isAdmin ? "switchAdminTab('unggulan',this)" : 'showCsLockWarning()'}">
                    <i class="fas fa-star"></i> Program Unggulan ${!isAdmin ? lockIcon : ''}
                    <span class="tab-count" id="tabCountUnggulan">${featuredCount}/3</span>
                </button>
                <button class="admin-tab-btn tab-jadwal ${isAdmin ? '' : 'active'}" onclick="switchAdminTab('jadwal',this)">
                    <i class="fas fa-calendar-check"></i> Jadwal Tamu
                    <span class="tab-count" id="tabCountJadwal">${jadwalCount}</span>
                </button>
                <button class="admin-tab-btn tab-keberangkatan" onclick="switchAdminTab('keberangkatan',this)">
                    <i class="fas fa-plane-departure"></i> Keberangkatan
                    <span class="tab-count" id="tabCountKeberangkatan">${kbJamaahList.length}</span>
                </button>
                <button class="admin-tab-btn tab-keberangkatan" onclick="switchAdminTab('database-jamaah',this)">
                    <i class="fa-solid fa-database"></i> Database Jamaah
                    <span class="tab-count" id="tabCountDbJamaah">${kbJamaahList.length}</span>
                </button>
                ${isAdmin ? `
                <button class="admin-tab-btn tab-crosscheck" onclick="switchAdminTab('crosscheck',this)">
                    <i class="fas fa-magnifying-glass-chart"></i> Crosscheck
                    <span class="tab-count" id="tabCountCrosscheck">0</span>
                </button>` : ''}
                ${isAdmin ? `
                <button class="admin-tab-btn tab-telegram" onclick="switchAdminTab('telegram',this)">
                    <i class="fab fa-telegram"></i> Telegram
                </button>` : ''}
            </div>

            <!-- TAB: PROGRAM UMROH -->
            <div class="admin-tab-panel ${isAdmin ? 'active' : ''}" id="tab-umroh">
                ${!isAdmin ? `<div style="text-align:center;padding:40px 20px;"><i class="fas fa-lock" style="font-size:36px;color:#c4b5fd;display:block;margin-bottom:12px;"></i><p style="font-weight:700;color:#5b21b6;font-size:14px;">Akses Terbatas</p><p style="color:#94a3b8;font-size:13px;">Hanya <strong>Administrator</strong> yang dapat mengelola Program Umroh.</p></div>` : `
                <div class="admin-panel-section-header umroh">
                    <i class="fas fa-mosque" style="color:var(--primary);"></i>
                    <div><div class="sec-title" style="color:var(--primary);">Daftar Program Umroh</div><div class="sec-sub">Kelola semua paket umroh yang tersedia</div></div>
                    <div class="sec-actions">
                        <button class="admin-btn admin-btn-primary" onclick="showAdminForm(); document.getElementById('adminFormContainer').scrollIntoView({behavior:'smooth'})">
                            <i class="fas fa-plus"></i> Tambah
                        </button>
                    </div>
                </div>
                <div class="admin-table">
                    <table>
                        <thead><tr>
                            <th class="sortable-header" onclick="sortAdminTable('nama')">Nama Program <i class="fas fa-sort"></i></th>
                            <th class="sortable-header" onclick="sortAdminTable('harga_quint')">Harga <i class="fas fa-sort"></i></th>
                            <th class="sortable-header" onclick="sortAdminTable('tgl')">Tanggal <i class="fas fa-sort"></i></th>
                            <th style="text-align:right;">Aksi</th>
                        </tr></thead>
                        <tbody id="adminTableBody"></tbody>
                    </table>
                </div>
                <div class="admin-toolbar" style="margin-top:12px;margin-bottom:0;">
                    <button class="admin-btn" onclick="exportAdminData()"><i class="fas fa-download"></i> Export</button>
                    <button class="admin-btn" onclick="importAdminData()"><i class="fas fa-upload"></i> Import</button>
                    <button class="admin-btn admin-btn-danger" onclick="clearAllAdminData()" style="margin-left:auto;"><i class="fas fa-trash"></i> Hapus Semua</button>
                </div>`}
            </div>

            <!-- TAB: PROGRAM UNGGULAN -->
            <div class="admin-tab-panel" id="tab-unggulan">
                ${!isAdmin ? `<div style="text-align:center;padding:40px 20px;"><i class="fas fa-lock" style="font-size:36px;color:#c4b5fd;display:block;margin-bottom:12px;"></i><p style="font-weight:700;color:#5b21b6;font-size:14px;">Akses Terbatas</p><p style="color:#94a3b8;font-size:13px;">Hanya <strong>Administrator</strong> yang dapat mengelola Program Unggulan.</p></div>` : `
                <div class="admin-panel-section-header unggulan">
                    <i class="fas fa-star" style="color:#d97706;"></i>
                    <div><div class="sec-title" style="color:#92400e;">Program Unggulan</div><div class="sec-sub">Tampil di beranda antara running text dan tabel program</div></div>
                    <div class="sec-actions"><span id="featuredCounter" style="background:#f59e0b;color:#fff;font-size:11px;font-weight:800;padding:4px 12px;border-radius:20px;">${featuredCount}/3</span></div>
                </div>
                <div class="admin-table">
                    <table>
                        <thead><tr><th>Nama Program</th><th>Tanggal</th><th>Status Unggulan</th></tr></thead>
                        <tbody id="featuredAdminTableBody"></tbody>
                    </table>
                </div>`}
            </div>

            <!-- TAB: JADWAL TAMU -->
            <div class="admin-tab-panel ${isAdmin ? '' : 'active'}" id="tab-jadwal">
                <div class="admin-panel-section-header jadwal">
                    <i class="fas fa-calendar-check" style="color:#7c3aed;"></i>
                    <div><div class="sec-title" style="color:#5b21b6;">Jadwal Berkunjung Tamu</div><div class="sec-sub">Rekap tamu yang akan mengunjungi kantor</div></div>
                    <div class="sec-actions">
                        <button class="jadwal-admin-btn" style="padding:7px 14px;font-size:12px;" onclick="openJadwalModal()">
                            <i class="fas fa-plus"></i> Tambah Jadwal
                        </button>
                    </div>
                </div>
                <div class="admin-table">
                    <table>
                        <thead><tr>
                            <th>Nama Tamu</th>
                            <th>Tanggal Kunjungan</th>
                            <th>Jumlah</th>
                            <th>Keperluan</th>
                            <th>Status</th>
                            <th style="text-align:right;">Aksi</th>
                        </tr></thead>
                        <tbody id="jadwalAdminTableBody"></tbody>
                    </table>
                </div>
            </div>

            <!-- TAB: KEBERANGKATAN -->
            <div class="admin-tab-panel" id="tab-keberangkatan">
                <div class="admin-panel-section-header keberangkatan">
                    <i class="fas fa-plane-departure" style="color:#0369a1;"></i>
                    <div><div class="sec-title" style="color:#1e3a5f;">Data Jamaah Keberangkatan</div><div class="sec-sub">Kelola daftar jamaah per program umroh</div></div>
                    <div class="sec-actions">
                        <button class="kb-add-btn" onclick="openKbModal()"><i class="fa-solid fa-user-plus"></i> Tambah Jamaah</button>
                    </div>
                </div>
                <div id="kbAdminFilterWrap" style="margin-bottom:14px;">
                    <div style="font-size:12px;font-weight:700;color:var(--text-2);margin-bottom:8px;text-transform:uppercase;letter-spacing:.4px;">Filter Program:</div>
                    <div class="kb-program-selector" id="kbAdminProgramSelector"></div>
                </div>
                <div id="kbAdminJamaahContent">
                    <div class="kb-no-program"><i class="fa-solid fa-plane-departure"></i><p>Pilih program di atas untuk melihat data jamaah.</p></div>
                </div>
            </div>

            <!-- TAB: DATABASE JAMAAH (semua jamaah, lintas program) -->
            <div class="admin-tab-panel" id="tab-database-jamaah"></div>

            <!-- TAB: TELEGRAM SETTINGS -->
            ${isAdmin ? `
            <div class="admin-tab-panel" id="tab-crosscheck">
                <div class="admin-panel-section-header crosscheck">
                    <i class="fas fa-magnifying-glass-chart" style="color:#7c3aed;font-size:16px;"></i>
                    <div>
                        <div class="sec-title" style="color:#5b21b6;">Crosscheck Data Program</div>
                        <div class="sec-sub">Poster dibaca otomatis (OCR) & dibandingkan dengan teks plain saat program disimpan</div>
                    </div>
                </div>
                <!-- Pilih program -->
                <div style="font-size:11.5px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px;">Pilih Program:</div>
                <div class="cx-program-selector" id="cxProgramSelector"></div>
                <div id="cxPanelContent">
                    <div class="cx-empty"><i class="fa-solid fa-magnifying-glass-chart"></i><p>Pilih program di atas untuk melihat data crosscheck.</p></div>
                </div>
            </div>` : ''}

            <!-- TAB: TELEGRAM SETTINGS -->
            ${isAdmin ? `
            <div class="admin-tab-panel" id="tab-telegram">
                <div class="admin-panel-section-header telegram">
                    <i class="fab fa-telegram" style="color:#0088cc;font-size:18px;"></i>
                    <div>
                        <div class="sec-title" style="color:#0088cc;">Notifikasi Telegram</div>
                        <div class="sec-sub">Kirim notifikasi otomatis ke grup/chat Telegram</div>
                    </div>
                </div>
                <div class="tg-info-box">
                    <b>📌 Cara Setup:</b><br>
                    1. Buat bot via <b>@BotFather</b> di Telegram → dapatkan <b>Bot Token</b><br>
                    2. Tambahkan bot ke grup/chat yang diinginkan, jadikan <b>Admin</b><br>
                    3. Dapatkan <b>Chat ID</b> via <code>@userinfobot</code> atau <code>https://api.telegram.org/bot[TOKEN]/getUpdates</code><br>
                    4. Buat <b>Edge Function</b> di Supabase bernama <code>send-telegram</code> → isi URL-nya di bawah<br>
                    5. Simpan konfigurasi → notifikasi otomatis aktif!
                </div>
                <div class="tg-settings-grid">
                    <div>
                        <div style="font-size:12px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px;">Bot Token</div>
                        <input type="text" id="tg_bot_token" placeholder="1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ"
                            style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:monospace;">
                        <small style="color:var(--text-3);font-size:11px;">Dari @BotFather</small>
                    </div>
                    <div>
                        <div style="font-size:12px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px;">Edge Function URL</div>
                        <input type="url" id="tg_edge_url" placeholder="https://xxx.supabase.co/functions/v1/send-telegram"
                            style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:monospace;">
                        <small style="color:var(--text-3);font-size:11px;">URL Edge Function Supabase</small>
                    </div>
                </div>
                <div style="font-size:12px;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px;">Penerima Notifikasi</div>
                <div style="font-size:11.5px;color:var(--text-3);margin-bottom:10px;">Centang jenis notifikasi yang diterima tiap penerima. <b>Pengingat 1 bulan</b> dikirim otomatis saat halaman dibuka.</div>
                <div class="tg-recipients-list" id="tgRecipientsList"></div>
                <button class="tg-add-btn" onclick="addTgRecipient()"><i class="fas fa-plus"></i> Tambah Penerima</button>
                <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap;">
                    <button class="tg-save-btn" onclick="saveTgConfig()"><i class="fas fa-save"></i> Simpan Konfigurasi</button>
                    <button class="tg-test-btn" onclick="testTgNotif()"><i class="fas fa-paper-plane"></i> Test Kirim</button>
                </div>
                <div id="tgStatusMsg" style="margin-top:12px;"></div>
                <div class="tg-notif-log" id="tgNotifLog" style="display:none;">
                    <p style="color:#475569;font-size:11px;margin-bottom:6px;">▶ LOG PENGIRIMAN TELEGRAM:</p>
                </div>
            </div>` : ''}
`;

            if (isAdmin) {
                const dateInput = document.getElementById('admin_tgl_date');
                if(dateInput) dateInput.addEventListener('change',function(){
                    if(this.value){const [y,m,d]=this.value.split('-');document.getElementById('admin_tgl').value=formatDateToIndonesian(new Date(parseInt(y),parseInt(m)-1,parseInt(d)));}
                    else document.getElementById('admin_tgl').value='';
                });
                renderAdminTable();
            }
            renderJadwalAdminTable();
        } else {
            const roleBadge = document.getElementById('adminRoleBadge');
            if (roleBadge) roleBadge.style.display = 'none';
            const headerLogoutBtn = document.getElementById('adminHeaderLogoutBtn');
            if (headerLogoutBtn) headerLogoutBtn.style.display = 'none';
            container.innerHTML = `<div class="admin-login-box">
                <div class="icon"><i class="fas fa-shield-alt"></i></div>
                <h3>Admin Panel</h3>
                <p style="color:#64748b;font-size:13px;margin-bottom:2px;">Masukkan password untuk masuk</p>
                <p style="color:#94a3b8;font-size:11.5px;">Administrator: akses penuh &nbsp;|&nbsp; CS: kelola jadwal tamu</p>
                <input type="password" id="adminPasswordInput" placeholder="Password" autofocus onkeydown="if(event.key==='Enter')checkAdminLogin()">
                <button onclick="checkAdminLogin()"><i class="fas fa-sign-in-alt"></i> Masuk</button>
                <div id="adminLoginError" style="color:red;font-size:12px;margin-top:16px;"></div>
            </div>`;
            setTimeout(()=>{const pwd=document.getElementById('adminPasswordInput');pwd&&pwd.focus();},100);
        }
    }

    function switchAdminTab(name, btn) {
        document.querySelectorAll('.admin-tab-panel').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
        const panel = document.getElementById('tab-' + name);
        if (panel) panel.classList.add('active');
        if (btn) btn.classList.add('active');
        if (name === 'keberangkatan') {
            // Pastikan data sudah loaded sebelum render selector
            if (kbJamaahList.length > 0 || dataUmroh.length > 0) {
                renderKbAdminSelector();
            } else {
                loadKbJamaah().then(() => renderKbAdminSelector());
            }
        }
        if (name === 'database-jamaah') {
            if (kbJamaahList.length > 0 || dataUmroh.length > 0) {
                renderDbJamaahPanel();
            } else {
                loadKbJamaah().then(() => renderDbJamaahPanel());
            }
        }
        if (name === 'crosscheck') {
            renderCxProgramSelector();
            if (cxSelectedProgram) renderCxPanel(cxSelectedProgram);
        }
        if (name === 'telegram') {
            renderTgRecipients();
        }
    }
    window.switchAdminTab = switchAdminTab;

    function renderKbAdminSelector(selectedId) {
        const sel = document.getElementById('kbAdminProgramSelector');
        if (!sel) return;
        if (!dataUmroh || dataUmroh.length === 0) {
            sel.innerHTML = '<div style="font-size:13px;color:var(--text-3);font-style:italic;">Belum ada data program.</div>';
            return;
        }
        const activeId = selectedId || kbSelectedAdminProgram || null;
        // Admin: tampilkan SEMUA program (supaya bisa input ke program manapun)
        // tapi bedakan yang sudah ada jamaahnya vs belum
        const programs = dataUmroh.slice().sort((a,b) => (a.dateObj||0) - (b.dateObj||0));
        const programsWithJamaah = programs.filter(p => kbJamaahList.some(j => String(j.program_id) === String(p.id)));
        // Tampilkan hanya yang sudah ada jamaahnya di selector; kalau kosong, tampilkan info
        if (programsWithJamaah.length === 0) {
            sel.innerHTML = '<div style="font-size:13px;color:var(--text-3);font-style:italic;">Belum ada data jamaah. Klik Tambah Jamaah untuk mulai input.</div>';
            const content = document.getElementById('kbAdminJamaahContent');
            if (content) content.innerHTML = `<div class="kb-no-program"><i class="fa-solid fa-plane-departure"></i><p>Belum ada data jamaah. Klik tombol Tambah Jamaah di atas.</p></div>`;
            return;
        }
        // Reset activeId jika programnya sudah tidak ada di list
        const resolvedId = (activeId && programsWithJamaah.find(p => String(p.id) === String(activeId))) ? activeId : null;
        if (resolvedId !== kbSelectedAdminProgram) kbSelectedAdminProgram = resolvedId;
        sel.innerHTML = programsWithJamaah.map(p => {
            const count = kbJamaahList.filter(j => String(j.program_id) === String(p.id)).length;
            const isActive = String(resolvedId) === String(p.id);
            return `<button class="kb-program-pill${isActive?' active':''}" onclick="selectKbAdminProgram('${escapeHtml(String(p.id))}')">
                ${escapeHtml(p.nama||'Program')}
                <span class="pill-count">${count}</span>
            </button>`;
        }).join('');
        renderKbAdminContent(resolvedId);
    }

    let kbSelectedAdminProgram = null;
    function selectKbAdminProgram(id) {
        kbSelectedAdminProgram = id;
        renderKbAdminSelector(id);
    }

    function renderKbAdminContent(progId) {
        const content = document.getElementById('kbAdminJamaahContent');
        if (!content) return;
        if (!progId) {
            content.innerHTML = `<div class="kb-no-program"><i class="fa-solid fa-plane-departure"></i><p>Pilih program di atas untuk melihat data jamaah.</p></div>`;
            return;
        }
        const prog = dataUmroh.find(p => String(p.id) === String(progId));
        if (!prog) return;
        const jamaah = kbJamaahList.filter(j => String(j.program_id) === String(progId));
        const totalLunas = jamaah.filter(j => j.status === 'lunas').length;
        const totalDp = jamaah.filter(j => j.status === 'dp').length;
        let tableRows = '';
        if (jamaah.length === 0) {
            tableRows = `<tr><td colspan="7"><div class="kb-empty"><i class="fa-solid fa-users"></i><p>Belum ada data jamaah untuk program ini.</p></div></td></tr>`;
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
                    <td><div class="admin-action-btns">
                        <button onclick="kbEditFromAdmin=true;openKbModal('${j.id}');" style="background:#ede9fe;color:#7c3aed;"><i class="fas fa-edit"></i> Edit</button>
                        <button onclick="openKuitansiModal('${j.id}')" style="background:#e0f2fe;color:#0369a1;"><i class="fa-solid fa-receipt"></i></button>
                        ${j.wa ? `<button onclick="kbHubungi('${escapeHtml(j.wa)}','${escapeHtml(j.nama||'')}')" style="background:#dcfce7;color:#16a34a;"><i class="fab fa-whatsapp"></i></button>` : ''}
                        <button onclick="deleteKbJamaahAdmin('${j.id}')" style="background:#fee2e2;color:#dc2626;"><i class="fas fa-trash"></i></button>
                    </div></td>
                </tr>`;
            }).join('');
        }
        const tglDisplay = prog.tgl ? prog.tgl : '-';
        content.innerHTML = `
        <div class="kb-section-header">
            <div class="kb-section-title">
                <i class="fa-solid fa-plane-departure"></i>
                <div>
                    <div class="kb-prog-name">${escapeHtml(prog.nama||'Program')}</div>
                    <div class="kb-prog-date"><i class="fa-solid fa-calendar" style="margin-right:4px;"></i>${tglDisplay} &nbsp;·&nbsp; ${escapeHtml(prog.maskapai||'-')}</div>
                </div>
            </div>
            <div class="kb-section-meta">
                <span class="kb-chip total"><i class="fa-solid fa-users" style="margin-right:4px;"></i>${jamaah.length} Jamaah</span>
                <span class="kb-chip lunas">${totalLunas} Lunas</span>
                ${totalDp>0?`<span class="kb-chip dp">${totalDp} DP</span>`:''}
                <button class="kb-chip archive" onclick="openKwtArsipModal()"><i class="fa-solid fa-box-archive"></i> Arsip Kuitansi</button>
            </div>
        </div>
        <div class="kb-jamaah-table-wrap">
            <table class="kb-jamaah-table">
                <thead><tr><th>#</th><th>Nama Jamaah</th><th>No. Paspor</th><th>Asal Daerah</th><th>WhatsApp</th><th>Status Bayar</th><th style="text-align:right;">Aksi</th></tr></thead>
                <tbody>${tableRows}</tbody>
            </table>
        </div>`;
        const badge = document.getElementById('tabCountKeberangkatan');
        if (badge) badge.textContent = kbJamaahList.length;
    }

    let kbEditFromAdmin = false;
    window.__kbEditFromAdminProxy = { get val() { return kbEditFromAdmin; }, set val(v) { kbEditFromAdmin = v; } };

    async function deleteKbJamaahAdmin(id) {
        if (!confirm('Hapus data jamaah ini?')) return;
        const { error } = await supabaseClient.from('kb_jamaah').delete().eq('id', id);
        if (error) { showToast('❌ Gagal hapus: ' + error.message); return; }
        kbJamaahList = kbJamaahList.filter(j => j.id !== id);
        renderKbAdminSelector(kbSelectedAdminProgram);
        if (document.getElementById('tab-database-jamaah')?.classList.contains('active')) updateDbJamaahTable();
        showToast('🗑️ Data jamaah dihapus');
    }
    window.deleteKbJamaahAdmin = deleteKbJamaahAdmin;
    window.renderKbAdminSelector = renderKbAdminSelector;
    window.selectKbAdminProgram = selectKbAdminProgram;

    // ========== DATABASE JAMAAH (semua jamaah, lintas program) ==========
    let dbJamaahSearch = '';
    let dbJamaahStatusFilter = 'semua';
    let dbJamaahProgramFilter = 'semua';
    let dbJamaahDebounceTimer = null;

    function renderDbJamaahPanel() {
        const container = document.getElementById('tab-database-jamaah');
        if (!container) return;
        const programOptions = dataUmroh.slice().sort((a,b) => (a.dateObj||0) - (b.dateObj||0))
            .map(p => `<option value="${escapeHtml(String(p.id))}">${escapeHtml(p.nama||'Program')}</option>`).join('');
        container.innerHTML = `
        <div class="admin-panel-section-header keberangkatan">
            <i class="fa-solid fa-database" style="color:#0369a1;"></i>
            <div><div class="sec-title" style="color:#1e3a5f;">Database Jamaah</div><div class="sec-sub">Lihat &amp; cari seluruh data jamaah dari semua program dalam satu tabel</div></div>
            <div class="sec-actions">
                <button class="admin-btn" onclick="exportDbJamaahCSV()"><i class="fas fa-file-csv"></i> Export CSV</button>
                <button class="kb-add-btn" onclick="openKbModal()"><i class="fa-solid fa-user-plus"></i> Tambah Jamaah</button>
            </div>
        </div>
        <div id="dbJamaahStats" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;"></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
            <div style="flex:1;min-width:220px;position:relative;">
                <i class="fa-solid fa-magnifying-glass" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text-3);font-size:12px;"></i>
                <input type="text" id="dbJamaahSearchInput" placeholder="Cari nama, NIK, paspor, WA, asal daerah..." value="${escapeHtml(dbJamaahSearch)}"
                    style="width:100%;padding:9px 12px 9px 32px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none;box-sizing:border-box;"
                    oninput="clearTimeout(dbJamaahDebounceTimer); dbJamaahDebounceTimer=setTimeout(()=>{dbJamaahSearch=this.value; updateDbJamaahTable();},300);">
            </div>
            <select id="dbJamaahStatusSelect" onchange="dbJamaahStatusFilter=this.value; updateDbJamaahTable();" style="padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;">
                <option value="semua">Semua Status</option>
                <option value="lunas">Lunas</option>
                <option value="dp">DP / Cicilan</option>
                <option value="pending">Pending</option>
            </select>
            <select id="dbJamaahProgramSelect" onchange="dbJamaahProgramFilter=this.value; updateDbJamaahTable();" style="padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;max-width:240px;">
                <option value="semua">Semua Program</option>
                ${programOptions}
            </select>
        </div>
        <div class="kb-jamaah-table-wrap">
            <table class="kb-jamaah-table">
                <thead><tr><th>#</th><th>Nama Jamaah</th><th>Program</th><th>No. Paspor</th><th>Asal Daerah</th><th>WhatsApp</th><th>Status Bayar</th><th style="text-align:right;">Aksi</th></tr></thead>
                <tbody id="dbJamaahTableBody"></tbody>
            </table>
        </div>`;
        const statusSel = document.getElementById('dbJamaahStatusSelect'); if (statusSel) statusSel.value = dbJamaahStatusFilter;
        const progSel = document.getElementById('dbJamaahProgramSelect'); if (progSel) progSel.value = dbJamaahProgramFilter;
        updateDbJamaahTable();
    }

    function getDbJamaahFiltered() {
        const keywords = dbJamaahSearch.toLowerCase().trim().split(/\s+/).filter(Boolean);
        return kbJamaahList.filter(j => {
            if (dbJamaahStatusFilter !== 'semua' && j.status !== dbJamaahStatusFilter) return false;
            if (dbJamaahProgramFilter !== 'semua' && String(j.program_id) !== String(dbJamaahProgramFilter)) return false;
            if (keywords.length === 0) return true;
            const haystack = [j.nama, j.nik, j.paspor, j.wa, j.asal, j.catatan].filter(Boolean).join(' ').toLowerCase();
            return keywords.every(kw => haystack.includes(kw));
        }).sort((a,b) => (a.nama||'').localeCompare(b.nama||''));
    }

    function updateDbJamaahTable() {
        const tbody = document.getElementById('dbJamaahTableBody');
        const statsWrap = document.getElementById('dbJamaahStats');
        if (!tbody) return;
        const filtered = getDbJamaahFiltered();
        const totalAll = kbJamaahList.length;
        const totalLunas = kbJamaahList.filter(j => j.status === 'lunas').length;
        const totalDp = kbJamaahList.filter(j => j.status === 'dp').length;
        const totalPending = kbJamaahList.filter(j => j.status === 'pending').length;
        if (statsWrap) {
            statsWrap.innerHTML = `
                <span class="kb-chip total"><i class="fa-solid fa-users" style="margin-right:4px;"></i>${totalAll} Total Jamaah</span>
                <span class="kb-chip lunas">${totalLunas} Lunas</span>
                ${totalDp > 0 ? `<span class="kb-chip dp">${totalDp} DP</span>` : ''}
                ${totalPending > 0 ? `<span class="kb-chip" style="background:#fee2e2;color:#dc2626;border-color:#fecaca;">${totalPending} Pending</span>` : ''}
                ${filtered.length !== totalAll ? `<span class="kb-chip" style="background:#eef2ff;color:#4338ca;border-color:#c7d2fe;">Menampilkan ${filtered.length} hasil</span>` : ''}
            `;
        }
        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8"><div class="kb-empty"><i class="fa-solid fa-users"></i><p>${kbJamaahList.length === 0 ? 'Belum ada data jamaah.' : 'Tidak ada data yang cocok dengan pencarian/filter.'}</p></div></td></tr>`;
        } else {
            tbody.innerHTML = filtered.map((j, i) => {
                const prog = dataUmroh.find(p => String(p.id) === String(j.program_id));
                const statusClass = j.status === 'lunas' ? 'kb-status-lunas' : j.status === 'dp' ? 'kb-status-dp' : 'kb-status-pending';
                const statusLabel = j.status === 'lunas' ? 'Lunas' : j.status === 'dp' ? 'DP / Cicil' : 'Pending';
                return `<tr>
                    <td style="color:var(--text-3);font-size:12px;">${i+1}</td>
                    <td><span class="kb-jamaah-name">${escapeHtml(j.nama||'-')}</span>${j.nik?`<span class="kb-jamaah-nik">NIK: ${escapeHtml(j.nik)}</span>`:''}</td>
                    <td style="font-size:12.5px;">${escapeHtml(prog?.nama || '(program dihapus)')}</td>
                    <td style="font-size:12.5px;font-weight:600;">${escapeHtml(j.paspor||'-')}</td>
                    <td style="font-size:12.5px;">${escapeHtml(j.asal||'-')}</td>
                    <td style="font-size:12.5px;">${j.wa ? escapeHtml(j.wa) : '-'}</td>
                    <td><span class="kb-status-pill ${statusClass}">${statusLabel}</span></td>
                    <td><div class="admin-action-btns">
                        <button onclick="kbEditFromAdmin=true;openKbModal('${j.id}');" style="background:#ede9fe;color:#7c3aed;"><i class="fas fa-edit"></i> Edit</button>
                        <button onclick="openKuitansiModal('${j.id}')" style="background:#e0f2fe;color:#0369a1;"><i class="fa-solid fa-receipt"></i></button>
                        ${j.wa ? `<button onclick="kbHubungi('${escapeHtml(j.wa)}','${escapeHtml(j.nama||'')}')" style="background:#dcfce7;color:#16a34a;"><i class="fab fa-whatsapp"></i></button>` : ''}
                        <button onclick="deleteKbJamaahAdmin('${j.id}')" style="background:#fee2e2;color:#dc2626;"><i class="fas fa-trash"></i></button>
                    </div></td>
                </tr>`;
            }).join('');
        }
        const badge = document.getElementById('tabCountDbJamaah');
        if (badge) badge.textContent = totalAll;
    }

    function exportDbJamaahCSV() {
        const filtered = getDbJamaahFiltered();
        if (filtered.length === 0) { showToast('⚠️ Tidak ada data untuk diexport'); return; }
        const statusLabelMap = { lunas: 'Lunas', dp: 'DP / Cicilan', pending: 'Pending' };
        const header = ['No','Nama','NIK','No. Paspor','Program','Asal Daerah','WhatsApp','Status Bayar','Catatan'];
        const csvEscape = (v) => { const s = String(v==null?'':v).replace(/"/g,'""'); return /[",\n]/.test(s) ? `"${s}"` : s; };
        const rows = filtered.map((j, i) => {
            const prog = dataUmroh.find(p => String(p.id) === String(j.program_id));
            return [i+1, j.nama||'', j.nik||'', j.paspor||'', prog?.nama||'', j.asal||'', j.wa||'', statusLabelMap[j.status]||j.status||'', j.catatan||''].map(csvEscape).join(',');
        });
        const csvContent = '\uFEFF' + [header.join(','), ...rows].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `database_jamaah_${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
        showToast(`✅ Export berhasil — ${filtered.length} data jamaah`);
    }

    window.renderDbJamaahPanel = renderDbJamaahPanel;
    window.updateDbJamaahTable = updateDbJamaahTable;
    window.exportDbJamaahCSV = exportDbJamaahCSV;
    // ========== END DATABASE JAMAAH ==========

    // ========== KUITANSI (cetak PDF) ==========
    const KWT_PENERIMA_KEY = 'amiru_kwt_last_penerima';
    let kwtActiveJamaahId = null;
    let kwtTerbilangEdited = false;

    // Angka -> terbilang bahasa Indonesia (mendukung s.d. triliunan)
    function terbilang(n) {
        n = Math.floor(Math.abs(Number(n) || 0));
        if (n === 0) return 'Nol';
        const satuan = ['', 'Satu', 'Dua', 'Tiga', 'Empat', 'Lima', 'Enam', 'Tujuh', 'Delapan', 'Sembilan', 'Sepuluh', 'Sebelas'];
        function toWords(num) {
            if (num < 12) return satuan[num];
            if (num < 20) return (toWords(num - 10) + ' Belas').trim();
            if (num < 100) return (toWords(Math.floor(num / 10)) + ' Puluh' + (num % 10 !== 0 ? ' ' + toWords(num % 10) : '')).trim();
            if (num < 200) return ('Seratus' + (num - 100 !== 0 ? ' ' + toWords(num - 100) : '')).trim();
            if (num < 1000) return (toWords(Math.floor(num / 100)) + ' Ratus' + (num % 100 !== 0 ? ' ' + toWords(num % 100) : '')).trim();
            if (num < 2000) return ('Seribu' + (num - 1000 !== 0 ? ' ' + toWords(num - 1000) : '')).trim();
            if (num < 1000000) return (toWords(Math.floor(num / 1000)) + ' Ribu' + (num % 1000 !== 0 ? ' ' + toWords(num % 1000) : '')).trim();
            if (num < 1000000000) return (toWords(Math.floor(num / 1000000)) + ' Juta' + (num % 1000000 !== 0 ? ' ' + toWords(num % 1000000) : '')).trim();
            if (num < 1000000000000) return (toWords(Math.floor(num / 1000000000)) + ' Miliar' + (num % 1000000000 !== 0 ? ' ' + toWords(num % 1000000000) : '')).trim();
            return (toWords(Math.floor(num / 1000000000000)) + ' Triliun' + (num % 1000000000000 !== 0 ? ' ' + toWords(num % 1000000000000) : '')).trim();
        }
        return toWords(n).replace(/\s+/g, ' ').trim();
    }

    function openKuitansiModal(jamaahId) {
        const j = kbJamaahList.find(x => String(x.id) === String(jamaahId));
        if (!j) { showToast('⚠️ Data jamaah tidak ditemukan'); return; }
        kwtActiveJamaahId = jamaahId;
        kwtTerbilangEdited = false;
        const prog = dataUmroh.find(p => String(p.id) === String(j.program_id));
        const progName = prog?.nama || 'Umroh';

        const statusKeterangan = j.status === 'lunas' ? `Pelunasan Program Umroh ${progName}`
            : j.status === 'dp' ? `DP / Cicilan Program Umroh ${progName}`
            : `Pembayaran Program Umroh ${progName}`;

        const lastPenerima = localStorage.getItem(KWT_PENERIMA_KEY) || '';
        const suggestNomor = `AHI-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(Math.floor(Math.random()*900)+100)}`;

        document.getElementById('kwt_nomor').value = suggestNomor;
        document.getElementById('kwt_tempat_tanggal').value = `Yogyakarta, ${formatDateToIndonesian(new Date())}`;
        document.getElementById('kwt_dari').value = j.nama || '';
        document.getElementById('kwt_jumlah').value = '';
        document.getElementById('kwt_jumlah_display').textContent = '';
        document.getElementById('kwt_terbilang').value = '';
        document.getElementById('kwt_keterangan').value = statusKeterangan;
        document.getElementById('kwt_penerima').value = lastPenerima;

        const kuitansiModalEl = document.getElementById('kuitansiModal');
        kuitansiModalEl.style.display = '';
        kuitansiModalEl.classList.add('show');
        document.body.style.overflow = 'hidden';
        renderKwtPreview();
        setTimeout(() => document.getElementById('kwt_jumlah')?.focus(), 100);
    }

    function closeKuitansiModal() {
        document.getElementById('kuitansiModal').classList.remove('show');
        document.body.style.overflow = '';
        kwtActiveJamaahId = null;
    }

    function onKwtJumlahInput() {
        const el = document.getElementById('kwt_jumlah');
        const digits = el.value.replace(/\D/g, '');
        const display = document.getElementById('kwt_jumlah_display');
        if (!digits) { display.textContent = ''; if (!kwtTerbilangEdited) document.getElementById('kwt_terbilang').value = ''; renderKwtPreview(); return; }
        display.textContent = 'Rp ' + Number(digits).toLocaleString('id-ID') + ',-';
        if (!kwtTerbilangEdited) document.getElementById('kwt_terbilang').value = terbilang(digits);
        renderKwtPreview();
    }
    window.onKwtJumlahInput = onKwtJumlahInput;

    function renderKwtPreview() {
        const val = id => document.getElementById(id)?.value.trim() || '';
        const jumlahRaw = val('kwt_jumlah').replace(/\D/g, '');
        document.getElementById('pv_nomor').textContent = val('kwt_nomor') || '-';
        document.getElementById('pv_dari').textContent = val('kwt_dari') || '-';
        document.getElementById('pv_terbilang').textContent = val('kwt_terbilang') ? val('kwt_terbilang') + ' Rupiah' : '-';
        document.getElementById('pv_keterangan').textContent = val('kwt_keterangan') || '-';
        document.getElementById('pv_jumlah').textContent = jumlahRaw ? 'Rp ' + Number(jumlahRaw).toLocaleString('id-ID') + ',-' : 'Rp 0,-';
        document.getElementById('pv_tempat_tanggal').textContent = val('kwt_tempat_tanggal') || '-';
        document.getElementById('pv_penerima').textContent = val('kwt_penerima') || '-';
    }
    window.renderKwtPreview = renderKwtPreview;

    // Membangun dokumen PDF kuitansi dari objek data (dipakai untuk download baru & download ulang dari arsip)
    function buildKuitansiPDFDoc(data) {
        const { jsPDF } = window.jspdf;
        // orientation harus eksplisit 'landscape', kalau tidak jsPDF membalik format [210,99] jadi potret (99x210)
        const doc = new jsPDF({ unit: 'mm', format: [210, 99], orientation: 'landscape' });
        const M = 8, W = 210, H = 99;
        const { nomor, tempatTanggal, dari, jumlahRaw, terbilangVal, keterangan, penerima } = data;

        const BLUE = [26, 111, 168];
        const BLUE_DARK = [15, 50, 85];
        const BORDER = [43, 43, 43];
        const BOX_BORDER = [183, 194, 204];
        const GRAY = [91, 107, 122];
        const TXT = [22, 50, 79];

        // Border luar (rounded, mengikuti kartu kuitansi asli)
        doc.setDrawColor(...BORDER);
        doc.setLineWidth(0.7);
        doc.roundedRect(M, M, W - M * 2, H - M * 2, 3, 3);

        const cx = M + 4;
        const rightEdge = M + (W - M * 2) - 4;

        // ---- Logo + wordmark "amirutour" ----
        const logoX = cx, logoY = M + 4.5, logoS = 9;
        doc.setFillColor(...BLUE);
        doc.roundedRect(logoX, logoY, logoS, logoS, 1.5, 1.5, 'F');
        doc.setFillColor(255, 255, 255);
        doc.triangle(logoX + logoS / 2, logoY + 1.6, logoX + 1.8, logoY + 4.6, logoX + logoS - 1.8, logoY + 4.6, 'F');
        doc.rect(logoX + 2.6, logoY + 4.6, logoS - 5.2, 3, 'F');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.3);
        doc.setTextColor(...BLUE);
        doc.text('amiru', logoX + logoS / 2, logoY + logoS + 3.2, { align: 'center' });
        const amiruW = doc.getTextWidth('amiru');
        doc.setTextColor(...GRAY);
        doc.text('tour', logoX + logoS / 2 + amiruW / 2 + 0.5, logoY + logoS + 3.2);

        doc.setDrawColor(...BOX_BORDER);
        doc.setLineWidth(0.3);
        doc.line(logoX + 16, M + 3, logoX + 16, M + 19);

        // ---- Nama perusahaan & alamat ----
        const companyX = logoX + 20;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11.5);
        doc.setTextColor(...BLUE_DARK);
        doc.text('PT AMIRU HARAMAIN INDONESIA', companyX, M + 8);

        doc.setFontSize(6.3);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(70, 82, 94);
        doc.text('Kantor Pusat :', companyX, M + 11.8);
        const kpW = doc.getTextWidth('Kantor Pusat :');
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...GRAY);
        doc.text('Jl. Taman Kenari No A3 Kledokan, Caturtunggal, Kec. Depok, Kabupaten Sleman,', companyX + kpW + 1, M + 11.8);
        doc.text('Daerah Istimewa Yogyakarta, Telp. 0851-2233-6300  Email : salam@amirutour.com', companyX, M + 14.8);

        // ---- Badge "Kuitansi" + Nomor ----
        const badgeW = 34, badgeH = 8.5, badgeX = rightEdge - badgeW, badgeY = M + 2.5;
        doc.setFillColor(...BLUE);
        doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 1.8, 1.8, 'F');
        doc.setFont('helvetica', 'bolditalic');
        doc.setFontSize(12.5);
        doc.setTextColor(255, 255, 255);
        doc.text('Kuitansi', badgeX + badgeW / 2, badgeY + badgeH / 2 + 1.6, { align: 'center' });

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.3);
        doc.setTextColor(0, 0, 0);
        const nomorSpaced = (nomor || '-').split('').join(' ');
        doc.text(`Nomor : ${nomorSpaced}`, rightEdge, badgeY + badgeH + 4.5, { align: 'right' });

        doc.setDrawColor(...BOX_BORDER);
        doc.setLineWidth(0.35);
        doc.line(cx, M + 20.5, rightEdge, M + 20.5);

        // ---- Baris-baris isian ----
        const labelX = cx, colonX = cx + 27, boxX = cx + 29;
        const boxWfull = rightEdge - boxX;
        let y = M + 25;

        function fieldLabel(text, yy) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(7.6);
            doc.setTextColor(20, 20, 20);
            if (text) doc.text(text, labelX, yy);
            doc.text(':', colonX, yy);
        }
        function fieldBox(x, yTop, w, h) {
            doc.setDrawColor(...BOX_BORDER);
            doc.setLineWidth(0.35);
            doc.roundedRect(x, yTop, w, h, 1, 1);
        }
        function fieldBoxText(text, x, yTop, w, h) {
            doc.setFont('helvetica', 'bolditalic');
            doc.setFontSize(8.3);
            doc.setTextColor(...TXT);
            const lines = doc.splitTextToSize(text || '-', w - 4);
            doc.text(lines, x + 2.5, yTop + h / 2 + 1.4 - ((lines.length - 1) * 1.6));
        }

        // Sudah Terima dari
        fieldLabel('Sudah Terima dari', y);
        fieldBox(boxX, y - 4.2, boxWfull, 6.2);
        fieldBoxText(dari, boxX, y - 4.2, boxWfull, 6.2);
        y += 8.2;

        // Banyaknya Uang
        fieldLabel('Banyaknya Uang', y);
        fieldBox(boxX, y - 4.2, boxWfull, 6.2);
        fieldBoxText(terbilangVal ? terbilangVal + ' Rupiah' : '-', boxX, y - 4.2, boxWfull, 6.2);
        y += 8.2;

        // Baris kosong + checkbox Cash/Transfer
        fieldLabel(null, y);
        const shortBoxW = boxWfull * 0.56;
        fieldBox(boxX, y - 4.2, shortBoxW, 6.2);
        function checkbox(labelTxt, x, yy) {
            doc.setDrawColor(40, 40, 40);
            doc.setLineWidth(0.3);
            doc.rect(x, yy - 3, 3, 3);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(7);
            doc.setTextColor(...BLUE);
            doc.text('✓', x + 0.5, yy - 0.6);
            doc.setTextColor(20, 20, 20);
            doc.setFontSize(7.6);
            doc.text(labelTxt, x + 4.5, yy);
            return x + 4.5 + doc.getTextWidth(labelTxt) + 5;
        }
        let ckx = boxX + shortBoxW + 5;
        ckx = checkbox('Cash', ckx, y);
        checkbox('Transfer', ckx, y);
        y += 8.2;

        // Untuk Pembayaran (kotak lebih tinggi) + tempat/tanggal & "Penerima" di kanan
        const payBoxW = boxWfull * 0.72, payBoxH = 11;
        fieldLabel('Untuk Pembayaran', y);
        fieldBox(boxX, y - 4.2, payBoxW, payBoxH);
        fieldBoxText(keterangan, boxX, y - 4.2, payBoxW, payBoxH);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(20, 20, 20);
        doc.text(tempatTanggal || '-', rightEdge, y - 1, { align: 'right' });
        doc.text('Penerima', rightEdge, y + 3, { align: 'right' });

        // ---- Rp + tanda tangan ----
        const bottomY = H - M - 12;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(20, 20, 20);
        doc.text('Rp.', cx, bottomY + 6);
        const rpBoxX = cx + 10, rpBoxW = 46, rpBoxH = 8;
        fieldBox(rpBoxX, bottomY + 1.5, rpBoxW, rpBoxH);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(20, 20, 20);
        const rupiahFormatted = jumlahRaw ? Number(jumlahRaw).toLocaleString('id-ID') + ',-' : '0,-';
        doc.text(rupiahFormatted, rpBoxX + rpBoxW / 2, bottomY + 1.5 + rpBoxH / 2 + 1.3, { align: 'center' });

        doc.setDrawColor(50, 50, 50);
        doc.setLineWidth(0.3);
        doc.line(rightEdge - 34, bottomY + 7, rightEdge, bottomY + 7);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.text(penerima || '-', rightEdge - 17, bottomY + 10.3, { align: 'center' });

        return doc;
    }

    function kwtFilename(dari) {
        return `Kuitansi_${(dari || 'jamaah').replace(/[^a-zA-Z0-9]+/g, '_')}_${new Date().toISOString().slice(0,10)}.pdf`;
    }

    function downloadKuitansiPDF() {
        const nomor = document.getElementById('kwt_nomor').value.trim();
        const tempatTanggal = document.getElementById('kwt_tempat_tanggal').value.trim();
        const dari = document.getElementById('kwt_dari').value.trim();
        const jumlahRaw = document.getElementById('kwt_jumlah').value.replace(/\D/g, '');
        const terbilangVal = document.getElementById('kwt_terbilang').value.trim();
        const keterangan = document.getElementById('kwt_keterangan').value.trim();
        const penerima = document.getElementById('kwt_penerima').value.trim();

        if (!dari) { showToast('⚠️ Nama pemberi (Sudah Terima Dari) wajib diisi'); return; }
        if (!jumlahRaw) { showToast('⚠️ Jumlah wajib diisi'); return; }
        if (!window.jspdf) { showToast('❌ Library PDF belum termuat, coba lagi sebentar'); return; }

        if (penerima) localStorage.setItem(KWT_PENERIMA_KEY, penerima);

        const data = { nomor, tempatTanggal, dari, jumlahRaw, terbilangVal, keterangan, penerima };
        const doc = buildKuitansiPDFDoc(data);
        doc.save(kwtFilename(dari));

        saveKwtArsip(data);
        closeKuitansiModal();
        showToast('✅ Kuitansi berhasil didownload & disimpan ke arsip');
    }

    window.openKuitansiModal = openKuitansiModal;
    window.closeKuitansiModal = closeKuitansiModal;
    window.downloadKuitansiPDF = downloadKuitansiPDF;
    // ========== END KUITANSI ==========

    // ========== ARSIP KUITANSI ==========
    let kwtArsipList = [];
    let kwtArsipSearch = '';

    async function saveKwtArsip(data) {
        try {
            const payload = {
                id: crypto.randomUUID(),
                jamaah_id: kwtActiveJamaahId || null,
                nomor: data.nomor || '',
                tempat_tanggal: data.tempatTanggal || '',
                dari: data.dari || '',
                jumlah: Number(data.jumlahRaw) || 0,
                terbilang: data.terbilangVal || '',
                keterangan: data.keterangan || '',
                penerima: data.penerima || '',
                created_at: new Date().toISOString(),
            };
            const { error } = await supabaseClient.from('kwt_kuitansi').insert([payload]);
            if (error) throw error;
            kwtArsipList.unshift(payload);
        } catch (err) {
            console.error('saveKwtArsip error:', err?.message || err);
            showToast('⚠️ PDF terdownload, tapi gagal disimpan ke arsip: ' + (err?.message || 'error tidak diketahui'));
        }
    }

    async function loadKwtArsip() {
        try {
            const { data, error } = await supabaseClient.from('kwt_kuitansi').select('*').order('created_at', { ascending: false });
            if (error) throw error;
            kwtArsipList = data || [];
        } catch (err) {
            const msg = err?.message || String(err);
            if (msg.includes('DataCloneError') || msg.includes('postMessage')) {
                try {
                    const res = await fetch(`${SUPABASE_URL}/rest/v1/kwt_kuitansi?select=*&order=created_at.desc`, {
                        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }
                    });
                    kwtArsipList = res.ok ? (await res.json()) : [];
                    return;
                } catch (_) {}
            }
            console.error('loadKwtArsip error:', msg);
            kwtArsipList = [];
        }
    }

    async function openKwtArsipModal() {
        const modal = document.getElementById('kwtArsipModal');
        modal.style.display = '';
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
        document.getElementById('kwtArsipSearchInput').value = '';
        kwtArsipSearch = '';
        document.getElementById('kwtArsipTableWrap').innerHTML = `<div class="kb-empty"><i class="fa-solid fa-spinner fa-spin"></i><p>Memuat arsip...</p></div>`;
        await loadKwtArsip();
        renderKwtArsipTable();
    }
    window.openKwtArsipModal = openKwtArsipModal;

    function closeKwtArsipModal() {
        document.getElementById('kwtArsipModal').classList.remove('show');
        document.body.style.overflow = '';
    }
    window.closeKwtArsipModal = closeKwtArsipModal;

    function searchKwtArsip(term) {
        kwtArsipSearch = (term || '').toLowerCase().trim();
        renderKwtArsipTable();
    }
    window.searchKwtArsip = searchKwtArsip;

    function renderKwtArsipTable() {
        const wrap = document.getElementById('kwtArsipTableWrap');
        if (!wrap) return;
        let list = kwtArsipList;
        if (kwtArsipSearch) {
            list = list.filter(r =>
                (r.nomor || '').toLowerCase().includes(kwtArsipSearch) ||
                (r.dari || '').toLowerCase().includes(kwtArsipSearch) ||
                (r.keterangan || '').toLowerCase().includes(kwtArsipSearch)
            );
        }
        if (list.length === 0) {
            wrap.innerHTML = `<div class="kb-empty"><i class="fa-solid fa-box-archive"></i><p>Belum ada kuitansi yang diarsipkan.</p></div>`;
            return;
        }
        const rows = list.map(r => {
            const tgl = r.created_at ? new Date(r.created_at).toLocaleString('id-ID', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '-';
            const jumlahFmt = 'Rp ' + Number(r.jumlah || 0).toLocaleString('id-ID') + ',-';
            return `<tr>
                <td style="font-size:12px;color:var(--text-3);">${escapeHtml(tgl)}</td>
                <td style="font-size:12.5px;font-weight:700;">${escapeHtml(r.nomor || '-')}</td>
                <td style="font-size:12.5px;">${escapeHtml(r.dari || '-')}</td>
                <td style="font-size:12.5px;font-weight:600;">${escapeHtml(jumlahFmt)}</td>
                <td><div class="admin-action-btns">
                    <button onclick="redownloadKwtArsip('${r.id}')" style="background:#e0f2fe;color:#0369a1;" title="Download ulang PDF"><i class="fa-solid fa-file-pdf"></i></button>
                    <button onclick="deleteKwtArsip('${r.id}')" style="background:#fee2e2;color:#dc2626;" title="Hapus dari arsip"><i class="fas fa-trash"></i></button>
                </div></td>
            </tr>`;
        }).join('');
        wrap.innerHTML = `<table class="kb-jamaah-table">
            <thead><tr><th>Tanggal Dibuat</th><th>Nomor</th><th>Sudah Terima Dari</th><th>Jumlah</th><th style="text-align:right;">Aksi</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
    }

    function redownloadKwtArsip(id) {
        const r = kwtArsipList.find(x => String(x.id) === String(id));
        if (!r) { showToast('⚠️ Data arsip tidak ditemukan'); return; }
        if (!window.jspdf) { showToast('❌ Library PDF belum termuat, coba lagi sebentar'); return; }
        const data = {
            nomor: r.nomor, tempatTanggal: r.tempat_tanggal, dari: r.dari,
            jumlahRaw: String(r.jumlah || 0), terbilangVal: r.terbilang,
            keterangan: r.keterangan, penerima: r.penerima,
        };
        const doc = buildKuitansiPDFDoc(data);
        doc.save(kwtFilename(r.dari));
        showToast('✅ Kuitansi berhasil didownload ulang');
    }
    window.redownloadKwtArsip = redownloadKwtArsip;

    async function deleteKwtArsip(id) {
        if (!confirm('Hapus kuitansi ini dari arsip? PDF yang sudah didownload sebelumnya tidak terpengaruh.')) return;
        try {
            const { error } = await supabaseClient.from('kwt_kuitansi').delete().eq('id', id);
            if (error) throw error;
            kwtArsipList = kwtArsipList.filter(r => String(r.id) !== String(id));
            renderKwtArsipTable();
            showToast('🗑️ Kuitansi dihapus dari arsip');
        } catch (err) {
            showToast('❌ Gagal hapus: ' + (err?.message || 'error tidak diketahui'));
        }
    }
    window.deleteKwtArsip = deleteKwtArsip;
    // ========== END ARSIP KUITANSI ==========
    
    function renderAdminTable() {
        const tbody=document.getElementById('adminTableBody');
        if(!tbody) return;
        const tabBadge = document.getElementById('tabCountUmroh');
        if (tabBadge) tabBadge.textContent = adminPrograms.length;
        if(!adminPrograms.length){tbody.innerHTML='<tr><td colspan="4" style="text-align:center;padding:40px;">Belum ada program.</td></tr>';return;}
        tbody.innerHTML='';
        adminPrograms.forEach(p=>{
            const isActive = p.is_active !== false;
            tbody.innerHTML+=`<tr class="${isActive?'':'admin-row-disabled'}"><td><strong>${escapeHtml(p.nama||'-')}</strong>${isActive?'':'<span class="program-status-badge off">Nonaktif</span>'}</td><td>${escapeHtml(p.harga_quint||'-')}</td><td>${escapeHtml(p.tgl||'-')}</td><td class="admin-action-btns"><button onclick="editAdminProgram('${p.id}')" style="background:#e0f2fe;color:#0284c7;"><i class="fas fa-edit"></i> Edit</button><button class="${isActive?'btn-disable':'btn-enable'}" onclick="toggleProgramActive('${p.id}', ${isActive})"><i class="fas fa-power-off"></i> ${isActive?'Disable':'Aktifkan'}</button><button class="btn-duplicate" onclick="duplicateAdminProgram('${p.id}')" style="background:#fef9c3;color:#854d0e;border:1px solid #fde68a;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.15s;"><i class="fas fa-copy"></i> Duplikat</button><button onclick="deleteAdminProgram('${p.id}')" style="background:#fee2e2;color:#dc2626;"><i class="fas fa-trash"></i> Hapus</button></td></tr>`;
        });
        renderFeaturedAdminTable();
    }
    
    function getAdminFormData() { 
        return { 
            nama: document.getElementById('admin_nama')?.value.trim()||'', 
            tgl: document.getElementById('admin_tgl')?.value||(document.getElementById('admin_tgl_date')?.value?(()=>{const [y,m,d]=document.getElementById('admin_tgl_date').value.split('-');return formatDateToIndonesian(new Date(parseInt(y),parseInt(m)-1,parseInt(d)));})():''), 
            durasi: document.getElementById('admin_durasi')?.value||'', 
            maskapai: document.getElementById('admin_maskapai')?.value||'', 
            link_form: document.getElementById('admin_link_form')?.value||'', 
            link_itinerary: document.getElementById('admin_link_itinerary')?.value||'', 
            link_poster: document.getElementById('admin_link_poster')?.value||'', 
            link_metaads: document.getElementById('admin_link_metaads')?.value||'', 
            link_dokumentasi: document.getElementById('admin_link_dokumentasi')?.value||'', 
            harga_quint: document.getElementById('admin_harga_quint')?.value||'', 
            teks_wa: document.getElementById('admin_teks_wa')?.value||'',
            // Admin-only fields (disimpan di admin_data_lengkap JSON)
            harga_quad: document.getElementById('admin_harga_quad')?.value||'',
            harga_triple: document.getElementById('admin_harga_triple')?.value||'',
            harga_double: document.getElementById('admin_harga_double')?.value||'',
            hotel_makkah: document.getElementById('admin_hotel_makkah')?.value||'',
            hotel_madinah: document.getElementById('admin_hotel_madinah')?.value||'',
            makan_makkah: document.getElementById('admin_makan_makkah')?.value||'',
            makan_madinah: document.getElementById('admin_makan_madinah')?.value||'',
            termasuk: document.getElementById('admin_termasuk')?.value||'',
            tidak_termasuk: document.getElementById('admin_tidak_termasuk')?.value||'',
            catatan_cx: document.getElementById('admin_catatan_cx')?.value||''
        }; 
    }
    
    function setAdminFormData(data) { 
        document.getElementById('admin_nama')&&(document.getElementById('admin_nama').value=data.nama||''); 
        document.getElementById('admin_tgl')&&(document.getElementById('admin_tgl').value=data.tgl||''); 
        if(document.getElementById('admin_tgl_date')){const d=parseDateFromString(data.tgl);if(d&&!isNaN(d.getTime()))document.getElementById('admin_tgl_date').value=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;else document.getElementById('admin_tgl_date').value='';} 
        document.getElementById('admin_durasi')&&(document.getElementById('admin_durasi').value=data.durasi||''); 
        const sel=document.getElementById('admin_maskapai');sel&&(data.maskapai?sel.value=data.maskapai:sel.selectedIndex=0); 
        document.getElementById('admin_link_form')&&(document.getElementById('admin_link_form').value=data.link_form||''); 
        document.getElementById('admin_link_itinerary')&&(document.getElementById('admin_link_itinerary').value=data.link_itinerary||''); 
        document.getElementById('admin_link_poster')&&(document.getElementById('admin_link_poster').value=data.link_poster||''); 
        document.getElementById('admin_link_metaads')&&(document.getElementById('admin_link_metaads').value=data.link_metaads||''); 
        document.getElementById('admin_link_dokumentasi')&&(document.getElementById('admin_link_dokumentasi').value=data.link_dokumentasi||''); 
        document.getElementById('admin_harga_quint')&&(document.getElementById('admin_harga_quint').value=data.harga_quint||''); 
        document.getElementById('admin_teks_wa')&&(document.getElementById('admin_teks_wa').value=data.teks_wa||'');
        // Admin-only fields: baca dari admin_data_lengkap (JSON) atau langsung dari data
        const adl = (() => { try { return data.admin_data_lengkap ? (typeof data.admin_data_lengkap === 'string' ? JSON.parse(data.admin_data_lengkap) : data.admin_data_lengkap) : {}; } catch(e) { return {}; } })();
        const setV = (id, val) => { const el=document.getElementById(id); if(el) el.value = val||''; };
        setV('admin_harga_quad',      data.harga_quad      || adl.harga_quad      || '');
        setV('admin_harga_triple',    data.harga_triple    || adl.harga_triple    || '');
        setV('admin_harga_double',    data.harga_double    || adl.harga_double    || '');
        setV('admin_hotel_makkah',    data.hotel_makkah    || adl.hotel_makkah    || '');
        setV('admin_hotel_madinah',   data.hotel_madinah   || adl.hotel_madinah   || '');
        setV('admin_makan_makkah',    data.makan_makkah    || adl.makan_makkah    || '');
        setV('admin_makan_madinah',   data.makan_madinah   || adl.makan_madinah   || '');
        setV('admin_termasuk',        data.termasuk        || adl.termasuk        || '');
        setV('admin_tidak_termasuk',  data.tidak_termasuk  || adl.tidak_termasuk  || '');
        setV('admin_catatan_cx',      data.catatan_cx      || adl.catatan_cx      || '');
    }
    
    function showAdminForm() {
        editingProgramId=null;
        document.getElementById('adminFormTitle').innerText='Tambah Program Baru';
        setAdminFormData({});
        document.getElementById('adminFormContainer').style.display='block';
        // Switch ke tab umroh supaya form terlihat
        const umrohTabBtn = document.querySelector('.admin-tab-btn:not(.tab-star):not(.tab-jadwal):not(.tab-keberangkatan)');
        switchAdminTab('umroh', umrohTabBtn);
    }
    function hideAdminForm() { document.getElementById('adminFormContainer').style.display='none'; }
    
    async function saveAdminProgram() { 
        const nama=document.getElementById('admin_nama')?.value.trim(); 
        if(!nama){alert('Nama program wajib diisi!');return;} 
        
        // Validasi keamanan nama program
        if (!isValidProgramName(nama)) {
            alert('Nama program mengandung karakter tidak valid!');
            return;
        }
        
        const formData=getAdminFormData(); 
        
        // Validasi keamanan URL
        const urlFields = ['link_itinerary', 'link_poster', 'link_metaads', 'link_dokumentasi'];
        for (const field of urlFields) {
            if (formData[field] && !isValidUrl(formData[field])) {
                alert(`Link ${field.replace('_',' ')} tidak valid! Gunakan format https://...`);
                return;
            }
        }
        
        if(!formData.teks_wa)formData.teks_wa=generateAutoWAText(formData);

        // Pack admin-only fields ke admin_data_lengkap JSON (merge dengan data lama, mis. hasil OCR poster,
        // supaya tidak hilang tiap kali program diedit/disimpan ulang)
        const adminOnlyFields = ['harga_quad','harga_triple','harga_double','hotel_makkah','hotel_madinah','makan_makkah','makan_madinah','termasuk','tidak_termasuk','catatan_cx'];
        let existingAdl = {};
        if (editingProgramId) {
            const existingProg = adminPrograms.find(p => String(p.id) === String(editingProgramId));
            if (existingProg && existingProg.admin_data_lengkap) {
                try { existingAdl = typeof existingProg.admin_data_lengkap === 'string' ? JSON.parse(existingProg.admin_data_lengkap) : existingProg.admin_data_lengkap; } catch(e) { existingAdl = {}; }
            }
        }
        const adl = { ...existingAdl };
        adminOnlyFields.forEach(f => { if(formData[f]) adl[f] = formData[f]; else delete adl[f]; });
        const saveData = { ...formData };
        adminOnlyFields.forEach(f => delete saveData[f]);
        saveData.admin_data_lengkap = JSON.stringify(adl);

        try{
            const isEdit = !!editingProgramId;
            let savedRow;
            if(editingProgramId){ savedRow = await updateProgramById(editingProgramId,saveData); savedRow = savedRow || {id: editingProgramId}; }
            else { savedRow = await insertProgram(saveData); }
            await loadDataFromSupabase(true);await renderAdminPanel();hideAdminForm();showToast('Program berhasil disimpan!');
            // Kirim notif Telegram
            sendTelegramNotif(formatTgProgram(formData, isEdit), 'program');
            // Crosscheck otomatis: hanya scan poster kalau BELUM PERNAH discan, atau link poster berganti.
            // Kalau poster masih sama dengan yang terakhir discan (baik hasil OCR maupun sudah dikoreksi manual),
            // JANGAN scan ulang otomatis — supaya koreksi manual admin tidak ketimpa diam-diam tiap kali Simpan,
            // dan tidak boros panggilan AI Vision. Untuk refresh manual, admin bisa klik "Scan Ulang Poster".
            const posterBelumPernahDiscan = !existingAdl.poster_data;
            const posterBerganti = !!existingAdl.poster_scanned_link && existingAdl.poster_scanned_link !== saveData.link_poster;
            if (saveData.link_poster && savedRow && savedRow.id && (posterBelumPernahDiscan || posterBerganti)) {
                autoScanPosterForProgram(savedRow.id);
            }
        }catch(err){showToast('Gagal: '+err.message);} 
    }
    
    async function editAdminProgram(id){const{data}=await supabaseClient.from('programs').select('*').eq('id',id).single();if(data){setAdminFormData(data);editingProgramId=id;document.getElementById('adminFormTitle').innerText='Edit Program';document.getElementById('adminFormContainer').style.display='block';document.getElementById('adminFormContainer').scrollIntoView({behavior:'smooth',block:'start'});}}
    async function duplicateAdminProgram(id){
        const{data}=await supabaseClient.from('programs').select('*').eq('id',id).single();
        if(!data){showToast('❌ Program tidak ditemukan');return;}
        // Salin semua data kecuali id dan tanggal (reset tanggal agar admin isi baru)
        const dupData={...data};
        delete dupData.id;
        delete dupData.created_at;
        dupData.tgl=''; // kosongkan tanggal agar diisi ulang
        dupData.nama='[DUPLIKAT] ' + (dupData.nama||'');
        dupData.is_active=true; // duplikat selalu aktif, terlepas status program asal
        setAdminFormData(dupData);
        editingProgramId=null; // mode insert baru
        document.getElementById('adminFormTitle').innerText='Duplikat Program — Ubah Tanggal & Simpan';
        document.getElementById('adminFormContainer').style.display='block';
        // Scroll ke form
        document.getElementById('adminFormContainer').scrollIntoView({behavior:'smooth',block:'start'});
        showToast('📋 Program diduplikat — ubah tanggal lalu simpan!');
    }
    async function toggleProgramActive(id, currentlyActive){
        const newStatus = !currentlyActive;
        try{
            await updateProgramById(id, { is_active: newStatus });
            const local = adminPrograms.find(p => String(p.id) === String(id));
            if (local) local.is_active = newStatus;
            renderAdminTable();
            await loadDataFromSupabase(true);
            showToast(newStatus ? '✅ Program diaktifkan kembali' : '🚫 Program dinonaktifkan — tersembunyi dari halaman publik');
        }catch(err){
            showToast('Gagal mengubah status: ' + err.message);
        }
    }
    window.toggleProgramActive = toggleProgramActive;
    let pendingDeleteId = null;
    function deleteAdminProgram(id) {
        const prog = adminPrograms.find(p => String(p.id) === String(id));
        if (!prog) return;
        pendingDeleteId = id;
        document.getElementById('deleteConfirmProgName').textContent = prog.nama || 'Program ini';
        document.getElementById('deleteConfirmInput').value = '';
        document.getElementById('deleteConfirmBtn').disabled = true;
        const delModalEl = document.getElementById('deleteConfirmModal');
        delModalEl.style.display = '';
        delModalEl.classList.add('show');
        setTimeout(() => document.getElementById('deleteConfirmInput').focus(), 100);
    }
    function closeDeleteConfirmModal() {
        document.getElementById('deleteConfirmModal').classList.remove('show');
        pendingDeleteId = null;
    }
    function onDeleteConfirmInput() {
        const prog = adminPrograms.find(p => String(p.id) === String(pendingDeleteId));
        const val = document.getElementById('deleteConfirmInput').value;
        document.getElementById('deleteConfirmBtn').disabled = !prog || val !== prog.nama;
    }
    async function confirmDeleteProgram() {
        if (!pendingDeleteId) return;
        const btn = document.getElementById('deleteConfirmBtn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Menghapus...';
        try {
            await deleteProgramById(pendingDeleteId);
            await loadDataFromSupabase(true);
            await renderAdminPanel();
            closeDeleteConfirmModal();
            showToast('🗑️ Program berhasil dihapus');
        } catch(err) {
            showToast('Gagal hapus: ' + err.message);
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-trash"></i> Hapus Permanen';
        }
    }
    window.deleteAdminProgram = deleteAdminProgram;
    window.closeDeleteConfirmModal = closeDeleteConfirmModal;
    window.onDeleteConfirmInput = onDeleteConfirmInput;
    window.confirmDeleteProgram = confirmDeleteProgram;
    async function clearAllAdminData(){if(confirm('⚠️ PERINGATAN: Hapus SEMUA program?')){try{const{data}=await supabaseClient.from('programs').select('id');for(const prog of data)await deleteProgramById(prog.id);await loadDataFromSupabase(true);await renderAdminPanel();showToast('Semua program dihapus');}catch(err){showToast('Gagal: '+err.message);}}}
    async function exportAdminData() {
        showToast('⏳ Menyiapkan backup...');
        try {
            const headers = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY };
            const [resPrograms, resJadwal, resKb, resFeatured] = await Promise.all([
                fetch(`${SUPABASE_URL}/rest/v1/programs?select=*&order=created_at.asc`, { headers }),
                fetch(`${SUPABASE_URL}/rest/v1/jadwal_tamu?select=*&order=tgl.asc`, { headers }),
                fetch(`${SUPABASE_URL}/rest/v1/kb_jamaah?select=*&order=nama.asc`, { headers }),
                fetch(`${SUPABASE_URL}/rest/v1/featured_programs?select=*`, { headers }),
            ]);
            const backup = {
                _meta: {
                    app: 'Amiru Repository',
                    exported_at: new Date().toISOString(),
                    version: '2.0',
                },
                programs:          resPrograms.ok  ? await resPrograms.json()  : [],
                jadwal_tamu:       resJadwal.ok    ? await resJadwal.json()    : [],
                kb_jamaah:         resKb.ok        ? await resKb.json()        : [],
                featured_programs: resFeatured.ok  ? await resFeatured.json() : [],
            };
            const total = backup.programs.length + backup.jadwal_tamu.length + backup.kb_jamaah.length;
            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `amiru_backup_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
            showToast(`✅ Backup berhasil — ${total} record`);
        } catch(err) {
            showToast('❌ Gagal backup: ' + err.message);
        }
    }

    function importAdminData() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > MAX_FILE_SIZE) { showToast('❌ File terlalu besar! Maksimal 5MB.'); return; }
            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const imported = JSON.parse(event.target.result);
                    // Format baru: objek dengan _meta (backup lengkap)
                    if (imported && imported._meta && imported.programs) {
                        const { programs = [], jadwal_tamu = [], kb_jamaah = [], featured_programs = [] } = imported;
                        const tgl = new Date(imported._meta.exported_at).toLocaleString('id-ID');
                        const msg = `Restore backup dari ${tgl}?\n\n` +
                            `• ${programs.length} program umroh\n` +
                            `• ${jadwal_tamu.length} jadwal tamu\n` +
                            `• ${kb_jamaah.length} data jamaah\n` +
                            `• ${featured_programs.length} program unggulan\n\n` +
                            `Data yang sudah ada TIDAK akan dihapus, hanya ditambah/diperbarui.`;
                        if (!confirm(msg)) return;
                        showToast('⏳ Mengimport data...');
                        let ok = 0, fail = 0;
                        for (const prog of programs) {
                            if (prog.nama && isValidProgramName(prog.nama)) {
                                try { await upsertProgram(prog); ok++; } catch { fail++; }
                            }
                        }
                        const hdr = {
                            'apikey': SUPABASE_ANON_KEY,
                            'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
                            'Content-Type': 'application/json',
                            'Prefer': 'resolution=merge-duplicates',
                        };
                        if (jadwal_tamu.length) await fetch(`${SUPABASE_URL}/rest/v1/jadwal_tamu`, { method: 'POST', headers: hdr, body: JSON.stringify(jadwal_tamu) });
                        if (kb_jamaah.length) await fetch(`${SUPABASE_URL}/rest/v1/kb_jamaah`, { method: 'POST', headers: hdr, body: JSON.stringify(kb_jamaah) });
                        if (featured_programs.length) await fetch(`${SUPABASE_URL}/rest/v1/featured_programs`, { method: 'POST', headers: hdr, body: JSON.stringify(featured_programs) });
                        await loadDataFromSupabase(true);
                        await loadJadwal();
                        await loadKbJamaah();
                        await loadFeaturedIds();
                        await renderAdminPanel();
                        showToast(`✅ Restore selesai — ${ok} program${fail ? ', ' + fail + ' gagal' : ''}`);
                    // Format lama: array program saja
                    } else if (Array.isArray(imported)) {
                        if (!confirm(`Import ${imported.length} program umroh? Data yang sudah ada tidak akan dihapus.`)) return;
                        let ok = 0;
                        for (const prog of imported) {
                            if (prog.nama && isValidProgramName(prog.nama)) {
                                try { await upsertProgram(prog); ok++; } catch {}
                            }
                        }
                        await loadDataFromSupabase(true);
                        await renderAdminPanel();
                        showToast(`✅ Import berhasil — ${ok} program`);
                    } else {
                        showToast('❌ Format file tidak dikenali');
                    }
                } catch(err) { showToast('❌ Gagal: ' + err.message); }
            };
            reader.readAsText(file);
        };
        input.click();
    }
    
    function sortAdminTable(column){adminSortAsc=adminSortColumn===column?!adminSortAsc:true;adminSortColumn=column;const programs=[...adminPrograms];programs.sort((a,b)=>{if(column==='tgl'){const dateA=parseDateFromString(a.tgl),dateB=parseDateFromString(b.tgl);return adminSortAsc?dateA-dateB:dateB-dateA;}if(column==='harga_quint'){const numA=parseInt(String(a.harga_quint||'').replace(/[^0-9]/g,''),10)||0,numB=parseInt(String(b.harga_quint||'').replace(/[^0-9]/g,''),10)||0;return adminSortAsc?numA-numB:numB-numA;}const vA=String(a[column]||'').toLowerCase(),vB=String(b[column]||'').toLowerCase();return adminSortAsc?vA.localeCompare(vB):vB.localeCompare(vA);});adminPrograms=programs;renderAdminTable();}
    
    function logoutAdmin(){adminLoggedIn=false;currentRole=null;sessionStorage.removeItem('admin_logged_in');sessionStorage.removeItem('admin_role');sessionStorage.removeItem('admin_login_time');if(sessionTimeout)clearTimeout(sessionTimeout);const roleBadge=document.getElementById('adminRoleBadge');if(roleBadge)roleBadge.style.display='none';const headerLogoutBtn=document.getElementById('adminHeaderLogoutBtn');if(headerLogoutBtn)headerLogoutBtn.style.display='none';closeAdminModal();showToast('Berhasil logout');}
    
    function checkAdminLogin(){
        const pwd=document.getElementById('adminPasswordInput')?.value;
        const errorDiv=document.getElementById('adminLoginError');
        
        // Rate limiting
        if(Date.now()<loginLockTime){
            const waitSeconds=Math.ceil((loginLockTime-Date.now())/1000);
            errorDiv.innerText=`⏳ Terlalu banyak percobaan. Coba lagi ${waitSeconds} detik.`;
            return;
        }
        
        const matchedUser = USER_ROLES[pwd];
        if(matchedUser){
            loginAttempts=0;
            setAdminSession(matchedUser.role);
            renderAdminPanel();
        }else{
            loginAttempts++;
            if(loginAttempts>=5){
                loginLockTime=Date.now()+60000;
                errorDiv.innerText='❌ Terlalu banyak percobaan. Coba lagi 1 menit.';
            }else{
                errorDiv.innerText=`❌ Password salah! Sisa percobaan: ${5-loginAttempts}`;
            }
        }
    }

    window.openDrawer=()=>{const ov=document.getElementById('mobileOverlay');ov&&(ov.classList.add('open'),document.body.style.overflow='hidden');};
    window.closeDrawer=()=>{const ov=document.getElementById('mobileOverlay');ov&&(ov.classList.remove('open'),document.body.style.overflow='');};

    // ===== POSTER HOVER POPUP =====
    function resolveImageUrl(url) {
        if (!url) return url;
        // Google Drive: /file/d/ID/view atau /file/d/ID/view?usp=...
        const gdMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
        if (gdMatch) return `https://drive.google.com/thumbnail?id=${gdMatch[1]}&sz=w1080`;
        // Google Drive: open?id=ID
        const gdOpen = url.match(/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/);
        if (gdOpen) return `https://drive.google.com/thumbnail?id=${gdOpen[1]}&sz=w1080`;
        return url;
    }

    let _posterHideTimer = null;
    function showPosterPopup(e, el) {
        clearTimeout(_posterHideTimer);
        const popup = document.getElementById('posterPopup');
        const img = document.getElementById('posterPopupImg');
        const loading = document.getElementById('posterPopupLoading');
        const errEl = document.getElementById('posterPopupError');
        const nameEl = document.getElementById('posterPopupName');
        const posterUrl = resolveImageUrl(el.getAttribute('data-poster'));
        const posterNama = el.getAttribute('data-nama');
        // Reset state
        img.style.display = 'none';
        img.src = '';
        loading.style.display = 'flex';
        errEl.style.display = 'none';
        nameEl.textContent = posterNama || 'Poster Program';
        // Hitung ukuran popup: rasio 1080:1350, fit ke viewport dengan margin
        const RATIO = 1080 / 1350;
        const gap = 16, margin = 12, labelH = 36;
        const vw = window.innerWidth, vh = window.innerHeight;
        const maxH = vh - margin * 2 - labelH;
        const maxW = Math.min(vw * 0.85, 1080);
        let ph, pw;
        if (maxW / RATIO + labelH <= vh - margin * 2) {
            pw = maxW; ph = Math.round(pw / RATIO);
        } else {
            ph = maxH; pw = Math.round(ph * RATIO);
        }
        // Terapkan ukuran ke elemen
        const inner = popup.querySelector('.poster-popup-inner');
        const wrap = popup.querySelector('.poster-popup-img-wrap');
        inner.style.width = pw + 'px';
        wrap.style.width = pw + 'px';
        wrap.style.height = ph + 'px';
        // Posisi: kanan kursor, geser kiri jika terpotong
        let x = e.clientX + gap;
        let y = e.clientY - Math.round(ph / 3);
        if (x + pw > vw - margin) x = e.clientX - pw - gap;
        if (x < margin) x = margin;
        if (y + ph + labelH > vh - margin) y = vh - ph - labelH - margin;
        if (y < margin) y = margin;
        popup.style.left = x + 'px';
        popup.style.top = y + 'px';
        popup.classList.add('visible');
        img.src = posterUrl;
    }
    function hidePosterPopup() {
        _posterHideTimer = setTimeout(() => {
            const popup = document.getElementById('posterPopup');
            popup.classList.remove('visible');
        }, 120);
    }
    window.showPosterPopup = showPosterPopup;
    window.hidePosterPopup = hidePosterPopup;

    // ===== PARSE BROADCAST TEXT =====
    window.parseBroadcastText = function() {
        const raw = document.getElementById('parseBroadcastInput').value.trim();
        if (!raw) { showToast('Paste teks broadcast dulu'); return; }

        const lines = raw.split('\n').map(l => l.trim()).filter(l => l);
        const clean = s => s.replace(/^\*+|\*+$/g, '').trim();
        const cleanAll = s => s.replace(/\*/g, '').trim();

        // Nama: baris pertama bold *...*
        let nama = '';
        for (const l of lines) {
            if (/^\*.+\*$/.test(l)) { nama = clean(l); break; }
        }
        if (!nama) nama = clean(lines[0]);

        // Durasi: "Program X hari"
        let durasi = '';
        for (const l of lines) {
            const m = l.match(/program\s+(\d+)\s*hari/i) || l.match(/^(\d+)\s*hari/i);
            if (m) { durasi = m[1] + ' Hari'; break; }
        }

        // Maskapai: baris setelah *PESAWAT*
        let maskapai = '';
        for (let i = 0; i < lines.length - 1; i++) {
            if (/pesawat/i.test(clean(lines[i]))) { maskapai = clean(lines[i + 1]); break; }
        }

        // === HARGA SEMUA TIPE ===
        const parseHarga = (txt) => {
            const m = txt.replace(/\./g,'').match(/(\d{5,})/);
            return m ? 'Rp ' + parseInt(m[1]).toLocaleString('id-ID') : '';
        };

        let harga_quint = '', harga_quad = '', harga_triple = '', harga_double = '';
        for (const l of lines) {
            const lc = l.toLowerCase();
            if (/qu[ai]n[dt]|quint/i.test(lc)) {
                if (!harga_quint) harga_quint = parseHarga(l);
            } else if (/qu[ao]r[da]|quad/i.test(lc)) {
                if (!harga_quad) harga_quad = parseHarga(l);
            } else if (/triple|tripel/i.test(lc)) {
                if (!harga_triple) harga_triple = parseHarga(l);
            } else if (/double|dbl/i.test(lc)) {
                if (!harga_double) harga_double = parseHarga(l);
            }
        }
        // Jika tidak ada Quint, ambil harga termurah yang ada sebagai harga publik (harga_quint)
        // Urutan termurah: quint < quad < triple < double
        if (!harga_quint) {
            harga_quint = harga_quad || harga_triple || harga_double;
        }

        // Tanggal: cari format "DD - DD Bulan YYYY" atau "DD Bulan YYYY"
        let tglISO = '';
        const BULAN = {januari:'01',februari:'02',maret:'03',april:'04',mei:'05',juni:'06',juli:'07',agustus:'08',september:'09',oktober:'10',november:'11',desember:'12'};
        for (const l of lines) {
            let m = l.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
            if (m) {
                const bln = BULAN[m[3].toLowerCase()];
                if (bln) { tglISO = m[4] + '-' + bln + '-' + m[1].padStart(2,'0'); break; }
            }
            m = l.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
            if (m) {
                const bln = BULAN[m[2].toLowerCase()];
                if (bln) { tglISO = m[3] + '-' + bln + '-' + m[1].padStart(2,'0'); break; }
            }
        }

        // === PROGRAM WISATA ===
        // Contoh: "2D1N Dubai City Tour" atau "Old Town & Elephant Rock Al Ula"
        let program_wisata = '';
        for (const l of lines) {
            // Baris yang mengandung pola wisata (city tour, dsb) tapi bukan harga/hotel
            if (/\d+D\d+N|\d+H\d+M|city tour|old town|elephant rock|wisata|tour/i.test(l) && !/hotel|harga|biaya|visa|pesawat/i.test(l)) {
                const pw = cleanAll(l);
                if (pw.length > 3) { program_wisata = (program_wisata ? program_wisata + ' + ' : '') + pw; }
            }
        }

        // === HOTEL ===
        // Format broadcast: "*HOTEL MEKAH 4H*" (header), baris berikut = nama hotel
        // Variasi: Makkah / Mekkah / Mekah / Makkah, bisa ada "3H" / "4H" / "5H" setelah nama kota
        let hotel_makkah = '', hotel_madinah = '';
        let hotel_makkah_hari = '', hotel_madinah_hari = '';
        let hotel_makkah_jarak = '', hotel_madinah_jarak = '';
        const isMakkahHeader = s => /hotel\s*m[ae]k+ah/i.test(s);
        const isMadinahHeader = s => /hotel\s*mad[iy]nah/i.test(s);
        // Helper: ekstrak info jarak dari baris (misal "(750m 10 menit jalan kaki)" atau baris berikutnya)
        const parseJarak = (txt) => {
            const m = txt.match(/\(([^)]*(?:m|km|meter)[^)]*)\)/i) || txt.match(/(\d+\s*m[^,\n]*(?:jalan|menit)[^,\n]*)/i);
            return m ? m[1].trim() : '';
        };
        // Helper: ekstrak jumlah hari dari header hotel (misal "4H" → "4")
        const parseHariHotel = (txt) => {
            const m = txt.match(/(\d+)\s*[Hh]/);
            return m ? m[1] : '';
        };
        for (let i = 0; i < lines.length; i++) {
            const lc = cleanAll(lines[i]).toLowerCase();
            const rawLine = lines[i];
            // Inline: "Hotel Makkah : Hilton xxx" atau "Hotel Mekah 4H : Hilton"
            const mMakkahInline = rawLine.match(/hotel\s*m[ae]k+ah([^:]*)[:\-]\s*(.+)/i);
            if (mMakkahInline && !hotel_makkah) {
                hotel_makkah = cleanAll(mMakkahInline[2]);
                hotel_makkah_hari = parseHariHotel(mMakkahInline[1]);
                continue;
            }
            const mMadinahInline = rawLine.match(/hotel\s*mad[iy]nah([^:]*)[:\-]\s*(.+)/i);
            if (mMadinahInline && !hotel_madinah) {
                hotel_madinah = cleanAll(mMadinahInline[2]);
                hotel_madinah_hari = parseHariHotel(mMadinahInline[1]);
                continue;
            }
            // Header baris terpisah: baris berikut = nama hotel
            if (isMakkahHeader(lc) && !hotel_makkah && i+1 < lines.length) {
                hotel_makkah_hari = parseHariHotel(lc);
                hotel_makkah = cleanAll(lines[i+1]);
                // Cek baris setelah nama hotel untuk jarak
                if (i+2 < lines.length) hotel_makkah_jarak = parseJarak(lines[i+2]);
                continue;
            }
            if (isMadinahHeader(lc) && !hotel_madinah && i+1 < lines.length) {
                hotel_madinah_hari = parseHariHotel(lc);
                hotel_madinah = cleanAll(lines[i+1]);
                if (i+2 < lines.length) hotel_madinah_jarak = parseJarak(lines[i+2]);
                continue;
            }
            // Baris jarak standalone setelah hotel sudah diisi (misal "(750m 10 menit jalan kaki)")
            if (hotel_makkah && !hotel_makkah_jarak) { const j = parseJarak(rawLine); if(j) hotel_makkah_jarak = j; }
            if (hotel_madinah && !hotel_madinah_jarak) { const j = parseJarak(rawLine); if(j) hotel_madinah_jarak = j; }
        }

        // === MAKAN ===
        let makan_makkah = '', makan_madinah = '';
        for (const l of lines) {
            const lc = l.toLowerCase();
            const mMakkah = l.match(/makan(?:an)?\s*m[ae]k+ah[^:]*[:\-]\s*(.+)/i);
            if (mMakkah && !makan_makkah) { makan_makkah = cleanAll(mMakkah[1]); continue; }
            const mMadinah = l.match(/makan(?:an)?\s*mad[iy]nah[^:]*[:\-]\s*(.+)/i);
            if (mMadinah && !makan_madinah) { makan_madinah = cleanAll(mMadinah[1]); continue; }
            // "FullBoard" atau "3x Sehari" di dalam fasilitas
            if (/fullboard|full\s*board/i.test(lc)) {
                if (!makan_makkah) makan_makkah = 'FullBoard';
                if (!makan_madinah) makan_madinah = 'FullBoard';
            }
            if (/makan|konsumsi/i.test(lc)) {
                const m3x = l.match(/(\d+\s*[xX]\s*(?:sehari|makan))/i);
                if (m3x) { if (!makan_makkah) makan_makkah = m3x[1]; else if (!makan_madinah) makan_madinah = m3x[1]; }
            }
        }

        // === FASILITAS TERMASUK & TIDAK TERMASUK ===
        // Format broadcast: item diawali "*" (bukan bullet), header "Biaya Sudah Termasuk" / "BIAYA BELUM TERMASUK"
        let termasuk = [], tidak_termasuk = [], catatanBroadcast = [];
        let mode = null;
        // Baris disclaimer/footer (mis. "biaya & jadwal sewaktu-waktu dapat berubah...") bukan item Termasuk/Tidak Termasuk asli —
        // dikenali dari panjang baris atau kata kunci umum disclaimer, dialihkan ke Catatan Admin
        const isDisclaimerLine = (txt) => txt.length > 70 || /sewaktu[\s-]*waktu|dapat\s*berubah|syarat\s*dan\s*ketentuan|s&k\s*berlaku/i.test(txt);
        for (const l of lines) {
            const lc = cleanAll(l).toLowerCase();
            // Deteksi header section — cek "tidak termasuk" dulu (lebih spesifik)
            if (/tidak\s*termasuk|belum\s*termasuk|not\s*include/i.test(lc)) { mode = 'tidak'; continue; }
            if (/sudah\s*termasuk|biaya\s*termasuk|^termasuk$|include|fasilitas/i.test(lc)) { mode = 'termasuk'; continue; }
            if (!mode) continue;
            // Item diawali: *, -, •, ✓, angka., atau baris yang diawali bintang tunggal (format broadcast)
            const isItem = /^\*[^*]/.test(l) || /^[-•✓✈🕌🚌🍽️★]/.test(l) || /^\d+\./.test(l);
            if (isItem) {
                // Bersihkan: hapus * di awal/akhir, simbol bullet
                const item = l.replace(/^\*+/, '').replace(/\*+$/, '').replace(/^[-•✓✈🕌🚌🍽️★]\s*/, '').replace(/^\d+\.\s*/, '').trim();
                if (item && item.length > 1) {
                    if (isDisclaimerLine(item)) catatanBroadcast.push(item);
                    else if (mode === 'termasuk') termasuk.push(item);
                    else tidak_termasuk.push(item);
                }
            }
        }

        // Sambungkan info wisata tambahan (city tour dll) ke daftar Termasuk, supaya ikut tersimpan & tampil di teks WA
        if (program_wisata) termasuk.unshift(`Wisata Tambahan: ${program_wisata}`);

        // Sambungkan info jarak hotel & lama menginap ke nama hotel, supaya ikut tersimpan (field admin_hotel_makkah/madinah)
        // dan otomatis tampil di teks WA (generateAutoWAText memakai field hotel_makkah/hotel_madinah)
        const enrichHotel = (nm, hari, jarak) => {
            if (!nm) return nm;
            const extra = [];
            if (hari) extra.push(hari + ' malam');
            if (jarak) extra.push(jarak);
            return extra.length ? `${nm} (${extra.join(', ')})` : nm;
        };
        const hotelMakkahDisplay  = enrichHotel(hotel_makkah, hotel_makkah_hari, hotel_makkah_jarak);
        const hotelMadinahDisplay = enrichHotel(hotel_madinah, hotel_madinah_hari, hotel_madinah_jarak);

        // Cocokkan maskapai ke select option
        const sel = document.getElementById('admin_maskapai');
        if (sel && maskapai) {
            const opts = Array.from(sel.options);
            const kata = maskapai.toLowerCase().split(' ')[0];
            const found = opts.find(o => o.value.toLowerCase().includes(kata));
            if (found) { sel.value = found.value; maskapai = found.value; } // pakai nama maskapai yang bersih (buang info rute/transit ikutan)
        }

        // Isi form publik
        if (nama)   document.getElementById('admin_nama').value = nama;
        if (durasi) document.getElementById('admin_durasi').value = durasi;
        if (harga_quint)  document.getElementById('admin_harga_quint').value = harga_quint;
        if (tglISO) {
            const tglInput = document.getElementById('admin_tgl_date');
            if (tglInput) { tglInput.value = tglISO; tglInput.dispatchEvent(new Event('change')); }
        }
        // Generate teks WA dengan format baru
        const parsedData = {
            nama,
            tgl: (() => { for (const l of lines) { if (/\d{1,2}\s*[-\u2013]\s*\d{1,2}\s+[A-Za-z]+\s+\d{4}/.test(l)) return cleanAll(l); if (/\d{1,2}\s+[A-Za-z]+\s+\d{4}/.test(l)) return cleanAll(l); } return ''; })(),
            durasi, maskapai,
            harga_quad, harga_triple, harga_double, harga_quint,
            hotel_makkah: hotelMakkahDisplay, hotel_madinah: hotelMadinahDisplay,
            termasuk: termasuk.join('\n'),
            tidak_termasuk: tidak_termasuk.join('\n')
        };
        document.getElementById('admin_teks_wa').value = generateAutoWAText(parsedData);

        // Isi field admin-only
        const setVal = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
        setVal('admin_harga_quad', harga_quad);
        setVal('admin_harga_triple', harga_triple);
        setVal('admin_harga_double', harga_double);
        setVal('admin_hotel_makkah', hotelMakkahDisplay);
        setVal('admin_hotel_madinah', hotelMadinahDisplay);
        setVal('admin_makan_makkah', makan_makkah);
        setVal('admin_makan_madinah', makan_madinah);
        if (termasuk.length) setVal('admin_termasuk', termasuk.join('\n'));
        if (tidak_termasuk.length) setVal('admin_tidak_termasuk', tidak_termasuk.join('\n'));
        if (catatanBroadcast.length) setVal('admin_catatan_cx', catatanBroadcast.join('\n'));

        // Status
        const parts = [];
        if (nama) parts.push('Nama');
        if (durasi) parts.push('Durasi');
        if (maskapai) parts.push('Maskapai');
        if (harga_quint) parts.push('Harga Quint');
        if (harga_quad) parts.push('Quad');
        if (harga_triple) parts.push('Triple');
        if (harga_double) parts.push('Double');
        if (hotel_makkah) parts.push('Hotel Makkah');
        if (hotel_madinah) parts.push('Hotel Madinah');
        if (tglISO) parts.push('Tanggal');
        if (termasuk.length) parts.push('Fasilitas (' + termasuk.length + ' item)');

        const status = document.getElementById('parseStatus');
        status.textContent = '\u2713 Terisi: ' + parts.join(', ');
        status.style.display = 'inline';
        setTimeout(() => status.style.display = 'none', 6000);
        showToast('Form berhasil diisi otomatis (' + parts.length + ' field)');
    };
    window.resetSearch=resetSearch;window.openAdminModal=openAdminModal;window.closeAdminModal=closeAdminModal;window.checkAdminLogin=checkAdminLogin;window.logoutAdmin=logoutAdmin;window.showAdminForm=showAdminForm;window.hideAdminForm=hideAdminForm;window.saveAdminProgram=saveAdminProgram;window.editAdminProgram=editAdminProgram;window.duplicateAdminProgram=duplicateAdminProgram;window.deleteAdminProgram=deleteAdminProgram;window.clearAllAdminData=clearAllAdminData;window.exportAdminData=exportAdminData;window.importAdminData=importAdminData;window.sortAdminTable=sortAdminTable;window.openDetailModal=openDetailModal;window.closeDetailModal=closeDetailModal;window.copyDetailWAText=copyDetailWAText;

    function showCsLockWarning() { showToast('🔒 Fitur ini hanya untuk Administrator'); }
    window.showCsLockWarning = showCsLockWarning;


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
    // Hanya hitung slot unggulan yang program-nya masih aktif & belum lewat tanggal —
    // supaya program expired/nonaktif yang lupa dihapus dari unggulan tidak mengunci slot selamanya
    function getActiveFeaturedCount() {
        return featuredIds.filter(id => {
            const p = dataUmroh.find(x => String(x.id) === id);
            return p && p.is_active !== false && p.isAvailable;
        }).length;
    }

    async function toggleFeatured(id) {
        id = String(id);
        if (isFeatured(id)) {
            const { error } = await supabaseClient.from('featured_programs').delete().eq('program_id', id);
            if (error) { showToast('❌ Gagal: ' + error.message); return; }
            featuredIds = featuredIds.filter(i => i !== id);
            showToast('⭐ Program dihapus dari unggulan');
        } else {
            if (getActiveFeaturedCount() >= MAX_FEATURED) { showToast('⚠️ Maksimal ' + MAX_FEATURED + ' program unggulan!'); return; }
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

        const featuredPrograms = dataUmroh.filter(p => ids.includes(String(p.id)) && p.is_active !== false && p.isAvailable);

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
                    <div><span class="featured-price-main">${escapeHtml(p.harga_quint)}</span></div>
                    <span class="status-pill ${isAvailable ? 'status-available' : 'status-expired'}" style="font-size:9px;">${isAvailable ? 'Tersedia' : 'Expired'}</span>
                </div>` : ''}
                <div class="featured-card-actions" onclick="event.stopPropagation()">
                    <button class="featured-btn featured-btn-detail" onclick="openDetailModal('${p.id}')"><i class="fas fa-info-circle"></i> Detail</button>
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
        const currentCount = getActiveFeaturedCount();
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
        const jadwalModalEl = document.getElementById('jadwalModal');
        jadwalModalEl.style.display = '';
        jadwalModalEl.classList.add('show');
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
        modal.style.display = '';
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
        if (document.getElementById('tab-database-jamaah')?.classList.contains('active')) updateDbJamaahTable();
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

    async function getTgConfig() {
        if (_tgConfigCache) return _tgConfigCache;
        try {
            const { data, error } = await supabaseClient.from('tg_config').select('key, value');
            if (error || !data || !data.length) return {};
            const cfg = {};
            data.forEach(row => {
                try { cfg[row.key] = JSON.parse(row.value); }
                catch { cfg[row.key] = row.value; }
            });
            _tgConfigCache = cfg;
            return cfg;
        } catch { return {}; }
    }

    async function saveTgConfig() {
        const botToken = document.getElementById('tg_bot_token')?.value.trim();
        const edgeUrl  = document.getElementById('tg_edge_url')?.value.trim();
        if (!botToken) { showTgStatus('❌ Bot Token wajib diisi', 'err'); return; }
        if (!edgeUrl)  { showTgStatus('❌ Edge Function URL wajib diisi', 'err'); return; }
        const recipients = collectTgRecipients();
        if (!recipients.length) { showTgStatus('❌ Tambahkan minimal 1 penerima', 'err'); return; }
        showTgStatus('⏳ Menyimpan...', 'ok');
        try {
            const rows = [
                { key: 'botToken',    value: botToken },
                { key: 'edgeUrl',     value: edgeUrl },
                { key: 'recipients',  value: JSON.stringify(recipients) },
            ];
            const { error } = await supabaseClient.from('tg_config').upsert(rows, { onConflict: 'key' });
            if (error) throw error;
            _tgConfigCache = null; // invalidate cache
            showTgStatus('✅ Konfigurasi tersimpan!', 'ok');
        } catch (err) {
            showTgStatus('❌ Gagal simpan: ' + err.message, 'err');
        }
    }

    function collectTgRecipients() {
        const rows = document.querySelectorAll('.tg-recipient-row');
        const result = [];
        rows.forEach(row => {
            const chatId = row.querySelector('.tg-chat-id')?.value.trim();
            const label  = row.querySelector('.tg-label')?.value.trim();
            const types  = [...row.querySelectorAll('.tg-type-check:checked')].map(c => c.value);
            if (chatId) result.push({ chatId, label: label || chatId, types });
        });
        return result;
    }

    async function renderTgRecipients() {
        const list = document.getElementById('tgRecipientsList');
        if (!list) return;
        list.innerHTML = '<p style="color:var(--text-3);font-size:12px;">⏳ Memuat konfigurasi...</p>';
        const cfg = await getTgConfig();
        const tokenInput = document.getElementById('tg_bot_token');
        const edgeInput  = document.getElementById('tg_edge_url');
        if (tokenInput && cfg.botToken) tokenInput.value = cfg.botToken;
        if (edgeInput  && cfg.edgeUrl)  edgeInput.value  = cfg.edgeUrl;
        const recipients = typeof cfg.recipients === 'string' ? JSON.parse(cfg.recipients) : (cfg.recipients || []);
        list.innerHTML = '';
        if (!recipients.length) { addTgRecipient(); return; }
        recipients.forEach(r => addTgRecipientRow(r));
    }

    function addTgRecipient() {
        addTgRecipientRow({ chatId: '', label: '', types: ['program', 'jadwal', 'reminder'] });
    }

    function addTgRecipientRow(r) {
        const list = document.getElementById('tgRecipientsList');
        if (!list) return;
        const row = document.createElement('div');
        row.className = 'tg-recipient-row';
        const typeOpts = [
            { val: 'program',  label: '📦 Program Baru' },
            { val: 'jadwal',   label: '📅 Jadwal Tamu' },
            { val: 'reminder', label: '🔔 Pengingat 1 Bulan' },
        ];
        row.innerHTML = `
            <input class="tg-chat-id" placeholder="Chat ID (mis: -1001234567890)" value="${escapeHtml(r.chatId||'')}" style="flex:1.2;min-width:160px;">
            <input class="tg-label" placeholder="Label (mis: Grup Admin)" value="${escapeHtml(r.label||'')}" style="flex:1;min-width:120px;">
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                ${typeOpts.map(t => `<label class="tg-type-label">
                    <input type="checkbox" class="tg-type-check" value="${t.val}" ${(r.types||[]).includes(t.val)?'checked':''}> ${t.label}
                </label>`).join('')}
            </div>
            <button class="tg-remove-btn" onclick="this.closest('.tg-recipient-row').remove()" title="Hapus penerima"><i class="fas fa-times"></i></button>`;
        list.appendChild(row);
    }

    function showTgStatus(msg, type) {
        const el = document.getElementById('tgStatusMsg');
        if (!el) return;
        el.innerHTML = `<span class="tg-status ${type}">${sanitizeHtml(msg)}</span>`;
        setTimeout(() => { if(el) el.innerHTML = ''; }, 4000);
    }

    function logTg(msg, ok = true) {
        const log = document.getElementById('tgNotifLog');
        if (!log) return;
        log.style.display = 'block';
        const p = document.createElement('p');
        p.className = ok ? 'ok' : 'err';
        p.textContent = '[' + new Date().toLocaleTimeString('id-ID') + '] ' + msg;
        log.appendChild(p);
        log.scrollTop = log.scrollHeight;
    }

    // Kirim ke Supabase Edge Function
    async function sendTelegramNotif(message, eventType = 'program') {
        const cfg = await getTgConfig();
        if (!cfg.botToken || !cfg.edgeUrl) return;
        const targets = (cfg.recipients || []).filter(r => (r.types || []).includes(eventType));
        if (!targets.length) return;
        for (const target of targets) {
            try {
                const res = await fetch(cfg.edgeUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        bot_token: cfg.botToken,
                        chat_id: target.chatId,
                        message,
                        parse_mode: 'HTML'
                    })
                });
                const result = await res.json().catch(() => ({}));
                if (res.ok && result.ok !== false) {
                    logTg('✅ Terkirim ke ' + target.label, true);
                } else {
                    logTg('❌ Gagal ke ' + target.label + ': ' + (result.description || res.status), false);
                }
            } catch (err) {
                logTg('❌ Error ke ' + target.label + ': ' + err.message, false);
            }
        }
    }

    // Format pesan: Program baru / edit
    function formatTgProgram(data, isEdit = false) {
        const icon   = isEdit ? '✏️' : '🆕';
        const action = isEdit ? 'diperbarui' : 'ditambahkan';
        return `${icon} <b>Program Umroh ${action}!</b>

🕌 <b>${escapeHtml(data.nama||'-')}</b>
📅 Berangkat: ${escapeHtml(data.tgl||'-')}
⏳ Durasi: ${escapeHtml(data.durasi||'-')}
✈️ Maskapai: ${escapeHtml(data.maskapai||'-')}
💰 Harga: ${escapeHtml(data.harga_quint||'-')}

📌 <i>PT Amiru Haramain Indonesia</i>
🕐 ${new Date().toLocaleString('id-ID')}`;
    }

    // Format pesan: Jadwal tamu baru / edit
    function formatTgJadwal(entry, isEdit = false) {
        const icon   = isEdit ? '✏️' : '📅';
        const action = isEdit ? 'diperbarui' : 'baru';
        const tglFormatted = entry.tgl
            ? new Date(entry.tgl).toLocaleDateString('id-ID', {weekday:'long',day:'numeric',month:'long',year:'numeric'})
            : '-';
        return `${icon} <b>Jadwal Tamu ${action}!</b>

👤 <b>${escapeHtml(entry.nama||'-')}</b>
🏠 Asal: ${escapeHtml(entry.asal||'-')}
📅 Tanggal: ${tglFormatted}
🕐 Jam: ${escapeHtml(entry.jam||'belum ditentukan')}
👥 Jumlah: ${entry.jumlah ? entry.jumlah + ' orang' : '-'}
💼 Keperluan: ${escapeHtml(entry.keperluan||'-')}${entry.catatan ? '\n📝 Catatan: '+escapeHtml(entry.catatan) : ''}

📌 <i>PT Amiru Haramain Indonesia</i>`;
    }

    // Format pesan: Pengingat program hampir berangkat (≤ 30 hari)
    function formatTgReminder(data, sisaHari) {
        const urgency = sisaHari <= 7 ? '🚨' : sisaHari <= 14 ? '⚠️' : '🔔';
        return `${urgency} <b>PENGINGAT — Program Hampir Berangkat!</b>

🕌 <b>${escapeHtml(data.nama||'-')}</b>
📅 Tanggal Berangkat: ${escapeHtml(data.tgl||'-')}
⏰ <b>Sisa ${sisaHari} hari lagi!</b>
⏳ Durasi: ${escapeHtml(data.durasi||'-')}
✈️ Maskapai: ${escapeHtml(data.maskapai||'-')}
💰 Harga: ${escapeHtml(data.harga_quint||'-')}

📌 <i>PT Amiru Haramain Indonesia</i>
🕐 ${new Date().toLocaleString('id-ID')}`;
    }

    // Cek program yang tinggal ≤ 30 hari, kirim reminder (1x per hari per program)
    async function checkAndSendReminders() {
        const cfg = await getTgConfig();
        if (!cfg.botToken || !cfg.edgeUrl) return;
        const recipients = typeof cfg.recipients === 'string' ? JSON.parse(cfg.recipients) : (cfg.recipients || []);
        const targets = recipients.filter(r => (r.types||[]).includes('reminder'));
        if (!targets.length) return;
        if (!dataUmroh || !dataUmroh.length) return;

        // Ambil sentLog dari Supabase tg_config
        let sentLog = {};
        try {
            const { data } = await supabaseClient.from('tg_config').select('value').eq('key', TG_REMINDER_KEY).single();
            if (data) sentLog = JSON.parse(data.value);
        } catch {}

        const today = new Date(); today.setHours(0,0,0,0);
        const todayStr = today.toISOString().split('T')[0];
        let changed = false;

        for (const prog of dataUmroh) {
            if (!prog.tgl || prog.is_active === false) continue;
            const tglParts = prog.tgl.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
            if (!tglParts) continue;
            const bulanMap = {januari:0,februari:1,maret:2,april:3,mei:4,juni:5,juli:6,agustus:7,september:8,oktober:9,november:10,desember:11};
            const bln = bulanMap[tglParts[2].toLowerCase()];
            if (bln === undefined) continue;
            const tglBerangkat = new Date(parseInt(tglParts[3]), bln, parseInt(tglParts[1]));
            tglBerangkat.setHours(0,0,0,0);
            const sisaMs   = tglBerangkat - today;
            const sisaHari = Math.ceil(sisaMs / (1000 * 60 * 60 * 24));
            if (sisaHari < 0 || sisaHari > 30) continue;

            // Cek sudah dikirim hari ini?
            const key = String(prog.id);
            if (sentLog[key] === todayStr) continue;

            const msg = formatTgReminder(prog, sisaHari);
            await sendTelegramNotif(msg, 'reminder');
            sentLog[key] = todayStr;
            changed = true;
        }

        // Simpan sentLog ke Supabase jika ada perubahan
        if (changed) {
            await supabaseClient.from('tg_config').upsert(
                [{ key: TG_REMINDER_KEY, value: JSON.stringify(sentLog) }],
                { onConflict: 'key' }
            );
        }
    }

    // Test kirim semua jenis notifikasi
    async function testTgNotif() {
        await saveTgConfig();
        const waktu = new Date().toLocaleString('id-ID');
        const msgProgram = `🧪 <b>TEST — Program Baru</b>

🕌 <b>Contoh: Umroh Ramadhan 2025</b>
📅 Berangkat: 01 Maret 2025
⏳ Durasi: 9 Hari
✈️ Maskapai: Saudia Airlines
💰 Harga: Rp 34.500.000

📌 <i>PT Amiru Haramain Indonesia</i>
🕐 ${waktu}`;
        const msgJadwal = `🧪 <b>TEST — Jadwal Tamu Baru</b>

👤 <b>H. Budi Santoso</b>
🏠 Asal: Ponorogo
📅 Tanggal: Senin, 27 Januari 2025
🕐 Jam: 09:00
👥 Jumlah: 3 orang
💼 Keperluan: Konsultasi Paket Umroh

📌 <i>PT Amiru Haramain Indonesia</i>`;
        const msgReminder = `🔔 <b>TEST — Pengingat Program</b>

🕌 <b>Umroh Spesial Akbar</b>
📅 Tanggal Berangkat: 15 Februari 2025
⏰ <b>Sisa 20 hari lagi!</b>

📌 <i>PT Amiru Haramain Indonesia</i>
🕐 ${waktu}`;

        showTgStatus('⏳ Mengirim test...', 'ok');
        await sendTelegramNotif(msgProgram,  'program');
        await sendTelegramNotif(msgJadwal,   'jadwal');
        await sendTelegramNotif(msgReminder, 'reminder');
        showTgStatus('✅ Test selesai! Cek log di bawah.', 'ok');
    }

    window.saveTgConfig       = saveTgConfig;
    window.addTgRecipient     = addTgRecipient;
    window.testTgNotif        = testTgNotif;
    window.renderTgRecipients = renderTgRecipients;
    // ========== END TELEGRAM ==========

    // ========== CROSSCHECK PANEL ==========
    let cxSelectedProgram = null;
    let cxScanningIds = new Set(); // program id yang sedang di-OCR
    let cxOcrProgress = {}; // {progId: 0..100}

    // ---- OCR ENGINE: Gemini Vision via Supabase Edge Function ----
    const CX_OCR_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/scan-poster-ocr`;

    async function cxRunOcr(progId, imageUrl, onProgress) {
        onProgress(20); // mulai: kirim request
        const res = await fetch(CX_OCR_FUNCTION_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl }),
        });
        onProgress(80); // request selesai, sedang proses respons
        if (!res.ok) {
            let detail = '';
            try { detail = (await res.json()).error || ''; } catch (e) {}
            throw new Error(detail || `Server OCR gagal (status ${res.status})`);
        }
        const data = await res.json();
        if (!data || !data.fields) throw new Error('Respons OCR tidak valid.');
        onProgress(100);
        return data; // { fields: {...}, raw_text: "..." }
    }

    // ---- ORKESTRATOR: dipanggil otomatis tiap kali program (dengan poster) disimpan ----
    async function autoScanPosterForProgram(progId) {
        const prog = adminPrograms.find(p => String(p.id) === String(progId));
        if (!prog || !prog.link_poster) return;
        if (cxScanningIds.has(String(progId))) return; // sudah berjalan, jangan dobel

        cxScanningIds.add(String(progId));
        cxOcrProgress[progId] = 0;
        if (String(cxSelectedProgram) === String(progId)) renderCxPanel(progId);
        renderCxProgramSelector();

        try {
            const result = await cxRunOcr(progId, prog.link_poster, (pct) => {
                cxOcrProgress[progId] = pct;
                if (String(cxSelectedProgram) === String(progId)) {
                    const bar = document.getElementById('cxOcrBar_' + progId);
                    if (bar) bar.style.width = pct + '%';
                }
            });

            const parsed = { ...result.fields };
            // Buang field kosong supaya tidak menimpa data lama dengan string kosong
            Object.keys(parsed).forEach(k => { if (!parsed[k]) delete parsed[k]; });
            parsed._raw_ocr_text = (result.raw_text || '').slice(0, 4000);

            // Simpan ke admin_data_lengkap.poster_data, tandai sumber = OCR (AI Vision)
            const adl = (() => { try { return prog.admin_data_lengkap ? (typeof prog.admin_data_lengkap === 'string' ? JSON.parse(prog.admin_data_lengkap) : prog.admin_data_lengkap) : {}; } catch(e) { return {}; } })();
            adl.poster_data = parsed;
            adl.poster_data_source = 'ocr';
            adl.poster_scanned_at = new Date().toISOString();
            adl.poster_scanned_link = prog.link_poster; // dipakai untuk deteksi "poster berganti" di saveAdminProgram

            await updateProgramById(progId, { admin_data_lengkap: JSON.stringify(adl) });
            const idx = adminPrograms.findIndex(p => String(p.id) === String(progId));
            if (idx >= 0) adminPrograms[idx].admin_data_lengkap = JSON.stringify(adl);

            const mismatchCount = cxCountMismatch(progId);
            if (mismatchCount > 0) {
                showToast(`⚠️ Crosscheck "${prog.nama}": ${mismatchCount} data tidak cocok dengan poster!`);
            } else {
                showToast(`✅ Crosscheck "${prog.nama}": semua data cocok dengan poster.`);
            }
        } catch (err) {
            showToast('❌ Pembacaan poster gagal: ' + err.message);
        } finally {
            cxScanningIds.delete(String(progId));
            delete cxOcrProgress[progId];
            renderCxProgramSelector();
            if (String(cxSelectedProgram) === String(progId)) renderCxPanel(progId);
        }
    }
    window.autoScanPosterForProgram = autoScanPosterForProgram;

    // ---- Toleransi perbandingan: field tertentu tidak perlu cocok 100% karakter ----
    // Harga: abaikan "Rp", titik/koma pemisah ribuan, spasi — yang penting nominal angkanya sama.
    function cxNormalizeHarga(str) {
        if (!str) return '';
        return String(str).replace(/[^0-9]/g, '');
    }
    // Maskapai: "Saudia Airlines" vs "Saudia" (poster kadang cuma logo/nama singkat) dianggap cocok.
    function cxNormalizeMaskapai(str) {
        return String(str || '').toLowerCase().trim().replace(/\b(airlines?|airways|air)\b/gi, '').replace(/\s+/g, ' ').trim();
    }
    // Hotel: teks plain sering lengkap "Nama Hotel / Setaraf (5 malam, 500m 7 menit jalan kaki)",
    // sedangkan poster biasanya cuma cantumkan nama hotelnya saja — ambil nama inti sebelum "/" atau "(".
    function cxNormalizeHotel(str) {
        if (!str) return '';
        return String(str).split('/')[0].split('(')[0].toLowerCase().trim().replace(/\s+/g, ' ');
    }
    // Tanggal: teks plain kadang tulis rentang penuh "20-28 Agustus 2026" (berangkat-pulang),
    // sedangkan poster kadang cuma cantumkan satu tanggal "20 Agustus 2026" (biasanya tanggal berangkat) — atau sebaliknya.
    // Juga dukung singkatan bulan ("Ags", "Sept", dst.) dan rentang yang lintas bulan ("31 Ags - 9 Sept 2026").
    // Selama tanggalnya jatuh di dalam rentang & tahun sama, dianggap cocok (dengan catatan).
    const CX_BULAN_MAP = {
        januari:1, jan:1,
        februari:2, feb:2,
        maret:3, mar:3,
        april:4, apr:4,
        mei:5, may:5,
        juni:6, jun:6,
        juli:7, jul:7,
        agustus:8, ags:8, agt:8, agu:8, aug:8,
        september:9, sept:9, sep:9,
        oktober:10, okt:10, oct:10,
        november:11, nov:11,
        desember:12, des:12, dec:12,
    };
    function cxMonthLookup(token) {
        const t = (token || '').toLowerCase().replace(/[^a-z]/g, '');
        if (!t) return null;
        if (CX_BULAN_MAP[t]) return CX_BULAN_MAP[t];
        // fallback: cocokkan 3 huruf pertama (jaga-jaga ada singkatan lain yang belum terdaftar persis)
        const stem = t.slice(0, 3);
        for (const k in CX_BULAN_MAP) { if (k.slice(0, 3) === stem) return CX_BULAN_MAP[k]; }
        return null;
    }
    function cxParseTanggal(str) {
        if (!str) return null;
        const s = String(str).toLowerCase();
        // Rentang lintas bulan: "31 ags - 9 sept 2026" / "31 agustus - 9 september 2026"
        let m = s.match(/(\d{1,2})\s+([a-z]+)\.?\s*[-–]\s*(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})/);
        if (m) {
            const bln1 = cxMonthLookup(m[2]), bln2 = cxMonthLookup(m[4]);
            if (bln1 && bln2) return { startDay: parseInt(m[1]), startMonth: bln1, endDay: parseInt(m[3]), endMonth: bln2, year: parseInt(m[5]), isRange: true };
        }
        // Rentang satu bulan: "20-28 agustus 2026"
        m = s.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})/);
        if (m) {
            const bln = cxMonthLookup(m[3]);
            if (bln) return { startDay: parseInt(m[1]), startMonth: bln, endDay: parseInt(m[2]), endMonth: bln, year: parseInt(m[4]), isRange: true };
        }
        // Tanggal tunggal: "20 agustus 2026"
        m = s.match(/(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})/);
        if (m) {
            const bln = cxMonthLookup(m[2]);
            if (bln) return { startDay: parseInt(m[1]), startMonth: bln, endDay: parseInt(m[1]), endMonth: bln, year: parseInt(m[3]), isRange: false };
        }
        return null;
    }
    // Return: null (gak kebaca / gak nyambung sama sekali), {match:true, exact:true} (identik),
    // atau {match:true, exact:false} (cocok via toleransi rentang — perlu dikasih catatan di UI)
    function cxDatesCompare(a, b) {
        const da = cxParseTanggal(a), db = cxParseTanggal(b);
        if (!da || !db) return { match: false };
        if (da.year !== db.year) return { match: false };
        // Encode month+day jadi satu angka urut (month*100+day) supaya rentang lintas bulan bisa dibandingkan
        const daStart = da.startMonth * 100 + da.startDay, daEnd = da.endMonth * 100 + da.endDay;
        const dbStart = db.startMonth * 100 + db.startDay, dbEnd = db.endMonth * 100 + db.endDay;
        const overlap = daStart <= dbEnd && dbStart <= daEnd;
        if (!overlap) return { match: false };
        const exact = daStart === dbStart && daEnd === dbEnd;
        return { match: true, exact };
    }
    function cxValuesMatch(field, a, b) {
        if (!a || !b) return false;
        if (field === 'tgl') return cxDatesCompare(a, b).match;
        if (field && field.indexOf('harga') === 0) {
            const na = cxNormalizeHarga(a), nb = cxNormalizeHarga(b);
            return na !== '' && na === nb;
        }
        if (field === 'maskapai') {
            const na = cxNormalizeMaskapai(a), nb = cxNormalizeMaskapai(b);
            if (!na || !nb) return false;
            return na === nb || na.includes(nb) || nb.includes(na);
        }
        if (field === 'hotel_makkah' || field === 'hotel_madinah') {
            const na = cxNormalizeHotel(a), nb = cxNormalizeHotel(b);
            if (!na || !nb) return false;
            return na === nb || na.includes(nb) || nb.includes(na);
        }
        return a.toLowerCase().trim() === b.toLowerCase().trim();
    }

    // Hitung berapa field yang tidak cocok antara teks plain & hasil OCR poster
    function cxCountMismatch(progId) {
        const prog = adminPrograms.find(p => String(p.id) === String(progId));
        if (!prog) return 0;
        const adl = (() => { try { return prog.admin_data_lengkap ? (typeof prog.admin_data_lengkap === 'string' ? JSON.parse(prog.admin_data_lengkap) : prog.admin_data_lengkap) : {}; } catch(e) { return {}; } })();
        const pd = adl.poster_data || {};
        const pairs = [
            ['nama', prog.nama, pd.nama], ['tgl', prog.tgl, pd.tgl], ['durasi', prog.durasi, pd.durasi], ['maskapai', prog.maskapai, pd.maskapai],
            ['harga_quint', prog.harga_quint, pd.harga_quint], ['harga_quad', adl.harga_quad, pd.harga_quad], ['harga_triple', adl.harga_triple, pd.harga_triple],
            ['harga_double', adl.harga_double, pd.harga_double], ['hotel_makkah', adl.hotel_makkah, pd.hotel_makkah], ['hotel_madinah', adl.hotel_madinah, pd.hotel_madinah],
        ];
        return pairs.filter(([field, a, b]) => a && b && !cxValuesMatch(field, a, b)).length;
    }

    function renderCxProgramSelector() {
        const sel = document.getElementById('cxProgramSelector');
        if (!sel) return;
        if (!adminPrograms || !adminPrograms.length) {
            sel.innerHTML = '<div style="font-size:13px;color:var(--text-3);font-style:italic;">Belum ada program.</div>';
            return;
        }
        sel.innerHTML = adminPrograms.map(p => {
            const adl = (() => { try { return p.admin_data_lengkap ? (typeof p.admin_data_lengkap === 'string' ? JSON.parse(p.admin_data_lengkap) : p.admin_data_lengkap) : null; } catch(e) { return null; } })();
            const hasData = adl && Object.keys(adl).length > 0;
            const isActive = String(cxSelectedProgram) === String(p.id);
            const isScanning = cxScanningIds.has(String(p.id));
            const mismatchCount = adl && adl.poster_data ? cxCountMismatch(p.id) : 0;
            return `<button class="cx-program-pill${isActive?' active':''}${mismatchCount>0?' has-warning':''}" onclick="selectCxProgram('${p.id}')">
                ${escapeHtml(p.nama||'Program')}
                ${isScanning ? '<i class="fas fa-spinner fa-spin" style="color:#1d4ed8;font-size:9px;margin-left:2px;" title="Sedang scan poster..."></i>' : ''}
                ${!isScanning && hasData ? '<i class="fas fa-circle-check" style="color:#86efac;font-size:9px;margin-left:2px;" title="Ada data lengkap"></i>' : ''}
                ${!isScanning && mismatchCount>0 ? `<i class="fas fa-triangle-exclamation cx-pill-warn" title="${mismatchCount} data tidak cocok"></i>` : ''}
            </button>`;
        }).join('');
        // Update badge
        const badge = document.getElementById('tabCountCrosscheck');
        if (badge) badge.textContent = adminPrograms.filter(p => p.admin_data_lengkap).length;
    }

    function selectCxProgram(id) {
        cxSelectedProgram = id;
        renderCxProgramSelector();
        renderCxPanel(id);
    }

    function renderCxPanel(progId) {
        const content = document.getElementById('cxPanelContent');
        if (!content) return;
        const prog = adminPrograms.find(p => String(p.id) === String(progId));
        if (!prog) {
            content.innerHTML = '<div class="cx-empty"><i class="fa-solid fa-magnifying-glass-chart"></i><p>Program tidak ditemukan.</p></div>';
            return;
        }
        const adl = (() => { try { return prog.admin_data_lengkap ? (typeof prog.admin_data_lengkap === 'string' ? JSON.parse(prog.admin_data_lengkap) : prog.admin_data_lengkap) : {}; } catch(e) { return {}; } })();
        const val = (v) => v ? escapeHtml(v) : '<span class="cx-value empty">—</span>';
        const hasAdl = Object.keys(adl).length > 0;
        const hasPoster = !!prog.link_poster;

        // Bangun rows perbandingan
        const buildCompareRows = () => {
            const rows = [
                { label: 'Nama Program',    plain: prog.nama,          poster: null, field: 'nama' },
                { label: 'Tanggal',         plain: prog.tgl,           poster: null, field: 'tgl' },
                { label: 'Durasi',          plain: prog.durasi,        poster: null, field: 'durasi' },
                { label: 'Maskapai',        plain: prog.maskapai,      poster: null, field: 'maskapai' },
                { label: 'Harga Quint',     plain: prog.harga_quint,   poster: null, field: 'harga_quint' },
                { label: 'Harga Quad',      plain: adl.harga_quad,     poster: null, field: 'harga_quad' },
                { label: 'Harga Triple',    plain: adl.harga_triple,   poster: null, field: 'harga_triple' },
                { label: 'Harga Double',    plain: adl.harga_double,   poster: null, field: 'harga_double' },
                { label: 'Hotel Makkah',    plain: adl.hotel_makkah,   poster: null, field: 'hotel_makkah' },
                { label: 'Hotel Madinah',   plain: adl.hotel_madinah,  poster: null, field: 'hotel_madinah' },
            ];
            // Baca data poster (dari adl.poster_data jika sudah disimpan)
            const pd = (() => { try { return adl.poster_data ? (typeof adl.poster_data === 'string' ? JSON.parse(adl.poster_data) : adl.poster_data) : {}; } catch(e) { return {}; } })();
            rows.forEach(r => { if (pd[r.field]) r.poster = pd[r.field]; });

            return rows.map(r => {
                const hasBoth = r.plain && r.poster;
                const dateInfo = (r.field === 'tgl' && hasBoth) ? cxDatesCompare(r.plain, r.poster) : null;
                const isMatch = hasBoth && (dateInfo ? dateInfo.match : cxValuesMatch(r.field, r.plain, r.poster));
                const showNote = dateInfo && dateInfo.match && !dateInfo.exact;
                const rowClass = hasBoth ? (isMatch ? 'cx-match' : 'cx-mismatch') : '';
                const pill = hasBoth ? `<span class="cx-match-pill ${isMatch?'ok':'no'}">${isMatch?'✓ Cocok':'✗ Beda'}</span>` : `<span class="cx-match-pill skip">—</span>`;
                return `<div class="cx-compare-row ${rowClass}">
                    <div class="cx-compare-col">
                        <div class="cx-compare-label"><i class="fas fa-file-text" style="margin-right:3px;font-size:8px;"></i>Teks Plain</div>
                        <div class="cx-compare-val ${r.plain?'':'empty'}">${r.plain ? escapeHtml(r.plain) : '—'}</div>
                    </div>
                    <div class="cx-divider"></div>
                    <div class="cx-compare-col">
                        <div class="cx-compare-label"><i class="fas fa-image" style="margin-right:3px;font-size:8px;"></i>Poster</div>
                        <div class="cx-compare-val ${r.poster?'':'empty'}">${r.poster ? escapeHtml(r.poster) : '—'}</div>
                    </div>
                    <div style="display:flex;align-items:center;padding-left:8px;">
                        <div class="cx-compare-label" style="margin-bottom:4px;text-align:center;min-width:60px;">${escapeHtml(r.label)}</div>
                    </div>
                    ${pill}
                    ${showNote ? `<div style="flex-basis:100%;font-size:11px;color:#a16207;background:#fefce8;border:1px solid #fde68a;border-radius:5px;padding:4px 8px;margin-top:6px;"><i class="fas fa-circle-info" style="margin-right:4px;"></i>Catatan: salah satu sumber pakai rentang tanggal, satunya tanggal tunggal — tetap dianggap cocok selama tanggalnya termasuk dalam rentang tersebut.</div>` : ''}
                </div>`;
            }).join('');
        };

        const isScanning = cxScanningIds.has(String(progId));
        const mismatchCount = adl.poster_data ? cxCountMismatch(progId) : 0;
        const posterSource = adl.poster_data_source === 'ocr' ? 'ocr' : (adl.poster_data ? 'manual' : null);

        content.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
            <div style="font-size:14px;font-weight:700;color:#5b21b6;">${escapeHtml(prog.nama||'Program')}</div>
            <div style="display:flex;gap:8px;align-items:center;">
                ${mismatchCount > 0 ? `<span class="cx-mismatch-count"><i class="fas fa-triangle-exclamation"></i> ${mismatchCount} tidak cocok</span>` : ''}
                <button class="cx-parse-btn" onclick="openCxEditModal('${prog.id}')"><i class="fas fa-edit"></i> Input Manual</button>
                ${hasPoster ? `<button class="cx-parse-btn" onclick="autoScanPosterForProgram('${prog.id}')" ${isScanning?'disabled':''}><i class="fas fa-${isScanning?'spinner fa-spin':'arrows-rotate'}"></i> ${isScanning?'Memindai...':'Scan Ulang Poster'}</button>` : ''}
                ${hasPoster ? `<button class="cx-parse-btn" onclick="window.open('${escapeHtml(prog.link_poster)}','_blank')"><i class="fas fa-image"></i> Lihat Poster</button>` : ''}
            </div>
        </div>

        <!-- Status banner -->
        ${isScanning ? `
        <div class="cx-status-bar scanning">
            <i class="fas fa-spinner"></i>
            <div style="flex:1;">
                <div>Membaca poster otomatis dengan AI (Gemini Vision)... bisa sampai ±20 detik jika server AI sedang sibuk (otomatis dicoba ulang).</div>
                <div class="cx-ocr-progress-wrap"><div class="cx-ocr-progress-bar" id="cxOcrBar_${progId}" style="width:${cxOcrProgress[progId]||0}%;"></div></div>
            </div>
        </div>
        ` : `
        <div class="cx-status-bar ${mismatchCount > 0 ? 'warn' : (hasAdl ? 'ok' : 'missing')}">
            <i class="fas fa-${mismatchCount > 0 ? 'triangle-exclamation' : (hasAdl ? 'circle-check' : 'circle-info')}"></i>
            ${mismatchCount > 0
                ? `Ditemukan <b>${mismatchCount} field</b> yang tidak cocok antara teks plain & poster. Periksa tabel perbandingan di bawah.`
                : (hasAdl ? 'Data lengkap tersedia. ' + (adl.poster_data ? 'Data poster sudah terbaca — semua cocok, lihat perbandingan di bawah.' : (hasPoster ? 'Poster akan dibaca otomatis saat program disimpan, atau klik <b>Scan Ulang Poster</b>.' : 'Belum ada link poster.')) : 'Belum ada data lengkap. Paste teks plain di form tambah/edit program lalu simpan.')
            }
            ${posterSource ? `<span class="cx-source-tag ${posterSource}">${posterSource === 'ocr' ? 'Sumber: AI Vision (otomatis)' : 'Sumber: Input manual'}</span>` : ''}
        </div>
        `}

        <!-- Data dari teks plain -->
        <div class="cx-section-title"><i class="fas fa-file-lines"></i> Data dari Teks Plain (Konsep)</div>
        <div class="cx-grid">
            <div class="cx-block">
                <div class="cx-block-header"><i class="fas fa-tag"></i> Harga</div>
                <div class="cx-block-body">
                    <div class="cx-field"><div class="cx-label">Quint (5 org)</div><div class="cx-value">${val(prog.harga_quint)}</div></div>
                    <div class="cx-field"><div class="cx-label">Quad (4 org)</div><div class="cx-value">${val(adl.harga_quad)}</div></div>
                    <div class="cx-field"><div class="cx-label">Triple (3 org)</div><div class="cx-value">${val(adl.harga_triple)}</div></div>
                    <div class="cx-field"><div class="cx-label">Double (2 org)</div><div class="cx-value">${val(adl.harga_double)}</div></div>
                </div>
            </div>
            <div class="cx-block">
                <div class="cx-block-header"><i class="fas fa-hotel"></i> Hotel & Konsumsi</div>
                <div class="cx-block-body">
                    <div class="cx-field"><div class="cx-label">Hotel Makkah</div><div class="cx-value">${val(adl.hotel_makkah)}</div></div>
                    <div class="cx-field"><div class="cx-label">Hotel Madinah</div><div class="cx-value">${val(adl.hotel_madinah)}</div></div>
                    <div class="cx-field"><div class="cx-label">Makan Makkah</div><div class="cx-value">${val(adl.makan_makkah)}</div></div>
                    <div class="cx-field"><div class="cx-label">Makan Madinah</div><div class="cx-value">${val(adl.makan_madinah)}</div></div>
                </div>
            </div>
            <div class="cx-block" style="grid-column:1/-1;">
                <div class="cx-block-header"><i class="fas fa-circle-check" style="color:#16a34a;"></i> Termasuk dalam Paket</div>
                <div class="cx-block-body"><div class="cx-value area">${adl.termasuk ? escapeHtml(adl.termasuk) : '<span class="empty" style="color:var(--text-3);font-style:italic;">Belum diisi</span>'}</div></div>
            </div>
            <div class="cx-block" style="grid-column:1/-1;">
                <div class="cx-block-header"><i class="fas fa-circle-xmark" style="color:#dc2626;"></i> Tidak Termasuk</div>
                <div class="cx-block-body"><div class="cx-value area">${adl.tidak_termasuk ? escapeHtml(adl.tidak_termasuk) : '<span class="empty" style="color:var(--text-3);font-style:italic;">Belum diisi</span>'}</div></div>
            </div>
            ${adl.catatan_cx ? `<div class="cx-block" style="grid-column:1/-1;">
                <div class="cx-block-header"><i class="fas fa-note-sticky"></i> Catatan Admin</div>
                <div class="cx-block-body"><div class="cx-value area">${escapeHtml(adl.catatan_cx)}</div></div>
            </div>` : ''}
        </div>

        <!-- Perbandingan dengan poster -->
        ${adl.poster_data ? `
        <div class="cx-section-title" style="margin-top:20px;"><i class="fas fa-code-compare"></i> Perbandingan: Teks Plain vs Poster</div>
        <div style="font-size:12px;color:var(--text-3);margin-bottom:10px;"><i class="fas fa-circle-check" style="color:#86efac;"></i> Hijau = cocok &nbsp; <i class="fas fa-circle-xmark" style="color:#fca5a5;"></i> Merah = tidak sesuai${posterSource==='ocr' ? ' &nbsp; · &nbsp; Hasil OCR bisa salah baca — jika ada yang keliru, klik <b>Input Manual</b> untuk mengoreksi.' : ''}</div>
        ${buildCompareRows()}
        ` : ''}
        `;
    }

    // Modal untuk input data poster (untuk crosscheck)
    function openCxEditModal(progId) {
        const prog = adminPrograms.find(p => String(p.id) === String(progId));
        if (!prog) return;
        const adl = (() => { try { return prog.admin_data_lengkap ? (typeof prog.admin_data_lengkap === 'string' ? JSON.parse(prog.admin_data_lengkap) : prog.admin_data_lengkap) : {}; } catch(e) { return {}; } })();
        const pd = adl.poster_data || {};

        // Buat modal dinamis
        let modal = document.getElementById('cxEditModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'cxEditModal';
            modal.style.cssText = 'display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:40000;overflow-y:auto;padding:24px;backdrop-filter:blur(4px);';
            document.body.appendChild(modal);
        }
        const fields = [
            { key: 'nama',          label: 'Nama Program',  val: pd.nama    || prog.nama    || '' },
            { key: 'tgl',           label: 'Tanggal',       val: pd.tgl     || prog.tgl     || '' },
            { key: 'durasi',        label: 'Durasi',        val: pd.durasi  || prog.durasi  || '' },
            { key: 'maskapai',      label: 'Maskapai',      val: pd.maskapai|| prog.maskapai|| '' },
            { key: 'harga_quint',   label: 'Harga Quint',   val: pd.harga_quint  || prog.harga_quint  || '' },
            { key: 'harga_quad',    label: 'Harga Quad',    val: pd.harga_quad   || adl.harga_quad    || '' },
            { key: 'harga_triple',  label: 'Harga Triple',  val: pd.harga_triple || adl.harga_triple  || '' },
            { key: 'harga_double',  label: 'Harga Double',  val: pd.harga_double || adl.harga_double  || '' },
            { key: 'hotel_makkah',  label: 'Hotel Makkah',  val: pd.hotel_makkah || adl.hotel_makkah  || '' },
            { key: 'hotel_madinah', label: 'Hotel Madinah', val: pd.hotel_madinah|| adl.hotel_madinah || '' },
        ];

        modal.innerHTML = `
        <div style="max-width:600px;width:100%;background:#fff;border-radius:var(--radius-lg);overflow:hidden;box-shadow:var(--shadow-lg);margin:0 auto;animation:modalFadeIn .25s ease;">
            <div style="background:linear-gradient(135deg,#7c3aed,#5b21b6);color:#fff;padding:18px 22px;display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <div style="font-size:16px;font-weight:700;">Input Data Poster</div>
                    <div style="font-size:11.5px;opacity:.8;margin-top:3px;">Ketik data yang tampil di poster untuk crosscheck</div>
                </div>
                <button onclick="document.getElementById('cxEditModal').style.display='none'" style="background:rgba(255,255,255,0.15);border:none;color:#fff;font-size:20px;cursor:pointer;width:34px;height:34px;border-radius:6px;">×</button>
            </div>
            <div style="padding:20px;">
                <div style="background:#faf5ff;border:1px solid #ede9fe;border-radius:6px;padding:12px 14px;margin-bottom:16px;font-size:12.5px;color:#5b21b6;display:flex;gap:8px;align-items:flex-start;">
                    <i class="fas fa-circle-info" style="margin-top:1px;flex-shrink:0;"></i>
                    <span>Arahkan pointer ke nama program untuk melihat poster, lalu ketik/koreksi data yang tertera di poster ke kolom di bawah ini.</span>
                </div>
                ${adl.poster_data_source === 'ocr' && pd._raw_ocr_text ? `
                <details style="margin-bottom:16px;">
                    <summary style="cursor:pointer;font-size:12px;font-weight:700;color:#7c3aed;">📄 Lihat teks mentah hasil OCR (untuk bantu koreksi)</summary>
                    <div style="margin-top:8px;background:#f8fafc;border:1px solid var(--border);border-radius:6px;padding:10px;font-size:11.5px;color:var(--text-2);white-space:pre-wrap;max-height:140px;overflow-y:auto;">${escapeHtml(pd._raw_ocr_text)}</div>
                </details>
                ` : ''}
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                    ${fields.map(f => `
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        <label style="font-size:10.5px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.4px;">${escapeHtml(f.label)}</label>
                        <input type="text" id="cxp_${f.key}" value="${escapeHtml(f.val)}" style="padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:inherit;" placeholder="Dari poster...">
                    </div>`).join('')}
                </div>
                <div style="display:flex;gap:8px;margin-top:18px;">
                    <button class="cx-save-btn" onclick="saveCxPosterData('${prog.id}')"><i class="fas fa-save"></i> Simpan & Bandingkan</button>
                    <button class="cx-parse-btn" onclick="document.getElementById('cxEditModal').style.display='none'">Batal</button>
                </div>
            </div>
        </div>`;
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
    }

    async function saveCxPosterData(progId) {
        const prog = adminPrograms.find(p => String(p.id) === String(progId));
        if (!prog) return;
        const adl = (() => { try { return prog.admin_data_lengkap ? (typeof prog.admin_data_lengkap === 'string' ? JSON.parse(prog.admin_data_lengkap) : prog.admin_data_lengkap) : {}; } catch(e) { return {}; } })();
        const keys = ['nama','tgl','durasi','maskapai','harga_quint','harga_quad','harga_triple','harga_double','hotel_makkah','hotel_madinah'];
        const pd = {};
        keys.forEach(k => {
            const el = document.getElementById('cxp_' + k);
            if (el && el.value.trim()) pd[k] = el.value.trim();
        });
        adl.poster_data = pd;
        adl.poster_data_source = 'manual';
        adl.poster_scanned_at = new Date().toISOString();
        adl.poster_scanned_link = prog.link_poster; // dipakai untuk deteksi "poster berganti" di saveAdminProgram
        try {
            await updateProgramById(progId, { admin_data_lengkap: JSON.stringify(adl) });
            // Update local
            const idx = adminPrograms.findIndex(p => String(p.id) === String(progId));
            if (idx >= 0) adminPrograms[idx].admin_data_lengkap = JSON.stringify(adl);
            document.getElementById('cxEditModal').style.display = 'none';
            renderCxProgramSelector();
            renderCxPanel(progId);
            showToast('✅ Data poster disimpan — crosscheck siap!');
        } catch(err) {
            showToast('❌ Gagal simpan: ' + err.message);
        }
    }

    window.selectCxProgram = selectCxProgram;
    window.openCxEditModal = openCxEditModal;
    window.saveCxPosterData = saveCxPosterData;
    // ========== END CROSSCHECK ==========
    (async () => {
        await loadUserRoles();
        await loadJadwal();
        renderJadwalSection();
        await loadKbJamaah();
        await loadFeaturedIds();
        await loadDataFromSupabase();
        // Cek & kirim pengingat program ≤ 30 hari setelah data loaded
        setTimeout(() => checkAndSendReminders(), 2000);
    })();
