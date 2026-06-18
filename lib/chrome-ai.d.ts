interface LanguageModelSession {
  prompt(input: string): Promise<string>;
  promptStreaming(input: string): ReadableStream<string>;
  destroy(): void;
  contextWindow: number;
  contextUsage: number;
}

interface LanguageModelCreateOptions {
  systemPrompt?: string;
  initialPrompts?: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  temperature?: number;
  topK?: number;
  expectedInputLanguages?: string[];
  expectedOutputLanguages?: string[];
  monitor?: (monitor: EventTarget) => void;
}

type AIAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

declare const LanguageModel: {
  availability(options?: Record<string, unknown>): Promise<AIAvailability>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
  params(): Promise<{
    defaultTemperature: number;
    defaultTopK: number;
    maxTemperature: number;
    maxTopK: number;
  }>;
};
