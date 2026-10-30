/**
 * Froc.IA — Post diário estratégico para cada projeto da Vitrine.
 *
 * Todo dia, cada empresa pública na vitrine ganha um post otimizado para
 * tráfego orgânico (SEO local + intenção de compra), com gatilhos éticos e
 * chamada para ação apontando somente para os canais reais da empresa.
 * Idempotente: o documento do dia tem ID fixo `${companyId}_${YYYY-MM-DD}`.
 */
import { config } from '../config/index.js';
import { selectAgentsForIntent } from '../../shared/agents.js';
import { companyContext, generateRaw, parseAiJson } from './ai.js';
import { baseUrl, pingIndexNow } from './seoEngine.js';
import { COLLECTIONS, firestore, nowIso, queryData, slugify } from './store.js';

export const DAILY_ANGLES = [
  { id: 'guia-local', label: 'Guia local', brief: 'um guia útil para quem procura este tipo de solução na região atendida' },
  { id: 'perguntas', label: 'Perguntas frequentes', brief: 'responder as perguntas reais que o cliente faz antes de comprar' },
  { id: 'como-escolher', label: 'Como escolher', brief: 'um checklist de como escolher bem, mostrando por que esta empresa atende os critérios' },
  { id: 'bastidores', label: 'Bastidores', brief: 'mostrar como a empresa trabalha e o cuidado por trás do serviço/produto' },
  { id: 'erros-comuns', label: 'Erros comuns', brief: 'os erros mais comuns que o cliente comete e como evitá-los' },
  { id: 'diferenciais', label: 'Diferenciais', brief: 'transformar os diferenciais reais da empresa em benefícios concretos' },
  { id: 'antes-depois', label: 'Problema e solução', brief: 'descrever o problema do cliente e o caminho até a solução' },
  { id: 'sazonal', label: 'Momento certo', brief: 'por que este é um bom momento para resolver essa necessidade, sem inventar promoções' },
  { id: 'comparativo', label: 'Comparativo honesto', brief: 'comparar opções de forma honesta e explicar quando esta empresa é a melhor escolha' },
  { id: 'dicas', label: 'Dicas práticas', brief: 'dicas práticas que geram valor imediato (reciprocidade) e convidam ao contato' },
  { id: 'publico', label: 'Para quem é', brief: 'mostrar para quem a solução é ideal e para quem não é (especificidade gera confiança)' },
  { id: 'objecoes', label: 'Quebra de objeções', brief: 'responder as principais objeções de compra com transparência' },
  { id: 'jornada', label: 'Passo a passo', brief: 'explicar o passo a passo de como é contratar/comprar desta empresa' },
  { id: 'autoridade', label: 'Autoridade', brief: 'demonstrar conhecimento do assunto ensinando algo relevante do segmento' }
] as const;

