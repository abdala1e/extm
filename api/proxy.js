const fetch = require('node-fetch');
const { URL } = require('url');

const USER_AGENTS = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36", "VLC/3.0.20 LibVLC/3.0.20", "okhttp/4.9.3", "com.google.android.exoplayer2/2.18.1"];
const CORS_HEADERS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'Range, User-Agent, X-Requested-With, Content-Type', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range', 'Access-Control-Allow-Credentials': 'true'};
function generateRandomPublicIp() { const firstOctet = Math.floor(Math.random() * 223) + 1; if ([10, 127, 172, 192].includes(firstOctet)) { return generateRandomPublicIp(); } return `${firstOctet}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`; }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// ذاكرة لتخزين آخر المقاطع التي تم إرسالها لكل رابط
const segmentMemory = new Map();

module.exports = async (req, res) => {
    Object.entries(CORS_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
    if (req.method === 'OPTIONS') return res.status(204).end();

    if (req.query.isMaster === 'true') {
        const streamUrl = 'http://111g1u0paira.maxplayer4k.org:2052/live/17415748956629/27133616434229/194472.m3u8';
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
            const maxRetries = 5;

            for (let i = 0; i < maxRetries; i++) {
                // ... (منطق إعادة المحاولة السريع يبقى كما هو)
                try {
                    response = await fetch(currentUrl, { method: 'GET', headers: {/*...*/}, redirect: 'manual', signal: AbortSignal.timeout(4000) });
                    if (response.status >= 300 && response.status < 400) { /*...*/ continue; }
                    if (response.ok) break;
                } catch (error) { console.error(`Attempt ${i + 1} failed: ${error.message}`); }
                if (i < maxRetries - 1) await delay(250 * (i + 1));
            }

            if (!response || !response.ok) {
                 return res.status(502).send('Failed to fetch from origin after all retries.');
            }

            const contentType = response.headers.get('content-type') || '';

            // *** بداية الحل النهائي: "المنظف الجراحي" ***
            if (contentType.includes('mpegurl')) {
                res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
                let body = await response.text();
                
                const lines = body.split('\n');
                const cleanedLines = [];
                let recentSegments = segmentMemory.get(targetUrlString) || [];

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (line.endsWith('.ts')) {
                        // إذا كان المقطع مكررًا، تجاهله
                        if (recentSegments.includes(line)) {
                            continue; 
                        }
                        // إذا كان جديدًا، أضف سطر المعلومات الخاص به ثم أضفه هو
                        if (i > 0 && lines[i-1].startsWith('#EXTINF')) {
                            cleanedLines.push(lines[i-1]);
                        }
                        cleanedLines.push(line);
                        recentSegments.push(line);
                    } else if (line) {
                        // أضف أي سطر آخر ليس فارغًا
                        cleanedLines.push(line);
                    }
                }

                // حافظ على حجم الذاكرة معقولاً (آخر 15 مقطعًا)
                if (recentSegments.length > 15) {
                    recentSegments = recentSegments.slice(recentSegments.length - 15);
                }
                segmentMemory.set(targetUrlString, recentSegments);

                let finalBody = cleanedLines.join('\n');
                
                // إعادة كتابة الروابط لتمر عبر البروكسي
                const baseUrl = new URL(currentUrl);
                const origin = `https://${req.headers.host}`;
                finalBody = finalBody.replace(/^(https?:\/\/[^\s]+)$/gm, line => `${origin}/proxy/${encodeURIComponent(line)}`);
                finalBody = finalBody.replace(/^([^\s#].*)$/gm, line => `${origin}/proxy/${encodeURIComponent(new URL(line, baseUrl).toString())}`);
                
                return res.status(response.status).send(finalBody);
            }
            // *** نهاية الحل النهائي ***

            // تمرير مقاطع الفيديو .ts مباشرة
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
        res.status(404).send('Not Found');
    }
};
