import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config/index.js';
import { getAdminStorage } from '../providers/firebaseAdmin.js';
import { COLLECTIONS, firestore, newId, nowIso } from './store.js';
import { commitReservation, reserveCredits, rollbackReservation } from './credits.js';

let client: GoogleGenAI | null = null;

function aiClient(): GoogleGenAI {
  if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY não configurada no servidor.');
  if (!client) {
    client = new GoogleGenAI({
      apiKey: config.geminiApiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });
  }
  return client;
}

function sanitizeJsonText(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  const firstObject = trimmed.indexOf('{');
  const lastObject = trimmed.lastIndexOf('}');
  if (firstObject >= 0 && lastObject > firstObject) return trimmed.slice(firstObject, lastObject + 1);
  const firstArray = trimmed.indexOf('[');
  const lastArray = trimmed.lastIndexOf(']');
  if (firstArray >= 0 && lastArray > firstArray) return trimmed.slice(firstArray, lastArray + 1);
  return trimmed;
}

export function parseAiJson<T = any>(value: string): T {
  try {
    return JSON.parse(sanitizeJsonText(value)) as T;
  } catch {
    throw new Error('A IA retornou conteúdo fora do formato estruturado esperado. Tente novamente.');
  }
}

function promptFingerprint(prompt: string): string {
  return crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 24);
}

export function companyContext(company?: any): string {
  if (!company) {
    return 'Você é o Froc.IA, especialista sênior em marketing digital, vendas, conteúdo e SEO. Responda em português do Brasil, com clareza, ética, precisão e foco em resultado.';
  }
  const profile = company.marketingProfile || {};
  const isOnline = company.businessType === 'online';
  const isPhysical = company.businessType === 'physical';
  const isHybrid = company.businessType === 'hybrid';

  const typeDescription = isOnline
    ? 'EMPRESA 100% ONLINE / DIGITAL (Atendimento remoto, e-commerce, infoprodutos, serviços digitais, SaaS ou vendas pela internet. Todo o foco de conversão deve ser direcionado para canais digitais: website, checkout, landing page, link na bio, WhatsApp ou redes sociais. NÃO sugira visitas a estabelecimentos físicos ou pontos presenciais).'
    : isPhysical
    ? 'EMPRESA COM PONTO FÍSICO / LOCAL (Atendimento presencial, loja, consultório, restaurante ou escritório. Enfatize presença local, localização, facilidade de acesso, atendimento presencial e raio geográfico).'
    : 'EMPRESA HÍBRIDA (Combina ponto de atendimento presencial com forte atuação e vendas online. Equilibre a conveniência digital com a experiência presencial).';

  const channels = (company.onlineChannels || []).filter(Boolean).join(', ');

  return `Você é o Froc.IA, estrategista de marketing da marca ${company.name}.
Modelo de Operação: ${typeDescription}
${channels ? `Canais Digitais & Plataformas: ${channels}` : ''}
Segmento: ${company.category || company.segment || 'não informado'}.
Descrição: ${company.description || 'não informada'}.
Produtos: ${(company.products || []).join(', ') || 'não informados'}.
Serviços: ${(company.services || []).join(', ') || 'não informados'}.
Região de Atendimento: ${company.coverageRegion || (isOnline ? 'Nacional / Todo o Brasil (Online)' : 'Local')}.
${!isOnline && (company.city || company.address) ? `Localização Física: ${[company.address, company.city, company.state, company.country].filter(Boolean).join(', ')}` : ''}
Público: ${company.targetAudience || profile.targetAudience || 'não informado'}.
Persona: ${profile.persona || 'não informada'}.
Tom de voz: ${company.brandTone || profile.toneOfVoice || 'profissional e persuasivo'}.
Diferenciais: ${company.differentials || profile.keyDifferentials || 'não informados'}.
Objetivos: ${company.goals || profile.goals || 'atrair clientes e gerar autoridade'}.
Palavras-chave: ${(company.keywords || profile.topKeywords || []).join(', ')}.
CTAs preferidos: ${(profile.preferredCtas || []).join(' | ')}.
Evite: ${(profile.forbiddenWords || []).join(', ')}.
Nunca invente fatos, avaliações, clientes, resultados, certificações ou números que não estejam no briefing.`;
}

