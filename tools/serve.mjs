import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './prepare-vocabulary.mjs';
import { loadEnvFile } from 'node:process';
import { Readable } from 'node:stream';
import gemini from '../api/gemini.js';
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
// Existing shell/Vercel variables take precedence; local secrets are never served.
for (const name of ['.env.local', '.env']) {
  try { loadEnvFile(path.join(projectRoot, name)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const root = path.resolve(
  fileURLToPath(new URL('..', import.meta.url)),
  process.argv.includes('--dist') ? 'dist' : '.',
);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};
const server = http.createServer(async (req, res) => {
  try {
    const requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (requested === '/api/gemini') {
      const controller = new AbortController();
      const disconnected = () => { if (!res.writableEnded) controller.abort(); };
      res.once('close', disconnected);
      const request = new Request(`http://${req.headers.host}${req.url}`, {
        method: req.method,
        headers: req.headers,
        signal: controller.signal,
        ...(!['GET', 'HEAD'].includes(req.method) ? { body: Readable.toWeb(req), duplex: 'half' } : {}),
      });
      const response = await gemini.fetch(request);
      res.removeListener('close', disconnected);
      if (res.destroyed) return;
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const file = path.resolve(root, '.' + (requested === '/' ? '/index.html' : requested));
    if (
      !file.startsWith(root + path.sep) ||
      requested.includes('node_modules') ||
      requested.includes('/.')
      || /^(?:api|server)(?:[\\/]|$)/.test(path.relative(root, file))
    ) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const info = await stat(file);
    if (!info.isFile()) throw Error('not a file');
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});
server.listen(Number(process.env.PORT) || 4173, '127.0.0.1', () =>
  console.log(
    `华文词语训练营: http://localhost:${Number(process.env.PORT) || 4173}${process.argv.includes('--dist') ? ' (dist)' : ''}`,
  ),
);
