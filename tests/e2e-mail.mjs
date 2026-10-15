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
  for (let i = 0; i < 50; i += 1) { if (pred(await loc.evaluate((e) => (e.isContentEditable ? e.innerText.replace(/\n+$/, '') : e.value)))) return; await page.waitForTimeout(100); }
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
// Ordinary emails written in ChiaraMail are HTML (they can carry formatting), so they show in the sandboxed frame.
const inMail = (txt) => page.frameLocator('.htmlbody iframe').last().getByText(txt).first().waitFor();
const openRow = (text) => page.locator('.trow-link', { hasText: text }).first().click();
// Every MIME part of the emails with this subject: [{ type, text }].
const partsOf = (subject) => page.evaluate((subj) => {
  const s = JSON.parse(localStorage.getItem('chiaramail.mock.gmail'));
  const dec = (d) => decodeURIComponent(escape(atob(d.replace(/-/g, '+').replace(/_/g, '/'))));
  const out = [];
  const walk = (part) => { if (part.body?.data) out.push({ type: part.mimeType, text: dec(part.body.data) }); (part.parts || []).forEach(walk); };
  for (const box of Object.values(s.boxes)) for (const m of Object.values(box.messages)) {
    if (m.payload.headers.some((h) => h.name.toLowerCase() === 'subject' && h.value === subj)) walk(m.payload);
  }
  return out;
}, subject);
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
await page.getByRole('heading', { name: /Own the email you send/ }).waitFor();
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
await page.getByRole('button', { name: 'Show images', exact: true }).click();
await must((await frame.locator('img').first().getAttribute('src'))?.startsWith('https://'), 'image shown after click');
log('HTML mail sanitised, remote images blocked until asked');
// "Always show images": reopening shows them without asking; unticking the setting hides them again
await page.getByRole('link', { name: 'Back' }).click();
await openRow('Fractal Forums Digest');
await page.getByText('Images from the web are hidden').waitFor(); // a one-off "Show images" isn't remembered
await page.locator('.imgbar').getByRole('button', { name: 'Always show images' }).click();
await page.locator('.imgbar').waitFor({ state: 'detached' });
await must((await frame.locator('img').first().getAttribute('src'))?.startsWith('https://'), 'image shown once always is on');
await page.getByRole('link', { name: 'Back' }).click();
await openRow('Fractal Forums Digest');
await frame.getByText('Read the digest').waitFor();
await must(!(await page.locator('.imgbar').count()), 'no prompt with always-show on');
await must((await frame.locator('img').first().getAttribute('src'))?.startsWith('https://'), 'image shown automatically');
await page.getByRole('checkbox', { name: 'Always show images' }).uncheck();
await page.getByText('Images from the web are hidden').waitFor();
log('"Always show images" remembered; untick in Settings to ask again');
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
await inMail('three oak frames');
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
await page.getByText(/ECS attachments you have stored: .* of your 1 GB\. Up to 25 MB per file/).waitFor();
// over the sender's allowance: refused, with an explanation
await page.evaluate(() => localStorage.setItem('chiaramail.mock.quota', '10'));
await page.getByRole('button', { name: 'Send' }).click();
await page.getByRole('alert').filter({ hasText: /would go over your 1 KB for ECS attachments/ }).waitFor();
await page.evaluate(() => localStorage.removeItem('chiaramail.mock.quota'));
log('ECS attachment allowance: usage shown, sending over it refused');
await shot('m04-compose');
await send();
const usedAfter = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('chiaramail.mock.db')).usage || {})[0]);
await must(usedAfter > 0, 'files counted against the allowance');
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
await toBox.pressSequentially('alic');
await page.getByRole('option', { name: /alice@example\.com/ }).waitFor(); // your own address too, as in Gmail
await toBox.press('Escape');
await toBox.fill('');
await page.getByRole('button', { name: 'Bcc' }).click();
await page.getByRole('combobox', { name: 'Bcc' }).waitFor();
log('recipient chips: suggestions, Enter/click/comma to add, Backspace and × to remove, invalid flagged');

await page.getByLabel(/^ECS message/).uncheck();
await page.getByLabel('Subject', { exact: true }).fill('Ordinary note');
await page.getByLabel('Message', { exact: true }).fill('Just a normal email.');
await send();
await inMail('Just a normal email.');
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
await waitValue(page.getByLabel('Message', { exact: true }), (v) => v.includes('The committee meets on Thursday'), 'reply quotes live text');
await page.getByLabel('Message', { exact: true }).press('Control+Home');
await page.getByLabel('Message', { exact: true }).type('Thursday works for me. ');
await send();
await inMail('Thursday works for me.');
log('reply sent in the same conversation');

