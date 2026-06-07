import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateFlashcards, checkChromeAIAvailability } from '@/lib/ai';
import type { TranscriptSegment } from '@/lib/types';

describe('AI Flashcard Generation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (globalThis as Record<string, unknown>).LanguageModel = undefined;
  });

  const sampleSegments: TranscriptSegment[] = [
    { text: 'Spaced repetition is a learning technique.', start: 0, duration: 3 },
    { text: 'It incorporates increasing intervals between reviews.', start: 3, duration: 3 },
    { text: 'The forgetting curve was discovered by Ebbinghaus.', start: 6, duration: 3 },
    { text: 'Without review, we forget 70% within 24 hours.', start: 9, duration: 3 },
    { text: 'However, spaced review is different from massed practice.', start: 12, duration: 3 },
    { text: 'Active recall is more effective than passive reading.', start: 15, duration: 3 },
    { text: 'The testing effect is one of the most robust findings.', start: 18, duration: 3 },
    { text: 'FSRS is a modern algorithm that uses machine learning.', start: 21, duration: 3 },
    { text: 'It was trained on 700 million reviews from 20000 users.', start: 24, duration: 3 },
    { text: 'FSRS achieves 20 to 30 percent fewer reviews than SM-2.', start: 27, duration: 3 },
    { text: 'The key insight is that memory decays exponentially.', start: 30, duration: 3 },
    { text: 'Important: you should review at the point of forgetting.', start: 33, duration: 3 },
  ];

  const sampleTranscript = sampleSegments.map((s) => s.text).join(' ');

  describe('checkChromeAIAvailability', () => {
    it('returns false when LanguageModel is not defined', async () => {
      const available = await checkChromeAIAvailability();
      expect(available).toBe(false);
    });

    it('returns true when LanguageModel reports available', async () => {
      (globalThis as Record<string, unknown>).LanguageModel = {
        availability: vi.fn().mockResolvedValue('available'),
      };

      const available = await checkChromeAIAvailability();
      expect(available).toBe(true);
    });

    it('returns true when LanguageModel reports downloadable', async () => {
      (globalThis as Record<string, unknown>).LanguageModel = {
        availability: vi.fn().mockResolvedValue('downloadable'),
      };

      const available = await checkChromeAIAvailability();
      expect(available).toBe(true);
    });

    it('returns false when LanguageModel reports unavailable', async () => {
      (globalThis as Record<string, unknown>).LanguageModel = {
        availability: vi.fn().mockResolvedValue('unavailable'),
      };

      const available = await checkChromeAIAvailability();
      expect(available).toBe(false);
    });

    it('returns false when availability check throws', async () => {
      (globalThis as Record<string, unknown>).LanguageModel = {
        availability: vi.fn().mockRejectedValue(new Error('fail')),
      };

      const available = await checkChromeAIAvailability();
      expect(available).toBe(false);
    });
  });

  describe('Rule-based generation (fallback)', () => {
    it('generates flashcards when Chrome AI is unavailable', async () => {
      const { flashcards, backend } = await generateFlashcards(
        sampleTranscript,
        'Learning Science Video',
        'Education Channel',
        5,
        sampleSegments
      );

      expect(backend).toBe('rule-based');
      expect(flashcards).toHaveLength(5);
    });

    it('each flashcard has question, answer, timestamp, and topic', async () => {
      const { flashcards } = await generateFlashcards(
        sampleTranscript,
        'Test Video',
        'Channel',
        5,
        sampleSegments
      );

      for (const card of flashcards) {
        expect(card.question).toBeTruthy();
        expect(card.answer).toBeTruthy();
        expect(typeof card.timestamp).toBe('number');
        expect(card.timestamp).toBeGreaterThanOrEqual(0);
        expect(typeof card.topic).toBe('string');
      }
    });

    it('respects the requested card count', async () => {
      const { flashcards: three } = await generateFlashcards(
        sampleTranscript,
        'Test',
        'Ch',
        3,
        sampleSegments
      );
      expect(three).toHaveLength(3);

      const { flashcards: eight } = await generateFlashcards(
        sampleTranscript,
        'Test',
        'Ch',
        8,
        sampleSegments
      );
      expect(eight.length).toBeGreaterThanOrEqual(5);
      expect(eight.length).toBeLessThanOrEqual(8);
    });

    it('generates definition-style cards for definition sentences', async () => {
      const defSegments: TranscriptSegment[] = [
        { text: 'Photosynthesis is a process used by plants to convert light into energy.', start: 10, duration: 5 },
        { text: 'This process is fundamental to life on Earth.', start: 15, duration: 3 },
        { text: 'Chlorophyll refers to the green pigment in leaves.', start: 20, duration: 4 },
      ];
      const transcript = defSegments.map((s) => s.text).join(' ');

      const { flashcards } = await generateFlashcards(
        transcript,
        'Biology',
        'Ch',
        2,
        defSegments
      );

      const hasDefinitionCard = flashcards.some(
        (c) => c.question.toLowerCase().includes('what is')
      );
      expect(hasDefinitionCard).toBe(true);
    });

    it('generates comparison cards for contrast sentences', async () => {
      const contrastSegments: TranscriptSegment[] = [
        { text: 'However, active recall is fundamentally different from passive review methods.', start: 0, duration: 5 },
        { text: 'Unlike traditional study methods, spaced repetition targets the forgetting curve.', start: 10, duration: 5 },
        { text: 'This approach is more important than many people realize.', start: 20, duration: 4 },
        { text: 'In contrast, cramming leads to rapid forgetting after the exam period ends.', start: 30, duration: 5 },
      ];
      const transcript = contrastSegments.map((s) => s.text).join(' ');

      const { flashcards } = await generateFlashcards(
        transcript,
        'Study Methods',
        'Ch',
        3,
        contrastSegments
      );

      const hasComparisonCard = flashcards.some(
        (c) =>
          c.question.toLowerCase().includes('contrast') ||
          c.question.toLowerCase().includes('distinction')
      );
      expect(hasComparisonCard).toBe(true);
    });

    it('returns cards sorted by timestamp', async () => {
      const { flashcards } = await generateFlashcards(
        sampleTranscript,
        'Test',
        'Ch',
        5,
        sampleSegments
      );

      for (let i = 1; i < flashcards.length; i++) {
        expect(flashcards[i].timestamp).toBeGreaterThanOrEqual(
          flashcards[i - 1].timestamp
        );
      }
    });

    it('handles very short transcripts', async () => {
      const shortSegments: TranscriptSegment[] = [
        { text: 'This is a short but important video about testing.', start: 0, duration: 5 },
      ];

      const { flashcards } = await generateFlashcards(
        'This is a short but important video about testing.',
        'Short Video',
        'Ch',
        3,
        shortSegments
      );

      expect(flashcards.length).toBeGreaterThanOrEqual(1);
      expect(flashcards.length).toBeLessThanOrEqual(3);
    });
  });

  describe('Chrome AI generation', () => {
    it('uses Chrome AI when available and falls back on failure', async () => {
      const mockSession = {
        prompt: vi.fn().mockRejectedValue(new Error('AI failed')),
        destroy: vi.fn(),
      };
      (globalThis as Record<string, unknown>).LanguageModel = {
        availability: vi.fn().mockResolvedValue('available'),
        create: vi.fn().mockResolvedValue(mockSession),
      };

      const { flashcards, backend } = await generateFlashcards(
        sampleTranscript,
        'Test',
        'Ch',
        5,
        sampleSegments
      );

      expect(backend).toBe('rule-based');
      expect(flashcards.length).toBeGreaterThan(0);
    });

    it('returns chrome-ai backend when AI succeeds', async () => {
      const aiCards = [
        { question: 'AI Q1?', answer: 'AI A1', timestamp: 10, topic: 'AI Topic' },
        { question: 'AI Q2?', answer: 'AI A2', timestamp: 20, topic: 'AI Topic' },
      ];

      const mockSession = {
        prompt: vi.fn().mockResolvedValue(JSON.stringify(aiCards)),
        destroy: vi.fn(),
      };
      (globalThis as Record<string, unknown>).LanguageModel = {
        availability: vi.fn().mockResolvedValue('available'),
        create: vi.fn().mockResolvedValue(mockSession),
      };

      const { flashcards, backend } = await generateFlashcards(
        sampleTranscript,
        'Test',
        'Ch',
        2,
        sampleSegments
      );

      expect(backend).toBe('chrome-ai');
      expect(flashcards).toHaveLength(2);
      expect(flashcards[0].question).toBe('AI Q1?');
    });

    it('handles AI response wrapped in code fences', async () => {
      const aiCards = [
        { question: 'Q?', answer: 'A', timestamp: 0, topic: 'T' },
      ];
      const wrappedResponse = '```json\n' + JSON.stringify(aiCards) + '\n```';

      const mockSession = {
        prompt: vi.fn().mockResolvedValue(wrappedResponse),
        destroy: vi.fn(),
      };
      (globalThis as Record<string, unknown>).LanguageModel = {
        availability: vi.fn().mockResolvedValue('available'),
        create: vi.fn().mockResolvedValue(mockSession),
      };

      const { flashcards, backend } = await generateFlashcards(
        sampleTranscript,
        'Test',
        'Ch',
        1,
        sampleSegments
      );

      expect(backend).toBe('chrome-ai');
      expect(flashcards).toHaveLength(1);
    });
  });
});
