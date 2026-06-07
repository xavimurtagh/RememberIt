import { describe, it, expect, beforeEach } from 'vitest';
import {
  db,
  saveVideo,
  saveCards,
  updateCard,
  deleteCard,
  deleteVideoAndCards,
  getDueCards,
  getDueCardCount,
  getAllVideos,
  getVideoWithCards,
  getCardsByVideo,
  saveReviewLog,
  getReviewLogs,
  getTotalStats,
} from '@/lib/database';
import { createCardFromFlashcard } from '@/lib/scheduler';
import type { Video, ReviewLog } from '@/lib/types';
import { v4 as uuidv4 } from 'uuid';

function makeVideo(id: string, title?: string): Video {
  return {
    id,
    title: title || `Video ${id}`,
    channel: 'Test Channel',
    thumbnailUrl: `https://img.youtube.com/vi/${id}/mqdefault.jpg`,
    duration: 600,
    transcript: 'Test transcript text',
    language: 'en',
    createdAt: new Date(),
    cardCount: 0,
  };
}

describe('Database', () => {
  beforeEach(async () => {
    await db.cards.clear();
    await db.videos.clear();
    await db.reviewLogs.clear();
  });

  describe('Videos CRUD', () => {
    it('saves and retrieves a video', async () => {
      const video = makeVideo('abc123', 'Test Video');
      await saveVideo(video);

      const videos = await getAllVideos();
      expect(videos).toHaveLength(1);
      expect(videos[0].id).toBe('abc123');
      expect(videos[0].title).toBe('Test Video');
    });

    it('returns videos sorted by creation date (newest first)', async () => {
      const v1 = { ...makeVideo('v1'), createdAt: new Date('2024-01-01') };
      const v2 = { ...makeVideo('v2'), createdAt: new Date('2024-06-01') };
      const v3 = { ...makeVideo('v3'), createdAt: new Date('2024-03-01') };

      await saveVideo(v1);
      await saveVideo(v2);
      await saveVideo(v3);

      const videos = await getAllVideos();
      expect(videos[0].id).toBe('v2');
      expect(videos[1].id).toBe('v3');
      expect(videos[2].id).toBe('v1');
    });

    it('updates an existing video (upsert)', async () => {
      await saveVideo(makeVideo('v1', 'Original'));
      await saveVideo({ ...makeVideo('v1', 'Updated') });

      const videos = await getAllVideos();
      expect(videos).toHaveLength(1);
      expect(videos[0].title).toBe('Updated');
    });
  });

  describe('Cards CRUD', () => {
    it('saves and retrieves cards', async () => {
      const cards = [
        createCardFromFlashcard(
          { question: 'Q1', answer: 'A1', timestamp: 10, topic: 'T1' },
          'video1'
        ),
        createCardFromFlashcard(
          { question: 'Q2', answer: 'A2', timestamp: 20, topic: 'T2' },
          'video1'
        ),
      ];

      await saveCards(cards);

      const retrieved = await getCardsByVideo('video1');
      expect(retrieved).toHaveLength(2);
    });

    it('updates a card', async () => {
      const card = createCardFromFlashcard(
        { question: 'Original Q', answer: 'A', timestamp: 0, topic: 'T' },
        'v1'
      );
      await saveCards([card]);

      card.question = 'Updated Q';
      card.updatedAt = new Date();
      await updateCard(card);

      const cards = await getCardsByVideo('v1');
      expect(cards[0].question).toBe('Updated Q');
    });

    it('deletes a card and its review logs', async () => {
      const card = createCardFromFlashcard(
        { question: 'Q', answer: 'A', timestamp: 0, topic: 'T' },
        'v1'
      );
      await saveCards([card]);

      const log: ReviewLog = {
        id: uuidv4(),
        cardId: card.id,
        videoId: 'v1',
        rating: 2,
        state: 0,
        due: new Date(),
        stability: 0,
        difficulty: 0,
        elapsed_days: 0,
        last_elapsed_days: 0,
        scheduled_days: 1,
        reviewedAt: new Date(),
      };
      await saveReviewLog(log);

      await deleteCard(card.id);

      const cards = await getCardsByVideo('v1');
      expect(cards).toHaveLength(0);
    });
  });

  describe('Due Cards', () => {
    it('returns cards that are due now', async () => {
      const dueCard = createCardFromFlashcard(
        { question: 'Due', answer: 'A', timestamp: 0, topic: 'T' },
        'v1'
      );
      dueCard.due = new Date(Date.now() - 1000); // Due in the past

      const futureCard = createCardFromFlashcard(
        { question: 'Future', answer: 'A', timestamp: 0, topic: 'T' },
        'v1'
      );
      futureCard.due = new Date(Date.now() + 86400000); // Due tomorrow

      await saveCards([dueCard, futureCard]);

      const due = await getDueCards();
      expect(due).toHaveLength(1);
      expect(due[0].question).toBe('Due');
    });

    it('filters due cards by video ID', async () => {
      const card1 = createCardFromFlashcard(
        { question: 'Q1', answer: 'A1', timestamp: 0, topic: 'T' },
        'v1'
      );
      card1.due = new Date(Date.now() - 1000);

      const card2 = createCardFromFlashcard(
        { question: 'Q2', answer: 'A2', timestamp: 0, topic: 'T' },
        'v2'
      );
      card2.due = new Date(Date.now() - 1000);

      await saveCards([card1, card2]);

      const dueV1 = await getDueCards('v1');
      expect(dueV1).toHaveLength(1);
      expect(dueV1[0].videoId).toBe('v1');
    });

    it('returns correct due card count', async () => {
      const cards = Array.from({ length: 5 }, (_, i) => {
        const card = createCardFromFlashcard(
          { question: `Q${i}`, answer: `A${i}`, timestamp: 0, topic: 'T' },
          'v1'
        );
        card.due = new Date(Date.now() - 1000);
        return card;
      });

      await saveCards(cards);

      const count = await getDueCardCount();
      expect(count).toBe(5);
    });
  });

  describe('Video with Cards', () => {
    it('returns video and its cards together', async () => {
      const video = makeVideo('v1');
      await saveVideo(video);

      const cards = [
        createCardFromFlashcard(
          { question: 'Q1', answer: 'A1', timestamp: 0, topic: 'T' },
          'v1'
        ),
        createCardFromFlashcard(
          { question: 'Q2', answer: 'A2', timestamp: 0, topic: 'T' },
          'v1'
        ),
      ];
      await saveCards(cards);

      const result = await getVideoWithCards('v1');
      expect(result.video?.title).toBe('Video v1');
      expect(result.cards).toHaveLength(2);
    });

    it('returns undefined video for non-existent ID', async () => {
      const result = await getVideoWithCards('nonexistent');
      expect(result.video).toBeUndefined();
      expect(result.cards).toHaveLength(0);
    });
  });

  describe('Delete Video and Cards', () => {
    it('deletes a video, its cards, and review logs', async () => {
      const video = makeVideo('v1');
      await saveVideo(video);

      const card = createCardFromFlashcard(
        { question: 'Q', answer: 'A', timestamp: 0, topic: 'T' },
        'v1'
      );
      await saveCards([card]);

      const log: ReviewLog = {
        id: uuidv4(),
        cardId: card.id,
        videoId: 'v1',
        rating: 2,
        state: 0,
        due: new Date(),
        stability: 0,
        difficulty: 0,
        elapsed_days: 0,
        last_elapsed_days: 0,
        scheduled_days: 1,
        reviewedAt: new Date(),
      };
      await saveReviewLog(log);

      await deleteVideoAndCards('v1');

      const videos = await getAllVideos();
      expect(videos).toHaveLength(0);

      const cards = await getCardsByVideo('v1');
      expect(cards).toHaveLength(0);
    });
  });

  describe('Review Logs', () => {
    it('saves and retrieves review logs', async () => {
      const log: ReviewLog = {
        id: uuidv4(),
        cardId: 'card1',
        videoId: 'v1',
        rating: 2,
        state: 0,
        due: new Date(),
        stability: 1,
        difficulty: 5,
        elapsed_days: 0,
        last_elapsed_days: 0,
        scheduled_days: 1,
        reviewedAt: new Date(),
      };

      await saveReviewLog(log);

      const logs = await getReviewLogs(30);
      expect(logs).toHaveLength(1);
      expect(logs[0].rating).toBe(2);
    });

    it('only returns logs within the specified day range', async () => {
      const recentLog: ReviewLog = {
        id: uuidv4(),
        cardId: 'card1',
        videoId: 'v1',
        rating: 2,
        state: 0,
        due: new Date(),
        stability: 1,
        difficulty: 5,
        elapsed_days: 0,
        last_elapsed_days: 0,
        scheduled_days: 1,
        reviewedAt: new Date(),
      };

      const oldLog: ReviewLog = {
        ...recentLog,
        id: uuidv4(),
        reviewedAt: new Date(Date.now() - 60 * 86400000), // 60 days ago
      };

      await saveReviewLog(recentLog);
      await saveReviewLog(oldLog);

      const logs = await getReviewLogs(30);
      expect(logs).toHaveLength(1);
    });
  });

  describe('Total Stats', () => {
    it('returns correct aggregate statistics', async () => {
      const video = makeVideo('v1');
      await saveVideo(video);

      const dueCard = createCardFromFlashcard(
        { question: 'Due Q', answer: 'A', timestamp: 0, topic: 'T' },
        'v1'
      );
      dueCard.due = new Date(Date.now() - 1000);

      const matureCard = createCardFromFlashcard(
        { question: 'Mature Q', answer: 'A', timestamp: 0, topic: 'T' },
        'v1'
      );
      matureCard.state = 2; // Mature/Review state
      matureCard.due = new Date(Date.now() + 86400000);

      await saveCards([dueCard, matureCard]);

      const stats = await getTotalStats();
      expect(stats.totalCards).toBe(2);
      expect(stats.totalVideos).toBe(1);
      expect(stats.dueCards).toBe(1);
      expect(stats.matureCards).toBe(1);
    });
  });
});
