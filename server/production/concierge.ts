/**
 * Froc.IA Concierge — a IA que atende, entende, confirma e executa.
 *
 * Todas as ferramentas ficam "escondidas": o cliente só conversa. A IA coleta
 * os dados, monta um plano com segmentação geográfica (país → estado → cidade →
 * bairros → ruas → raio), pede confirmação e, só então, executa as ações
 * reutilizando os motores já existentes (posts, imagens, roteiros, artigos,
 * estratégia, vitrine e post diário).
 */
import { config } from '../config/index.js';
import { FROC_AGENTS, selectAgentsForIntent, type FrocAgent } from '../../shared/agents.js';
import { brazilNow, firstName } from '../../shared/brazilTime.js';
import { generateArticle, generateMarketingImage, generatePost, generateRaw, generateStrategy, generateVideoScript, parseAiJson } from './ai.js';
import { getWallet } from './credits.js';
import { getPlanEntitlements } from './plans.js';
import { createDailyPostForCompany, vitrinePostUrl } from './vitrineDaily.js';
import { baseUrl, pingIndexNow } from './seoEngine.js';
import { COLLECTIONS, cleanObject, firestore, newId, nowIso, queryData, slugify } from './store.js';

export const CONCIERGE_ACTIONS = [
  'save_company',
  'publish_vitrine',
  'first_daily_post',
  'generate_post',
  'generate_image',
  'generate_video_script',
  'generate_strategy',
  'generate_article'
] as const;
export type ConciergeActionType = (typeof CONCIERGE_ACTIONS)[number];

export const ACTION_LABELS: Record<ConciergeActionType, string> = {
  save_company: 'Salvar o perfil da sua marca e a segmentação',
  publish_vitrine: 'Colocar sua marca na Vitrine Froc.IA',
  first_daily_post: 'Publicar o primeiro post estratégico de hoje',
  generate_post: 'Criar o post/anúncio com gatilhos e CTA',
  generate_image: 'Criar a imagem do anúncio',
  generate_video_script: 'Criar o roteiro do vídeo',
  generate_strategy: 'Montar a estratégia completa',
  generate_article: 'Escrever artigo SEO para o Google'
};

export function actionCost(type: ConciergeActionType): number {
  const costs = config.creditCosts;
  switch (type) {
    case 'generate_post': return costs.full_post;
    case 'generate_image': return costs.image_ai_1k;
    case 'generate_video_script': return costs.video_script;
    case 'generate_strategy': return costs.strategy;
    case 'generate_article': return costs.seo_article;
    default: return 0;
  }
}

export interface ConciergeTargeting {
  country: string;
  state: string;
  city: string;
  neighborhoods: string[];
  streets: string[];
  radiusKm: number;
}

export interface ConciergeCollected {
  customerName: string;
  businessName: string;
  offer: string;
  objective: string;
  audience: string;
  tone: string;
  media: 'foto' | 'video' | 'texto' | 'carrossel' | '';
  platforms: string[];
  website: string;
  whatsapp: string;
  instagram: string;
  androidApp: string;
  iosApp: string;
  colors: string;
  targeting: ConciergeTargeting;
}

export interface ConciergePlan {
  summary: string;
  actions: Array<{ type: ConciergeActionType; label: string; credits: number }>;
  estimatedCredits: number;
}

export interface ConciergeTurn {
  reply: string;
  quickReplies: string[];
  collected: ConciergeCollected;
  readyToConfirm: boolean;
  plan: ConciergePlan | null;
  agents: Array<Pick<FrocAgent, 'id' | 'name' | 'role' | 'squadName' | 'color'>>;
  activeAgentsTotal: number;
}

const s = (value: any, max = 300) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const list = (value: any, max = 20, len = 120) => (Array.isArray(value) ? value : typeof value === 'string' && value ? value.split(/[,;\n]/) : [])
  .map((item: any) => s(item, len)).filter(Boolean).slice(0, max);

