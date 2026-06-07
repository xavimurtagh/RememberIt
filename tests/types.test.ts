import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from '@/lib/types';

describe('Types and Constants', () => {
  describe('DEFAULT_SETTINGS', () => {
    it('has sensible default values', () => {
      expect(DEFAULT_SETTINGS.targetRetention).toBe(0.9);
      expect(DEFAULT_SETTINGS.defaultCardCount).toBe(10);
      expect(DEFAULT_SETTINGS.theme).toBe('system');
      expect(DEFAULT_SETTINGS.reviewReminder).toBe(false);
      expect(DEFAULT_SETTINGS.reviewReminderTime).toBe('09:00');
      expect(DEFAULT_SETTINGS.dailyReviewGoal).toBe(20);
    });

    it('has valid retention range', () => {
      expect(DEFAULT_SETTINGS.targetRetention).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_SETTINGS.targetRetention).toBeLessThanOrEqual(1);
    });

    it('has valid card count', () => {
      expect(DEFAULT_SETTINGS.defaultCardCount).toBeGreaterThan(0);
      expect(DEFAULT_SETTINGS.defaultCardCount).toBeLessThanOrEqual(50);
    });
  });
});