async function generateRaw(data: {
  prompt: string;
  systemInstruction?: string;
  useProModel?: boolean;
  jsonOutput?: boolean;
  maxTokens?: number;
}): Promise<{ text: string; modelUsed: string; attempts: string[] }> {
  // Cascata multi-modelo ultra-resiliente Froc AI (Gemini 3.7 / 3.1 Pro / 3.1 Flash-Lite / Flash-Latest)
  const prioritized = data.useProModel
    ? [config.geminiModels.pro, 'gemini-3.1-pro-preview', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite', 'gemini-2.5-pro', 'gemini-2.5-flash']
    : [config.geminiModels.text, 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview', 'gemini-2.5-flash', 'gemini-2.5-pro'];

  const models = Array.from(new Set(prioritized.filter(Boolean)));
  const attempts: string[] = [];
  let lastError = 'Falha desconhecida';

  for (const model of models) {
    attempts.push(model);
    try {
      const response = await aiClient().models.generateContent({
        model,
        contents: data.prompt,
        config: {
          systemInstruction: data.systemInstruction,
          maxOutputTokens: data.maxTokens || 3500,
          responseMimeType: data.jsonOutput ? 'application/json' : 'text/plain'
        }
      });
      const text = response.text?.trim();
      if (text) return { text, modelUsed: model, attempts };
      lastError = 'Resposta vazia retornada pelo modelo';
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.warn(`[Froc AI Anti-Quedas] Tentativa em ${model} falhou: ${lastError}. Acionando próximo modelo da cascata...`);
    }
  }

  throw new Error(`Todos os modelos de IA falharam na cascata de resiliência. Último erro: ${lastError}`);
}

export async function executeAi<T = string>(data: {
  userId: string;
  company?: any;
  operation: keyof typeof config.creditCosts;
  prompt: string;
  systemInstruction?: string;
  useProModel?: boolean;
  jsonOutput?: boolean;
  maxTokens?: number;
  parse?: (text: string) => T;
}): Promise<{ result: T; creditsUsed: number; executionId: string; modelUsed: string }> {
  const cost = Number(config.creditCosts[data.operation]);
  const reservation = await reserveCredits({
    userId: data.userId,
    amount: cost,
    operation: data.operation,
    companyId: data.company?.id
  });
  const executionId = newId('exec');
  const started = Date.now();

  try {
    const generated = await generateRaw({
      prompt: data.prompt,
      systemInstruction: data.systemInstruction || companyContext(data.company),
      useProModel: data.useProModel,
      jsonOutput: data.jsonOutput,
      maxTokens: data.maxTokens
    });
    const result = data.parse ? data.parse(generated.text) : (generated.text as T);
    await commitReservation({
      userId: data.userId,
      reservationId: reservation.reservationId,
      source: `Froc AI: ${data.operation}`,
      metadata: { executionId, modelUsed: generated.modelUsed }
    });
    await firestore().collection(COLLECTIONS.aiExecutions).doc(executionId).set({
      userId: data.userId,
      companyId: data.company?.id || null,
      type: data.operation,
      provider: 'Google Gemini',
      model: generated.modelUsed,
      attempts: generated.attempts,
      promptHash: promptFingerprint(data.prompt),
      promptLength: data.prompt.length,
      creditsConsumed: cost,
      durationMs: Date.now() - started,
      status: 'success',
      timestamp: nowIso()
    });
    return { result, creditsUsed: cost, executionId, modelUsed: generated.modelUsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await rollbackReservation(data.userId, reservation.reservationId, message);
    await firestore().collection(COLLECTIONS.aiExecutions).doc(executionId).set({
      userId: data.userId,
      companyId: data.company?.id || null,
      type: data.operation,
      provider: 'Google Gemini',
      promptHash: promptFingerprint(data.prompt),
      promptLength: data.prompt.length,
      creditsConsumed: 0,
      durationMs: Date.now() - started,
      status: 'failed',
      error: message.slice(0, 500),
      timestamp: nowIso()
    });
    throw error;
  }
}

export async function generatePost(data: { userId: string; company?: any; topic: string; platform?: string; goal?: string; tone?: string }) {
  const prompt = `Crie um post completo e verdadeiro para ${data.platform || 'Instagram'} sobre "${data.topic}".
Objetivo: ${data.goal || 'engajamento e vendas'}.
Tom: ${data.tone || 'persuasivo e profissional'}.
Responda SOMENTE JSON: {"headline":"","body":"","cta":"","hashtags":[""],"visualPrompt":"","keywords":[""]}.`;
  return executeAi<any>({
    userId: data.userId,
    company: data.company,
    operation: 'full_post',
    prompt,
    jsonOutput: true,
    parse: parseAiJson
  });
}

export async function generateStrategy(data: { userId: string; company: any; timeframe: 'semana' | 'mes'; goal?: string }) {
  const prompt = `Crie uma estratégia de marketing executável para ${data.timeframe === 'mes' ? '30 dias' : '7 dias'}.
Objetivo: ${data.goal || 'crescer autoridade, alcance e vendas'}.
Responda SOMENTE JSON com: {"strategySummary":"","contentPillars":[""],"actionPlan":[{"dayOrWeek":"","platform":"","format":"","topic":"","hook":""}],"positioning":"","audienceInsights":[""],"campaignIdeas":[{"name":"","concept":"","channels":[""]}],"kpis":[""],"nextSteps":[""]}.`;
  return executeAi<any>({ userId: data.userId, company: data.company, operation: 'strategy', prompt, useProModel: true, jsonOutput: true, maxTokens: 5000, parse: parseAiJson });
}

export async function generateCopy(data: { userId: string; company?: any; type: 'cta' | 'headline' | 'caption' | 'variations'; prompt: string }) {
  const op = data.type === 'variations' ? 'variations' : data.type;
  return executeAi<string>({
    userId: data.userId,
    company: data.company,
    operation: op,
    prompt: `Crie ${data.type} de alta conversão para o briefing: ${data.prompt}. Seja específico, verdadeiro e alinhado à marca.`,
    maxTokens: 1200
  });
}

export async function generateCarousel(data: { userId: string; company?: any; topic: string; slidesCount?: number; goal?: string }) {
  const count = Math.min(Math.max(Number(data.slidesCount) || 5, 3), 10);
  const prompt = `Crie um carrossel de ${count} slides sobre "${data.topic}". Objetivo: ${data.goal || 'educar e converter'}.
Responda SOMENTE JSON: {"carouselTitle":"","slides":[{"slideNumber":1,"title":"","text":"","visualDesc":""}],"caption":"","hashtags":[""]}.`;
  return executeAi<any>({ userId: data.userId, company: data.company, operation: 'carousel', prompt, jsonOutput: true, parse: parseAiJson });
}

export async function generateVideoScript(data: { userId: string; company?: any; topic: string; durationSeconds?: number; format?: string }) {
  const prompt = `Crie roteiro de vídeo vertical de aproximadamente ${data.durationSeconds || 60}s sobre "${data.topic}" para ${data.format || 'Reels/TikTok/Shorts'}.
Responda SOMENTE JSON: {"hook":"","scenes":[{"sceneNumber":1,"timeSeconds":"0-3s","visualDescription":"","audioVoiceover":"","onScreenText":""}],"callToAction":"","suggestedAudioTrack":"","caption":""}.`;
  return executeAi<any>({ userId: data.userId, company: data.company, operation: 'video_script', prompt, useProModel: true, jsonOutput: true, parse: parseAiJson });
}

export async function generateImagePrompt(data: { userId: string; company?: any; theme: string; style?: string }) {
  const prompt = `Crie uma direção visual publicitária profissional para "${data.theme}". Estilo: ${data.style || 'fotografia comercial premium'}.
Não alegue que uma imagem foi gerada: gere apenas especificação visual.
Responda SOMENTE JSON: {"promptPt":"","promptEn":"","artStyle":"","composition":"","colorPalette":["#000000"],"lightingNote":"","aspectRatio":"1:1"}.`;
  return executeAi<any>({ userId: data.userId, company: data.company, operation: 'image_prompt', prompt, jsonOutput: true, parse: parseAiJson });
}

export async function generateArticle(data: { userId: string; company?: any; topic: string; primaryKeyword?: string; targetAudience?: string; tone?: string }) {
  const prompt = `Escreva um artigo original, útil e otimizado para SEO sobre "${data.topic}".
Palavra-chave principal: ${data.primaryKeyword || data.topic}.
Público: ${data.targetAudience || 'clientes potenciais'}.
Tom: ${data.tone || 'educativo e autoritativo'}.
Não invente estatísticas ou fontes.
Responda SOMENTE JSON: {"title":"","metaDescription":"","introduction":"","sections":[{"h2":"","content":"","h3s":[{"h3":"","content":""}]}],"faqSection":[{"question":"","answer":""}],"conclusion":"","callToAction":"","suggestedSlug":""}.`;
  return executeAi<any>({ userId: data.userId, company: data.company, operation: 'seo_article', prompt, useProModel: true, jsonOutput: true, maxTokens: 7000, parse: parseAiJson });
}

export async function generatePlatformArticle(topic: string): Promise<{ article: any; modelUsed: string }> {
  const prompt = `Escreva um artigo editorial original para o Froc Magazine sobre "${topic}".
Público: empreendedores, profissionais de marketing e pequenas/médias empresas no Brasil.
O conteúdo deve ser útil por si só, sem depender de notícias ou estatísticas não fornecidas. Não invente fontes, números, pesquisas, depoimentos ou resultados. Evite promessas absolutas.
Estruture para SEO e leitura mobile.
Responda SOMENTE JSON: {"title":"","summary":"","metaDescription":"","content":"Markdown completo com H2/H3","category":"Marketing & IA","tags":["Marketing","IA"],"suggestedSlug":""}.`;
  const generated = await generateRaw({
    prompt,
    systemInstruction: 'Você é a redação editorial do Froc Magazine. Escreva em português do Brasil, com rigor, clareza e sem fabricar fatos.',
    useProModel: true,
    jsonOutput: true,
    maxTokens: 7000
  });
  const article = parseAiJson<any>(generated.text);
  const executionId = newId('exec');
  await firestore().collection(COLLECTIONS.aiExecutions).doc(executionId).set({
    userId: 'system', type: 'blog_editorial', provider: 'Google Gemini', model: generated.modelUsed, attempts: generated.attempts,
    promptHash: promptFingerprint(prompt), promptLength: prompt.length, creditsConsumed: 0, status: 'success', timestamp: nowIso()
  });
  return { article, modelUsed: generated.modelUsed };
}


function normalizeAspectRatio(value?: string): string {
  const allowed = new Set(['1:1','2:3','3:2','3:4','4:3','4:5','5:4','9:16','16:9','21:9']);
  return value && allowed.has(value) ? value : '1:1';
}

function extractGeneratedImage(response: any): { data: string; mimeType: string } | null {
  const parts = response?.candidates?.[0]?.content?.parts || response?.parts || [];
  for (const part of parts) {
    if (part?.inlineData?.data) {
      return { data: String(part.inlineData.data), mimeType: String(part.inlineData.mimeType || 'image/jpeg') };
    }
    if (part?.inline_data?.data) {
      return { data: String(part.inline_data.data), mimeType: String(part.inline_data.mime_type || 'image/jpeg') };
    }
  }
  return null;
}

export async function generateMarketingImage(data: {
  userId: string;
  company?: any;
  theme: string;
  style?: string;
  aspectRatio?: string;
}): Promise<{ imageUrl: string; storagePath: string; mimeType: string; creditsUsed: number; executionId: string; modelUsed: string }> {
  const cost = Number(config.creditCosts.image_ai);
  const reservation = await reserveCredits({ userId: data.userId, amount: cost, operation: 'image_ai', companyId: data.company?.id });
  const executionId = newId('exec');
  const started = Date.now();
  const aspectRatio = normalizeAspectRatio(data.aspectRatio);
  const prompt = `${companyContext(data.company)}\n\nCrie uma imagem publicitária premium e original para: ${data.theme}.\nEstilo visual: ${data.style || 'fotografia comercial moderna e sofisticada'}.\nProporção: ${aspectRatio}.\nNão inclua logotipos ou marcas de terceiros. Não invente selos, depoimentos ou números. Se houver texto na arte, mantenha-o curto, legível e somente se fizer sentido para o briefing.`;

  try {
    const response = await (aiClient() as any).models.generateContent({
      model: config.geminiModels.image,
      contents: prompt,
      config: {
        responseModalities: ['IMAGE'],
        responseFormat: { image: { aspectRatio, imageSize: '1K' } }
      }
    });
    const image = extractGeneratedImage(response);
    if (!image?.data) throw new Error('O modelo de imagem não retornou um arquivo utilizável.');
    const buffer = Buffer.from(image.data, 'base64');
    if (!buffer.length || buffer.length > 12 * 1024 * 1024) throw new Error('A imagem retornada possui tamanho inválido.');

    const ext = image.mimeType.includes('png') ? 'png' : image.mimeType.includes('webp') ? 'webp' : 'jpg';
    const storagePath = `generated/${data.userId}/${executionId}.${ext}`;
    let imageUrl = `data:${image.mimeType};base64,${image.data}`;

    try {
      const token = crypto.randomUUID();
      const bucket = getAdminStorage().bucket();
      const file = bucket.file(storagePath);
      await file.save(buffer, {
        resumable: false,
        metadata: {
          contentType: image.mimeType,
          cacheControl: 'public,max-age=31536000,immutable',
          metadata: { firebaseStorageDownloadTokens: token }
        }
      });
      imageUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(storagePath)}?alt=media&token=${encodeURIComponent(token)}`;
    } catch (storageErr) {
      console.warn('[Froc AI Storage Fallback] Firebase Storage indisponível, utilizando Data URI seguro:', storageErr);
    }

    await commitReservation({
      userId: data.userId,
      reservationId: reservation.reservationId,
      source: 'Froc AI: image_ai',
      metadata: { executionId, modelUsed: config.geminiModels.image, storagePath }
    });
    await firestore().collection(COLLECTIONS.aiExecutions).doc(executionId).set({
      userId: data.userId,
      companyId: data.company?.id || null,
      type: 'image_ai',
      provider: 'Google Gemini',
      model: config.geminiModels.image,
      promptHash: promptFingerprint(prompt),
      promptLength: prompt.length,
      creditsConsumed: cost,
      durationMs: Date.now() - started,
      status: 'success',
      outputStoragePath: storagePath,
      timestamp: nowIso()
    });
    return { imageUrl, storagePath, mimeType: image.mimeType, creditsUsed: cost, executionId, modelUsed: config.geminiModels.image };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await rollbackReservation(data.userId, reservation.reservationId, message);
    await firestore().collection(COLLECTIONS.aiExecutions).doc(executionId).set({
      userId: data.userId,
      companyId: data.company?.id || null,
      type: 'image_ai',
      provider: 'Google Gemini',
      model: config.geminiModels.image,
      promptHash: promptFingerprint(prompt),
      promptLength: prompt.length,
      creditsConsumed: 0,
      durationMs: Date.now() - started,
      status: 'failed',
      error: message.slice(0, 500),
      timestamp: nowIso()
    });
    throw error;
  }
}
