import test from 'node:test';
import assert from 'node:assert/strict';
import { COLLECTIONS, firestore, queryData, resetMemoryDb } from '../server/production/store.js';
import { buildHumanizedSpeechPrompt, cleanSpeechText, createLiveTranscriptionToken, LIVE_TRANSCRIBE_MODEL, pcm16ToWavBase64, synthesizeSpeech, synthesizeSpeechStream } from '../server/production/speech.js';
import { listAllPublicPosts } from '../server/production/posts.js';
import { addCredits, getWallet, removeCreditsAdmin } from '../server/production/credits.js';
import { renderPublicPage } from '../server/production/publicPages.js';
import { buildSitemapTxt, buildRobotsTxt } from '../server/production/seoEngine.js';
import { classifyFrocVoiceTranscript, classifyFrocMobileVoiceTranscript, hasFrocWakePhrase } from '../src/lib/voice/voiceCommands.js';
import { normalizeTextForSpeech, splitTextForSpeech } from '../src/lib/voice/voiceText.js';
import { config } from '../server/config/index.js';

test('Voz: texto é saneado e o prompt mantém a persona calorosa do Froc IA', () => {
  assert.equal(cleanSpeechText('  Olá\u0000 <fala>mundo</fala>  '), 'Olá mundo');
  const prompt = buildHumanizedSpeechPrompt('Bem-vindo ao Froc.IA');
  assert.match(prompt, /voz masculina adulta, natural, calorosa/);
  assert.match(prompt, /<fala>Bem-vindo ao Froc\.IA<\/fala>/);
  assert.throws(() => buildHumanizedSpeechPrompt('   '), /speech_text_empty/);
  assert.equal(cleanSpeechText('x'.repeat(6000)).length, 5000);
});

test('Voz: cabeçalho WAV PCM 16-bit 24 kHz mono válido', () => {
  const wav = Buffer.from(pcm16ToWavBase64(Buffer.alloc(480).toString('base64')), 'base64');
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), 480);
  assert.equal(wav.length, 44 + 480);
});

test('Voz: síntese, streaming e token Live funcionam sem chamar o provedor em teste', async () => {
  const full = await synthesizeSpeech('Teste de voz');
  assert.equal(full.mimeType, 'audio/wav');
  assert.ok(full.audioBase64.length > 50);
  const chunks: Buffer[] = [];
  for await (const chunk of synthesizeSpeechStream('Teste de voz')) chunks.push(chunk);
  assert.ok(chunks.length >= 1 && chunks[0].length % 2 === 0);
  const token = await createLiveTranscriptionToken();
  assert.equal(token.model, LIVE_TRANSCRIBE_MODEL);
  assert.ok(token.token.startsWith('auth_tokens/'));
});

test('Voz: comandos "Ok, Froc" e "pare" como no Froc IA', () => {
  assert.equal(hasFrocWakePhrase('ok froc crie um anúncio'), true);
  assert.deepEqual(classifyFrocVoiceTranscript('Ok Froc, quero mais clientes', true, false), { type: 'command', command: 'quero mais clientes' });
  assert.deepEqual(classifyFrocVoiceTranscript('quero mais clientes', true, true), { type: 'command', command: 'quero mais clientes' });
  assert.equal(classifyFrocVoiceTranscript('quero mais clientes', true, false).type, 'none');
  assert.equal(classifyFrocVoiceTranscript('pare', true, true).type, 'stop');
  assert.equal(classifyFrocMobileVoiceTranscript('quero vender no meu bairro', true).type, 'command');
  assert.equal(normalizeTextForSpeech('## Título\n**forte** [link](https://x.com)'), 'Título forte link');
  assert.ok(splitTextForSpeech('Frase um. '.repeat(80), 220).every((chunk) => chunk.length <= 220));
});

test('Posts: janela reúne Magazine e Vitrine, só públicos, do mais novo ao mais antigo', async () => {
  resetMemoryDb();
  const db = firestore();
  await db.collection(COLLECTIONS.companies).doc('c1').set({ id: 'c1', name: 'Marca Pública', slug: 'marca-publica', isPublicInVitrine: true });
  await db.collection(COLLECTIONS.companies).doc('c2').set({ id: 'c2', name: 'Marca Oculta', slug: 'marca-oculta', isPublicInVitrine: false });
  await db.collection(COLLECTIONS.blogPosts).doc('b1').set({ id: 'b1', title: 'Artigo SEO', slug: 'artigo-seo', status: 'published', publishedAt: '2026-10-29T10:00:00.000Z' });
  await db.collection(COLLECTIONS.blogPosts).doc('b2').set({ id: 'b2', title: 'Rascunho', slug: 'rascunho', status: 'draft', publishedAt: '2026-10-31T10:00:00.000Z' });
  await db.collection(COLLECTIONS.vitrinePosts).doc('v1').set({ id: 'v1', companyId: 'c1', title: 'Post da vitrine', slug: 'post-vitrine', status: 'published', publishedAt: '2026-10-30T10:00:00.000Z' });
  await db.collection(COLLECTIONS.vitrinePosts).doc('v2').set({ id: 'v2', companyId: 'c2', title: 'Post oculto', slug: 'post-oculto', status: 'published', publishedAt: '2026-10-30T11:00:00.000Z' });
  await db.collection(COLLECTIONS.vitrinePosts).doc('v3').set({ id: 'v3', companyId: 'c1', title: 'Arquivado', slug: 'arquivado', status: 'archived', publishedAt: '2026-10-30T12:00:00.000Z' });

  const posts = await listAllPublicPosts();
  assert.deepEqual(posts.map((p) => p.title), ['Post da vitrine', 'Artigo SEO']);
  assert.equal(posts[0].path, '/vitrine/marca-publica/post-vitrine');
  assert.equal(posts[1].path, '/blog/artigo-seo');

  const page = await renderPublicPage('/posts');
  assert.equal(page.status, 200);
  assert.match(page.html, /"@type":"CollectionPage"/);
  assert.ok(page.html.includes('/vitrine/marca-publica/post-vitrine'));
  assert.ok(!page.html.includes('post-oculto'));
  assert.ok((await buildSitemapTxt()).includes(`${config.appUrl.replace(/\/$/, '')}/posts`));
  assert.match(buildRobotsTxt(), /Allow: \/posts/);
});

test('Admin: remoção de créditos é auditada, não fica negativa e respeita reservas', async () => {
  resetMemoryDb();
  await addCredits({ userId: 'u_admin_test', amount: 100, type: 'admin_adjustment', source: 'teste' });
  const after = await removeCreditsAdmin({ userId: 'u_admin_test', amount: 30, reason: 'ajuste', operatorId: 'adm1' });
  assert.equal(after.balance, 70);
  await assert.rejects(() => removeCreditsAdmin({ userId: 'u_admin_test', amount: 71, reason: 'x', operatorId: 'adm1' }), /insuficiente/);
  await assert.rejects(() => removeCreditsAdmin({ userId: 'u_admin_test', amount: 0, reason: 'x', operatorId: 'adm1' }));
  assert.equal((await getWallet('u_admin_test')).balance, 70);
  const txs = queryData<any>(await firestore().collection(COLLECTIONS.creditTransactions).where('userId', '==', 'u_admin_test').get());
  const debit = txs.find((t) => t.amount === -30);
  assert.ok(debit);
  assert.equal(debit.metadata.operatorId, 'adm1');
});

test('Post diário do site: auto blog ligado em produção e desligado nos testes', () => {
  assert.equal(config.blog.autoEnabled, false);
});
