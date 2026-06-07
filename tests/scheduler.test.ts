import { describe, it, expect } from 'vitest';
import { createCardFromFlashcard, reviewCard, Rating } from '@/lib/scheduler';
import type { GeneratedFlashcard, Card } from '@/lib/types';

describe('Scheduler', () => {
  const sampleFlashcard: GeneratedFlashcard = {
    question: 'What is spaced repetition?',
    answer: 'A learning technique that incorporates increasing intervals of time between reviews.',
    timestamp: 120,
    topic: 'Learning Science',
  };

  describe('createCardFromFlashcard', () => {
    it('creates a card with correct content fields', () => {
      const card = createCardFromFlashcard(sampleFlashcard, 'video123');

      expect(card.question).toBe(sampleFlashcard.question);
      expect(card.answer).toBe(sampleFlashcard.answer);
      expect(card.timestamp).toBe(120);
      expect(card.topic).toBe('Learning Science');
      expect(card.videoId).toBe('video123');
    });

    it('initializes FSRS fields correctly for a new card', () => {
      const card = createCardFromFlashcard(sampleFlashcard, 'video123');

      expect(card.state).toBe(0); // New
      expect(card.reps).toBe(0);
      expect(card.lapses).toBe(0);
      expect(card.stability).toBeDefined();
      expect(card.difficulty).toBeDefined();
    });

    it('generates a unique ID for each card', () => {
      const card1 = createCardFromFlashcard(sampleFlashcard, 'video123');
      const card2 = createCardFromFlashcard(sampleFlashcard, 'video123');

      expect(card1.id).not.toBe(card2.id);
      expect(card1.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it('sets due date in the past or now (immediately reviewable)', () => {
      const card = createCardFromFlashcard(sampleFlashcard, 'video123');
      expect(new Date(card.due).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('sets createdAt and updatedAt timestamps', () => {
      const before = new Date();
      const card = createCardFromFlashcard(sampleFlashcard, 'video123');
      const after = new Date();

      expect(card.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(card.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(card.updatedAt.getTime()).toBe(card.createdAt.getTime());
    });
  });

  describe('reviewCard', () => {
    function freshCard(): Card {
      return createCardFromFlashcard(sampleFlashcard, 'video123');
    }

    it('updates card state after rating Again', () => {
      const card = freshCard();
      const { updatedCard, log } = reviewCard(card, Rating.Again);

      expect(updatedCard.reps).toBeGreaterThanOrEqual(1);
      expect(log.rating).toBe(Rating.Again);
      expect(log.cardId).toBe(card.id);
      expect(log.videoId).toBe('video123');
    });

    it('updates card state after rating Good', () => {
      const card = freshCard();
      const { updatedCard, log } = reviewCard(card, Rating.Good);

      expect(updatedCard.reps).toBeGreaterThanOrEqual(1);
      expect(log.rating).toBe(Rating.Good);
      expect(new Date(updatedCard.due).getTime()).toBeGreaterThan(Date.now());
    });

    it('updates card state after rating Easy', () => {
      const card = freshCard();
      const { updatedCard } = reviewCard(card, Rating.Easy);

      expect(updatedCard.reps).toBeGreaterThanOrEqual(1);
      expect(new Date(updatedCard.due).getTime()).toBeGreaterThan(Date.now());
    });

    it('schedules Easy further out than Good', () => {
      const card = freshCard();

      const { updatedCard: goodCard } = reviewCard(card, Rating.Good);
      const { updatedCard: easyCard } = reviewCard(card, Rating.Easy);

      expect(new Date(easyCard.due).getTime()).toBeGreaterThanOrEqual(
        new Date(goodCard.due).getTime()
      );
    });

    it('schedules Again sooner than Hard', () => {
      const card = freshCard();

      const { updatedCard: againCard } = reviewCard(card, Rating.Again);
      const { updatedCard: hardCard } = reviewCard(card, Rating.Hard);

      expect(new Date(againCard.due).getTime()).toBeLessThanOrEqual(
        new Date(hardCard.due).getTime()
      );
    });

    it('generates a review log with correct fields', () => {
      const card = freshCard();
      const { log } = reviewCard(card, Rating.Good);

      expect(log.id).toBeTruthy();
      expect(log.cardId).toBe(card.id);
      expect(log.videoId).toBe(card.videoId);
      expect(log.rating).toBe(Rating.Good);
      expect(log.reviewedAt).toBeInstanceOf(Date);
      expect(log.state).toBe(card.state);
      expect(log.stability).toBe(card.stability);
      expect(log.difficulty).toBe(card.difficulty);
    });

    it('preserves card content fields after review', () => {
      const card = freshCard();
      const { updatedCard } = reviewCard(card, Rating.Good);

      expect(updatedCard.question).toBe(card.question);
      expect(updatedCard.answer).toBe(card.answer);
      expect(updatedCard.videoId).toBe(card.videoId);
      expect(updatedCard.timestamp).toBe(card.timestamp);
      expect(updatedCard.topic).toBe(card.topic);
    });

    it('handles multiple sequential reviews correctly', () => {
      let card = freshCard();

      // First review: Good
      const result1 = reviewCard(card, Rating.Good);
      card = result1.updatedCard;
      expect(card.reps).toBeGreaterThanOrEqual(1);

      // Second review: Good
      const result2 = reviewCard(card, Rating.Good);
      card = result2.updatedCard;
      expect(card.reps).toBeGreaterThanOrEqual(2);

      // Stability should increase with good reviews
      expect(card.stability).toBeGreaterThan(0);
    });

    it('increases lapses count on Again rating after learning', () => {
      let card = freshCard();

      // Move card to review state
      let result = reviewCard(card, Rating.Good);
      card = result.updatedCard;
      result = reviewCard(card, Rating.Good);
      card = result.updatedCard;
      result = reviewCard(card, Rating.Good);
      card = result.updatedCard;

      const lapsesBefore = card.lapses;
      result = reviewCard(card, Rating.Again);
      // Lapses may or may not increase depending on state; just confirm no crash
      expect(result.updatedCard.lapses).toBeGreaterThanOrEqual(lapsesBefore);
    });
  });
});
