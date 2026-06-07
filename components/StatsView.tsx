import { useState, useEffect } from 'react';
import { getReviewLogs, getTotalStats } from '@/lib/database';
import type { ReviewLog } from '@/lib/types';

export default function StatsView() {
  const [logs, setLogs] = useState<ReviewLog[]>([]);
  const [totalCards, setTotalCards] = useState(0);
  const [matureCards, setMatureCards] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    try {
      const [reviewLogs, stats] = await Promise.all([
        getReviewLogs(30),
        getTotalStats(),
      ]);
      setLogs(reviewLogs);
      setTotalCards(stats.totalCards);
      setMatureCards(stats.matureCards);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading stats...</div>
      </div>
    );
  }

  const totalReviews = logs.length;
  const correctReviews = logs.filter((l) => l.rating >= 2).length;
  const retentionRate =
    totalReviews > 0 ? Math.round((correctReviews / totalReviews) * 100) : 0;

  const reviewsByDay = new Map<string, number>();
  logs.forEach((log) => {
    const day = new Date(log.reviewedAt).toISOString().split('T')[0];
    reviewsByDay.set(day, (reviewsByDay.get(day) || 0) + 1);
  });

  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    if (reviewsByDay.has(key)) {
      streak++;
    } else if (i > 0) {
      break;
    }
  }

  const last30Days: { date: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    last30Days.push({ date: key, count: reviewsByDay.get(key) || 0 });
  }

  const maxReviews = Math.max(...last30Days.map((d) => d.count), 1);

  const learningCards = totalCards - matureCards;

  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-lg p-4 border border-gray-100 text-center">
          <div className="text-2xl font-bold text-indigo-600">{streak}</div>
          <div className="text-xs text-gray-500">Day Streak</div>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-100 text-center">
          <div className="text-2xl font-bold text-green-600">{retentionRate}%</div>
          <div className="text-xs text-gray-500">Retention Rate</div>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-100 text-center">
          <div className="text-2xl font-bold text-gray-800">{totalReviews}</div>
          <div className="text-xs text-gray-500">Total Reviews</div>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-100 text-center">
          <div className="text-2xl font-bold text-gray-800">{totalCards}</div>
          <div className="text-xs text-gray-500">Total Cards</div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">
          Reviews (Last 30 Days)
        </h3>
        <div className="bg-white rounded-lg border border-gray-100 p-3">
          <div className="flex items-end gap-0.5 h-24">
            {last30Days.map(({ date, count }) => (
              <div
                key={date}
                className="flex-1 bg-indigo-200 rounded-t-sm hover:bg-indigo-400 transition-colors relative group"
                style={{
                  height: `${(count / maxReviews) * 100}%`,
                  minHeight: count > 0 ? '4px' : '0',
                }}
              >
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 bg-gray-800 text-white text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none">
                  {count} reviews
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>30d ago</span>
            <span>Today</span>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">
          Card Maturity
        </h3>
        <div className="bg-white rounded-lg border border-gray-100 p-3">
          {totalCards > 0 ? (
            <>
              <div className="h-4 bg-gray-100 rounded-full overflow-hidden flex">
                <div
                  className="bg-green-500 h-full"
                  style={{
                    width: `${(matureCards / totalCards) * 100}%`,
                  }}
                />
                <div
                  className="bg-amber-400 h-full"
                  style={{
                    width: `${(learningCards / totalCards) * 100}%`,
                  }}
                />
              </div>
              <div className="flex gap-4 mt-2 text-xs">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-green-500 rounded-full" />
                  Mature ({matureCards})
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-amber-400 rounded-full" />
                  Learning ({learningCards})
                </span>
              </div>
            </>
          ) : (
            <div className="text-sm text-gray-400 text-center py-2">
              No cards yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
