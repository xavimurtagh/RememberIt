import { useState, useEffect } from 'react';
import {
  getAllVideos,
  getCardsByVideo,
  deleteVideoAndCards,
  deleteCard,
  updateCard,
} from '@/lib/database';
import type { Video, Card } from '@/lib/types';

export default function LibraryView() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [expandedVideo, setExpandedVideo] = useState<string | null>(null);
  const [videoCards, setVideoCards] = useState<Card[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [editingCard, setEditingCard] = useState<string | null>(null);
  const [editQuestion, setEditQuestion] = useState('');
  const [editAnswer, setEditAnswer] = useState('');

  useEffect(() => {
    loadVideos();
  }, []);

  async function loadVideos() {
    try {
      const allVideos = await getAllVideos();
      setVideos(allVideos);
    } finally {
      setLoading(false);
    }
  }

  async function handleExpand(videoId: string) {
    if (expandedVideo === videoId) {
      setExpandedVideo(null);
      return;
    }
    const cards = await getCardsByVideo(videoId);
    setVideoCards(cards);
    setExpandedVideo(videoId);
  }

  async function handleDeleteVideo(videoId: string) {
    await deleteVideoAndCards(videoId);
    setVideos((prev) => prev.filter((v) => v.id !== videoId));
    if (expandedVideo === videoId) setExpandedVideo(null);
  }

  async function handleDeleteCard(cardId: string) {
    await deleteCard(cardId);
    setVideoCards((prev) => prev.filter((c) => c.id !== cardId));
  }

  function startEditing(card: Card) {
    setEditingCard(card.id);
    setEditQuestion(card.question);
    setEditAnswer(card.answer);
  }

  async function saveEdit(card: Card) {
    const updated = {
      ...card,
      question: editQuestion,
      answer: editAnswer,
      updatedAt: new Date(),
    };
    await updateCard(updated);
    setVideoCards((prev) =>
      prev.map((c) => (c.id === card.id ? updated : c))
    );
    setEditingCard(null);
  }

  const filtered = videos.filter(
    (v) =>
      v.title.toLowerCase().includes(search.toLowerCase()) ||
      v.channel.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading library...</div>
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="p-6 text-center">
        <div className="text-5xl mb-4">📚</div>
        <h2 className="text-lg font-bold text-gray-800 mb-2">
          Your library is empty
        </h2>
        <p className="text-gray-600 text-sm">
          Generate flashcards from a YouTube video to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search videos..."
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />

      {filtered.map((video) => (
        <div
          key={video.id}
          className="bg-white rounded-lg border border-gray-200 overflow-hidden"
        >
          <button
            onClick={() => handleExpand(video.id)}
            className="w-full p-3 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors"
          >
            <img
              src={video.thumbnailUrl}
              alt=""
              className="w-16 h-10 rounded object-cover shrink-0"
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-800 truncate">
                {video.title}
              </div>
              <div className="text-xs text-gray-500">
                {video.cardCount} cards · {video.channel}
              </div>
            </div>
            <span className="text-gray-400 text-sm">
              {expandedVideo === video.id ? '▲' : '▼'}
            </span>
          </button>

          {expandedVideo === video.id && (
            <div className="border-t border-gray-100 p-3 space-y-2">
              {videoCards.map((card) => (
                <div
                  key={card.id}
                  className="bg-gray-50 rounded-lg p-3 text-sm"
                >
                  {editingCard === card.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={editQuestion}
                        onChange={(e) => setEditQuestion(e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm resize-none"
                        rows={2}
                      />
                      <textarea
                        value={editAnswer}
                        onChange={(e) => setEditAnswer(e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm resize-none"
                        rows={3}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => saveEdit(card)}
                          className="text-xs text-indigo-600 hover:text-indigo-800"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingCard(null)}
                          className="text-xs text-gray-500 hover:text-gray-700"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="font-medium text-gray-800 mb-1">
                        {card.question}
                      </div>
                      <div className="text-gray-600">{card.answer}</div>
                      <div className="flex gap-3 mt-2">
                        <span className="text-xs text-gray-400">
                          {card.state === 0
                            ? 'New'
                            : card.state === 1
                              ? 'Learning'
                              : card.state === 2
                                ? 'Mature'
                                : 'Relearning'}{' '}
                          · {card.reps} reviews
                        </span>
                        <button
                          onClick={() => startEditing(card)}
                          className="text-xs text-indigo-600 hover:text-indigo-800"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteCard(card.id)}
                          className="text-xs text-red-500 hover:text-red-700"
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}

              <button
                onClick={() => handleDeleteVideo(video.id)}
                className="text-xs text-red-500 hover:text-red-700 mt-2"
              >
                Delete video and all cards
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
