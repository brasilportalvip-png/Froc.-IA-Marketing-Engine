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
  if (process.env.NODE_ENV === 'test') {
    const text = data.jsonOutput
      ? JSON.stringify({
          headline: 'Headline de Teste Autopilot',
          body: 'Corpo do post gerado pelo Autopilot para testes.',
          cta: 'Saiba mais e confira nossa coleção.',
          hashtags: ['#teste', '#autopilot'],
          keywords: ['marketing', 'vendas'],
          visualPrompt: 'Foto profissional de moda feminina em alta definição'
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
1. O artigo deve ser profundo, prático e detalhado (não resuma em poucas frases; desenvolva cada seção com explicações ricas, exemplos aplicáveis e orientações acionáveis).
2. Estruture em 3 a 6 seções H2 lógicas e relevantes, incluindo subtópicos H3 onde apropriado.
3. Inclua uma seção de FAQ com 3 a 5 perguntas reais e respostas diretas.
4. Conclusão persuasiva com Chamada para Ação contextualizada.
5. REGRAS ANTI-ALUCINAÇÃO: Não invente pesquisas falsas, percentuais inventados, testemunhos fictícios, citações de pessoas inexistentes ou promessas de ganhos financeiros milagrosos. Se usar dados, atenha-se a conceitos e práticas comprovadas de mercado.

Responda SOMENTE JSON válido no seguinte formato:
{
  "title": "Título H1 cativante com a palavra-chave",
  "metaDescription": "Meta descrição de 140 a 160 caracteres com gatilho e palavra-chave",
  "introduction": "Introdução engajadora apresentando a dor, a importância do tema e o que será aprendido no artigo.",
  "sections": [
    {
      "h2": "Título da Seção H2",
      "content": "Conteúdo aprofundado e rico da seção...",
      "h3s": [
        {
          "h3": "Subtópico H3",
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
}): Promise<{ imageUrl: string; storagePath: string; mimeType: string; creditsUsed: number; executionId: string; modelUsed: string }> {
  const cost = Number(config.creditCosts.image_ai);
  const reservation = await reserveCredits({ userId: data.userId, amount: cost, operation: 'image_ai', companyId: data.company?.id });
  const executionId = newId('exec');
  const started = Date.now();
  const aspectRatio = normalizeAspectRatio(data.aspectRatio);
  const prompt = `${companyContext(data.company)}\n\nCrie uma imagem publicitária premium e original para: ${data.theme}.\nEstilo visual: ${data.style || 'fotografia comercial moderna e sofisticada'}.\nProporção: ${aspectRatio}.\nNão inclua logotipos ou marcas de terceiros. Não invente selos, depoimentos ou números. Se houver texto na arte, mantenha-o curto, legível e somente se fizer sentido para o briefing.`;

  const model = config.geminiModels.image || 'gemini-3.1-flash-image';

  try {
    let response: any;
    if (model.startsWith('imagen-')) {
      response = await (aiClient() as any).models.generateImages({
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
      response = await aiClient().models.generateContent({
        model,
        contents: prompt,
        config: {
          imageConfig: {
            aspectRatio,
            imageSize: '1K'
          }
        }
      });
    }

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
      metadata: { executionId, modelUsed: model, storagePath }
    });
    await firestore().collection(COLLECTIONS.aiExecutions).doc(executionId).set({
      userId: data.userId,
      companyId: data.company?.id || null,
      type: 'image_ai',
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
    return { imageUrl, storagePath, mimeType: image.mimeType, creditsUsed: cost, executionId, modelUsed: model };
  } catch (error) {
    const message = formatAiErrorMessage(error instanceof Error ? error.message : String(error));
    await rollbackReservation(data.userId, reservation.reservationId, message);
    await firestore().collection(COLLECTIONS.aiExecutions).doc(executionId).set({
      userId: data.userId,
      companyId: data.company?.id || null,
      type: 'image_ai',
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
