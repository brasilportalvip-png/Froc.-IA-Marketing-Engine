import crypto from 'crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from '../providers/firebaseAdmin.js';
import { config } from '../config/index.js';

type MemoryDatabase = Map<string, Map<string, any>>;
type MemoryMutation =
  | { type: 'set'; ref: MemoryDocRef; data: Record<string, any>; options?: { merge?: boolean } }
  | { type: 'create'; ref: MemoryDocRef; data: Record<string, any> }
  | { type: 'update'; ref: MemoryDocRef; data: Record<string, any> }
  | { type: 'delete'; ref: MemoryDocRef };

// Banco em memória exclusivamente para testes automatizados e sandbox local.
const inMemoryDb: MemoryDatabase = new Map();

function cloneMemoryValue<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (Buffer.isBuffer(value)) return Buffer.from(value) as T;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map((item) => cloneMemoryValue(item)) as T;

  // Preserva instâncias imutáveis/especiais do SDK, como Timestamp e FieldValue.
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;

  const result: Record<string, any> = {};
  for (const [key, item] of Object.entries(value as Record<string, any>)) {
    result[key] = cloneMemoryValue(item);
  }
  return result as T;
}

function cloneMemoryDatabase(source: MemoryDatabase): MemoryDatabase {
  const copy: MemoryDatabase = new Map();
  for (const [collectionName, collection] of source.entries()) {
    const collectionCopy = new Map<string, any>();
    for (const [id, value] of collection.entries()) {
      collectionCopy.set(id, cloneMemoryValue(value));
    }
    copy.set(collectionName, collectionCopy);
  }
  return copy;
}

function memoryCollection(database: MemoryDatabase, name: string, create = true): Map<string, any> | undefined {
  let collection = database.get(name);
  if (!collection && create) {
    collection = new Map<string, any>();
    database.set(name, collection);
  }
  return collection;
}

function firestoreLikeError(message: string, code: number | string): Error {
  const error: any = new Error(message);
  error.code = code;
  return error;
}

function assertDocumentData(data: unknown): asserts data is Record<string, any> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError('Firestore document data must be a non-null object.');
  }
}

function applyMemoryMutation(database: MemoryDatabase, mutation: MemoryMutation): void {
  const collection = memoryCollection(database, mutation.ref.colName, mutation.type !== 'delete');
  const exists = Boolean(collection?.has(mutation.ref.id));

  if (mutation.type === 'delete') {
    collection?.delete(mutation.ref.id);
    return;
  }

  assertDocumentData(mutation.data);
  const incoming = { ...cloneMemoryValue(mutation.data), id: mutation.ref.id };

  if (mutation.type === 'create') {
    if (exists) throw firestoreLikeError('Document already exists', 6);
    collection!.set(mutation.ref.id, incoming);
    return;
  }

  if (mutation.type === 'update') {
    if (!exists) throw firestoreLikeError('Document does not exist', 5);
    const existing = cloneMemoryValue(collection!.get(mutation.ref.id) || {});
    collection!.set(mutation.ref.id, { ...existing, ...incoming, id: mutation.ref.id });
    return;
  }

  if (mutation.options?.merge && exists) {
    const existing = cloneMemoryValue(collection!.get(mutation.ref.id) || {});
    collection!.set(mutation.ref.id, { ...existing, ...incoming, id: mutation.ref.id });
    return;
  }

  collection!.set(mutation.ref.id, incoming);
}

function commitMemoryMutations(mutations: MemoryMutation[]): void {
  // Aplica tudo em uma cópia. Se qualquer precondição falhar, nada é publicado.
  const candidate = cloneMemoryDatabase(inMemoryDb);
  for (const mutation of mutations) applyMemoryMutation(candidate, mutation);

  inMemoryDb.clear();
  for (const [name, collection] of candidate.entries()) {
    inMemoryDb.set(name, collection);
  }
}

export function getMemoryCollection(name: string): Map<string, any> {
  return memoryCollection(inMemoryDb, name, true)!;
}

