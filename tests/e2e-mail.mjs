// Browser walkthrough of the mail client against the stand-ins
// (npm run build:mock && npx vite preview), e.g. BASE=http://localhost:4174 node tests/e2e-mail.mjs shots
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4173';
const SHOTS = process.argv[2] || 'shots';
const log = (...a) => console.log('✔', ...a);
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'en-GB', acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|images\.example|net::/.test(m.text())) errors.push(m.text()); });
page.on('dialog', (d) => d.accept());
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
const must = async (cond, msg) => { if (!(await cond)) throw new Error(msg); };
const waitValue = async (loc, pred, msg) => {
  for (let i = 0; i < 50; i += 1) { if (pred(await loc.inputValue())) return; await page.waitForTimeout(100); }
  throw new Error(msg);
};

async function connectAs(email) {
  await page.goto(BASE + '/');
  const out = page.locator('.mail-bar').getByRole('button', { name: 'Sign out' });
  if (await out.count()) { await out.click(); }
  await page.getByLabel('Test-mode address').fill(email);
  await page.getByRole('button', { name: 'Connect Gmail' }).click();
  await page.getByRole('heading', { name: 'Inbox' }).waitFor();
}
const send = async () => {
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForURL(/\/mail\/sent\//);
  await page.locator('.mcard').first().waitFor();
};
const openRow = (text) => page.locator('.trow-link', { hasText: text }).first().click();
// The pointer an ECS email with this subject carries, read from the test-mode mailbox.
const pointerFor = (subject) => page.evaluate((subj) => {
  const s = JSON.parse(localStorage.getItem('chiaramail.mock.gmail'));
  for (const box of Object.values(s.boxes)) {
    for (const m of Object.values(box.messages)) {
      const h = Object.fromEntries(m.payload.headers.map((x) => [x.name.toLowerCase(), x.value]));
      if (h.subject === subj && h['x-chiaramail-content-pointer']) return h['x-chiaramail-content-pointer'];
    }
  }
  return null;
}, subject);
// The decryption key an ECS email carries, read from the test-mode mailbox.
const keyFor = (ptr) => page.evaluate((p) => {
  const s = JSON.parse(localStorage.getItem('chiaramail.mock.gmail'));
  for (const box of Object.values(s.boxes)) {
    for (const m of Object.values(box.messages)) {
      const h = Object.fromEntries(m.payload.headers.map((x) => [x.name.toLowerCase(), x.value]));
      if (h['x-chiaramail-content-pointer'] === p && h['x-chiaramail-content-key']) return h['x-chiaramail-content-key'];
    }
  }
  return null;
}, ptr);

// ---- landing
await page.goto(BASE + '/');
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await page.goto(BASE + '/');
await page.getByRole('heading', { name: /change after sending/ }).waitFor();
await shot('m01-landing'); log('landing');

// ---- Alice's inbox
await connectAs('alice@example.com');
await page.locator('.trow').nth(2).waitFor();
await must(page.locator('.trow-unread', { hasText: 'Fractal Forums Digest' }).count(), 'newsletter should be unread');
await must((await page.locator('.folder', { hasText: 'Inbox' }).innerText()).includes('1'), 'inbox unread count');
await shot('m02-inbox'); log('inbox with seed mail, unread count');

// HTML mail, images held back
await openRow('Fractal Forums Digest');
await page.getByText('Images from the web are hidden').waitFor();
const frame = page.frameLocator('.htmlbody iframe');
await frame.getByText('Read the digest').waitFor();
await must((await frame.locator('img').first().getAttribute('src')) === null, 'remote image should be blocked');
await shot('m03-html-mail');
await page.getByRole('button', { name: 'Show images' }).click();
await must((await frame.locator('img').first().getAttribute('src'))?.startsWith('https://'), 'image shown after click');
log('HTML mail sanitised, remote images blocked until asked');
await page.getByRole('link', { name: 'Back' }).click();
await must(!(await page.locator('.trow-unread', { hasText: 'Fractal Forums Digest' }).count()), 'opening marks read');

// attachment download
await openRow('Marie Dupont');
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /liste\.txt/ }).click()]);
await must(dl.suggestedFilename() === 'liste.txt', 'download name');
log('attachment downloads');
await page.getByRole('link', { name: 'Back' }).click();

