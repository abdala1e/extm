const fetch = require('node-fetch');
const { URL } = require('url');

// --- بداية العلاج ---
// متغير لتخزين رقم تسلسل آخر مقطع تم تسليمه بنجاح
let lastSequenceNumber = -1;
// --- نهاية العلاج ---

const USER_AGENTS = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36", "VLC/3.0.20 LibVLC/3.0.20", "okhttp/4.9.3", "com.google.android.exoplayer2/2.18.1"];
const CORS_HEADERS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'Range, User-Agent, X-Requested-With, Content-Type', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range', 'Access-Control-Allow-Credentials': 'true'};
function generateRandomPublicIp() { const firstOctet = Math.floor(Math.random() * 223) + 1; if ([10, 127, 172, 192].includes(firstOctet)) { return generateRandomPublicIp(); } return `${firstOctet}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`; }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// دالة لاستخراج رقم التسلسل من اسم الملف
function getSequenceNumber(url) {
    const match = url.match(/_(\d+)\.ts/);
    return match ? parseInt(match[1], 10) : null;
}

module.exports = async (req, res) => {
    Object.entries(CORS_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
    if (req.method === 'OPTIONS') return res.status(204).end();

    const targetUrlString = req.url.startsWith('/proxy/') ? decodeURIComponent(req.url.substring('/proxy/'.length)) : req.query.target;

    if (req.query.isMaster === 'true') {
        // عند طلب قائمة رئيسية جديدة، نقوم بإعادة تعيين رقم التسلسل
        lastSequenceNumber = -1;
        console.log("Master playlist requested, resetting sequence number.");
        const streamUrl = 'http://111g1u0paira.maxplayer4k.org:2052/live/17415748956629/27133616434229/194472.m3u8';
        const origin = `https://${req.headers.host}`;
        const streamURLviaProxy = `${origin}/proxy/${encodeURIComponent(streamUrl)}`;
        const masterPlaylist = `#EXTM3U\n#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=5000000,RESOLUTION=1920x1080,NAME="FHD"\n${streamURLviaProxy}`;
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        return res.status(200).send(masterPlaylist);
    }

    if (targetUrlString) {
        try {
            // --- بداية منطق حارس التسلسل ---
            const isTsSegment = targetUrlString.endsWith('.ts');
            if (isTsSegment) {
                const currentSequence = getSequenceNumber(targetUrlString);
                if (currentSequence !== null) {
                    // إذا كان المقطع قديمًا أو مكررًا، ارفضه
                    if (currentSequence <= lastSequenceNumber) {
                        console.log(`[Sequence Guard] REJECTED: Stale segment ${currentSequence} (last was ${lastSequenceNumber}).`);
                        return res.status(404).send('Not Found: Stale or duplicate segment.');
                    }
                    // إذا كان المقطع جديدًا، قم بتحديث الذاكرة قبل المتابعة
                    lastSequenceNumber = currentSequence;
                }
            }
            // --- نهاية منطق حارس التسلسل ---

            let currentUrl = targetUrlString;
            let response;
            const maxRetries = 5;

            for (let i = 0; i < maxRetries; i++) {
                const url = new URL(currentUrl);
                const requestHeaders = {
                    'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
                    'X-Forwarded-For': generateRandomPublicIp(),
                    'Origin': url.origin,
                    'Referer': url.origin + '/',
                    'Host': url.host
                };
                requestHeaders['X-Real-IP'] = requestHeaders['X-Forwarded-For'];

                try {
                    response = await fetch(currentUrl, { method: 'GET', headers: requestHeaders, redirect: 'manual', signal: AbortSignal.timeout(15000) });
                    if (response.status >= 300 && response.status < 400) {
                        const location = response.headers.get('Location');
                        if (location) {
                            currentUrl = new URL(location, currentUrl).toString();
                            if (i < maxRetries - 1) continue;
                        }
                    }
                    if (response.ok) break;
                } catch (error) {
                    console.error(`Attempt ${i + 1} for ${currentUrl} failed: ${error.message}`);
                }
                if (i < maxRetries - 1) await delay(500 * (i + 1));
            }

            if (!response || !response.ok) {
                 return res.status(502).send('Failed to fetch from origin after all retries.');
            }

            console.log(`[Sequence Guard] ALLOWED: Segment ${lastSequenceNumber}. Proxying...`);
            res.setHeader('Cache-Control', 'no-cache'); // نمنع التخزين المؤقت للمقاطع

            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('mpegurl')) {
                res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
                let body = await response.text();
                const baseUrl = new URL(currentUrl);
                const origin = `https://${req.headers.host}`;
                const proxyPrefix = `${origin}/proxy/`;
                body = body.replace(/^(https?:\/\/[^\s]+)$/gm, line => `${proxyPrefix}${encodeURIComponent(line)}`);
                body = body.replace(/^([^\s#].*)$/gm, line => `${proxyPrefix}${encodeURIComponent(new URL(line, baseUrl).toString())}`);
                return res.status(response.status).send(body);
            }

            response.headers.forEach((value, name) => {
                if (!['content-encoding', 'transfer-encoding', 'connection'].includes(name.toLowerCase())) {
                    res.setHeader(name, value);
                }
            });
            res.status(response.status);
            response.body.pipe(res);

        } catch (error) {
            console.error(`[FATAL] Proxy error: ${error.message}`);
            res.status(500).send(`Proxy error: ${error.message}`);
        }
    } else {
        res.status(404).send('Not Found');
    }
};
