import { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { saveVideo, saveCards, getVideoWithCards } from '@/lib/database';
import { createCardFromFlashcard } from '@/lib/scheduler';
import type {
  VideoMetadata,
  GeneratedFlashcard,
  Video,
  Settings,
} from '@/lib/types';
import { DEFAULT_SETTINGS } from '@/lib/types';
import type { TranscriptResponse, FlashcardResponse } from '@/lib/messages';

interface Props {
  currentVideo: VideoMetadata | null;
  onSaved: () => void;
}

export default function GenerateView({ currentVideo, onSaved }: Props) {
  const [videoId, setVideoId] = useState('');
  const [metadata, setMetadata] = useState<VideoMetadata | null>(currentVideo);
  const [cardCount, setCardCount] = useState(10);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [flashcards, setFlashcards] = useState<GeneratedFlashcard[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [alreadyHasCards, setAlreadyHasCards] = useState(false);
  const [transcript, setTranscript] = useState('');

  useEffect(() => {
    if (currentVideo) {
      setMetadata(currentVideo);
      setVideoId(currentVideo.videoId);
      checkExisting(currentVideo.videoId);
    }
  }, [currentVideo]);

  async function checkExisting(vid: string) {
    const { cards } = await getVideoWithCards(vid);
    setAlreadyHasCards(cards.length > 0);
  }

  function extractVideoId(input: string): string {
    const match = input.match(
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/
    );
    if (match) return match[1];
    if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
    return '';
  }

  async function handleGenerate() {
    const vid = metadata?.videoId || extractVideoId(videoId);
    if (!vid) {
      setError('Please enter a valid YouTube video URL or ID');
      return;
    }

    setLoading(true);
    setError('');
    setFlashcards([]);

    try {
      setStatus('Extracting transcript...');
      const transcriptRes: TranscriptResponse = await browser.runtime.sendMessage({
        type: 'GET_TRANSCRIPT',
        videoId: vid,
      });

      if (!transcriptRes.success || !transcriptRes.fullText) {
        throw new Error(transcriptRes.error || 'Failed to extract transcript');
      }

      setTranscript(transcriptRes.fullText);

      const meta = metadata || {
        videoId: vid,
        title: `Video ${vid}`,
        channel: 'Unknown',
        thumbnailUrl: `https://img.youtube.com/vi/${vid}/mqdefault.jpg`,
      };
      setMetadata(meta);

      setStatus('Generating flashcards with AI...');
      const flashcardRes: FlashcardResponse = await browser.runtime.sendMessage({
        type: 'GENERATE_FLASHCARDS',
        transcript: transcriptRes.fullText,
        videoTitle: meta.title,
        channel: meta.channel,
        cardCount,
      });

      if (!flashcardRes.success || !flashcardRes.flashcards) {
        throw new Error(flashcardRes.error || 'Failed to generate flashcards');
      }

      setFlashcards(flashcardRes.flashcards);
      setStatus('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred');
      setStatus('');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!metadata || flashcards.length === 0) return;

    const video: Video = {
      id: metadata.videoId,
      title: metadata.title,
      channel: metadata.channel,
      thumbnailUrl: metadata.thumbnailUrl,
      duration: 0,
      transcript,
      language: 'en',
      createdAt: new Date(),
      cardCount: flashcards.length,
    };

    const cards = flashcards.map((fc) =>
      createCardFromFlashcard(fc, metadata.videoId)
    );

    await saveVideo(video);
    await saveCards(cards);

    setFlashcards([]);
    setStatus('');
    onSaved();
  }

  function handleRemoveCard(index: number) {
    setFlashcards((prev) => prev.filter((_, i) => i !== index));
  }

  function handleEditCard(
    index: number,
    field: 'question' | 'answer',
    value: string
  ) {
    setFlashcards((prev) =>
      prev.map((fc, i) => (i === index ? { ...fc, [field]: value } : fc))
    );
  }

  return (
    <div className="p-4 space-y-4">
      {metadata ? (
        <div className="bg-white rounded-lg p-3 border border-gray-100 flex items-center gap-3">
          <img
            src={metadata.thumbnailUrl}
            alt=""
            className="w-20 h-12 rounded object-cover"
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-800 truncate">
              {metadata.title}
            </div>
            <div className="text-xs text-gray-500">{metadata.channel}</div>
            {alreadyHasCards && (
              <div className="text-xs text-amber-600 mt-0.5">
                Cards already exist for this video
              </div>
            )}
          </div>
        </div>
      ) : (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            YouTube Video URL or ID
          </label>
          <input
            type="text"
            value={videoId}
            onChange={(e) => setVideoId(e.target.value)}
            placeholder="https://youtube.com/watch?v=... or video ID"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      )}

      {flashcards.length === 0 && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Number of flashcards
            </label>
            <select
              value={cardCount}
              onChange={(e) => setCardCount(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {[5, 8, 10, 15, 20].map((n) => (
                <option key={n} value={n}>
                  {n} cards
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleGenerate}
            disabled={loading}
            className="w-full bg-indigo-600 text-white py-3 rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? status || 'Processing...' : 'Generate Flashcards'}
          </button>
        </>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {flashcards.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">
              {flashcards.length} Cards Generated
            </h3>
            <button
              onClick={handleSave}
              className="bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
            >
              Save to Library
            </button>
          </div>

          <div className="space-y-3">
            {flashcards.map((fc, i) => (
              <div
                key={i}
                className="bg-white rounded-lg border border-gray-200 p-3"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">
                    {fc.topic}
                  </span>
                  <div className="flex gap-1">
                    <button
                      onClick={() =>
                        setEditingIndex(editingIndex === i ? null : i)
                      }
                      className="text-gray-400 hover:text-indigo-600 text-xs"
                    >
                      {editingIndex === i ? 'Done' : 'Edit'}
                    </button>
                    <button
                      onClick={() => handleRemoveCard(i)}
                      className="text-gray-400 hover:text-red-600 text-xs"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {editingIndex === i ? (
                  <div className="space-y-2">
                    <textarea
                      value={fc.question}
                      onChange={(e) =>
                        handleEditCard(i, 'question', e.target.value)
                      }
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm resize-none"
                      rows={2}
                    />
                    <textarea
                      value={fc.answer}
                      onChange={(e) =>
                        handleEditCard(i, 'answer', e.target.value)
                      }
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm resize-none"
                      rows={3}
                    />
                  </div>
                ) : (
                  <>
                    <div className="text-sm font-medium text-gray-800 mb-1">
                      Q: {fc.question}
                    </div>
                    <div className="text-sm text-gray-600">A: {fc.answer}</div>
                  </>
                )}
              </div>
            ))}
          </div>

          <button
            onClick={handleSave}
            className="w-full bg-indigo-600 text-white py-3 rounded-lg font-medium hover:bg-indigo-700 transition-colors"
          >
            Save All {flashcards.length} Cards to Library
          </button>
        </>
      )}
    </div>
  );
}
