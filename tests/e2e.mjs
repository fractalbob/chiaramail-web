// End-to-end walkthrough against the stand-in backend (npm run build:mock && npx vite preview).
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:4173';
const SHOTS = process.argv[2] || 'shots';
const log = (...a) => console.log('✔', ...a);
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'en-GB' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', (d) => d.accept());
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });

async function signIn(email) {
  await page.goto(BASE + '/');
  if (await page.getByRole('button', { name: 'Sign out' }).count()) {
    await page.getByRole('button', { name: 'Sign out' }).click();
  }
  await page.getByLabel('Your email address').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await page.getByText(email, { exact: true }).first().waitFor();
}
async function signOut() {
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await page.getByRole('heading', { name: 'Sign in' }).waitFor();
}

// Landing
await page.goto(BASE + '/');
await page.evaluate(() => localStorage.clear());
await page.goto(BASE + '/');
await page.getByRole('heading', { name: /change after you send/ }).waitFor();
await shot('01-landing'); log('landing page');

// Alice composes
await signIn('alice@example.com');
await page.getByText('You haven’t sent any ChiaraMail messages yet.').waitFor();
await page.getByRole('link', { name: 'New message' }).click();
await page.getByLabel('To').fill('Bob@Example.com, not-an-address');
await page.getByLabel('Subject').fill('Dinner on Saturday');
await page.getByLabel('Message').fill('Hi Bob,\n\nDinner is at 7pm on Saturday at our place. Bring the wine you mentioned.\n\nSee https://example.com/map for directions.\n\nRobert');
await page.getByRole('button', { name: 'Save and get the link' }).click();
await page.getByText(/don’t look like email addresses: not-an-address/).waitFor();
log('rejects a bad address');
await page.getByLabel('To').fill('Bob@Example.com');
await shot('02-compose');
await page.getByRole('button', { name: 'Save and get the link' }).click();
await page.getByRole('heading', { name: 'Send the link to your recipients' }).waitFor();
const url = new URL(page.url()); const id = url.pathname.split('/')[2];
const mailto = await page.getByRole('link', { name: 'Your mail app' }).getAttribute('href');
if (!mailto.startsWith('mailto:bob%40example.com?subject=Dinner%20on%20Saturday')) throw new Error('mailto: ' + mailto);
if (!decodeURIComponent(mailto).includes(`/m/${id}`)) throw new Error('mailto lacks link');
const gmail = await page.getByRole('link', { name: 'Gmail' }).getAttribute('href');
if (!gmail.includes('mail.google.com') || !gmail.includes('bob%40example.com')) throw new Error('gmail link');
await shot('03-sent-send-panel'); log('message saved, send panel links correct', id);
await page.getByText('not opened yet').waitFor(); log('readers: not opened yet');

// Signed-out visitor gets the gate
await signOut();
await page.goto(`${BASE}/m/${id}`);
await page.getByText('This ChiaraMail message is private to its recipients.').waitFor();
await shot('04-gate'); log('signed-out gate');

// Eve is not a recipient
await page.getByLabel('Your email address').fill('eve@example.com');
await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
await page.getByText('This message isn’t addressed to eve@example.com.').waitFor();
if (await page.getByText('Bring the wine').count()) throw new Error('Eve can read!');
await shot('05-not-for-you'); log('outsider refused');

// Bob reads (signs in from the gate, returning to the same message)
await page.getByRole('button', { name: 'Sign out' }).last().click();
await page.getByLabel('Your email address').fill('bob@example.com');
await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
await page.getByText('Bring the wine you mentioned.').waitFor();
await page.getByText('First edition').waitFor();
if (await page.getByText('Updated since you last read it').count()) throw new Error('banner on first read');
const link = page.getByRole('link', { name: 'https://example.com/map' });
if ((await link.getAttribute('rel')).indexOf('noopener') < 0) throw new Error('rel');
if (await page.getByRole('link', { name: 'Edit' }).count()) throw new Error('recipient sees Edit');
await shot('06-bob-reads'); log('recipient reads, links clickable, no edit controls');
await page.getByRole('link', { name: 'Back to messages' }).click();
await page.getByRole('tab', { name: 'Received' }).waitFor();
await page.getByText('Dinner on Saturday').waitFor(); log('received list shows it');

