import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The worker (wrangler dev) runs on :8787; proxy API + WS to it in dev.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