// ---- Drafts
const draftsFolder = page.locator('.folder', { hasText: 'Drafts' });
await must((await draftsFolder.innerText()).includes('1'), 'drafts count 1');
await draftsFolder.click();
await page.locator('.trow', { hasText: 'Framing quote' }).locator('.draft-tag').waitFor();
await page.locator('.trow-link', { hasText: 'Framing quote' }).click();
await page.locator('.rchip', { hasText: 'paul@atelier.example' }).waitFor();
await waitValue(page.getByLabel('Subject', { exact: true }), (v) => v === 'Framing quote', 'draft subject loaded');
await waitValue(page.getByLabel('Message', { exact: true }), (v) => v.startsWith('Hi Paul'), 'draft body loaded');
await page.getByLabel('Message', { exact: true }).press('End');
await page.getByLabel('Message', { exact: true }).pressSequentially(' three oak frames, 60 x 90 cm.');
await page.getByText('Draft saved').waitFor({ timeout: 10000 });
log('draft resumed and auto-saved');
await draftsFolder.click();
await page.locator('.trow', { hasText: 'three oak frames' }).waitFor();
await must((await page.locator('.trow').count()) === 1, 'still one draft after editing');

// a new message, left unfinished
await page.getByRole('link', { name: 'Compose' }).click();
await page.getByRole('combobox', { name: 'To' }).fill('bob@example.com');
await page.getByLabel('Subject', { exact: true }).fill('Unfinished thought');
await page.getByLabel('Message', { exact: true }).fill('Half a sentence');
await page.getByText('Draft saved').waitFor({ timeout: 10000 });
await page.locator('.folder', { hasText: 'Inbox' }).click();
await draftsFolder.click();
await page.locator('.trow', { hasText: 'Unfinished thought' }).waitFor();
await must((await draftsFolder.innerText()).includes('2'), 'drafts count 2');
log('new message auto-saved as a draft when left');
await page.locator('.trow-link', { hasText: 'Unfinished thought' }).click();
await waitValue(page.getByLabel('Message', { exact: true }), (v) => v === 'Half a sentence', 'unfinished draft loaded');
await must(page.getByLabel(/^ECS message/).isChecked(), 'draft remembers changeable');
await page.getByRole('button', { name: 'Discard' }).click();
await draftsFolder.click();
await page.locator('.trow').first().waitFor();
await must(!(await page.locator('.trow', { hasText: 'Unfinished thought' }).count()), 'discard deletes draft');
log('discard deletes the draft');

// send a draft
await page.locator('.trow-link', { hasText: 'Framing quote' }).click();
await waitValue(page.getByLabel('Subject', { exact: true }), (v) => v === 'Framing quote', 'draft loaded for sending');
await page.getByLabel(/^ECS message/).uncheck();
await send();
await page.getByText('three oak frames').waitFor();
await draftsFolder.click();
await page.getByText('No drafts.').waitFor();
log('sending a draft removes it from Drafts');

// a reply left as a draft shows in the conversation
await page.locator('.folder', { hasText: 'Inbox' }).click();
await openRow('Paul Martin');
await page.getByRole('link', { name: 'Reply', exact: true }).last().click();
await page.locator('.rchip', { hasText: 'paul@atelier.example' }).waitFor();
await page.getByLabel('Message', { exact: true }).press('Control+Home');
await page.getByLabel('Message', { exact: true }).pressSequentially('Draft reply about sizes. ');
await page.getByText('Draft saved').waitFor({ timeout: 10000 });
await page.goBack();
await page.locator('.mcard-draft').waitFor();
await page.getByRole('button', { name: 'Continue editing' }).click();
await waitValue(page.getByLabel('Message', { exact: true }), (v) => v.startsWith('Draft reply about sizes.'), 'reply draft resumed');
await waitValue(page.getByLabel('Subject', { exact: true }), (v) => v.startsWith('Re: Print sizes'), 'reply subject kept');
await shot('m04d-draft-reply');
await page.getByRole('button', { name: 'Discard' }).click();
await page.locator('.thread-subject').waitFor();
await page.waitForTimeout(300);
await page.reload();
await page.locator('.thread-subject').waitFor();
await must(!(await page.locator('.mcard-draft').count()), 'reply draft discarded');
log('reply drafts appear in the conversation, resume and discard');
await page.getByRole('link', { name: 'Back' }).click();

