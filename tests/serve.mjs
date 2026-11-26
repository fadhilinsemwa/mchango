// A tiny static file server for the browser tests (and for trying the page by hand):
//   node tests/serve.mjs [port] [folder] [prefix]
// `prefix` serves the same files under a sub-path, e.g. /mchango/, as a fork would.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.txt': 'text/plain; charset=utf-8',
};

/** Start serving `root` under `prefix`. Returns { server, port, url, setRoot }. */
export function serve({ root, prefix = '/', port = 0 }) {
  let folder = resolve(root);
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (req.method !== 'GET' || !path.startsWith(prefix)) {
      res.writeHead(404).end('not found');
      return;
    }
    let rel = normalize(path.slice(prefix.length));
    if (rel === '.' || rel === '' || rel.endsWith('/')) rel = join(rel, 'index.html');
    const file = join(folder, rel);
    if (!file.startsWith(folder)) {
      res.writeHead(403).end('no');
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-cache',
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok) => {
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      ok({
        server,
        port: actual,
        url: `http://127.0.0.1:${actual}${prefix}`,
        setRoot: (next) => {
          folder = resolve(next);
        },
      });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [port = '8080', root = '.', prefix = '/'] = process.argv.slice(2);
  const s = await serve({ root, prefix, port: Number(port) });
  console.log('serving', s.url);
}
