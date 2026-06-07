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
