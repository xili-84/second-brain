import { Download, RefreshCw } from 'lucide-react';

import { checkForAppUpdate, startAppUpdate } from './appUpdate';
import { useAppUpdate } from './useAppUpdate';

function statusLine(status: string, version: string | undefined, message: string | null) {
  switch (status) {
    case 'checking':
      return 'Checking for updates…';
    case 'up-to-date':
      return 'You’re on the latest version.';
    case 'available':
      return `Version ${version} is available.`;
    case 'downloading':
      return 'Downloading the update…';
    case 'installing':
      return 'Opening the installer…';
    default:
      return message;
  }
}

/** Android only: the installed version and a manual "Check for updates" in the account sheet. */
export function AppVersionSection() {
  const { installedVersion, message, progress, status, supported, update } = useAppUpdate();

  if (!supported) {
    return null;
  }

  const busy = status === 'checking' || status === 'downloading' || status === 'installing';
  const line = statusLine(status, update?.version, message);

  return (
    <div className="sheet__section sheet__section--app">
      <p className="sheet__label">App</p>
      <p className="sheet__version">Second Brain {installedVersion ?? '—'}</p>
      {line && (
        <p aria-live="polite" className="sheet__hint">
          {status === 'downloading' && progress !== null ? `${line} ${progress}%` : line}
        </p>
      )}
      {update && status !== 'up-to-date' ? (
        <button
          className="sheet__item"
          disabled={busy}
          onClick={() => void startAppUpdate()}
          type="button"
        >
          <Download aria-hidden="true" className="icon" />
          Update to {update.version}
        </button>
      ) : (
        <button
          className="sheet__item"
          disabled={busy}
          onClick={() => void checkForAppUpdate({ manual: true })}
          type="button"
        >
          <RefreshCw aria-hidden="true" className="icon" />
          Check for updates
        </button>
      )}
    </div>
  );
}
