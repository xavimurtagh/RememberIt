import type { TranscriptSegment } from './types';

export async function fetchTranscript(
  videoId: string
): Promise<{ segments: TranscriptSegment[]; fullText: string }> {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const response = await fetch(videoUrl);
  const html = await response.text();

  const captionUrl = extractCaptionUrl(html);
  if (!captionUrl) {
    throw new Error(
      'No captions available for this video. The video may not have subtitles enabled.'
    );
  }

  const captionResponse = await fetch(captionUrl);
  const captionXml = await captionResponse.text();
  const segments = parseCaptionXml(captionXml);

  const fullText = segments.map((s) => s.text).join(' ');
  return { segments, fullText };
}

function extractCaptionUrl(html: string): string | null {
  const playerResponseMatch = html.match(
    /ytInitialPlayerResponse\s*=\s*({.+?})\s*;\s*(?:var|<\/script)/
  );
  if (!playerResponseMatch) return null;

  try {
    const playerResponse = JSON.parse(playerResponseMatch[1]);
    const captionTracks =
      playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!captionTracks || captionTracks.length === 0) return null;

    const englishTrack = captionTracks.find(
      (t: { languageCode: string }) =>
        t.languageCode === 'en' || t.languageCode.startsWith('en')
    );
    const track = englishTrack || captionTracks[0];
    return track?.baseUrl || null;
  } catch {
    return null;
  }
}

function parseCaptionXml(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const regex = /<text\s+start="([^"]*)"(?:\s+dur="([^"]*)")?[^>]*>([\s\S]*?)<\/text>/g;

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
