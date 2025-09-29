// استيراد المكتبات الضرورية
const fetch = require('node-fetch');
const { URL } = require('url');

// نفس المتغيرات والثوابت من الكود الأصلي
const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "VLC/3.0.20 LibVLC/3.0.20",
    "okhttp/4.9.3",
    "com.google.android.exoplayer2/2.18.1"
];

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, User-Agent, X-Requested-With, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
    'Access-Control-Allow-Credentials': 'true'
};

function generateRandomPublicIp() {
    const firstOctet = Math.floor(Math.random() * 223) + 1;
    if ([10, 127, 172, 192].includes(firstOctet)) {
        return generateRandomPublicIp();
    }
    return `${firstOctet}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// الدالة الرئيسية التي تعمل على Vercel
module.exports = async (req, res) => {
    // تطبيق ترويسات CORS على كل الاستجابات
    Object.entries(CORS_HEADERS).forEach(([key, value]) => res.setHeader(key, value));

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    // ترجمة: if (url.pathname === '/iraq.m3u8')
    if (req.query.isMaster === 'true') {
        const streamUrl = req.query.streamUrl;
        const origin = `https://${req.headers.host}`;
        const streamURLviaProxy = `${origin}/proxy/${encodeURIComponent(streamUrl)}`;
        const masterPlaylist = `#EXTM3U
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=5000000,RESOLUTION=1920x1080,NAME="FHD"
${streamURLviaProxy}`;
        
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        return res.status(200).send(masterPlaylist);
    }

    // ترجمة: if (url.pathname.startsWith('/proxy/'))
    const targetUrlString = req.query.target;
    if (targetUrlString) {
        try {
            const targetUrl = new URL(targetUrlString);
            let fetchResponse;
            const maxRetries = 3;

            for (let i = 0; i < maxRetries; i++) {
                try {
                    const requestHeaders = {};
                    const randomUserAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
                    const randomIp = generateRandomPublicIp();

                    requestHeaders['User-Agent'] = randomUserAgent;
                    requestHeaders['X-Forwarded-For'] = randomIp;
                    requestHeaders['X-Real-IP'] = randomIp;
                    requestHeaders['Origin'] = targetUrl.origin;
                    requestHeaders['Referer'] = targetUrl.origin + '/';
                    requestHeaders['Host'] = targetUrl.host;

                    fetchResponse = await fetch(targetUrl.toString(), {
                        method: req.method,
                        headers: requestHeaders,
                        redirect: 'manual',
                        signal: AbortSignal.timeout(8000)
                    });

                    if (fetchResponse.status < 500) break;
                } catch (error) {
                    if (i === maxRetries - 1) throw error;
                }
                await delay(200 * (i + 1));
            }

            if (!fetchResponse) {
                return res.status(502).send('Failed to fetch from origin after all retries.');
            }

            res.setHeader('Cache-Control', 'public, s-maxage=3, max-age=3, stale-while-revalidate=3');

            if (fetchResponse.status >= 300 && fetchResponse.status < 400) {
                const location = fetchResponse.headers.get('Location');
                if (location) {
                    const newUrl = new URL(location, targetUrl).toString();
                    const origin = `https://${req.headers.host}`;
                    const newProxyUrl = `${origin}/proxy/${encodeURIComponent(newUrl)}`;
                    res.setHeader('Location', newProxyUrl);
                    return res.status(302).end();
                }
            }

            const contentType = fetchResponse.headers.get('content-type') || '';
            if (contentType.includes('mpegurl')) {
                let body = await fetchResponse.text();
                const baseUrl = new URL(targetUrl.toString());
                const origin = `https://${req.headers.host}`;

                body = body.replace(/^(https?:\/\/[^\s]+)$/gm, line => `${origin}/proxy/${encodeURIComponent(line)}`);
                body = body.replace(/^([^\s#].*)$/gm, line => `${origin}/proxy/${encodeURIComponent(new URL(line, baseUrl).toString())}`);
                
                res.setHeader('Content-Type', contentType);
                return res.status(fetchResponse.status).send(body);
            }

            // تمرير المحتوى مباشرة
            fetchResponse.headers.forEach((value, name) => {
                if (!['content-encoding', 'transfer-encoding'].includes(name.toLowerCase())) {
                    res.setHeader(name, value);
                }
            });
            res.status(fetchResponse.status);
            fetchResponse.body.pipe(res);

        } catch (error) {
            console.error(error);
            res.status(500).send(`Proxy error: ${error.message}`);
        }
    } else {
        res.status(404).send('Not Found');
    }
};
