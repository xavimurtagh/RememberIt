import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchTranscript } from '@/lib/transcript';

describe('Transcript Extraction', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const makeCaptionXml = (segments: { text: string; start: number; dur: number }[]) => {
    const entries = segments
      .map((s) => `<text start="${s.start}" dur="${s.dur}">${s.text}</text>`)
      .join('');
    return `<?xml version="1.0" encoding="utf-8"?><transcript>${entries}</transcript>`;
  };

  const makePlayerHtml = (captionUrl: string) => {
    const playerResponse = JSON.stringify({
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              baseUrl: captionUrl,
              languageCode: 'en',
            },
          ],
        },
      },
    });
    return `<script>var ytInitialPlayerResponse = ${playerResponse};</script>`;
  };

  it('extracts transcript segments from YouTube video', async () => {
    const captionXml = makeCaptionXml([
      { text: 'Hello world', start: 0, dur: 2 },
      { text: 'This is a test', start: 2, dur: 3 },
      { text: 'Thank you', start: 5, dur: 1.5 },
    ]);

    const captionUrl = 'https://www.youtube.com/api/timedtext?v=abc123&lang=en';

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(makePlayerHtml(captionUrl)),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(captionXml),
      } as Response);

    const result = await fetchTranscript('abc123');

    expect(result.segments).toHaveLength(3);
    expect(result.segments[0].text).toBe('Hello world');
    expect(result.segments[0].start).toBe(0);
    expect(result.segments[0].duration).toBe(2);
    expect(result.segments[1].text).toBe('This is a test');
    expect(result.segments[2].text).toBe('Thank you');
    expect(result.fullText).toBe('Hello world This is a test Thank you');
  });

  it('throws error when no captions are available', async () => {
    const htmlNoCaptions = `<script>var ytInitialPlayerResponse = ${JSON.stringify({
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [],
        },
      },
    })};</script>`;

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(htmlNoCaptions),
    } as Response);

    await expect(fetchTranscript('nocaptions')).rejects.toThrow('No captions available');
  });

  it('throws error when player response is missing', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('<html><body>No player response</body></html>'),
    } as Response);

    await expect(fetchTranscript('missing')).rejects.toThrow('No captions available');
  });

  it('handles HTML entities in transcript text', async () => {
    const captionXml = makeCaptionXml([
      { text: 'it&#39;s a test &amp; demo', start: 0, dur: 2 },
    ]);
    const captionUrl = 'https://example.com/captions';

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(makePlayerHtml(captionUrl)),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(captionXml),
      } as Response);

    const result = await fetchTranscript('entities');
    expect(result.segments[0].text).toBe("it's a test & demo");
  });

  it('prefers English captions when multiple tracks exist', async () => {
    const playerResponse = JSON.stringify({
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            { baseUrl: 'https://example.com/es', languageCode: 'es' },
            { baseUrl: 'https://example.com/en', languageCode: 'en' },
            { baseUrl: 'https://example.com/fr', languageCode: 'fr' },
          ],
        },
      },
    });
    const html = `<script>var ytInitialPlayerResponse = ${playerResponse};</script>`;

    const captionXml = makeCaptionXml([{ text: 'English caption', start: 0, dur: 1 }]);

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(html),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(captionXml),
      } as Response);

    await fetchTranscript('multilang');

    const secondCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(secondCall[0]).toBe('https://example.com/en');
  });

  it('skips empty text segments', async () => {
    const captionXml = makeCaptionXml([
      { text: 'Real content', start: 0, dur: 2 },
      { text: '   ', start: 2, dur: 1 },
      { text: 'More content', start: 3, dur: 2 },
    ]);
    const captionUrl = 'https://example.com/captions';

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(makePlayerHtml(captionUrl)),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(captionXml),
      } as Response);

    const result = await fetchTranscript('empty');
    expect(result.segments).toHaveLength(2);
    expect(result.fullText).toBe('Real content More content');
  });
});