// ---- Alice sends an ECS message with an attachment
writeFileSync(`${SHOTS}/agenda.txt`, 'Ordre du jour\n1. Budget\n2. Exposition\n');
await page.getByRole('link', { name: 'Compose' }).click();
await page.getByLabel('To', { exact: true }).fill('Bob <bob@example.com>, carol@example.com');
await page.getByLabel('Subject', { exact: true }).fill('Committee meeting on Thursday');
await page.getByLabel('Message', { exact: true }).fill('Hi both,\n\nThe committee meets on Thursday at 18:00 in the library.\n\nAlice');
await must(page.getByLabel(/^ECS message/).isChecked(), 'ECS on by default for new mail');
await must(!(await page.getByLabel(/Let recipients forward it/).isChecked()), 'forwarding off by default');
await page.locator('input[type=file]').setInputFiles(`${SHOTS}/agenda.txt`);
await shot('m04-compose');
await send();
await page.locator('.live-block').waitFor();
await page.getByText('First edition').waitFor();
await page.getByRole('button', { name: 'Edit' }).waitFor();
await page.locator('.live-block').getByRole('button', { name: /agenda\.txt/ }).waitFor();
await must((await page.getByRole('button', { name: /agenda\.txt/ }).count()) === 1, 'attachment shown once, from ChiaraMail');
const mailbox = await page.evaluate(() => localStorage.getItem('chiaramail.mock.gmail'));
await must(!mailbox.includes('agenda.txt') && !mailbox.includes('Ordre du jour') && !mailbox.includes('T3JkcmUgZHUgam91c'), 'attachment not in the email');
log('ECS message sent; sender sees live block with Edit and the stored attachment');
const stored = await page.evaluate(() => (localStorage.getItem('chiaramail.mock.db') || '') + (localStorage.getItem('chiaramail.mock.files') || ''));
for (const plain of ['committee meets', 'Committee meeting', 'agenda.txt', 'text/plain', 'T3JkcmUgZHUgam91c']) {
  await must(!stored.includes(plain), `stored data must not contain "${plain}"`);
}
await must(stored.includes('"enc":1'), 'message marked as encrypted');
log('ChiaraMail stores only ciphertext: no text, subject, file name, type or file content');

// and an ordinary message
await page.getByRole('link', { name: 'Compose' }).click();
// Recipient chips and suggestions: Paul (from Sent mail) and Bob (written to just now)
const toBox = page.getByRole('combobox', { name: 'To' });
const chips = page.locator('.rfield', { has: page.locator('#to') }).locator('.rchip');
await toBox.pressSequentially('pau');
await page.getByRole('option', { name: /Paul Martin/ }).waitFor();
await shot('m04b-suggestions');
await toBox.press('Escape');
await toBox.fill('');
await toBox.pressSequentially('bo');
await page.getByRole('option', { name: /bob@example\.com/ }).waitFor();
await toBox.press('Enter');
await chips.filter({ hasText: 'bob@example.com' }).waitFor();
await must((await toBox.inputValue()) === '', 'input cleared after picking');
await toBox.pressSequentially('pa');
await page.getByRole('option', { name: /Paul Martin/ }).click();
await chips.filter({ hasText: 'Paul Martin' }).waitFor();
await toBox.pressSequentially('not-an-address,');
await page.locator('.rchip-bad', { hasText: 'not-an-address' }).waitFor();
await shot('m04c-chips');
await toBox.press('Backspace');
await must((await chips.count()) === 2, 'backspace removes last chip');
await page.getByRole('button', { name: /Remove Paul Martin/ }).click();
await must((await chips.count()) === 1, 'x removes a chip');
await page.getByRole('button', { name: 'Bcc' }).click();
await page.getByRole('combobox', { name: 'Bcc' }).waitFor();
log('recipient chips: suggestions, Enter/click/comma to add, Backspace and × to remove, invalid flagged');

await page.getByLabel(/^ECS message/).uncheck();
await page.getByLabel('Subject', { exact: true }).fill('Ordinary note');
await page.getByLabel('Message', { exact: true }).fill('Just a normal email.');
await send();
await page.getByText('Just a normal email.').waitFor();
await must(!(await page.locator('.live-block').count()), 'ordinary mail has no live block');
log('ordinary message sent');

