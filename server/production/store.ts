import crypto from 'crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from '../providers/firebaseAdmin.js';
import { config } from '../config/index.js';

// In-Memory Database for Local Automated Testing & Isolated Sandbox Testing ONLY
const inMemoryDb = new Map<string, Map<string, any>>();

export function getMemoryCollection(name: string): Map<string, any> {
  let col = inMemoryDb.get(name);
  if (!col) {
    col = new Map<string, any>();
    inMemoryDb.set(name, col);
  }
  return col;
}

export function resetMemoryDb(): void {
  inMemoryDb.clear();
}

// Seed initial blog and showcase data into in-memory store for local sandbox
(function seedInitialInMemoryData() {
  const blog = getMemoryCollection('blogPosts');
  if (blog.size === 0) {
    blog.set('blog-intro-ia', {
      id: 'blog-intro-ia',
      title: 'Como a Inteligência Artificial Transforma o Marketing de Pequenas e Médias Empresas',
      slug: 'como-a-inteligencia-artificial-transforma-o-marketing',
      summary: 'Descubra como o Froc.IA automatiza criação de campanhas, roteiros, posts e SEO com velocidade e consistência.',
      content: '# A Revolução da IA no Marketing\n\nA inteligência artificial deixou de ser um recurso exclusivo de grandes corporações. Hoje, ferramentas como o Froc.IA permitem que qualquer empreendedor crie estratégias completas de marketing, posts persuasivos, imagens de alta conversão e artigos otimizados para mecanismos de busca em poucos segundos.',
      featuredImageUrl: '',
      author: 'Equipe Froc.IA',
      category: 'Marketing & IA',
      tags: ['Inteligência Artificial', 'Marketing Digital', 'SEO', 'Automação'],
      seoTitle: 'Como a IA Transforma o Marketing — Froc Magazine',
      seoDescription: 'Aprenda como utilizar IA no marketing digital com foco em resultados reais.',
      status: 'published',
      publishedAt: '2026-08-01T12:00:00.000Z',
      createdAt: '2026-08-01T12:00:00.000Z',
      updatedAt: '2026-08-01T12:00:00.000Z'
    });
  }
})();

class MemoryDocRef {
  constructor(public colName: string, public id: string) {}

  async get(): Promise<any> {
    const col = getMemoryCollection(this.colName);
    const data = col.get(this.id);
    return {
      id: this.id,
      exists: Boolean(data),
      ref: this,
      data: () => (data ? { ...data } : undefined)
    };
  }

  async set(data: any, options?: { merge?: boolean }): Promise<void> {
    const col = getMemoryCollection(this.colName);
    if (options?.merge && col.has(this.id)) {
      const existing = col.get(this.id) || {};
      col.set(this.id, { ...existing, ...data, id: this.id });
    } else {
      col.set(this.id, { ...data, id: this.id });
    }
  }

  async create(data: any): Promise<void> {
    const col = getMemoryCollection(this.colName);
    if (col.has(this.id)) {
      const err: any = new Error('Document already exists');
      err.code = 6;
      throw err;
    }
    col.set(this.id, { ...data, id: this.id });
  }

  async update(data: any): Promise<void> {
    const col = getMemoryCollection(this.colName);
    const existing = col.get(this.id) || {};
    col.set(this.id, { ...existing, ...data, id: this.id });
  }

  async delete(): Promise<void> {
    getMemoryCollection(this.colName).delete(this.id);
  }
}

class MemoryQuery {
  private filters: Array<{ field: string; op: string; val: any }> = [];
  private limitCount?: number;

  constructor(public colName: string) {}

  where(field: string, op: string, val: any): MemoryQuery {
    const q = new MemoryQuery(this.colName);
    q.filters = [...this.filters, { field, op, val }];
    q.limitCount = this.limitCount;
    return q;
  }

  limit(n: number): MemoryQuery {
    const q = new MemoryQuery(this.colName);
    q.filters = [...this.filters];
    q.limitCount = n;
    return q;
  }

  async get(): Promise<any> {
    const col = getMemoryCollection(this.colName);
    let items = Array.from(col.values());

    for (const filter of this.filters) {
      items = items.filter((item) => {
        const itemVal = item[filter.field];
        if (filter.op === '==') return itemVal === filter.val;
        if (filter.op === '!=') return itemVal !== filter.val;
        if (filter.op === '<=') return itemVal <= filter.val;
        if (filter.op === '>=') return itemVal >= filter.val;
        if (filter.op === '<') return itemVal < filter.val;
        if (filter.op === '>') return itemVal > filter.val;
        if (filter.op === 'in') return Array.isArray(filter.val) && filter.val.includes(itemVal);
        return true;
      });
    }

    if (this.limitCount !== undefined) {
      items = items.slice(0, this.limitCount);
    }

    const docs = items.map((item) => ({
      id: item.id,
      exists: true,
      ref: new MemoryDocRef(this.colName, item.id),
      data: () => ({ ...item })
    }));

    return {
      docs,
      empty: docs.length === 0,
      size: docs.length
    };
  }
}

class MemoryCollectionRef extends MemoryQuery {
  doc(id?: string): MemoryDocRef {
    return new MemoryDocRef(this.colName, id || `${this.colName}-${crypto.randomUUID()}`);
  }
}

