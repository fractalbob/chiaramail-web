// Browser test of the editor's emoji picker against the stand-ins
// (npm run build:mock && npx vite preview), e.g. BASE=http://localhost:4173 node tests/emoji.e2e.mjs shots
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:4173';
const SHOTS = process.argv[2] || 'shots';
const log = (...a) => console.log('✔', ...a);
const must = (cond, msg) => { if (!cond) throw new Error(msg); };
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'en-GB' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|images\.example|net::/.test(m.text())) errors.push(m.text()); });
const body = () => page.getByLabel('Message', { exact: true });
const text = () => body().evaluate((e) => e.innerText.replace(/\n+$/, ''));

await page.goto(BASE + '/');
await page.getByLabel('Test-mode address').fill('alice@example.com');
await page.getByRole('button', { name: 'Connect Gmail' }).click();
await page.getByRole('heading', { name: 'Inbox' }).waitFor();
await page.goto(BASE + '/compose');
await page.getByLabel('To', { exact: true }).fill('bob@example.com');
await page.getByLabel('ECS message').first().uncheck();
await page.getByLabel('Subject', { exact: true }).fill('Emoji test 🎉');
await body().click();
await page.keyboard.press('Control+End');
await page.keyboard.type('Thanks ');

// Open, search in English, Enter picks the first result where the cursor was.
await page.getByRole('button', { name: 'Emoji', exact: true }).click();
const pop = page.getByRole('dialog', { name: 'Emoji' });
await pop.waitFor();
await page.waitForTimeout(150);
await page.screenshot({ path: `${SHOTS}/emoji-1-open.png` });
await page.keyboard.type('pray');
await page.keyboard.press('Enter');
must((await text()).includes('Thanks 🙏'), `search + Enter inserts at the cursor: ${await text()}`);
log('search (English) + Enter inserts at the cursor');

// French words and accents-insensitive search; clicking several in a row.
await pop.getByRole('searchbox').fill('coeur');
await pop.locator('.emo').first().click();
await pop.locator('.emo').nth(2).click();
must(/Thanks 🙏🥰❤️/.test(await text()), `French search, two clicks: ${await text()}`);
// General words find a whole group, then a second pick after a search still goes in.
await pop.getByRole('searchbox').fill('fruit');
must((await pop.locator('.emo').count()) >= 10, '"fruit" finds the fruit');
await pop.locator('.emo', { hasText: '🍌' }).click();
must((await text()).includes('❤️🍌'), `second search, emoji added: ${await text()}`);
await pop.getByRole('searchbox').fill('xyzzy');
await pop.getByText('No emoji found.').waitFor();
log('French search works; picker stays open for several emoji; empty result explained');

// Keyboard: arrows move through the grid, Escape closes and returns to the text.
await pop.getByRole('searchbox').fill('');
await pop.getByRole('searchbox').focus();
await page.keyboard.press('ArrowDown');
must(await pop.locator('.emo').first().evaluate((e) => e === document.activeElement), 'ArrowDown from search goes to the grid');
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowDown');
const focused = await page.evaluate(() => document.activeElement.textContent);
await page.keyboard.press('Enter');
await page.keyboard.press('Escape');
await pop.waitFor({ state: 'detached' });
must(await body().evaluate((e) => e === document.activeElement), 'Escape returns to the message');
await page.keyboard.type('!');
must((await text()).includes(`${focused}!`), `typing continues after the emoji: ${await text()}`);
log('arrow keys, Enter, Escape; typing continues after the emoji');

// Recently used come first next time; clicking outside closes.
await page.getByRole('button', { name: 'Emoji', exact: true }).click();
await pop.getByRole('heading', { name: 'Recently used' }).waitFor();
must((await pop.locator('section').first().locator('.emo').first().textContent()) === focused, 'last used is first');
must((await pop.locator('.emoji-tab[aria-current]').getAttribute('aria-label')) === 'Recently used', 'first section highlighted');
await pop.getByRole('button', { name: 'Food and drink' }).click();
await page.waitForTimeout(200);
must((await pop.locator('.emoji-tab[aria-current]').getAttribute('aria-label')) === 'Food and drink', 'clicked tab highlighted');
await page.screenshot({ path: `${SHOTS}/emoji-4-tabs.png` });
must(!(await text()).includes('🍎'), 'a category tab does not insert anything');
await page.getByLabel('Subject', { exact: true }).click();
await pop.waitFor({ state: 'detached' });
log('recently used remembered; clicking elsewhere closes');

// Send it: the email carries the emoji intact (subject, text and HTML parts).
await page.getByRole('button', { name: 'Send' }).click();
await page.waitForURL(/\/mail\/sent\//);
const parts = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('chiaramail.mock.gmail'));
  const dec = (d) => new TextDecoder().decode(Uint8Array.from(atob(d.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
  const out = [];
  const walk = (p) => { if (p.body?.data) out.push(dec(p.body.data)); (p.parts || []).forEach(walk); };
  for (const box of Object.values(s.boxes)) for (const m of Object.values(box.messages)) {
    if (m.payload.headers.some((h) => h.name.toLowerCase() === 'subject' && /^Emoji test|=\?UTF-8\?B\?RW1vamkgdGVzdCDwn46J\?=/.test(h.value))) walk(m.payload);
  }
  return out;
});
// (The stand-in mailbox keeps only the text part; tests/mime.test.js checks the full email.)
must(parts.length >= 1 && parts.every((p) => p.includes('🙏🥰❤️')), `emoji in the sent text: ${JSON.stringify(parts)}`);
// The subject travels as a UTF-8 encoded-word (Gmail and the desktop app decode it).
const subj = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('chiaramail.mock.gmail')).boxes)
  .flatMap((b) => Object.values(b.messages)).map((m) => m.payload.headers.find((h) => h.name === 'Subject')?.value || '')
  .find((v) => v.includes('RW1vamkgdGVzdCDwn46J')));
must(subj === `=?UTF-8?B?${Buffer.from('Emoji test 🎉').toString('base64')}?=`, `subject encoded: ${subj}`);
log('sent email keeps the emoji in its subject and text');

// Phone width: the picker fits on screen.
await page.setViewportSize({ width: 390, height: 800 });
await page.goto(BASE + '/compose');
await body().click();
await page.getByRole('button', { name: 'Emoji', exact: true }).click();
await pop.waitFor();
const box = await pop.boundingBox();
must(box.x >= 0 && box.x + box.width <= 390, `fits a phone screen: ${JSON.stringify(box)}`);
await page.waitForTimeout(150);
await page.screenshot({ path: `${SHOTS}/emoji-3-phone.png` });
log('fits a phone screen');

must(!errors.length, `page errors: ${errors.join(' | ')}`);
await browser.close();
console.log('emoji picker: all good');
