// Dev-only entry: the real app with a fake Supabase client. Served by vite.mock.config.ts only.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '../../src/app/App';
import '../../src/styles/index.css';
import { createMockClient } from './mockClient';

const root = document.getElementById('root');

if (root) {
  createRoot(root).render(
    <StrictMode>
      <App client={createMockClient()} />
    </StrictMode>,
  );
}
