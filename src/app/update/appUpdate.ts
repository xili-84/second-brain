import { appUpdater, isAppUpdateSupported, type LatestRelease } from './nativeAppUpdater';
import { displayVersion, isNewerVersion } from './version';

/** Automatic checks run on launch at most this often; the manual check always asks GitHub. */
export const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const STORAGE_KEY = 'second-brain:app-update';

export type AvailableUpdate = { size: number; url: string; version: string };

export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'permission'
  | 'installing'
  | 'error';

export type AppUpdateState = {
  /** Shown banner for this version was closed with "Later". */
  dismissedVersion: string | null;
  installedVersion: string | null;
  message: string | null;
  progress: number | null;
  status: AppUpdateStatus;
  supported: boolean;
  update: AvailableUpdate | null;
};

type StoredCheck = {
  checkedAt: number;
  dismissedVersion?: string | null;
  latest?: AvailableUpdate | null;
};

const initialState: AppUpdateState = {
  dismissedVersion: null,
  installedVersion: null,
  message: null,
  progress: null,
  status: 'idle',
  supported: false,
  update: null,
};

let state: AppUpdateState = initialState;
let initialized: Promise<void> | null = null;
const listeners = new Set<(value: AppUpdateState) => void>();

function setState(patch: Partial<AppUpdateState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener(state));
}

function readStored(): StoredCheck | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredCheck) : null;
  } catch {
    return null;
  }
}

function writeStored(value: StoredCheck) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage full or unavailable: the next launch simply checks again.
  }
}

function toAvailableUpdate(release: LatestRelease, installed: string): AvailableUpdate | null {
  if (!release.apkUrl || !release.apkSize || !isNewerVersion(release.tag, installed)) {
    return null;
  }

  return { size: release.apkSize, url: release.apkUrl, version: displayVersion(release.tag) };
}

export function getAppUpdateState() {
  return state;
}

export function subscribeToAppUpdates(listener: (value: AppUpdateState) => void) {
  listeners.add(listener);
  listener(state);

  return () => {
    listeners.delete(listener);
  };
}

/**
 * Reads the installed version and, at most every few hours, asks GitHub for the latest release.
 * Every failure of the automatic check (offline, rate limit, no release yet) is silent.
 */
export function initializeAppUpdates(now: () => number = Date.now) {
  if (!isAppUpdateSupported()) {
    return Promise.resolve();
  }

  initialized ??= (async () => {
    setState({ supported: true });

    try {
      const info = await appUpdater().getInfo();
      setState({ installedVersion: info.versionName });
    } catch {
      return;
    }

    void appUpdater()
      .addListener('downloadProgress', ({ percent }) => {
        if (state.status === 'downloading') {
          setState({ progress: percent });
        }
      })
      .catch(() => undefined);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.status === 'permission') {
        void resumePendingInstall();
      }
    });

    const stored = readStored();
    const installed = state.installedVersion ?? '';
    const cached =
      stored?.latest && isNewerVersion(stored.latest.version, installed) ? stored.latest : null;
    setState({ dismissedVersion: stored?.dismissedVersion ?? null });

    if (stored && now() - stored.checkedAt < AUTO_CHECK_INTERVAL_MS) {
      setState({ status: cached ? 'available' : 'idle', update: cached });
      return;
    }

    await checkForAppUpdate({ manual: false, now });
  })();

  return initialized;
}

export async function checkForAppUpdate({
  manual,
  now = Date.now,
}: {
  manual: boolean;
  now?: () => number;
}) {
  if (!state.supported || !state.installedVersion) {
    return;
  }

  if (state.status === 'downloading' || state.status === 'installing') {
    return;
  }

  const previous = state;
  setState({ message: null, status: 'checking' });

  try {
    const release = await appUpdater().checkLatest();
    const update = toAvailableUpdate(release, state.installedVersion);
    writeStored({ checkedAt: now(), dismissedVersion: state.dismissedVersion, latest: update });
    setState({
      // A manual check brings a dismissed banner back.
      dismissedVersion: manual ? null : state.dismissedVersion,
      status: update ? 'available' : 'up-to-date',
      update,
    });
  } catch {
    setState(
      manual
        ? { message: 'Couldn’t check for updates. Try again when you’re online.', status: 'error' }
        : { message: null, status: previous.update ? 'available' : 'idle' },
    );
  }
}

/** Downloads the release APK and opens Android's installer (via the install-permission screen). */
export async function startAppUpdate() {
  const update = state.update;

  if (!update || state.status === 'downloading' || state.status === 'installing') {
    return;
  }

  setState({ message: null, progress: 0, status: 'downloading' });

  try {
    const result = await appUpdater().downloadAndInstall({ size: update.size, url: update.url });
    handleInstallResult(result.status);
  } catch (error) {
    setState({
      message: error instanceof Error && error.message ? error.message : 'The update failed.',
      progress: null,
      status: 'error',
    });
  }
}

function handleInstallResult(status: 'installer-opened' | 'permission-required') {
  if (status === 'permission-required') {
    setState({
      message: 'Allow “Install unknown apps” for Second Brain, then come back here.',
      progress: null,
      status: 'permission',
    });
    return;
  }

  // The installer is on screen. If it is cancelled, the banner offers the update again.
  setState({ message: null, progress: null, status: 'available' });
}

/** Called when the app comes back from the "install unknown apps" settings screen. */
export async function resumePendingInstall() {
  try {
    const { allowed, pending } = await appUpdater().canInstall();

    if (!pending) {
      setState({ message: null, status: state.update ? 'available' : 'idle' });
      return;
    }

    if (!allowed) {
      return;
    }

    setState({ status: 'installing' });
    handleInstallResult((await appUpdater().installPending()).status);
  } catch {
    setState({ message: null, status: state.update ? 'available' : 'idle' });
  }
}

export function dismissAppUpdate() {
  const version = state.update?.version ?? null;
  writeStored({ ...(readStored() ?? { checkedAt: 0 }), dismissedVersion: version });
  setState({
    dismissedVersion: version,
    message: null,
    status: state.update ? 'available' : 'idle',
  });
}

/** Test hook: forget everything so each test starts from a clean launch. */
export function resetAppUpdatesForTests() {
  state = initialState;
  initialized = null;
  listeners.clear();
}
