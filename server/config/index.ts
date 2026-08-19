import dotenv from 'dotenv';

dotenv.config();

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

function env(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
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

const corsOrigins = env('CORS_ORIGINS', `${appUrl || 'http://localhost:3000'},capacitor://localhost,https://localhost,http://localhost`)
  .split(',')
  .map((value) => value.trim().replace(/\/$/, ''))
  .filter(Boolean);

export const config = {
  port: Number(process.env.PORT || 3000),
  host: '0.0.0.0',
  nodeEnv,
  isProduction,
  appUrl,
  corsOrigins,
  geminiApiKey: env('GEMINI_API_KEY'),
  geminiModels: {
    text: env('GEMINI_MODEL_TEXT', 'gemini-2.5-flash'),
    pro: env('GEMINI_MODEL_PRO', 'gemini-3.1-pro-preview'),
    fallback: env('GEMINI_MODEL_FALLBACK', 'gemini-3.1-flash-lite'),
    image: env('GEMINI_MODEL_IMAGE', 'gemini-3.1-flash-image')
  },
  firebase: {
    projectId: env('FIREBASE_ADMIN_PROJECT_ID', nodeEnv === 'test' ? 'froc-ia-test' : ''),
    clientEmail: env('FIREBASE_ADMIN_CLIENT_EMAIL', nodeEnv === 'test' ? 'test@froc-ia-test.iam.gserviceaccount.com' : ''),
    privateKey: env('FIREBASE_ADMIN_PRIVATE_KEY', '').replace(/\\n/g, '\n')
  },
  mercadoPago: {
    accessToken: env('MERCADO_PAGO_ACCESS_TOKEN'),
    webhookSecret: env('MERCADO_PAGO_WEBHOOK_SECRET'),
    publicKey: env('MERCADO_PAGO_PUBLIC_KEY'),
    billingMode: env('MERCADO_PAGO_BILLING_MODE', 'subscription').toLowerCase() === 'one_time' ? 'one_time' : 'subscription'
  },
  encryptionKey: env('TOKEN_ENCRYPTION_KEY', nodeEnv === 'test' ? 'test_token_encryption_key_32bytes_long!' : ''),
  cronSecret: env('CRON_SECRET', nodeEnv === 'test' ? 'test_cron_secret' : ''),
  adminBootstrap: {
    enabled: env('ADMIN_BOOTSTRAP_ENABLED', isProduction ? 'false' : 'true').toLowerCase() === 'true',
    key: env('ADMIN_BOOTSTRAP_KEY', nodeEnv === 'test' ? 'test_admin_bootstrap_key' : '')
  },
  adminBootstrapKey: env('ADMIN_BOOTSTRAP_KEY', nodeEnv === 'test' ? 'test_admin_bootstrap_key' : ''),
  freeSignupBonusCredits: Number(env('FREE_SIGNUP_BONUS_CREDITS', '25')),
  support: {
    email: env('SUPPORT_EMAIL', 'brasilportalvip@gmail.com'),
    whatsapp: env('SUPPORT_WHATSAPP')
  },
  blog: {
    autoEnabled: env('AUTO_BLOG_ENABLED', 'false').toLowerCase() === 'true',
    author: env('BLOG_AUTHOR', 'Equipe Froc.IA')
  },
  social: {
    meta: {
      clientId: env('META_APP_ID'),
      clientSecret: env('META_APP_SECRET'),
      graphVersion: env('META_GRAPH_VERSION', 'v24.0')
    },
    linkedin: {
      clientId: env('LINKEDIN_CLIENT_ID'),
      clientSecret: env('LINKEDIN_CLIENT_SECRET'),
      apiVersion: env('LINKEDIN_API_VERSION')
    },
    google: {
      clientId: env('GOOGLE_CLIENT_ID'),
      clientSecret: env('GOOGLE_CLIENT_SECRET')
    },
    tiktok: {
      clientId: env('TIKTOK_CLIENT_KEY'),
      clientSecret: env('TIKTOK_CLIENT_SECRET')
    },
    pinterest: {
      clientId: env('PINTEREST_APP_ID'),
      clientSecret: env('PINTEREST_APP_SECRET')
    },
    x: {
      clientId: env('X_CLIENT_ID'),
      clientSecret: env('X_CLIENT_SECRET')
    }
  },
  plans: [
    {
      id: 'plan_start', name: 'START', price: 49.0, period: 'mês', credits: 100,
      bonusCredits: 10, totalCredits: 110, popular: false,
      features: ['110 créditos mensais incluídos', 'Até 2 empresas cadastradas', 'Criação de posts, legendas e CTAs', 'Análise de SEO básica', 'Agendamento de publicações', 'Acesso à Vitrine Froc']
    },
    {
      id: 'plan_pro', name: 'PRO', price: 99.9, period: 'mês', credits: 210,
      bonusCredits: 20, totalCredits: 230, popular: true,
      features: ['230 créditos mensais incluídos', 'Até 5 empresas cadastradas', 'Motor Froc AI completo', 'SEO inteligente', 'Autopilot com aprovação manual', 'Artigos para blog', 'Conexões sociais', 'Suporte prioritário']
    },
    {
      id: 'plan_business', name: 'BUSINESS', price: 199.9, period: 'mês', credits: 450,
      bonusCredits: 30, totalCredits: 480, popular: false,
      features: ['480 créditos mensais incluídos', 'Até 15 empresas cadastradas', 'Autopilot automático', 'Campanhas multicanal', 'Froc Magazine', 'SEO técnico e Schema', 'Analytics consolidado']
    },
    {
      id: 'plan_agency', name: 'AGENCY', price: 399.9, period: 'mês', credits: 900,
      bonusCredits: 100, totalCredits: 1000, popular: false,
      features: ['1.000 créditos mensais incluídos', 'Empresas ilimitadas', 'Prioridade de processamento', 'Autopilot multi-marca', 'Roteiros e prompts avançados', 'Webhooks e integrações', 'Gerente de conta dedicado']
    }
  ],
  creditCosts: {
    cta: 1,
    headline: 1,
    caption: 2,
    full_post: 5,
    image_prompt: 10,
    variations: 10,
    image_ai: 15,
    site_analysis: 20,
    strategy: 30,
    carousel: 30,
    seo_article: 35,
    video_script: 40,
    campaign: 50,
    autopilot_cycle: 5,
    auto_calendar: 100
  }
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
    ['GEMINI_API_KEY', config.geminiApiKey]
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
