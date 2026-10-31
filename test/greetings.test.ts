import test from 'node:test';
import assert from 'node:assert/strict';
import { brazilNow, firstName, greetingForHour } from '../shared/brazilTime.js';
import { conciergeChat } from '../server/production/concierge.js';
import { resetMemoryDb } from '../server/production/store.js';

test('Horário de Brasília: data por extenso, hora e saudação corretas', () => {
  const morning = brazilNow(new Date('2026-10-30T12:30:00Z')); // 09:30 em Brasília
  assert.equal(morning.time, '09:30');
  assert.equal(morning.greeting, 'Bom dia');
  assert.equal(morning.weekday, 'sexta-feira');
  assert.equal(morning.month, 'outubro');
  assert.equal(morning.longDate, 'sexta-feira, 30 de outubro de 2026');
  assert.equal(brazilNow(new Date('2026-10-30T17:00:00Z')).greeting, 'Boa tarde'); // 14:00
  assert.equal(brazilNow(new Date('2026-10-31T01:09:00Z')).greeting, 'Boa noite'); // 22:09 do dia 30
  assert.equal(brazilNow(new Date('2026-10-31T01:09:00Z')).day, 30);
  assert.equal(greetingForHour(4), 'Boa noite');
  assert.equal(greetingForHour(5), 'Bom dia');
  assert.equal(greetingForHour(12), 'Boa tarde');
  assert.equal(greetingForHour(18), 'Boa noite');
});

test('Nome: usa o primeiro nome com letra maiúscula e ignora e-mails', () => {
  assert.equal(firstName('maria SILVA'), 'Maria');
  assert.equal(firstName('  joão  '), 'João');
  assert.equal(firstName('fulano@email.com'), '');
  assert.equal(firstName(undefined), '');
});

test('Froc.IA cumprimenta pelo nome e pelo horário na primeira resposta', async () => {
  resetMemoryDb();
  const night = new Date('2026-10-31T01:09:00Z'); // 22:09 em Brasília
  const turn = await conciergeChat({ messages: [{ role: 'user', content: 'oi' }], authenticated: true, userName: 'maria silva', now: night });
  assert.match(turn.reply, /^Boa noite, Maria!/);
  assert.equal(turn.collected.customerName, 'Maria');

  const anonymous = await conciergeChat({ messages: [{ role: 'user', content: 'oi' }], authenticated: false, now: new Date('2026-10-30T12:00:00Z') });
  assert.match(anonymous.reply, /^Bom dia!/);

  const later = await conciergeChat({
    messages: [{ role: 'user', content: 'oi' }, { role: 'assistant', content: 'Boa noite, Maria!' }, { role: 'user', content: 'tenho uma pizzaria' }],
    authenticated: true, userName: 'Maria', now: night
  });
  assert.doesNotMatch(later.reply, /^Boa noite/, 'não repete a saudação no meio da conversa');
});