// Forwarding not allowed yet: Forward is greyed out on Alice's message
await page.getByRole('link', { name: 'Back' }).click();
await page.locator('.folder', { hasText: 'Inbox' }).click();
await openRow('Committee meeting');
await page.getByText('The sender doesn’t allow this message to be forwarded.').waitFor();
await page.locator('.mcard').first().getByRole('button', { name: 'More' }).click();
await must(page.getByRole('menuitem', { name: 'Forward', exact: true }).isDisabled(), 'forward disabled');
await must(page.getByRole('menuitem', { name: 'Forward as attachment' }).isDisabled(), 'forward as attachment disabled');
await page.keyboard.press('Escape');
await page.getByRole('link', { name: 'Back' }).click();
await page.locator('.trow', { hasText: 'Committee meeting' }).click({ button: 'right' });
await page.getByRole('menu', { name: 'Conversation menu' }).getByRole('menuitem', { name: 'Forward as attachment' }).click();
await page.getByRole('alert').filter({ hasText: /forward/i }).waitFor();
await must(page.getByRole('button', { name: /Send|Loading/ }).isDisabled(), 'forward as attachment blocked too');
await page.goBack();
await openRow('Committee meeting');
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
await page.locator('.mcard').first().getByRole('button', { name: 'More' }).click(); // Alice's ECS message, not the latest reply
await page.getByRole('menuitem', { name: 'Forward', exact: true }).click();
await waitValue(page.getByLabel('Subject', { exact: true }), (v) => v.startsWith('Fwd:'), 'forward prefilled');
await page.locator('.compose .chip', { hasText: 'agenda.txt' }).waitFor();
await page.getByLabel('To', { exact: true }).fill('dave@example.com');
await send();
await page.locator('.mcard').first().waitFor();
log('forwarded to an outsider');
// Gmail layout: a reply arrow in every message's header, one row of big buttons under the last message
await must(await page.locator('.mcard:not(.mcard-collapsed)').count() === await page.locator('.mhead-actions').getByRole('link', { name: 'Reply', exact: true }).count(), 'reply arrow in each open message');
await must(await page.locator('.mactions').count() === 1, 'one row of Reply / Forward buttons, under the last message');
await must(!(await page.locator('.toolbar').getByRole('link', { name: 'Reply', exact: true }).count()), 'no Reply in the top toolbar');
log('Gmail layout: reply arrow and ⋮ per message, big buttons only at the bottom');

