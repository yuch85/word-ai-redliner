const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { generateManifest } = require('./generate-manifest.cjs');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const manifestPath = path.join(rootDir, 'manifest.xml');

function getEnv() {
  return {
    PORT: process.env.PORT || '3000',
    PROTOCOL: process.env.PROTOCOL || 'https',
    SSL_CERT_FILE: process.env.SSL_CERT_FILE || 'server.pem',
    SSL_KEY_FILE: process.env.SSL_KEY_FILE || 'server-key.pem'
  };
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    case '.ico':
      return 'image/x-icon';
    case '.map':
      return 'application/octet-stream';
    case '.xml':
      return 'application/xml; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function safeJoin(baseDir, targetPath) {
  const resolvedPath = path.resolve(baseDir, `.${targetPath}`);
  if (!resolvedPath.startsWith(baseDir)) {
    return null;
  }
  return resolvedPath;
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': getContentType(filePath),
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}

function requestHandler(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);

  if (urlPath === '/' || urlPath === '') {
    serveFile(res, path.join(distDir, 'taskpane.html'));
    return;
  }

  if (urlPath === '/manifest.xml') {
    serveFile(res, manifestPath);
    return;
  }

  const filePath = safeJoin(distDir, urlPath);
  if (!filePath) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  serveFile(res, filePath);
}

function startServer() {
  if (!fs.existsSync(distDir)) {
    console.error('Missing dist/ directory. Did the build complete?');
    process.exit(1);
  }

  generateManifest({ rootDir });

  const env = getEnv();
  const port = Number(env.PORT);

  if (env.PROTOCOL === 'http') {
    http.createServer(requestHandler).listen(port, () => {
      console.log(`HTTP server running on port ${port}`);
    });
    return;
  }

  const certPath = path.isAbsolute(env.SSL_CERT_FILE)
    ? env.SSL_CERT_FILE
    : path.join(rootDir, env.SSL_CERT_FILE);
  const keyPath = path.isAbsolute(env.SSL_KEY_FILE)
    ? env.SSL_KEY_FILE
    : path.join(rootDir, env.SSL_KEY_FILE);

  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    console.error('Missing SSL cert/key files. Provide server.pem and server-key.pem.');
    process.exit(1);
  }

  https
    .createServer(
      {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath)
      },
      requestHandler
    )
    .listen(port, () => {
      console.log(`HTTPS server running on port ${port}`);
    });
}

startServer();