// Alice edits
await signOut(); await signIn('alice@example.com');
await page.getByText('Dinner on Saturday').click();
await page.getByText('read the latest edition').waitFor(); log('Alice sees Bob read it');
await page.getByRole('link', { name: 'Edit' }).click();
await page.getByLabel('Message').fill('Hi Bob,\n\nChange of plan: dinner is at 8pm on Saturday, not 7. Bring the wine you mentioned.\n\nRobert');
await page.getByRole('button', { name: 'Save new edition' }).click();
await page.getByRole('heading', { name: 'Let your recipients know about the change' }).waitFor();
await page.getByText('Edition 2', { exact: true }).first().waitFor();
await page.getByText('read edition 1').waitFor();
await page.locator('.editions summary').first().waitFor();
const edCount = await page.locator('.editions > li').count();
if (edCount !== 2) throw new Error('editions ' + edCount);
await page.locator('.editions summary').nth(1).click();
await page.getByText('Dinner is at 7pm').waitFor();
await shot('07-alice-edited'); log('edition 2 saved, history keeps edition 1, readers show stale read');

// Bob sees the update
await signOut(); await signIn('bob@example.com');
await page.getByRole('tab', { name: 'Received' }).click();
await page.locator('.row-fresh').waitFor(); log('received list flags the update');
await shot('08-bob-list-fresh');
await page.getByText('Dinner on Saturday').click();
await page.getByText('Updated since you last read it').waitFor();
await page.getByText('You last read edition 1. This is edition 2.').waitFor();
await page.getByText('dinner is at 8pm').waitFor();
await page.waitForTimeout(1300);
await shot('09-bob-updated'); log('recipient sees new edition with highlighter banner');
await page.reload();
await page.getByText('dinner is at 8pm').waitFor();
await page.waitForTimeout(300);
if (await page.getByText('Updated since you last read it').count()) throw new Error('banner persists after reading');
log('banner clears once read');

// Alice withdraws
await signOut(); await signIn('alice@example.com');
await page.getByText('Dinner on Saturday').click();
await page.getByRole('button', { name: 'Withdraw' }).click();
await page.getByText(/You withdrew this message/).waitFor();
await signOut(); await signIn('bob@example.com');
await page.goto(`${BASE}/m/${id}`);
await page.getByText(/withdrew this message on/).waitFor();
if (await page.getByText('dinner is at 8pm').count()) throw new Error('text after withdraw');
await shot('10-withdrawn'); log('withdrawn: text gone for recipient');

// French
await page.getByRole('button', { name: 'Français' }).click();
await page.getByText(/a retiré ce message/).waitFor(); log('French UI');
await page.getByRole('button', { name: 'English' }).click();

// Mobile + dark
await signOut(); await signIn('alice@example.com');
await page.getByRole('link', { name: 'New message' }).click();
await page.getByLabel('To').fill('carol@example.com, dan@example.com, erin@example.com');
await page.getByLabel('Subject').fill('Agenda for the committee meeting');
await page.getByLabel('Message').fill('Draft agenda:\n\n1. Budget\n2. Spring exhibition\n3. Any other business');
await page.getByRole('button', { name: 'Save and get the link' }).click();
await page.getByRole('heading', { name: 'Send the link to your recipients' }).waitFor();
await page.getByRole('button', { name: 'Done' }).click();
await page.getByRole('link', { name: 'Back to messages' }).click();
await page.locator('.row').nth(1).waitFor();
await shot('11-sent-list');
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 2 });
const mp = await mobile.newPage();
await mp.goto(BASE + '/');
await mp.evaluate((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); },
  await page.evaluate(() => ({ ...localStorage })));
await mp.goto(BASE + '/');
await mp.locator('.row').first().waitFor();
await mp.screenshot({ path: `${SHOTS}/12-mobile-dark-list.png`, fullPage: true });
await mp.locator('.row').first().click();
await mp.getByText('Draft agenda:').waitFor();
await mp.screenshot({ path: `${SHOTS}/13-mobile-dark-message.png`, fullPage: true });
const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
if (overflow) throw new Error('horizontal overflow on mobile');
log('mobile dark mode, no horizontal scroll');

if (errors.length) { console.log('Browser errors:', errors); process.exitCode = 1; }
else log('no console errors');
await browser.close();
