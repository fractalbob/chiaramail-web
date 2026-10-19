import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// `vite --mode mock` swaps Firebase and Gmail for local stand-ins (no setup needed).
// `vite build --mode desktop` builds the screens of the desktop app (desktop/), which reads
// mail over IMAP/SMTP from any provider.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@backend': fileURLToPath(new URL(
        { mock: './src/backend/mock.js', desktop: './src/backend/desktop.js' }[mode] || './src/backend/firebase.js', import.meta.url)),
      '@gmail': fileURLToPath(new URL(
        { mock: './src/gmail/mock.js', desktop: './src/gmail/desktop.js' }[mode] || './src/gmail/api.js', import.meta.url)),
    },
  },
}));
