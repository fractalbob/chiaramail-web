// ChiaraMail desktop: the same screens as app.chiaramail.com, built in
// "desktop" mode (npm run build:desktop at the top level), served from inside
// the app, with mail read and sent over IMAP/SMTP by this (main) process.
import { app, BrowserWindow, ipcMain, protocol, net, shell, safeStorage, Menu } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, normalize, sep } from 'node:path';
import { existsSync } from 'node:fs';
import { AccountManager } from './account.js';

const here = dirname(fileURLToPath(import.meta.url));
const RENDERER = process.env.CHIARAMAIL_RENDERER || join(here, '..', 'renderer');
const ORIGIN = 'app://chiaramail';
// Tests run with their own data folder.
if (process.env.CHIARAMAIL_USERDATA) app.setPath('userData', process.env.CHIARAMAIL_USERDATA);

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let accounts = null;

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
    return { error: { message: e.message || String(e), code: e.code || null, status: e.status || null, where: e.where || null, settings: e.settings || null, provider: e.provider || null } };
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
  ipcMain.handle('account:signOut', () => reply(() => accounts.signOut()));
  ipcMain.handle('mail', (_e, method, args) => reply(async () => {
    if (!MAIL_METHODS.has(method)) throw Object.assign(new Error(`Unknown: ${method}`), { code: 'bad-call' });
    const s = await accounts.mail();
    return s[method](...(Array.isArray(args) ? args : []));
  }));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
app.on('before-quit', () => { accounts?.close(); });

app.whenReady().then(async () => {
  accounts = new AccountManager({ dataDir: app.getPath('userData'), safeStorage });
  await accounts.load();
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  serveApp();
  wireIpc();
  createWindow();
});
