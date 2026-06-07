import type { GeneratedFlashcard, TranscriptSegment } from './types';

const MAX_TRANSCRIPT_LENGTH = 6000;

export type AIBackend = 'chrome-ai' | 'rule-based';

export async function checkChromeAIAvailability(): Promise<boolean> {
  try {
    if (typeof LanguageModel === 'undefined') return false;
    const availability = await LanguageModel.availability();
    return availability === 'available' || availability === 'downloadable';
  } catch {
    return false;
  }
}

export async function generateFlashcards(
  transcript: string,
  videoTitle: string,
  channel: string,
  cardCount: number,
  segments: TranscriptSegment[]
): Promise<{ flashcards: GeneratedFlashcard[]; backend: AIBackend }> {
  const aiAvailable = await checkChromeAIAvailability();

  if (aiAvailable) {
    try {
      const flashcards = await generateWithChromeAI(
        transcript,
        videoTitle,
        channel,
        cardCount
      );
      return { flashcards, backend: 'chrome-ai' };
    } catch {
      // Fall through to rule-based
    }
  }

  const flashcards = generateWithRules(segments, videoTitle, cardCount);
  return { flashcards, backend: 'rule-based' };
}

async function generateWithChromeAI(
  transcript: string,
  videoTitle: string,
  channel: string,
  cardCount: number
): Promise<GeneratedFlashcard[]> {
  const trimmed = transcript.slice(0, MAX_TRANSCRIPT_LENGTH);

  const session = await LanguageModel.create({
    initialPrompts: [
      {
        role: 'system',
        content: `You generate flashcards from YouTube video transcripts. Output ONLY a JSON array, no other text. Each item: {"question":"...","answer":"...","timestamp":0,"topic":"..."}`,
      },
    ],
  });

  const prompt = `Video: "${videoTitle}" by ${channel}

Transcript:
${trimmed}

Generate exactly ${cardCount} flashcards as a JSON array. Each should test understanding, be self-contained, include an approximate timestamp in seconds, and cover the most important concepts. Vary types: definitions, applications, comparisons, facts. Keep answers to 1-2 sentences.

Return ONLY the JSON array:`;

  const result = await session.prompt(prompt);
  session.destroy();
  return parseAIResponse(result);
}

function parseAIResponse(text: string): GeneratedFlashcard[] {
  let jsonStr = text.trim();

  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    jsonStr = arrayMatch[0];
  }

  const parsed = JSON.parse(jsonStr);
  if (!Array.isArray(parsed)) {
    throw new Error('AI response is not an array');
  }

  return parsed.map((item: Record<string, unknown>) => ({
    question: String(item.question || ''),
    answer: String(item.answer || ''),
    timestamp: Number(item.timestamp || 0),
    topic: String(item.topic || ''),
  }));
}

// ── Rule-based fallback ─────────────────────────────────────────────

interface ScoredSentence {
  text: string;
  timestamp: number;
  score: number;
  topic: string;
}

const DEFINITION_PATTERNS = [
  /\b(?:is|are|was|were)\s+(?:a|an|the)\b/i,
  /\b(?:means?|refers?\s+to|defined?\s+as|known\s+as)\b/i,
  /\b(?:called|termed|named)\b/i,
];

const KEY_PHRASE_PATTERNS = [
  /\b(?:important|key|critical|essential|fundamental|crucial|significant)\b/i,
  /\b(?:remember|note\s+that|keep\s+in\s+mind)\b/i,
  /\b(?:first|second|third|finally|in\s+conclusion)\b/i,
  /\b(?:for\s+example|such\s+as|like|including)\b/i,
  /\b(?:because|therefore|as\s+a\s+result|consequently)\b/i,
  /\b(?:however|but|although|in\s+contrast|unlike)\b/i,
  /\b(?:the\s+(?:main|biggest|most)\s+\w+\s+is)\b/i,
  /\b(?:percent|%|\d+\s+(?:million|billion|thousand))\b/i,
];