export function resetMemoryDb(): void {
  inMemoryDb.clear();
}

// Conteúdo inicial somente para o sandbox em memória.
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
  constructor(public colName: string, public id: string) {
    if (!colName || !id || id.includes('/')) {
      throw new TypeError('Invalid in-memory Firestore document reference.');
    }
  }

  snapshot(database: MemoryDatabase = inMemoryDb): any {
    const collection = memoryCollection(database, this.colName, false);
    const exists = Boolean(collection?.has(this.id));
    const data = exists ? cloneMemoryValue(collection!.get(this.id)) : undefined;
    return {
      id: this.id,
      exists,
      ref: this,
      data: () => (exists ? cloneMemoryValue(data) : undefined)
    };
  }

  async get(): Promise<any> {
    return this.snapshot();
  }

  async set(data: any, options?: { merge?: boolean }): Promise<void> {
    applyMemoryMutation(inMemoryDb, { type: 'set', ref: this, data, options });
  }

  async create(data: any): Promise<void> {
    applyMemoryMutation(inMemoryDb, { type: 'create', ref: this, data });
  }

  async update(data: any): Promise<void> {
    applyMemoryMutation(inMemoryDb, { type: 'update', ref: this, data });
  }

  async delete(): Promise<void> {
    applyMemoryMutation(inMemoryDb, { type: 'delete', ref: this });
  }
}

function nestedFieldValue(item: any, field: string): any {
  return field.split('.').reduce((value, segment) => value?.[segment], item);
}

class MemoryQuery {
  protected filters: Array<{ field: string; op: string; val: any }> = [];
  protected limitCount?: number;

  constructor(public colName: string) {}

  where(field: string, op: string, val: any): MemoryQuery {
    const query = new MemoryQuery(this.colName);
    query.filters = [...this.filters, { field, op, val: cloneMemoryValue(val) }];
    query.limitCount = this.limitCount;
    return query;
  }

  limit(value: number): MemoryQuery {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Firestore query limit must be a non-negative safe integer.');
    const query = new MemoryQuery(this.colName);
    query.filters = [...this.filters];
    query.limitCount = value;
    return query;
  }

  snapshot(database: MemoryDatabase = inMemoryDb): any {
    const collection = memoryCollection(database, this.colName, false);
    let items = collection ? Array.from(collection.values()).map((item) => cloneMemoryValue(item)) : [];

    for (const filter of this.filters) {
      items = items.filter((item) => {
        const itemValue = nestedFieldValue(item, filter.field);
        if (filter.op === '==') return itemValue === filter.val;
        if (filter.op === '!=') return itemValue !== filter.val;
        if (filter.op === '<=') return itemValue <= filter.val;
        if (filter.op === '>=') return itemValue >= filter.val;
        if (filter.op === '<') return itemValue < filter.val;
        if (filter.op === '>') return itemValue > filter.val;
        if (filter.op === 'in') return Array.isArray(filter.val) && filter.val.includes(itemValue);
        if (filter.op === 'not-in') return Array.isArray(filter.val) && !filter.val.includes(itemValue);
        if (filter.op === 'array-contains') return Array.isArray(itemValue) && itemValue.includes(filter.val);
        if (filter.op === 'array-contains-any') {
          return Array.isArray(itemValue) &&
            Array.isArray(filter.val) &&
            filter.val.some((value) => itemValue.includes(value));
        }
        throw new TypeError(`Unsupported in-memory Firestore operator: ${filter.op}`);
      });
    }

    if (this.limitCount !== undefined) items = items.slice(0, this.limitCount);

    const docs = items.map((item) => {
      const id = String(item.id || '');
      const ref = new MemoryDocRef(this.colName, id);
      return {
        id,
        exists: true,
        ref,
        data: () => cloneMemoryValue(item)
      };
    });

    return {
      docs,
      empty: docs.length === 0,
      size: docs.length
    };
  }

