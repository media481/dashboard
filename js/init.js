    (async () => {
        initInfoBar();
        loadTickerSetting();
        await loadUserRoles();
        await loadJadwal();
        renderJadwalSection();
        await loadKbJamaah();
        await loadFeaturedIds();
        await loadDataFromSupabase();
        // Cek & kirim pengingat program ≤ 30 hari setelah data loaded
        setTimeout(() => checkAndSendReminders(), 2000);
    })();
