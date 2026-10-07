import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// `vite --mode mock` swaps Firebase and Gmail for local stand-ins (no setup needed).
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@backend': fileURLToPath(new URL(
        mode === 'mock' ? './src/backend/mock.js' : './src/backend/firebase.js', import.meta.url)),
      '@gmail': fileURLToPath(new URL(
        mode === 'mock' ? './src/gmail/mock.js' : './src/gmail/api.js', import.meta.url)),
    },
  },
}));
