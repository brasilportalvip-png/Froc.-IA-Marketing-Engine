import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const appUrl = String(process.env.VITE_APP_URL || process.env.APP_URL || env.VITE_APP_URL || env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'froc-html-app-url',
        transformIndexHtml(html: string) {
          return html.replaceAll('%VITE_APP_URL%', appUrl);
        }
      }
    ],
    resolve: { alias: { '@': path.resolve(__dirname, '.') } },
    build: {
      rollupOptions: {
        output: {
          entryFileNames: 'assets/app.js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: (assetInfo) => assetInfo.name?.endsWith('.css') ? 'assets/app.css' : 'assets/[name]-[hash][extname]'
        }
      }
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {}
    }
  };
});
