import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extname, join, normalize, sep } from 'node:path';
import { loadConfig } from './config.js';
import { createStore } from './data/store.js';
import { createAnalytics } from './analytics.js';
import { createRateLimiter } from './auth.js';
import { createApi, err } from './api.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

/** @type {Record<string, string>} */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; " +
    "base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

/**
 * @param {Partial<import('./config.js').Config>} [overrides]
 * @param {{ now?: () => Date }} [deps]
 */
export function createAppServer(overrides = {}, deps = {}) {
  const config = { ...loadConfig(), ...overrides };
  const store = createStore({ now: deps.now });
  const analytics = createAnalytics();
  const limiter = createRateLimiter();
  const api = createApi(config, store, analytics, limiter);

  /** @param {import('node:http').IncomingMessage} req */
  const clientId = (req) => {
    if (config.trustProxy) {
      const xf = req.headers['x-forwarded-for'];
      const first = (Array.isArray(xf) ? xf[0] : xf)?.split(',')[0]?.trim();
      if (first) return first.slice(0, 64);
    }
    return req.socket.remoteAddress ?? 'unknown';
  };

  /** @param {import('node:http').IncomingMessage} req */
  const readJson = (req) =>
    new Promise((resolve, reject) => {
      const type = String(req.headers['content-type'] ?? '');
      if (!type.startsWith('application/json')) {
        reject(new RangeError('Content-Type must be application/json.'));
        return;
      }
      /** @type {Buffer[]} */
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > config.maxBodyBytes) {
          reject(new RangeError('Request body too large.'));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new RangeError('Body is not valid JSON.'));
        }
      });
      req.on('error', () => reject(new RangeError('Request could not be read.')));
    });

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const method = req.method ?? 'GET';
      if (url.pathname.startsWith('/api/')) {
        const result = await api.handle({
          method,
          url,
          headers: req.headers,
          json: () => readJson(req),
          clientId: clientId(req),
        });
        const headers = { ...SECURITY_HEADERS, 'cache-control': 'no-store', ...result.headers };
        if (result.body === undefined) {
          res.writeHead(result.status, headers);
          res.end();
          return;
        }
        res.writeHead(result.status, {
          ...headers,
          'content-type': 'application/json; charset=utf-8',
        });
        res.end(JSON.stringify(result.body));
        return;
      }
      if (method !== 'GET' && method !== 'HEAD') {
        res.writeHead(405, { ...SECURITY_HEADERS, allow: 'GET, HEAD' });
        res.end();
        return;
      }
      await serveStatic(url.pathname, method === 'HEAD', res);
    } catch (e) {
      console.error('[server] unhandled', e instanceof Error ? e.message : 'unknown');
      if (!res.headersSent) {
        res.writeHead(500, { ...SECURITY_HEADERS, 'content-type': 'application/json' });
        res.end(JSON.stringify(err(500, 'internal_error', 'Internal server error.').body));
      } else res.end();
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return { server, config, store, analytics };
}

/** @param {string} pathname @param {boolean} headOnly @param {import('node:http').ServerResponse} res */
async function serveStatic(pathname, headOnly, res) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400, SECURITY_HEADERS);
    res.end();
    return;
  }
  if (rel.includes('\0')) {
    res.writeHead(400, SECURITY_HEADERS);
    res.end();
    return;
  }
  if (rel === '/') rel = '/index.html';
  const full = normalize(join(PUBLIC_DIR, rel));
  if (!full.startsWith(PUBLIC_DIR.endsWith(sep) ? PUBLIC_DIR : PUBLIC_DIR + sep)) {
    res.writeHead(403, SECURITY_HEADERS);
    res.end();
    return;
  }
  const type = MIME[extname(full)];
  if (!type || full.endsWith('tsconfig.json')) {
    res.writeHead(404, SECURITY_HEADERS);
    res.end();
    return;
  }
  try {
    const data = await readFile(full);
    res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': type, 'cache-control': 'no-cache' });
    res.end(headOnly ? undefined : data);
  } catch {
    res.writeHead(404, SECURITY_HEADERS);
    res.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { server, config } = createAppServer();
  server.listen(config.port, config.host, () => {
    console.log(`CopyCart listening on http://${config.host}:${config.port} (demo-data build)`);
  });
  for (const sig of ['SIGINT', 'SIGTERM'])
    process.on(sig, () => server.close(() => process.exit(0)));
}
