const fetch = require('node-fetch');
const { URL } = require('url');

// متغير لتخزين عنوان آخر مقطع فيديو تم تسليمه بنجاح
let lastDeliveredSegmentUrl = null;

const USER_AGENTS = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36", "VLC/3.0.20 LibVLC/3.0.20", "okhttp/4.9.3", "com.google.android.exoplayer2/2.18.1"];
const CORS_HEADERS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'Range, User-Agent, X-Requested-With, Content-Type', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range', 'Access-Control-Allow-Credentials': 'true'};
function generateRandomPublicIp() { const firstOctet = Math.floor(Math.random() * 223) + 1; if ([10, 127, 172, 192].includes(firstOctet)) { return generateRandomPublicIp(); } return `${firstOctet}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`; }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// --- دالة مساعدة لجلب المحتوى مع إعادة المحاولة ---
async function fetchWithRetries(url, options, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.ok) return response;
            // التعامل مع إعادة التوجيه
            if (response.status >= 300 && response.status < 400) {
                const location = response.headers.get('Location');
                if (location) {
                    return fetchWithRetries(new URL(location, url).toString(), options, maxRetries - i - 1);
                }
            }
        } catch (error) {
            console.error(`[FETCH] Attempt ${i + 1} for ${url} failed: ${error.message}`);
            if (i < maxRetries - 1) await delay(200 * (i + 1));
        }
    }
    return null;
}

module.exports = async (req, res) => {
    Object.entries(CORS_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
    if (req.method === 'OPTIONS') return res.status(204).end();

    let targetUrlString = req.query.target || (req.url.startsWith('/proxy/') ? decodeURIComponent(req.url.substring('/proxy/'.length)) : null);
    const playlistUrl = req.query.playlist; // رابط قائمة التشغيل الأصلية

    if (req.query.isMaster === 'true') {
        const streamUrl = 'http://111g1u0paira.maxplayer4k.org:2052/live/17415748956629/27133616434229/194472.m3u8';
        const origin = `https://${req.headers.host}`;
        const streamURLviaProxy = `${origin}/proxy/${encodeURIComponent(streamUrl)}?playlist=${encodeURIComponent(streamUrl)}`;
        const masterPlaylist = `#EXTM3U\n#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=5000000,RESOLUTION=1920x1080,NAME="FHD"\n${streamURLviaProxy}`;
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        return res.status(200).send(masterPlaylist);
    }

    if (!targetUrlString) {
        return res.status(404).send('Not Found: Target URL is required.');
    }

    try {
        let currentUrl = targetUrlString;
        const isTsSegment = currentUrl.endsWith('.ts');

        // --- بداية منطق الانتظار الذكي ---
        if (isTsSegment && currentUrl === lastDeliveredSegmentUrl && playlistUrl) {
            console.log(`[PROXY] Duplicate segment detected: ${currentUrl}. Starting smart wait...`);
            let newSegmentUrlFound = false;
            for (let waitAttempt = 0; waitAttempt < 15; waitAttempt++) { // انتظر 3 ثوانٍ كحد أقصى
                await delay(200); // انتظر 200 ميلي ثانية
                const playlistResponse = await fetch(playlistUrl);
                if (playlistResponse.ok) {
                    const playlistBody = await playlistResponse.text();
                    const segmentUrls = playlistBody.match(/^https?:\/\/.+\.ts$/gm) || playlistBody.match(/^[^#\n].+\.ts$/gm);
                    if (segmentUrls && segmentUrls.length > 0) {
                        const lastSegmentInPlaylist = new URL(segmentUrls[segmentUrls.length - 1], playlistUrl).toString();
                        if (lastSegmentInPlaylist !== currentUrl) {
                            console.log(`[PROXY] New segment found: ${lastSegmentInPlaylist}. Proceeding.`);
                            currentUrl = lastSegmentInPlaylist; // تحديث الرابط المطلوب
                            newSegmentUrlFound = true;
                            break;
                        }
                    }
                }
            }
            if (!newSegmentUrlFound) {
                console.error(`[PROXY] Failed to find a new segment after waiting. Aborting request for ${currentUrl}`);
                return res.status(504).send('Gateway Timeout: Could not retrieve a new segment from origin.');
            }
        }
        // --- نهاية منطق الانتظار الذكي ---

        const url = new URL(currentUrl);
        const requestHeaders = {
            'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
            'X-Forwarded-For': generateRandomPublicIp(),
            'Origin': url.origin,
            'Referer': url.origin + '/',
            'Host': url.host
        };
        requestHeaders['X-Real-IP'] = requestHeaders['X-Forwarded-For'];

        const response = await fetchWithRetries(currentUrl, { method: 'GET', headers: requestHeaders, signal: AbortSignal.timeout(4000) });

        if (!response || !response.ok) {
            return res.status(502).send('Failed to fetch from origin after all retries.');
        }

        if (isTsSegment) {
            lastDeliveredSegmentUrl = currentUrl; // تحديث الذاكرة بعد التسليم الناجح
        }

        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('mpegurl')) {
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            let body = await response.text();
            const baseUrl = new URL(currentUrl);
            const origin = `https://${req.headers.host}`;
            const proxyPrefix = `${origin}/proxy/`;

            // تعديل الروابط لتمر عبر البروكسي مع تمرير رابط قائمة التشغيل
            body = body.replace(/^(https?:\/\/[^\s]+)$/gm, line => `${proxyPrefix}${encodeURIComponent(line)}?playlist=${encodeURIComponent(currentUrl)}`);
            body = body.replace(/^([^\s#].*)$/gm, line => `${proxyPrefix}${encodeURIComponent(new URL(line, baseUrl).toString())}?playlist=${encodeURIComponent(currentUrl)}`);
            
            return res.status(response.status).send(body);
        }

        response.headers.forEach((value, name) => {
            if (!['content-encoding', 'transfer-encoding', 'cache-control', 'pragma', 'expires'].includes(name.toLowerCase())) {
                res.setHeader(name, value);
            }
        });
        res.status(response.status);
        response.body.pipe(res);

    } catch (error) {
        console.error(error);
        res.status(500).send(`Proxy error: ${error.message}`);
    }
};
