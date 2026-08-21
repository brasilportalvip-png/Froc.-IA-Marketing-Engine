import crypto from 'crypto';
import { GoogleGenAI, GenerateVideosOperation } from '@google/genai';
import { config } from '../config/index.js';
import { getAdminStorage } from '../providers/firebaseAdmin.js';
import { COLLECTIONS, createNotification, firestore, newId, nowIso, queryData } from './store.js';
import { commitReservation, reserveCredits, rollbackReservation } from './credits.js';

let textClient: GoogleGenAI | null = null;
let mediaClient: GoogleGenAI | null = null;

export function textAiClient(): GoogleGenAI {
  if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY não configurada no servidor.');
  if (!textClient) {
    textClient = new GoogleGenAI({
      apiKey: config.geminiApiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });
  }
  return textClient;
}

export function mediaAiClient(): GoogleGenAI {
  const mediaKey = config.geminiMediaApiKey || config.geminiApiKey;
  if (!mediaKey) throw new Error('GEMINI_MEDIA_API_KEY ou GEMINI_API_KEY não configurada no servidor.');
  if (!mediaClient) {
    mediaClient = new GoogleGenAI({
      apiKey: mediaKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });
  }
  return mediaClient;
}

function aiClient(): GoogleGenAI {
  return textAiClient();
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

function formatAiErrorMessage(error: any): string {
  const msg = String(error?.message || error || '');
  if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('Quota exceeded')) {
    return 'Limite temporário de requisições de IA atingido na API do Google Gemini. Aguarde alguns segundos e tente novamente.';
  }
  if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid')) {
    return 'Chave de API do Google Gemini inválida ou sem permissões suficientes no servidor.';
  }
  if (msg.includes('SAFETY') || msg.includes('HARM_CATEGORY')) {
    return 'O conteúdo solicitado foi bloqueado pelas diretrizes de segurança da IA. Modifique o briefing e tente novamente.';
  }
  return msg;
}

export function parseAiJson<T = any>(value: string): T {
  try {
    return JSON.parse(sanitizeJsonText(value)) as T;
  } catch {
    throw new Error('A IA retornou conteúdo fora do formato estruturado esperado. Tente novamente.');
  }
}

export function safeJsonParse<T = any>(value: string, fallback: T): T {
  try {
    return JSON.parse(sanitizeJsonText(value)) as T;
  } catch {
    return fallback;
  }
}

function promptFingerprint(prompt: string): string {
  return crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 24);
}

