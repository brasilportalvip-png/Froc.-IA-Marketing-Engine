export function selectPreferredMalePortugueseVoice(
  voices: SpeechSynthesisVoice[]
) {
  const portuguese = voices.filter((v) =>
    /^pt(?:-|_)/i.test(v.lang)
  );

  return (
    portuguese.find((v) =>
      /\b(male|masculin|daniel|felipe|ricardo|tiago|antonio|paulo|carlos)\b/i.test(
        v.name
      )
    ) ||
    portuguese.find((v) =>
      /pt-BR/i.test(v.lang)
    ) ||
    portuguese[0]
  );
}

/** Converts markdown-heavy answers into text that browser voices can read naturally. */
export function normalizeTextForSpeech(
  text: string
): string {
  return text
    .replace(
      /```[\s\S]*?```/g,
      ' Trecho de código omitido na leitura. '
    )
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/[>*_~]/g, '')
    .replace(
      /https?:\/\/\S+/g,
      ' link disponível na tela '
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Chrome may silently stop very long SpeechSynthesis utterances. Keeping chunks
 * sentence-aware makes playback reliable while preserving a natural cadence.
 */
export function splitTextForSpeech(
  text: string,
  maxLength = 220
): string[] {
  const normalized =
    normalizeTextForSpeech(text);

  if (!normalized) {
    return [];
  }

  const sentences =
    normalized.match(
      /[^.!?]+[.!?]+|[^.!?]+$/g
    ) || [normalized];

  const chunks: string[] = [];
  let current = '';

  const push = () => {
    const value = current.trim();

    if (value) {
      chunks.push(value);
    }

    current = '';
  };

  for (const sentenceValue of sentences) {
    const sentence =
      sentenceValue.trim();

    if (!sentence) {
      continue;
    }

    if (
      `${current} ${sentence}`.trim()
        .length <= maxLength
    ) {
      current =
        `${current} ${sentence}`.trim();

      continue;
    }

    push();

    if (sentence.length <= maxLength) {
      current = sentence;
      continue;
    }

    const words =
      sentence.split(/\s+/);

    for (const word of words) {
      if (
        `${current} ${word}`.trim()
          .length > maxLength
      ) {
        push();
      }

      current =
        `${current} ${word}`.trim();
    }
  }

  push();

  return chunks;
}

/**
 * Keeps the opening phrase intentionally short so neural playback can begin
 * quickly, then uses larger chunks that can be prepared while audio is playing.
 */
export function splitTextForProgressiveSpeech(
  text: string,
  firstChunkLength = 150,
  followingChunkLength = 380
): string[] {
  const firstPass =
    splitTextForSpeech(
      text,
      firstChunkLength
    );

  if (firstPass.length <= 1) {
    return firstPass;
  }

  const [first, ...remaining] =
    firstPass;

  const following =
    splitTextForSpeech(
      remaining.join(' '),
      followingChunkLength
    );

  return [
    first,
    ...following
  ];
}

/** Returns a stable opening prefix as soon as there is enough text to speak. */
export function getProgressiveSpeechOpening(
  text: string,
  minLength = 45,
  maxLength = 90
): string {
  const normalized =
    normalizeTextForSpeech(text);

  if (!normalized) {
    return '';
  }

  const sentenceEnd =
    normalized.search(
      /[.!?](?:\s|$)/
    );

  if (sentenceEnd >= 0) {
    return normalized
      .slice(
        0,
        sentenceEnd + 1
      )
      .trim();
  }

  if (
    normalized.length <
    minLength
  ) {
    return '';
  }

  const candidate =
    normalized.slice(
      0,
      maxLength
    );

  const lastSpace =
    candidate.lastIndexOf(' ');

  return (
    lastSpace >= minLength
      ? candidate.slice(
          0,
          lastSpace
        )
      : candidate
  ).trim();
}