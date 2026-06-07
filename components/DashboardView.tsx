import { useState, useEffect } from 'react';
import { getDueCardCount, getTotalStats, getAllVideos } from '@/lib/database';
import type { Video } from '@/lib/types';

interface Props {
  onStartReview: () => void;
  onGenerate: () => void;
}

export default function DashboardView({ onStartReview, onGenerate }: Props) {
  const [dueCount, setDueCount] = useState(0);
  const [totalCards, setTotalCards] = useState(0);
  const [totalVideos, setTotalVideos] = useState(0);
  const [matureCards, setMatureCards] = useState(0);
  const [recentVideos, setRecentVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [stats, videos] = await Promise.all([
        getTotalStats(),
        getAllVideos(),
      ]);
      setDueCount(stats.dueCards);
      setTotalCards(stats.totalCards);
      setTotalVideos(stats.totalVideos);
      setMatureCards(stats.matureCards);
      setRecentVideos(videos.slice(0, 3));
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (totalCards === 0) {
    return (
      <div className="p-6 text-center">
        <div className="text-5xl mb-4">🧠</div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">
          Welcome to RememberIt
        </h2>
        <p className="text-gray-600 mb-6">
          Transform YouTube videos into flashcards you'll actually remember.
          Go to a YouTube video and click "Generate" to get started.
        </p>
        <button
          onClick={onGenerate}
          className="bg-indigo-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-indigo-700 transition-colors"
        >
          Generate Your First Cards
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {dueCount > 0 ? (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 text-center">
          <div className="text-3xl font-bold text-indigo-600">{dueCount}</div>
          <div className="text-gray-600 mb-3">cards due for review</div>
          <button
            onClick={onStartReview}
            className="bg-indigo-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-indigo-700 transition-colors w-full"
          >
            Start Review
          </button>
        </div>
      ) : (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-center">
          <div className="text-3xl mb-1">✅</div>
          <div className="text-green-700 font-medium">You're all caught up!</div>
          <div className="text-gray-500 text-sm">No cards due right now</div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-lg p-3 text-center border border-gray-100">
          <div className="text-xl font-bold text-gray-800">{totalCards}</div>
          <div className="text-xs text-gray-500">Total Cards</div>
        </div>
        <div className="bg-white rounded-lg p-3 text-center border border-gray-100">
          <div className="text-xl font-bold text-gray-800">{totalVideos}</div>
          <div className="text-xs text-gray-500">Videos</div>
        </div>
        <div className="bg-white rounded-lg p-3 text-center border border-gray-100">
          <div className="text-xl font-bold text-gray-800">{matureCards}</div>
          <div className="text-xs text-gray-500">Mastered</div>
        </div>
      </div>

      {recentVideos.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Recent Videos</h3>
          <div className="space-y-2">
            {recentVideos.map((video) => (
              <div
                key={video.id}
                className="bg-white rounded-lg p-3 border border-gray-100 flex items-center gap-3"
              >
                <img
                  src={video.thumbnailUrl}
                  alt=""
                  className="w-16 h-10 rounded object-cover"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 truncate">
                    {video.title}
                  </div>
                  <div className="text-xs text-gray-500">
                    {video.cardCount} cards · {video.channel}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
