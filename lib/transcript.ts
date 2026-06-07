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
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  const texts = doc.querySelectorAll('text');

  texts.forEach((node) => {
    const start = parseFloat(node.getAttribute('start') || '0');
    const duration = parseFloat(node.getAttribute('dur') || '0');
    const text = decodeHtmlEntities(node.textContent || '');
    if (text.trim()) {
      segments.push({ text: text.trim(), start, duration });
    }
  });

  return segments;
}

function decodeHtmlEntities(text: string): string {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}
