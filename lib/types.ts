export interface TranscriptSegment {
  text: string;
  start: number;
  duration: number;
}

export interface Video {
  id: string;
  title: string;
  channel: string;
  thumbnailUrl: string;
  duration: number;
  transcript: string;
  language: string;
  createdAt: Date;
  cardCount: number;
}

export interface Card {
  id: string;
  videoId: string;
  question: string;
  answer: string;
  timestamp: number;
  topic: string;

  due: Date;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: number; // 0=New, 1=Learning, 2=Review, 3=Relearning
  last_review: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export interface ReviewLog {
  id: string;
  cardId: string;
  videoId: string;
  rating: number;
  state: number;
  due: Date;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  last_elapsed_days: number;
  scheduled_days: number;
  reviewedAt: Date;
}

export interface Settings {
  targetRetention: number;
  defaultCardCount: number;
  theme: 'light' | 'dark' | 'system';
  reviewReminder: boolean;
  reviewReminderTime: string;
  dailyReviewGoal: number;
}

export const DEFAULT_SETTINGS: Settings = {
  targetRetention: 0.9,
  defaultCardCount: 10,
  theme: 'system',
  reviewReminder: false,
  reviewReminderTime: '09:00',
  dailyReviewGoal: 20,
};

export interface GeneratedFlashcard {
  question: string;
  answer: string;
  timestamp: number;
  topic: string;
}

export interface VideoMetadata {
  videoId: string;
  title: string;
  channel: string;
  thumbnailUrl: string;
}