  async get(): Promise<any> {
    return this.snapshot();
  }
}

class MemoryCollectionRef extends MemoryQuery {
  doc(id?: string): MemoryDocRef {
    return new MemoryDocRef(this.colName, id || `${this.colName}-${crypto.randomUUID()}`);
  }
}

class MemoryFirestoreStore {
  private txLock: Promise<void> = Promise.resolve();

  collection(name: string): MemoryCollectionRef {
    if (!name || name.includes('/')) throw new TypeError('Invalid in-memory Firestore collection name.');
    return new MemoryCollectionRef(name);
  }

  private async withExclusiveLock<T>(operation: () => Promise<T>): Promise<T> {
    let releaseLock!: () => void;
    const nextLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const currentLock = this.txLock;
    this.txLock = nextLock;

    await currentLock;
    try {
      return await operation();
    } finally {
      releaseLock();
    }
  }

  batch(): any {
    const mutations: MemoryMutation[] = [];
    let committed = false;

    const addMutation = (mutation: MemoryMutation) => {
      if (committed) throw new Error('Firestore batch has already been committed.');
      if (mutations.length >= 500) throw new RangeError('Firestore batch limit of 500 operations exceeded.');
      mutations.push(mutation);
      return batch;
    };

    const batch: any = {
      set: (ref: MemoryDocRef, data: any, options?: any) =>
        addMutation({ type: 'set', ref, data: cloneMemoryValue(data), options }),
      create: (ref: MemoryDocRef, data: any) =>
        addMutation({ type: 'create', ref, data: cloneMemoryValue(data) }),
      update: (ref: MemoryDocRef, data: any) =>
        addMutation({ type: 'update', ref, data: cloneMemoryValue(data) }),
      delete: (ref: MemoryDocRef) =>
        addMutation({ type: 'delete', ref }),
      commit: async () => {
        if (committed) throw new Error('Firestore batch has already been committed.');
        committed = true;
        await this.withExclusiveLock(async () => {
          commitMemoryMutations(mutations);
        });
        return [];
      }
    };

    return batch;
  }

  async runTransaction<T>(updateFunction: (transaction: any) => Promise<T>): Promise<T> {
    return this.withExclusiveLock(async () => {
      const snapshotDatabase = cloneMemoryDatabase(inMemoryDb);
      const mutations: MemoryMutation[] = [];
      let writeStarted = false;

      const transaction: any = {};
      const addMutation = (mutation: MemoryMutation) => {
        if (mutations.length >= 500) throw new RangeError('Firestore transaction limit of 500 operations exceeded.');
        writeStarted = true;
        mutations.push(mutation);
        return transaction;
      };

      transaction.get = async (refOrQuery: MemoryDocRef | MemoryQuery) => {
        if (writeStarted) {
          throw new Error('Firestore transactions require all reads before writes.');
        }
        if (refOrQuery instanceof MemoryDocRef || refOrQuery instanceof MemoryQuery) {
          return refOrQuery.snapshot(snapshotDatabase);
        }
        throw new TypeError('Unsupported in-memory Firestore transaction read.');
      };
      transaction.set = (ref: MemoryDocRef, data: any, options?: any) =>
        addMutation({ type: 'set', ref, data: cloneMemoryValue(data), options });
      transaction.create = (ref: MemoryDocRef, data: any) =>
        addMutation({ type: 'create', ref, data: cloneMemoryValue(data) });
      transaction.update = (ref: MemoryDocRef, data: any) =>
        addMutation({ type: 'update', ref, data: cloneMemoryValue(data) });
      transaction.delete = (ref: MemoryDocRef) =>
        addMutation({ type: 'delete', ref });

      const result = await updateFunction(transaction);
      commitMemoryMutations(mutations);
      return result;
    });
  }
}

const localMemoryStore = new MemoryFirestoreStore();

export function isLocalMemoryStoreAllowed(): boolean {
  if (config.isProduction) return false;
  return process.env.ALLOW_LOCAL_MEMORY_STORE === 'true' ||
    process.env.NODE_ENV === 'test' ||
    config.nodeEnv === 'development';
}