// ---- Bob reads it inline and replies
await connectAs('bob@example.com');
await page.locator('.trow', { hasText: 'Committee meeting' }).locator('.live').waitFor();
await page.locator('.trow', { hasText: 'Committee meeting' }).locator('.subj-verified').waitFor();
await page.locator('.trow', { hasText: 'Committee meeting' }).locator('.ecs-user').first().waitFor();
await shot('m05-bob-inbox');
log('inbox: green subject for a verified ECS message, magenta for an ECS user');
await openRow('Committee meeting');
await page.getByText('The committee meets on Thursday at 18:00').waitFor();
await must(!(await page.getByRole('button', { name: 'Edit' }).count()), 'recipient has no Edit');
await page.getByText('The sender can see when you last opened this message.').waitFor();
const [ecsDl] = await Promise.all([page.waitForEvent('download'), page.locator('.live-block').getByRole('button', { name: /agenda\.txt/ }).click()]);
await must(ecsDl.suggestedFilename() === 'agenda.txt', 'ECS attachment download name');
await must((await (await import('node:fs')).readFileSync(await ecsDl.path(), 'utf8')).startsWith('Ordre du jour'), 'ECS attachment content');
log('recipient downloads the attachment from ChiaraMail');
await shot('m06-bob-reads-live');
log('recipient sees live text inline, no edit controls');
await page.locator('.verified-mark', { hasText: 'Verified sender' }).waitFor();
await page.locator('.mfrom .ecs-user', { hasText: 'alice@example.com' }).waitFor();
log('verified sender (green) and ECS user (magenta) in the message');
await page.getByRole('link', { name: 'Reply', exact: true }).last().click();
await page.locator('.rfield', { has: page.locator('#to') }).locator('.rchip', { hasText: 'alice@example.com' }).waitFor();
await must((await page.getByLabel('Subject', { exact: true }).inputValue()) === 'Re: Committee meeting on Thursday', 'reply subject');
await must(!(await page.getByLabel(/^ECS message/).isChecked()), 'replies default to ordinary');
await waitValue(page.getByLabel('Message', { exact: true }), (v) => v.includes('> The committee meets on Thursday'), 'reply quotes live text');
await page.getByLabel('Message', { exact: true }).press('Control+Home');
await page.getByLabel('Message', { exact: true }).type('Thursday works for me. ');
await send();
await page.getByText('Thursday works for me.').waitFor();
log('reply sent in the same conversation');

// Forwarding not allowed yet: Forward is greyed out on Alice's message
await page.getByRole('link', { name: 'Back' }).click();
await page.locator('.folder', { hasText: 'Inbox' }).click();
await openRow('Committee meeting');
await page.getByText('The sender doesn’t allow this message to be forwarded.').waitFor();
await must(page.locator('.mcard').first().getByRole('button', { name: 'Forward' }).isDisabled(), 'forward disabled');
log('forwarding blocked by default for recipients');

// Alice allows forwarding
await connectAs('alice@example.com');
await openRow('Committee meeting');
await page.getByLabel('Recipients may forward this message').check();
await page.waitForTimeout(300);
log('sender switches forwarding on');

// Bob forwards it to Dave (not a recipient)
await connectAs('bob@example.com');
await openRow('Committee meeting');
await must(!(await page.getByText('The sender doesn’t allow this message to be forwarded.').count()), 'forward now allowed');
await page.getByRole('link', { name: 'Forward' }).first().click();
await waitValue(page.getByLabel('Subject', { exact: true }), (v) => v.startsWith('Fwd:'), 'forward prefilled');
await page.locator('.compose .chip', { hasText: 'agenda.txt' }).waitFor();
await page.getByLabel('To', { exact: true }).fill('dave@example.com');
await send();
await page.locator('.mcard').first().waitFor();
log('forwarded to an outsider');

