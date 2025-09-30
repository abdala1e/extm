const fetch = require('node-fetch');
const { URL } = require('url');

// --- بداية التعديل ---
// متغير لتخزين عنوان آخر مقطع فيديو تم تسليمه بنجاح
// هذا المتغير سيظل موجودًا بين الطلبات المختلفة لأنه خارج دالة المعالجة
let lastSegmentUrl = null;
// --- نهاية التعديل ---

const USER_AGENTS = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36", "VLC/3.0.20 LibVLC/3.0.20", "okhttp/4.9.3", "com.google.android.exoplayer2/2.18.1"];
const CORS_HEADERS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'Range, User-Agent, X-Requested-With, Content-Type', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range', 'Access-Control-Allow-Credentials': 'true'};
function generateRandomPublicIp() { const firstOctet = Math.floor(Math.random() * 223) + 1; if ([10, 127, 172, 192].includes(firstOctet)) { return generateRandomPublicIp(); } return `${firstOctet}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`; }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async (req, res) => {
    Object.entries(CORS_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
    if (req.method === 'OPTIONS') return res.status(204).end();

    // استخراج الرابط المستهدف من `req.query.target` أو من المسار `req.url`
    // هذا يجعل الكود أكثر مرونة ليتوافق مع طريقة استدعائك له
    let targetUrlString;
    if (req.query.target) {
        targetUrlString = req.query.target;
    } else if (req.url.startsWith('/proxy/')) {
        targetUrlString = decodeURIComponent(req.url.substring('/proxy/'.length));
    }

    if (req.query.isMaster === 'true') {
        const streamUrl = 'http://111g1u0paira.maxplayer4k.org:2052/live/17415748956629/27133616434229/194472.m3u8';
        const origin = `https://${req.headers.host}`;
        // استخدام المسار `/proxy/` ليتوافق مع بقية الكود
        const streamURLviaProxy = `${origin}/proxy/${encodeURIComponent(streamUrl)}`;
        const masterPlaylist = `#EXTM3U\n#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=5000000,RESOLUTION=1920x1080,NAME="FHD"\n${streamURLviaProxy}`;
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        return res.status(200).send(masterPlaylist);
    }

    if (targetUrlString) {
        try {
            let currentUrl = targetUrlString;

            // --- بداية منطق فلترة مقاطع TS المكررة ---
            const isTsSegment = currentUrl.endsWith('.ts');
            if (isTsSegment && currentUrl === lastSegmentUrl) {
                console.log(`[PROXY] Duplicate segment detected, rejecting: ${currentUrl}`);
                // إرجاع خطأ "Conflict" لإعلام ffmpeg بتجاهل هذا الطلب والمحاولة مرة أخرى
                return res.status(409).send('Duplicate segment detected.');
            }
            // --- نهاية منطق الفلترة ---

            let response;
            const maxRetries = 5;

            for (let i = 0; i < maxRetries; i++) {
                const url = new URL(currentUrl);
                const requestHeaders = {};
                requestHeaders['User-Agent'] = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
                requestHeaders['X-Forwarded-For'] = generateRandomPublicIp();
                requestHeaders['X-Real-IP'] = requestHeaders['X-Forwarded-For'];
                requestHeaders['Origin'] = url.origin;
                requestHeaders['Referer'] = url.origin + '/';
                requestHeaders['Host'] = url.host;

                try {
                    response = await fetch(currentUrl, {
                        method: 'GET',
                        headers: requestHeaders,
                        redirect: 'manual',
                        signal: AbortSignal.timeout(4000)
                    });

                    if (response.status >= 300 && response.status < 400) {
                        const location = response.headers.get('Location');
                        if (location) {
                            currentUrl = new URL(location, currentUrl).toString();
                            if (i < maxRetries - 1) continue;
                        }
                    }
                    
                    if (response.ok) break;

                } catch (error) {
                    console.error(`Attempt ${i + 1} failed: ${error.message}`);
                }
                
                if (i < maxRetries - 1) await delay(250 * (i + 1));
            }

            if (!response || !response.ok) {
                 return res.status(502).send('Failed to fetch from origin after all retries.');
            }

            // --- بداية تحديث ذاكرة المقطع ---
            // إذا كان الطلب لمقطع TS ونجح، نقوم بتحديث الذاكرة
            if (isTsSegment && response.ok) {
                // console.log(`[PROXY] Successfully delivered segment: ${currentUrl}`);
                lastSegmentUrl = currentUrl;
            }
            // --- نهاية تحديث الذاكرة ---

            res.setHeader('X-Proxy-Timestamp', Date.now());

            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('mpegurl')) {
                res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
                let body = await response.text();
                const baseUrl = new URL(currentUrl);
                const origin = `https://${req.headers.host}`;

                // تعديل الروابط داخل ملف m3u8 لتمر عبر البروكسي
                const proxyPrefix = `${origin}/proxy/`;
                body = body.replace(/^(https?:\/\/[^\s]+)$/gm, line => `${proxyPrefix}${encodeURIComponent(line)}`);
                body = body.replace(/^([^\s#].*)$/gm, line => `${proxyPrefix}${encodeURIComponent(new URL(line, baseUrl).toString())}`);
                
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
    } else {
        res.status(404).send('Not Found: Please use ?isMaster=true or provide a target URL via /proxy/ or ?target=');
    }
};