export function firestore(): any {
  if (process.env.NODE_ENV === 'test') return localMemoryStore;

  const adminFirestore = getAdminFirestore();
  if (adminFirestore) return adminFirestore;

  if (config.isProduction) {
    throw new Error('Firebase Admin Firestore não está configurado em ambiente de produção. Operação de persistência abortada.');
  }

  if (isLocalMemoryStoreAllowed()) return localMemoryStore;

  throw new Error('Banco de dados Firestore não inicializado e modo em memória desabilitado.');
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
  mediaGenerationJobs: 'mediaGenerationJobs',
  rateLimits: 'rateLimits'
} as const;

export type DatabaseHealth = {
  status: 'healthy' | 'degraded' | 'unconfigured' | 'unavailable';
  mode: string;
  message: string;
  checkedAt?: string;
};

let cachedCloudHealth: DatabaseHealth | null = null;
let cloudHealthExpiresAt = 0;
let cloudHealthProbe: Promise<DatabaseHealth> | null = null;

export async function probeDatabaseHealth(): Promise<DatabaseHealth> {
  if (cloudHealthProbe) return cloudHealthProbe;

  cloudHealthProbe = (async () => {
    const adminFirestore = getAdminFirestore();
    if (!adminFirestore) {
      const result: DatabaseHealth = config.isProduction
        ? {
            status: 'unconfigured',
            mode: 'production_missing_credentials',
            message: 'Credenciais de produção do Firestore Admin ausentes.',
            checkedAt: nowIso()
          }
        : {
            status: isLocalMemoryStoreAllowed() ? 'degraded' : 'unconfigured',
            mode: isLocalMemoryStoreAllowed() ? 'memory_sandbox' : 'none',
            message: isLocalMemoryStoreAllowed()
              ? 'Executando em sandbox de desenvolvimento com armazenamento local isolado.'
              : 'Firestore não configurado.',
            checkedAt: nowIso()
          };
      cachedCloudHealth = result;
      cloudHealthExpiresAt = Date.now() + 15_000;
      return result;
    }

    try {
      // Leitura real e limitada: configuração presente, por si só, não significa readiness.
      await adminFirestore.collection(COLLECTIONS.systemSettings).limit(1).get();
      const result: DatabaseHealth = {
        status: 'healthy',
        mode: 'firestore_cloud',
        message: 'Firestore Cloud respondeu à verificação de leitura.',
        checkedAt: nowIso()
      };
      cachedCloudHealth = result;
      cloudHealthExpiresAt = Date.now() + 30_000;
      return result;
    } catch {
      const result: DatabaseHealth = {
        status: 'unavailable',
        mode: 'firestore_cloud_unreachable',
        message: 'Firestore Cloud configurado, mas indisponível para leitura.',
        checkedAt: nowIso()
      };
      cachedCloudHealth = result;
      cloudHealthExpiresAt = Date.now() + 5_000;
      return result;
    }
  })();

  try {
    return await cloudHealthProbe;
  } finally {
    cloudHealthProbe = null;
  }
}

export function checkDatabaseHealth(): DatabaseHealth {
  const adminFirestore = getAdminFirestore();
  if (adminFirestore) {
    if (cachedCloudHealth && Date.now() < cloudHealthExpiresAt) return cachedCloudHealth;
    void probeDatabaseHealth().catch(() => undefined);
    return {
      status: 'degraded',
      mode: 'firestore_cloud_checking',
      message: 'Firestore Cloud configurado; verificação real de leitura em andamento.'
    };
  }

  if (config.isProduction) {
    return {
      status: 'unconfigured',
      mode: 'production_missing_credentials',
      message: 'Credenciais de produção do Firestore Admin ausentes.'
    };
  }
  if (isLocalMemoryStoreAllowed()) {
    return {
      status: 'degraded',
      mode: 'memory_sandbox',
      message: 'Executando em sandbox de desenvolvimento com armazenamento local isolado.'
    };
  }
  return { status: 'unconfigured', mode: 'none', message: 'Firestore não configurado.' };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  const safePrefix = String(prefix || 'id').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30) || 'id';
  return `${safePrefix}-${crypto.randomUUID()}`;
}

