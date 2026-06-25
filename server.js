const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;

// MIME Types mapping for serving static files
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    let pathname = parsedUrl.pathname;

    // 1. CORS & User-Agent Proxy Endpoint
    if (pathname === '/proxy') {
        const targetUrl = parsedUrl.query.url;
        if (!targetUrl) {
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('خطأ: المعامل URL مطلوب');
            return;
        }

        // Add CORS Headers to allow browser access
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        const handleProxy = (urlStr, redirectCount = 0) => {
            if (redirectCount > 5) {
                console.error('[Proxy Error]: Too many redirects');
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('خطأ: عدد كبير من إعادة التوجيهات من الخادم المصدر');
                return;
            }

            console.log(`[Proxy] Requesting: ${urlStr} (Attempt ${redirectCount + 1})`);

            let parsedTarget;
            try {
                parsedTarget = new URL(urlStr);
            } catch (e) {
                console.error('[Proxy Error]: Invalid URL', urlStr);
                res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('خطأ: رابط البث غير صالح');
                return;
            }

            const isHttps = parsedTarget.protocol === 'https:';
            const protocol = isHttps ? require('https') : require('http');

            const options = {
                hostname: parsedTarget.hostname,
                port: parsedTarget.port || (isHttps ? 443 : 80),
                path: parsedTarget.pathname + parsedTarget.search,
                method: 'GET',
                headers: {
                    // تزييف رأس الاتصال ليظهر كأنه برنامج VLC لتخطي حجب المتصفحات
                    'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
                    'Accept': '*/*',
                    'Connection': 'keep-alive'
                }
            };

            const proxyReq = protocol.request(options, (proxyRes) => {
                // Check for HTTP redirects (301, 302, 307, 308)
                if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
                    let redirectUrl = proxyRes.headers.location;
                    // Resolve relative path redirects
                    if (!redirectUrl.startsWith('http://') && !redirectUrl.startsWith('https://')) {
                        redirectUrl = new URL(redirectUrl, urlStr).href;
                    }
                    console.log(`[Proxy] Redirected to: ${redirectUrl}`);
                    handleProxy(redirectUrl, redirectCount + 1);
                    return;
                }

                // Forward status code and content-type + include CORS headers explicitly
                res.writeHead(proxyRes.statusCode, {
                    'Content-Type': proxyRes.headers['content-type'] || 'video/MP2T',
                    'Cache-Control': 'no-cache, no-store',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Access-Control-Allow-Headers': '*',
                    'Connection': 'keep-alive',
                    'Transfer-Encoding': 'chunked'
                });

                proxyRes.pipe(res);
            });

            proxyReq.on('error', (err) => {
                console.error('[Proxy Error]:', err.message);
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                    res.end(`فشل الاتصال عبر الخادم الوسيط: ${err.message}`);
                }
            });

            proxyReq.end();
        };

        handleProxy(targetUrl);
        return;
    }

    // 2. Serve Static Files (HTML, CSS, JS)
    if (pathname === '/') pathname = '/index.html';
    const filePath = path.join(__dirname, pathname);

    // Guard against directory traversal attacks
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('ممنوع');
        return;
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('الملف غير موجود');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
    });
});

server.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(` M3U Stream Extractor & Local CORS Proxy Server`);
    console.log(`======================================================`);
    console.log(`🌐 تشغيل واجهة الاستخراج: http://localhost:${PORT}`);
    console.log(`🔄 تشغيل الخادم الوسيط:   http://localhost:${PORT}/proxy?url=...`);
    console.log(`======================================================`);
    console.log(`لإيقاف الخادم اضغط: Ctrl + C في موجه الأوامر\n`);
});
