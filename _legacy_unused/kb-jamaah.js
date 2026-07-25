    const MARKETING_QUOTES = [
        "Setiap follow-up hari ini adalah peluang closing besok.",
        "Calon jamaah tidak butuh paket termurah, mereka butuh kepercayaan — bangun itu dulu.",
        "Konsisten posting lebih penting daripada posting sempurna.",
        "Satu pesan WA yang ramah bisa mengubah peluang jadi closing.",
        "Target itu bukan beban, target itu arah supaya kerja kita nggak nyasar.",
        "Jamaah yang puas adalah marketing terbaik yang gratis.",
        "Jangan tunggu mood, tunggu hasil — mood ikut belakangan.",
        "Closing satu jamaah hari ini, lebih baik dari nunggu closing besar besok.",
        "Respon cepat ke calon jamaah = kesan profesional yang mahal harganya.",
        "Rezeki rombongan dimulai dari satu pertanyaan yang dijawab dengan sabar.",
        "Tim hebat bukan yang paling sibuk, tapi yang paling konsisten followup.",
        "Setiap penolakan hari ini, latihan supaya closing besok lebih lancar.",
    ];
    function getGreetingByHour(hour) {
        if (hour >= 4 && hour < 11) return "Selamat Pagi";
        if (hour >= 11 && hour < 15) return "Selamat Siang";
        if (hour >= 15 && hour < 18) return "Selamat Sore";
        return "Selamat Malam";
    }
    function buildInfoBarText({ lokasi, suhu, cuacaText, tanggalStr, greeting, quote }) {
        const parts = [];
        if (lokasi) parts.push(`📍 ${lokasi}`);
        if (suhu != null) parts.push(`🌡️ ${suhu}°C${cuacaText ? ' · ' + cuacaText : ''}`);
        parts.push(`📅 ${tanggalStr}`);
        parts.push(`👋 ${greeting}, Tim!`);
        const mainLine = parts.join(' <span class="sep">|</span> ');
        const quotePart = `<span class="ib-quote-sep"> <span class="sep">|</span> <span class="ib-quote">💡 "${quote}"</span></span>`;
        return mainLine + quotePart;
    }
    // Mapping kode cuaca Open-Meteo (WMO) ke teks singkat Bahasa Indonesia
    function weatherCodeToText(code) {
        const map = {
            0: "Cerah", 1: "Cerah Berawan", 2: "Berawan Sebagian", 3: "Berawan",
            45: "Berkabut", 48: "Berkabut", 51: "Gerimis Ringan", 53: "Gerimis", 55: "Gerimis Lebat",
            61: "Hujan Ringan", 63: "Hujan", 65: "Hujan Lebat", 66: "Hujan Es Ringan", 67: "Hujan Es Lebat",
            71: "Salju Ringan", 73: "Salju", 75: "Salju Lebat", 80: "Hujan Lokal", 81: "Hujan Lokal Lebat",
            82: "Hujan Lokal Sangat Lebat", 95: "Badai Petir", 96: "Badai Petir + Hujan Es", 99: "Badai Petir Hebat"
        };
        return map[code] || "Cerah Berawan";
    }
    // ========== INFO BAR TOGGLE ==========
    // Status disimpan di Supabase tabel tg_config (key: 'infobar_enabled'), berlaku global untuk semua pengunjung
    async function loadInfobarSetting() {
        try {
            const { data, error } = await supabaseClient.from('tg_config').select('value').eq('key', 'infobar_enabled').single();
            infobarEnabled = (error || !data) ? true : data.value !== 'false';
        } catch (_) {
            infobarEnabled = true;
        }
        applyInfobarVisibility();
    }
    function applyInfobarVisibility() {
        const wrapper = document.querySelector('.infobar-wrapper');
        if (wrapper) wrapper.style.display = infobarEnabled ? '' : 'none';
    }
    async function toggleInfobarEnabled() {
        const newVal = !infobarEnabled;
        const btn = document.getElementById('infobarToggleBtn');
        if (btn) { btn.disabled = true; }
        try {
            const { error } = await supabaseClient.from('tg_config').upsert([{ key: 'infobar_enabled', value: String(newVal) }], { onConflict: 'key' });
            if (error) throw error;
            infobarEnabled = newVal;
            applyInfobarVisibility();
            if (infobarEnabled) initInfoBar();
            if (btn) {
                btn.className = 'featured-toggle-btn ' + (infobarEnabled ? 'on' : 'off');
                btn.innerHTML = `<i class="fas fa-power-off"></i> ${infobarEnabled ? 'Aktif' : 'Nonaktif'}`;
            }
            showToast(infobarEnabled ? '✅ Info bar diaktifkan' : '🚫 Info bar dinonaktifkan');
        } catch (err) {
            showToast('❌ Gagal menyimpan pengaturan: ' + (err?.message || err));
        } finally {
            if (btn) { btn.disabled = false; }
        }
    }
    window.toggleInfobarEnabled = toggleInfobarEnabled;
    // ========== END INFO BAR TOGGLE ==========

    async function initInfoBar() {
        await loadInfobarSetting();
        if (!infobarEnabled) return;
        const el = document.getElementById('infoBar');
        if (!el) return;
        const now = new Date();
        const tanggalStr = formatDateToIndonesian ? formatDateToIndonesian(now) : now.toLocaleDateString('id-ID');
        const greeting = getGreetingByHour(now.getHours());
        const quote = MARKETING_QUOTES[Math.floor(Math.random() * MARKETING_QUOTES.length)];

        // Render dulu versi tanpa cuaca/lokasi supaya bar langsung tampil, baru disempurnakan setelah fetch
        el.innerHTML = buildInfoBarText({ lokasi: null, suhu: null, cuacaText: null, tanggalStr, greeting, quote });

        try {
            // Deteksi lokasi pengunjung via IP — layanan gratis, tanpa API key
            const geoRes = await fetch('https://ipapi.co/json/');
            if (!geoRes.ok) throw new Error('geo fetch gagal');
            const geo = await geoRes.json();
            const lat = geo.latitude, lon = geo.longitude;
            const kota = geo.city || geo.region || '-';
            const provinsi = geo.region || '';
            const lokasi = provinsi && provinsi !== kota ? `${kota}, ${provinsi}` : kota;

            if (lat != null && lon != null) {
                const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
                if (wRes.ok) {
                    const wData = await wRes.json();
                    const suhu = wData?.current_weather?.temperature != null ? Math.round(wData.current_weather.temperature) : null;
                    const cuacaText = weatherCodeToText(wData?.current_weather?.weathercode);
                    el.innerHTML = buildInfoBarText({ lokasi, suhu, cuacaText, tanggalStr, greeting, quote });
                    return;
                }
            }
            // Kalau cuaca gagal tapi lokasi berhasil, tetap tampilkan lokasi
            el.innerHTML = buildInfoBarText({ lokasi, suhu: null, cuacaText: null, tanggalStr, greeting, quote });
        } catch (err) {
            // Gagal total (mis. offline / IP lokal) — tetap tampilkan tanggal, salam & quote
            el.innerHTML = buildInfoBarText({ lokasi: null, suhu: null, cuacaText: null, tanggalStr, greeting, quote });
        }
    }
    // ========== END INFO BAR ==========

    function renderStats() { const now = new Date(); const visible = dataUmroh.filter(p=>p.is_active!==false); const total = visible.length, active = visible.filter(i=>i.dateObj>=now).length, past = total-active; document.getElementById('statsRow') && (document.getElementById('statsRow').innerHTML = `<span class="stat-chip total"><i class="fa-solid fa-layer-group"></i> ${total} Paket</span><span class="stat-chip active"><i class="fa-solid fa-circle-check"></i> ${active} Tersedia</span><span class="stat-chip inactive"><i class="fa-solid fa-clock-rotate-left"></i> ${past} Expired</span>`); }
    function initTicker() { const now = new Date(); const active = dataUmroh.filter(i=>i.is_active!==false && i.dateObj>=now).map(i=>`✨ ${escapeHtml(i.nama)} — ${escapeHtml(i.tgl)} (${escapeHtml(i.maskapai)})`).join(' &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; '); const ticker = document.getElementById('navTicker'); ticker && (ticker.innerHTML = active || "PT Amiru Haramain Indonesia."); applyTickerVisibility(); }

    // ========== RUNNING TEXT (TICKER) TOGGLE ==========
    // Status disimpan di Supabase tabel tg_config (key: 'ticker_enabled'), berlaku global untuk semua pengunjung
    async function loadTickerSetting() {
        try {
            const { data, error } = await supabaseClient.from('tg_config').select('value').eq('key', 'ticker_enabled').single();
            tickerEnabled = (error || !data) ? true : data.value !== 'false';
        } catch (_) {
            tickerEnabled = true;
        }
        applyTickerVisibility();
    }
    function applyTickerVisibility() {
        const wrapper = document.querySelector('.ticker-wrapper');
        if (wrapper) wrapper.style.display = tickerEnabled ? '' : 'none';
    }
    async function toggleTickerEnabled() {
        const newVal = !tickerEnabled;
        const btn = document.getElementById('tickerToggleBtn');
        if (btn) { btn.disabled = true; }
        try {
            const { error } = await supabaseClient.from('tg_config').upsert([{ key: 'ticker_enabled', value: String(newVal) }], { onConflict: 'key' });
            if (error) throw error;
            tickerEnabled = newVal;
            applyTickerVisibility();
            if (btn) {
                btn.className = 'featured-toggle-btn ' + (tickerEnabled ? 'on' : 'off');
                btn.innerHTML = `<i class="fas fa-power-off"></i> ${tickerEnabled ? 'Aktif' : 'Nonaktif'}`;
            }
            showToast(tickerEnabled ? '✅ Running text diaktifkan' : '🚫 Running text dinonaktifkan');
        } catch (err) {
            showToast('❌ Gagal menyimpan pengaturan: ' + (err?.message || err));
        } finally {
            if (btn) { btn.disabled = false; }
        }
    }
    window.toggleTickerEnabled = toggleTickerEnabled;
    // ========== END RUNNING TEXT TOGGLE ==========