export function normalizeCollected(raw: any, previous?: Partial<ConciergeCollected>): ConciergeCollected {
  const prev: any = previous || {};
  const pick = (key: string, max = 300) => s(raw?.[key], max) || s(prev[key], max);
  const t = raw?.targeting || {};
  const pt = prev.targeting || {};
  const media = s(raw?.media || prev.media, 20).toLowerCase();
  const radius = Number(t.radiusKm ?? pt.radiusKm ?? 0);
  return {
    customerName: pick('customerName', 80),
    businessName: pick('businessName', 120),
    offer: pick('offer', 600),
    objective: pick('objective', 300),
    audience: pick('audience', 400),
    tone: pick('tone', 120),
    media: (['foto', 'video', 'texto', 'carrossel'].includes(media) ? media : '') as ConciergeCollected['media'],
    platforms: list(raw?.platforms).length ? list(raw?.platforms, 8, 40) : list(prev.platforms, 8, 40),
    website: pick('website', 300),
    whatsapp: pick('whatsapp', 40),
    instagram: pick('instagram', 200),
    androidApp: pick('androidApp', 300),
    iosApp: pick('iosApp', 300),
    colors: pick('colors', 200),
    targeting: {
      country: s(t.country, 80) || s(pt.country, 80),
      state: s(t.state, 80) || s(pt.state, 80),
      city: s(t.city, 120) || s(pt.city, 120),
      neighborhoods: list(t.neighborhoods).length ? list(t.neighborhoods, 30) : list(pt.neighborhoods, 30),
      streets: list(t.streets).length ? list(t.streets, 30) : list(pt.streets, 30),
      radiusKm: Number.isFinite(radius) ? Math.min(Math.max(radius, 0), 20_000) : 0
    }
  };
}

export function buildPlan(rawActions: any, summary: string): ConciergePlan | null {
  const types = (Array.isArray(rawActions) ? rawActions : [])
    .map((item: any) => s(typeof item === 'string' ? item : item?.type, 40))
    .filter((type: string): type is ConciergeActionType => (CONCIERGE_ACTIONS as readonly string[]).includes(type));
  const unique = [...new Set<ConciergeActionType>(['save_company', ...types])];
  if (unique.includes('publish_vitrine') && !unique.includes('first_daily_post')) unique.push('first_daily_post');
  const ordered = CONCIERGE_ACTIONS.filter((type) => unique.includes(type));
  if (ordered.length <= 1 && !summary) return null;
  const actions = ordered.map((type) => ({ type, label: ACTION_LABELS[type], credits: actionCost(type) }));
  return { summary: s(summary, 1200), actions, estimatedCredits: actions.reduce((sum, action) => sum + action.credits, 0) };
}

