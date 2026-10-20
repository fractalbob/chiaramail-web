// Timing on a Gmail-sized account: 30,000 Inbox messages and 500 folders, behind a
// relay that delays every exchange by 60 ms each way (like France to Gmail), while
// another client keeps changing flags. Run: node desktop/test/perf.mjs
// (N, F, D change the message count, the folder count and the delay.)
import { startMailServer } from './mailserver.js';
import { MailService } from '../main/mail/service.js';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { ImapFlow } from 'imapflow';

const N = Number(process.env.N || 30000); const FOLDERS = Number(process.env.F || 500); const DELAY = Number(process.env.D || 60);
const srv = await startMailServer({ 'b@x.fr': 'x' });
const md = join(srv.root, 'mail', 'b@x.fr');
const put = (dir, n, subj) => {
  for (const d of ['cur', 'new', 'tmp']) mkdirSync(join(dir, d), { recursive: true });
  for (let i = 0; i < n; i += 1) {
    writeFileSync(join(dir, 'cur', `${1500000000 + i}.M${i}P1.host:2,${i % 3 ? 'S' : ''}`),
      `From: P ${i % 500} <p${i % 500}@ex.fr>\r\nTo: b@x.fr\r\nSubject: ${subj} ${i}\r\nDate: ${new Date(Date.UTC(2015, 0, 1) + i * 3600_000).toUTCString()}\r\nMessage-ID: <${subj}${i}@ex.fr>\r\nContent-Type: text/plain\r\n\r\nBonjour ${i}\r\n`);
  }
};
put(md, N, 'inbox');
put(join(md, '.Sent'), 3000, 'sent');
for (let k = 0; k < FOLDERS; k += 1) put(join(md, `.Label${k}`), 20, `l${k}`);
execFileSync('chown', ['-R', 'vmail:vmail', md]);

const relay = net.createServer((a) => {
  const b = net.connect(srv.imap.port, '127.0.0.1');
  a.on('data', (d) => setTimeout(() => b.write(d), DELAY));
  b.on('data', (d) => setTimeout(() => a.write(d), DELAY));
  a.on('close', () => b.destroy()); b.on('close', () => a.destroy());
  a.on('error', () => {}); b.on('error', () => {});
}).listen(0, '127.0.0.1');
await new Promise((r) => relay.once('listening', r));
const s = new MailService({ email: 'b@x.fr', imap: { host: '127.0.0.1', port: relay.address().port, secure: false }, smtp: srv.smtp, auth: { user: 'b@x.fr', pass: 'x' }, dataDir: mkdtempSync(join(tmpdir(), 'perf-')) });
const T = async (label, p) => {
  const t = Date.now();
  try { const r = await p; console.log(`${label}: ${Date.now() - t} ms`); return r; } catch (e) { console.log(`${label}: ERROR ${e.message}`); return null; }
};
// What the app asks for when it starts, all at once.
const startup = () => [s.listLabels(), s.getLabel('INBOX'), s.getLabel('SPAM'), s.getLabel('DRAFT'), s.listThreads({ labelId: 'SPAM', q: '"ECS message"', max: 20 }), s.recentAddresses('in:sent', 100)];

await T('open', s.open());
startup();
const r = await T('first inbox list', s.listThreads({ labelId: 'INBOX', max: 25 }));
await T('previews of 25', s.getThreadsMeta(r.ids));
const other = new ImapFlow({ ...srv.imap, auth: { user: 'b@x.fr', pass: 'x' }, logger: false });
await other.connect();
let stop = false;
(async () => {
  for (let i = 1; !stop; i += 1) {
    const l = await other.getMailboxLock('INBOX');
    try { await other.messageFlagsAdd(String(i), ['\\Flagged']); } finally { l.release(); }
    await new Promise((x) => setTimeout(x, 300));
  }
})();
for (let round = 1; round <= 3; round += 1) {
  await new Promise((x) => setTimeout(x, 11_000));
  startup();
  await T(`round ${round}: inbox list`, s.listThreads({ labelId: 'INBOX', max: 25 }));
}
await T('page 2', s.listThreads({ labelId: 'INBOX', max: 25, pageToken: '25' }));
await T('open a label', s.listThreads({ labelId: (await s.listLabels()).find((l) => l.name === 'Label7').id, max: 25 }));
stop = true;
await other.logout(); await s.close(); relay.close(); await srv.stop();
