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

// The start screen (index.html, installed app only) stays long enough for the name and the
// tagline to be read, counted from when it actually appeared (not from launch: the phone's own
// icon-only splash uses up part of that). A tap dismisses it sooner.
const SPLASH_MS = 3500;
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
