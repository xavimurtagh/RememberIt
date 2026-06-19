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
      const raw = await generateWithChromeAI(
        transcript,
        videoTitle,
        channel,
        cardCount
      );
      const flashcards = finalizeCards(raw, cardCount);
      if (flashcards.length > 0) return { flashcards, backend: 'chrome-ai' };
    } catch {
      // Fall through to rule-based
    }
  }

  const raw = generateWithRules(segments, videoTitle, cardCount);
  return { flashcards: finalizeCards(raw, cardCount), backend: 'rule-based' };
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
  // Trimming/dedup happens in finalizeCards so it has all candidates to work with.
  return collected;
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
  return (
    makeClozeCard(sentence, timestamp, topic) ||
    makeGenericCard(sentence, timestamp, topic)
  );
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
  const subject = firstContentPhrase(sentence, 3);
  return {
    question: subject
      ? `What does the video say about ${subject}?`
      : `Recall the key point: "${truncate(sentence, 80)}"`,
    answer: sentence,
    timestamp,
    topic: topic || subject,
  };
}

/**
 * Builds a cloze (fill-in-the-blank) card by blanking the most salient term in
 * a sentence — a number/quantity, a proper noun, or the most specific content
 * word. Returns null when no good blank exists, so the caller can fall back to
 * another card style. Cloze cards make far better recall prompts than the
 * generic "what key point is made about…" template.
 */
function makeClozeCard(
  sentence: string,
  timestamp: number,
  topic: string
): GeneratedFlashcard | null {
  const term = pickClozeTerm(sentence);
  if (!term) return null;

  const pattern = new RegExp(`\\b${escapeRegExp(term)}\\b`);
  if (!pattern.test(sentence)) return null;
  const blanked = sentence.replace(pattern, '_____');
  if (blanked === sentence || !blanked.includes('_____')) return null;

  return {
    question: `Fill in the blank: ${blanked}`,
    answer: term,
    timestamp,
    topic: topic || deriveTopic(sentence),
  };
}

