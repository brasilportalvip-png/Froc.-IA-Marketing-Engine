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

const appUrl = env('APP_URL', 'http://localhost:3000').replace(/\/$/, '');
const corsOrigins = env('CORS_ORIGINS', `${appUrl},capacitor://localhost,https://localhost,http://localhost`)
  .split(',')
  .map((value) => value.trim().replace(/\/$/, ''))
  .filter(Boolean);

const defaultFirebasePrivateKey = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCrqB0dhcVfFf+L
djUO8VvwhgVYcWMYX/UymNZWXKsGzZ/ll3mMcnqXjnqLxraCcgGZE6Mi82M+LVhL
Fs0C0v8WRI1bnaWa9kyBuRFSU8gOjlBJOmqk8uarFtHNMRvYzLHFi/vJPFLFsJZq
gMkr473JslyMZ4h4ovjN7UqFe2vf8sreN2e+ynGf1qABIR5pLPpalzy17VFlf4LB
zv3UzvzCpgIGaDg5/wwOuhLqERKi2dzs0M7c9sp3gN+FZuHRRxtt5dNcPqfzfdjy
hUey4gLDoFuTFwz6TUDJ7FJOh2zD5ektv7wNcOTWhiUDKxC7cDIJuSkp7ABOtwfe
Tuk1D493AgMBAAECggEABzlN8F4ezj+Yv3+7/+L8YYTiWLR83Ru8r+Jqsru3ntOs
dPcI8HYo3pPqaFN2fsrZcl23MdNYS9eQrahJ/GJwxbkg0cgynfDbi2IEbpiEBMjM
bCh/MG3gczbEoYP9jgQfPxcDA5b8TMF/sv+0d5pf9EsDRg1dWuZQ3imsRy3IfmYh
pcmk5btdJMP3JMw3ydd2S+vxxaneJlkPT4rysLb7AKVoDEDX6uFuowMRhwTJsLex
WjjmKwPzvPyEsyJtolmpgiZ4RfD+v37mhsxkv23ma2rRhlCpyqTDYShiiFeUVfH8
qGrBPj82w8Myt495gY3r+rd28WCBT+vYCgqDj5pCsQKBgQDbjBGmVo+N4qkgVRhU
+6RcERPhVPrJHlSoCb3F3UnOxR2DSx5uA8E9bMXnOJMi8H41Lpxl/e6O5TmO7VJr
jCMTWSpx4QJY7aZnyJiAqJY8kuAyyiPwcPZkXNJn6Qvp97XpIJENwc9W3XzKxd6g
O/izYU8GTRzP7yhLvXJcHqVUewKBgQDIKHGekH10KAEjhdnzYJu6AUauNhj6PfVr
1b71Ksm1LBdf8ldTbUBzcPjC+7gpeip0JHhRfQCNKqqpjHcm7cTPekevyLdTPzzM
5hSMBcfMAjmq0IskZdSJ0qtNRqfQ/zWDcshsfDoO5zfncUKv5FLH7VbcbRquYmum
+dNOVG+WNQKBgFTdZvEqYqFQ7VlPK3GmOBlSjKG8jJhzffvakB3M9TvVHBxlTCTw
lKDey/0d9Fo8Jjz+gHw4VR+tYbtq50IlUGWpQOv2M0cWzg0uEC0jfbd6eumHE69c
qxGOg9Kg1fchxpKQASIVOcV1Jkjnha/gnrkQM1DXO/zwkF3+pBcRzYzDAoGAWsJk
Csdv63y8T3RBSOd0lZpAh3xGRSpVH6mTZi4Zuoocq0gDKvQuNmpykk97yWr41yM2
X5Tz7A79xdXIraFBDedfnCjCYAAbvLlTdc6lMy+LIJZhkYaPIlOhk2/HZrBifpFM
qkyGMv3LTqn/2CwLEVbgfSEH6Sz9rYA4vZrx4kUCgYEAziLq91MgGhIlgfCmKTBf
ZPfCRnE+YadgY4CQYAgHew7Kw0/K29X0qRHj8nfgnFShwJeyXXcQhdocZdpbpJR4
pHZo1JljL6WCMpS4rfjBv/UWJO85RO3FZpREQRztSlDd6RfUfhp0jnnHTea5AoJk
ZoVhoD6oOkiHhme3rcq4ybg=
-----END PRIVATE KEY-----`;

export const config = {
  port: Number(process.env.PORT || 3000),
  host: '0.0.0.0',
  nodeEnv,
  isProduction,
  appUrl,
  corsOrigins,
  geminiApiKey: env('GEMINI_API_KEY'),
  geminiModels: {
    text: env('GEMINI_MODEL_TEXT', 'gemini-3.7-flash'),
    pro: env('GEMINI_MODEL_PRO', 'gemini-3.1-pro-preview'),
    fallback: env('GEMINI_MODEL_FALLBACK', 'gemini-3.1-flash-lite'),
    image: env('GEMINI_MODEL_IMAGE', 'gemini-3.1-flash-image')
  },
  firebase: {
    projectId: env('FIREBASE_ADMIN_PROJECT_ID', 'froc-ia-marketing-engine'),
    clientEmail: env('FIREBASE_ADMIN_CLIENT_EMAIL', 'firebase-adminsdk-fbsvc@froc-ia-marketing-engine.iam.gserviceaccount.com'),
    privateKey: env('FIREBASE_ADMIN_PRIVATE_KEY', defaultFirebasePrivateKey).replace(/\\n/g, '\n')
  },
  mercadoPago: {
    accessToken: env('MERCADO_PAGO_ACCESS_TOKEN', 'APP_USR-5406660208660231-081710-7b6ab1d7944adc2fe0c0df04ad2ea60e-1208834600'),
    webhookSecret: env('MERCADO_PAGO_WEBHOOK_SECRET', '43251814cc231cea0835426040372e5ca38697cffb3318577a2e08f044dfdee9'),
    publicKey: env('MERCADO_PAGO_PUBLIC_KEY', 'APP_USR-b1eed7f4-d9f2-45f8-92fc-0a01eacd2467'),
    billingMode: env('MERCADO_PAGO_BILLING_MODE', 'subscription').toLowerCase() === 'one_time' ? 'one_time' : 'subscription'
  },
  encryptionKey: env('TOKEN_ENCRYPTION_KEY', 'froc_ia_token_encryption_key_32b_ok_2026!'),
  cronSecret: env('CRON_SECRET', 'froc_cron_secret_internal_2026'),
  adminBootstrapKey: env('ADMIN_BOOTSTRAP_KEY', 'froc_admin_bootstrap_key_2026'),
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
    autopilot_cycle: 60,
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
    ['ADMIN_BOOTSTRAP_KEY', config.adminBootstrapKey]
  ];
  for (const [name, value] of requiredValues) {
    if (!value) throw new Error(`[Froc.IA] Configuração de produção incompleta: ${name}`);
  }
}
