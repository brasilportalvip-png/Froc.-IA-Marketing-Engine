import path from 'path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createApp } from './server/app.js';
import { config } from './server/config/index.js';

async function startServer() {
  const app = createApp();

  if (!config.isProduction) {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath, { maxAge: '1h', etag: true }));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(config.port, config.host, () => {
    console.log(`[Froc.IA] servidor em http://${config.host}:${config.port}`);
  });
}

startServer().catch((error) => {
  console.error('[Froc.IA] falha fatal:', error);
  process.exit(1);
});
