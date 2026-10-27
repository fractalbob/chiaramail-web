// Serves the reader page (the web screens built with `npm run build:reader`
// at the top level) for paths the API doesn't use: /m/<id>, its scripts and
// styles. Every page path gets index.html; the screens route from there.
// outlook.html is the Outlook add-in, which Outlook shows in a frame;
// outlook-events.html is its send handler, which Outlook runs in a hidden one.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, normalize, extname, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
};
// Scripts and styles only from this server; the page talks only to this server;
// it can't be framed by another site.
const CSP = [
  "default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "font-src 'self' data:", "connect-src 'self'", "frame-src 'self' blob:",
  "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');
// The Outlook add-in (outlook.html) runs inside Outlook: Outlook frames it, and
// it loads Office.js from Microsoft, which reports to Microsoft's servers.
const OUTLOOK_HOSTS = 'https://*.office.com https://*.office365.com https://*.outlook.com https://*.live.com https://*.microsoft.com https://*.cloud.microsoft https://*.office.net';
const CSP_OUTLOOK = [
  "default-src 'self'", "script-src 'self' 'unsafe-inline' https://appsforoffice.microsoft.com", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:", "font-src 'self' data:", `connect-src 'self' ${OUTLOOK_HOSTS}`, `frame-src 'self' blob: ${OUTLOOK_HOSTS}`,
  "object-src 'none'", "base-uri 'none'", "form-action 'self'", `frame-ancestors 'self' ${OUTLOOK_HOSTS}`,
].join('; ');

export function staticSite(dir) {
  const root = normalize(dir);
  const fileAt = async (p) => {
    const f = normalize(join(root, p));
    if (f !== root && !f.startsWith(root + sep)) return null;
    try { return (await stat(f)).isFile() ? f : null; } catch { return null; }
  };
  /** Answers GET/HEAD for a page or file; false when there's nothing here for it. */
  return async function serve(req, res, path) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let p;
    try { p = decodeURIComponent(path); } catch { return false; }
    let file = p !== '/' && await fileAt(p);
    if (!file) {
      if (extname(p)) return false; // a missing file, not a page
      file = await fileAt('index.html');
      if (!file) return false;
    }
    const immutable = p.startsWith('/assets/'); // file names carry a hash of the content
    const addIn = file.endsWith(`${sep}outlook.html`) || file.endsWith(`${sep}outlook-events.html`);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'Content-Security-Policy': addIn ? CSP_OUTLOOK : CSP,
      'Referrer-Policy': 'no-referrer',
      ...(addIn ? {} : { 'X-Frame-Options': 'DENY' }),
    });
    if (req.method === 'HEAD') { res.end(); return true; }
    createReadStream(file).pipe(res);
    return true;
  };
}
