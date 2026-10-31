import dotenv from 'dotenv';
import { CREDIT_COSTS } from '../../shared/creditCosts.js';

dotenv.config();

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';
const isTest = nodeEnv === 'test' || process.env.NODE_ENV === 'test';

function env(name: string, fallback = ''): string {
  const val = (process.env[name] ?? '').trim();
  if (isTest && !val) return fallback;
  return val ? val : fallback;
}

function required(name: string, fallback = ''): string {
  const value = env(name, fallback);
  if (isProduction && !value) {
    throw new Error(`[Froc.IA] Variável obrigatória ausente em produção: ${name}`);
  }
  return value;
}

const appUrl = (isProduction
  ? env('APP_URL')
  : env('APP_URL', 'http://localhost:3000')).replace(/\/$/, '');

const CAPACITOR_CORS_ORIGINS = [
  'capacitor://localhost',
  'https://localhost',
  'http://localhost'
] as const;

export function resolveCorsOrigins(
  configuredOrigins: string,
  applicationUrl: string
): string[] {
  const normalized = [
    applicationUrl,
    ...configuredOrigins.split(','),
    ...CAPACITOR_CORS_ORIGINS
  ]
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter(Boolean);

  return [...new Set(normalized)];
}

const corsOrigins = resolveCorsOrigins(
  env('CORS_ORIGINS'),
  appUrl || 'http://localhost:3000'
);

