const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 8000;
const rootDir = __dirname;

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(data));
}

function getClientIp(req) {
  const forwardedIp = req.headers['x-forwarded-for'];
  const candidate = forwardedIp ? forwardedIp.split(',')[0].trim() : req.socket.remoteAddress;
  return (candidate || 'unknown').replace(/^::ffff:/, '');
}

function lookupProvider(ip) {
  if (!ip || ip === 'unknown' || ip === '::1' || ip === '127.0.0.1') {
    return Promise.resolve({ provider: 'Local network', location: 'Local device' });
  }

  return new Promise((resolve) => {
    const request = https.get(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
      headers: { Accept: 'application/json' },
      timeout: 3500
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve({
            provider: data.org || data.asn || 'Provider unavailable',
            location: [data.city, data.region].filter(Boolean).join(', ') || 'Location unavailable'
          });
        } catch {
          resolve({ provider: 'Provider unavailable', location: 'Location unavailable' });
        }
      });
    });

    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve({ provider: 'Provider unavailable', location: 'Location unavailable' }));
  });
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/network') {
    const clientIp = getClientIp(req);
    lookupProvider(clientIp).then((network) => {
      sendJson(res, 200, { clientIp, ...network });
    });
    return;
  }

  if (url.pathname === '/api/ping') {
    sendJson(res, 200, { ok: true, latency: Date.now() % 1000 });
    return;
  }

  if (url.pathname === '/api/download') {
    const requestedBytes = Number(url.searchParams.get('bytes'));
    const bytes = Number.isFinite(requestedBytes)
      ? Math.min(Math.max(Math.floor(requestedBytes), 256 * 1024), 20 * 1024 * 1024)
      : 4 * 1024 * 1024;
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(bytes),
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Content-Encoding': 'identity',
      'X-Content-Type-Options': 'nosniff'
    });

    const chunk = Buffer.allocUnsafe(64 * 1024);
    chunk.fill(0x5a);
    let remaining = bytes;

    function writeChunk() {
      while (remaining > 0) {
        const size = Math.min(remaining, chunk.length);
        const chunkToWrite = size === chunk.length ? chunk : chunk.subarray(0, size);
        remaining -= size;
        if (!res.write(chunkToWrite)) {
          res.once('drain', writeChunk);
          return;
        }
      }
      res.end();
    }

    writeChunk();
    return;
  }

  if (url.pathname === '/api/upload') {
    let total = 0;
    let rejected = false;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > 20 * 1024 * 1024 && !rejected) {
        rejected = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large' }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!rejected) sendJson(res, 200, { ok: true, bytesReceived: total });
    });
    return;
  }

  let safePath = url.pathname === '/' ? '/index.html' : url.pathname;
  safePath = safePath.replace(/\.+\//g, '');
  const filePath = path.join(rootDir, safePath);

  if (!filePath.startsWith(rootDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };

  sendFile(res, filePath, mimeTypes[ext] || 'application/octet-stream');
});

server.listen(PORT, () => {
  console.log(`NetPulse server running at http://localhost:${PORT}`);
});
