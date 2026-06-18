import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchTranscript,
  parseTimestampLabel,
  buildSegmentsFromScrapedRows,
} from '@/lib/transcript';

describe('Transcript Extraction', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const makeCaptionXml = (
    segments: { text: string; start: number; dur: number }[]
  ) => {
    const entries = segments
      .map((s) => `<text start="${s.start}" dur="${s.dur}">${s.text}</text>`)
      .join('');
    return `<?xml version="1.0" encoding="utf-8"?><transcript>${entries}</transcript>`;
  };

  const makeJson3 = (
    segments: { text: string; start: number; dur: number }[]
  ) =>
    JSON.stringify({
      events: segments.map((s) => ({
        tStartMs: s.start * 1000,
        dDurationMs: s.dur * 1000,
        segs: [{ utf8: s.text }],
      })),
    });

  const makePlayerResponse = (
    tracks: { baseUrl: string; languageCode: string }[]
  ) => ({
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: tracks,
      },
    },
  });

  // Routes fetch calls: InnerTube POST returns player response,
  // caption GET returns the caption body.
  function mockFetch(
    playerResponse: unknown,
    captionBody: string,
    options: { innertubeOk?: boolean } = {}
  ) {
    const { innertubeOk = true } = options;
    return vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      const isInnertube = url.includes('/youtubei/v1/player');
      const isWatchPage = url.includes('/watch?v=');

      if (isInnertube && init?.method === 'POST') {
        return Promise.resolve({
          ok: innertubeOk,
          json: () => Promise.resolve(playerResponse),
          text: () => Promise.resolve(JSON.stringify(playerResponse)),
        } as Response);
      }

      if (isWatchPage) {
        // Fallback path: embed player response in HTML
        const html = `<script>var ytInitialPlayerResponse = ${JSON.stringify(
          playerResponse
        )};</script>`;
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(html),
        } as Response);
      }

      // Caption track fetch
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(captionBody),
      } as Response);
    });
  }

  it('extracts transcript segments using InnerTube + json3', async () => {
    const segments = [
      { text: 'Hello world', start: 0, dur: 2 },
      { text: 'This is a test', start: 2, dur: 3 },
      { text: 'Thank you', start: 5, dur: 1.5 },
    ];
    const player = makePlayerResponse([
      { baseUrl: 'https://www.youtube.com/api/timedtext?v=abc', languageCode: 'en' },
    ]);

    global.fetch = mockFetch(player, makeJson3(segments));

    const result = await fetchTranscript('abc123');

    expect(result.segments).toHaveLength(3);
    expect(result.segments[0].text).toBe('Hello world');
    expect(result.segments[0].start).toBe(0);
    expect(result.segments[0].duration).toBe(2);
    expect(result.segments[2].text).toBe('Thank you');
    expect(result.fullText).toBe('Hello world This is a test Thank you');
  });

  it('extracts transcript using XML caption format', async () => {
    const segments = [
      { text: 'First line', start: 0, dur: 2 },
      { text: 'Second line', start: 2, dur: 2 },
    ];
    const player = makePlayerResponse([
      { baseUrl: 'https://example.com/captions', languageCode: 'en' },
    ]);

    global.fetch = mockFetch(player, makeCaptionXml(segments));

    const result = await fetchTranscript('xmlvid');
    expect(result.segments).toHaveLength(2);
    expect(result.fullText).toBe('First line Second line');
  });

  it('extracts transcript using srv3 caption format', async () => {
    const player = makePlayerResponse([
      { baseUrl: 'https://example.com/captions', languageCode: 'en' },
    ]);
    const srv3 = `<?xml version="1.0" encoding="utf-8"?><timedtext format="3"><body>` +
      `<p t="0" d="2000">Hello there</p>` +
      `<p t="2000" d="3000"><s>multi</s><s> segment</s> line</p>` +
      `</body></timedtext>`;

    // json3 attempt returns the srv3 XML (JSON.parse fails) → falls back to srv3 parse
    global.fetch = mockFetch(player, srv3);

    const result = await fetchTranscript('srv3vid');
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].text).toBe('Hello there');
    expect(result.segments[0].start).toBe(0);
    expect(result.segments[0].duration).toBe(2);
    expect(result.segments[1].text).toBe('multi segment line');
    expect(result.segments[1].start).toBe(2);
  });

  it('throws error when no captions are available', async () => {
    const player = makePlayerResponse([]);
    global.fetch = mockFetch(player, '');

    await expect(fetchTranscript('nocaptions')).rejects.toThrow(
      'No captions available'
    );
  });

  it('falls back to watch page scrape when InnerTube fails', async () => {
    const segments = [{ text: 'Scraped content', start: 0, dur: 2 }];
    const player = makePlayerResponse([
      { baseUrl: 'https://example.com/captions', languageCode: 'en' },
    ]);

    // InnerTube returns not-ok → triggers HTML scrape fallback
    global.fetch = mockFetch(player, makeJson3(segments), {
      innertubeOk: false,
    });

    const result = await fetchTranscript('fallback');
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].text).toBe('Scraped content');
  });

  it('handles HTML entities in XML transcript text', async () => {
    const player = makePlayerResponse([
      { baseUrl: 'https://example.com/captions', languageCode: 'en' },
    ]);
    const xml = makeCaptionXml([
      { text: 'it&#39;s a test &amp; demo', start: 0, dur: 2 },
    ]);

    global.fetch = mockFetch(player, xml);

    const result = await fetchTranscript('entities');
    expect(result.segments[0].text).toBe("it's a test & demo");
  });

  it('prefers English captions when multiple tracks exist', async () => {
    const player = makePlayerResponse([
      { baseUrl: 'https://example.com/es', languageCode: 'es' },
      { baseUrl: 'https://example.com/en', languageCode: 'en' },
      { baseUrl: 'https://example.com/fr', languageCode: 'fr' },
    ]);

    global.fetch = mockFetch(
      player,
      makeJson3([{ text: 'English caption', start: 0, dur: 1 }])
    );

    await fetchTranscript('multilang');

    const captionCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => String(c[0]).startsWith('https://example.com/')
    );
    expect(String(captionCall?.[0])).toContain('https://example.com/en');
  });

  it('skips empty text segments', async () => {
    const player = makePlayerResponse([
      { baseUrl: 'https://example.com/captions', languageCode: 'en' },
    ]);
    const xml = makeCaptionXml([
      { text: 'Real content', start: 0, dur: 2 },
      { text: '   ', start: 2, dur: 1 },
      { text: 'More content', start: 3, dur: 2 },
    ]);

    global.fetch = mockFetch(player, xml);

    const result = await fetchTranscript('empty');
    expect(result.segments).toHaveLength(2);
    expect(result.fullText).toBe('Real content More content');
  });

  it('throws when captions found but body is unparseable', async () => {
    const player = makePlayerResponse([
      { baseUrl: 'https://example.com/captions', languageCode: 'en' },
    ]);

    global.fetch = mockFetch(player, 'not json and not xml <garbage>');

    await expect(fetchTranscript('garbage')).rejects.toThrow(
      'could not be read'
    );
  });
});

