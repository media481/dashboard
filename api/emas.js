// api/emas.js — Vercel Serverless Function
// Proxy untuk emas.maulanar.my.id agar terhindar dari CORS di browser

export default async function handler(req, res) {
    // Izinkan hanya dari origin Sinarkeu
    const allowedOrigins = [
        'https://sinarkeu.vercel.app',
        'http://localhost:3000',
        'http://127.0.0.1:5500',
    ];
    const origin = req.headers.origin || '';
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        res.setHeader('Access-Control-Allow-Origin', 'https://sinarkeu.vercel.app');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');

    // Tangani preflight OPTIONS
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const apiKey = req.headers['x-api-key'] || '';
    if (!apiKey) {
        return res.status(400).json({ error: 'X-API-Key header wajib diisi' });
    }

    try {
        const upstream = await fetch(
            'https://emas.maulanar.my.id/api/prices/brand/antam?limit=1',
            {
                headers: {
                    'X-API-Key': apiKey,
                    'Accept': 'application/json',
                },
            }
        );

        const data = await upstream.json();

        if (!upstream.ok) {
            return res.status(upstream.status).json({ error: 'Upstream error', detail: data });
        }

        // Catatan: caching utama untuk menghemat kuota (20 hit/bulan) dilakukan di
        // client (localStorage, lihat js/forex.js EMAS_CACHE_HOURS). Header ini hanya
        // cadangan tambahan di edge Vercel, bukan andalan utama.
        res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=300');
        return res.status(200).json(data);
    } catch (err) {
        return res.status(502).json({ error: 'Gagal menghubungi server emas', message: err.message });
    }
}
