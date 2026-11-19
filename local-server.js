// Simple local server for testing. Run with:  node local-server.js
// It serves index.html and runs api/gemini.js, reading your key from .env.local
const http = require('http');
const fs = require('fs');
const path = require('path');

function readText(file) {
  const b = fs.readFileSync(file);
  const t = b[0] === 0xff && b[1] === 0xfe ? b.toString('utf16le') : b.toString('utf8');
  return t.replace(/^\uFEFF/, '');
}
let loadedFrom = 'no .env.local or .env file found';
for (const f of ['.env.local', '.env']) {
  const p = path.join(__dirname, f);
  if (!fs.existsSync(p)) continue;
  loadedFrom = f;
  for (const line of readText(p).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    if (!(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const handler = require('./api/gemini.js');
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  if (req.url.startsWith('/api/gemini')) {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try { req.body = data ? JSON.parse(data) : {}; } catch (e) { req.body = {}; }
      res.status = (c) => { res.statusCode = c; return res; };
      res.json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
      handler(req, res);
    });
    return;
  }
  fs.readFile(path.join(__dirname, 'index.html'), (err, buf) => {
    if (err) { res.statusCode = 500; return res.end('index.html not found next to local-server.js'); }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(buf);
  });
}).on('error', (e) => {
  console.log(e.code === 'EADDRINUSE' ? `Port ${PORT} is busy. Close the other server (Ctrl+C in its terminal) and try again.` : e.message);
}).listen(PORT, '127.0.0.1', () => {
    const k = process.env.GEMINI_API_KEY;
  console.log(`Key file: ${loadedFrom}`);
  console.log(k ? `API key: FOUND (${k.length} characters)` : 'API key: MISSING - check .env.local');
  console.log(`Open http://localhost:${PORT}`);
});