// ---- Alice edits
await connectAs('alice@example.com');
await openRow('Committee meeting');
await inMail('Thursday works for me.');
await page.locator('.live-details summary', { hasText: 'Readers' }).click();
await page.getByText('read the latest edition').waitFor();
await page.getByRole('button', { name: 'Edit' }).click();
await page.locator('.live-edit [role=textbox]').fill('Hi both,\n\nChange of plan: the committee meets on Friday at 18:00 in the library.\n\nAlice');
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
await inMail('The committee meets on Thursday');
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
// …and invites the reader to get ChiaraMail; so does the email itself
const mailText = await page.evaluate((p) => {
  const s = JSON.parse(localStorage.getItem('chiaramail.mock.gmail'));
  const dec = (d) => decodeURIComponent(escape(atob(d.replace(/-/g, '+').replace(/_/g, '/'))));
  const out = [];
  const walk = (part) => { if (part.body?.data) out.push(dec(part.body.data)); (part.parts || []).forEach(walk); };
  for (const box of Object.values(s.boxes)) for (const m of Object.values(box.messages)) {
    if (m.payload.headers.some((h) => h.name.toLowerCase() === 'x-chiaramail-content-pointer' && h.value === p)) walk(m.payload);
  }
  return out.join('\n');
}, pointer);
await must(/sent you a message: “Committee meeting on Thursday”/.test(mailText), 'the email reads like a personal note');
await must(!mailText.includes('Send your own ECS messages') && !mailText.includes('padding:10px'), 'no promotional line or styled button in the email (spam filters)');
await page.getByRole('heading', { name: 'Send your own ECS messages' }).waitFor();
await page.getByRole('link', { name: 'Get ChiaraMail' }).click();
await page.waitForURL((u) => u.pathname === '/' || u.pathname.startsWith('/mail')); // the app's home (signed-in readers go on to their mail)
log('the email is a plain personal note; the reading page invites readers to get ChiaraMail');

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
// Deleting the words by hand keeps the results (to type a new search)…
const sbox = page.getByLabel('Search mail');
await sbox.click();
await sbox.press('Control+a');
await sbox.press('Backspace');
await page.waitForTimeout(300);
await must(/[?&]q=/.test(page.url()), 'results stay while retyping');
// …and so does the box's ×, as in Gmail: it only empties the box.
await sbox.fill('liste');
await sbox.press('Enter');
await page.getByRole('heading', { name: /Results for/ }).waitFor();
await page.getByRole('button', { name: 'Clear search' }).click();
await must((await sbox.inputValue()) === '', 'box empty after ×');
await must(await sbox.evaluate((e) => e === document.activeElement), 'box keeps the focus after ×');
await page.waitForTimeout(300);
await must(/[?&]q=/.test(page.url()), 'results stay after ×');
await page.getByRole('heading', { name: /Results for/ }).waitFor();
// Escape leaves the search, like ←.
await sbox.press('Escape');
await page.getByRole('heading', { name: 'Inbox' }).waitFor();
await must(!(await sbox.inputValue()), 'search box empty after Escape');
log('× only empties the search box; Escape returns to the inbox');
// Gmail's ←: appears when the box is touched, and always goes back to the whole inbox.
await must(!(await page.getByRole('button', { name: 'Back to Inbox' }).count()), 'no ← before the box is touched');
await sbox.click();
await page.getByRole('button', { name: 'Back to Inbox' }).waitFor();
await sbox.fill('liste');
await sbox.press('Enter');
await page.getByRole('heading', { name: /Results for/ }).waitFor();
await page.getByRole('button', { name: 'Back to Inbox' }).click();
await page.getByRole('heading', { name: 'Inbox' }).waitFor();
await must(!(await sbox.inputValue()), 'box empty after ←');
await page.waitForTimeout(200);
await must(!(await page.getByRole('button', { name: 'Back to Inbox' }).count()), '← goes away afterwards');
log('← in the search box returns to the inbox');
await sbox.fill('liste');
await sbox.press('Enter');
await page.getByRole('heading', { name: /Results for/ }).waitFor();
await sbox.press('Escape');
await page.getByRole('heading', { name: 'Inbox' }).waitFor();
log('Escape in the search box returns to the inbox');
await sbox.fill('liste');
await sbox.press('Enter');
await page.locator('.trow', { hasText: 'Liste pour samedi' }).waitFor();
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
// Gmail-style checkboxes: tick two rows, delete them together, restore them together
await page.locator('.trow', { hasText: 'Liste pour samedi' }).locator('.rowcheck').check();
await page.locator('.trow', { hasText: 'Ordinary note' }).locator('.rowcheck').check();
await page.getByText('2 selected').waitFor();
// The toolbar stays at the top while the list scrolls (short window so the page can scroll).
{
  const vp = page.viewportSize();
  await page.setViewportSize({ width: vp.width, height: 360 });
  await page.mouse.wheel(0, 3000);
  await page.waitForTimeout(300);
  await must((await page.evaluate(() => scrollY)) > 0, 'page scrolled');
  await must(Math.abs(await page.locator('.list-head').evaluate((e) => e.getBoundingClientRect().top)) < 2, 'toolbar stays at the top');
  await must(await page.getByRole('button', { name: 'Delete' }).first().isVisible(), 'actions still reachable after scrolling');
  await page.evaluate(() => scrollTo(0, 0));
  await page.setViewportSize(vp);
}
log('selection toolbar stays at the top while scrolling');
await shot('m13-bulk-select');
await page.locator('.bulkbar').getByRole('button', { name: 'Delete' }).click();
await page.locator('.bulkbar').waitFor({ state: 'detached' });
await page.locator('.working').waitFor({ state: 'detached' });
await must(!(await page.locator('.trow', { hasText: 'Liste pour samedi' }).count()), 'bulk delete removed row 1');
await must(!(await page.locator('.trow', { hasText: 'Ordinary note' }).count()), 'bulk delete removed row 2');
await page.locator('.folder', { hasText: 'Trash' }).click();
await page.locator('.trow', { hasText: 'Ordinary note' }).waitFor();
await page.getByRole('checkbox', { name: 'Select all' }).check();
await page.locator('.bulkbar').getByRole('button', { name: 'Restore' }).click();
await page.locator('.bulkbar').waitFor({ state: 'detached' });
await page.locator('.working').waitFor({ state: 'detached' });
await page.locator('.folder', { hasText: 'Inbox' }).click();
await page.locator('.trow', { hasText: 'Liste pour samedi' }).waitFor();
await page.locator('.trow', { hasText: 'Ordinary note' }).waitFor();
log('checkboxes: select several, delete together, select all in Trash, restore together');
// A note to yourself is ONE message marked Sent and Inbox — Restore must bring it back to the Inbox
await page.getByRole('link', { name: 'Compose' }).click();
await page.getByLabel('To', { exact: true }).fill('bob@example.com');
await page.getByLabel('Subject', { exact: true }).fill('Note to self');
await page.getByLabel('Message', { exact: true }).fill('Remember the milk.');
await send();
await page.locator('.folder', { hasText: 'Inbox' }).click();
await page.locator('.trow', { hasText: 'Note to self' }).locator('.rowcheck').check();
await page.locator('.bulkbar').getByRole('button', { name: 'Delete' }).click();
await page.locator('.bulkbar').waitFor({ state: 'detached' });
await page.locator('.working').waitFor({ state: 'detached' });
await page.locator('.folder', { hasText: 'Trash' }).click();
await page.locator('.trow', { hasText: 'Note to self' }).locator('.rowcheck').check();
await page.locator('.bulkbar').getByRole('button', { name: 'Restore' }).click();
await page.locator('.bulkbar').waitFor({ state: 'detached' });
await page.locator('.working').waitFor({ state: 'detached' });
await page.locator('.folder', { hasText: 'Inbox' }).click();
await page.locator('.trow', { hasText: 'Note to self' }).waitFor();
// …while mail you only sent goes back to Sent, not the Inbox
const sentSubj = 'Outgoing only, for the restore test';
await page.getByRole('link', { name: 'Compose' }).click();
await page.getByLabel('To', { exact: true }).fill('dave@example.com');
await page.getByLabel('Subject', { exact: true }).fill(sentSubj);
await page.getByLabel('Message', { exact: true }).fill('Nothing to see here.');
await send();
await page.locator('.folder', { hasText: 'Sent' }).click();
await page.locator('.trow', { hasText: sentSubj }).locator('.rowcheck').check();
await page.locator('.bulkbar').getByRole('button', { name: 'Delete' }).click();
await page.locator('.bulkbar').waitFor({ state: 'detached' });
await page.locator('.working').waitFor({ state: 'detached' });
await page.locator('.folder', { hasText: 'Trash' }).click();
await page.locator('.trow', { hasText: sentSubj }).locator('.rowcheck').check();
await page.locator('.bulkbar').getByRole('button', { name: 'Restore' }).click();
await page.locator('.bulkbar').waitFor({ state: 'detached' });
await page.locator('.working').waitFor({ state: 'detached' });
await page.locator('.folder', { hasText: 'Sent' }).click();
await page.locator('.trow', { hasText: sentSubj }).waitFor();
await page.locator('.folder', { hasText: 'Inbox' }).click();
await page.locator('.list-title', { hasText: 'Inbox' }).waitFor();
await page.locator('.trow', { hasText: 'Note to self' }).waitFor(); // the Inbox itself has loaded
await must(!(await page.locator('.trow', { hasText: sentSubj }).count()), 'sent-only mail not pushed into the Inbox');
log('restore: note to self returns to Inbox; sent-only mail returns to Sent only');

