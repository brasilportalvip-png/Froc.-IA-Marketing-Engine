/**
 * Conversas do chat Froc.IA: cada usuário logado vê o histórico, abre, fecha
 * (encerra e fica só para leitura) ou exclui as conversas.
 */
import { COLLECTIONS, firestore, newId, nowIso, queryData } from './store.js';
import type { ChatMessage } from './concierge.js';

const MAX_MESSAGES = 200;

function titleFrom(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user')?.content || 'Nova conversa';
  const clean = first.replace(/\s+/g, ' ').trim();
  return clean.length > 60 ? `${clean.slice(0, 57)}...` : clean;
}

function httpError(message: string, statusCode: number) {
  const error: any = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function owned(userId: string, id: string) {
  const ref = firestore().collection(COLLECTIONS.conversations).doc(String(id).slice(0, 200));
  const snap = await ref.get();
  if (!snap.exists || (snap.data() as any).userId !== userId) throw httpError('Conversa não encontrada.', 404);
  return { ref, data: { id: snap.id, ...snap.data() } as any };
}

export async function listConversations(userId: string) {
  const snap = await firestore().collection(COLLECTIONS.conversations).where('userId', '==', userId).get();
  return queryData<any>(snap)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, 100)
    .map((c) => ({ id: c.id, title: c.title, status: c.status, messageCount: Array.isArray(c.messages) ? c.messages.length : 0, lastMessage: Array.isArray(c.messages) && c.messages.length ? String(c.messages[c.messages.length - 1].content || '').slice(0, 120) : '', createdAt: c.createdAt, updatedAt: c.updatedAt }));
}

export async function getConversation(userId: string, id: string) {
  return (await owned(userId, id)).data;
}

/** Salva a pergunta + resposta. Conversa fechada não recebe mensagens novas. */
export async function saveConversationTurn(data: { userId: string; conversationId?: string; messages: ChatMessage[]; reply: string; collected?: any }): Promise<string> {
  const now = nowIso();
  const all = [...data.messages, { role: 'assistant' as const, content: data.reply }].slice(-MAX_MESSAGES);
  if (data.conversationId) {
    const { ref, data: current } = await owned(data.userId, data.conversationId);
    if (current.status === 'closed') throw httpError('Esta conversa foi fechada. Comece uma nova conversa.', 409);
    await ref.set({ messages: all, collected: data.collected || current.collected || null, updatedAt: now }, { merge: true });
    return current.id;
  }
  const id = newId('conv');
  await firestore().collection(COLLECTIONS.conversations).doc(id).set({ id, userId: data.userId, title: titleFrom(all), status: 'open', messages: all, collected: data.collected || null, createdAt: now, updatedAt: now });
  return id;
}

export async function closeConversation(userId: string, id: string) {
  const { ref } = await owned(userId, id);
  await ref.set({ status: 'closed', closedAt: nowIso(), updatedAt: nowIso() }, { merge: true });
}

export async function deleteConversation(userId: string, id: string) {
  const { ref } = await owned(userId, id);
  await ref.delete();
}
