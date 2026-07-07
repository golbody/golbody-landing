const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const BASE_PATH = process.env.BASE_PATH || '/';

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server error');
      }
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  // Remove base path prefix if present
  let urlPath = req.url;
  if (BASE_PATH !== '/' && urlPath.startsWith(BASE_PATH)) {
    urlPath = urlPath.slice(BASE_PATH.length) || '/';
  }

  // Strip query string and hash
  const cleanPath = urlPath.split('?')[0].split('#')[0];

  // Default to index.html for root or directories
  let filePath = cleanPath === '/' ? 'index.html' : cleanPath;
  filePath = path.join(__dirname, filePath);

  // Security: prevent directory traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Try index.html for directories
      const indexPath = path.join(filePath, 'index.html');
      fs.stat(indexPath, (idxErr, idxStats) => {
        if (idxErr || !idxStats.isFile()) {
          // Fallback to root index.html for SPA behavior
          serveFile(res, path.join(__dirname, 'index.html'));
          return;
        }
        serveFile(res, indexPath);
      });
      return;
    }
    serveFile(res, filePath);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Static server running on http://0.0.0.0:${PORT} (base: ${BASE_PATH})`);
});
