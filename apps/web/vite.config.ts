import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // Device photos: served + auto-optimized by the api (see apps/api/src/images).
      '/img': { target: 'http://localhost:3001', changeOrigin: true },
      '/img-manifest': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  // avoid-nodes-edge ships a module worker; keep libavoid-js out of main prebundle thrash.
  optimizeDeps: {
    exclude: ['libavoid-js'],
  },
  worker: {
    format: 'es',
  },
});
