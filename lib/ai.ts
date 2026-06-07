import type { GeneratedFlashcard } from './types';

const MAX_TRANSCRIPT_LENGTH = 30000;

export async function generateFlashcards(
  apiKey: string,
  transcript: string,
  videoTitle: string,
  channel: string,
  cardCount: number
): Promise<GeneratedFlashcard[]> {
  const trimmedTranscript = transcript.slice(0, MAX_TRANSCRIPT_LENGTH);

  const prompt = `You are generating flashcards to help someone remember the key concepts from a YouTube video.

Video: "${videoTitle}" by ${channel}
Transcript:
---
${trimmedTranscript}
---

Generate exactly ${cardCount} flashcards as a JSON array. Each flashcard should:
- Test understanding, not just recognition
- Be self-contained (answerable without re-watching the video)
- Include the approximate timestamp (in seconds) of the relevant section
- Cover the most important and memorable concepts
- Vary in type: concept definitions, applications, comparisons, key facts
- Have concise but complete answers (1-3 sentences)

IMPORTANT: Return ONLY valid JSON. No markdown, no code fences, no explanation.

Output format:
[
  {
    "question": "...",
    "answer": "...",
    "timestamp": 125,
    "topic": "short topic label"
  }
]`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    if (response.status === 401) {
      throw new Error('Invalid API key. Please check your settings.');
    }
    throw new Error(`AI API error (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text;
  if (!content) {
    throw new Error('No response from AI');
  }

  return parseFlashcardResponse(content);
}

function parseFlashcardResponse(text: string): GeneratedFlashcard[] {
  let jsonStr = text.trim();

  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  const parsed = JSON.parse(jsonStr);
  if (!Array.isArray(parsed)) {
    throw new Error('AI response is not an array of flashcards');
  }

  return parsed.map((item: Record<string, unknown>) => ({
    question: String(item.question || ''),
    answer: String(item.answer || ''),
    timestamp: Number(item.timestamp || 0),
    topic: String(item.topic || ''),
  }));
}
