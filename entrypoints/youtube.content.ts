import type { TranscriptSegment, VideoMetadata } from '@/lib/types';
import { buildSegmentsFromScrapedRows } from '@/lib/transcript';

interface ExtractResult {
  success: boolean;
  segments?: TranscriptSegment[];
  fullText?: string;
  error?: string;
}

function extractTranscriptViaMainWorld(videoId: string): Promise<ExtractResult> {
  return new Promise((resolve) => {
    let done = false;
    const handler = (e: MessageEvent) => {
      if (e.source !== window) return;
      if (e.data?.type !== 'REMEMBERIT_RESULT') return;
      if (done) return;
      done = true;
      window.removeEventListener('message', handler);
      resolve(e.data);
    };
    window.addEventListener('message', handler);
    window.postMessage({ type: 'REMEMBERIT_EXTRACT', videoId }, '*');
    setTimeout(() => {
      if (done) return;
      done = true;
      window.removeEventListener('message', handler);
      resolve({ success: false, error: 'Main-world extraction timed out' });
    }, 15000);
  });
}

/**
 * Orchestrates transcript extraction with a POT-proof fallback:
 *   1. InnerTube strategies in the page's MAIN world (get_transcript + caption
 *      URL). These are fast and clean when they work.
 *   2. Scrape YouTube's rendered "Show transcript" panel. The player has
 *      already loaded the captions, so this works even when the caption URL is
 *      gated behind a Proof-of-Origin Token.
 */
async function handleExtractTranscript(videoId: string): Promise<ExtractResult> {
  const viaMain = await extractTranscriptViaMainWorld(videoId);
  if (viaMain.success && viaMain.segments?.length) return viaMain;

  let domDiag = 'not attempted';
  try {
    const { segments, diag } = await scrapeTranscriptFromDom(videoId);
    domDiag = diag;
    if (segments.length > 0) {
      return {
        success: true,
        segments,
        fullText: segments.map((s) => s.text).join(' '),
      };
    }
  } catch (err) {
    domDiag = err instanceof Error ? err.message : 'scrape failed';
  }

  // Surface what each strategy did so failures are diagnosable from the panel.
  const parts: string[] = [];
  if (viaMain.error) parts.push(viaMain.error);
  parts.push(`panel: ${domDiag}`);
  return {
    success: false,
    error: `Could not read the transcript. (${parts.join(' | ')})`,
  };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function getCurrentVideoId(): string | null {
  return new URLSearchParams(window.location.search).get('v');
}

function readTranscriptRows(): { timestamp: string; text: string }[] {
  const rows: { timestamp: string; text: string }[] = [];
  document
    .querySelectorAll('ytd-transcript-segment-renderer')
    .forEach((seg) => {
      const timestamp =
        seg.querySelector('.segment-timestamp')?.textContent?.trim() || '';
      const textEl =
        seg.querySelector('.segment-text') ||
        seg.querySelector('yt-formatted-string');
      const text = textEl?.textContent?.trim() || '';
      if (text) rows.push({ timestamp, text });
    });
  return rows;
}

function findShowTranscriptButton(): HTMLElement | null {
  const selectors = [
    'ytd-video-description-transcript-section-renderer button',
    'button[aria-label*="transcript" i]',
    'a[aria-label*="transcript" i]',
    'yt-button-shape button[aria-label*="transcript" i]',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el) return el;
  }

  const clickables = document.querySelectorAll(
    'ytd-button-renderer button, yt-button-shape button, button, a'
  );
  for (const el of Array.from(clickables)) {
    if ((el.textContent || '').toLowerCase().includes('transcript')) {
      return el as HTMLElement;
    }
  }
  return null;
}

/** Attempts to open the transcript panel. Returns true if anything was clicked. */
async function openTranscriptPanel(): Promise<boolean> {
  let acted = false;

  // Some layouts only render the "Show transcript" control after the
  // description's "...more" expander is opened.
  const expand = document.querySelector(
    '#description-inline-expander #expand, tp-yt-paper-button#expand, #expand'
  ) as HTMLElement | null;
  if (expand) {
    expand.click();
    acted = true;
    await delay(400);
  }

  // Force the searchable-transcript engagement panel open (locale-independent).
  const panel = document.querySelector(
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]'
  );
  if (panel) {
    panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
    acted = true;
  }

  const btn = findShowTranscriptButton();
  if (btn) {
    btn.click();
    acted = true;
  }

  return acted;
}

async function scrapeTranscriptFromDom(
  videoId: string
): Promise<{ segments: TranscriptSegment[]; diag: string }> {
  // Only scrape when the page actually shows the requested video.
  if (getCurrentVideoId() !== videoId) {
    return { segments: [], diag: 'not on the video page' };
  }

  let rows = readTranscriptRows();
  if (rows.length === 0) {
    const opened = await openTranscriptPanel();
    const deadline = Date.now() + 6000;
    while (rows.length === 0 && Date.now() < deadline) {
      await delay(250);
      rows = readTranscriptRows();
    }
    if (rows.length === 0) {
      return {
        segments: [],
        diag: opened
          ? 'opened panel but no segments rendered'
          : 'no transcript control found',
      };
    }
  }

  const segments = buildSegmentsFromScrapedRows(rows);
  return { segments, diag: `scraped ${segments.length} segments` };
}

export default defineContentScript({
  matches: ['*://www.youtube.com/*', '*://youtube.com/*'],
  runAt: 'document_idle',

  main() {
    let currentVideoId: string | null = null;

    browser.runtime.onMessage.addListener(
      (message: any, _sender: any, sendResponse: any) => {
        if (message.type === 'EXTRACT_TRANSCRIPT') {
          handleExtractTranscript(message.videoId).then(sendResponse);
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
        title:
          titleEl?.textContent?.trim() ||
          document.title.replace(' - YouTube', ''),
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
