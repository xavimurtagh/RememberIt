import { extractTranscriptFromPlayer, fetchTranscript } from '@/lib/transcript';

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
        try {
          let playerResponse: any = null;
          try {
            const el = document.getElementById('movie_player') as any;
            if (el && typeof el.getPlayerResponse === 'function') {
              playerResponse = el.getPlayerResponse();
            }
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
        } catch (err) {
          window.postMessage({
            type: 'REMEMBERIT_RESULT',
            success: false,
            error: err instanceof Error ? err.message : 'extraction-failed',
          }, '*');
        }
      })();
    });
  },
});
