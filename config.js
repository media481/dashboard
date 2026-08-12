    // ========== SUPABASE CONFIG ==========
    const SUPABASE_URL = "https://vlrizloxsjejcfuxuyju.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZscml6bG94c2plamNmdXh1eWp1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxOTE1NjMsImV4cCI6MjEwMTc2NzU2M30.hO5LGq4CwiZDG4hxU2cEB1nNaVdpJ5NepPZLIIA1fig";
    const MASKAPAI_LIST = ["Oman Air","Saudia Airlines","Lion Air","Garuda Indonesia","Emirates","Qatar Airways","Etihad Airways","Malindo Air","Air Asia","IndiGo"];
    const CACHE_KEY = 'amiru_cached_data';
    const CACHE_TIME_KEY = 'amiru_cache_time';
    const CACHE_DURATION = 300000;
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