// ---- Gmail-style toolbar: select ▾ menu, icon actions, Label as / Move to, "1–N of total"
await must(/^1–\d+ of \d+$/.test(await page.locator('.range').innerText()), 'range "1–N of total"');
const unreadRows = await page.locator('.trow-unread').count();
await page.getByRole('button', { name: 'Select', exact: true }).click();
await page.getByRole('menuitem', { name: 'Unread' }).click();
await must(unreadRows === 0 ? !(await page.locator('.bulkbar').count()) : (await page.locator('.trow-selected').count()) === unreadRows, 'select ▾ Unread ticks the unread rows');
await page.getByRole('button', { name: 'Select', exact: true }).click();
await page.getByRole('menuitem', { name: 'None' }).click();
await page.locator('.bulkbar').waitFor({ state: 'detached' });
await page.locator('.trow', { hasText: 'Ordinary note' }).locator('.rowcheck').check();
await page.locator('.bulkbar').getByRole('button', { name: 'Label as' }).click();
await shot('m14-label-as');
await page.getByRole('menuitemcheckbox', { name: 'Fractals', exact: true }).click();
await page.locator('.working').waitFor({ state: 'detached' });
await page.locator('.folder', { hasText: 'Fractals' }).click();
await page.locator('.trow', { hasText: 'Ordinary note' }).waitFor();
await page.locator('.trow', { hasText: 'Ordinary note' }).locator('.rowcheck').check();
await page.locator('.bulkbar').getByRole('button', { name: 'Move to' }).click();
await page.getByRole('menuitem', { name: 'Inbox' }).click();
await page.locator('.working').waitFor({ state: 'detached' });
await must(!(await page.locator('.trow', { hasText: 'Ordinary note' }).count()), 'Move to Inbox takes it out of the label');
await page.locator('.folder', { hasText: 'Inbox' }).click();
await page.locator('.trow', { hasText: 'Ordinary note' }).waitFor();
await page.locator('.trow', { hasText: 'Ordinary note' }).locator('.rowcheck').check();
await page.locator('.bulkbar').getByRole('button', { name: 'More' }).click();
await page.getByRole('menuitem', { name: 'Mark as important' }).click();
await page.locator('.working').waitFor({ state: 'detached' });
if (await page.locator('.trow-unread').count()) {
  await page.locator('.list-tools').getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Mark all as read' }).click();
  await page.locator('.working').waitFor({ state: 'detached' });
  await must(!(await page.locator('.trow-unread').count()), 'mark all as read');
}
await shot('m15-toolbar');
// "New label…": create a label from ChiaraMail and apply it in one go.
await page.locator('.trow', { hasText: 'Ordinary note' }).locator('.rowcheck').check();
await page.locator('.bulkbar').getByRole('button', { name: 'Label as' }).click();
page.removeAllListeners('dialog');
page.once('dialog', (d) => d.accept('Estate firms'));
await page.getByRole('menuitem', { name: 'New label…' }).click();
await page.locator('.folder', { hasText: 'Estate firms' }).waitFor();
page.on('dialog', (d) => d.accept());
await page.locator('.working').waitFor({ state: 'detached' });
await page.locator('.folder', { hasText: 'Estate firms' }).click();
await page.locator('.trow', { hasText: 'Ordinary note' }).waitFor();
// From an open message: typing an existing name reuses that label instead of making a second one.
await page.locator('.trow-link', { hasText: 'Ordinary note' }).click();
await page.locator('.thread-subject').waitFor();
await page.getByRole('button', { name: 'Label as' }).click();
await must(await page.getByRole('menuitemcheckbox', { name: 'Estate firms' }).isVisible(), 'new label listed when reading');
page.removeAllListeners('dialog');
page.once('dialog', (d) => d.accept('estate FIRMS'));
await page.getByRole('menuitem', { name: 'New label…' }).click();
await page.waitForTimeout(500);
page.on('dialog', (d) => d.accept());
await must((await page.locator('.folder', { hasText: /^Estate firms/i }).count()) === 1, 'no duplicate label');
await page.locator('.folder', { hasText: 'Inbox' }).click();
log('New label… creates a Gmail label and applies it; an existing name is reused');
log('toolbar: select ▾ menu, Label as, Move to, ⋮ Mark as important, Mark all as read, 1–N of total');

