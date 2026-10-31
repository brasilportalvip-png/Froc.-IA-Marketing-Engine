import crypto from 'crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { config, assertProductionConfig } from './config/index.js';
import productionRouter, { buildRobotsTxt, buildSitemapXml } from './production/router.js';
import { renderPrivateAppPage, renderPublicPage } from './production/publicPages.js';
import { handleRedirect } from './production/redirects.js';
import { buildGroupSitemapXml, buildRssFeed, buildSitemapTxt, buildSitemapXsl, indexNowKeyFromPath, parseSitemapPath } from './production/seoEngine.js';
import { consumeRateLimit } from './production/store.js';

assertProductionConfig();

type RateLimitPolicy = {
  group: string;
  limit: number;
  windowMs: number;
};

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;

function normalizedRequestId(value: unknown): string {
  const candidate = typeof value === 'string' ? value.trim() : '';
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : crypto.randomUUID();
}

function requestIp(req: Request): string {
  const value = String(req.ip || req.socket.remoteAddress || 'unknown').trim();
  return value.slice(0, 200) || 'unknown';
}

function rateLimitPolicy(req: Request): RateLimitPolicy | null {
  if (req.method === 'OPTIONS') return null;
  const path = req.path.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';

  if (path === '/api/webhooks/mercadopago') {
    return { group: 'webhook-mercadopago', limit: 600, windowMs: 60_000 };
  }
  if (path.startsWith('/api/cron/')) {
    return { group: 'cron', limit: 120, windowMs: 60_000 };
  }
  if (path === '/api/auth/bootstrap-admin') {
    return { group: 'auth-bootstrap-admin', limit: 5, windowMs: 15 * 60_000 };
  }
  if (
    path === '/api/auth/sync-profile' ||
    path === '/api/auth/accept-terms' ||
    path === '/api/auth/profile'
  ) {
    return { group: 'auth-mutation', limit: 30, windowMs: 10 * 60_000 };
  }
  if (path === '/api/payments/checkout' || path === '/api/payments/subscription/cancel') {
    return { group: 'payments-mutation', limit: 20, windowMs: 10 * 60_000 };
  }
  if (req.method === 'POST' && (path === '/api/concierge/chat' || path === '/api/concierge/chat/stream')) {
    return { group: 'concierge-chat', limit: 60, windowMs: 10 * 60_000 };
  }
  if (req.method === 'POST' && path.startsWith('/api/ai/speech')) {
    return { group: 'neural-speech', limit: 90, windowMs: 10 * 60_000 };
  }
  if (req.method === 'POST' && path === '/api/concierge/execute') {
    return { group: 'concierge-execute', limit: 15, windowMs: 10 * 60_000 };
  }
  if (req.method === 'POST' && path.startsWith('/api/ai/')) {
    return { group: 'ai-generation', limit: 120, windowMs: 10 * 60_000 };
  }
  if (
    MUTATING_METHODS.has(req.method) &&
    (path.startsWith('/api/social/') || path.startsWith('/api/support/'))
  ) {
    return { group: 'social-support-mutation', limit: 100, windowMs: 10 * 60_000 };
  }
  if (MUTATING_METHODS.has(req.method) && path.startsWith('/api/admin/')) {
    return { group: 'admin-mutation', limit: 100, windowMs: 10 * 60_000 };
  }
  if (MUTATING_METHODS.has(req.method) && path.startsWith('/api/')) {
    return { group: 'api-mutation', limit: 240, windowMs: 10 * 60_000 };
  }
  return null;
}

function contentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    "media-src 'self' blob: https:",
    "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com wss://*.firebaseio.com wss://generativelanguage.googleapis.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    'upgrade-insecure-requests'
  ].join('; ');
}

