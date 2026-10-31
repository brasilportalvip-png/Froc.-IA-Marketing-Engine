/**
 * Imagens dos posts: cada post da Vitrine e do Froc Magazine ganha uma imagem
 * criada pela IA a partir do que ele sabe do PROJETO (nicho, produtos, serviços,
 * descrição, cidade/bairro) e da PUBLICAÇÃO (título, palavra-chave, ângulo do dia).
 */
import { config } from '../config/index.js';
import { generateEditorialImage } from './ai.js';
import { baseUrl, pingIndexNow } from './seoEngine.js';
import { COLLECTIONS, firestore, nowIso, queryData } from './store.js';
import { isImageHashUsed, registerImageHash, sceneVariation } from './uniqueness.js';

/** Depois desse número de tentativas o post que está sem imagem para de tentar (o admin pode reabrir). */
export const MAX_IMAGE_ATTEMPTS = 5;

const clean = (value: any, max = 300) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const list = (value: any, max = 6) => (Array.isArray(value) ? value : []).map((item) => clean(item, 80)).filter(Boolean).slice(0, max);

/** Monta o briefing visual a partir do projeto + publicação. */
export function buildPostImagePrompt(data: { company?: any; title: string; summary?: string; keyword?: string; angle?: string; location?: string | null; category?: string; variation?: string }): string {
  const company = data.company || {};
  const t = company.targeting || {};
  const niche = [company.category, company.segment, company.niche, data.category].map((v) => clean(v, 80)).filter(Boolean).join(' / ');
  const offer = [...list(company.products), ...list(company.services)].join(', ');
  const place = clean(data.location || [...list(t.neighborhoods, 3), t.city || company.city, t.state || company.state].filter(Boolean).join(', '), 160);
  return [
    'Crie UMA fotografia publicitária realista, premium e original para ilustrar um post de blog/redes sociais.',
    company.name ? `Projeto/marca: ${clean(company.name, 120)}.` : 'Projeto: Froc Magazine (marketing, SEO e inteligência artificial para pequenas e médias empresas).',
    niche ? `Nicho do negócio: ${niche}.` : '',
    offer ? `O que a empresa oferece: ${offer}.` : '',
    company.description ? `Sobre a empresa: ${clean(company.description, 400)}.` : '',
    place ? `Região atendida (use referências visuais coerentes com o Brasil e com esta região, sem placas com nomes): ${place}.` : '',
    `Assunto do post: ${clean(data.title, 200)}.`,
    data.keyword ? `Palavra-chave principal: ${clean(data.keyword, 80)}.` : '',
    data.angle ? `Ângulo editorial: ${clean(data.angle, 80)}.` : '',
    data.summary ? `Resumo: ${clean(data.summary, 300)}.` : '',
    'A cena deve mostrar claramente o nicho e o benefício para o cliente (o produto, o serviço sendo prestado ou o resultado), com pessoas reais e brasileiras quando fizer sentido.',
    `Cena desta imagem (única, diferente de todas as outras do projeto): ${clean(data.variation || sceneVariation(`${data.title}|${data.keyword || ''}`), 160)}.`,
    'Composição horizontal 16:9, iluminação natural ou de estúdio, cores vivas, foco nítido, aparência de campanha profissional.',
    'PROIBIDO: textos, letras, números, logotipos, marcas de terceiros, marcas d\'água, molduras, selos ou elementos que pareçam montagem.'
  ].filter(Boolean).join('\n');
}

export function isGeneratedPostImage(url?: string | null): boolean {
  return Boolean(url) && !String(url).endsWith('/og-froc.jpg') && !String(url).includes('/brand/');
}

/**
 * Gera a imagem do post. Nunca reaproveita imagem: a impressão digital (SHA-256)
 * é conferida e, se repetir, a IA cria outra cena. Sem imagem própria = null
 * (o post fica aguardando imagem e não é publicado).
 */
export async function createPostImage(data: Parameters<typeof buildPostImagePrompt>[0] & { folder: string }): Promise<{ imageUrl: string; imageAlt: string; sha256?: string } | null> {
  if (!config.postImages.enabled) return null;
  const alt = [clean(data.title, 120), data.company?.name ? clean(data.company.name, 80) : '', data.location ? clean(data.location, 80) : ''].filter(Boolean).join(' — ');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const variation = sceneVariation(`${data.title}|${data.keyword || ''}|${attempt}|${Date.now()}`);
      const result = await generateEditorialImage({ prompt: buildPostImagePrompt({ ...data, variation }), aspectRatio: '16:9', folder: data.folder });
      if (await isImageHashUsed(result.sha256)) {
        console.warn('[Froc Imagens] Imagem repetida descartada; criando outra cena.');
        continue;
      }
      await registerImageHash(result.sha256, { imageUrl: result.imageUrl, folder: data.folder });
      return { imageUrl: result.imageUrl, imageAlt: alt, sha256: result.sha256 };
    } catch (error) {
      console.warn('[Froc Imagens] Falha ao gerar imagem do post:', error instanceof Error ? error.message : error);
      return null;
    }
  }
  return null;
}

