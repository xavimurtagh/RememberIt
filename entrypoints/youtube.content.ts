import type { VideoMetadata } from '@/lib/types';
import { extractTranscriptFromPlayer, fetchTranscript } from '@/lib/transcript';

/**
 * Asks the MAIN-world script for the live player response (always current for
 * the playing video). Resolves null if the player isn't ready in time.
 */
function getLivePlayerResponse(): Promise<any | null> {
  return new Promise((resolve) => {
    let done = false;
    const handler = (e: MessageEvent) => {
      if (e.source !== window) return;
      if (e.data?.type !== 'REMEMBERIT_PLAYER_RESPONSE') return;
      if (done) return;
      done = true;
      window.removeEventListener('message', handler);
      try {
        resolve(e.data.payload ? JSON.parse(e.data.payload) : null);
      } catch {
        resolve(null);
      }
    };
    window.addEventListener('message', handler);
    window.postMessage({ type: 'REMEMBERIT_GET_PLAYER' }, '*');
    setTimeout(() => {
      if (done) return;
      done = true;
      window.removeEventListener('message', handler);
      resolve(null);
    }, 2500);
  });
}

function extractPlayerResponseFromPage(targetVideoId: string): any | null {
  try {
    const scripts = document.querySelectorAll('script');
    for (const script of Array.from(scripts)) {
      const text = script.textContent || '';
      const marker = 'ytInitialPlayerResponse';
      const idx = text.indexOf(marker);
      if (idx === -1) continue;

      const braceStart = text.indexOf('{', idx);
      if (braceStart === -1) continue;

      const json = extractBalancedJsonFromPage(text, braceStart);
      if (!json) continue;

      const data = JSON.parse(json);
      const videoId = data?.videoDetails?.videoId;
      if (videoId && videoId !== targetVideoId) continue;
      if (data?.captions) return data;
    }
  } catch {
    // extraction failed
  }
  return null;
}

function extractBalancedJsonFromPage(str: string, start: number): string | null {
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
      if (depth === 0) return str.slice(start, i + 1);
    }
  }
  return null;
}

export default defineContentScript({
  matches: ['*://www.youtube.com/*', '*://youtube.com/*'],
  runAt: 'document_idle',

  main() {
    let currentVideoId: string | null = null;

    browser.runtime.onMessage.addListener(
      (message: any, _sender: any, sendResponse: any) => {
        if (message.type === 'EXTRACT_TRANSCRIPT') {
          (async () => {
            const errors: string[] = [];

            // Strategy 1: live player object (most reliable, always current).
            try {
              const live = await getLivePlayerResponse();
              if (live?.captions) {
                const result = await extractTranscriptFromPlayer(live);
                sendResponse({
                  success: true,
                  segments: result.segments,
                  fullText: result.fullText,
                });
                return;
              }
            } catch (e) {
              errors.push(e instanceof Error ? e.message : 'live-failed');
            }

            // Strategy 2: player response embedded in the page scripts.
            try {
              const fromPage = extractPlayerResponseFromPage(message.videoId);
              if (fromPage?.captions) {
                const result = await extractTranscriptFromPlayer(fromPage);
                sendResponse({
                  success: true,
                  segments: result.segments,
                  fullText: result.fullText,
                });
                return;
              }
            } catch (e) {
              errors.push(e instanceof Error ? e.message : 'page-failed');
            }

            // Strategy 3: InnerTube fetch from the page (same-origin, cookies).
            try {
              const result = await fetchTranscript(message.videoId);
              sendResponse({
                success: true,
                segments: result.segments,
                fullText: result.fullText,
              });
              return;
            } catch (e) {
              errors.push(e instanceof Error ? e.message : 'innertube-failed');
            }

            sendResponse({
              success: false,
              error: errors[errors.length - 1] || 'extract-failed',
            });
          })();
          return true;
        }
        if (message.type === 'GET_VIDEO_METADATA') {
          sendResponse({ metadata: getVideoMetadata() });
          return true;
        }
        return true;
      }
    );

    function getVideoId(): string | null {
      const params = new URLSearchParams(window.location.search);
      return params.get('v');
    }

    function getVideoMetadata(): VideoMetadata | null {
      const videoId = getVideoId();
      if (!videoId) return null;

      const titleEl = document.querySelector(
        'yt-formatted-string.style-scope.ytd-watch-metadata'
      ) as HTMLElement | null;
      const channelEl = document.querySelector(
        'ytd-channel-name yt-formatted-string a'
      ) as HTMLAnchorElement | null;

      return {
        videoId,
        title: titleEl?.textContent?.trim() || document.title.replace(' - YouTube', ''),
        channel: channelEl?.textContent?.trim() || 'Unknown Channel',
        thumbnailUrl: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      };
    }

    function injectButton() {
      if (document.querySelector('#rememberit-btn')) return;
      if (!getVideoId()) return;

      const actionsContainer = document.querySelector(
        '#top-level-buttons-computed'
      );
      if (!actionsContainer) return;

      const btn = document.createElement('button');
      btn.id = 'rememberit-btn';
      btn.innerHTML = `
        <span style="display:flex;align-items:center;gap:6px;padding:0 16px;height:36px;
          border-radius:18px;background:#6366f1;color:white;font-size:14px;font-weight:500;
          font-family:Roboto,Arial,sans-serif;cursor:pointer;border:none;
          transition:background 0.2s;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
          </svg>
          RememberIt
        </span>
      `;
      btn.style.cssText =
        'background:none;border:none;cursor:pointer;margin-left:8px;';

      btn.addEventListener('mouseenter', () => {
        const span = btn.querySelector('span') as HTMLElement;
        if (span) span.style.background = '#4f46e5';
      });
      btn.addEventListener('mouseleave', () => {
        const span = btn.querySelector('span') as HTMLElement;
        if (span) span.style.background = '#6366f1';
      });

      btn.addEventListener('click', async () => {
        const metadata = getVideoMetadata();
        if (metadata) {
          await browser.runtime.sendMessage({
            type: 'VIDEO_CHANGED',
            metadata,
          });
        }
        await browser.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' });
      });

      actionsContainer.appendChild(btn);
    }

    function handleNavigation() {
      const newVideoId = getVideoId();
      if (newVideoId !== currentVideoId) {
        currentVideoId = newVideoId;
        const existingBtn = document.querySelector('#rememberit-btn');
        if (existingBtn) existingBtn.remove();

        if (newVideoId) {
          setTimeout(injectButton, 1500);

          const metadata = getVideoMetadata();
          if (metadata) {
            browser.runtime.sendMessage({
              type: 'VIDEO_CHANGED',
              metadata,
            });
          }
        }
      }
    }

    handleNavigation();

    document.addEventListener('yt-navigate-finish', handleNavigation);

    const observer = new MutationObserver(() => {
      if (getVideoId() && !document.querySelector('#rememberit-btn')) {
        setTimeout(injectButton, 500);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  },
});