describe('DOM-scraped transcript helpers', () => {
  describe('parseTimestampLabel', () => {
    it('parses M:SS', () => {
      expect(parseTimestampLabel('0:05')).toBe(5);
      expect(parseTimestampLabel('1:23')).toBe(83);
    });

    it('parses MM:SS and H:MM:SS', () => {
      expect(parseTimestampLabel('12:34')).toBe(754);
      expect(parseTimestampLabel('1:02:03')).toBe(3723);
    });

    it('tolerates surrounding whitespace', () => {
      expect(parseTimestampLabel('  2:00  ')).toBe(120);
    });

    it('returns 0 for empty or unrecognised input', () => {
      expect(parseTimestampLabel('')).toBe(0);
      expect(parseTimestampLabel('abc')).toBe(0);
    });
  });

  describe('buildSegmentsFromScrapedRows', () => {
    it('derives durations from the gap to the next row', () => {
      const segments = buildSegmentsFromScrapedRows([
        { timestamp: '0:00', text: 'Hello world' },
        { timestamp: '0:03', text: 'This is a test' },
        { timestamp: '0:08', text: 'Goodbye' },
      ]);

      expect(segments).toHaveLength(3);
      expect(segments[0]).toEqual({ text: 'Hello world', start: 0, duration: 3 });
      expect(segments[1]).toEqual({
        text: 'This is a test',
        start: 3,
        duration: 5,
      });
      // Final row has no following row, so duration is 0.
      expect(segments[2]).toEqual({ text: 'Goodbye', start: 8, duration: 0 });
    });

    it('skips empty rows and collapses whitespace', () => {
      const segments = buildSegmentsFromScrapedRows([
        { timestamp: '0:00', text: '  Real   content ' },
        { timestamp: '0:02', text: '   ' },
        { timestamp: '0:04', text: 'More content' },
      ]);

      expect(segments).toHaveLength(2);
      expect(segments[0].text).toBe('Real content');
      expect(segments[1].text).toBe('More content');
    });

    it('decodes HTML entities in scraped text', () => {
      const segments = buildSegmentsFromScrapedRows([
        { timestamp: '0:00', text: 'it&#39;s a test &amp; demo' },
      ]);
      expect(segments[0].text).toBe("it's a test & demo");
    });

    it('produces text joinable into a full transcript', () => {
      const segments = buildSegmentsFromScrapedRows([
        { timestamp: '0:00', text: 'one' },
        { timestamp: '0:01', text: 'two' },
      ]);
      expect(segments.map((s) => s.text).join(' ')).toBe('one two');
    });
  });
});
