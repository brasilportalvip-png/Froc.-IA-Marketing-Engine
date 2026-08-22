import express from 'express';
import cors from 'cors';
import { config, assertProductionConfig } from './config/index.js';
import productionRouter, { buildRobotsTxt, buildSitemapXml } from './production/router.js';
import { renderPrivateAppPage, renderPublicPage } from './production/publicPages.js';

assertProductionConfig();

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      const normalized = origin.replace(/\/$/, '');
      if (!config.isProduction || config.corsOrigins.includes(normalized)) return callback(null, true);
      return callback(new Error('Origem não autorizada pelo CORS.'));
    },
    methods: ['GET','POST','PATCH','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization','X-Request-Id','X-Signature','X-Idempotency-Key'],
    maxAge: 86400
  }));

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (config.isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  // Webhook must retain JSON semantics; Mercado Pago signs metadata, not raw body.
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));

  app.get('/sitemap.xml', async (_req, res, next) => {
    try { res.type('application/xml').send(await buildSitemapXml()); } catch (error) { next(error); }
  });
  app.get('/robots.txt', (_req, res) => res.type('text/plain').send(buildRobotsTxt()));
  // Shell SEO dinâmico para páginas públicas. O app React continua sendo o mesmo; apenas
  // title/meta/JSON-LD chegam prontos para buscadores e compartilhamentos sociais.
  app.get(['/', '/vitrine', '/vitrine/:slug', '/blog', '/blog/:slug', '/planos', '/termos', '/privacidade'], async (req, res, next) => {
    if (!config.isProduction) return next();
    try { const page = await renderPublicPage(req.path); res.status(page.status).type('text/html').send(page.html); } catch (error) { next(error); }
  });
  const privateAppRoutes = ['/dashboard','/empresa','/froc-ia','/autopilot','/criar-conteudo','/criar-imagem','/criar-video','/criar-artigo','/seo','/campanhas','/calendario','/redes-sociais','/conteudos','/analytics','/creditos','/perfil','/configuracoes','/suporte','/admin'];
  app.get(privateAppRoutes, (req, res, next) => { if (!config.isProduction) return next(); const page = renderPrivateAppPage(req.path); res.status(page.status).type('text/html').send(page.html); });
  app.use('/api', productionRouter);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint Froc.IA não encontrado.' }));
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[Froc API Error]', error?.message || error);
    if (String(error?.message || '').includes('CORS')) return res.status(403).json({ error: 'Origem não autorizada.' });
    res.status(500).json({ error: 'Erro interno do servidor.' });
  });

  return app;
}

export default createApp();
