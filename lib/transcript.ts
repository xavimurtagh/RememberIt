import type { TranscriptSegment } from './types';

// Public InnerTube key used by the YouTube web client. Stable for years; if it
// ever stops working we fall back to scraping the watch page.
const INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

interface CaptionTrack {
  baseUrl: string;
  languageCode?: string;
  kind?: string;
}

export async function fetchTranscript(
  videoId: string
): Promise<{ segments: TranscriptSegment[]; fullText: string }> {
  const playerResponse = await getPlayerResponse(videoId);

  const tracks: CaptionTrack[] | undefined =
    playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!tracks || tracks.length === 0) {
    throw new Error(
      'No captions available for this video. Try a video that has subtitles or closed captions.'
    );
  }

  const track = pickTrack(tracks);
  const segments = await fetchCaptionSegments(track.baseUrl);

  if (segments.length === 0) {
    throw new Error(
      'Captions were found but could not be read for this video. It may use an unsupported format.'
    );
  }

  const fullText = segments.map((s) => s.text).join(' ');
  return { segments, fullText };
}

async function getPlayerResponse(videoId: string): Promise<any | null> {
  // Primary: InnerTube player endpoint (reliable, returns structured JSON).
  try {
    const res = await fetch(
      `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}&prettyPrint=false`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'ANDROID',
              clientVersion: '19.09.37',
              androidSdkVersion: 30,
              hl: 'en',
              gl: 'US',
            },
          },
          videoId,
        }),
      }
    );
    if (res.ok) {
      const data = await res.json();
      if (data?.captions) return data;
    }
  } catch {
    // fall through to scraping
  }

  // Fallback: scrape the watch page HTML.
  return scrapeWatchPage(videoId);
}

async function scrapeWatchPage(videoId: string): Promise<any | null> {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`);
    const html = await res.text();

    const marker = 'ytInitialPlayerResponse';
    const markerIdx = html.indexOf(marker);
    if (markerIdx === -1) return null;

    const braceStart = html.indexOf('{', markerIdx);
    if (braceStart === -1) return null;

    const json = extractBalancedJson(html, braceStart);
    if (!json) return null;

    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Extracts a complete, balanced JSON object starting at `start` (the opening
 * brace), correctly handling nested braces and braces inside strings.
 */
function extractBalancedJson(str: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < str.length; i++) {
    const char = str[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return str.slice(start, i + 1);
      }
    }
  }

  return null;
}

function pickTrack(tracks: CaptionTrack[]): CaptionTrack {
  const english = tracks.find(
    (t) => t.languageCode === 'en' || t.languageCode?.startsWith('en')
  );
  return english || tracks[0];
}

async function fetchCaptionSegments(
  baseUrl: string
): Promise<TranscriptSegment[]> {
  // Request YouTube's JSON caption format (json3) when not already specified.
  const url = baseUrl.includes('fmt=') ? baseUrl : `${baseUrl}&fmt=json3`;
  const res = await fetch(url);
  const body = await res.text();

  // Try JSON (json3) format first.
  try {
    const data = JSON.parse(body);
    if (data && Array.isArray(data.events)) {
      return parseJson3(data.events);
    }
  } catch {
    // not JSON, fall through to XML
  }

  // Fall back to XML (timedtext) format.
  return parseCaptionXml(body);
}

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: { utf8?: string }[];
}

function parseJson3(events: Json3Event[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];

  for (const event of events) {
    if (!event.segs) continue;
    const text = event.segs
      .map((s) => s.utf8 || '')
      .join('')
      .replace(/\n/g, ' ')
      .trim();
    if (text) {
      segments.push({
        text,
        start: (event.tStartMs || 0) / 1000,
        duration: (event.dDurationMs || 0) / 1000,
      });
    }
  }

  return segments;
}

function parseCaptionXml(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const regex =
    /<text\s+start="([^"]*)"(?:\s+dur="([^"]*)")?[^>]*>([\s\S]*?)<\/text>/g;

  let match;
  while ((match = regex.exec(xml)) !== null) {
    const start = parseFloat(match[1] || '0');
    const duration = parseFloat(match[2] || '0');
    const rawText = match[3] || '';
    const text = decodeHtmlEntities(rawText);
    if (text.trim()) {
      segments.push({ text: text.trim(), start, duration });
    }
  }

  return segments;
}

const HTML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&#x27;': "'",
  '&#x2F;': '/',
  '&nbsp;': ' ',
};

function decodeHtmlEntities(text: string): string {
  let decoded = text.replace(
    /&(?:#(\d+)|#x([0-9a-fA-F]+)|[a-zA-Z]+);/g,
    (entity, decimal, hex) => {
      if (HTML_ENTITY_MAP[entity]) return HTML_ENTITY_MAP[entity];
      if (decimal) return String.fromCharCode(parseInt(decimal, 10));
      if (hex) return String.fromCharCode(parseInt(hex, 16));
      return entity;
    }
  );
  decoded = decoded.replace(/\n/g, ' ');
  return decoded;
}
