import { getDueCardCount } from '@/lib/database';
import { fetchTranscript } from '@/lib/transcript';
import { generateFlashcards } from '@/lib/ai';
import type {
  ExtensionMessage,
  TranscriptResponse,
  FlashcardResponse,
  DueCountResponse,
} from '@/lib/messages';

export default defineBackground(() => {
  updateBadge();

  browser.alarms.create('updateBadge', { periodInMinutes: 60 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'updateBadge') {
      updateBadge();
    }
  });

  browser.runtime.onMessage.addListener(
    (message: ExtensionMessage, _sender, sendResponse) => {
      handleMessage(message).then(sendResponse);
      return true;
    }
  );

  browser.action.onClicked.addListener(async (tab) => {
    if (tab.id) {
      await browser.sidePanel.open({ tabId: tab.id });
    }
  });
});

async function handleMessage(
  message: ExtensionMessage
): Promise<TranscriptResponse | FlashcardResponse | DueCountResponse | void> {
  switch (message.type) {
    case 'GET_TRANSCRIPT': {
      // Primary: ask the content script to extract the transcript in the page
      // context. Caption downloads there are same-origin (with cookies), which
      // succeeds where cross-origin service-worker fetches get blocked.
      try {
        const tab = await findYouTubeTab(message.videoId);
        if (tab?.id) {
          const resp = await browser.tabs.sendMessage(tab.id, {
            type: 'EXTRACT_TRANSCRIPT',
            videoId: message.videoId,
          });
          if (resp?.success && resp.segments?.length) {
            return {
              success: true,
              segments: resp.segments,
              fullText: resp.fullText,
            };
          }
        }
      } catch {
        // content script unavailable or page mismatch — fall through
      }

      // Fallback: fetch via InnerTube from the service worker.
      try {
        const result = await fetchTranscript(message.videoId);
        return {
          success: true,
          segments: result.segments,
          fullText: result.fullText,
        };
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : 'Failed to fetch transcript',
        };
      }
    }
    case 'GENERATE_FLASHCARDS': {
      try {
        const { flashcards, backend } = await generateFlashcards(
          message.transcript,
          message.videoTitle,
          message.channel,
          message.cardCount,
          message.segments
        );
        return { success: true, flashcards, backend };
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : 'Failed to generate flashcards',
        };
      }
    }
    case 'GET_DUE_COUNT': {
      const count = await getDueCardCount();
      return { count };
    }
    case 'VIDEO_CHANGED': {
      return;
    }
    default:
      return;
  }
}

/**
 * Finds an open YouTube tab to run page-context extraction in. Prefers the
 * active tab in the current window; otherwise returns any YouTube watch tab for
 * the target video (the content script verifies the videoId matches the page).
 */
async function findYouTubeTab(
  videoId: string
): Promise<chrome.tabs.Tab | undefined> {
  try {
    const [active] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (active?.url?.includes('youtube.com')) return active;
  } catch {
    // ignore
  }

  try {
    const ytTabs = await browser.tabs.query({ url: '*://*.youtube.com/*' });
    const match = ytTabs.find((t) => t.url?.includes(videoId));
    return match || ytTabs[0];
  } catch {
    return undefined;
  }
}

async function updateBadge(): Promise<void> {
  try {
    const count = await getDueCardCount();
    const text = count > 0 ? String(count > 99 ? '99+' : count) : '';
    await browser.action.setBadgeText({ text });
    if (count > 0) {
      await browser.action.setBadgeBackgroundColor({ color: '#6366f1' });
    }
  } catch {
    // DB may not be initialized yet
  }
}
