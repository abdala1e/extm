const fetch = require('node-fetch');
const { URL } = require('url');

const USER_AGENTS = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36", "VLC/3.0.20 LibVLC/3.0.20", "okhttp/4.9.3", "com.google.android.exoplayer2/2.18.1"];
const CORS_HEADERS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'Range, User-Agent, X-Requested-With, Content-Type', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range', 'Access-Control-Allow-Credentials': 'true'};
function generateRandomPublicIp() { const firstOctet = Math.floor(Math.random() * 223) + 1; if ([10, 127, 172, 192].includes(firstOctet)) { return generateRandomPublicIp(); } return `${firstOctet}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`; }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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

            // *** بداية الحل النهائي: "مُعالج قائمة التشغيل" ***
            if (contentType.includes('mpegurl')) {
                res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
                let body = await response.text();
                
                const lines = body.split('\n');
                const segments = [];
                let headerLines = [];
                let mediaSequence = 0;

                // 1. فصل الترويسات عن المقاطع
                for (const line of lines) {
                    if (line.startsWith('#EXTINF')) {
                        const nextLineIndex = lines.indexOf(line) + 1;
                        if (nextLineIndex < lines.length && lines[nextLineIndex].trim().endsWith('.ts')) {
                            segments.push({ info: line, path: lines[nextLineIndex] });
                        }
                    } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE')) {
                        mediaSequence = parseInt(line.split(':')[1], 10) || 0;
                        headerLines.push(line); // احتفظ بالسطر الأصلي
                    } else if (line.startsWith('#') && !line.startsWith('#EXT-X-ENDLIST')) {
                        headerLines.push(line);
                    }
                }

                // 2. إزالة التكرار من المقاطع (الاحتفاظ بالنسخة الأخيرة فقط)
                const uniqueSegments = Array.from(new Map(segments.map(s => [s.path, s])).values());

                // 3. إعادة بناء قائمة التشغيل بشكل نظيف
                let newPlaylist = [];
                // إزالة أي ترويسة MEDIA-SEQUENCE قديمة من الترويسات
                headerLines = headerLines.filter(l => !l.startsWith('#EXT-X-MEDIA-SEQUENCE'));
                newPlaylist.push(...headerLines);

                // إضافة ترويسة MEDIA-SEQUENCE جديدة وصحيحة
                if (uniqueSegments.length > 0) {
                    newPlaylist.push(`#EXT-X-MEDIA-SEQUENCE:${mediaSequence}`);
                }

                // إضافة المقاطع النظيفة
                uniqueSegments.forEach(segment => {
                    newPlaylist.push(segment.info);
                    newPlaylist.push(segment.path);
                });

                let finalBody = newPlaylist.join('\n');

                // إعادة كتابة الروابط لتمر عبر البروكسي
                const baseUrl = new URL(currentUrl);
                const origin = `https://${req.headers.host}`;
                finalBody = finalBody.replace(/^(https?:\/\/[^\s]+)$/gm, line => `${origin}/proxy/${encodeURIComponent(line)}`);
                finalBody = finalBody.replace(/^([^\s#].*)$/gm, line => `${origin}/proxy/${encodeURIComponent(new URL(line, baseUrl).toString())}`);
                
                return res.status(response.status).send(finalBody);
            }
            // *** نهاية الحل النهائي ***

            // تمرير مقاطع الفيديو .ts مباشرة كما في الكود الناجح
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