export const config = {
  port: Number(process.env.PORT || 3000),
  host: '0.0.0.0',
  nodeEnv,
  isProduction,
  appUrl,
  corsOrigins,
  geminiApiKey: env('GEMINI_API_KEY'),
  geminiMediaApiKey: env('GEMINI_MEDIA_API_KEY') || env('GEMINI_API_KEY'),
  geminiModels: {
    text: env('GEMINI_MODEL_TEXT', 'gemini-2.5-flash'),
    pro: env('GEMINI_MODEL_PRO', 'gemini-3.1-pro-preview'),
    fallback: env('GEMINI_MODEL_FALLBACK', 'gemini-3.1-flash-lite'),
    image: env('GEMINI_MODEL_IMAGE', 'gemini-3.1-flash-image'),
    imageLite: env('GEMINI_MODEL_IMAGE_LITE', 'gemini-3.1-flash-lite-image'),
    veoLite: env('GEMINI_MODEL_VEO_LITE', 'veo-3.1-lite-generate-preview'),
    veoFast: env('GEMINI_MODEL_VEO_FAST', 'veo-3.1-fast-generate-preview'),
    veoCinema: env('GEMINI_MODEL_VEO_CINEMA', 'veo-3.1-generate-preview'),
    veo: env('GEMINI_MODEL_VEO', 'veo-3.1-generate-preview')
  },
  firebase: {
    projectId: env('FIREBASE_ADMIN_PROJECT_ID', nodeEnv === 'test' ? 'froc-ia-test' : ''),
    clientEmail: env('FIREBASE_ADMIN_CLIENT_EMAIL', nodeEnv === 'test' ? 'test@froc-ia-test.iam.gserviceaccount.com' : ''),
    privateKey: env('FIREBASE_ADMIN_PRIVATE_KEY', '').replace(/\\n/g, '\n')
  },
  mercadoPago: {
    accessToken: env('MERCADO_PAGO_ACCESS_TOKEN', isTest ? 'TEST-mock-access-token-123456' : ''),
    webhookSecret: env('MERCADO_PAGO_WEBHOOK_SECRET', isTest ? 'TEST-mock-webhook-secret-123456' : ''),
    publicKey: env('MERCADO_PAGO_PUBLIC_KEY', isTest ? 'TEST-mock-public-key-123456' : ''),
    billingMode: env('MERCADO_PAGO_BILLING_MODE', 'subscription').toLowerCase() === 'one_time' ? 'one_time' : 'subscription'
  },
  encryptionKey: env('TOKEN_ENCRYPTION_KEY', isTest ? 'test_token_encryption_key_32bytes_long!' : ''),
  cronSecret: env('CRON_SECRET', isTest ? 'test_cron_secret' : ''),
  adminBootstrap: {
    enabled: env('ADMIN_BOOTSTRAP_ENABLED', isProduction ? 'false' : 'true').toLowerCase() === 'true',
    key: env('ADMIN_BOOTSTRAP_KEY', isTest ? 'test_admin_bootstrap_key' : '')
  },
  adminBootstrapKey: env('ADMIN_BOOTSTRAP_KEY', isTest ? 'test_admin_bootstrap_key' : ''),
  freeSignupBonusCredits: Number(env('FREE_SIGNUP_BONUS_CREDITS', '25')),
  support: {
    email: env('SUPPORT_EMAIL', 'brasilportalvip@gmail.com'),
    whatsapp: env('SUPPORT_WHATSAPP')
  },
  blog: {
    // Ligado por padrão: o site publica 1 artigo por dia no Froc Magazine (desligue com AUTO_BLOG_ENABLED=false).
    autoEnabled: env('AUTO_BLOG_ENABLED', isTest ? 'false' : 'true').toLowerCase() === 'true',
    author: env('BLOG_AUTHOR', 'Equipe Froc.IA')
  },
  seoEngine: {
    // Chave IndexNow (Bing, Yandex, Seznam, Naver, Yep). 8-128 caracteres [a-zA-Z0-9-].
    indexNowKey: env('INDEXNOW_KEY', isTest ? 'froctestindexnowkey123' : ''),
    indexNowEnabled: env('INDEXNOW_ENABLED', 'true').toLowerCase() === 'true',
    googleSiteVerification: env('GOOGLE_SITE_VERIFICATION', 'WgcZ29owPWh-IYCntXdzzCadEoHsfk7NA7rx65_NRE4'),
    bingSiteVerification: env('BING_SITE_VERIFICATION'),
    urlsPerSitemap: Math.min(Math.max(Number(env('SITEMAP_URLS_PER_FILE', '1000')) || 1000, 50), 50_000)
  },
  // Autopilot antigo: sem tela no painel atual, fica desligado para não gastar créditos de forma invisível.
  legacyAutopilotEnabled: env('LEGACY_AUTOPILOT_ENABLED', 'false').toLowerCase() === 'true',
  // Imagem criada pela IA para cada post (Vitrine + Magazine), ligada ao nicho do projeto.
  postImages: {
    enabled: env('POST_IMAGES_ENABLED', 'true').toLowerCase() === 'true',
    perTick: Math.min(Math.max(Number(env('POST_IMAGES_PER_TICK', '2')) || 2, 0), 20)
  },
  vitrineDaily: {
    enabled: env('VITRINE_DAILY_POSTS_ENABLED', 'true').toLowerCase() === 'true',
    perTick: Math.min(Math.max(Number(env('VITRINE_DAILY_POSTS_PER_TICK', '2')) || 2, 1), 25)
  },
  social: {
    meta: {
      clientId: env('META_APP_ID', isTest ? 'mock_meta_app_id' : ''),
      clientSecret: env('META_APP_SECRET', isTest ? 'mock_meta_app_secret' : ''),
      graphVersion: env('META_GRAPH_VERSION', 'v24.0')
    },
    linkedin: {
      clientId: env('LINKEDIN_CLIENT_ID', isTest ? 'mock_linkedin_client_id' : ''),
      clientSecret: env('LINKEDIN_CLIENT_SECRET', isTest ? 'mock_linkedin_client_secret' : ''),
      apiVersion: env('LINKEDIN_API_VERSION')
    },
    google: {
      clientId: env('GOOGLE_CLIENT_ID', isTest ? 'mock_google_client_id' : ''),
      clientSecret: env('GOOGLE_CLIENT_SECRET', isTest ? 'mock_google_client_secret' : '')
    },
    tiktok: {
      clientId: env('TIKTOK_CLIENT_KEY', isTest ? 'mock_tiktok_client_id' : ''),
      clientSecret: env('TIKTOK_CLIENT_SECRET', isTest ? 'mock_tiktok_client_secret' : '')
    },
    pinterest: {
      clientId: env('PINTEREST_APP_ID', isTest ? 'mock_pinterest_client_id' : ''),
      clientSecret: env('PINTEREST_APP_SECRET', isTest ? 'mock_pinterest_client_secret' : '')
    },
    x: {
      clientId: env('X_CLIENT_ID', isTest ? 'mock_x_client_id' : ''),
      clientSecret: env('X_CLIENT_SECRET', isTest ? 'mock_x_client_secret' : '')
    }
  },
  plans: [
    {
      id: 'plan_start', name: 'START', price: 49.0, period: 'mês', credits: 100,
      bonusCredits: 10, totalCredits: 110, popular: false,
      features: ['110 créditos mensais incluídos', 'Até 2 marcas', 'Froc.IA por texto e voz', 'Posts, legendas e CTAs com gatilhos', 'Vitrine com 1 post estratégico por dia', 'SEO local por cidade e bairro']
    },
    {
      id: 'plan_pro', name: 'PRO', price: 99.9, period: 'mês', credits: 210,
      bonusCredits: 20, totalCredits: 230, popular: true,
      features: ['230 créditos mensais incluídos', 'Até 5 marcas', 'Froc.IA com voz neural', 'Imagens e roteiros de vídeo com IA', 'Artigos SEO para o Google', 'Vitrine com post diário + IndexNow', 'Suporte prioritário']
    },
    {
      id: 'plan_business', name: 'BUSINESS', price: 199.9, period: 'mês', credits: 450,
      bonusCredits: 30, totalCredits: 480, popular: false,
      features: ['480 créditos mensais incluídos', 'Até 15 marcas', 'Tudo do PRO', 'Estratégias completas de 30 dias', 'SEO técnico e dados estruturados', 'Segmentação por país, cidade, bairro e rua', 'Prioridade na Vitrine']
    },
    {
      id: 'plan_agency', name: 'AGENCY', price: 399.9, period: 'mês', credits: 900,
      bonusCredits: 100, totalCredits: 1000, popular: false,
      features: ['1.000 créditos mensais incluídos', 'Marcas ilimitadas', 'Tudo do BUSINESS', 'Ideal para agências e multi-marcas', 'Prioridade de processamento', 'Gerente de conta dedicado']
    }
  ],
  creditCosts: CREDIT_COSTS
} as const;


