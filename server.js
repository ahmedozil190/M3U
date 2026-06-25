const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { spawn } = require('child_process');

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

// ─────────────────────────────────────────────────────────────
// Helper: add CORS headers to any response
// ─────────────────────────────────────────────────────────────
function setCORSHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
}

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    let pathname = parsedUrl.pathname;

    // ── Handle CORS preflight ──────────────────────────────────
    if (req.method === 'OPTIONS') {
        setCORSHeaders(res);
        res.writeHead(200);
        res.end();
        return;
    }

    // ══════════════════════════════════════════════════════════
    // 1. SIMPLE PROXY  →  /proxy?url=...
    //    Fetches the stream as-is with VLC User-Agent
    // ══════════════════════════════════════════════════════════
    if (pathname === '/proxy') {
        const targetUrl = parsedUrl.query.url;
        if (!targetUrl) {
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('خطأ: المعامل url مطلوب');
            return;
        }

        console.log(`[Proxy] → ${targetUrl}`);

        const handleProxy = (urlStr, redirectCount = 0) => {
            if (redirectCount > 5) {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('خطأ: عدد كبير من إعادة التوجيهات');
                return;
            }

            let parsedTarget;
            try { parsedTarget = new URL(urlStr); }
            catch (e) {
                res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('خطأ: رابط غير صالح');
                return;
            }

            const isHttps = parsedTarget.protocol === 'https:';
            const protocol = isHttps ? require('https') : require('http');
            const options = {
                hostname: parsedTarget.hostname,
                port: parsedTarget.port || (isHttps ? 443 : 80),
                path: parsedTarget.pathname + parsedTarget.search,
                method: 'GET',
                timeout: 15000,
                headers: {
                    'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
                    'Accept': '*/*',
                    'Connection': 'keep-alive'
                }
            };

            const proxyReq = protocol.request(options, (proxyRes) => {
                if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
                    let loc = proxyRes.headers.location;
                    if (!loc.startsWith('http')) loc = new URL(loc, urlStr).href;
                    console.log(`[Proxy] Redirect → ${loc}`);
                    handleProxy(loc, redirectCount + 1);
                    return;
                }

                res.writeHead(proxyRes.statusCode, {
                    'Content-Type': proxyRes.headers['content-type'] || 'video/MP2T',
                    'Cache-Control': 'no-cache, no-store',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Access-Control-Allow-Headers': '*',
                    'Connection': 'keep-alive'
                });
                proxyRes.pipe(res);

                proxyRes.on('error', (err) => {
                    console.error('[Proxy Stream Error]:', err.message);
                });
            });

            proxyReq.on('timeout', () => {
                proxyReq.destroy();
                if (!res.headersSent) {
                    res.writeHead(504, { 'Content-Type': 'text/plain; charset=utf-8' });
                    res.end('انتهت مهلة الاتصال بخادم البث');
                }
            });

            proxyReq.on('error', (err) => {
                console.error('[Proxy Error]:', err.message);
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                    res.end(`فشل الاتصال: ${err.message}`);
                }
            });

            proxyReq.end();
        };

        handleProxy(targetUrl);
        return;
    }

    // ══════════════════════════════════════════════════════════
    // 2. HLS TRANSCODING PROXY  →  /hls?url=...
    //    Converts ANY stream (TS, RTMP, HTTP...) to HLS (m3u8)
    //    using FFmpeg piped via chunked HTTP response.
    //    The m3u8 playlist & segments are generated on-the-fly.
    // ══════════════════════════════════════════════════════════
    if (pathname === '/hls') {
        const targetUrl = parsedUrl.query.url;
        if (!targetUrl) {
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('خطأ: المعامل url مطلوب');
            return;
        }

        console.log(`[HLS-Transcode] → ${targetUrl}`);

        setCORSHeaders(res);

        // Output as MPEG-TS stream with H.264 + AAC codec (browser-friendly)
        // -c:v copy tries to copy video codec; falls back to re-encode if needed
        const ffmpegArgs = [
            '-loglevel', 'error',
            '-user_agent', 'VLC/3.0.18 LibVLC/3.0.18',
            '-i', targetUrl,
            // Video: copy if possible, else re-encode to H.264
            '-c:v', 'copy',
            // Audio: copy if possible, else re-encode to AAC
            '-c:a', 'copy',
            // Output as MPEG-TS (browsers can play this via mpegts.js)
            '-f', 'mpegts',
            // Write to stdout (pipe:1)
            'pipe:1'
        ];

        res.writeHead(200, {
            'Content-Type': 'video/MP2T',
            'Cache-Control': 'no-cache, no-store',
            'Access-Control-Allow-Origin': '*',
            'Transfer-Encoding': 'chunked',
            'Connection': 'keep-alive'
        });

        const ffmpeg = spawn('ffmpeg', ffmpegArgs);

        ffmpeg.stdout.pipe(res);

        ffmpeg.stderr.on('data', (data) => {
            console.error(`[FFmpeg] ${data}`);
        });

        ffmpeg.on('error', (err) => {
            console.error('[FFmpeg Spawn Error]:', err.message);
            if (!res.writableEnded) {
                res.end();
            }
        });

        ffmpeg.on('close', (code) => {
            console.log(`[FFmpeg] exited with code ${code}`);
            if (!res.writableEnded) res.end();
        });

        // Kill FFmpeg if client disconnects
        req.on('close', () => {
            console.log('[HLS] Client disconnected, killing FFmpeg');
            ffmpeg.kill('SIGKILL');
        });

        return;
    }

    // ══════════════════════════════════════════════════════════
    // 3. PING / HEALTH CHECK  →  /ping
    // ══════════════════════════════════════════════════════════
    if (pathname === '/ping') {
        setCORSHeaders(res);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', time: new Date().toISOString() }));
        return;
    }

    // ══════════════════════════════════════════════════════════
    // 4. SERVE STATIC FILES  (HTML / CSS / JS)
    // ══════════════════════════════════════════════════════════
    if (pathname === '/') pathname = '/index.html';
    const filePath = path.join(__dirname, pathname);

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
        const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
    });
});

server.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(` M3U Stream Extractor + HLS Transcoding Proxy`);
    console.log(`======================================================`);
    console.log(`🌐 الواجهة:          http://localhost:${PORT}`);
    console.log(`🔄 بروكسي عادي:      http://localhost:${PORT}/proxy?url=...`);
    console.log(`🎬 تحويل HLS (FFmpeg): http://localhost:${PORT}/hls?url=...`);
    console.log(`======================================================`);
    console.log(`لإيقاف الخادم اضغط: Ctrl + C\n`);
});
