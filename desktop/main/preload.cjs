// The only door between the screens and this computer: a few named calls,
// no general access to files, network or Node. Each call resolves to
// { ok: result } or { error: { message, code, … } } (errors lose their details
// when crossing into the page, so they travel as plain objects).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chiaramailDesktop', {
  account: ipcRenderer.sendSync('account:current'),
  platform: process.platform,
  detect: (email) => ipcRenderer.invoke('account:detect', email),
  connect: (cfg) => ipcRenderer.invoke('account:connect', cfg),
  signOut: () => ipcRenderer.invoke('account:signOut'),
  call: (method, args) => ipcRenderer.invoke('mail', method, args),
  ecs: {
    ...ipcRenderer.sendSync('ecs:config'),
    session: (email) => ipcRenderer.invoke('ecs:session', email),
    signIn: (email, lang) => ipcRenderer.invoke('ecs:signIn', email, lang),
    call: (method, path, opts) => ipcRenderer.invoke('ecs:call', method, path, opts),
  },
});
