import Dexie, { type Table } from 'dexie';
import type { Video, Card, ReviewLog } from './types';

export class RememberItDB extends Dexie {
  videos!: Table<Video>;
  cards!: Table<Card>;
  reviewLogs!: Table<ReviewLog>;

  constructor() {
    super('RememberItDB');
    this.version(1).stores({
      videos: 'id, createdAt',
      cards: 'id, videoId, due, state, createdAt',
      reviewLogs: 'id, cardId, videoId, reviewedAt',
    });
  }
}

export const db = new RememberItDB();

export async function getDueCards(videoId?: string): Promise<Card[]> {
  const now = new Date();
  let query = db.cards.where('due').belowOrEqual(now);
  const cards = await query.toArray();
  if (videoId) {
    return cards.filter((c) => c.videoId === videoId);
  }
  return cards;
}

export async function getDueCardCount(): Promise<number> {
  const now = new Date();
  return db.cards.where('due').belowOrEqual(now).count();
}

export async function getVideoWithCards(
  videoId: string
): Promise<{ video: Video | undefined; cards: Card[] }> {
  const video = await db.videos.get(videoId);
  const cards = await db.cards.where('videoId').equals(videoId).toArray();
  return { video, cards };
}

export async function getAllVideos(): Promise<Video[]> {
  return db.videos.orderBy('createdAt').reverse().toArray();
}

export async function saveVideo(video: Video): Promise<void> {
  await db.videos.put(video);
}

export async function saveCards(cards: Card[]): Promise<void> {
  await db.cards.bulkPut(cards);
}

export async function updateCard(card: Card): Promise<void> {
  await db.cards.put(card);
}

export async function deleteCard(cardId: string): Promise<void> {
  await db.cards.delete(cardId);
  await db.reviewLogs.where('cardId').equals(cardId).delete();
}

export async function deleteVideoAndCards(videoId: string): Promise<void> {
  await db.cards.where('videoId').equals(videoId).delete();
  await db.reviewLogs.where('videoId').equals(videoId).delete();
  await db.videos.delete(videoId);
}

export async function saveReviewLog(log: ReviewLog): Promise<void> {
  await db.reviewLogs.add(log);
}

export async function getReviewLogs(
  days: number = 30
): Promise<ReviewLog[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  return db.reviewLogs.where('reviewedAt').aboveOrEqual(since).toArray();
}

export async function getCardsByVideo(videoId: string): Promise<Card[]> {
  return db.cards.where('videoId').equals(videoId).toArray();
}

export async function getTotalStats(): Promise<{
  totalCards: number;
  totalVideos: number;
  dueCards: number;
  matureCards: number;
}> {
  const now = new Date();
  const [totalCards, totalVideos, dueCards, matureCards] = await Promise.all([
    db.cards.count(),
    db.videos.count(),
    db.cards.where('due').belowOrEqual(now).count(),
    db.cards.where('state').equals(2).count(),
  ]);
  return { totalCards, totalVideos, dueCards, matureCards };
}
