/**
 * Conteúdo único (regra do Google: nada de páginas duplicadas ou "thin content").
 * - Textos: compara título e similaridade de trechos (shingles) com os posts anteriores.
 * - Imagens: cada imagem publicada tem a impressão digital (SHA-256) registrada;
 *   uma imagem idêntica nunca é usada em dois posts.
 */
import { firestore, nowIso, slugify } from './store.js';

const IMAGE_HASHES = 'postImageHashes';

export function normalizeForCompare(text: string): string {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function shingles(text: string, size = 5): Set<string> {
  const words = normalizeForCompare(text).split(' ').filter(Boolean);
  const set = new Set<string>();
  for (let i = 0; i + size <= words.length; i += 1) set.add(words.slice(i, i + size).join(' '));
  if (!set.size && words.length) set.add(words.join(' '));
  return set;
}

export function similarity(a: string, b: string): number {
  const sa = shingles(a);
  const sb = shingles(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const item of sa) if (sb.has(item)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

export const DUPLICATE_THRESHOLD = 0.35;

/** true quando o candidato repete título ou grande parte do texto de um post anterior. */
export function isDuplicatePost(candidate: { title: string; content: string }, previous: Array<{ title?: string; content?: string }>): boolean {
  const title = slugify(candidate.title || '');
  for (const post of previous) {
    if (title && slugify(post.title || '') === title) return true;
    if (candidate.content && post.content && similarity(candidate.content, post.content) >= DUPLICATE_THRESHOLD) return true;
  }
  return false;
}

/** Bloco de prompt com o que já foi publicado, para a IA escrever algo novo. */
export function avoidRepeatBlock(previous: Array<{ title?: string; primaryKeyword?: string; angleLabel?: string }>, max = 30): string {
  const items = previous.slice(0, max).map((post) => `- ${post.title || ''}${post.primaryKeyword ? ` (palavra-chave: ${post.primaryKeyword})` : ''}`).filter((line) => line.length > 3);
  if (!items.length) return '';
  return `\nJÁ PUBLICADOS (PROIBIDO repetir título, assunto, palavra-chave principal ou estrutura; traga um tema e um ângulo NOVOS):\n${items.join('\n')}\n`;
}

export async function isImageHashUsed(hash?: string | null): Promise<boolean> {
  if (!hash) return false;
  const snap = await firestore().collection(IMAGE_HASHES).doc(hash).get();
  return snap.exists;
}

export async function registerImageHash(hash: string | null | undefined, info: { imageUrl: string; folder: string }): Promise<void> {
  if (!hash) return;
  await firestore().collection(IMAGE_HASHES).doc(hash).set({ ...info, createdAt: nowIso() }, { merge: true });
}

/** Variações de cena para que duas imagens do mesmo projeto nunca fiquem iguais. */
const SCENE_VARIATIONS = [
  'plano aberto do ambiente, luz da manhã',
  'close nos detalhes do produto/serviço, luz suave lateral',
  'cliente satisfeito sendo atendido, fim de tarde',
  'bastidores do trabalho, mãos em ação, luz de estúdio',
  'cena externa na região atendida, céu azul',
  'composição em mesa vista de cima (flat lay)',
  'profissional explicando ao cliente, ambiente acolhedor',
  'resultado final em destaque, fundo desfocado',
  'cena noturna com iluminação quente',
  'família ou grupo usando o produto/serviço no dia a dia'
];

export function sceneVariation(seed: string): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return SCENE_VARIATIONS[hash % SCENE_VARIATIONS.length];
}
