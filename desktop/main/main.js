// ChiaraMail desktop: the same screens as app.chiaramail.com, built in
// "desktop" mode (npm run build:desktop at the top level), served from inside
// the app, with mail read and sent over IMAP/SMTP by this (main) process.
import { app, BrowserWindow, ipcMain, protocol, net, shell, safeStorage, Menu, session } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, normalize, sep, extname, basename } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { AccountManager } from './account.js';
import { EcsClient } from './ecs.js';

const here = dirname(fileURLToPath(import.meta.url));
// Diagnostics in the terminal: start with --log-mail (or CHIARAMAIL_DEBUG=1). Lists each
// request from the screens with its duration, and the mail server's commands
// (passwords masked; message contents are not shown).
const DEBUG = process.argv.includes('--log-mail') || process.env.CHIARAMAIL_DEBUG === '1';
const t0 = Date.now();
const dlog = (...a) => { if (DEBUG) console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a); };
const short = (s) => { const x = String(s); return x.length > 160 ? `${x.slice(0, 160)}…` : x; };
const imapLogger = DEBUG ? {
  trace() {},
  debug: (o) => dlog(o.src === 'c' ? 'IMAP >' : o.src === 's' ? 'IMAP <' : 'IMAP', short(o.msg || '')),
  info: (o) => dlog('IMAP', short(o.msg || '')),
  warn: (o) => dlog('IMAP warn', short(o.msg || ''), o.err?.message || ''),
  error: (o) => dlog('IMAP error', short(o.msg || ''), o.err?.message || ''),
} : false;
const RENDERER = process.env.CHIARAMAIL_RENDERER || join(here, '..', 'renderer');
const ORIGIN = 'app://chiaramail';
// The European ECS server: package.json "chiaramail.ecsUrl", or CHIARAMAIL_ECS_URL. Empty: ECS stays off.
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
const ECS_URL = process.env.CHIARAMAIL_ECS_URL ?? pkg.chiaramail?.ecsUrl ?? '';
const READER_ORIGIN = process.env.CHIARAMAIL_READER_ORIGIN ?? pkg.chiaramail?.readerOrigin ?? '';
// Tests run with their own data folder.
if (process.env.CHIARAMAIL_USERDATA) app.setPath('userData', process.env.CHIARAMAIL_USERDATA);

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let accounts = null;
let ecs = null;

// Everything the screens may ask of the mail layer (the functions of src/gmail/api.js).
const MAIL_METHODS = new Set([
  'getProfile', 'getGmailSignature', 'listLabels', 'getLabel', 'createLabel', 'listThreads', 'getThreadsMeta',
  'getThread', 'getRawMessage', 'recentAddresses', 'getAttachment', 'modifyThread', 'trashThread', 'untrashThread',
  'listDrafts', 'getDraft', 'getDraftsMeta', 'createDraft', 'updateDraft', 'deleteDraft', 'findDraftId', 'sendRaw',
]);

// Results cross to the window as { ok } or { error }: Electron would otherwise
// keep only an error's message.
const reply = async (fn) => {
  try { return { ok: await fn() }; } catch (e) {
    return { error: { message: e.message || String(e), code: e.code || null, status: e.status || null, where: e.where || null, settings: e.settings || null, provider: e.provider || null, used: e.used ?? null, need: e.need ?? null, quota: e.quota ?? null } };
  }
};

function serveApp() {
  protocol.handle('app', (req) => {
    const url = new URL(req.url);
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    let file = join(RENDERER, path);
    if (!file.startsWith(RENDERER + sep) && file !== RENDERER) return new Response('Not found', { status: 404 });
    // The app's own routes (/inbox, /m/…) are all index.html, as on the web.
    if (!path || !existsSync(file) || !/\.[a-z0-9]+$/i.test(path)) file = join(RENDERER, 'index.html');
    return net.fetch(pathToFileURL(file).toString());
  });
}