export function todayInSaoPaulo(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function angleForDate(dateStr: string, companyId: string) {
  const day = Math.floor(new Date(`${dateStr}T12:00:00Z`).getTime() / 86_400_000);
  let hash = 0;
  for (const char of companyId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return DAILY_ANGLES[(day + hash) % DAILY_ANGLES.length];
}

function locationLine(company: any): string {
  const t = company.targeting || {};
  const parts = [
    ...(Array.isArray(t.streets) ? t.streets : []),
    ...(Array.isArray(t.neighborhoods) ? t.neighborhoods : []),
    t.city || company.city,
    t.state || company.state,
    t.country || company.country
  ].map((value) => String(value || '').trim()).filter(Boolean);
  return [...new Set(parts)].join(', ');
}

export function buildDailyPostPrompt(company: any, dateStr: string): { prompt: string; angle: (typeof DAILY_ANGLES)[number] } {
  const angle = angleForDate(dateStr, String(company.id || company.slug || 'x'));
  const where = locationLine(company);
  const agents = selectAgentsForIntent(`${angle.brief} ${company.category || ''} ${where} seo vitrine gatilho cliente`, 14);
  const prompt = `Você é o time Froc.IA de tráfego orgânico. Especialistas acionados hoje:
${agents.map((agent) => `- ${agent.directive}`).join('\n')}

TAREFA: escrever o post diário (${dateStr}) da empresa "${company.name}" na Vitrine Froc.IA.
Ângulo do dia: ${angle.label} — ${angle.brief}.
Região-alvo para SEO local: ${where || 'não informada (não invente localização)'}.

REGRAS DE OURO (tráfego orgânico + captura de clientes):
1. Título SEO com no máximo 60 caracteres contendo a palavra-chave principal${where ? ' e a localização principal' : ''}.
2. Meta description entre 120 e 155 caracteres, com benefício + chamada para ação.
3. Conteúdo em Markdown de 450 a 750 palavras, com gancho forte no primeiro parágrafo, subtítulos H2/H3 e parágrafos curtos para leitura no celular.
4. Use gatilhos ÉTICOS: curiosidade, especificidade, autoridade (ensinando), reciprocidade (dicas úteis), quebra de objeções e prova social SOMENTE se fornecida no contexto.
5. Proibido inventar: preços, descontos, prazos, números, avaliações, depoimentos, prêmios ou escassez falsa.
6. Termine com uma seção "## Fale com ${company.name}" com CTA irresistível direcionando somente aos canais verificados do contexto.
7. Inclua 3 perguntas frequentes reais (para FAQ com dados estruturados).
8. Palavras-chave: 1 principal + 4 secundárias de cauda longa com intenção de compra${where ? ' e variações locais' : ''}.

Responda SOMENTE JSON válido:
{"title":"","metaDescription":"","hook":"","content":"","cta":"","faq":[{"question":"","answer":""}],"primaryKeyword":"","keywords":[""],"suggestedSlug":""}`;
  return { prompt, angle };
}

function str(value: any, max: number): string {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

export function normalizeDailyPost(raw: any, company: any, dateStr: string, angle: (typeof DAILY_ANGLES)[number]) {
  const title = str(raw?.title || raw?.headline, 120) || `${company.name}: ${angle.label}`;
  const content = str(raw?.content || raw?.body, 30_000);
  const summary = str(raw?.metaDescription || raw?.hook || content.replace(/[#*_>`-]/g, ' ').replace(/\s+/g, ' '), 160);
  const faq = Array.isArray(raw?.faq)
    ? raw.faq.slice(0, 6).map((item: any) => ({ question: str(item?.question, 200), answer: str(item?.answer, 800) })).filter((item: any) => item.question && item.answer)
    : [];
  const keywords = (Array.isArray(raw?.keywords) ? raw.keywords : []).slice(0, 10).map((item: any) => str(item, 80)).filter(Boolean);
  const slug = `${slugify(raw?.suggestedSlug || title).slice(0, 60)}-${dateStr.replace(/-/g, '')}`;
  return {
    title,
    slug,
    summary,
    hook: str(raw?.hook, 400),
    content,
    cta: str(raw?.cta, 400),
    faq,
    primaryKeyword: str(raw?.primaryKeyword, 80) || keywords[0] || '',
    keywords,
    angle: angle.id,
    angleLabel: angle.label
  };
}

export async function createDailyPostForCompany(company: any, dateStr = todayInSaoPaulo()): Promise<{ created: boolean; post?: any; reason?: string }> {
  const db = firestore();
  const id = `${company.id}_${dateStr}`;
  const ref = db.collection(COLLECTIONS.vitrinePosts).doc(id);
  const existing = await ref.get();
  if (existing.exists) return { created: false, reason: 'already_exists' };

  const { prompt, angle } = buildDailyPostPrompt(company, dateStr);
  const generated = await generateRaw({
    prompt,
    systemInstruction: companyContext(company),
    jsonOutput: true,
    maxTokens: 4000
  });
  const normalized = normalizeDailyPost(parseAiJson<any>(generated.text), company, dateStr, angle);
  if (!normalized.content || normalized.content.length < 40) {
    // Fallback seguro quando a IA não devolve o formato esperado.
    normalized.content = `## ${normalized.title}\n\n${company.description || `Conheça ${company.name}.`}\n\n## Fale com ${company.name}\n\nVisite a página da empresa na Vitrine Froc.IA para ver todos os canais de contato.`;
  }
  const now = nowIso();
  const post = {
    id,
    companyId: company.id,
    userId: company.userId || null,
    companySlug: company.slug,
    companyName: company.name,
    date: dateStr,
    ...normalized,
    imageUrl: company.coverUrl || company.logoUrl || null,
    location: locationLine(company) || null,
    status: 'published',
    modelUsed: generated.modelUsed,
    publishedAt: now,
    createdAt: now,
    updatedAt: now
  };
  try {
    await ref.create(post);
  } catch {
    return { created: false, reason: 'race_lost' };
  }
  return { created: true, post };
}

export function vitrinePostUrl(post: { companySlug: string; slug: string }): string {
  return `${baseUrl()}/vitrine/${encodeURIComponent(post.companySlug)}/${encodeURIComponent(post.slug)}`;
}

/** Executado pelo agendador: gera os posts do dia em lotes pequenos (seguro para serverless). */
export async function processVitrineDailyPosts(options: { force?: boolean; limit?: number } = {}): Promise<{ created: number; pending: number; errors: number }> {
  if (!config.vitrineDaily.enabled && !options.force) return { created: 0, pending: 0, errors: 0 };
  const db = firestore();
  const dateStr = todayInSaoPaulo();
  const companies = queryData<any>(await db.collection(COLLECTIONS.companies).get())
    .filter((company) => (company.isPublicInVitrine === true || company.isPublicInVitrine === 'true') && company.slug);

  const todaySnap = await db.collection(COLLECTIONS.vitrinePosts).where('date', '==', dateStr).get();
  const done = new Set(queryData<any>(todaySnap).map((post) => post.companyId));
  const pending = companies.filter((company) => !done.has(company.id));
  const batch = pending.slice(0, options.limit ?? config.vitrineDaily.perTick);

  let created = 0;
  let errors = 0;
  const urls: string[] = [];
  for (const company of batch) {
    try {
      const result = await createDailyPostForCompany(company, dateStr);
      if (result.created && result.post) {
        created += 1;
        urls.push(vitrinePostUrl(result.post), `${baseUrl()}/vitrine/${encodeURIComponent(company.slug)}`);
      }
    } catch (error) {
      errors += 1;
      console.warn('[Froc Vitrine Diária] Falha ao gerar post:', company.id, error instanceof Error ? error.message : error);
    }
  }
  if (urls.length) {
    urls.push(`${baseUrl()}/vitrine`);
    await pingIndexNow(urls, 'vitrine_daily_post');
  }
  return { created, pending: Math.max(pending.length - created, 0), errors };
}

export function sanitizePublicVitrinePost(post: any) {
  return {
    id: post.id,
    companyId: post.companyId,
    companySlug: post.companySlug,
    companyName: post.companyName,
    date: post.date,
    title: post.title,
    slug: post.slug,
    summary: post.summary,
    hook: post.hook || '',
    content: post.content,
    cta: post.cta || '',
    faq: Array.isArray(post.faq) ? post.faq : [],
    keywords: Array.isArray(post.keywords) ? post.keywords : [],
    angleLabel: post.angleLabel || '',
    imageUrl: post.imageUrl || null,
    location: post.location || null,
    publishedAt: post.publishedAt
  };
}
