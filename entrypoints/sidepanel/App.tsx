import { useState, useEffect } from 'react';
import DashboardView from '@/components/DashboardView';
import ReviewView from '@/components/ReviewView';
import GenerateView from '@/components/GenerateView';
import LibraryView from '@/components/LibraryView';
import StatsView from '@/components/StatsView';
import SettingsView from '@/components/SettingsView';
import type { VideoMetadata } from '@/lib/types';

type Tab = 'dashboard' | 'review' | 'generate' | 'library' | 'stats' | 'settings';

const TAB_ICONS: Record<Tab, string> = {
  dashboard: '🏠',
  review: '📝',
  generate: '✨',
  library: '📚',
  stats: '📊',
  settings: '⚙️',
};

const TAB_LABELS: Record<Tab, string> = {
  dashboard: 'Home',
  review: 'Review',
  generate: 'Generate',
  library: 'Library',
  stats: 'Stats',
  settings: 'Settings',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [currentVideo, setCurrentVideo] = useState<VideoMetadata | null>(null);

  useEffect(() => {
    const listener = (message: { type: string; metadata?: VideoMetadata }) => {
      if (message.type === 'VIDEO_CHANGED' && message.metadata) {
        setCurrentVideo(message.metadata);
      }
    };
    browser.runtime.onMessage.addListener(listener);

    // Proactively pull the current tab's video when the panel opens, instead of
    // waiting for a push that may have fired before the panel existed.
    browser.runtime
      .sendMessage({ type: 'GET_VIDEO_METADATA' })
      .then((resp: { metadata?: VideoMetadata } | undefined) => {
        if (resp?.metadata) setCurrentVideo(resp.metadata);
      })
      .catch(() => {});

    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  const tabs: Tab[] = ['dashboard', 'review', 'generate', 'library', 'stats', 'settings'];

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <header className="bg-indigo-600 text-white px-4 py-3 flex items-center gap-2 shrink-0">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
        <span className="font-bold text-lg">RememberIt</span>
      </header>

      <main className="flex-1 overflow-y-auto">
        {activeTab === 'dashboard' && (
          <DashboardView
            onStartReview={() => setActiveTab('review')}
            onGenerate={() => setActiveTab('generate')}
          />
        )}
        {activeTab === 'review' && <ReviewView />}
        {activeTab === 'generate' && (
          <GenerateView
            currentVideo={currentVideo}
            onSaved={() => setActiveTab('library')}
          />
        )}
        {activeTab === 'library' && <LibraryView />}
        {activeTab === 'stats' && <StatsView />}
        {activeTab === 'settings' && <SettingsView />}
      </main>

      <nav className="flex border-t border-gray-200 bg-white shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 flex flex-col items-center py-2 text-xs transition-colors ${
              activeTab === tab
                ? 'text-indigo-600 font-semibold'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <span className="text-base">{TAB_ICONS[tab]}</span>
            <span>{TAB_LABELS[tab]}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
