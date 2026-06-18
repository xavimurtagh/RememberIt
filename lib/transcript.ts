import type { TranscriptSegment } from './types';

const INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

interface CaptionTrack {
  baseUrl: string;
  languageCode?: string;
  kind?: string;
}

export async function fetchTranscript(
  videoId: string,
  preloadedPlayerResponse?: any
): Promise<{ segments: TranscriptSegment[]; fullText: string }> {
  const playerResponse =
    preloadedPlayerResponse || (await getPlayerResponse(videoId));
  return extractTranscriptFromPlayer(playerResponse);
}

/**
 * Given a YouTube player response (from InnerTube or scraped from the page),
 * downloads and parses the caption track into transcript segments. Safe to run
 * in either the service worker or a content script — when run from a content
 * script the caption fetch is same-origin (with cookies), which is far more
 * reliable than a cross-origin service-worker fetch.
 */
export async function extractTranscriptFromPlayer(
  playerResponse: any
): Promise<{ segments: TranscriptSegment[]; fullText: string }> {
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
  try {
    const res = await fetch(
      `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}&prettyPrint=false`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'WEB',
              clientVersion: '2.20240530.00.00',
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
  const formats = ['json3', 'srv1', ''];
  for (const fmt of formats) {
    const url = fmt ? setQueryParam(baseUrl, 'fmt', fmt) : baseUrl;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const text = await res.text();
      if (!text.trim()) continue;
      const segments = tryAllParsers(text);
      if (segments.length > 0) return segments;
    } catch {
      continue;
    }
  }
  return [];
}

function tryAllParsers(text: string): TranscriptSegment[] {
  try {
    const data = JSON.parse(text);
    if (data && Array.isArray(data.events)) {
      const segments = parseJson3(data.events);
      if (segments.length > 0) return segments;
    }
  } catch {
    // not JSON
  }
  const srv3 = parseSrv3Xml(text);
  if (srv3.length > 0) return srv3;
  const legacy = parseCaptionXml(text);
  if (legacy.length > 0) return legacy;
  return [];
}

function setQueryParam(url: string, key: string, value: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set(key, value);
    return u.toString();
  } catch {
    if (new RegExp(`[?&]${key}=`).test(url)) {
      return url.replace(new RegExp(`([?&]${key}=)[^&]*`), `$1${value}`);
    }
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}${key}=${value}`;
  }
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

/**
 * Parses the srv3 / timedtext v3 format:
 *   <p t="0" d="5000">Hello</p>
 *   <p t="5000" d="3000"><s>multi</s><s> segment</s></p>
 * Timing attributes are in milliseconds.
 */
function parseSrv3Xml(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const regex = /<p\s+([^>]*?)>([\s\S]*?)<\/p>/g;

  let match;
  while ((match = regex.exec(xml)) !== null) {
    const attrs = match[1];
    const tMatch = attrs.match(/\bt="(\d+)"/);
    const dMatch = attrs.match(/\bd="(\d+)"/);

    const start = tMatch ? parseInt(tMatch[1], 10) / 1000 : 0;
    const duration = dMatch ? parseInt(dMatch[1], 10) / 1000 : 0;

    // strip inner <s> segment tags and any other markup, keep the text
    const inner = match[2].replace(/<[^>]+>/g, '');
    const text = decodeHtmlEntities(inner).replace(/\s+/g, ' ').trim();

    if (text) {
      segments.push({ text, start, duration });
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

/**
 * Recursively searches a YouTube data object (ytInitialData / player response)
 * for a `getTranscriptEndpoint.params` token. YouTube generates this token
 * itself, so using it avoids the 400 Bad Request that hand-built protobuf
 * params produce. Returns null if the page hasn't embedded a transcript token.
 */
export function findTranscriptEndpointParams(root: unknown): string | null {
  const seen = new Set<unknown>();
  const stack: unknown[] = [root];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);

    const obj = node as Record<string, unknown>;
    const endpoint = obj.getTranscriptEndpoint as
      | { params?: unknown }
      | undefined;
    if (endpoint && typeof endpoint.params === 'string') {
      return endpoint.params;
    }

    for (const key in obj) {
      const value = obj[key];
      if (value && typeof value === 'object') stack.push(value);
    }
  }

  return null;
}

// ── DOM-scrape fallback helpers ─────────────────────────────────────
// These convert rows scraped from YouTube's rendered "Show transcript"
// panel into TranscriptSegment[]. Scraping the panel sidesteps the caption
// URL's Proof-of-Origin-Token (POT) requirement entirely, because the player
// has already fetched and rendered the captions. The DOM walking itself lives
// in the content script; these helpers are pure so they can be unit-tested.

/**
 * Parses a YouTube timestamp label into seconds. Accepts "M:SS", "MM:SS" and
 * "H:MM:SS" forms. Returns 0 for empty or unrecognised input.
 */
export function parseTimestampLabel(label: string): number {
  const trimmed = label.trim();
  if (!trimmed) return 0;
  const parts = trimmed.split(':').map((p) => parseInt(p, 10));
  if (parts.length === 0 || parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/**
 * Converts raw transcript rows scraped from the panel into TranscriptSegment[].
 * Each row carries a timestamp label and the spoken text. Panel rows have no
 * duration, so each segment's duration is derived from the gap to the next
 * row's start time (the final row gets 0).
 */
export function buildSegmentsFromScrapedRows(
  rows: { timestamp: string; text: string }[]
): TranscriptSegment[] {
  const cleaned = rows
    .map((r) => ({
      start: parseTimestampLabel(r.timestamp),
      text: decodeHtmlEntities(r.text).replace(/\s+/g, ' ').trim(),
    }))
    .filter((r) => r.text.length > 0);

  return cleaned.map((r, i) => {
    const next = cleaned[i + 1];
    const duration = next ? Math.max(0, next.start - r.start) : 0;
    return { text: r.text, start: r.start, duration };
  });
}
