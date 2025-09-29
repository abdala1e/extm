const fetch = require('node-fetch');

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
    // req.query.target يأتي من ملف vercel.json
    const targetUrlString = req.query.target;

    if (req.method === 'OPTIONS') {
        Object.entries(CORS_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
        return res.status(204).end();
    }

    try {
        const targetUrl = new URL(targetUrlString);
        let response;
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

                response = await fetch(targetUrl.toString(), {
                    method: req.method,
                    headers: requestHeaders,
                    redirect: 'manual',
                    signal: AbortSignal.timeout(8000)
                });

                if (response.status < 500) break;
            } catch (error) {
                if (i === maxRetries - 1) throw error;
            }
            await delay(200 * (i + 1));
        }

        if (!response) {
            return res.status(502).send('Failed to fetch from origin after all retries.');
        }

        // تمرير ترويسات الاستجابة
        Object.entries(CORS_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
        
        // *** هذا هو السطر الذي تم تعديله ***
        // يخبر المتصفح أن يطلب نسخة جديدة كل 3 ثوانٍ
        res.setHeader('Cache-Control', 'public, s-maxage=3, max-age=3, stale-while-revalidate=3');

        // التعامل مع إعادة التوجيه
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('Location');
            if (location) {
                // بناء الرابط الجديد ليمر عبر الوكيل
                const newProxyUrl = `/proxy/${encodeURIComponent(new URL(location, targetUrl).toString())}`;
                res.setHeader('Location', newProxyUrl);
                return res.status(302).end();
            }
        }

        // تعديل روابط M3U8
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('mpegurl')) {
            let body = await response.text();
            const baseUrl = new URL(targetUrl.toString());
            const origin = `https://${req.headers.host}`;

            // تعديل الروابط داخل الملف لتمر عبر الوكيل
            body = body.replace(/^(https?:\/\/[^\s]+)$/gm, line => `${origin}/proxy/${encodeURIComponent(line)}`);
            body = body.replace(/^([^\s#].*)$/gm, line => `${origin}/proxy/${encodeURIComponent(new URL(line, baseUrl).toString())}`);
            
            return res.status(response.status).send(body);
        }

        // تمرير المحتوى مباشرة (مثل مقاطع الفيديو .ts)
        res.status(response.status);
        response.body.pipe(res);

    } catch (error) {
        res.status(500).send(`Proxy error: ${error.message}`);
    }
};
