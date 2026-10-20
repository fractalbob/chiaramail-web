// Starts the ECS server from environment settings (see README.md):
//   DATABASE_URL   postgres://user:pass@host:5432/chiaramail
//   FILES_DIR      folder for attachments (default ./files)
//   PORT           default 8787 (listens on 127.0.0.1; nginx in front gives HTTPS)
//   SECRET         long random string (codes are hashed with it)
//   ORIGINS        allowed web origins, comma-separated (default app://chiaramail)
//   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, MAIL_FROM: for sign-in codes
//   TRUST_PROXY=1  when behind nginx (use X-Forwarded-For for rate limits)
//   READER_DIR     the reader page (default ../reader, built by `npm run build:reader` at the top level)
import { createServer } from 'node:http';
import { openDb } from './db.js';
import { fileStore } from './store.js';
import { smtpMailer } from './mailer.js';
import { createApp } from './app.js';
import { staticSite } from './static.js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const env = process.env;
const required = ['DATABASE_URL', 'SECRET', 'SMTP_HOST', 'MAIL_FROM'];
const missing = required.filter((k) => !env[k]);
if (missing.length) { console.error(`Missing settings: ${missing.join(', ')}`); process.exit(1); }

const READER = env.READER_DIR || fileURLToPath(new URL('../reader', import.meta.url));
const db = await openDb(env.DATABASE_URL);
const app = createApp({
  db,
  store: fileStore(env.FILES_DIR || './files'),
  mailer: smtpMailer({ host: env.SMTP_HOST, port: env.SMTP_PORT || 465, secure: env.SMTP_SECURE ?? 'true', user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.MAIL_FROM }),
  origins: (env.ORIGINS || 'app://chiaramail').split(',').map((s) => s.trim()).filter(Boolean),
  secret: env.SECRET,
  trustProxy: env.TRUST_PROXY === '1',
  site: existsSync(READER) ? staticSite(READER) : null,
});
const port = Number(env.PORT || 8787);
const server = createServer(app);
server.requestTimeout = 10 * 60_000; // large uploads on slow connections
server.listen(port, env.HOST || '127.0.0.1', () => console.log(`ChiaraMail ECS server on ${env.HOST || '127.0.0.1'}:${port}`));
const stop = () => server.close(() => db.close().then(() => process.exit(0)));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
