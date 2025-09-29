const fetch = require('node-fetch');
const { URL } = require('url');

// ... (الثوابت والدوال المساعدة تبقى كما هي)
const USER_AGENTS = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36", "VLC/3.0.20 LibVLC/3.0.20", "okhttp/4.9.3", "com.google.android.exoplayer2/2.18.1"];
const CORS_HEADERS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'Range, User-Agent, X-Requested-With, Content-Type', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range', 'Access-Control-Allow-Credentials': 'true'};
function generateRandomPublicIp() { const firstOctet = Math.floor(Math.random() * 223) + 1; if ([10, 127, 172, 192].includes(firstOctet)) { return generateRandomPublicIp(); } return `${firstOctet}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`; }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async (req, res) => {
    Object.entries(CORS_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
    if (req.method === 'OPTIONS') return res.status(204).end();

    // ... (الجزء الخاص بـ isMaster يبقى كما هو)
    if (req.query.isMaster === 'true') {
        const streamUrl = 'http://111g1u0paira.maxplayer4k.org:2052/live/17415748956629/27133616434229/391.m3u8';
        const origin = `https://${req.headers.host}`;
        const streamURLviaProxy = `${origin}/proxy/${encodeURIComponent(streamUrl)}`;
        const masterPlaylist = `#EXTM3U\n#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=5000000,RESOLUTION=1920x1080,NAME="FHD"\n${streamURLviaProxy}`;
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        return res.status(200).send(masterPlaylist);
    }

    const targetUrlString = req.query.target;
    if (targetUrlString) {
        try {
            let currentUrl = targetUrlString;
            let response;
            const maxRetries = 3;

            // *** بداية التغيير الجذري ***
            // حلقة للتعامل مع إعادة التوجيه يدويًا داخل الخادم
            for (let i = 0; i < maxRetries; i++) {
                const url = new URL(currentUrl);
                const requestHeaders = {};
                requestHeaders['User-Agent'] = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
                requestHeaders['X-Forwarded-For'] = generateRandomPublicIp();
                requestHeaders['X-Real-IP'] = requestHeaders['X-Forwarded-For'];
                requestHeaders['Origin'] = url.origin;
                requestHeaders['Referer'] = url.origin + '/';
                requestHeaders['Host'] = url.host;

                response = await fetch(currentUrl, {
                    method: 'GET',
                    headers: requestHeaders,
                    redirect: 'manual', // مهم جدًا
                    signal: AbortSignal.timeout(8000)
                });

                // إذا كانت الاستجابة إعادة توجيه، قم بتحديث الرابط وكرر الحلقة
                if (response.status >= 300 && response.status < 400) {
                    const location = response.headers.get('Location');
                    if (location) {
                        currentUrl = new URL(location, currentUrl).toString();
                        continue; // اذهب إلى المحاولة التالية بالرابط الجديد
                    }
                }
                
                // إذا لم تكن إعادة توجيه، اخرج من الحلقة
                break;
            }
            // *** نهاية التغيير الجذري ***

            if (!response) return res.status(502).send('Failed to fetch from origin.');

            res.setHeader('Cache-Control', 'public, s-maxage=3, max-age=3, stale-while-revalidate=3');

            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('mpegurl')) {
                res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
                let body = await response.text();
                const baseUrl = new URL(currentUrl); // استخدم الرابط الأخير كأساس
                const origin = `https://${req.headers.host}`;

                body = body.replace(/^(https?:\/\/[^\s]+)$/gm, line => `${origin}/proxy/${encodeURIComponent(line)}`);
                body = body.replace(/^([^\s#].*)$/gm, line => `${origin}/proxy/${encodeURIComponent(new URL(line, baseUrl).toString())}`);
                
                return res.status(response.status).send(body);
            }

            // تمرير المحتوى مباشرة
            response.headers.forEach((value, name) => {
                if (!['content-encoding', 'transfer-encoding'].includes(name.toLowerCase())) {
                    res.setHeader(name, value);
                }
            });
            res.status(response.status);
            response.body.pipe(res);

        } catch (error) {
            console.error(error);
            res.status(500).send(`Proxy error: ${error.message}`);
        }
    } else {
        res.status(404).send('Not Found');
    }
};
