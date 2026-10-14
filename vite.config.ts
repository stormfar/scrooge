import { defineConfig } from 'vite';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { apiPlugin } from './src/api/vitePlugin';

export default defineConfig({
  plugins: [react(), tailwindcss(), apiPlugin()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5174,
    strictPort: true,
  },
  ssr: {
    external: ['better-sqlite3'],
  },
  optimizeDeps: {
    exclude: ['better-sqlite3'],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    server: {
      deps: {
        external: ['better-sqlite3'],
      },
    },
  },
});
