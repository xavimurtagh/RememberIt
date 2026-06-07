import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  type Card as FSRSCard,
  type Grade,
  type RecordLog,
} from 'ts-fsrs';
import { v4 as uuidv4 } from 'uuid';
import type { Card, GeneratedFlashcard, ReviewLog } from './types';

const params = generatorParameters({ request_retention: 0.9 });
const scheduler = fsrs(params);

export function createCardFromFlashcard(
  flashcard: GeneratedFlashcard,
  videoId: string
): Card {
  const emptyCard = createEmptyCard();
  const now = new Date();
  return {
    id: uuidv4(),
    videoId,
    question: flashcard.question,
    answer: flashcard.answer,
    timestamp: flashcard.timestamp,
    topic: flashcard.topic,
    due: emptyCard.due,
    stability: emptyCard.stability,
    difficulty: emptyCard.difficulty,
    elapsed_days: emptyCard.elapsed_days,
    scheduled_days: emptyCard.scheduled_days,
    reps: emptyCard.reps,
    lapses: emptyCard.lapses,
    state: emptyCard.state,
    last_review: emptyCard.last_review ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

export function reviewCard(
  card: Card,
  rating: Grade
): { updatedCard: Card; log: ReviewLog } {
  const now = new Date();

  const fsrsCard: FSRSCard = {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: 0,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? new Date(card.last_review) : undefined,
  };

  const scheduling: RecordLog = scheduler.repeat(fsrsCard, now);
  const result = scheduling[rating];

  const updatedCard: Card = {
    ...card,
    due: result.card.due,
    stability: result.card.stability,
    difficulty: result.card.difficulty,
    elapsed_days: result.card.elapsed_days,
    scheduled_days: result.card.scheduled_days,
    reps: result.card.reps,
    lapses: result.card.lapses,
    state: result.card.state,
    last_review: result.card.last_review ?? null,
    updatedAt: now,
  };

  const log: ReviewLog = {
    id: uuidv4(),
    cardId: card.id,
    videoId: card.videoId,
    rating,
    state: card.state,
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: result.log.elapsed_days,
    last_elapsed_days: card.elapsed_days,
    scheduled_days: result.card.scheduled_days,
    reviewedAt: now,
  };

  return { updatedCard, log };
}

export { Rating };
