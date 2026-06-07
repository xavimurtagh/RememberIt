import { useState, useEffect, useCallback } from 'react';
import { getDueCards, updateCard, saveReviewLog } from '@/lib/database';
import { reviewCard, Rating } from '@/lib/scheduler';
import type { Grade } from 'ts-fsrs';
import type { Card } from '@/lib/types';

export default function ReviewView() {
  const [cards, setCards] = useState<Card[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [reviewed, setReviewed] = useState(0);

  useEffect(() => {
    loadDueCards();
  }, []);

  async function loadDueCards() {
    try {
      const dueCards = await getDueCards();
      setCards(dueCards);
      if (dueCards.length === 0) {
        setSessionComplete(true);
      }
    } finally {
      setLoading(false);
    }
  }

  const handleRate = useCallback(
    async (rating: Grade) => {
      const card = cards[currentIndex];
      if (!card) return;

      const { updatedCard, log } = reviewCard(card, rating);
      await Promise.all([updateCard(updatedCard), saveReviewLog(log)]);

      setReviewed((r) => r + 1);
      setShowAnswer(false);

      if (currentIndex + 1 >= cards.length) {
        setSessionComplete(true);
      } else {
        setCurrentIndex((i) => i + 1);
      }
    },
    [cards, currentIndex]
  );

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!showAnswer) {
        if (e.code === 'Space') {
          e.preventDefault();
          setShowAnswer(true);
        }
        return;
      }
      switch (e.key) {
        case '1':
          handleRate(Rating.Again);
          break;
        case '2':
          handleRate(Rating.Hard);
          break;
        case '3':
          handleRate(Rating.Good);
          break;
        case '4':
          handleRate(Rating.Easy);
          break;
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showAnswer, handleRate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading cards...</div>
      </div>
    );
  }

  if (sessionComplete) {
    return (
      <div className="p-6 text-center">
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">
          {reviewed > 0 ? 'Session Complete!' : 'Nothing to Review'}
        </h2>
        <p className="text-gray-600 mb-4">
          {reviewed > 0
            ? `You reviewed ${reviewed} card${reviewed !== 1 ? 's' : ''}. Great work!`
            : 'All caught up. Come back later for more reviews.'}
        </p>
        {reviewed > 0 && (
          <button
            onClick={() => {
              setSessionComplete(false);
              setCurrentIndex(0);
              setReviewed(0);
              setLoading(true);
              loadDueCards();
            }}
            className="text-indigo-600 hover:text-indigo-800 font-medium"
          >
            Review more
          </button>
        )}
      </div>
    );
  }

  const card = cards[currentIndex];
  if (!card) return null;

  const progress = ((currentIndex) / cards.length) * 100;

  return (
    <div className="p-4 flex flex-col h-full">
      <div className="mb-4">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>
            {currentIndex + 1} of {cards.length}
          </span>
          <span>{reviewed} reviewed</span>
        </div>
        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-600 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        <div className="bg-white rounded-xl border border-gray-200 p-5 flex-1 flex flex-col">
          {card.topic && (
            <span className="inline-block bg-indigo-50 text-indigo-700 text-xs px-2 py-0.5 rounded-full mb-3 self-start">
              {card.topic}
            </span>
          )}
          <div className="text-gray-800 font-medium text-base mb-4">
            {card.question}
          </div>

          {!showAnswer ? (
            <div className="mt-auto">
              <button
                onClick={() => setShowAnswer(true)}
                className="w-full bg-indigo-600 text-white py-3 rounded-lg font-medium hover:bg-indigo-700 transition-colors"
              >
                Show Answer
              </button>
              <div className="text-xs text-gray-400 text-center mt-2">
                Press Space
              </div>
            </div>
          ) : (
            <>
              <div className="border-t border-gray-100 pt-4 mb-4">
                <div className="text-gray-700 text-sm leading-relaxed">
                  {card.answer}
                </div>
                {card.timestamp > 0 && (
                  <a
                    href={`https://www.youtube.com/watch?v=${card.videoId}&t=${Math.floor(card.timestamp)}s`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-indigo-600 hover:text-indigo-800 mt-2 inline-block"
                  >
                    Watch this part →
                  </a>
                )}
              </div>

              <div className="mt-auto">
                <div className="text-xs text-gray-500 text-center mb-2">
                  How well did you remember?
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {([
                    { rating: Rating.Again, label: 'Again', color: 'bg-red-500 hover:bg-red-600', key: '1' },
                    { rating: Rating.Hard, label: 'Hard', color: 'bg-orange-500 hover:bg-orange-600', key: '2' },
                    { rating: Rating.Good, label: 'Good', color: 'bg-green-500 hover:bg-green-600', key: '3' },
                    { rating: Rating.Easy, label: 'Easy', color: 'bg-blue-500 hover:bg-blue-600', key: '4' },
                  ] as { rating: Grade; label: string; color: string; key: string }[]).map(({ rating, label, color, key }) => (
                    <button
                      key={label}
                      onClick={() => handleRate(rating)}
                      className={`${color} text-white py-2.5 rounded-lg text-sm font-medium transition-colors`}
                    >
                      <div>{label}</div>
                      <div className="text-xs opacity-75">{key}</div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
