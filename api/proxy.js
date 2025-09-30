const fetch = require('node-fetch');
const { URL } = require('url');

const USER_AGENTS = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36", "VLC/3.0.20 LibVLC/3.0.20", "okhttp/4.9.3", "com.google.android.exoplayer2/2.18.1"];
const CORS_HEADERS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'Range, User-Agent, X-Requested-With, Content-Type', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range', 'Access-Control-Allow-Credentials': 'true'};
function generateRandomPublicIp() { const firstOctet = Math.floor(Math.random() * 223) + 1; if ([10, 127, 172, 192].includes(firstOctet)) { return generateRandomPublicIp(); } return `${firstOctet}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`; }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// ذاكرة لتخزين آخر تسلسل لكل بث
const sequenceMemory = {};

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
                // ... (منطق إعادة المحاولة يبقى كما هو)
                try {
                    response = await fetch(currentUrl, { /* ... إعدادات الطلب ... */ });
                    if (response.ok) break;
                } catch (error) { /* ... */ }
                if (i < maxRetries - 1) await delay(500 * (i + 1));
            }

            if (!response || !response.ok) {
                 return res.status(502).send('Failed to fetch from origin after all retries.');
            }

            const contentType = response.headers.get('content-type') || '';

            // *** بداية الحل النهائي: "الكاتب المنظِّم" ***
            if (contentType.includes('mpegurl')) {
                res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
                let body = await response.text();
                const baseUrl = new URL(currentUrl);
                const origin = `https://${req.headers.host}`;

                // استخراج رقم التسلسل الحالي من القائمة
                const sequenceMatch = body.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
                const currentSequence = sequenceMatch ? parseInt(sequenceMatch[1], 10) : 0;

                // استخراج المقاطع الجديدة فقط
                const lines = body.split('\n');
                let newPlaylist = [];
                let newSegments = [];
                let lastKnownSequence = sequenceMemory[targetUrlString] || (currentSequence - 1);

                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].startsWith('#EXT-X-MEDIA-SEQUENCE')) {
                        newPlaylist.push(`#EXT-X-MEDIA-SEQUENCE:${lastKnownSequence + 1}`);
                    } else if (lines[i].startsWith('#')) {
                        newPlaylist.push(lines[i]);
                    } else if (lines[i].trim() !== '') {
                        // استخراج رقم المقطع من اسم الملف (e.g., _4724.ts)
                        const segmentMatch = lines[i].match(/_(\d+)\.ts/);
                        const segmentNumber = segmentMatch ? parseInt(segmentMatch[1], 10) : 0;

                        // إضافة المقطع فقط إذا كان جديدًا
                        if (segmentNumber > lastKnownSequence) {
                            newSegments.push({ info: lines[i-1], path: lines[i] });
                            lastKnownSequence = segmentNumber;
                        }
                    }
                }
                
                // إعادة بناء قائمة التشغيل بالمقاطع الجديدة فقط
                newSegments.forEach(segment => {
                    newPlaylist.push(segment.info);
                    newPlaylist.push(segment.path);
                });

                // تحديث الذاكرة بآخر تسلسل
                sequenceMemory[targetUrlString] = lastKnownSequence;

                let finalBody = newPlaylist.join('\n');

                // إعادة كتابة الروابط لتمر عبر البروكسي
                finalBody = finalBody.replace(/^(https?:\/\/[^\s]+)$/gm, line => `${origin}/proxy/${encodeURIComponent(line)}`);
                finalBody = finalBody.replace(/^([^\s#].*)$/gm, line => `${origin}/proxy/${encodeURIComponent(new URL(line, baseUrl).toString())}`);
                
                return res.status(response.status).send(finalBody);
            }
            // *** نهاية الحل النهائي ***

            // العودة إلى طريقة .pipe() التي نجحت بنسبة 75% للمقاطع
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
