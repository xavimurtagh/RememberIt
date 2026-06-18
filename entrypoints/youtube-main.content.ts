import {
  extractTranscriptFromPlayer,
  fetchTranscript,
  findTranscriptEndpointParams,
} from '@/lib/transcript';
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
          const { segments, diag } = await fetchViaGetTranscript(videoId);
          if (segments.length > 0) {
            window.postMessage({
              type: 'REMEMBERIT_RESULT',
              success: true,
              segments,
              fullText: segments.map((s) => s.text).join(' '),
            }, '*');
            return;
          }
          errors.push(`get_transcript: ${diag}`);
        } catch (err) {
          errors.push(
            `get_transcript: ${err instanceof Error ? err.message : 'failed'}`
          );
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
          errors.push(
            `caption-url: ${err instanceof Error ? err.message : 'failed'}`
          );
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

/**
 * Reads the page's InnerTube configuration so our request matches the one the
 * YouTube page itself makes (client version, API key, visitor id). Using stale
 * or mismatched values is a common cause of 400 / empty responses.
 */
function getInnertubeConfig(): {
  clientVersion: string;
  apiKey: string;
  visitorData: string;
} {
  const cfg = (window as any).ytcfg;
  const get = (name: string): string => {
    try {
      if (cfg?.get) return cfg.get(name) || '';
      return cfg?.data_?.[name] || '';
    } catch {
      return '';
    }
  };
  return {
    clientVersion: get('INNERTUBE_CLIENT_VERSION') || '2.20240530.00.00',
    apiKey: get('INNERTUBE_API_KEY'),
    visitorData: get('VISITOR_DATA'),
  };
}

async function fetchViaGetTranscript(
  videoId: string
): Promise<{ segments: TranscriptSegment[]; diag: string }> {
  // Use the transcript token YouTube embedded in the page. It is the only
  // reliably-valid params value — hand-built protobuf tokens are rejected with
  // a 400. The token usually appears once the page (or its transcript panel)
  // has loaded.
  const params =
    findTranscriptEndpointParams((window as any).ytInitialData) ||
    findTranscriptEndpointParams((window as any).ytInitialPlayerResponse);

  if (!params) {
    return { segments: [], diag: 'no transcript token on page' };
  }

  const { clientVersion, apiKey, visitorData } = getInnertubeConfig();
  const url =
    'https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false' +
    (apiKey ? `&key=${apiKey}` : '');

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion,
            hl: 'en',
            gl: 'US',
            ...(visitorData ? { visitorData } : {}),
          },
        },
        params,
      }),
    });

    if (!res.ok) return { segments: [], diag: `HTTP ${res.status}` };

    const data = await res.json();
    const segments = parseTranscriptResponse(data);
    return {
      segments,
      diag: segments.length > 0 ? 'ok' : 'empty response',
    };
  } catch (err) {
    return {
      segments: [],
      diag: err instanceof Error ? err.message : 'request failed',
    };
  }
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