export function cleanHeadingText(text: string): string {
  if (!text) return '';
  return String(text)
    .replace(/^#+\s*/, '')
    .replace(/^[Hh][1-6][:\s-]+/i, '')
    .replace(/^#+\s*/, '')
    .trim();
}

export function normalizeArticleHeadings(article: any): any {
  if (!article || typeof article !== 'object') return article;
  const cleaned = { ...article };
  if (cleaned.title) cleaned.title = cleanHeadingText(cleaned.title);
  if (Array.isArray(cleaned.sections)) {
    cleaned.sections = cleaned.sections.map((sec: any) => ({
      ...sec,
      h2: cleanHeadingText(sec.h2),
      h3s: Array.isArray(sec.h3s)
        ? sec.h3s.map((sub: any) => ({
            ...sub,
            h3: cleanHeadingText(sub.h3)
          }))
        : []
    }));
  }
  return cleaned;
}

export function countArticleWords(article: any): number {
  if (!article || typeof article !== 'object') return 0;
  const parts: string[] = [
    article.title || '',
    article.introduction || '',
    article.conclusion || '',
    article.callToAction || ''
  ];
  if (Array.isArray(article.sections)) {
    for (const sec of article.sections) {
      parts.push(sec.h2 || '', sec.content || '');
      if (Array.isArray(sec.h3s)) {
        for (const sub of sec.h3s) {
          parts.push(sub.h3 || '', sub.content || '');
        }
      }
    }
  }
  if (Array.isArray(article.faqSection)) {
    for (const faq of article.faqSection) {
      parts.push(faq.question || '', faq.answer || '');
    }
  }
  const text = parts.join(' ').replace(/[^\p{L}\p{N}\s]+/gu, ' ').trim();
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

export function companyContext(company?: any): string {
  if (!company) {
    return `Você é o Froc.IA, especialista sênior em marketing digital, vendas, conteúdo e SEO. Responda em português do Brasil, com ética, rigor factual e precisão.
DIRETRIZ DE GROUNDING E PROIBIÇÕES:
- Não invente clientes, cases, avaliações, depoimentos, certificações ou dados de prova social.
- Não invente números, percentuais, estatísticas, faturamento, leads, economia ou métricas financeiras.
- Não invente promoções, descontos, bônus, teste grátis, cupons, prazos promocionais ("último dia") ou escassez falsa.
- Não faça promessas de resultados garantidos ou garantias absolutas.
- Como não há empresa cadastrada no contexto, utilize Chamadas para Ação (CTAs) neutras como "Conheça mais sobre este tema", "Entre em contato para saber mais" ou "Descubra como aplicar essa solução". Nunca invente links, canais ou URLs.`;
  }

  const profile = company.marketingProfile || {};

  // 1. Canais e Destinos Efetivamente Verificados
  const verifiedDestinations: Record<string, string> = {};
  if (company.website && typeof company.website === 'string' && company.website.trim()) {
    verifiedDestinations.website = company.website.trim();
  }
  if (company.whatsapp && typeof company.whatsapp === 'string' && company.whatsapp.trim()) {
    verifiedDestinations.whatsapp = company.whatsapp.trim();
  }
  if (company.phone && typeof company.phone === 'string' && company.phone.trim()) {
    verifiedDestinations.phone = company.phone.trim();
  }
  if (company.email && typeof company.email === 'string' && company.email.trim()) {
    verifiedDestinations.email = company.email.trim();
  }

  const verifiedSocialLinks: Record<string, string> = {};
  if (company.socialLinks && typeof company.socialLinks === 'object') {
    for (const [net, link] of Object.entries(company.socialLinks)) {
      if (typeof link === 'string' && link.trim()) {
        verifiedSocialLinks[net] = link.trim();
      }
    }
  }

  const hasAnyDestination = Object.keys(verifiedDestinations).length > 0 || Object.keys(verifiedSocialLinks).length > 0;

  // 2. Modelo de Operação
  const isOnline = company.businessType === 'online';
  const isPhysical = company.businessType === 'physical';
  const isHybrid = company.businessType === 'hybrid';

  const opModel = isOnline
    ? 'Operação 100% Online / Digital (atendimento e vendas à distância; sem ponto presencial físico cadastrado).'
    : isPhysical
    ? 'Operação com Ponto Físico / Presencial.'
    : isHybrid
    ? 'Operação Híbrida (atendimento físico e presença digital).'
    : 'Modelo não especificado.';

  // 3. Fatos Comprovados da Empresa
  const factualLines: string[] = [
    `Nome da Marca: ${company.name}`,
    `Modelo de Operação: ${opModel}`
  ];

  if (company.category || company.segment) {
    factualLines.push(`Segmento/Categoria: ${[company.category, company.segment].filter(Boolean).join(' • ')}`);
  }
  if (company.description) {
    factualLines.push(`Descrição Institucional: ${company.description}`);
  }
  if (Array.isArray(company.products) && company.products.length > 0) {
    factualLines.push(`Produtos Oficiais: ${company.products.join(', ')}`);
  }
  if (Array.isArray(company.services) && company.services.length > 0) {
    factualLines.push(`Serviços Oficiais: ${company.services.join(', ')}`);
  }
  if (company.differentials || profile.keyDifferentials) {
    factualLines.push(`Diferenciais Cadastrados: ${company.differentials || profile.keyDifferentials}`);
  }
  if (company.targetAudience || profile.targetAudience) {
    factualLines.push(`Público-Alvo: ${company.targetAudience || profile.targetAudience}`);
  }
  if (profile.persona) {
    factualLines.push(`Persona: ${profile.persona}`);
  }
  if (company.brandTone || profile.toneOfVoice) {
    factualLines.push(`Tom de Voz: ${company.brandTone || profile.toneOfVoice}`);
  }
  if (company.goals || profile.goals) {
    factualLines.push(`Objetivos Estratégicos: ${company.goals || profile.goals}`);
  }
  if (company.coverageRegion) {
    factualLines.push(`Região de Atendimento Declarada: ${company.coverageRegion}`);
  }
  if (!isOnline && (company.address || company.city || company.state)) {
    factualLines.push(`Localização Física: ${[company.address, company.city, company.state, company.country].filter(Boolean).join(', ')}`);
  }
  if (Array.isArray(company.onlineChannels) && company.onlineChannels.length > 0) {
    factualLines.push(`Canais Declarados: ${company.onlineChannels.join(', ')}`);
  }
  if (Array.isArray(company.keywords) && company.keywords.length > 0) {
    factualLines.push(`Palavras-chave: ${company.keywords.join(', ')}`);
  }

  // 4. Seção de Destinos para CTA
  const destinationLines: string[] = [];
  if (verifiedDestinations.website) destinationLines.push(`- Website Oficial: ${verifiedDestinations.website} (Permitido CTA para o site)`);
  if (verifiedDestinations.whatsapp) destinationLines.push(`- WhatsApp Oficial: ${verifiedDestinations.whatsapp} (Permitido CTA para WhatsApp)`);
  if (verifiedDestinations.phone) destinationLines.push(`- Telefone Oficial: ${verifiedDestinations.phone} (Permitido CTA para ligação)`);
  if (verifiedDestinations.email) destinationLines.push(`- E-mail Oficial: ${verifiedDestinations.email} (Permitido CTA para e-mail)`);
  for (const [net, link] of Object.entries(verifiedSocialLinks)) {
    destinationLines.push(`- Rede Social ${net}: ${link} (Permitido CTA para ${net})`);
  }

  const ctaInstruction = hasAnyDestination
    ? `DESTINOS DISPONÍVEIS PARA CTA (Use SOMENTE os canais listados abaixo):\n${destinationLines.join('\n')}\nSe for sugerir CTA, direcione EXCLUSIVAMENTE para os destinos reais acima. NUNCA invente checkout, landing page, links na bio ou canais não listados.`
    : `DESTINOS PARA CTA: NENHUM canal de contato ou link foi cadastrado para esta empresa. É OBRIGATÓRIO usar CTA neutro (Exemplos: "Conheça melhor a solução", "Descubra como essa solução pode ajudar seu negócio", "Entre em contato para saber mais"). É ESTRITAMENTE PROIBIDO inventar URLs, dizer "clique no link da bio", "chame no WhatsApp" ou criar canais fictícios.`;

  return `Você é o Froc.IA, estrategista de marketing da marca "${company.name}".
Responda em português do Brasil, com clareza, autoridade e precisão factual.

=== FATOS COMPROVADOS DA EMPRESA (Use SOMENTE estes dados como verdade) ===
${factualLines.join('\n')}

=== DIRETRIZES DE DESTINOS E CTA ===
${ctaInstruction}

=== REGRAS OBRIGATÓRIAS DE GROUNDING E PROIBIÇÕES DA IA ===
1. PROIBIÇÃO DE FATOS FICTÍCIOS: Nunca invente clientes, cases, avaliações, depoimentos ou prova social inexistente.
2. PROIBIÇÃO DE NÚMEROS E ESTATÍSTICAS INVENTADAS: Nunca invente números, percentuais, estatísticas, horas economizadas, faturamento, alcance, conversões, leads ou economia que não foram explicitamente informados.
3. PROIBIÇÃO DE CERTIFICAÇÕES: Não invente selos, certificações ou aprovações não cadastradas.
4. PROIBIÇÃO DE PROMOÇÕES INVENTADAS: Nunca invente descontos, bônus, teste grátis, cupons, prazos promocionais, "último dia" ou escassez falsa.
5. PROIBIÇÃO DE PROMESSAS ABSOLUTAS: Não faça promessas de resultado garantido ou garantias absolutas.
6. PROIBIÇÃO DE CANAIS FICTÍCIOS: Nunca mencione WhatsApp se não estiver cadastrado; nunca mencione website/checkout/landing page se não estiver cadastrado; nunca mencione "link na bio" ou redes sociais não cadastradas.
7. SUGESTÕES VS FATOS: Se for propor uma ideia ou canal não cadastrado, use EXPLICITAMENTE linguagem de recomendação ("Sugestão: ...", "Uma possibilidade seria...", "Você pode considerar..."). NUNCA afirme como fato estabelecido da empresa.`;
}

async function generateRaw(data: {
  prompt: string;
  systemInstruction?: string;
  useProModel?: boolean;
  jsonOutput?: boolean;
  maxTokens?: number;
}): Promise<{ text: string; modelUsed: string; attempts: string[] }> {
  if (process.env.NODE_ENV === 'test') {
    const text = data.jsonOutput
      ? JSON.stringify({
          headline: 'Headline de Teste Autopilot',
          body: 'Corpo do post gerado pelo Autopilot para testes.',
          cta: 'Saiba mais e confira nossa coleção.',
          hashtags: ['#teste', '#autopilot'],
          keywords: ['marketing', 'vendas'],
          visualPrompt: 'Foto profissional de moda feminina em alta definição',
          cameraMotion: 'Dynamic cinematic tracking pan',
          lighting: 'Golden hour dramatic contrast',
          mood: 'Inspiring and sophisticated'
        })
      : 'Texto de teste gerado pelo modelo Froc AI.';
    return { text, modelUsed: 'test-model', attempts: ['test-model'] };
  }

  // Cascata multi-modelo oficial Froc AI (Gemini 2.5 Flash / 3.1 Pro / 3.1 Flash-Lite / 2.5 Pro)
  const prioritized = data.useProModel
    ? [config.geminiModels.pro, 'gemini-3.1-pro-preview', 'gemini-2.5-pro', 'gemini-3.1-flash-lite', 'gemini-2.5-flash']
    : [config.geminiModels.text, 'gemini-2.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview', 'gemini-2.5-pro'];

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
    const message = formatAiErrorMessage(error instanceof Error ? error.message : String(error));
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
    throw new Error(message);
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

export async function generateAutopilotPost(data: { userId: string; company?: any; topic: string; platform?: string; goal?: string; tone?: string }) {
  const prompt = `Crie um post completo e verdadeiro para ${data.platform || 'Instagram'} sobre "${data.topic}".
Objetivo: ${data.goal || 'engajamento e vendas'}.
Tom: ${data.tone || 'persuasivo e profissional'}.
Responda SOMENTE JSON: {"headline":"","body":"","cta":"","hashtags":[""],"visualPrompt":"","keywords":[""]}.`;
  return executeAi<any>({
    userId: data.userId,
    company: data.company,
    operation: 'autopilot_cycle',
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
  const prompt = `Escreva um artigo de autoridade aprofundado, original, educativo e altamente otimizado para SEO sobre "${data.topic}".
Palavra-chave principal: ${data.primaryKeyword || data.topic}.
Público-alvo: ${data.targetAudience || 'clientes potenciais e profissionais'}.
Tom de voz: ${data.tone || 'educativo, claro e autoritativo'}.

DIRETRIZES DE CONTEÚDO E ESTRUTURA:
1. O artigo deve ser profundo, prático e detalhado (desenvolva cada seção com explicações ricas, exemplos aplicáveis e orientações acionáveis).
2. Estruture em 3 a 6 seções H2 lógicas e relevantes, incluindo subtópicos H3 onde apropriado.
3. Não use marcações como "##", "H2:" ou "H3:" dentro dos campos de títulos do JSON; retorne apenas o texto puro do título.
4. Inclua uma seção de FAQ com 3 a 5 perguntas reais e respostas diretas e fundamentadas.
5. Conclusão persuasiva com Chamada para Ação contextualizada aos canais da empresa.
6. REGRAS ANTI-ALUCINAÇÃO: Não invente pesquisas falsas, percentuais inventados, testemunhos fictícios, citações de pessoas inexistentes ou promessas de ganhos financeiros milagrosos. Se usar dados, atenha-se a conceitos e práticas comprovadas de mercado.

Responda SOMENTE JSON válido no seguinte formato:
{
  "title": "Título H1 cativante com a palavra-chave",
  "metaDescription": "Meta descrição de 140 a 160 caracteres com gatilho e palavra-chave",
  "introduction": "Introdução engajadora apresentando a dor, a importância do tema e o que será aprendido no artigo.",
  "sections": [
    {
      "h2": "Título da Seção Principal",
      "content": "Conteúdo aprofundado e rico da seção...",
      "h3s": [
        {
          "h3": "Subtópico Prático",
          "content": "Detalhamento prático..."
        }
      ]
    }
  ],
  "faqSection": [
    {
      "question": "Pergunta comum do público sobre o tema?",
      "answer": "Resposta direta, clara e fundamentada."
    }
  ],
  "conclusion": "Síntese dos pontos-chave com visão de futuro.",
  "callToAction": "Chamada para ação clara convidando o leitor a dar o próximo passo.",
  "suggestedSlug": "slug-otimizado-para-seo"
}`;
  const response = await executeAi<any>({
    userId: data.userId,
    company: data.company,
    operation: 'seo_article',
    prompt,
    useProModel: true,
    jsonOutput: true,
    maxTokens: 7000,
    parse: (text) => {
      const parsed = parseAiJson<any>(text);
      return normalizeArticleHeadings(parsed);
    }
  });

  if (response.result && typeof response.result === 'object') {
    response.result = normalizeArticleHeadings(response.result);
    response.result.wordCount = countArticleWords(response.result);
  }

  return response;
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
  // Check standard Imagen response
  if (response?.generatedImages?.[0]?.image?.imageBytes) {
    return {
      data: String(response.generatedImages[0].image.imageBytes),
      mimeType: 'image/jpeg'
    };
  }
  // Check Gemini generateContent response
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
  resolution?: '1K' | '2K' | '4K';
}): Promise<{ imageUrl: string; storagePath: string; mimeType: string; creditsUsed: number; executionId: string; modelUsed: string; resolution: string }> {
  const resolution = data.resolution === '4K' ? '4K' : data.resolution === '2K' ? '2K' : '1K';
  const opKey = resolution === '4K' ? 'image_ai_4k' : resolution === '2K' ? 'image_ai_2k' : 'image_ai_1k';
  const cost = Number(config.creditCosts[opKey] || config.creditCosts.image_ai || 15);
  
  const reservation = await reserveCredits({ userId: data.userId, amount: cost, operation: opKey, companyId: data.company?.id });
  const executionId = newId('exec');
  const started = Date.now();
  const aspectRatio = normalizeAspectRatio(data.aspectRatio);
  const prompt = `${companyContext(data.company)}\n\nCrie uma imagem publicitária premium e original para: ${data.theme}.\nEstilo visual: ${data.style || 'fotografia comercial moderna e sofisticada'}.\nProporção: ${aspectRatio}.\nResolução desejada: ${resolution}.\nNão inclua logotipos ou marcas de terceiros. Não invente selos, depoimentos ou números. Se houver texto na arte, mantenha-o curto, legível e somente se fizer sentido para o briefing.`;

  const model = config.geminiModels.image || 'gemini-3.1-flash-image';

  try {
    let imageUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    let storagePath = `generated/${data.userId}/${executionId}.jpg`;
    let mimeType = 'image/jpeg';

    if (process.env.NODE_ENV !== 'test') {
      let response: any;
      if (model.startsWith('imagen-')) {
        response = await (mediaAiClient() as any).models.generateImages({
          model,
          prompt,
          config: {
            numberOfImages: 1,
            outputMimeType: 'image/jpeg',
            aspectRatio: aspectRatio as any
          }
        });
      } else {
        // Configuração oficial do SDK @google/genai para gemini-3.1-flash-image / gemini-3.1-flash-lite-image
        response = await mediaAiClient().models.generateContent({
          model,
          contents: prompt,
          config: {
            imageConfig: {
              aspectRatio,
              imageSize: resolution
            }
          }
        });
      }

      const image = extractGeneratedImage(response);
      if (!image?.data) throw new Error('O modelo de imagem não retornou um arquivo utilizável.');
      const buffer = Buffer.from(image.data, 'base64');
      if (!buffer.length || buffer.length > 12 * 1024 * 1024) throw new Error('A imagem retornada possui tamanho inválido.');

      const ext = image.mimeType.includes('png') ? 'png' : image.mimeType.includes('webp') ? 'webp' : 'jpg';
      storagePath = `generated/${data.userId}/${executionId}.${ext}`;
      imageUrl = `data:${image.mimeType};base64,${image.data}`;
      mimeType = image.mimeType;

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
    }

    await commitReservation({
      userId: data.userId,
      reservationId: reservation.reservationId,
      source: `Froc AI: ${opKey}`,
      metadata: { executionId, modelUsed: model, storagePath, resolution }
    });
    await firestore().collection(COLLECTIONS.aiExecutions).doc(executionId).set({
      userId: data.userId,
      companyId: data.company?.id || null,
      type: opKey,
      provider: 'Google Gemini',
      model,
      promptHash: promptFingerprint(prompt),
      promptLength: prompt.length,
      creditsConsumed: cost,
      durationMs: Date.now() - started,
      status: 'success',
      outputStoragePath: storagePath,
      timestamp: nowIso()
    });
    return { imageUrl, storagePath, mimeType, creditsUsed: cost, executionId, modelUsed: model, resolution };
  } catch (error) {
    const message = formatAiErrorMessage(error instanceof Error ? error.message : String(error));
    await rollbackReservation(data.userId, reservation.reservationId, message);
    await firestore().collection(COLLECTIONS.aiExecutions).doc(executionId).set({
      userId: data.userId,
      companyId: data.company?.id || null,
      type: opKey,
      provider: 'Google Gemini',
      model,
      promptHash: promptFingerprint(prompt),
      promptLength: prompt.length,
      creditsConsumed: 0,
      durationMs: Date.now() - started,
      status: 'failed',
      error: message.slice(0, 500),
      timestamp: nowIso()
    });
    throw new Error(message);
  }
}

export type VideoPreset = 'demo_720p' | 'pro_1080p' | 'cinema_4k';

export interface VideoJobData {
  id: string;
  userId: string;
  companyId: string;
  operationName?: string;
  reservationId: string;
  creditsReserved: number;
  prompt: string;
  title?: string;
  preset: VideoPreset;
  resolution: '720p' | '1080p' | '4k';
  aspectRatio: '9:16' | '16:9';
  modelUsed: string;
  initialImageUrl?: string;
  videoUrl?: string;
  storagePath?: string;
  contentItemId?: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  errorMessage?: string;
  progressPct?: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export async function generateVideoDirection(data: {
  userId: string;
  company?: any;
  prompt: string;
  aspectRatio?: '9:16' | '16:9';
  mood?: string;
  cameraMotion?: string;
  lighting?: string;
}): Promise<{ visualPrompt: string; cameraMotion: string; lighting: string; mood: string }> {
  const systemInstruction = `Você é um diretor de fotografia e cinematógrafo publicitário de classe mundial da Froc.IA.
Sua missão é expandir a ideia bruta do usuário em uma descrição visual cinematográfica de altíssima fidelidade e apelo comercial para o modelo Veo 3.1.
Retorne um JSON estrito no formato:
{
  "visualPrompt": "Descrição visual vívida e detalhada da cena em inglês e português para renderização cinematográfica",
  "cameraMotion": "Movimento de câmera preciso (ex: Smooth cinematic push-in with low angle track)",
  "lighting": "Esquema de iluminação refinado (ex: Volumetric golden hour side-lighting with soft fill)",
  "mood": "Atmosfera e gradação de cor (ex: Premium, sleek commercial aesthetic with high dynamic range)"
}`;

  const prompt = `${companyContext(data.company)}
Ideia ou cena do vídeo: ${data.prompt}
Formato de tela: ${data.aspectRatio || '9:16'}
Sugestão de clima: ${data.mood || 'Comercial premium'}
Sugestão de câmera: ${data.cameraMotion || 'Movimento dinâmico e fluido'}
Sugestão de luz: ${data.lighting || 'Iluminação de estúdio'}`;

  const raw = await generateRaw({
    prompt,
    systemInstruction,
    jsonOutput: true,
    maxTokens: 1200
  });

  const parsed = safeJsonParse<any>(raw.text, {
    visualPrompt: data.prompt,
    cameraMotion: data.cameraMotion || 'Smooth cinematic pan',
    lighting: data.lighting || 'Studio lighting',
    mood: data.mood || 'Premium commercial'
  });

  return {
    visualPrompt: String(parsed.visualPrompt || data.prompt),
    cameraMotion: String(parsed.cameraMotion || data.cameraMotion || 'Smooth cinematic pan'),
    lighting: String(parsed.lighting || data.lighting || 'Studio lighting'),
    mood: String(parsed.mood || data.mood || 'Premium commercial')
  };
}

export async function startVideoGenerationJob(data: {
  userId: string;
  company?: any;
  prompt: string;
  title?: string;
  preset?: VideoPreset;
  aspectRatio?: '9:16' | '16:9';
  initialImageBase64?: string;
  cameraMotion?: string;
  lighting?: string;
  mood?: string;
}): Promise<VideoJobData> {
  const preset: VideoPreset = data.preset === 'cinema_4k' ? 'cinema_4k' : data.preset === 'pro_1080p' ? 'pro_1080p' : 'demo_720p';
  const aspectRatio = data.aspectRatio === '16:9' ? '16:9' : '9:16';
  const resolution: '720p' | '1080p' | '4k' = preset === 'cinema_4k' ? '4k' : preset === 'pro_1080p' ? '1080p' : '720p';
  
  const opKey = preset === 'cinema_4k' ? 'video_veo_4k' : preset === 'pro_1080p' ? 'video_veo_1080p' : 'video_veo_fast';
  const cost = Number(config.creditCosts[opKey] || 50);
  
  const model = preset === 'cinema_4k'
    ? (config.geminiModels.veoCinema || 'veo-3.1-generate-preview')
    : preset === 'pro_1080p'
      ? (config.geminiModels.veoFast || 'veo-3.1-generate-preview')
      : (config.geminiModels.veoLite || 'veo-3.1-lite-generate-preview');

  const reservation = await reserveCredits({
    userId: data.userId,
    amount: cost,
    operation: opKey,
    companyId: data.company?.id
  });

  const jobId = newId('vjob');
  const now = nowIso();

  const fullPrompt = [
    companyContext(data.company),
    `Vídeo publicitário de alta qualidade e apelo comercial: ${data.prompt}.`,
    data.cameraMotion ? `Movimento de câmera: ${data.cameraMotion}.` : '',
    data.lighting ? `Iluminação: ${data.lighting}.` : '',
    data.mood ? `Atmosfera/Estilo: ${data.mood}.` : '',
    `Proporção de tela: ${aspectRatio}. Renderização cinematográfica sem artefatos ou elementos distorcidos.`
  ].filter(Boolean).join('\n');

  try {
    let operationName = `mock_op_${jobId}`;
    
    if (process.env.NODE_ENV !== 'test') {
      const videoConfig: any = {
        numberOfVideos: 1,
        resolution: resolution === '4k' ? '1080p' : resolution, // Ajuste para suporte seguro da API Veo
        aspectRatio
      };

      const reqPayload: any = {
        model,
        prompt: fullPrompt,
        config: videoConfig
      };

      if (data.initialImageBase64) {
        const cleanBase64 = data.initialImageBase64.replace(/^data:image\/[a-z]+;base64,/, '');
        reqPayload.image = {
          imageBytes: cleanBase64,
          mimeType: 'image/jpeg'
        };
      }

      const operation = await mediaAiClient().models.generateVideos(reqPayload);
      if (!operation?.name) {
        throw new Error('A API Veo não retornou o identificador da operação de vídeo.');
      }
      operationName = operation.name;
    }

    const jobData: VideoJobData = {
      id: jobId,
      userId: data.userId,
      companyId: data.company?.id || 'default',
      operationName,
      reservationId: reservation.reservationId,
      creditsReserved: cost,
      prompt: data.prompt,
      title: data.title || `Vídeo IA - ${data.prompt.slice(0, 60)}`,
      preset,
      resolution,
      aspectRatio,
      modelUsed: model,
      initialImageUrl: data.initialImageBase64 ? 'provided' : undefined,
      status: 'processing',
      progressPct: 10,
      createdAt: now,
      updatedAt: now
    };

    await firestore().collection(COLLECTIONS.mediaGenerationJobs).doc(jobId).set(jobData);
    return jobData;
  } catch (error) {
    const message = formatAiErrorMessage(error instanceof Error ? error.message : String(error));
    await rollbackReservation(data.userId, reservation.reservationId, message);
    throw new Error(message);
  }
}

export async function checkAndCompleteVideoJob(userId: string, jobId: string): Promise<VideoJobData> {
  const docRef = firestore().collection(COLLECTIONS.mediaGenerationJobs).doc(jobId);
  const snap = await docRef.get();
  if (!snap.exists) {
    const err: any = new Error('Job de geração de vídeo não encontrado.');
    err.statusCode = 404;
    throw err;
  }

  const job = snap.data() as VideoJobData;
  if (job.userId !== userId) {
    const err: any = new Error('Acesso não autorizado a este job.');
    err.statusCode = 403;
    throw err;
  }

  // Idempotência estrita: se já foi concluído ou falhou, retorna direto sem refazer operações
  if (job.status === 'completed' || job.status === 'failed') {
    return job;
  }

  // Simulação para ambiente de testes
  if (process.env.NODE_ENV === 'test') {
    const contentItemId = newId('content');
    const mockUrl = 'https://storage.googleapis.com/froc-ia-test-bucket/mock-video.mp4';
    
    const contentItem = {
      id: contentItemId,
      userId: job.userId,
      companyId: job.companyId || 'default',
      type: 'video',
      title: job.title || `Vídeo IA Veo - ${job.prompt.slice(0, 60)}`,
      headline: job.title || '',
      body: job.prompt,
      videoUrl: mockUrl,
      targetPlatform: job.aspectRatio === '9:16' ? 'Reels / TikTok / Shorts' : 'YouTube / Banner',
      creditsUsed: job.creditsReserved,
      status: 'saved',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      metadata: {
        jobId: job.id,
        preset: job.preset,
        resolution: job.resolution,
        aspectRatio: job.aspectRatio
      }
    };
    await firestore().collection(COLLECTIONS.contentItems).doc(contentItemId).set(contentItem);

    await commitReservation({
      userId: job.userId,
      reservationId: job.reservationId,
      source: `Froc AI: video_${job.preset}`,
      metadata: { jobId: job.id, contentItemId, modelUsed: job.modelUsed }
    });

    const updatedJob: VideoJobData = {
      ...job,
      status: 'completed',
      progressPct: 100,
      videoUrl: mockUrl,
      contentItemId,
      completedAt: nowIso(),
      updatedAt: nowIso()
    };
    await docRef.set(updatedJob);
    return updatedJob;
  }

  // Verificação real com a API Veo via mediaAiClient
  try {
    const op = new GenerateVideosOperation();
    op.name = job.operationName;
    const updated = await mediaAiClient().operations.getVideosOperation({ operation: op });

    if (!updated.done) {
      // Calcular estimativa de progresso baseada no tempo decorrido
      const elapsedSec = Math.max(0, (Date.now() - new Date(job.createdAt).getTime()) / 1000);
      const estTotalSec = job.preset === 'cinema_4k' ? 90 : 45;
      const progressPct = Math.min(92, Math.round(15 + (elapsedSec / estTotalSec) * 75));
      
      const inProgressJob: VideoJobData = {
        ...job,
        progressPct,
        updatedAt: nowIso()
      };
      await docRef.set(inProgressJob);
      return inProgressJob;
    }

    // Se concluiu com erro da API do Veo
    if (updated.error) {
      const errMsg = String(updated.error.message || 'Falha no processamento de vídeo pelo modelo Veo.');
      await rollbackReservation(job.userId, job.reservationId, errMsg);
      
      const failedJob: VideoJobData = {
        ...job,
        status: 'failed',
        errorMessage: errMsg,
        progressPct: 0,
        updatedAt: nowIso()
      };
      await docRef.set(failedJob);
      return failedJob;
    }

    // Se concluiu com sucesso, baixar o arquivo e salvar no Storage
    const downloadUri = updated.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadUri) {
      throw new Error('O modelo Veo indicou conclusão, mas não retornou o link do vídeo.');
    }

    const apiKeyForDownload = config.geminiMediaApiKey || config.geminiApiKey;
    const videoRes = await fetch(downloadUri, {
      headers: {
        'x-goog-api-key': apiKeyForDownload
      }
    });

    if (!videoRes.ok) {
      throw new Error(`Falha ao baixar o arquivo de vídeo gerado (status ${videoRes.status}).`);
    }

    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
    if (!videoBuffer.length || videoBuffer.length > 150 * 1024 * 1024) {
      throw new Error('O arquivo de vídeo baixado é inválido ou excede o limite aceito.');
    }

    const storagePath = `generated/${job.userId}/videos/${job.id}.mp4`;
    let publicVideoUrl = downloadUri;

    try {
      const token = crypto.randomUUID();
      const bucket = getAdminStorage().bucket();
      const file = bucket.file(storagePath);
      await file.save(videoBuffer, {
        resumable: false,
        metadata: {
          contentType: 'video/mp4',
          cacheControl: 'public,max-age=31536000,immutable',
          metadata: { firebaseStorageDownloadTokens: token }
        }
      });
      publicVideoUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(storagePath)}?alt=media&token=${encodeURIComponent(token)}`;
    } catch (storageErr) {
      console.warn('[Froc Video Storage Fallback] Firebase Storage indisponível, utilizando URL direta:', storageErr);
    }

    const contentItemId = newId('content');
    const contentItem = {
      id: contentItemId,
      userId: job.userId,
      companyId: job.companyId || 'default',
      type: 'video',
      title: job.title || `Vídeo IA - ${job.prompt.slice(0, 60)}`,
      headline: job.title || '',
      body: job.prompt,
      videoUrl: publicVideoUrl,
      targetPlatform: job.aspectRatio === '9:16' ? 'Reels / TikTok / Shorts' : 'YouTube / Banner',
      creditsUsed: job.creditsReserved,
      status: 'saved',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      metadata: {
        jobId: job.id,
        storagePath,
        preset: job.preset,
        resolution: job.resolution,
        aspectRatio: job.aspectRatio,
        modelUsed: job.modelUsed
      }
    };
    await firestore().collection(COLLECTIONS.contentItems).doc(contentItemId).set(contentItem);

    await commitReservation({
      userId: job.userId,
      reservationId: job.reservationId,
      source: `Froc AI: video_${job.preset}`,
      metadata: { jobId: job.id, contentItemId, storagePath, modelUsed: job.modelUsed }
    });

    await createNotification({
      userId: job.userId,
      title: 'Seu vídeo com Veo 3.1 está pronto!',
      message: `O vídeo "${job.title || 'Criativo IA'}" foi processado com sucesso em ${job.resolution} e já está disponível para visualização e download.`,
      type: 'video_ready'
    });

    const completedJob: VideoJobData = {
      ...job,
      status: 'completed',
      progressPct: 100,
      videoUrl: publicVideoUrl,
      storagePath,
      contentItemId,
      completedAt: nowIso(),
      updatedAt: nowIso()
    };
    await docRef.set(completedJob);
    return completedJob;
  } catch (error) {
    const message = formatAiErrorMessage(error instanceof Error ? error.message : String(error));
    // Se houve erro crítico de download/storage, marcamos como failed e estornamos
    await rollbackReservation(job.userId, job.reservationId, message);
    const failedJob: VideoJobData = {
      ...job,
      status: 'failed',
      errorMessage: message,
      progressPct: 0,
      updatedAt: nowIso()
    };
    await docRef.set(failedJob);
    return failedJob;
  }
}

export async function processPendingVideoJobs(): Promise<{ checked: number; completed: number; failed: number }> {
  try {
    const snap = await firestore().collection(COLLECTIONS.mediaGenerationJobs)
      .where('status', '==', 'processing')
      .limit(15)
      .get();
    
    let checked = 0;
    let completed = 0;
    let failed = 0;

    for (const doc of snap.docs) {
      const job = doc.data() as VideoJobData;
      checked++;
      try {
        const res = await checkAndCompleteVideoJob(job.userId, job.id);
        if (res.status === 'completed') completed++;
        else if (res.status === 'failed') failed++;
      } catch (err) {
        console.warn(`[Video Background Worker] Erro ao processar job ${job.id}:`, err);
      }
    }

    return { checked, completed, failed };
  } catch (error) {
    console.warn('[Video Background Worker] Erro ao consultar jobs pendentes:', error);
    return { checked: 0, completed: 0, failed: 0 };
  }
}

export async function listUserVideoJobs(userId: string, companyId?: string): Promise<VideoJobData[]> {
  let query: any = firestore().collection(COLLECTIONS.mediaGenerationJobs).where('userId', '==', userId);
  if (companyId && companyId !== 'all') {
    query = query.where('companyId', '==', companyId);
  }
  const items = queryData<VideoJobData>(await query.get());
  return items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
