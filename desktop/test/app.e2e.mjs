// The desktop app end to end: the real Electron app, its screens built in
// desktop mode, against a real Dovecot + SMTP server. Run from the top level:
//   npm run build:desktop && xvfb-run -a node desktop/test/app.e2e.mjs [shotsDir]
import { _electron as electron } from 'playwright';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { ImapFlow } from 'imapflow';
import { startMailServer } from './mailserver.js';

const here = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(here, '..');
const require = createRequire(join(DESKTOP, 'package.json'));
const ELECTRON = require('electron'); // the binary's path
const SHOTS = process.argv[2] || null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const USERS = { 'bob@example.fr': 'bob-secret', 'alice@example.fr': 'alice-secret' };
const log = (m) => console.log(`✓ ${m}`);
const must = async (v, m) => { if (!(await v)) throw new Error(`FAILED: ${m}`); };

const srv = await startMailServer(USERS);
const userData = mkdtempSync(join(tmpdir(), 'cm-app-'));
const mail = (from, subject, body, id, extra = []) => [`From: ${from}`, 'To: Bob <bob@example.fr>', `Subject: ${subject}`,
  `Date: ${new Date().toUTCString()}`, `Message-ID: <${id}>`, ...extra, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: 8bit', '', body, ''].join('\r\n');
await srv.deliver('bob@example.fr', mail('Paul Martin <paul@studio.fr>', 'Tirages photo', 'Bonjour Bob,\n\nVoici les tailles des tirages : 30×40 et 50×70.\n\nPaul', 'p1@studio.fr'));
await srv.deliver('bob@example.fr', mail('Julia Köhler <julia@example.de>', 'Contrat signé', 'Le contrat est signé. Merci !', 'j1@example.de'));

let app; let page;
const launch = async () => {
  app = await electron.launch({
    // CHIARAMAIL_APP: test an installed/packaged app instead of the source.
    executablePath: process.env.CHIARAMAIL_APP || ELECTRON,
    args: process.env.CHIARAMAIL_APP ? ['--no-sandbox'] : ['--no-sandbox', DESKTOP],
    env: { ...process.env, CHIARAMAIL_USERDATA: userData, LANG: 'en_GB.UTF-8' },
  });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 860 });
};
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const fillServers = async () => {
  for (const [id, port] of [['imap', srv.imap.port], ['smtp', srv.smtp.port]]) {
    await page.locator(`#${id}-host`).fill('127.0.0.1');
    await page.locator(`#${id}-port`).fill(String(port));
    await page.locator(`#${id}-sec`).selectOption('none');
  }
};