/**
 * Completa as imagens que faltam nos posts já publicados (lotes pequenos por ciclo).
 * Posts da Vitrine sem imagem gerada e artigos do Magazine sem imagem própria.
 */
export async function backfillPostImages(limit = config.postImages.perTick): Promise<{ generated: number; pending: number; failed: number }> {
  if (!config.postImages.enabled || limit <= 0) return { generated: 0, pending: 0, failed: 0 };
  const db = firestore();
  const [vitrineSnap, blogSnap, vitrineWaitSnap, blogWaitSnap, companiesSnap] = await Promise.all([
    db.collection(COLLECTIONS.vitrinePosts).where('status', '==', 'published').get(),
    db.collection(COLLECTIONS.blogPosts).where('status', '==', 'published').get(),
    db.collection(COLLECTIONS.vitrinePosts).where('status', '==', 'awaiting_image').get(),
    db.collection(COLLECTIONS.blogPosts).where('status', '==', 'awaiting_image').get(),
    db.collection(COLLECTIONS.companies).get()
  ]);
  const companies = new Map(queryData<any>(companiesSnap).map((c) => [c.id, c]));
  const canRetry = (p: any) => !p.imageFailedAt && Number(p.imageAttempts || 0) < MAX_IMAGE_ATTEMPTS;
  const byDate = (a: any, b: any) => String(b.publishedAt || b.createdAt).localeCompare(String(a.publishedAt || a.createdAt));
  // Primeiro os posts que estão esperando a imagem para serem publicados.
  const vitrineMissing = [...queryData<any>(vitrineWaitSnap).sort(byDate), ...queryData<any>(vitrineSnap).filter((p) => !p.imageGenerated).sort(byDate)].filter(canRetry);
  const blogMissing = [...queryData<any>(blogWaitSnap).sort(byDate), ...queryData<any>(blogSnap).filter((p) => !isGeneratedPostImage(p.featuredImageUrl)).sort(byDate)].filter(canRetry);
  const queue = [...vitrineMissing.map((p) => ({ kind: 'vitrine' as const, post: p })), ...blogMissing.map((p) => ({ kind: 'blog' as const, post: p }))];
  const batch = queue.slice(0, limit);
  let generated = 0;
  let failed = 0;
  const urls: string[] = [];
  for (const item of batch) {
    const post = item.post;
    const company = item.kind === 'vitrine' ? companies.get(post.companyId) : null;
    const image = await createPostImage({
      company,
      title: post.title,
      summary: post.summary,
      keyword: post.primaryKeyword || (Array.isArray(post.keywords) ? post.keywords[0] : '') || (Array.isArray(post.tags) ? post.tags[0] : ''),
      angle: post.angleLabel,
      location: post.location,
      category: post.category,
      folder: item.kind === 'vitrine' ? `posts/vitrine/${post.companyId}` : 'posts/magazine'
    });
    const collection = item.kind === 'vitrine' ? COLLECTIONS.vitrinePosts : COLLECTIONS.blogPosts;
    if (!image) {
      failed += 1;
      const attempts = Number(post.imageAttempts || 0) + 1;
      await db.collection(collection).doc(post.id).set({ imageAttempts: attempts, ...(attempts >= MAX_IMAGE_ATTEMPTS ? { imageFailedAt: nowIso() } : {}) }, { merge: true });
      continue;
    }
    generated += 1;
    // Post que esperava imagem: agora sim é publicado.
    const publish = post.status === 'awaiting_image' ? { status: 'published', publishedAt: nowIso() } : {};
    if (item.kind === 'vitrine') {
      await db.collection(collection).doc(post.id).set({ imageUrl: image.imageUrl, imageAlt: image.imageAlt, imageGenerated: true, imageSha256: image.sha256 || null, ...publish, updatedAt: nowIso() }, { merge: true });
      if (company?.slug) urls.push(`${baseUrl()}/vitrine/${encodeURIComponent(company.slug)}/${encodeURIComponent(post.slug)}`);
    } else {
      await db.collection(collection).doc(post.id).set({ featuredImageUrl: image.imageUrl, imageAlt: image.imageAlt, imageSha256: image.sha256 || null, ...publish, updatedAt: nowIso() }, { merge: true });
      urls.push(`${baseUrl()}/blog/${encodeURIComponent(post.slug)}`);
    }
  }
  if (urls.length) await pingIndexNow(urls, 'post_images');
  return { generated, failed, pending: Math.max(queue.length - batch.length, 0) };
}

/** Permite tentar de novo os posts cuja imagem falhou (ex.: depois de corrigir a chave da IA). */
export async function resetFailedPostImages(): Promise<number> {
  const db = firestore();
  let count = 0;
  for (const collection of [COLLECTIONS.vitrinePosts, COLLECTIONS.blogPosts]) {
    const failed = queryData<any>(await db.collection(collection).get()).filter((p) => p.imageFailedAt || Number(p.imageAttempts || 0) >= MAX_IMAGE_ATTEMPTS);
    for (const post of failed) {
      await db.collection(collection).doc(post.id).set({ imageFailedAt: null, imageAttempts: 0 }, { merge: true });
      count += 1;
    }
  }
  return count;
}
