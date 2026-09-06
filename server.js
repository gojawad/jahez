'use strict';
// خادم "جاهز" — يقدّم الواجهة الثابتة ويشغّل دوال /api التي كانت تعمل على Vercel
// بنفس المسارات، فلا يحتاج index.html أي تعديل.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const BUILD_SHA = process.env.BUILD_SHA || 'unknown';
const DEPLOYED_AT = process.env.DEPLOYED_AT || 'unknown';

// دوال الـ API — كل واحدة بنفس توقيع Vercel: (req, res) => Promise
const API = {
  'microsoft': require('./api/microsoft'),
  'public-shipment': require('./api/public-shipment'),
  'render-bsgt-pdf': require('./api/render-bsgt-pdf'),
  'qr-package': require('./api/qr-package'),
};
// /s/<token> — رابط رمز QR القصير المطبوع على الفواتير
const QR_ROUTE = /^\/s\/([A-Za-z0-9_-]+)\/?$/;

// الملفات الثابتة المسموح تقديمها فقط (لا SQL ولا ملفات الخادم ولا الملفات المخفية)
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // SAMEORIGIN لا DENY: الواجهة تعرض PDF داخل iframe من نفس الأصل.
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
}

// طبقة توافق مع Vercel: req.query و res.status/json/send/redirect
function vercelify(req, res, url) {
  req.query = Object.fromEntries(url.searchParams);
  res.status = code => { res.statusCode = code; return res; };
  res.json = obj => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
  res.send = body => {
    if (Buffer.isBuffer(body)) {
      if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/octet-stream');
      res.end(body);
    } else if (typeof body === 'object' && body !== null) {
      res.json(body);
    } else {
      const text = String(body ?? '');
      if (!res.getHeader('Content-Type')) {
        res.setHeader('Content-Type', /^\s*</.test(text) ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8');
      }
      res.end(text);
    }
    return res;
  };
  res.redirect = (code, location) => {
    if (typeof code !== 'number') { location = code; code = 302; }
    res.statusCode = code;
    res.setHeader('Location', location);
    res.end();
    return res;
  };
}

async function handleApi(req, res, url) {
  const name = url.pathname.replace(/^\/api\//, '').replace(/\/+$/, '');
  const handler = API[name];
  if (!handler) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'Not found' }));
  }
  vercelify(req, res, url);
  try {
    await handler(req, res);
    if (!res.writableEnded) res.end();
  } catch (error) {
    console.error(`[api/${name}]`, error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    if (!res.writableEnded) res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  // Support static portal folders such as /experiments/bs-collection/.
  // They are published as normal directory indexes, just like on Vercel.
  else if (pathname.endsWith('/')) pathname += 'index.html';
  // امنع أي مسار يخرج من الجذر أو يشير لملف مخفي أو لمجلدات الخادم
  const segments = pathname.split('/').filter(Boolean);
  if (segments.some(s => s === '..' || s.startsWith('.')) ||
      ['api', 'node_modules', 'supabase'].includes(segments[0]) ||
      ['server.js', 'package.json', 'package-lock.json', 'Dockerfile', 'docker-compose.yml'].includes(segments[0])) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  const ext = path.extname(pathname).toLowerCase();
  const type = MIME[ext];
  if (!type) { res.statusCode = 404; return res.end('Not found'); }

  const filePath = path.join(ROOT, ...segments);
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', stat.size);
    // الواجهة ملف واحد يتغير مع كل نشر — لا تخزينه مؤقتاً. الأصول الأخرى تُخزن لفترة قصيرة.
    res.setHeader('Cache-Control', ext === '.html' ? 'no-cache, must-revalidate' : 'public, max-age=3600');
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  securityHeaders(res);
  let url;
  try { url = new URL(req.url, 'http://localhost'); }
  catch { res.statusCode = 400; return res.end('Bad request'); }

  if (url.pathname === '/healthz') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify({ ok: true, app: 'jahez', commitSha: BUILD_SHA, deployedAt: DEPLOYED_AT }));
  }
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  const qr = url.pathname.match(QR_ROUTE);
  if (qr) {
    url.searchParams.set('token', qr[1]);
    url.pathname = '/api/qr-package';
    return handleApi(req, res, url);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    return res.end('Method not allowed');
  }
  return serveStatic(req, res, url);
});

server.requestTimeout = 120000; // توليد PDF قد يستغرق وقتاً
server.listen(PORT, () => console.log(`jahez listening on :${PORT} (build ${BUILD_SHA})`));

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