export function stableId(value: string): string {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function slugify(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `item-${Date.now()}`;
}

const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function deepCleanValue(value: any, depth: number, seen: WeakSet<object>): any {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (depth > 20) throw new RangeError('Objeto excede a profundidade máxima permitida.');
  if (value instanceof Date || value instanceof Timestamp || Buffer.isBuffer(value)) return value;
  if (seen.has(value)) throw new TypeError('Objeto circular não pode ser persistido.');

  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return value;

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value
        .map((item) => deepCleanValue(item, depth + 1, seen))
        .filter((item) => item !== undefined);
    }

    const cleaned: Record<string, any> = {};
    for (const [key, item] of Object.entries(value)) {
      if (UNSAFE_OBJECT_KEYS.has(key)) continue;
      const normalized = deepCleanValue(item, depth + 1, seen);
      if (normalized !== undefined) cleaned[key] = normalized;
    }
    return cleaned;
  } finally {
    seen.delete(value);
  }
}

export function cleanObject<T extends Record<string, any>>(value: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('cleanObject requer um objeto.');
  }
  return deepCleanValue(value, 0, new WeakSet()) as T;
}

function normalizeFirestoreValue(value: any, depth = 0): any {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => normalizeFirestoreValue(item, depth + 1));
  if (!value || typeof value !== 'object' || depth > 20 || Buffer.isBuffer(value)) return value;

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;

  const normalized: Record<string, any> = {};
  for (const [key, item] of Object.entries(value)) {
    normalized[key] = normalizeFirestoreValue(item, depth + 1);
  }
  return normalized;
}

export function docData<T = any>(snapshot: any): T | null {
  if (!snapshot?.exists) return null;
  const raw = snapshot.data() || {};
  return { ...normalizeFirestoreValue(raw), id: snapshot.id } as T;
}

export function queryData<T = any>(snapshot: any): T[] {
  if (!snapshot || !Array.isArray(snapshot.docs)) return [];
  return snapshot.docs.map((doc: any) => docData<T>(doc)).filter((item): item is T => item !== null);
}

function safeAuditText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function redactAuditDetails(value: any, depth = 0): any {
  if (depth > 10) return '[TRUNCATED_DEPTH]';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactAuditDetails(item, depth + 1));
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? value.slice(0, 2000) : value;
  }

  const output: Record<string, any> = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    if (/token|secret|password|authorization|cookie|private.?key|access.?key/i.test(key)) {
      output[key] = '[REDACTED]';
    } else {
      output[key] = redactAuditDetails(item, depth + 1);
    }
  }
  return output;
}

export async function writeAdminLog(data: {
  operatorId: string;
  operatorEmail?: string;
  action: string;
  targetUserId?: string;
  details?: Record<string, any>;
}): Promise<void> {
  const operatorId = safeAuditText(data.operatorId, 200);
  const action = safeAuditText(data.action, 150);
  if (!operatorId || !action) throw new RangeError('Log administrativo requer operador e ação.');

  const details = data.details ? redactAuditDetails(cleanObject(data.details)) : undefined;
  const serializedDetails = details ? JSON.stringify(details) : '';
  const boundedDetails = serializedDetails.length <= 32_000
    ? details
    : { truncated: true, originalDigest: stableId(serializedDetails) };
  const id = newId('adm');

  await firestore().collection(COLLECTIONS.adminLogs).doc(id).create(cleanObject({
    id,
    operatorId,
    operatorEmailHash: data.operatorEmail ? stableId(normalizeEmailForHash(data.operatorEmail)) : undefined,
    action,
    targetUserId: safeAuditText(data.targetUserId, 200) || undefined,
    details: boundedDetails,
    createdAt: nowIso()
  }));
}

