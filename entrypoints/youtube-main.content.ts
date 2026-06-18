// Runs in the page's MAIN world so it can access YouTube's live player object,
// which always reflects the currently-playing video (unlike the stale
// ytInitialPlayerResponse baked into the initial HTML after SPA navigation).
// Bridges to the isolated content script via window.postMessage.
export default defineContentScript({
  matches: ['*://www.youtube.com/*', '*://youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_start',

  main() {
    window.addEventListener('message', (e: MessageEvent) => {
      if (e.source !== window) return;
      if (e.data?.type !== 'REMEMBERIT_GET_PLAYER') return;

      let pr: unknown = null;
      try {
        const el = document.getElementById('movie_player') as any;
        if (el && typeof el.getPlayerResponse === 'function') {
          pr = el.getPlayerResponse();
        }
      } catch {
        // player not ready
      }
      if (!pr) {
        try {
          pr = (window as any).ytInitialPlayerResponse || null;
        } catch {
          pr = null;
        }
      }

      let payload: string | null = null;
      try {
        payload = pr ? JSON.stringify(pr) : null;
      } catch {
        payload = null;
      }

      window.postMessage(
        { type: 'REMEMBERIT_PLAYER_RESPONSE', payload },
        '*'
      );
    });
  },
});
