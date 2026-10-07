import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// `vite --mode mock` swaps Firebase for a local stand-in backend (no setup needed).
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@backend': fileURLToPath(new URL(
        mode === 'mock' ? './src/backend/mock.js' : './src/backend/firebase.js', import.meta.url)),
    },
  },
}));