export function assertProductionConfig(): void {
  if (!isProduction) return;
  const requiredValues: Array<[string, string]> = [
    ['APP_URL', config.appUrl],
    ['FIREBASE_ADMIN_PROJECT_ID', config.firebase.projectId],
    ['FIREBASE_ADMIN_CLIENT_EMAIL', config.firebase.clientEmail],
    ['FIREBASE_ADMIN_PRIVATE_KEY', config.firebase.privateKey],
    ['TOKEN_ENCRYPTION_KEY', config.encryptionKey],
    ['CRON_SECRET', config.cronSecret],
    ['GEMINI_API_KEY', config.geminiApiKey],
    ['GEMINI_MEDIA_API_KEY', process.env.GEMINI_MEDIA_API_KEY || '']
  ];
  for (const [name, value] of requiredValues) {
    if (!value) throw new Error(`[Froc.IA] Configuração de produção incompleta: ${name}`);
  }

  // Validação estrita de formato e segurança para APP_URL em produção
  if (!config.appUrl.startsWith('https://')) {
    throw new Error(`[Froc.IA] APP_URL em produção deve usar HTTPS obrigatório (atual: ${config.appUrl})`);
  }
  if (config.appUrl.includes('localhost') || config.appUrl.includes('127.0.0.1')) {
    throw new Error(`[Froc.IA] APP_URL em produção não pode ser localhost ou 127.0.0.1 (atual: ${config.appUrl})`);
  }

  if (config.mercadoPago.accessToken || config.mercadoPago.webhookSecret) {
    if (!config.mercadoPago.accessToken) throw new Error('[Froc.IA] Configuração de produção incompleta: MERCADO_PAGO_ACCESS_TOKEN');
    if (!config.mercadoPago.webhookSecret) throw new Error('[Froc.IA] Configuração de produção incompleta: MERCADO_PAGO_WEBHOOK_SECRET');
  }

  if (config.adminBootstrap.enabled && !config.adminBootstrap.key) {
    throw new Error('[Froc.IA] ADMIN_BOOTSTRAP_KEY obrigatória quando ADMIN_BOOTSTRAP_ENABLED=true');
  }

  // Validação de pares de credenciais OAuth opcionais
  const oauthProviders = [
    { name: 'Meta', id: config.social.meta.clientId, secret: config.social.meta.clientSecret, idVar: 'META_APP_ID', secretVar: 'META_APP_SECRET' },
    { name: 'LinkedIn', id: config.social.linkedin.clientId, secret: config.social.linkedin.clientSecret, idVar: 'LINKEDIN_CLIENT_ID', secretVar: 'LINKEDIN_CLIENT_SECRET' },
    { name: 'Google/YouTube', id: config.social.google.clientId, secret: config.social.google.clientSecret, idVar: 'GOOGLE_CLIENT_ID', secretVar: 'GOOGLE_CLIENT_SECRET' },
    { name: 'TikTok', id: config.social.tiktok.clientId, secret: config.social.tiktok.clientSecret, idVar: 'TIKTOK_CLIENT_KEY', secretVar: 'TIKTOK_CLIENT_SECRET' },
    { name: 'Pinterest', id: config.social.pinterest.clientId, secret: config.social.pinterest.clientSecret, idVar: 'PINTEREST_APP_ID', secretVar: 'PINTEREST_APP_SECRET' },
    { name: 'X', id: config.social.x.clientId, secret: config.social.x.clientSecret, idVar: 'X_CLIENT_ID', secretVar: 'X_CLIENT_SECRET' }
  ];

  for (const p of oauthProviders) {
    if (Boolean(p.id) !== Boolean(p.secret)) {
      throw new Error(`[Froc.IA] Configuração OAuth incompleta para ${p.name}: ${p.idVar} e ${p.secretVar} devem ser configurados juntos.`);
    }
  }
}