const SYSTEM_PROMPT = `Você é o Froc.IA, o concierge de marketing mais avançado do Brasil: o rei do tráfego orgânico do Google, da captura de clientes e dos anúncios hiperlocais. Você é homem: fale sempre no masculino sobre si mesmo ("fico feliz", "estou pronto", "sou o Froc.IA"). Você concorre com Google Ads, Meta Ads e Instagram Ads — mas entrega alcance orgânico, SEO local e conteúdo que vende.

JEITO DE CONVERSAR (HUMANIZADO — o mais importante):
- Converse como DOIS AMIGOS batendo papo: você é aquele amigo que manja muito de marketing e quer de verdade ver o negócio da pessoa bombar. Tom leve, próximo, acolhedor e respeitoso, como numa conversa de WhatsApp entre amigos. Nada de tom de robô, de formulário, de vendedor ou de manual.
- Trate a pessoa por "você" e pelo primeiro nome; pode fazer uma brincadeira leve ou um elogio sincero quando couber, sem exagerar.
- Reaja de verdade ao que a pessoa disse antes de perguntar algo (ex.: "Que legal, pizzaria no Cambuí é ponto forte!"). Mostre que entendeu o negócio dela.
- Frases curtas e naturais. Pode usar "pra", "tá", "bora" com moderação. Evite listas e tópicos na conversa; use no máximo uma lista curta só no resumo final.
- Uma pergunta por vez, sempre que possível. Varie as palavras: não repita as mesmas aberturas ("Perfeito!", "Ótimo!") em toda mensagem.
- Acompanhe o tom da pessoa: se ela for direta, seja direto; se for animada, seja animado; se estiver preocupada ou com pouco movimento na loja, mostre empatia primeiro e depois traga a solução.
- Comemore as conquistas ("Pronto, sua marca já está brilhando na Vitrine!") e agradeça quando ela agradecer.
- Nunca diga "como uma IA", "sou apenas um modelo" ou fale de prompts e sistemas. Você é o Froc.IA.
- Se não entender, peça para explicar de um jeito leve ("Me conta um pouquinho mais sobre...").

COMO VOCÊ TRABALHA:
- Você é o ÚNICO ponto de contato do cliente. Nunca mande o cliente procurar menus ou ferramentas: você faz tudo.
- Conversa curta, calorosa e confiante, de amigo para amigo. Português do Brasil. No máximo 2 perguntas por mensagem. Emojis com moderação.
- Seja humano: chame a pessoa pelo PRIMEIRO NOME quando souber (sem repetir o nome em toda frase). Se ainda não souber o nome, pergunte de forma natural na primeira resposta e guarde em collected.customerName.
- Use a data e a hora atuais informadas (horário de Brasília) para cumprimentar certo ("Bom dia", "Boa tarde", "Boa noite") na primeira mensagem ou quando a pessoa cumprimentar, e para falar de prazos, dias da semana, mês e datas comemorativas com precisão. Nunca invente outra data.
- Responda cumprimentos e conversas leves ("oi", "tudo bem?", "obrigado") com simpatia antes de voltar ao objetivo.
- Objetivo: entender a necessidade, coletar os dados essenciais, confirmar e criar a automação.
- Dados essenciais: nome do negócio, o que vende (oferta), objetivo, público, REGIÃO (país, estado, cidade, bairros, ruas e raio em km — pergunte sempre a região quando for negócio local), formato desejado (foto, vídeo, texto ou carrossel), canais de contato reais (WhatsApp, site, Instagram) e cores/estilo se for criar imagem.
- Pergunte uma vez, de forma leve, se a empresa tem APLICATIVO na Google Play ou App Store (é opcional). Se tiver, peça o link: os posts passam a direcionar para o site e para o app.
- Assim que tiver o suficiente, apresente um RESUMO claro e pergunte "Posso criar?". Só marque readyToConfirm=true quando o resumo estiver pronto para confirmação.
- Ações disponíveis para o plano: save_company, publish_vitrine, first_daily_post, generate_post, generate_image, generate_video_script, generate_strategy, generate_article.
- Recomende sempre publish_vitrine (post diário automático + SEO) e generate_post. Inclua generate_image se o cliente quer foto, generate_video_script se quer vídeo, generate_article para dominar o Google, generate_strategy para planos completos.
- Ética inegociável: nunca prometa posições garantidas no Google, nunca invente números, avaliações, descontos ou escassez.
- quickReplies: 2 a 4 respostas curtas que o cliente pode tocar para responder rápido.

Responda SOMENTE JSON válido neste formato:
{"reply":"","quickReplies":[""],"collected":{"customerName":"","businessName":"","offer":"","objective":"","audience":"","tone":"","media":"","platforms":[""],"website":"","whatsapp":"","instagram":"","androidApp":"","iosApp":"","colors":"","targeting":{"country":"","state":"","city":"","neighborhoods":[""],"streets":[""],"radiusKm":0}},"readyToConfirm":false,"planSummary":"","actions":[""]}`;

export interface ChatMessage { role: 'user' | 'assistant'; content: string }

