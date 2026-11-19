import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.env.PORT || 4175);
const base = process.env.BASE_PATH || '/budget-capture-e2e/';
const mime = {
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.webmanifest':'application/manifest+json',
  '.wasm':'application/wasm',
};
  '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json', '.wasm':'application/wasm',
};
const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    if (url.pathname === base.slice(0, -1)) { res.writeHead(302, {Location:base}); res.end(); return; }
    if (!url.pathname.startsWith(base)) { res.writeHead(404); res.end('Not found'); return; }
    let relative = decodeURIComponent(url.pathname.slice(base.length));
    if (!relative) relative = 'index.html';
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) && file !== path.join(root, 'index.html')) { res.writeHead(403); res.end('Forbidden'); return; }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {'Content-Type':mime[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    fs.createReadStream(file).pipe(res);
  } catch { res.writeHead(400); res.end('Bad request'); }
});
server.listen(port, '127.0.0.1', () => process.stdout.write(`Static test server: http://127.0.0.1:${port}${base}\n`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