// ---- Verified ECS messages are rescued from Spam; forgeries and reported ones stay
const toSpam = (subj) => page.evaluate((sj) => {
  const st = JSON.parse(localStorage.getItem('chiaramail.mock.gmail'));
  const box = st.boxes['bob@example.com'];
  for (const m of Object.values(box.messages)) {
    if (m.payload.headers.some((h) => h.name === 'Subject' && h.value === sj)) m.labelIds = [...m.labelIds.filter((l) => l !== 'INBOX'), 'SPAM'];
  }
  localStorage.setItem('chiaramail.mock.gmail', JSON.stringify(st));
}, subj);
await toSpam('Hello from Eve');                 // verified sender
await toSpam('Urgent: new bank details');       // forged
await page.reload();
await page.locator('.trow', { hasText: 'Hello from Eve' }).waitFor({ timeout: 10000 }); // back in the Inbox
await page.locator('.folder', { hasText: 'Spam' }).click();
await page.locator('.list-title', { hasText: 'Spam' }).waitFor();
await page.locator('.trow', { hasText: 'Urgent: new bank details' }).waitFor();
await must(!(await page.locator('.trow', { hasText: 'Hello from Eve' }).count()), 'verified ECS message left Spam');
// …and once the user reports it as spam themselves, it stays there
await page.locator('.folder', { hasText: 'Inbox' }).click();
await page.locator('.trow', { hasText: 'Hello from Eve' }).locator('.rowcheck').check();
await page.locator('.bulkbar').getByRole('button', { name: 'Report spam' }).click();
await page.locator('.working').waitFor({ state: 'detached' });
await page.reload();
await page.locator('.trow').first().waitFor();
await page.waitForTimeout(1500);
await must(!(await page.locator('.trow', { hasText: 'Hello from Eve' }).count()), 'reported ECS message stays in Spam');
await page.locator('.folder', { hasText: 'Spam' }).click();
await page.locator('.trow', { hasText: 'Hello from Eve' }).locator('.rowcheck').check();
await page.locator('.bulkbar').getByRole('button', { name: 'Not spam' }).click();
await page.locator('.working').waitFor({ state: 'detached' });
await page.locator('.folder', { hasText: 'Inbox' }).click();
await page.locator('.trow').first().waitFor();
log('verified ECS messages come back from Spam; forged and user-reported ones stay');

// ---- Sidebar: Important, categories, foldable label tree
await page.locator('.trow', { hasText: 'Liste pour samedi' }).getByRole('button', { name: 'Mark as important' }).click();
await page.locator('.trow', { hasText: 'Liste pour samedi' }).locator('.imp-on').waitFor();
await page.locator('.folder', { hasText: 'Important' }).click();
await page.locator('.list-title', { hasText: 'Important' }).waitFor();
await page.locator('.trow', { hasText: 'Print sizes for the exhibition' }).waitFor();
await page.locator('.trow', { hasText: 'Liste pour samedi' }).waitFor();
await must(await page.locator('.trow .imp-on').count() === await page.locator('.trow').count(), 'blue importance markers in Important');
log('importance markers: shown on important rows, click to toggle');
await page.locator('.folder', { hasText: 'Updates' }).click();
await page.getByRole('heading', { name: 'Updates' }).waitFor();
await page.locator('.trow', { hasText: 'deep zooms' }).waitFor();
await must(!(await page.locator('.folder', { hasText: 'Purchases' }).count()), 'only categories the account has');
await page.getByRole('button', { name: 'Hide Categories' }).click();
await page.locator('.folder', { hasText: 'Updates' }).waitFor({ state: 'detached' });
await page.getByRole('button', { name: 'Show Categories' }).click();
await page.locator('.folder', { hasText: 'Julia sets' }).click();
await page.locator('.trow', { hasText: 'Print sizes for the exhibition' }).waitFor();
await shot('m18-sidebar');
await page.getByRole('button', { name: 'Hide Fractals' }).click();
await page.locator('.folder', { hasText: 'Julia sets' }).waitFor({ state: 'detached' });
await page.reload();
await page.locator('.folder', { hasText: 'Exhibitions' }).waitFor();
await must(!(await page.locator('.folder', { hasText: 'Julia sets' }).count()), 'folded label stays folded after reload');
await page.getByRole('button', { name: 'Show Fractals' }).click();
await page.locator('.folder', { hasText: 'Julia sets' }).waitFor();
await page.locator('.folder', { hasText: 'Inbox' }).click();
await page.locator('.trow').first().waitFor();
log('sidebar: Important, categories (foldable), nested labels fold and stay folded');

