// ECS messages between two desktop app users through the European ECS server
// (server/), all real: Dovecot + SMTP for mail, PostgreSQL, the ECS server,
// and the Electron app. Run from the top level:
//   npm run build:desktop && xvfb-run -a node desktop/test/ecs.e2e.mjs [shotsDir]
import { _electron as electron } from 'playwright';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startMailServer } from './mailserver.js';
import { ImapFlow } from 'imapflow';

const here = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(here, '..');
const SERVER = join(DESKTOP, '..', 'server');
const require = createRequire(join(DESKTOP, 'package.json'));
const ELECTRON = require('electron');
const { startPostgres } = await import(join(SERVER, 'test', 'pg.js'));
const { openDb } = await import(join(SERVER, 'src', 'db.js'));
const { fileStore } = await import(join(SERVER, 'src', 'store.js'));
const { smtpMailer } = await import(join(SERVER, 'src', 'mailer.js'));
const { createApp } = await import(join(SERVER, 'src', 'app.js'));

const SHOTS = process.argv[2] || null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const USERS = { 'bob@example.fr': 'bob-secret', 'alice@example.fr': 'alice-secret', 'codes@ecs.test': 'codes-secret' };
const log = (m) => console.log(`✓ ${m}`);
const must = async (v, m) => { if (!(await v)) throw new Error(`FAILED: ${m}`); };

const mail = await startMailServer(USERS);
const pg = await startPostgres();
const db = await openDb(pg.url);
const files = mkdtempSync(join(tmpdir(), 'cm-ecsfiles-'));
const ecs = createServer(createApp({
  db, store: fileStore(files), origins: ['app://chiaramail'],
  mailer: smtpMailer({ host: mail.smtp.host, port: mail.smtp.port, secure: false, user: 'codes@ecs.test', pass: USERS['codes@ecs.test'], from: 'ChiaraMail <codes@ecs.test>' }),
}));
await new Promise((r) => ecs.listen(0, '127.0.0.1', r));
const ECS_URL = `http://127.0.0.1:${ecs.address().port}`;
const downloads = mkdtempSync(join(tmpdir(), 'cm-dl-'));
const dataDirs = { bob: mkdtempSync(join(tmpdir(), 'cm-bob-')), alice: mkdtempSync(join(tmpdir(), 'cm-alice-')) };

let app; let page; let who;
async function open(name) {
  if (app) await app.close();
  who = name;
  app = await electron.launch({
    // CHIARAMAIL_APP: test an installed/packaged app instead of the source.
    executablePath: process.env.CHIARAMAIL_APP || ELECTRON,
    args: process.env.CHIARAMAIL_APP ? ['--no-sandbox'] : ['--no-sandbox', DESKTOP],
    env: { ...process.env, CHIARAMAIL_USERDATA: dataDirs[name], CHIARAMAIL_ECS_URL: ECS_URL, CHIARAMAIL_READER_ORIGIN: 'https://lire.chiaramail.test', CHIARAMAIL_DOWNLOADS: downloads, LANG: 'en_GB.UTF-8' },
  });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 900 });
  page.on('pageerror', (e) => console.error(`[${name}] page error:`, e.message));
}
const shot = async (n) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${n}.png` }); };
async function signIn(email, name) {
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(USERS[email]);
  await page.getByLabel('Your name, as recipients see it').fill(name);
  await page.getByRole('button', { name: /Server settings/ }).click();
  for (const [id, port] of [['imap', mail.imap.port], ['smtp', mail.smtp.port]]) {
    await page.locator(`#${id}-host`).fill('127.0.0.1');
    await page.locator(`#${id}-port`).fill(String(port));
    await page.locator(`#${id}-sec`).selectOption('none');
  }
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Inbox' }).waitFor({ timeout: 30_000 });
}
const openRow = (text) => page.locator('.trow-link', { hasText: text }).first().click();

