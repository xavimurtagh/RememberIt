import { vi } from 'vitest';
import 'fake-indexeddb/auto';

// Mock the WXT browser API
const mockBrowser = {
  runtime: {
    id: 'test-extension-id',
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
    },
  },
  action: {
    setBadgeText: vi.fn().mockResolvedValue(undefined),
    setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
    onClicked: { addListener: vi.fn() },
  },
  alarms: {
    create: vi.fn(),
    onAlarm: { addListener: vi.fn() },
  },
  sidePanel: {
    open: vi.fn().mockResolvedValue(undefined),
  },
};

(globalThis as Record<string, unknown>).browser = mockBrowser;
(globalThis as Record<string, unknown>).chrome = mockBrowser;
