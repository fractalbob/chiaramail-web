import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { I18nProvider } from './i18n.jsx';
import App from './App.jsx';
import '@fontsource-variable/literata/opsz.css';
import '@fontsource-variable/literata/opsz-italic.css';
import '@fontsource-variable/schibsted-grotesk/index.css';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <I18nProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </I18nProvider>
  </StrictMode>,
);

// The start screen (index.html, installed app only) shows only briefly: the inbox matters more
// than the name. Counted from when it actually appeared (the phone's own icon-only splash uses
// up part of that); a tap dismisses it sooner.
const SPLASH_MS = 800;
const splash = document.getElementById('splash');
if (splash) {
  const shown = getComputedStyle(splash).display !== 'none';
  let gone = false;
  const hide = () => {
    if (gone) return;
    gone = true;
    splash.classList.add('splash-out');
    setTimeout(() => splash.remove(), shown ? 400 : 0);
  };
  if (shown) {
    const since = performance.now() - (window.__splashShownAt ?? performance.now());
    setTimeout(hide, Math.max(0, SPLASH_MS - since));
    splash.addEventListener('pointerdown', hide);
  } else hide();
}

// The installed app, back after a long sleep (overnight, say): start afresh rather than carry on in a copy
// that the phone froze hours ago, unless a message is being written.
const STALE_MS = 30 * 60 * 1000;
let hiddenAt = document.hidden ? Date.now() : 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  const away = hiddenAt ? Date.now() - hiddenAt : 0;
  hiddenAt = 0;
  if (away > STALE_MS && matchMedia('(display-mode: standalone)').matches && !/^\/compose|\/edit$/.test(location.pathname)) location.reload();
});