function sanitizeLogText(value: unknown): string {
  return String(value ?? '')
    .replace(/(authorization|access[_-]?token|refresh[_-]?token|secret|password|private[_-]?key)(\s*[:=]\s*)([^\s,;]+)/gi, '$1$2[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function publicErrorStatus(error: any): number {
  if (error?.code === 'CORS_DENIED') return 403;
  if (error?.type === 'entity.too.large') return 413;
  if (error?.type === 'entity.parse.failed') return 400;
  const requested = Number(error?.statusCode || error?.status);
  return Number.isSafeInteger(requested) && requested >= 400 && requested <= 599
    ? requested
    : 500;
}

function publicErrorMessage(error: any, status: number): string {
  if (error?.code === 'CORS_DENIED') return 'Origem não autorizada.';
  if (error?.type === 'entity.too.large' || status === 413) return 'Corpo da requisição excede o limite permitido.';
  if (error?.type === 'entity.parse.failed' || status === 400) return 'Corpo JSON inválido.';
  if (status === 429) return 'Muitas requisições. Aguarde antes de tentar novamente.';
  if (status === 503) return 'Serviço temporariamente indisponível.';
  if (status >= 500) return 'Erro interno do servidor.';
  return 'Requisição rejeitada.';
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Identificação, cabeçalhos e política de cache são definidos antes de qualquer resposta.
  app.use((req, res, next) => {
    const requestId = normalizedRequestId(req.headers['x-request-id']);
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');

    if (config.isProduction) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      res.setHeader('Content-Security-Policy', contentSecurityPolicy());
    }
    next();
  });

  app.use(cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      const normalized = origin.trim().replace(/\/$/, '');
      if (!config.isProduction || config.corsOrigins.includes(normalized)) {
        return callback(null, true);
      }
      const error: any = new Error('CORS denied');
      error.code = 'CORS_DENIED';
      error.statusCode = 403;
      return callback(error);
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Signature', 'X-Idempotency-Key'],
    exposedHeaders: ['X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Retry-After'],
    maxAge: 86_400
  }));

  // Rate limiting persistente é executado antes dos parsers e das operações onerosas.
  app.use(async (req, res, next) => {
    const policy = rateLimitPolicy(req);
    if (!policy) {
      next();
      return;
    }

    try {
      const result = await consumeRateLimit({
        key: `${policy.group}:${requestIp(req)}`,
        limit: policy.limit,
        windowMs: policy.windowMs
      });
      res.setHeader('RateLimit-Limit', String(result.limit));
      res.setHeader('RateLimit-Remaining', String(result.remaining));
      res.setHeader('RateLimit-Reset', String(Math.ceil(new Date(result.resetAt).getTime() / 1000)));

      if (!result.allowed) {
        const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
        res.setHeader('Retry-After', String(retryAfterSeconds));
        res.status(429).json({
          error: 'Muitas requisições. Aguarde antes de tentar novamente.',
          requestId: res.locals.requestId
        });
        return;
      }
      next();
    } catch (error) {
      const unavailable: any = new Error('Persistent rate limiter unavailable');
      unavailable.statusCode = 503;
      unavailable.code = 'RATE_LIMIT_STORE_UNAVAILABLE';
      unavailable.cause = error;
      next(unavailable);
    }
  });

  // O webhook mantém semântica JSON; Mercado Pago assina metadados, não o raw body.
  app.use(express.json({
    limit: '2mb',
    strict: true
  }));
  app.use(express.urlencoded({
    extended: false,
    limit: '256kb',
    parameterLimit: 100
  }));

  // ── Froc.IA SEO Engine: sitemaps (padrão Yoast), sitemap.txt, feed, XSL e IndexNow ──
  const seoCache = (res: Response) => res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=3600');
  app.get(['/sitemap.xml', '/sitemap_index.xml'], async (_req, res, next) => {
    try {
      seoCache(res);
      res.setHeader('X-Robots-Tag', 'noindex, follow');
      res.type('application/xml').send(await buildSitemapXml());
    } catch (error) {
      next(error);
    }
  });
  app.get(/^\/(?:page|post|vitrine|vitrine-post)-sitemap\d*\.xml$/, async (req, res, next) => {
    try {
      const parsed = parseSitemapPath(req.path);
      const xml = parsed ? await buildGroupSitemapXml(parsed.group, parsed.page) : null;
      if (!xml) {
        res.status(404).type('text/plain').send('Sitemap não encontrado.');
        return;
      }
      seoCache(res);
      res.setHeader('X-Robots-Tag', 'noindex, follow');
      res.type('application/xml').send(xml);
    } catch (error) {
      next(error);
    }
  });
  app.get('/sitemap.txt', async (_req, res, next) => {
    try {
      seoCache(res);
      res.type('text/plain').send(await buildSitemapTxt());
    } catch (error) {
      next(error);
    }
  });
  app.get('/main-sitemap.xsl', (_req, res) => {
    seoCache(res);
    res.type('text/xsl').send(buildSitemapXsl());
  });
  app.get(['/feed.xml', '/feed', '/rss.xml'], async (_req, res, next) => {
    try {
      seoCache(res);
      res.type('application/rss+xml').send(await buildRssFeed());
    } catch (error) {
      next(error);
    }
  });
  app.get('/robots.txt', (_req, res) => {
    seoCache(res);
    res.type('text/plain').send(buildRobotsTxt());
  });
  app.get('/indexnow-key.txt', (req, res, next) => {
    const key = indexNowKeyFromPath(req.path);
    if (!key) return next();
    res.type('text/plain').send(key);
  });

  // Direcionamento inteligente dos posts: site, app (Play Store/App Store pelo aparelho) e WhatsApp.
  app.get('/ir/:slug/:target', async (req, res, next) => {
    try {
      const postId = typeof req.query.p === 'string' ? req.query.p : undefined;
      const result = await handleRedirect(String(req.params.slug).slice(0, 200), String(req.params.target).slice(0, 20), String(req.headers['user-agent'] || ''), postId);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.redirect(result.status, result.location);
    } catch (error) {
      next(error);
    }
  });

  // Shell SEO dinâmico para páginas públicas (com conteúdo pré-renderizado para robôs).
  app.get(
    ['/', '/posts', '/vitrine', '/vitrine/:slug', '/vitrine/:slug/:postSlug', '/blog', '/blog/:slug', '/planos', '/termos', '/privacidade'],
    async (req, res, next) => {
      if (!config.isProduction) return next();
      try {
        const page = await renderPublicPage(req.path);
        res.status(page.status).type('text/html').send(page.html);
      } catch (error) {
        next(error);
      }
    }
  );

  // Ferramentas antigas agora executadas pelo Froc.IA na conversa: redirecionamento permanente.
  const legacyToolRedirects: Record<string, string> = {
    '/froc-ia': '/', '/estrategia': '/', '/autopilot': '/', '/criar-conteudo': '/', '/criar-imagem': '/',
    '/criar-video': '/', '/criar-artigo': '/', '/seo': '/', '/campanhas': '/', '/calendario': '/',
    '/redes-sociais': '/dashboard', '/analytics': '/dashboard'
  };
  app.get(Object.keys(legacyToolRedirects), (req, res) => {
    res.redirect(301, legacyToolRedirects[req.path.replace(/\/$/, '')] || '/');
  });

  const privateAppRoutes = [
    '/dashboard',
    '/empresa',
    '/conteudos',
    '/creditos',
    '/perfil',
    '/configuracoes',
    '/suporte',
    '/admin'
  ];
  app.get(privateAppRoutes, (req, res, next) => {
    if (!config.isProduction) return next();
    const page = renderPrivateAppPage(req.path);
    res.status(page.status).type('text/html').send(page.html);
  });

  app.use('/api', productionRouter);
  app.use('/api', (_req, res) => {
    res.status(404).json({
      error: 'Endpoint Froc.IA não encontrado.',
      requestId: res.locals.requestId
    });
  });

  app.use((error: any, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const status = publicErrorStatus(error);
    const requestId = String(res.locals.requestId || '');
    console.error('[Froc API Error]', {
      requestId,
      status,
      code: sanitizeLogText(error?.code || error?.type || 'INTERNAL_ERROR'),
      message: sanitizeLogText(error?.message || 'Falha desconhecida')
    });
    res.status(status).json({
      error: publicErrorMessage(error, status),
      requestId
    });
  });

  return app;
}

export default createApp();