/**
 * Dev-only design harness: serves the real app with a fake Supabase client and sample data, so
 * every screen can be reviewed and screenshotted without signing in. Never used by `npm run
 * build`; nothing under dev/ is bundled or deployed.
 *
 *   npm run dev:mock      then open http://localhost:5199/inbox
 *   URL flags: ?signedout  ?empty  ?slow (session never restores)  ?slowdata (lists never load)
 */
import { createReadStream, existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const assets = resolve(import.meta.dirname, 'dev/mock/assets');

const mockHarness: Plugin = {
  name: 'second-brain-mock-harness',
  apply: 'serve',
  transformIndexHtml: (html) => html.replace('/src/main.tsx', '/dev/mock/mockMain.tsx'),
  resolveId: (id) => (id === 'virtual:pwa-register' ? '\0pwa-register-stub' : null),
  load: (id) =>
    id === '\0pwa-register-stub' ? 'export const registerSW = () => async () => {};' : null,
  configureServer(server) {
    // "Signed" image URLs from the fake client point here.
    server.middlewares.use('/mock-images', (request, response, next) => {
      const file = resolve(assets, basename(request.url ?? ''));
      if (!existsSync(file)) {
        next();
        return;
      }
      response.setHeader('Content-Type', file.endsWith('.png') ? 'image/png' : 'image/jpeg');
      createReadStream(file).pipe(response);
    });
  },
};

export default defineConfig({
  plugins: [react(), mockHarness],
  server: { port: Number(process.env.PORT ?? 5199), strictPort: true },
});