function pickClozeTerm(sentence: string): string | null {
  // 1. A number or quantity makes the cleanest, least-ambiguous blank.
  const num = sentence.match(
    /\b\d[\d,.]*(?:\s?(?:%|percent|million|billion|thousand|years?|hours?|minutes?|seconds?|days?|weeks?|months?|km|kilometers?|miles?|dollars?))?/i
  );
  if (num && num[0].trim().length >= 1) return num[0].trim();

  // 2. A proper noun or acronym (capitalised, but not the first word).
  const tokens = sentence.split(/\s+/);
  for (let i = 1; i < tokens.length; i++) {
    const w = tokens[i].replace(/[^A-Za-z'-]/g, '');
    if (/^[A-Z][a-z]{2,}$/.test(w) && !STOPWORDS.has(w.toLowerCase())) return w;
    if (/^[A-Z]{2,6}$/.test(w)) return w;
  }

  // 3. The most specific content word (longest non-stopword).
  let best = '';
  for (const raw of tokens) {
    const w = raw.replace(/[^A-Za-z'-]/g, '');
    if (w.length < 7 || STOPWORDS.has(w.toLowerCase())) continue;
    if (w.length > best.length) best = w;
  }
  return best || null;
}

function firstContentPhrase(sentence: string, maxWords: number): string {
  const words = sentence
    .replace(/[^A-Za-z0-9'\s-]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w.toLowerCase()));
  return words.slice(0, maxWords).join(' ');
}

function deriveTopic(sentence: string): string {
  const proper = sentence.match(/\b[A-Z][a-z]{2,}\b/);
  if (proper) return proper[0];
  return firstContentPhrase(sentence, 2);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Quality pass (filter, dedupe, exact count) ──────────────────────

const STOPWORDS = new Set(
  (
    'the a an and or but if then else than that this these those of to in on at ' +
    'for with as is are was were be been being it its they them their there here ' +
    'he she we you i his her our your my me us do does did have has had will would ' +
    'can could should may might must not no so such very more most some any all ' +
    'each every which who whom whose what when where why how about into over under ' +
    'again once also just only because therefore however from by'
  ).split(/\s+/)
);

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokenSet(text: string): Set<string> {
  return new Set(normalizeText(text).split(/\s+/).filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

/** Drops empty, self-answering, or runaway cards. */
function isUsableCard(card: GeneratedFlashcard): boolean {
  const q = (card.question || '').trim();
  const a = (card.answer || '').trim();
  if (!q || !a) return false;
  if (!/[a-z0-9]/i.test(q) || !/[a-z0-9]/i.test(a)) return false;
  if (normalizeText(q) === normalizeText(a)) return false;
  if (a.split(/\s+/).length > 80) return false;
  return true;
}

/** Removes cards whose question is (near-)identical to one already kept. */
function dedupeCards(cards: GeneratedFlashcard[]): GeneratedFlashcard[] {
  const kept: GeneratedFlashcard[] = [];
  const keptQuestionTokens: Set<string>[] = [];
  const keptAnswers = new Set<string>();

  for (const card of cards) {
    const qNorm = normalizeText(card.question);
    const qTokens = tokenSet(card.question);
    const aNorm = normalizeText(card.answer);
    const answerSubstantial = card.answer.trim().split(/\s+/).length >= 4;

    const duplicate =
      kept.some((k) => normalizeText(k.question) === qNorm) ||
      keptQuestionTokens.some((tokens) => jaccard(tokens, qTokens) >= 0.82) ||
      (answerSubstantial && keptAnswers.has(aNorm));

    if (duplicate) continue;

    kept.push(card);
    keptQuestionTokens.push(qTokens);
    if (answerSubstantial) keptAnswers.add(aNorm);
  }
  return kept;
}

/**
 * Final quality pass applied to every backend: drop degenerate cards, remove
 * near-duplicates, cap to the requested count (keeping the highest-priority
 * cards, which are listed first), then order by position in the video.
 */
export function finalizeCards(
  cards: GeneratedFlashcard[],
  cardCount: number
): GeneratedFlashcard[] {
  const deduped = dedupeCards(cards.filter(isUsableCard));
  const limited =
    deduped.length > cardCount ? deduped.slice(0, cardCount) : deduped;
  return limited.sort((a, b) => a.timestamp - b.timestamp);
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

  // Over-generate candidates (best-scored first) so the quality pass can drop
  // duplicates/low-value cards and still reach the requested count. Ordering is
  // left by score; finalizeCards trims then sorts by timestamp.
  const target = Math.min(
    scored.length,
    Math.max(cardCount + 3, Math.ceil(cardCount * 1.5))
  );

  const selected: ScoredSentence[] = [];
  const usedTimestamps = new Set<number>();

  const lastSeg = segments[segments.length - 1];
  const totalDuration = lastSeg ? lastSeg.start + lastSeg.duration : 0;
  const minSpacing = Math.max(5, totalDuration / (cardCount * 2));

  for (const s of scored) {
    if (selected.length >= target) break;

    const nearbyUsed = [...usedTimestamps].some(
      (t) => Math.abs(t - s.timestamp) < minSpacing
    );
    if (nearbyUsed && selected.length > target / 2) continue;

    selected.push(s);
    usedTimestamps.add(s.timestamp);
  }

  return selected.map((s) => toRuleBasedCard(s));
}

function toRuleBasedCard(s: ScoredSentence): GeneratedFlashcard {
  if (DEFINITION_PATTERNS.some((p) => p.test(s.text))) {
    return makeDefinitionCard(s.text, s.timestamp, s.topic);
  }
  if (/\b(?:however|but|although|in\s+contrast|unlike)\b/i.test(s.text)) {
    return makeComparisonCard(s.text, s.timestamp, s.topic);
  }
  return (
    makeClozeCard(s.text, s.timestamp, s.topic) ||
    makeGenericCard(s.text, s.timestamp, s.topic)
  );
}