try {
  await launch();
  await page.getByRole('heading', { name: 'Sign in to your mailbox' }).waitFor();
  await must(!(await page.getByText(/Gmail/).count()), 'no mention of Gmail on the sign-in screen');
  await shot('d01-signin');
  log('sign-in screen');

  // A domain with no published settings: the server fields open.
  await page.getByLabel('Email address').fill('bob@example.fr');
  await page.getByLabel('Password').fill('bob-secret');
  await page.getByLabel('Your name, as recipients see it').fill('Bob Uomini');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('alert').filter({ hasText: /couldn’t find the server settings/ }).waitFor({ timeout: 30_000 });
  await page.locator('#imap-host').waitFor();
  log('unknown provider: asks for the servers');

  // Wrong password: refused, explained.
  await fillServers();
  await page.getByLabel('Password').fill('wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('alert').filter({ hasText: /Incoming mail \(IMAP\): your provider refused/ }).first().waitFor({ timeout: 30_000 });
  await shot('d02-wrong-password');
  log('wrong password refused');

  await page.getByLabel('Password').fill('bob-secret');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Inbox' }).waitFor({ timeout: 30_000 });
  await page.locator('.trow', { hasText: 'Tirages photo' }).waitFor();
  await page.locator('.trow', { hasText: 'Contrat signé' }).waitFor();
  await must(page.locator('.trow-unread').count().then((n) => n === 2), 'both unread');
  await shot('d03-inbox');
  log('signed in; inbox shows the mail');

  await page.locator('.trow-link', { hasText: 'Tirages photo' }).click();
  await page.getByText('30×40 et 50×70').first().waitFor();
  await shot('d04-message');
  log('message opens, accents intact');

  // Reply from the desktop app: it reaches Paul's server copy in Sent, threaded.
  await page.getByRole('link', { name: 'Reply', exact: true }).first().click();
  await page.locator('.compose').waitFor();
  await must(page.getByText(/Changeable ECS messages aren’t available at the moment/).count(), 'ECS shown as coming soon');
  await page.getByLabel('Message', { exact: true }).click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('Merci Paul, le 50×70 me convient.');
  await shot('d05-reply');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForURL(/\/mail\/sent\//, { timeout: 30_000 });
  log('reply sent');

  // A new message to Alice.
  await page.getByRole('link', { name: 'Compose' }).click();
  await page.getByLabel('To', { exact: true }).fill('alice@example.fr');
  await page.getByLabel('Subject', { exact: true }).fill('Exposition à Albi');
  await page.getByLabel('Message', { exact: true }).click();
  await page.keyboard.type('Bonjour Alice, le vernissage est samedi à 18 h.');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForURL(/\/mail\/sent\//, { timeout: 30_000 });
  const c = new ImapFlow({ ...srv.imap, auth: { user: 'alice@example.fr', pass: USERS['alice@example.fr'] }, logger: false });
  await c.connect();
  let got = null;
  for (let i = 0; i < 20 && !got; i += 1) {
    const lock = await c.getMailboxLock('INBOX');
    try { for await (const m of c.fetch('1:*', { envelope: true, source: true })) if (m.envelope.subject === 'Exposition à Albi') got = m; } finally { lock.release(); }
    if (!got) await new Promise((r) => setTimeout(r, 250));
  }
  await c.logout();
  await must(got, 'Alice received the message');
  const src = got.source.toString();
  await must(/From: "Bob Uomini" <bob@example\.fr>/.test(src), 'sent from Bob with his name');
  log('new message delivered to Alice, from "Bob Uomini"');

  await page.getByRole('link', { name: /^Sent/ }).first().click();
  await page.locator('.trow', { hasText: 'Exposition à Albi' }).waitFor();
  await page.locator('.trow', { hasText: 'Tirages photo' }).waitFor();
  await shot('d06-sent');
  log('both in Sent');

  // Archive from the list: leaves the Inbox, stays in All mail.
  await page.getByRole('link', { name: /^Inbox/ }).first().click();
  await page.locator('.trow', { hasText: 'Contrat signé' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Archive/ }).click();
  await page.locator('.trow', { hasText: 'Contrat signé' }).waitFor({ state: 'detached' });
  log('archived');

  // Restart: still signed in, the password is not asked again.
  await app.close();
  const saved = JSON.parse(readFileSync(join(userData, 'account.json'), 'utf8'));
  await must(!JSON.stringify(saved).includes('bob-secret'), 'password not stored in clear');
  await launch();
  await page.getByRole('heading', { name: 'Inbox' }).waitFor({ timeout: 30_000 });
  await page.locator('.trow', { hasText: 'Tirages photo' }).waitFor();
  log('after a restart: straight to the inbox');

  // French.
  await page.getByRole('button', { name: 'Français' }).click().catch(() => {});
  if (await page.getByRole('heading', { name: 'Boîte de réception' }).count()) { await shot('d07-inbox-fr'); log('French'); }

  // Sign out: back to the sign-in screen, nothing kept.
  const out = page.getByRole('button', { name: /Sign out|Se déconnecter/ }).first();
  await out.click();
  await page.getByRole('heading', { name: /Sign in to your mailbox|Connectez votre messagerie/ }).waitFor();
  let left = true; try { readFileSync(join(userData, 'account.json')); } catch { left = false; }
  await must(!left, 'account forgotten on sign-out');
  log('signed out; account forgotten');
  console.log('\nAll desktop app checks passed.');
} catch (e) {
  await shot('d99-failure').catch(() => {});
  console.error(e);
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {});
  await srv.stop();
  rmSync(userData, { recursive: true, force: true });
}