function normalizeEmailForHash(value: unknown): string {
  return safeAuditText(value, 320).toLowerCase();
}

export async function createNotification(data: {
  userId: string;
  title: string;
  message: string;
  type: string;
  idempotencyKey?: string;
}): Promise<void> {
  const userId = safeAuditText(data.userId, 200);
  const title = safeAuditText(data.title, 160);
  const message = safeAuditText(data.message, 2000);
  const type = safeAuditText(data.type, 80).toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const idempotencyKey = safeAuditText(data.idempotencyKey, 300);
  if (!userId || !title || !message || !type) {
    throw new RangeError('Notificação requer usuário, título, mensagem e tipo válidos.');
  }

  const db = firestore();
  const id = idempotencyKey
    ? `notif-${stableId(`${userId}:${idempotencyKey}`)}`
    : newId('notif');
  const ref = db.collection(COLLECTIONS.notifications).doc(id);
  const createdAt = nowIso();
  const record = {
    id,
    userId,
    title,
    message,
    type,
    read: false,
    deliveryStatus: 'pending',
    deliveryAttempts: 0,
    nextDeliveryAttemptAt: createdAt,
    idempotencyHash: idempotencyKey ? stableId(idempotencyKey) : null,
    createdAt,
    updatedAt: createdAt
  };

  if (!idempotencyKey) {
    await ref.create(record);
    return;
  }

  await db.runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) return;
    if (typeof transaction.create === 'function') {
      transaction.create(ref, record);
    } else {
      transaction.set(ref, record);
    }
  });
}

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: string;
  retryAfterMs: number;
};

/**
 * Primitiva persistente para rate limiting entre múltiplas instâncias/serverless.
 * A chave é armazenada somente como hash e o contador é atualizado em transação.
 */
export async function consumeRateLimit(data: {
  key: string;
  limit: number;
  windowMs: number;
  cost?: number;
  nowMs?: number;
}): Promise<RateLimitResult> {
  const key = String(data.key || '').trim();
  const limit = Number(data.limit);
  const windowMs = Number(data.windowMs);
  const cost = data.cost === undefined ? 1 : Number(data.cost);
  const nowMs = data.nowMs === undefined ? Date.now() : Number(data.nowMs);
  if (
    !key ||
    key.length > 1000 ||
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    !Number.isSafeInteger(windowMs) ||
    windowMs < 1000 ||
    !Number.isSafeInteger(cost) ||
    cost <= 0 ||
    cost > limit ||
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0
  ) {
    throw new RangeError('Configuração de rate limit inválida.');
  }

  const bucketStart = Math.floor(nowMs / windowMs) * windowMs;
  const resetAtMs = bucketStart + windowMs;
  const keyHash = stableId(key);
  const ref = firestore().collection(COLLECTIONS.rateLimits).doc(stableId(`rate:${keyHash}:${bucketStart}`));

  return firestore().runTransaction(async (transaction: any): Promise<RateLimitResult> => {
    const snapshot = await transaction.get(ref);
    const currentCount = snapshot.exists && Number.isSafeInteger(Number(snapshot.data()?.count))
      ? Math.max(0, Number(snapshot.data().count))
      : 0;
    const nextCount = currentCount + cost;
    const allowed = nextCount <= limit;

    if (allowed) {
      transaction.set(ref, {
        keyHash,
        bucketStart,
        count: nextCount,
        limit,
        expiresAt: new Date(resetAtMs + windowMs).toISOString(),
        updatedAt: nowIso()
      }, { merge: true });
    }

    return {
      allowed,
      limit,
      remaining: Math.max(0, limit - (allowed ? nextCount : currentCount)),
      resetAt: new Date(resetAtMs).toISOString(),
      retryAfterMs: allowed ? 0 : Math.max(0, resetAtMs - nowMs)
    };
  });
}

export { FieldValue };