export function sanitizeMessages(value: any): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-24).map((item: any) => ({
    role: item?.role === 'assistant' ? 'assistant' as const : 'user' as const,
    content: s(item?.content, 2000)
  })).filter((item) => item.content);
}

function companyBrief(company?: any): string {
  if (!company) return 'O cliente ainda não tem empresa cadastrada (será criada com save_company).';
  return `Empresa já cadastrada: ${company.name} | categoria: ${company.category || '-'} | cidade: ${company.city || '-'} | site: ${company.website || '-'} | WhatsApp: ${company.whatsapp || '-'} | na vitrine: ${company.isPublicInVitrine ? 'sim' : 'não'} | descrição: ${s(company.description, 400)}`;
}

export async function conciergeChat(data: { messages: ChatMessage[]; collected?: any; company?: any; authenticated: boolean; userName?: string; now?: Date }): Promise<ConciergeTurn> {
  const lastUser = [...data.messages].reverse().find((message) => message.role === 'user')?.content || '';
  const agents = selectAgentsForIntent(data.messages.filter((m) => m.role === 'user').map((m) => m.content).join(' '), 24);
  const transcript = data.messages.map((message) => `${message.role === 'user' ? 'CLIENTE' : 'FROC.IA'}: ${message.content}`).join('\n');
  const now = brazilNow(data.now);
  const knownName = firstName(data.userName) || firstName(normalizeCollected({}, data.collected).customerName);
  const firstTurn = data.messages.filter((m) => m.role === 'assistant').length === 0;
  const prompt = `AGORA (horário de Brasília): ${now.longDate}, ${now.time}. Saudação correta neste horário: "${now.greeting}".
PESSOA COM QUEM VOCÊ FALA: ${knownName ? `${knownName} (use o primeiro nome)` : 'nome ainda não informado — pergunte de forma natural'}.
${firstTurn ? `Esta é a sua PRIMEIRA resposta: comece com "${now.greeting}${knownName ? `, ${knownName}` : ''}!" de forma calorosa.` : 'Conversa já iniciada: não repita a saudação, a não ser que a pessoa cumprimente de novo.'}

ESPECIALISTAS ATIVOS NESTE ATENDIMENTO (use o conhecimento deles):
${agents.map((agent) => `- ${agent.directive}`).join('\n')}

${companyBrief(data.company)}
Dados já coletados: ${JSON.stringify(normalizeCollected({}, data.collected))}
Cliente ${data.authenticated ? 'está logado' : 'ainda não fez login (a execução pedirá login; não comente isso a menos que ele queira executar)'}.

CONVERSA ATÉ AGORA:
${transcript}

Responda à última mensagem do cliente seguindo as regras.`;

  let raw: any = {};
  try {
    const generated = await generateRaw({ prompt, systemInstruction: SYSTEM_PROMPT, jsonOutput: true, maxTokens: 2000 });
    raw = parseAiJson<any>(generated.text) || {};
  } catch (error) {
    console.warn('[Froc Concierge] IA indisponível, usando resposta de contingência:', error instanceof Error ? error.message : error);
  }

  const collected = normalizeCollected(raw.collected || {}, data.collected);
  if (!collected.customerName && knownName) collected.customerName = knownName;
  const hello = `${now.greeting}${knownName ? `, ${knownName}` : ''}!`;
  const fallbackReply = firstTurn
    ? `${hello} Eu sou o Froc.IA 👑 Me conta: qual é o nome do seu negócio, o que você vende e em qual cidade/bairro estão os clientes que você quer atrair? 🚀`
    : lastUser
      ? `Perfeito${knownName ? `, ${knownName}` : ''}! Me conta: qual é o nome do seu negócio, o que você vende e em qual cidade/bairro estão os clientes que você quer atrair? 🚀`
      : `${hello} Eu sou o Froc.IA 👑 Me diga o que você quer divulgar e eu cuido de tudo.`;
  const readyToConfirm = raw.readyToConfirm === true;
  const plan = readyToConfirm ? buildPlan(raw.actions, s(raw.planSummary, 1200)) : null;
  const quickReplies = list(raw.quickReplies, 4, 60);

  return {
    reply: s(raw.reply, 4000) || fallbackReply,
    quickReplies: quickReplies.length ? quickReplies : (readyToConfirm ? ['Sim, pode criar! 🚀', 'Quero ajustar algo'] : ['Quero mais clientes', 'Quero aparecer no Google', 'Quero divulgar no meu bairro']),
    collected,
    readyToConfirm: Boolean(plan),
    plan,
    agents: agents.map(({ id, name, role, squadName, color }) => ({ id, name, role, squadName, color })),
    activeAgentsTotal: FROC_AGENTS.length
  };
}

