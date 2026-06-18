import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'RememberIt',
    description: 'Transform YouTube videos into flashcards with AI-powered spaced repetition',
    permissions: ['sidePanel', 'activeTab', 'storage', 'alarms'],
    action: {},
    side_panel: {
      default_path: 'sidepanel.html',
    },
    host_permissions: [
      'https://www.youtube.com/*',
      'https://*.youtube.com/*',
      'https://*.googlevideo.com/*',
      'https://*.ytimg.com/*',
    ],
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