// ---- Alice edits
await connectAs('alice@example.com');
await openRow('Committee meeting');
await page.getByText('Thursday works for me.').waitFor();
await page.locator('.live-details summary', { hasText: 'Readers' }).click();
await page.getByText('read the latest edition').waitFor();
await page.getByRole('button', { name: 'Edit' }).click();
await page.locator('.live-edit textarea').fill('Hi both,\n\nChange of plan: the committee meets on Friday at 18:00 in the library.\n\nAlice');
await page.getByRole('button', { name: 'Save new edition' }).click();
await page.getByText('Edition 2 saved.').waitFor();
await page.getByText('Edition 2', { exact: true }).waitFor();
await shot('m07-alice-edited');
log('sender edits in place → edition 2');
await page.locator('.live-details summary', { hasText: 'Editions' }).click();
await page.locator('.editions summary', { hasText: 'Edition 1' }).click();
await page.locator('.editions').getByText('The committee meets on Thursday').waitFor();
log('edition history decrypts for the sender');

// ---- Bob sees the update
await connectAs('bob@example.com');
await openRow('Committee meeting');
await page.getByText('Updated since you last read it').waitFor();
await page.getByText('Change of plan: the committee meets on Friday').waitFor();
await page.waitForTimeout(1200);
await shot('m08-bob-sees-update');
log('recipient sees edition 2 with "updated" banner');

// ---- Carol (first read) and Dave (outsider)
await connectAs('carol@example.com');
await openRow('Committee meeting');
await page.getByText('Change of plan').waitFor();
await must(!(await page.getByText('Updated since you last read it').count()), 'no banner on first read');
log('second recipient sees latest edition');
await connectAs('dave@example.com');
await openRow('Committee meeting');
await page.getByText('The committee meets on Thursday').first().waitFor();
await must(!(await page.getByText('Change of plan').count()), 'outsider must not see later live edits');
await must(!(await page.locator('.live-block').count()), 'forward is an ordinary email');
await page.getByRole('button', { name: /agenda\.txt/ }).waitFor();
log('forward carries the stored attachment as a normal one');
const pointer = await pointerFor('Committee meeting on Thursday');
const fallbackHref = `${BASE}/m/${pointer}`;
const ecsKey = await keyFor(pointer);
await must(ecsKey && ecsKey.length === 43, 'the email carries the key');
await page.goto(fallbackHref);
await page.getByText('This message isn’t addressed to dave@example.com.').waitFor();
await must(!(await page.getByText('Change of plan').count()), 'outsider blocked on the web page too');
log('forwarded copy holds the text as forwarded; later edits and the live page stay private');

// fallback web page for a recipient (Carol) without ChiaraMail inbox view
await connectAs('carol@example.com');
await page.goto(fallbackHref);
await page.getByText('This ECS message is encrypted. Open it with the “Read the message” button').waitFor();
await must(!(await page.getByText('Change of plan').count()), 'no key, no content');
log('web page without the key: content stays locked');
await page.goto(`${fallbackHref}#k=${ecsKey}`);
await page.getByText('Change of plan').waitFor();
const [webDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /agenda\.txt/ }).click()]);
await must(webDl.suggestedFilename() === 'agenda.txt', 'attachment on the web page');
await shot('m09-web-page');
log('link fallback page works for a recipient, with the attachment');

