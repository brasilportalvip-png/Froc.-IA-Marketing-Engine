/** Data, hora e saudação no horário de Brasília (usado pela IA e pela tela inicial). */
export interface BrazilNow {
  weekday: string;
  day: number;
  month: string;
  year: number;
  time: string;
  hour: number;
  greeting: 'Bom dia' | 'Boa tarde' | 'Boa noite';
  longDate: string;
}

const TZ = 'America/Sao_Paulo';

export function greetingForHour(hour: number): BrazilNow['greeting'] {
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function brazilNow(date: Date = new Date()): BrazilNow {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  ) as Record<string, string>;
  const hour = Number(parts.hour) % 24;
  const time = `${String(hour).padStart(2, '0')}:${parts.minute}`;
  const day = Number(parts.day);
  const year = Number(parts.year);
  return {
    weekday: parts.weekday,
    day,
    month: parts.month,
    year,
    time,
    hour,
    greeting: greetingForHour(hour),
    longDate: `${parts.weekday}, ${day} de ${parts.month} de ${year}`
  };
}

/** Primeiro nome, com a primeira letra maiúscula ("maria silva" → "Maria"). */
export function firstName(name?: string | null): string {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  if (!first || /@/.test(first)) return '';
  return first.charAt(0).toLocaleUpperCase('pt-BR') + first.slice(1).toLocaleLowerCase('pt-BR');
}
