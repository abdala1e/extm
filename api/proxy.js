const fetch = require('node-fetch');
const { URL } = require('url');

// --- بداية العلاج ---
// متغيرات لتذكر آخر مقطع تم تسليمه ورابط قائمة التشغيل الخاصة به
let lastDeliveredSegmentUrl = null;
let lastPlaylistUrl = null;
// --- نهاية العلاج ---

const USER_AGENTS = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36", "VLC/3.0.20 LibVLC/3.0.20", "okhttp/4.9.3", "com.google.android.exoplayer2/2.18.1"];
const CORS_HEADERS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'Range, User-Agent, X-Requested-With, Content-Type', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range', 'Access-Control-Allow-Credentials': 'true'};
function generateRandomPublicIp() { const firstOctet = Math.floor(Math.random() * 223) + 1; if ([10, 127, 172, 192].includes(firstOctet)) { return generateRandomPublicIp(); } return `${firstOctet}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`; }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async (req, res) => {
    Object.entries(CORS_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
    if (req.method === 'OPTIONS') return res.status(204).end();

    const urlParams = new URL(req.url, `https://${req.headers.host}`).searchParams;
    const targetUrlString = urlParams.get('target') || (req.url.startsWith('/proxy/') ? decodeURIComponent(req.url.substring('/proxy/'.length).split('?')[0]) : null);
    const playlistUrlFromQuery = urlParams.get('playlist');

    if (req.query.isMaster === 'true') {
        lastDeliveredSegmentUrl = null; // إعادة تعيين الذاكرة عند بدء بث جديد
        lastPlaylistUrl = null;
        const streamUrl = 'http://111g1u0paira.maxplayer4k.org:2052/live/17415748956629/27133616434229/194472.m3u8';
        const origin = `https://${req.headers.host}`;
        const streamURLviaProxy = `${origin}/proxy/${encodeURIComponent(streamUrl)}?playlist=${encodeURIComponent(streamUrl)}`;
        const masterPlaylist = `#EXTM3U\n#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=5000000,RESOLUTION=1920x1080,NAME="FHD"\n${streamURLviaProxy}`;
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        return res.status(200).send(masterPlaylist);
    }

    if (targetUrlString) {
        try {
            let currentUrl = targetUrlString;
            const isTsSegment = currentUrl.endsWith('.ts');

            // --- بداية منطق البروكسي الصبور ---
            if (isTsSegment && currentUrl === lastDeliveredSegmentUrl && lastPlaylistUrl) {
                console.log(`[Patient Proxy] Duplicate segment request: ${currentUrl}. Waiting for a new one...`);
                let newSegmentFound = false;
                for (let attempt = 0; attempt < 20; attempt++) { // انتظر 5 ثوانٍ كحد أقصى
                    await delay(250);
                    try {
                        const playlistRes = await fetch(lastPlaylistUrl, { signal: AbortSignal.timeout(2000) });
                        if (playlistRes.ok) {
                            const playlistBody = await playlistRes.text();
                            const segments = playlistBody.match(/^[^#\n].*?\.ts/gm);
                            if (segments && segments.length > 0) {
                                const latestSegment = new URL(segments[segments.length - 1], lastPlaylistUrl).toString();
                                if (latestSegment !== currentUrl) {
                                    console.log(`[Patient Proxy] New segment found: ${latestSegment}. Proceeding.`);
                                    currentUrl = latestSegment; // تحديث الرابط إلى المقطع الجديد
                                    newSegmentFound = true;
                                    break;
                                }
                            }
                        }
                    } catch (e) { console.error(`[Patient Proxy] Error fetching playlist: ${e.message}`); }
                }
                if (!newSegmentFound) {
                    console.error(`[Patient Proxy] Timed out waiting for new segment. Failing request.`);
                    return res.status(504).send('Gateway Timeout: Could not find a new segment from origin.');
                }
            }
            // --- نهاية منطق البروكسي الصبور ---

            let response;
            const maxRetries = 5;
            for (let i = 0; i < maxRetries; i++) {
                const url = new URL(currentUrl);
                const requestHeaders = { 'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)], 'X-Forwarded-For': generateRandomPublicIp(), 'Origin': url.origin, 'Referer': url.origin + '/', 'Host': url.host };
                requestHeaders['X-Real-IP'] = requestHeaders['X-Forwarded-For'];
                try {
                    response = await fetch(currentUrl, { method: 'GET', headers: requestHeaders, redirect: 'manual', signal: AbortSignal.timeout(15000) });
                    if (response.status >= 300 && response.status < 400) {
                        const location = response.headers.get('Location');
                        if (location) { currentUrl = new URL(location, currentUrl).toString(); if (i < maxRetries - 1) continue; }
                    }
                    if (response.ok) break;
                } catch (error) { console.error(`Attempt ${i + 1} for ${currentUrl} failed: ${error.message}`); }
                if (i < maxRetries - 1) await delay(500 * (i + 1));
            }

            if (!response || !response.ok) { return res.status(502).send('Failed to fetch from origin after all retries.'); }

            if (isTsSegment) { lastDeliveredSegmentUrl = currentUrl; } // تحديث الذاكرة بعد النجاح

            res.setHeader('Cache-Control', 'no-cache');
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('mpegurl')) {
                lastPlaylistUrl = currentUrl; // حفظ رابط قائمة التشغيل الحالية
                res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
                let body = await response.text();
                const baseUrl = new URL(currentUrl);
                const origin = `https://${req.headers.host}`;
                const proxyPrefix = `${origin}/proxy/`;
                body = body.replace(/^(https?:\/\/[^\s]+)$/gm, line => `${proxyPrefix}${encodeURIComponent(line)}?playlist=${encodeURIComponent(currentUrl)}`);
                body = body.replace(/^([^\s#].*)$/gm, line => `${proxyPrefix}${encodeURIComponent(new URL(line, baseUrl).toString())}?playlist=${encodeURIComponent(currentUrl)}`);
                return res.status(response.status).send(body);
            }

            response.headers.forEach((value, name) => { if (!['content-encoding', 'transfer-encoding', 'connection'].includes(name.toLowerCase())) { res.setHeader(name, value); } });
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