// ---- Right-click menu on a row
const rowMenu = page.getByRole('menu', { name: 'Conversation menu' });
const ordinary = page.locator('.trow', { hasText: 'Ordinary note' });
await ordinary.click({ button: 'right' });
await rowMenu.waitFor();
await page.screenshot({ path: `${SHOTS}/m17-right-click.png` }); // not full-page: resizing the window closes the menu
await must(await rowMenu.getByRole('menuitem', { name: 'Forward as attachment' }).count() === 1, 'Forward as attachment in the menu');
await rowMenu.getByRole('menuitem', { name: 'Mark unread' }).click();
await rowMenu.waitFor({ state: 'detached' });
await page.locator('.trow-unread', { hasText: 'Ordinary note' }).waitFor();
await page.locator('.working').waitFor({ state: 'detached' });
await ordinary.click({ button: 'right' });
await rowMenu.getByRole('menuitem', { name: 'Label as' }).hover();
await rowMenu.getByRole('menuitemcheckbox', { name: 'Fractals', exact: true }).click();
await page.locator('.working').waitFor({ state: 'detached' });
await page.locator('.folder', { hasText: 'Fractals' }).click();
await page.locator('.trow', { hasText: 'Ordinary note' }).waitFor();
log('right-click: Mark unread, Label as ▸');
await page.locator('.trow', { hasText: 'Ordinary note' }).click({ button: 'right' });
await rowMenu.getByRole('menuitem', { name: /Find emails from alice@example\.com/ }).click();
await page.getByRole('heading', { name: /Results for/ }).waitFor();
await must((await page.getByLabel('Search mail').inputValue()) === 'from:alice@example.com', 'search box shows the query');
await page.locator('.trow', { hasText: 'Ordinary note' }).waitFor();
await page.locator('.trow', { hasText: 'Ordinary note' }).click({ button: 'right' });
await rowMenu.getByRole('menuitem', { name: 'Find emails with this subject' }).click();
await page.waitForFunction(() => document.getElementById('search').value.startsWith('subject:'));
await page.waitForFunction(() => document.querySelectorAll('.trow').length === 1, null, { timeout: 5000 }).catch(() => { throw new Error('subject search finds just that conversation'); });
await page.locator('.trow', { hasText: 'Ordinary note' }).waitFor();
log('right-click: Find emails from the sender / with this subject (search box follows)');
await page.locator('.trow', { hasText: 'Ordinary note' }).click({ button: 'right' });
await rowMenu.getByRole('menuitem', { name: 'Forward as attachment' }).click();
await page.getByRole('heading', { name: 'Forward as attachment' }).waitFor();
await page.locator('.attachments .chip', { hasText: 'Ordinary note.eml' }).waitFor();
await must((await page.getByLabel('Subject', { exact: true }).inputValue()).startsWith('Fwd'), 'Fwd: subject');
await page.getByLabel('To', { exact: true }).fill('dave@example.com');
await send();
await connectAs('dave@example.com');
await openRow('Ordinary note');
await page.getByRole('button', { name: /Ordinary note\.eml/ }).waitFor();
log('right-click: Forward as attachment sends the conversation as an .eml file');
await connectAs('bob@example.com');
await page.locator('.trow').first().waitFor();
const [popup] = await Promise.all([page.waitForEvent('popup'), (async () => {
  await page.locator('.trow', { hasText: 'Ordinary note' }).click({ button: 'right' });
  await rowMenu.getByRole('menuitem', { name: 'Open in new window' }).click();
})()]);
await popup.getByRole('heading', { name: 'Ordinary note' }).waitFor();
await popup.close();
log('right-click: Open in new window');

// ---- An ECS message can be just an attachment, with no text
await page.getByRole('link', { name: 'Compose' }).click();
await page.getByLabel('To', { exact: true }).fill('dave@example.com');
await page.getByLabel('Subject', { exact: true }).fill('Just the file');
await page.locator('input[type=file]').setInputFiles(`${SHOTS}/agenda.txt`);
await send();
await page.locator('.live-block').getByRole('button', { name: /agenda\.txt/ }).waitFor();
await page.getByRole('button', { name: 'Withdraw' }).click();
await page.getByText(/You withdrew this message/).waitFor();
log('ECS message with an attachment and no text');

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
await must(!(await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('chiaramail.mock.db')).usage || {}).reduce((a, b) => a + b, 0))), 'withdrawing gives the space back');
log('withdraw erases the live text for readers');

