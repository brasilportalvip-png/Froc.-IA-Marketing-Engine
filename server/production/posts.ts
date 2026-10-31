/** Janela "Posts": todas as postagens públicas do site (Froc Magazine + posts diários da Vitrine). */
import { COLLECTIONS, firestore, queryData } from './store.js';
import { hasApp } from './appLinks.js';

function clip(value: any, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

function isPublic(value: any): boolean {
  return value === true || value === 'true';
}

export interface PublicPostCard {
  kind: 'magazine' | 'vitrine';
  id: string;
  title: string;
  summary: string;
  path: string;
  imageUrl: string | null;
  source: string;
  label: string;
  location: string | null;
  publishedAt: string;
  hasApp: boolean;
  imageAlt: string;
}

export async function listAllPublicPosts(): Promise<PublicPostCard[]> {
  const db = firestore();
  const [blogSnap, vitrineSnap, companiesSnap] = await Promise.all([
    db.collection(COLLECTIONS.blogPosts).where('status', '==', 'published').get(),
    db.collection(COLLECTIONS.vitrinePosts).where('status', '==', 'published').get(),
    db.collection(COLLECTIONS.companies).get()
  ]);
  const publicCompanies = new Map(queryData<any>(companiesSnap).filter((c) => isPublic(c.isPublicInVitrine) && c.slug).map((c) => [c.id, c]));
  const magazine: PublicPostCard[] = queryData<any>(blogSnap).filter((p) => p.slug).map((p) => ({
    kind: 'magazine', id: p.id, title: clip(p.title, 200), summary: clip(p.summary || p.seoDescription, 300),
    path: `/blog/${encodeURIComponent(p.slug)}`, imageUrl: p.featuredImageUrl || null, source: clip(p.author, 120) || 'Froc Magazine',
    label: clip(p.category, 80) || 'Froc Magazine', location: null, publishedAt: String(p.publishedAt || p.createdAt || ''), hasApp: false, imageAlt: clip(p.imageAlt || p.title, 200)
  }));
  const vitrine: PublicPostCard[] = queryData<any>(vitrineSnap).filter((p) => p.slug && publicCompanies.has(p.companyId)).map((p) => {
    const company = publicCompanies.get(p.companyId);
    return {
      kind: 'vitrine', id: p.id, title: clip(p.title, 200), summary: clip(p.summary, 300),
      path: `/vitrine/${encodeURIComponent(company.slug)}/${encodeURIComponent(p.slug)}`, imageUrl: p.imageUrl || company.logoUrl || null,
      source: clip(company.name, 120), label: clip(p.angleLabel, 80) || 'Vitrine', location: p.location || null, publishedAt: String(p.publishedAt || p.createdAt || ''), hasApp: hasApp(company), imageAlt: clip(p.imageAlt || p.title, 200)
    };
  });
  return [...magazine, ...vitrine].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