class MemoryFirestoreStore {
  collection(name: string): MemoryCollectionRef {
    return new MemoryCollectionRef(name);
  }

  batch(): any {
    const ops: Array<() => Promise<void>> = [];
    return {
      set: (docRef: any, data: any, options?: any) => {
        ops.push(async () => {
          if (docRef?.set) await docRef.set(data, options);
        });
      },
      delete: (docRef: any) => {
        ops.push(async () => {
          if (docRef?.delete) await docRef.delete();
        });
      },
      update: (docRef: any, data: any) => {
        ops.push(async () => {
          if (docRef?.update) await docRef.update(data);
        });
      },
      commit: async () => {
        for (const op of ops) {
          await op();
        }
      }
    };
  }

  async runTransaction<T>(updateFunction: (transaction: any) => Promise<T>): Promise<T> {
    const tx = {
      get: async (docRef: any) => docRef.get(),
      set: (docRef: any, data: any, options?: any) => docRef.set(data, options),
      update: (docRef: any, data: any) => docRef.update(data),
      delete: (docRef: any) => docRef.delete()
    };
    return await updateFunction(tx);
  }
}

const localMemoryStore = new MemoryFirestoreStore();

export function isLocalMemoryStoreAllowed(): boolean {
  if (config.isProduction) return false;
  return process.env.ALLOW_LOCAL_MEMORY_STORE === 'true' || process.env.NODE_ENV === 'test' || !config.isProduction;
}

export function firestore(): any {
  if (process.env.NODE_ENV === 'test') {
    return localMemoryStore;
  }

  const adminFirestore = getAdminFirestore();
  if (adminFirestore) {
    return adminFirestore;
  }

  if (config.isProduction) {
    throw new Error('Firebase Admin Firestore não está configurado em ambiente de produção. Operação de persistência abortada.');
  }

  if (isLocalMemoryStoreAllowed()) {
    return localMemoryStore;
  }

  throw new Error('Banco de dados Firestore não inicializado e modo em memória desabilitado.');
}

export function checkDatabaseHealth(): { status: 'healthy' | 'degraded' | 'unconfigured'; mode: string; message: string } {
  const adminFirestore = getAdminFirestore();
  if (adminFirestore) {
    return { status: 'healthy', mode: 'firestore_cloud', message: 'Firestore Cloud conectado e operacional.' };
  }
  if (config.isProduction) {
    return { status: 'unconfigured', mode: 'production_missing_credentials', message: 'Credenciais de produção do Firestore Admin ausentes.' };
  }
  if (isLocalMemoryStoreAllowed()) {
    return { status: 'degraded', mode: 'memory_sandbox', message: 'Executando em sandbox de desenvolvimento com armazenamento local isolado.' };
  }
  return { status: 'unconfigured', mode: 'none', message: 'Firestore não configurado.' };
}

export const COLLECTIONS = {
  users: 'users',
  wallets: 'wallets',
  creditTransactions: 'creditTransactions',
  creditReservations: 'creditReservations',
  idempotency: 'idempotency',
  companies: 'companies',
  contentItems: 'contentItems',
  campaigns: 'campaigns',
  scheduledPosts: 'scheduledPosts',
  payments: 'payments',
  socialConnections: 'socialConnections',
  oauthStates: 'oauthStates',
  pageSelectTokens: 'pageSelectTokens',
  seoReports: 'seoReports',
  blogPosts: 'blogPosts',
  autopilotConfigs: 'autopilotConfigs',
  aiExecutions: 'aiExecutions',
  adminLogs: 'adminLogs',
  notifications: 'notifications',
  supportTickets: 'supportTickets',
  schedulerLocks: 'schedulerLocks',
  systemSettings: 'systemSettings',
  bonusClaims: 'bonusClaims',
  securityEvents: 'securityEvents',
  deviceRegistrations: 'deviceRegistrations',
  mediaGenerationJobs: 'mediaGenerationJobs'
} as const;

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function stableId(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `item-${Date.now()}`;
}

export function cleanObject<T extends Record<string, any>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

export function docData<T = any>(snapshot: any): T | null {
  if (!snapshot.exists) return null;
  const raw = snapshot.data() || {};
  const normalized: Record<string, any> = { id: snapshot.id };
  for (const [key, value] of Object.entries(raw)) {
    normalized[key] = value instanceof Timestamp ? value.toDate().toISOString() : value;
  }
  return normalized as T;
}

export function queryData<T = any>(snapshot: any): T[] {
  return snapshot.docs.map((doc) => docData<T>(doc)!).filter(Boolean);
}

export async function writeAdminLog(data: {
  operatorId: string;
  operatorEmail?: string;
  action: string;
  targetUserId?: string;
  details?: Record<string, any>;
}): Promise<void> {
  const id = newId('adm');
  await firestore().collection(COLLECTIONS.adminLogs).doc(id).set({
    ...cleanObject(data),
    createdAt: nowIso()
  });
}

export async function createNotification(data: {
  userId: string;
  title: string;
  message: string;
  type: string;
}): Promise<void> {
  const id = newId('notif');
  await firestore().collection(COLLECTIONS.notifications).doc(id).set({
    ...data,
    read: false,
    createdAt: nowIso()
  });
}

export { FieldValue };
