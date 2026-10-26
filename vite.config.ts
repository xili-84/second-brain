import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

/**
 * Writes the Supabase origin into dist/.htaccess so the Content-Security-Policy only allows the
 * configured project. The build fails if the origin is missing or a placeholder remains.
 */
function htaccessCsp(mode: string): Plugin {
  let outDir = 'dist';

  return {
    name: 'second-brain-htaccess-csp',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const env = loadEnv(mode, process.cwd(), 'VITE_');
      const origin = new URL(env.VITE_SUPABASE_URL ?? '').origin;
      const file = resolve(outDir, '.htaccess');
      const source = readFileSync(file, 'utf8');
      const output = source
        .replaceAll('__SUPABASE_WS_ORIGIN__', origin.replace(/^https:/, 'wss:'))
        .replaceAll('__SUPABASE_ORIGIN__', origin);

      if (/__SUPABASE_[A-Z_]+__/.test(output.replace(/^#.*$/gm, ''))) {
        throw new Error('dist/.htaccess still contains a CSP placeholder.');
      }

      writeFileSync(file, output);
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    htaccessCsp(mode),
    VitePWA({
      // A waiting update must never reload an open editor and discard an unsaved draft.
      registerType: 'prompt',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        id: '/',
        name: 'Second Brain',
        short_name: 'Second Brain',
        description: 'Private, low-friction knowledge capture.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#071a3d',
        theme_color: '#071a3d',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
        runtimeCaching: [],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Long-lived vendor chunks keep the app chunk small and cache well across releases.
        manualChunks(id) {
          if (id.includes('node_modules/@supabase/')) {
            return 'supabase';
          }

          if (
            /node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)
          ) {
            return 'react';
          }

          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
}));