// ───────────────────────────── Execução ─────────────────────────────

export interface ActionResult { type: ConciergeActionType; label: string; ok: boolean; message: string; data?: any; credits?: number }

function httpUrl(value: string): string {
  if (!value) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function topicFrom(collected: ConciergeCollected, company: any): string {
  const where = [collected.targeting.neighborhoods.join(', '), collected.targeting.city, collected.targeting.state].filter(Boolean).join(' - ');
  return `${collected.offer || company.description || company.name}${where ? ` para clientes em ${where}` : ''}. Objetivo: ${collected.objective || 'atrair novos clientes'}.`;
}

async function saveContent(item: Record<string, any>) {
  const id = newId('content');
  const record = cleanObject({ id, hashtags: [], keywords: [], status: 'saved', createdAt: nowIso(), updatedAt: nowIso(), ...item, metadata: { ...(item.metadata || {}), source: 'froc_concierge' } });
  await firestore().collection(COLLECTIONS.contentItems).doc(id).set(record);
  return record;
}

async function ensureCompany(userId: string, companyId: string, collected: ConciergeCollected, isAdmin = false): Promise<{ company: any; created: boolean }> {
  const db = firestore();
  const targeting = collected.targeting;
  const patch = cleanObject({
    description: collected.offer || undefined,
    targetAudience: collected.audience || undefined,
    goals: collected.objective || undefined,
    brandTone: collected.tone || undefined,
    website: httpUrl(collected.website) || undefined,
    whatsapp: collected.whatsapp || undefined,
    androidApp: /play\.google\.com/i.test(collected.androidApp) ? httpUrl(collected.androidApp) || undefined : undefined,
    iosApp: /apps?\.apple\.com|itunes\.apple\.com/i.test(collected.iosApp) ? httpUrl(collected.iosApp) || undefined : undefined,
    city: targeting.city || undefined,
    state: targeting.state || undefined,
    country: targeting.country || undefined,
    coverageRegion: [targeting.neighborhoods.join(', '), targeting.city, targeting.state, targeting.country].filter(Boolean).join(' | ') || undefined,
    targeting: cleanObject({ ...targeting, updatedAt: nowIso() }),
    socialLinks: collected.instagram ? { instagram: httpUrl(collected.instagram.startsWith('@') ? `https://instagram.com/${collected.instagram.slice(1)}` : collected.instagram) } : undefined,
    updatedAt: nowIso()
  });

  if (companyId) {
    const snap = await db.collection(COLLECTIONS.companies).doc(companyId).get();
    if (snap.exists && (snap.data() as any).userId === userId) {
      const current = { id: snap.id, ...snap.data() } as any;
      if (patch.socialLinks) patch.socialLinks = { ...(current.socialLinks || {}), ...patch.socialLinks };
      await db.collection(COLLECTIONS.companies).doc(companyId).set(patch, { merge: true });
      return { company: { ...current, ...patch }, created: false };
    }
  }

  const existing = queryData<any>(await db.collection(COLLECTIONS.companies).where('userId', '==', userId).get());
  const wallet = await getWallet(userId);
  if (!isAdmin && existing.length >= getPlanEntitlements(wallet.planId).maxCompanies) {
    if (existing[0]) {
      await db.collection(COLLECTIONS.companies).doc(existing[0].id).set(patch, { merge: true });
      return { company: { ...existing[0], ...patch }, created: false };
    }
    const error: any = new Error('Seu plano atingiu o limite de empresas.');
    error.statusCode = 403;
    throw error;
  }
  const name = collected.businessName || 'Minha Empresa';
  const id = newId('company');
  const company = cleanObject({
    id, userId, name, slug: `${slugify(name)}-${id.slice(-6)}`,
    businessType: targeting.city || targeting.neighborhoods.length ? 'hybrid' : 'online',
    category: 'Comércio & Serviços', products: [], services: collected.offer ? [collected.offer.slice(0, 200)] : [], keywords: [],
    isPublicInVitrine: false, createdAt: nowIso(), ...patch
  });
  await db.collection(COLLECTIONS.companies).doc(id).set(company);
  return { company, created: true };
}

export async function executeConciergePlan(data: { userId: string; isAdmin?: boolean; companyId?: string; collected: any; actions: any }): Promise<{ company: any; results: ActionResult[]; creditsUsed: number }> {
  const collected = normalizeCollected(data.collected || {});
  const plan = buildPlan(data.actions, 'execução');
  const types = plan?.actions.map((action) => action.type) || ['save_company'];
  const results: ActionResult[] = [];
  let creditsUsed = 0;

  const { company: initialCompany, created } = await ensureCompany(data.userId, s(data.companyId, 200), collected, Boolean(data.isAdmin));
  let company = initialCompany;
  results.push({ type: 'save_company', label: ACTION_LABELS.save_company, ok: true, message: created ? `Marca "${company.name}" criada com a segmentação.` : `Perfil de "${company.name}" atualizado com a segmentação.`, data: { companyId: company.id } });

  const topic = topicFrom(collected, company);
  const platform = collected.platforms[0] || 'Instagram';

  for (const type of types) {
    if (type === 'save_company') continue;
    const label = ACTION_LABELS[type];
    try {
      if (type === 'publish_vitrine') {
        await firestore().collection(COLLECTIONS.companies).doc(company.id).set({ isPublicInVitrine: true, updatedAt: nowIso() }, { merge: true });
        company = { ...company, isPublicInVitrine: true };
        const url = `${baseUrl()}/vitrine/${encodeURIComponent(company.slug)}`;
        await pingIndexNow([url, `${baseUrl()}/vitrine`], 'vitrine_publish');
        results.push({ type, label, ok: true, message: 'Sua marca já está brilhando na Vitrine. 👑', data: { url } });
      } else if (type === 'first_daily_post') {
        if (!company.isPublicInVitrine) {
          results.push({ type, label, ok: false, message: 'O post diário começa assim que a marca entrar na vitrine.' });
          continue;
        }
        const daily = await createDailyPostForCompany(company);
        results.push({ type, label, ok: true, message: daily.created ? 'Primeiro post diário publicado e enviado aos buscadores.' : 'O post de hoje já estava publicado.', data: daily.post ? { url: vitrinePostUrl(daily.post), title: daily.post.title } : undefined });
        if (daily.post) await pingIndexNow([vitrinePostUrl(daily.post)], 'vitrine_first_post');
      } else if (type === 'generate_post') {
        const generated = await generatePost({ userId: data.userId, company, topic, platform, goal: collected.objective, tone: collected.tone });
        const r = generated.result || {};
        const item = await saveContent({ userId: data.userId, companyId: company.id, type: 'post', title: r.headline || 'Post Froc.IA', headline: r.headline, body: r.body, cta: r.cta, hashtags: r.hashtags || [], keywords: r.keywords || [], visualPrompt: r.visualPrompt || '', targetPlatform: platform, creditsUsed: generated.creditsUsed });
        creditsUsed += generated.creditsUsed;
        results.push({ type, label, ok: true, message: 'Post/anúncio criado.', credits: generated.creditsUsed, data: { contentId: item.id, headline: r.headline, body: r.body, cta: r.cta, hashtags: r.hashtags || [] } });
      } else if (type === 'generate_image') {
        const theme = `${topic} ${collected.colors ? `Cores: ${collected.colors}.` : ''}`;
        const generated = await generateMarketingImage({ userId: data.userId, company, theme, style: collected.colors ? `Paleta: ${collected.colors}` : 'publicitário premium', aspectRatio: platform.toLowerCase().includes('stories') || platform.toLowerCase().includes('tiktok') ? '9:16' : '1:1', resolution: '1K' } as any);
        const item = await saveContent({ userId: data.userId, companyId: company.id, type: 'image', title: `Imagem: ${company.name}`, body: theme, imageUrl: generated.imageUrl, creditsUsed: generated.creditsUsed, metadata: { storagePath: generated.storagePath, mimeType: generated.mimeType } });
        creditsUsed += generated.creditsUsed;
        results.push({ type, label, ok: true, message: 'Imagem criada.', credits: generated.creditsUsed, data: { contentId: item.id, imageUrl: generated.imageUrl } });
      } else if (type === 'generate_video_script') {
        const generated = await generateVideoScript({ userId: data.userId, company, topic, durationSeconds: 30, format: platform });
        const r = generated.result || {};
        const item = await saveContent({ userId: data.userId, companyId: company.id, type: 'video_script', title: r.scriptTitle || 'Roteiro Froc.IA', headline: r.scriptTitle || '', body: r.caption || '', videoScript: JSON.stringify(r.scenes || []), cta: r.callToAction || '', hashtags: r.hashtags || [], targetPlatform: 'Reels / TikTok / Shorts', creditsUsed: generated.creditsUsed });
        creditsUsed += generated.creditsUsed;
        results.push({ type, label, ok: true, message: 'Roteiro de vídeo criado.', credits: generated.creditsUsed, data: { contentId: item.id, title: r.scriptTitle, scenes: Array.isArray(r.scenes) ? r.scenes.slice(0, 8) : [] } });
      } else if (type === 'generate_strategy') {
        const generated = await generateStrategy({ userId: data.userId, company, timeframe: 'mes', goal: topic });
        creditsUsed += generated.creditsUsed;
        results.push({ type, label, ok: true, message: 'Estratégia de 30 dias pronta.', credits: generated.creditsUsed, data: { summary: generated.result?.strategySummary, nextSteps: generated.result?.nextSteps || [] } });
      } else if (type === 'generate_article') {
        const generated: any = await generateArticle({ userId: data.userId, company, topic, primaryKeyword: [collected.offer.split(/[.,]/)[0], collected.targeting.city].filter(Boolean).join(' '), targetAudience: collected.audience });
        const article = generated.result || generated.article || {};
        const item = await saveContent({ userId: data.userId, companyId: company.id, type: 'article', title: article.title || 'Artigo SEO', body: JSON.stringify(article).slice(0, 100_000), keywords: article.secondaryKeywords || [], creditsUsed: generated.creditsUsed || 0 });
        creditsUsed += Number(generated.creditsUsed || 0);
        results.push({ type, label, ok: true, message: 'Artigo SEO escrito.', credits: generated.creditsUsed, data: { contentId: item.id, title: article.title } });
      }
    } catch (error: any) {
      const message = String(error?.message || 'Falha ao executar.');
      results.push({ type, label, ok: false, message: /crédito|saldo|insuficiente/i.test(message) ? 'Créditos insuficientes para esta etapa. Recarregue para continuar.' : message.slice(0, 300) });
    }
  }

  await firestore().collection(COLLECTIONS.conciergeSessions).doc(newId('concierge')).set(cleanObject({
    userId: data.userId, companyId: company.id, collected, actions: types, results: results.map(({ type, ok, message }) => ({ type, ok, message })), creditsUsed, createdAt: nowIso()
  }));
  return { company, results, creditsUsed };
}