// ---- Eve forges an ECS message "from Alice" using content she stored herself
await connectAs('eve@example.com');
await page.getByRole('link', { name: 'Compose' }).click();
await page.getByLabel('To', { exact: true }).fill('bob@example.com');
await page.getByLabel('Subject', { exact: true }).fill('Hello from Eve');
await page.getByLabel('Message', { exact: true }).fill('Please update your bank details here: https://evil.example');
await send();
const evePtr = await pointerFor('Hello from Eve');
const eveKey = await keyFor(evePtr);
await page.evaluate(([ptr, key]) => window.__mockGmail.sendRaw([
  'From: Alice <alice@example.com>', 'To: bob@example.com', 'Subject: Urgent: new bank details',
  `X-ChiaraMail-Content-Pointer: ${ptr}`, `X-ChiaraMail-Content-Key: ${key}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', '', 'Read the message in ChiaraMail.', '',
].join('\r\n')), [evePtr, eveKey]);
await connectAs('bob@example.com');
const forged = page.locator('.trow', { hasText: 'Urgent: new bank details' });
await forged.locator('.subj-spoof').waitFor();
await forged.locator('.spoof-tag').waitFor();
await must(!(await forged.locator('.ecs-user').count()), 'no magenta on a forgery');
await must(!(await page.locator('.trow', { hasText: 'Hello from Eve' }).locator('.subj-spoof').count()), 'Eve’s own message is not flagged');
await shot('m09b-forged-inbox');
await openRow('Urgent: new bank details');
await page.getByText('Warning: this message may be forged.').waitFor();
await page.getByText('It claims to be from alice@example.com, but its content was stored by eve@example.com.').waitFor();
await must(!(await page.locator('.verified-mark').count()), 'no verified mark on a forgery');
await must(!(await page.locator('.mfrom .ecs-user').count()), 'no magenta sender on a forgery');
await shot('m09c-forged-message');
log('forged ECS message flagged red in the list and in the message');
await page.getByRole('link', { name: 'Back' }).click();

// ---- everyday actions as Bob
await connectAs('bob@example.com');
await page.locator('.trow').first().waitFor();
await page.locator('.trow', { hasText: 'Ordinary note' }).getByRole('button', { name: 'Star' }).click();
await page.locator('.folder', { hasText: 'Starred' }).click();
await page.locator('.trow', { hasText: 'Ordinary note' }).waitFor();
log('star → Starred folder');
await page.getByLabel('Search mail').fill('liste');
await page.getByLabel('Search mail').press('Enter');
await page.getByRole('heading', { name: /Results for/ }).waitFor();
await page.locator('.trow', { hasText: 'Liste pour samedi' }).waitFor();
log('search');
await openRow('Liste pour samedi');
await page.getByRole('button', { name: 'Delete' }).click();
await page.locator('.folder', { hasText: 'Inbox' }).click();
await page.locator('.trow').first().waitFor();
await must(!(await page.locator('.trow', { hasText: 'Liste pour samedi' }).count()), 'trashed thread gone from inbox');
await page.locator('.folder', { hasText: 'Trash' }).click();
await openRow('Liste pour samedi');
await page.getByRole('button', { name: 'Restore' }).click();
await page.locator('.folder', { hasText: 'Inbox' }).click();
await page.locator('.trow', { hasText: 'Liste pour samedi' }).waitFor();
log('delete → trash → restore');

// ---- Alice withdraws
await connectAs('alice@example.com');
await openRow('Committee meeting');
await page.getByRole('button', { name: 'Withdraw' }).click();
await page.getByText(/You withdrew this message/).waitFor();
await connectAs('bob@example.com');
await openRow('Committee meeting');
await page.getByText(/withdrew this message on/).waitFor();
await must(!(await page.getByText('Change of plan').count()), 'withdrawn text gone');
await must(!(await page.getByRole('button', { name: /agenda\.txt/ }).count()), 'withdrawn attachment gone');
await must(!(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('chiaramail.mock.files') || '{}')).length)), 'stored files erased on withdraw');
log('withdraw erases the live text for readers');

// French + mobile dark
await page.getByRole('button', { name: 'Français' }).click();
await page.getByRole('link', { name: 'Retour' }).waitFor();
await page.getByRole('button', { name: 'English' }).click();
log('French UI');
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 2, locale: 'en-GB' });
const mp = await mobile.newPage();
await mp.goto(BASE + '/');
await mp.evaluate(([l]) => { for (const [k, v] of Object.entries(l)) localStorage.setItem(k, v); }, [await page.evaluate(() => ({ ...localStorage }))]);
await mp.evaluate(() => sessionStorage.setItem('chiaramail.mock.gmailSession', 'bob@example.com'));
await mp.goto(BASE + '/mail/inbox');
await mp.locator('.trow').first().waitFor();
await mp.screenshot({ path: `${SHOTS}/m10-mobile-inbox.png`, fullPage: true });
await mp.getByRole('button', { name: 'Menu' }).click();
await mp.screenshot({ path: `${SHOTS}/m11-mobile-menu.png` });
await mp.getByRole('button', { name: 'Menu' }).click();
await mp.locator('.trow-link', { hasText: 'Committee' }).click();
await mp.locator('.thread-subject').waitFor();
await mp.screenshot({ path: `${SHOTS}/m12-mobile-thread.png`, fullPage: true });
await must(!(await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'no horizontal scroll on mobile');
log('mobile dark, no horizontal scroll');

if (errors.length) { console.log('Browser errors:', errors); process.exitCode = 1; } else log('no console errors');
await browser.close();
