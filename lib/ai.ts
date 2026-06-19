import type { GeneratedFlashcard, TranscriptSegment } from './types';

// Per-chunk character budget. Kept small so each prompt fits the on-device
// model's modest context window.
const MAX_TRANSCRIPT_LENGTH = 6000;
// Upper bound on AI calls per generation, so very long videos stay responsive.
const MAX_AI_CHUNKS = 6;

export type AIBackend = 'chrome-ai' | 'rule-based';

/**
 * Splits a transcript into windows that together cover the whole video while
 * keeping each window within MAX_TRANSCRIPT_LENGTH (so it fits the on-device
 * model). When the transcript is short enough to cover contiguously within
 * MAX_AI_CHUNKS windows it does so; longer transcripts get up to MAX_AI_CHUNKS
 * evenly-spaced windows so coverage still spans the entire video. Windows snap
 * to word boundaries.
 */
export function chunkTranscript(
  text: string,
  budget = MAX_TRANSCRIPT_LENGTH,
  maxChunks = MAX_AI_CHUNKS
): string[] {
  const clean = text.trim();
  if (clean.length <= budget) return clean ? [clean] : [];

  const count = Math.min(Math.ceil(clean.length / budget), maxChunks);
  const step = (clean.length - budget) / (count - 1);

  const chunks: string[] = [];
  for (let i = 0; i < count; i++) {
    const window = wordWindow(clean, Math.round(i * step), budget);
    if (window) chunks.push(window);
  }
  return chunks;
}

function wordWindow(text: string, start: number, budget: number): string {
  let s = start;
  if (s > 0) {
    const sp = text.indexOf(' ', s);
    if (sp !== -1 && sp - s < 80) s = sp + 1;
  }
  let end = Math.min(s + budget, text.length);
  if (end < text.length) {
    const sp = text.lastIndexOf(' ', end);
    if (sp > s) end = sp;
  }
  return text.slice(s, end).trim();
}

/**
 * Splits a total card count into `buckets` per-chunk counts that sum to the
 * total, spreading any remainder across evenly-spaced buckets so coverage isn't
 * front-loaded.
 */
export function distributeCounts(total: number, buckets: number): number[] {
  if (buckets <= 0) return [];
  const counts = new Array(buckets).fill(Math.floor(total / buckets));
  let remainder = total % buckets;
  if (remainder > 0) {
    const stride = buckets / remainder;
    for (let k = 0; k < remainder; k++) counts[Math.floor(k * stride)]++;
  }
  return counts;
}

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
  const chunks = chunkTranscript(transcript);
  const perChunk = distributeCounts(cardCount, chunks.length);

  const collected: GeneratedFlashcard[] = [];
  for (let i = 0; i < chunks.length; i++) {
    if (perChunk[i] <= 0) continue;
    try {
      const cards = await generateChunkWithChromeAI(
        chunks[i],
        videoTitle,
        channel,
        perChunk[i],
        i,
        chunks.length
      );
      collected.push(...cards);
    } catch {
      // Skip this chunk; other chunks may still produce cards.
    }
  }

  if (collected.length === 0) {
    throw new Error('Chrome AI returned no cards');
  }
  return collected.slice(0, cardCount);
}

async function generateChunkWithChromeAI(
  transcriptChunk: string,
  videoTitle: string,
  channel: string,
  cardCount: number,
  index: number,
  total: number
): Promise<GeneratedFlashcard[]> {
  const session = await LanguageModel.create({
    expectedOutputLanguages: ['en'],
    initialPrompts: [
      {
        role: 'system',
        content: `You generate flashcards from YouTube video transcripts. Output ONLY a JSON array, no other text. Each item: {"question":"...","answer":"...","timestamp":0,"topic":"..."}`,
      },
    ],
  });

  const sectionNote =
    total > 1 ? ` (section ${index + 1} of ${total} of the video)` : '';

  const prompt = `Video: "${videoTitle}" by ${channel}${sectionNote}

Transcript:
${transcriptChunk}

Generate exactly ${cardCount} flashcards as a JSON array. Each should test understanding, be self-contained, include an approximate timestamp in seconds, and cover the most important concepts in this transcript. Vary types: definitions, applications, comparisons, facts. Keep answers to 1-2 sentences.

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
  // Group caption segments into bite-sized units. We close a unit either at a
  // real sentence boundary (.!? — for manually-punctuated captions) or once it
  // reaches a word cap. The word cap is essential because YouTube's
  // auto-generated captions have NO punctuation: without it every segment would
  // merge into one giant run-on "sentence" stamped at time 0, yielding a single
  // useless card. Each unit keeps the start time of its first segment.
  const MIN_WORDS = 4;
  const MAX_WORDS = 22;

  const units: { text: string; timestamp: number }[] = [];
  let text = '';
  let start: number | null = null;
  let words = 0;

  const flush = () => {
    const trimmed = text.trim();
    if (trimmed.length > 0 && start !== null) {
      units.push({ text: trimmed, timestamp: start });
    }
    text = '';
    start = null;
    words = 0;
  };

  for (const seg of segments) {
    const piece = seg.text.trim();
    if (!piece) continue;
    if (start === null) start = seg.start;
    text += (text ? ' ' : '') + piece;
    words += piece.split(/\s+/).length;

    const endsSentence = /[.!?]["')\]]?$/.test(text);
    if ((endsSentence && words >= MIN_WORDS) || words >= MAX_WORDS) {
      flush();
    }
  }
  flush();

  // Split any unit that still holds multiple punctuated sentences so each card
  // targets a single idea.
  const sentences: { text: string; timestamp: number }[] = [];
  for (const unit of units) {
    const parts = unit.text.split(/(?<=[.!?])\s+/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.length > 15) {
        sentences.push({ text: trimmed, timestamp: unit.timestamp });
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
