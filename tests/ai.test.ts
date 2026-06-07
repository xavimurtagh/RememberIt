import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateFlashcards } from '@/lib/ai';

describe('AI Flashcard Generation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const validResponse = {
    content: [
      {
        text: JSON.stringify([
          {
            question: 'What is the main topic?',
            answer: 'The main topic is testing.',
            timestamp: 30,
            topic: 'Testing',
          },
          {
            question: 'What framework is mentioned?',
            answer: 'Vitest is mentioned as the testing framework.',
            timestamp: 120,
            topic: 'Frameworks',
          },
        ]),
      },
    ],
  };

  it('generates flashcards from a transcript', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(validResponse),
    } as Response);

    const cards = await generateFlashcards(
      'sk-ant-test-key',
      'This is a sample transcript about testing with Vitest.',
      'Testing Tutorial',
      'Tech Channel',
      2
    );

    expect(cards).toHaveLength(2);
    expect(cards[0].question).toBe('What is the main topic?');
    expect(cards[0].answer).toBe('The main topic is testing.');
    expect(cards[0].timestamp).toBe(30);
    expect(cards[0].topic).toBe('Testing');
    expect(cards[1].question).toBe('What framework is mentioned?');
  });

  it('sends correct request to Claude API', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(validResponse),
    } as Response);

    await generateFlashcards('my-key', 'transcript', 'Title', 'Channel', 5);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-api-key': 'my-key',
          'anthropic-version': '2023-06-01',
        }),
      })
    );

    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body
    );
    expect(body.messages[0].content).toContain('Title');
    expect(body.messages[0].content).toContain('Channel');
    expect(body.messages[0].content).toContain('transcript');
    expect(body.messages[0].content).toContain('5 flashcards');
  });

  it('handles response wrapped in code fences', async () => {
    const wrappedResponse = {
      content: [
        {
          text: '```json\n' + JSON.stringify([
            { question: 'Q?', answer: 'A', timestamp: 0, topic: 'T' },
          ]) + '\n```',
        },
      ],
    };

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(wrappedResponse),
    } as Response);

    const cards = await generateFlashcards('key', 'text', 'title', 'ch', 1);
    expect(cards).toHaveLength(1);
    expect(cards[0].question).toBe('Q?');
  });

  it('throws error for invalid API key (401)', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    } as Response);

    await expect(
      generateFlashcards('bad-key', 'text', 'title', 'ch', 5)
    ).rejects.toThrow('Invalid API key');
  });

  it('throws error for other API failures', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    } as Response);

    await expect(
      generateFlashcards('key', 'text', 'title', 'ch', 5)
    ).rejects.toThrow('AI API error (500)');
  });

  it('throws error when response has no content', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ content: [] }),
    } as Response);

    await expect(
      generateFlashcards('key', 'text', 'title', 'ch', 5)
    ).rejects.toThrow('No response from AI');
  });

  it('truncates very long transcripts', async () => {
    const longTranscript = 'x'.repeat(50000);

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(validResponse),
    } as Response);

    await generateFlashcards('key', longTranscript, 'title', 'ch', 2);

    const body = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body
    );
    expect(body.messages[0].content.length).toBeLessThan(50000);
  });

  it('handles flashcards with missing optional fields', async () => {
    const partialResponse = {
      content: [
        {
          text: JSON.stringify([
            { question: 'Q?', answer: 'A' },
          ]),
        },
      ],
    };

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(partialResponse),
    } as Response);

    const cards = await generateFlashcards('key', 'text', 'title', 'ch', 1);
    expect(cards[0].question).toBe('Q?');
    expect(cards[0].answer).toBe('A');
    expect(cards[0].timestamp).toBe(0);
    expect(cards[0].topic).toBe('');
  });
});