function scoreSentence(sentence: string): { score: number; topic: string } {
  let score = 0;
  let topic = '';

  for (const pattern of DEFINITION_PATTERNS) {
    if (pattern.test(sentence)) {
      score += 3;
      break;
    }
  }

  for (const pattern of KEY_PHRASE_PATTERNS) {
    if (pattern.test(sentence)) {
      score += 2;
    }
  }

  const words = sentence.split(/\s+/).length;
  if (words >= 8 && words <= 40) {
    score += 2;
  } else if (words < 5 || words > 60) {
    score -= 3;
  }

  if (/\d/.test(sentence)) score += 1;

  const capsWords = sentence.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g);
  if (capsWords && capsWords.length > 0) {
    topic = capsWords[0];
  }

  return { score, topic };
}

function segmentsToSentences(
  segments: TranscriptSegment[]
): { text: string; timestamp: number }[] {
  const fullText = segments
    .map((s) => ({ text: s.text, ts: s.start }))
    .reduce(
      (acc, seg) => {
        if (acc.length === 0) return [seg];
        const last = acc[acc.length - 1];
        if (!last.text.match(/[.!?]$/)) {
          last.text += ' ' + seg.text;
          return acc;
        }
        acc.push(seg);
        return acc;
      },
      [] as { text: string; ts: number }[]
    );

  const sentences: { text: string; timestamp: number }[] = [];
  for (const chunk of fullText) {
    const parts = chunk.text.split(/(?<=[.!?])\s+/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.length > 15) {
        sentences.push({ text: trimmed, timestamp: chunk.ts });
      }
    }
  }
  return sentences;
}

function makeDefinitionCard(sentence: string, timestamp: number, topic: string): GeneratedFlashcard {
  const defMatch = sentence.match(
    /^(.+?)\s+(?:is|are|was|were|means?|refers?\s+to)\s+(.+)/i
  );
  if (defMatch) {
    const subject = defMatch[1].replace(/^(?:a|an|the)\s+/i, '').trim();
    return {
      question: `What is ${subject}?`,
      answer: sentence,
      timestamp,
      topic: topic || subject.split(/\s+/).slice(0, 3).join(' '),
    };
  }
  return makeGenericCard(sentence, timestamp, topic);
}

function makeComparisonCard(sentence: string, timestamp: number, topic: string): GeneratedFlashcard {
  return {
    question: `What contrast or distinction is made in this statement: "${truncate(sentence, 80)}"?`,
    answer: sentence,
    timestamp,
    topic,
  };
}

function makeGenericCard(sentence: string, timestamp: number, topic: string): GeneratedFlashcard {
  const words = sentence.split(/\s+/);
  const keyPhrase = words.slice(0, Math.min(6, words.length)).join(' ');

  return {
    question: `What key point is made about "${truncate(keyPhrase, 50)}"?`,
    answer: sentence,
    timestamp,
    topic: topic || words.slice(0, 3).join(' '),
  };
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

function generateWithRules(
  segments: TranscriptSegment[],
  videoTitle: string,
  cardCount: number
): GeneratedFlashcard[] {
  const sentences = segmentsToSentences(segments);

  const scored: ScoredSentence[] = sentences.map((s) => {
    const { score, topic } = scoreSentence(s.text);
    return { text: s.text, timestamp: s.timestamp, score, topic };
  });

  scored.sort((a, b) => b.score - a.score);

  const selected: ScoredSentence[] = [];
  const usedTimestamps = new Set<number>();

  const lastSeg = segments[segments.length - 1];
  const totalDuration = lastSeg ? lastSeg.start + lastSeg.duration : 0;
  const minSpacing = Math.max(5, totalDuration / (cardCount * 2));

  for (const s of scored) {
    if (selected.length >= cardCount) break;

    const nearbyUsed = [...usedTimestamps].some(
      (t) => Math.abs(t - s.timestamp) < minSpacing
    );
    if (nearbyUsed && selected.length > cardCount / 2) continue;

    selected.push(s);
    usedTimestamps.add(s.timestamp);
  }

  selected.sort((a, b) => a.timestamp - b.timestamp);

  return selected.map((s) => {
    if (DEFINITION_PATTERNS.some((p) => p.test(s.text))) {
      return makeDefinitionCard(s.text, s.timestamp, s.topic);
    }
    if (/\b(?:however|but|although|in\s+contrast|unlike)\b/i.test(s.text)) {
      return makeComparisonCard(s.text, s.timestamp, s.topic);
    }
    return makeGenericCard(s.text, s.timestamp, s.topic);
  });
}