// Attachments save straight to the Downloads folder, as in a browser
// ("name (1).pdf" when the name is taken), without a Save dialog.
function saveDownloads() {
  const dir = process.env.CHIARAMAIL_DOWNLOADS || app.getPath('downloads');
  session.defaultSession.on('will-download', (_e, item) => {
    const name = basename(item.getFilename() || 'attachment').replace(/[\\/:*?"<>|]/g, '_');
    const ext = extname(name); const stem = name.slice(0, name.length - ext.length);
    let path = join(dir, name);
    for (let i = 1; existsSync(path); i += 1) path = join(dir, `${stem} (${i})${ext}`);
    item.setSavePath(path);
    item.once('done', (_ev, state) => {
      if (state !== 'completed' || !win) return;
      const id = ++downloadSeq;
      saved.set(id, path);
      win.webContents.send('download:done', { id, name: basename(path) });
    });
  });
  // The screens can open, or show in its folder, only a file this app has just saved.
  ipcMain.handle('download:open', (_e, id) => reply(async () => { const p = saved.get(id); if (p) { const err = await shell.openPath(p); if (err) throw new Error(err); } }));
  ipcMain.handle('download:show', (_e, id) => reply(async () => { const p = saved.get(id); if (p) shell.showItemInFolder(p); }));
}
const saved = new Map(); // id → path of files saved to Downloads in this session

// "Open with": the attachment viewer hands over a file to open in the
// computer's own app for it. It goes to a private temporary folder first.
// Programs and scripts are refused: they're saved, never opened, from here.
const RISKY = /\.(exe|com|bat|cmd|msi|msp|scr|pif|cpl|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|jar|lnk|reg|sh|bash|zsh|command|app|pkg|dmg|desktop|appimage|run|bin|py|pl|rb|deb|rpm|apk|iso|img)$/i;
function openWith() {
  ipcMain.handle('file:openWith', (_e, name, bytes) => reply(async () => {
    const clean = basename(String(name || 'attachment')).replace(/[\\/:*?"<>|]/g, '_') || 'attachment';
    if (RISKY.test(clean)) throw Object.assign(new Error('This kind of file can only be saved, not opened from ChiaraMail.'), { code: 'risky' });
    if (!(bytes instanceof Uint8Array) || bytes.length > 60 * 1024 * 1024) throw new Error('Bad file');
    const dir = await mkdtemp(join(app.getPath('temp'), 'chiaramail-open-'));
    const path = join(dir, clean);
    await writeFile(path, bytes, { mode: 0o600 });
    const err = await shell.openPath(path);
    if (err) throw new Error(err);
  }));
}
let downloadSeq = 0;

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 380, minHeight: 500,
    title: 'ChiaraMail',
    backgroundColor: '#fbfdfe',
    show: false,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
      plugins: true, // the built-in PDF viewer, for PDF attachments
    },
  });
  win.once('ready-to-show', () => win.show());
  // Links to the web open in the person's browser; the window stays on the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(`${ORIGIN}/`)) return;
    e.preventDefault();
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
  });
  win.loadURL(`${ORIGIN}/`);
}

function wireIpc() {
  ipcMain.on('account:current', (e) => { e.returnValue = accounts.publicInfo(); });
  ipcMain.handle('account:detect', (_e, email) => reply(() => accounts.detect(email)));
  ipcMain.handle('account:connect', (_e, cfg) => reply(() => accounts.connect(cfg)));
  ipcMain.handle('account:signOut', () => reply(async () => { await ecs.signOut(); await accounts.signOut(); }));
  ipcMain.on('ecs:config', (e) => { e.returnValue = { configured: ecs.configured, readerOrigin: ecs.readerOrigin }; });
  ipcMain.handle('ecs:session', (_e, email) => reply(async () => ecs.session(email)));
  ipcMain.handle('ecs:signIn', (_e, email, lang) => reply(async () => ecs.signIn(email, await accounts.mail(), lang)));
  ipcMain.handle('ecs:call', (_e, method, path, opts) => reply(async () => {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('/auth/')) throw Object.assign(new Error('Bad call'), { code: 'bad-call' });
    return ecs.request(method, path, { json: opts?.json, bytes: opts?.bytes });
  }));
  let seq = 0;
  // The screens sometimes ask the same question twice at once (a list and its
  // refresh): the second waits for the first's answer instead of asking again.
  const READS = new Set(['listLabels', 'getLabel', 'listThreads', 'getThreadsMeta', 'getThread', 'listDrafts', 'getDraftsMeta', 'getDraft', 'recentAddresses', 'getProfile', 'getGmailSignature']);
  const inflight = new Map();
  const shared = (method, args, run) => {
    if (!READS.has(method)) return run();
    const k = `${method} ${JSON.stringify(args)}`;
    if (!inflight.has(k)) inflight.set(k, run().finally(() => inflight.delete(k)));
    return inflight.get(k);
  };
  ipcMain.handle('mail', (_e, method, args) => reply(() => shared(method, args, async () => {
    if (!MAIL_METHODS.has(method)) throw Object.assign(new Error(`Unknown: ${method}`), { code: 'bad-call' });
    const n = ++seq; const t = Date.now();
    const what = `#${n} ${method}${['listThreads', 'getLabel', 'recentAddresses'].includes(method) ? ` ${short(JSON.stringify(args))}` : ''}`;
    dlog('→', what);
    try {
      const s = await accounts.mail();
      const r = await s[method](...(Array.isArray(args) ? args : []));
      dlog('←', what, `${Date.now() - t} ms`);
      return r;
    } catch (e) {
      dlog('✗', what, `${Date.now() - t} ms`, e.message);
      throw e;
    }
  })));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
// Quitting waits (a moment at most) for the message index to be written, so
// what was read this time isn't fetched again next time.
let closing = false;
app.on('before-quit', (e) => {
  if (closing || !accounts) return;
  closing = true;
  e.preventDefault();
  Promise.race([accounts.close(), new Promise((r) => setTimeout(r, 3000))]).finally(() => app.quit());
});

app.whenReady().then(async () => {
  accounts = new AccountManager({ dataDir: app.getPath('userData'), safeStorage, logger: imapLogger });
  dlog('ChiaraMail', app.getVersion(), 'data in', app.getPath('userData'));
  await accounts.load();
  ecs = new EcsClient({ url: ECS_URL, readerOrigin: READER_ORIGIN, dataDir: app.getPath('userData'), safeStorage });
  await ecs.load();
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  serveApp();
  wireIpc();
  saveDownloads();
  openWith();
  createWindow();
});
