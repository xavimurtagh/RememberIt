import { extractTranscriptFromPlayer, fetchTranscript } from '@/lib/transcript';
import type { TranscriptSegment } from '@/lib/types';

export default defineContentScript({
  matches: ['*://www.youtube.com/*', '*://youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_start',

  main() {
    window.addEventListener('message', (e: MessageEvent) => {
      if (e.source !== window) return;
      if (e.data?.type !== 'REMEMBERIT_EXTRACT') return;

      const videoId: string = e.data.videoId;

      (async () => {
        const errors: string[] = [];

        // Strategy 1: /youtubei/v1/get_transcript endpoint.
        // Returns transcript text directly — bypasses the timedtext caption URL
        // and its Proof-of-Origin Token (POT) requirement entirely.
        try {
          const segments = await fetchViaGetTranscript(videoId);
          if (segments.length > 0) {
            window.postMessage({
              type: 'REMEMBERIT_RESULT',
              success: true,
              segments,
              fullText: segments.map((s) => s.text).join(' '),
            }, '*');
            return;
          }
        } catch (err) {
          errors.push(err instanceof Error ? err.message : 'get_transcript failed');
        }

        // Strategy 2: live player response + caption URL fetch (same-origin).
        try {
          let playerResponse: any = null;
          try {
            const el = document.getElementById('movie_player') as any;
            if (el?.getPlayerResponse) playerResponse = el.getPlayerResponse();
          } catch {}
          if (!playerResponse?.captions) {
            playerResponse = (window as any).ytInitialPlayerResponse || null;
          }

          let result;
          if (playerResponse?.captions) {
            result = await extractTranscriptFromPlayer(playerResponse);
          } else {
            result = await fetchTranscript(videoId);
          }

          window.postMessage({
            type: 'REMEMBERIT_RESULT',
            success: true,
            segments: result.segments,
            fullText: result.fullText,
          }, '*');
          return;
        } catch (err) {
          errors.push(err instanceof Error ? err.message : 'caption-url failed');
        }

        window.postMessage({
          type: 'REMEMBERIT_RESULT',
          success: false,
          error: errors.join(' | '),
        }, '*');
      })();
    });
  },
});

function extractTranscriptParamsFromPage(videoId: string): string | null {
  try {
    const ytData = (window as any).ytInitialData;
    if (!ytData?.engagementPanels) return null;

    for (const panel of ytData.engagementPanels) {
      const renderer = panel?.engagementPanelSectionListRenderer;
      if (!renderer) continue;
      const panelId = renderer.panelIdentifier || '';
      if (panelId && !panelId.includes('transcript')) continue;

      const contents = renderer.content?.sectionListRenderer?.contents;
      if (!Array.isArray(contents)) continue;

      for (const item of contents) {
        const endpoint =
          item?.continuationItemRenderer?.continuationEndpoint
            ?.getTranscriptEndpoint;
        if (endpoint?.params) {
          try {
            const decoded = atob(endpoint.params);
            if (decoded.includes(videoId)) return endpoint.params;
          } catch {}
          return endpoint.params;
        }
      }
    }
  } catch {}
  return null;
}

function buildTranscriptParams(videoId: string, lang = 'en'): string {
  const enc = new TextEncoder();
  const vidBytes = enc.encode(videoId);
  const langBytes = enc.encode(lang);
  const asrBytes = enc.encode('asr');

  const langMsg = new Uint8Array([
    0x0a, asrBytes.length, ...asrBytes,
    0x12, langBytes.length, ...langBytes,
    0x1a, 0x00,
  ]);

  const outer = new Uint8Array([
    0x0a, vidBytes.length, ...vidBytes,
    0x12, langMsg.length, ...langMsg,
  ]);

  return btoa(String.fromCharCode(...outer));
}

async function fetchViaGetTranscript(
  videoId: string
): Promise<TranscriptSegment[]> {
  const params =
    extractTranscriptParamsFromPage(videoId) ||
    buildTranscriptParams(videoId);

  const res = await fetch(
    'https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false',
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
        params,
      }),
    }
  );

  if (!res.ok) return [];
  const data = await res.json();
  return parseTranscriptResponse(data);
}

function parseTranscriptResponse(data: any): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const actions = data?.actions;
  if (!Array.isArray(actions)) return segments;

  for (const action of actions) {
    // Format A: updateEngagementPanelAction → transcriptRenderer
    const panel =
      action?.updateEngagementPanelAction?.content?.transcriptRenderer;
    if (panel) {
      const searchPanel = panel.content?.transcriptSearchPanelRenderer;
      const segList =
        searchPanel?.body?.transcriptSegmentListRenderer?.initialSegments;
      if (Array.isArray(segList)) {
        for (const seg of segList) {
          const r = seg?.transcriptSegmentRenderer;
          if (!r) continue;
          const text =
            r.snippet?.runs?.map((run: any) => run.text || '').join('') ||
            r.snippet?.simpleText ||
            '';
          const startMs = parseInt(r.startMs || '0', 10);
          const endMs = parseInt(r.endMs || '0', 10);
          if (text.trim()) {
            segments.push({
              text: text.trim(),
              start: startMs / 1000,
              duration: Math.max(0, (endMs - startMs) / 1000),
            });
          }
        }
        if (segments.length > 0) return segments;
      }
    }

    // Format B: elementsCommand → transformEntityCommand
    const cmd = action?.elementsCommand?.transformEntityCommand;
    if (cmd) {
      const segList =
        cmd.arguments?.transformTranscriptSegmentListArguments?.overwrite
          ?.initialSegments;
      if (Array.isArray(segList)) {
        for (const seg of segList) {
          const r = seg?.transcriptSegmentRenderer;
          if (!r) continue;
          const text =
            r.snippet?.elementsAttributedString?.content ||
            r.snippet?.runs?.map((run: any) => run.text || '').join('') ||
            '';
          const startMs = parseInt(r.startMs || '0', 10);
          const endMs = parseInt(r.endMs || '0', 10);
          if (text.trim()) {
            segments.push({
              text: text.trim(),
              start: startMs / 1000,
              duration: Math.max(0, (endMs - startMs) / 1000),
            });
          }
        }
        if (segments.length > 0) return segments;
      }
    }
  }

  return segments;
}
