import { useState, useEffect } from 'react';
import type { Settings } from '@/lib/types';
import { DEFAULT_SETTINGS } from '@/lib/types';
import { db } from '@/lib/database';
import { checkChromeAIAvailability } from '@/lib/ai';

export default function SettingsView() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [aiStatus, setAiStatus] = useState<'checking' | 'available' | 'unavailable'>('checking');

  useEffect(() => {
    loadSettings();
    checkAI();
  }, []);

  async function loadSettings() {
    const result = await browser.storage.local.get('settings');
    if (result.settings) {
      setSettings({ ...DEFAULT_SETTINGS, ...result.settings });
    }
  }

  async function checkAI() {
    const available = await checkChromeAIAvailability();
    setAiStatus(available ? 'available' : 'unavailable');
  }

  async function handleSave() {
    await browser.storage.local.set({ settings });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  async function handleExport() {
    const videos = await db.videos.toArray();
    const cards = await db.cards.toArray();
    const reviewLogs = await db.reviewLogs.toArray();
    const exportData = { videos, cards, reviewLogs, settings, exportedAt: new Date().toISOString() };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rememberit-export-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const data = JSON.parse(text);

    if (data.videos) await db.videos.bulkPut(data.videos);
    if (data.cards) await db.cards.bulkPut(data.cards);
    if (data.reviewLogs) await db.reviewLogs.bulkPut(data.reviewLogs);
    if (data.settings) {
      setSettings(data.settings);
      await browser.storage.local.set({ settings: data.settings });
    }

    alert('Data imported successfully!');
  }

  async function handleClearData() {
    if (!confirm('Are you sure? This will delete ALL your cards, videos, and review history.')) return;
    await db.cards.clear();
    await db.videos.clear();
    await db.reviewLogs.clear();
    alert('All data cleared.');
  }

  return (
    <div className="p-4 space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">AI Status</h3>
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          {aiStatus === 'checking' ? (
            <div className="text-sm text-gray-500">Checking Chrome AI availability...</div>
          ) : aiStatus === 'available' ? (
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 bg-green-500 rounded-full" />
              <div>
                <div className="text-sm font-medium text-green-700">Chrome AI Available</div>
                <div className="text-xs text-gray-500">
                  Flashcards will be generated on-device using Gemini Nano. Free and private.
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 bg-amber-400 rounded-full" />
              <div>
                <div className="text-sm font-medium text-amber-700">Chrome AI Not Available</div>
                <div className="text-xs text-gray-500">
                  Using smart key-point extraction (rule-based). Cards may need manual editing.
                  For AI-powered cards, update to Chrome 138+ and enable built-in AI.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Review Settings</h3>
        <div className="bg-white rounded-lg border border-gray-200 p-3 space-y-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">
              Target Retention: {Math.round(settings.targetRetention * 100)}%
            </label>
            <input
              type="range"
              min="70"
              max="99"
              value={settings.targetRetention * 100}
              onChange={(e) =>
                updateSetting('targetRetention', Number(e.target.value) / 100)
              }
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-400">
              <span>70% (fewer reviews)</span>
              <span>99% (more reviews)</span>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-600 mb-1">
              Default cards per video
            </label>
            <select
              value={settings.defaultCardCount}
              onChange={(e) =>
                updateSetting('defaultCardCount', Number(e.target.value))
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              {[5, 8, 10, 15, 20].map((n) => (
                <option key={n} value={n}>
                  {n} cards
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Data</h3>
        <div className="bg-white rounded-lg border border-gray-200 p-3 space-y-2">
          <button
            onClick={handleExport}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Export Data (JSON)
          </button>
          <label className="block w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors text-center cursor-pointer">
            Import Data
            <input
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
            />
          </label>
          <button
            onClick={handleClearData}
            className="w-full px-3 py-2 border border-red-300 rounded-lg text-sm text-red-600 hover:bg-red-50 transition-colors"
          >
            Clear All Data
          </button>
        </div>
      </div>

      <button
        onClick={handleSave}
        className="w-full bg-indigo-600 text-white py-3 rounded-lg font-medium hover:bg-indigo-700 transition-colors"
      >
        {saved ? 'Saved!' : 'Save Settings'}
      </button>
    </div>
  );
}