// ---- Formatting: bold, italic, lists, links; pasted styles are stripped
await connectAs('alice@example.com');
await page.getByRole('link', { name: 'Compose' }).click();
await page.getByRole('combobox', { name: 'To' }).fill('bob@example.com');
await page.getByLabel('Subject', { exact: true }).fill('Formatted note');
const ed = page.getByRole('textbox', { name: 'Message', exact: true });
await ed.click();
await ed.pressSequentially('Please read ');
await ed.press('Control+i');
await ed.pressSequentially('carefully');
await ed.press('Control+i');
await must((await page.getByRole('button', { name: 'Italic' }).getAttribute('aria-pressed')) === 'false', 'italic off again');
await ed.pressSequentially(' and ');
await page.getByRole('button', { name: 'Bold' }).click();
await must((await page.getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')) === 'true', 'bold button shows as on');
await ed.pressSequentially('soon');
await page.getByRole('button', { name: 'Bold' }).click();
await ed.press('Enter');
await page.getByRole('button', { name: 'Bulleted list' }).click();
await ed.pressSequentially('first point');
await ed.press('Enter');
await ed.pressSequentially('second point');
await ed.press('Enter');
await ed.press('Enter');
page.removeAllListeners('dialog');
page.once('dialog', (d) => d.accept('example.org/plan'));
await page.getByRole('button', { name: 'Link' }).click();
page.on('dialog', (d) => d.accept());
// Paste from a web page: keep the emphasis, drop styles, scripts and handlers.
await ed.evaluate((el) => {
  const dt = new DataTransfer();
  dt.setData('text/html', '<span style="color:red;font-size:40px">pasted <em>bit</em></span><script>window.bad=1</script><img src=x onerror="window.bad=1">');
  dt.setData('text/plain', 'pasted bit');
  el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
});
const html = await ed.innerHTML();
await must(/<i>carefully<\/i>/.test(html) && /<b>soon<\/b>/.test(html), `italic and bold in the editor: ${html}`);
await must(/<ul><li>first point<\/li><li>second point<\/li><\/ul>/.test(html), `bulleted list: ${html}`);
await must(html.includes('href="https://example.org/plan"'), `link added: ${html}`);
await must(html.includes('<em>bit</em>') && !/style=|<script|<img|onerror/.test(html), `paste sanitised: ${html}`);
await send();
let live = page.locator('.live-body');
await live.locator('i', { hasText: 'carefully' }).waitFor();
await live.locator('b', { hasText: 'soon' }).waitFor();
await live.locator('ul li', { hasText: 'second point' }).waitFor();
await must((await live.locator('a[href="https://example.org/plan"]').getAttribute('target')) === '_blank', 'links open in a new tab');
log('formatting written with the toolbar and keyboard, pasted styles stripped');

// The sender edits it: the formatting is still there to edit, and survives.
await page.getByRole('button', { name: 'Edit' }).click();
const ed2 = page.locator('.live-edit [role=textbox]');
await must((await ed2.innerHTML()).includes('<i>carefully</i>'), 'formatting kept for editing');
await ed2.locator('b').click();
await ed2.press('End');
await ed2.pressSequentially(', please');
await page.getByRole('button', { name: 'Save new edition' }).click();
await page.getByText('Edition 2 saved.').waitFor();
await live.locator('b', { hasText: 'soon' }).waitFor();
await live.getByText(', please').waitFor();

// The recipient reads it formatted; the email itself still carries no content.
await connectAs('bob@example.com');
await openRow('Formatted note');
live = page.locator('.live-body');
await live.locator('i', { hasText: 'carefully' }).waitFor();
await live.getByText(', please').waitFor();
const fmtParts = await partsOf('Formatted note');
await must(fmtParts.length && !fmtParts.some((x) => x.text.includes('carefully')), 'content not in the email');
log('recipient sees the formatted edition; nothing of it in the email');

// An ordinary email: formatted HTML plus a plain-text copy.
await page.getByRole('link', { name: 'Compose' }).click();
await page.getByRole('combobox', { name: 'To' }).fill('alice@example.com');
await page.getByLabel('Subject', { exact: true }).fill('Plain and fancy');
await page.getByLabel(/^ECS message/).uncheck();
await page.getByRole('textbox', { name: 'Message', exact: true }).click();
await page.keyboard.type('Totally ');
await page.keyboard.press('Control+b');
await page.keyboard.type('bold');
await send();
await page.frameLocator('.htmlbody iframe').last().locator('b', { hasText: 'bold' }).waitFor();
const parts = await partsOf('Plain and fancy');
const plain = parts.find((x) => x.type === 'text/plain'); const rich = parts.find((x) => x.type === 'text/html');
await must(plain && plain.text.includes('Totally bold') && rich && rich.text.includes('<b>bold</b>'), `text and HTML parts: ${JSON.stringify(parts)}`);
log('ordinary email sent as HTML with a plain-text copy');

// French + mobile dark
await page.getByRole('button', { name: 'Français' }).click();
await page.getByRole('link', { name: 'Retour' }).waitFor();
await page.getByRole('button', { name: 'English' }).click();
log('French UI');
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 2, locale: 'en-GB', hasTouch: true });
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
await mp.goto(BASE + '/mail/inbox');
await mp.locator('.trow').first().waitFor();
await must(await mp.locator('.fab').isVisible(), 'floating Compose button on phones');
// Long press selects a row (and doesn't open it)
const longPress = async (loc) => {
  const b = await loc.boundingBox();
  const at = { bubbles: true, pointerType: 'touch', isPrimary: true, pointerId: 7, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 };
  await loc.dispatchEvent('pointerdown', at);
  await mp.waitForTimeout(650);
  await loc.dispatchEvent('pointerup', at);
  await loc.dispatchEvent('click', at);
};
await longPress(mp.locator('.trow-link', { hasText: 'Ordinary note' }));
await mp.getByText('1 selected').waitFor();
await must(mp.url().endsWith('/mail/inbox'), 'long press did not open the conversation');
await must(!(await mp.locator('.fab').count()), 'Compose button hides while selecting');
// …then taps select more, and so does the letter avatar
await mp.locator('.trow-link', { hasText: 'Liste pour samedi' }).tap();
await mp.getByText('2 selected').waitFor();
await mp.locator('.trow', { hasText: 'Print sizes' }).locator('.avatar').tap();
await mp.getByText('3 selected').waitFor();
await mp.locator('.bulkbar').getByRole('button', { name: 'More' }).tap();
await mp.getByRole('menuitem', { name: 'Label as' }).waitFor();
await mp.screenshot({ path: `${SHOTS}/m16-mobile-select.png` });
await must(!(await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'menus stay on screen on mobile');
await mp.getByRole('menuitem', { name: 'Select all' }).tap();
await mp.getByText(`${await mp.locator('.trow').count()} selected`).waitFor();
await mp.getByRole('button', { name: 'Clear selection' }).tap();
await mp.locator('.bulkbar').waitFor({ state: 'detached' });
await mp.locator('.trow-link', { hasText: 'Ordinary note' }).tap();
await mp.locator('.thread-subject').waitFor();
await mp.goBack();
// Search, then tap ×: the box empties, the results stay.
await mp.getByLabel('Search mail').fill('committee');
await mp.getByLabel('Search mail').press('Enter');
await mp.getByRole('heading', { name: /Results for/ }).waitFor();
await mp.getByRole('button', { name: 'Clear search' }).tap();
await must(!(await mp.getByLabel('Search mail').inputValue()), 'phone: box empty after ×');
await mp.getByRole('heading', { name: /Results for/ }).waitFor();
await mp.getByRole('button', { name: 'Back to Inbox' }).tap();
await mp.getByRole('heading', { name: 'Inbox' }).waitFor();
await mp.getByLabel('Search mail').tap();
await mp.getByLabel('Search mail').fill('committee');
await mp.getByLabel('Search mail').press('Enter');
await mp.getByRole('heading', { name: /Results for/ }).waitFor();
await mp.getByRole('button', { name: 'Back to Inbox' }).tap();
await mp.getByRole('heading', { name: 'Inbox' }).waitFor();
await mp.locator('.fab').tap();
await mp.getByLabel('To', { exact: true }).waitFor();
log('phone: avatars, long-press to select, taps add to the selection, ⋮ Select all, ← clears, tapping × empties the search box, ← leaves the search, Compose button');

await page.waitForTimeout(400);
await must(!(await page.evaluate(() => document.documentElement.classList.contains('busy'))), 'busy cursor cleared once work is done');
// a slow action started by a click shows the busy cursor, then clears it
await page.evaluate(() => { window.dispatchEvent(new PointerEvent('pointerdown')); window.__mockGmail.wait(900); });
await page.waitForTimeout(400);
await must(await page.evaluate(() => document.documentElement.classList.contains('busy')), 'busy cursor shown during a slow action');
await page.waitForTimeout(900);
await must(!(await page.evaluate(() => document.documentElement.classList.contains('busy'))), 'busy cursor cleared after it');
// …but not for background work nobody asked for
await page.waitForTimeout(1700);
await page.evaluate(() => { window.__mockGmail.wait(900); });
await page.waitForTimeout(400);
await must(!(await page.evaluate(() => document.documentElement.classList.contains('busy'))), 'no busy cursor for background work');
log('busy cursor while user-started work runs, never for background work');
if (errors.length) { console.log('Browser errors:', errors); process.exitCode = 1; } else log('no console errors');
await browser.close();
