import { dismissAppUpdate, startAppUpdate, resumePendingInstall } from './appUpdate';
import { useAppUpdate } from './useAppUpdate';

/** Android only: "Update available · 1.6.0" with Update and Later, then download progress. */
export function AppUpdateBanner() {
  const { dismissedVersion, message, progress, status, supported, update } = useAppUpdate();

  if (!supported || !update) {
    return null;
  }

  if (status === 'downloading' || status === 'installing') {
    return (
      <div className="banner" role="status">
        <span>
          {status === 'installing'
            ? 'Opening the installer…'
            : `Downloading update · ${progress ?? 0}%`}
        </span>
      </div>
    );
  }

  if (status === 'permission' || status === 'error') {
    return (
      <div className="banner" role={status === 'error' ? 'alert' : 'status'}>
        <span>{message}</span>
        <span className="banner__actions">
          <button
            className="banner__button"
            onClick={() =>
              void (status === 'permission' ? resumePendingInstall() : startAppUpdate())
            }
            type="button"
          >
            {status === 'permission' ? 'Continue' : 'Try again'}
          </button>
          <button className="banner__button" onClick={dismissAppUpdate} type="button">
            Later
          </button>
        </span>
      </div>
    );
  }

  if (status !== 'available' || dismissedVersion === update.version) {
    return null;
  }

  return (
    <div className="banner" role="status">
      <span>Update available · {update.version}</span>
      <span className="banner__actions">
        <button className="banner__button" onClick={() => void startAppUpdate()} type="button">
          Update
        </button>
        <button className="banner__button" onClick={dismissAppUpdate} type="button">
          Later
        </button>
      </span>
    </div>
  );
}
