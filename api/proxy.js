const { URL } = require('url');

// متغير لتخزين عنوان آخر مقطع فيديو تم طلبه لمنع التكرار
let lastRequestedSegmentUrl = null;

const CORS_HEADERS = {'Access-Control-Allow-Origin': '*', 'Access-control-allow-headers': 'Origin, X-Requested-With, Content-Type, Accept', 'Access-Control-Allow-Methods': 'GET, OPTIONS'};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async (req, res) => {
    // إعداد رؤوس CORS والسماح لطلبات OPTIONS
    Object.entries(CORS_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    // استخراج الرابط المستهدف من مسار الطلب
    const targetUrlString = req.url.startsWith('/proxy/') ? decodeURIComponent(req.url.substring('/proxy/'.length).split('?')[0]) : null;
    const playlistUrl = new URL(req.url, `https://${req.headers.host}`).searchParams.get('playlist');

    // --- 1. إنشاء قائمة التشغيل الرئيسية (Master Playlist) ---
    if (req.query.isMaster === 'true') {
        const streamUrl = 'http://111g1u0paira.maxplayer4k.org:2052/live/17415748956629/27133616434229/194472.m3u8';
        const origin = `https://${req.headers.host}`;
        // الرابط يجب أن يحتوي على عنوان قائمة التشغيل الفرعية ليتمكن من فلترة المقاطع لاحقًا
        const streamURLviaProxy = `${origin}/proxy/${encodeURIComponent(streamUrl)}?playlist=${encodeURIComponent(streamUrl)}`;
        const masterPlaylist = `#EXTM3U\n#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=5000000,RESOLUTION=1920x1080,NAME="FHD"\n${streamURLviaProxy}`;
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        return res.status(200).send(masterPlaylist);
    }

    if (!targetUrlString) {
        return res.status(404).send('Not Found: Target URL is required.');
    }

    try {
        const isTsSegment = targetUrlString.endsWith('.ts');

        // --- 2. فلترة مقاطع TS المكررة ---
        if (isTsSegment) {
            if (targetUrlString === lastRequestedSegmentUrl) {
                console.log(`[REDIRECTOR] Duplicate segment request: ${targetUrlString}. Waiting...`);
                // بدلاً من الخطأ، ننتظر قليلاً لنعطي فرصة للمشغل لإعادة المحاولة
                await delay(500); // انتظر نصف ثانية
                // نرسل خطأ "حاول مرة أخرى لاحقًا" وهو أكثر ملاءمة من 409
                return res.status(429).send('Too Many Requests: Duplicate segment, please retry.');
            }
            // إذا كان المقطع جديدًا، قم بتحديث الذاكرة وأكمل
            lastRequestedSegmentUrl = targetUrlString;
            console.log(`[REDIRECTOR] New segment: ${targetUrlString}. Redirecting client.`);
            // --- 3. إعادة توجيه العميل (ffmpeg) إلى الرابط المباشر ---
            res.setHeader('Location', targetUrlString);
            return res.status(302).send('Redirecting to origin segment.');
        }

        // --- 4. معالجة قوائم التشغيل M3U8 ---
        // هذا الجزء يعمل كما كان، يجلب قائمة التشغيل ويعدل الروابط بداخلها
        const response = await fetch(targetUrlString);
        if (!response.ok) {
            return res.status(502).send('Failed to fetch playlist from origin.');
        }

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        let body = await response.text();
        const baseUrl = new URL(targetUrlString);
        const origin = `https://${req.headers.host}`;
        const proxyPrefix = `${origin}/proxy/`;

        // تعديل الروابط لتمر عبر البروكسي مع تمرير رابط قائمة التشغيل الحالية
        const currentPlaylistUrl = targetUrlString;
        body = body.replace(/^(https?:\/\/[^\s]+)$/gm, line => `${proxyPrefix}${encodeURIComponent(line)}?playlist=${encodeURIComponent(currentPlaylistUrl)}`);
        body = body.replace(/^([^\s#].*)$/gm, line => `${proxyPrefix}${encodeURIComponent(new URL(line, baseUrl).toString())}?playlist=${encodeURIComponent(currentPlaylistUrl)}`);
        
        return res.status(200).send(body);

    } catch (error) {
        console.error(`[FATAL] Proxy error: ${error.message}`);
        res.status(500).send(`Proxy error: ${error.message}`);
    }
};