try {
  // ---- Bob signs in; the app signs in to the ECS server by itself.
  await open('bob');
  await signIn('bob@example.fr', 'Bob Uomini');
  await page.getByRole('link', { name: 'Compose' }).click();
  await page.getByLabel(/^ECS message/).waitFor({ timeout: 60_000 });
  await must(page.getByLabel(/^ECS message/).isChecked(), 'ECS on by default for a new message');
  log('signed in to the ECS server by itself (code read from the inbox)');
  await page.getByRole('link', { name: /^Inbox/ }).first().click();
  await must(!(await page.locator('.trow', { hasText: 'your code' }).count()), 'the code email was deleted');
  log('the code email was removed from the inbox');

  // ---- Bob sends Alice an ECS message with an attachment.
  const attachment = join(dataDirs.bob, 'devis.txt');
  writeFileSync(attachment, 'Devis : 3 tirages 50×70, 450 €\n');
  await page.getByRole('link', { name: 'Compose' }).click();
  await page.getByLabel('To', { exact: true }).fill('alice@example.fr');
  await page.getByLabel('Subject', { exact: true }).fill('Tirages pour l’exposition');
  await page.getByLabel('Message', { exact: true }).fill('Bonjour Alice,\n\nLes tirages seront prêts jeudi.\n\nBob');
  await page.locator('input[type=file]').setInputFiles(attachment);
  await shot('e01-bob-compose');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForURL(/\/mail\/sent\//, { timeout: 30_000 });
  await page.waitForTimeout(3000);
  {
    const c = new ImapFlow({ ...mail.imap, auth: { user: 'bob@example.fr', pass: USERS['bob@example.fr'] }, logger: false });
    await c.connect();
    const st = await c.status('Drafts', { messages: true });
    const subjects = [];
    if (st.messages) { const l = await c.getMailboxLock('Drafts'); try { for await (const m of c.fetch('1:*', { envelope: true, flags: true })) subjects.push(`${m.envelope.subject} ${[...m.flags]}`); } finally { l.release(); } }
    await c.logout();
    await must(st.messages === 0, `no draft left after sending (${subjects.join('; ')})`);
  }
  log('no draft left behind');
  await page.locator('.live-block').waitFor();
  await page.locator('.live-block').getByText('Les tirages seront prêts jeudi.').first().waitFor();
  await shot('e02-bob-sent');
  await must(page.locator('.mcard').count().then((n) => n === 1), 'one message in the conversation');
  await page.getByRole('button', { name: 'Edit' }).waitFor();
  log('ECS message sent; Bob sees it live with Edit');

  // What the server holds: ciphertext only.
  const row = (await db.query('SELECT * FROM messages')).rows[0];
  const stored = JSON.stringify(row) + readdirSync(join(files, row.id)).map((f) => readFileSync(join(files, row.id, f)).toString('latin1')).join('');
  for (const plain of ['Tirages', 'prêts jeudi', 'devis.txt', 'Devis', '450']) await must(!stored.includes(plain), `server must not hold "${plain}"`);
  await must(row.enc === 1 && row.sender_email === 'bob@example.fr' && row.recipients.join() === 'alice@example.fr', 'envelope as expected');
  log('the server holds only ciphertext (no subject, text, file name or file content)');

  // ---- Alice reads it.
  await open('alice');
  await signIn('alice@example.fr', 'Alice Martin');
  await page.locator('.trow', { hasText: 'Tirages pour l’exposition' }).locator('.subj-verified').waitFor({ timeout: 60_000 });
  await shot('e03-alice-inbox');
  log('Alice’s inbox: verified ECS message (green subject)');
  await openRow('Tirages pour l’exposition');
  await page.getByText('Les tirages seront prêts jeudi.').waitFor();
  await must(!(await page.getByRole('button', { name: 'Edit' }).count()), 'recipient has no Edit');
  await page.locator('.verified-mark').waitFor();
  await page.locator('.live-block').getByRole('button', { name: /devis\.txt/ }).click();
  const saved = join(downloads, 'devis.txt');
  for (let i = 0; i < 50 && !existsSync(saved); i += 1) await page.waitForTimeout(200);
  await must(existsSync(saved) && readFileSync(saved, 'utf8').startsWith('Devis : 3 tirages 50×70'), 'attachment decrypts and saves to Downloads');
  await shot('e04-alice-reads');
  log('Alice reads it and downloads the attachment');
  await page.waitForTimeout(1500); // the read receipt

  // ---- Bob sees the receipt and corrects the message.
  await open('bob');
  await page.getByRole('heading', { name: 'Inbox' }).waitFor({ timeout: 30_000 });
  await page.getByRole('link', { name: /^Sent/ }).first().click();
  await openRow('Tirages pour l’exposition');
  await page.locator('.live-details summary', { hasText: 'Readers' }).waitFor({ timeout: 30_000 });
  await page.locator('.live-details summary', { hasText: 'Readers' }).click();
  await page.getByText('read the latest edition').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.locator('.live-edit [role=textbox]').fill('Bonjour Alice,\n\nCorrection : les tirages seront prêts vendredi.\n\nBob');
  await page.getByRole('button', { name: 'Save new edition' }).click();
  await page.getByText('Edition 2 saved.').waitFor();
  await shot('e05-bob-edited');
  log('Bob sees Alice read it, then saves edition 2');

  // ---- Alice sees the correction.
  await open('alice');
  await page.getByRole('heading', { name: 'Inbox' }).waitFor({ timeout: 30_000 });
  await openRow('Tirages pour l’exposition');
  await page.getByText('Correction : les tirages seront prêts vendredi.').waitFor({ timeout: 30_000 });
  await page.getByText('Updated since you last read it').waitFor();
  await shot('e06-alice-sees-update');
  log('Alice sees the corrected edition, marked as updated');

  // ---- Bob withdraws it; Alice can no longer read it.
  await open('bob');
  await page.getByRole('heading', { name: 'Inbox' }).waitFor({ timeout: 30_000 });
  await page.getByRole('link', { name: /^Sent/ }).first().click();
  await openRow('Tirages pour l’exposition');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /^Withdraw/ }).click();
  await page.getByText(/withdrew this message/).first().waitFor({ timeout: 30_000 });
  await must((await db.query('SELECT withdrawn, body FROM messages')).rows[0].withdrawn === true, 'withdrawn on the server');
  await must(readdirSync(files).length === 0, 'attachment files deleted');
  log('Bob withdraws it: text wiped and files deleted on the server');
  await open('alice');
  await page.getByRole('heading', { name: 'Inbox' }).waitFor({ timeout: 30_000 });
  await openRow('Tirages pour l’exposition');
  await page.getByText(/withdrew this message/).first().waitFor({ timeout: 30_000 });
  await must(!(await page.getByText('prêts vendredi').count()), 'withdrawn text gone');
  await shot('e07-alice-withdrawn');
  log('Alice sees it was withdrawn');
  console.log('\nAll ECS checks passed.');
} catch (e) {
  await shot(`e99-failure-${who}`).catch(() => {});
  console.error(e);
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {});
  await new Promise((r) => ecs.close(r));
  await db.close();
  await pg.stop();
  await mail.stop();
  for (const d of [files, downloads, ...Object.values(dataDirs)]) rmSync(d, { recursive: true, force: true });
}
