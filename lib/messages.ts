import type { GeneratedFlashcard, TranscriptSegment, VideoMetadata } from './types';

export type MessageType =
  | 'GET_TRANSCRIPT'
  | 'GENERATE_FLASHCARDS'
  | 'GET_DUE_COUNT'
  | 'OPEN_SIDEPANEL'
  | 'VIDEO_CHANGED'
  | 'GET_VIDEO_METADATA';

export interface GetTranscriptMessage {
  type: 'GET_TRANSCRIPT';
  videoId: string;
}

export interface GenerateFlashcardsMessage {
  type: 'GENERATE_FLASHCARDS';
  transcript: string;
  videoTitle: string;
  channel: string;
  cardCount: number;
}

export interface GetDueCountMessage {
  type: 'GET_DUE_COUNT';
}

export interface OpenSidepanelMessage {
  type: 'OPEN_SIDEPANEL';
}

export interface VideoChangedMessage {
  type: 'VIDEO_CHANGED';
  metadata: VideoMetadata;
}

export interface GetVideoMetadataMessage {
  type: 'GET_VIDEO_METADATA';
}

export type ExtensionMessage =
  | GetTranscriptMessage
  | GenerateFlashcardsMessage
  | GetDueCountMessage
  | OpenSidepanelMessage
  | VideoChangedMessage
  | GetVideoMetadataMessage;

export interface TranscriptResponse {
  success: boolean;
  segments?: TranscriptSegment[];
  fullText?: string;
  error?: string;
}

export interface FlashcardResponse {
  success: boolean;
  flashcards?: GeneratedFlashcard[];
  error?: string;
}

export interface DueCountResponse {
  count: number;
}

export interface VideoMetadataResponse {
  metadata: VideoMetadata | null;
}
