import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import { initializePwaUpdates } from './app/pwaUpdate';
import { applyTheme, readThemePreference } from './app/theme';
import { initializeAppUpdates } from './app/update/appUpdate';
import { createSecondBrainClientFromBrowserEnvironment } from './lib/supabase/client';
import './styles/index.css';

// theme-init.js already set the colours before paint; this also styles the Android system bars.
applyTheme(readThemePreference());
initializePwaUpdates();
// Android app only: a quiet check of GitHub Releases, at most every few hours.
void initializeAppUpdates();

const root = document.getElementById('root');

if (!root) {
  throw new Error('Application root element was not found.');
}

try {
  const client = createSecondBrainClientFromBrowserEnvironment();

  createRoot(root).render(
    <StrictMode>
      <App client={client} />
    </StrictMode>,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown configuration error.';

  createRoot(root).render(
    <main className="center-state">
      <p className="kicker">Configuration required</p>
      <h1 className="page-title">Second Brain cannot start</h1>
      <p>{message}</p>
    </main>,
  );
}
