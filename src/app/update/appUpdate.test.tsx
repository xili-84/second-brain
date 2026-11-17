import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const plugin = vi.hoisted(() => ({
  addListener: vi.fn(),
  canInstall: vi.fn(),
  checkLatest: vi.fn(),
  downloadAndInstall: vi.fn(),
  getInfo: vi.fn(),
  installPending: vi.fn(),
}));
const platform = vi.hoisted(() => ({ value: 'android' }));

vi.mock('./nativeAppUpdater', () => ({
  appUpdater: () => plugin,
  isAppUpdateSupported: () => platform.value === 'android',
}));

import {
  AUTO_CHECK_INTERVAL_MS,
  checkForAppUpdate,
  getAppUpdateState,
  initializeAppUpdates,
  resetAppUpdatesForTests,
} from './appUpdate';
import { AppUpdateBanner } from './AppUpdateBanner';
import { AppVersionSection } from './AppVersionSection';

const release = {
  apkName: 'second-brain-1.6.0-release.apk',
  apkSize: 3_500_000,
  apkUrl:
    'https://github.com/xili-84/second-brain/releases/download/v1.6.0/second-brain-1.6.0-release.apk',
  htmlUrl: 'https://github.com/xili-84/second-brain/releases/tag/v1.6.0',
  name: 'v1.6.0',
  publishedAt: '2026-11-18T00:00:00Z',
  tag: 'v1.6.0',
};

beforeEach(() => {
  resetAppUpdatesForTests();
  window.localStorage.clear();
  platform.value = 'android';
  Object.values(plugin).forEach((fn) => fn.mockReset());
  plugin.addListener.mockResolvedValue({ remove: vi.fn() });
  plugin.getInfo.mockResolvedValue({ versionCode: 8, versionName: '1.5.0' });
});

describe('in-app updates', () => {
  it('does nothing outside the Android app', async () => {
    platform.value = 'web';
    await initializeAppUpdates();

    expect(plugin.getInfo).not.toHaveBeenCalled();
    expect(plugin.checkLatest).not.toHaveBeenCalled();
    render(<AppUpdateBanner />);
    expect(screen.queryByText(/Update available/)).not.toBeInTheDocument();
  });

  it('shows a dismissible banner for a newer release and downloads it on Update', async () => {
    plugin.checkLatest.mockResolvedValue(release);
    plugin.downloadAndInstall.mockResolvedValue({ status: 'installer-opened' });

    await act(() => initializeAppUpdates());
    render(<AppUpdateBanner />);

    expect(screen.getByText('Update available · 1.6.0')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    });
    expect(plugin.downloadAndInstall).toHaveBeenCalledWith({
      size: release.apkSize,
      url: release.apkUrl,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByText(/Update available/)).not.toBeInTheDocument();
  });

  it('stays quiet when offline or rate-limited', async () => {
    plugin.checkLatest.mockRejectedValue(new Error('HTTP 403'));

    await act(() => initializeAppUpdates());
    render(<AppUpdateBanner />);

    expect(getAppUpdateState().status).toBe('idle');
    expect(getAppUpdateState().message).toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('checks GitHub at most every few hours', async () => {
    plugin.checkLatest.mockResolvedValue({ ...release, tag: 'v1.5.0' });
    const start = 1_000_000;

    await initializeAppUpdates(() => start);
    expect(plugin.checkLatest).toHaveBeenCalledTimes(1);

    resetAppUpdatesForTests();
    await initializeAppUpdates(() => start + AUTO_CHECK_INTERVAL_MS - 1);
    expect(plugin.checkLatest).toHaveBeenCalledTimes(1);

    resetAppUpdatesForTests();
    await initializeAppUpdates(() => start + AUTO_CHECK_INTERVAL_MS + 1);
    expect(plugin.checkLatest).toHaveBeenCalledTimes(2);
  });

  it('ignores a release without an APK or with an older tag', async () => {
    plugin.checkLatest.mockResolvedValue({ ...release, apkUrl: undefined, apkSize: undefined });
    await initializeAppUpdates();
    expect(getAppUpdateState().update).toBeNull();
  });

  it('offers a manual check with the current version in settings', async () => {
    plugin.checkLatest.mockResolvedValueOnce({ ...release, tag: 'v1.5.0' });
    await act(() => initializeAppUpdates());
    render(<AppVersionSection />);

    expect(screen.getByText('Second Brain 1.5.0')).toBeInTheDocument();
    expect(screen.getByText('You’re on the latest version.')).toBeInTheDocument();

    plugin.checkLatest.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    });
    expect(screen.getByText(/Couldn’t check for updates/)).toBeInTheDocument();

    plugin.checkLatest.mockResolvedValueOnce(release);
    await act(() => checkForAppUpdate({ manual: true }));
    expect(screen.getByRole('button', { name: 'Update to 1.6.0' })).toBeInTheDocument();
  });

  it('sends the user to allow installs and finishes when they come back', async () => {
    plugin.checkLatest.mockResolvedValue(release);
    plugin.downloadAndInstall.mockResolvedValue({ status: 'permission-required' });
    plugin.canInstall.mockResolvedValue({ allowed: true, pending: true });
    plugin.installPending.mockResolvedValue({ status: 'installer-opened' });

    await act(() => initializeAppUpdates());
    render(<AppUpdateBanner />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    });
    expect(screen.getByText(/Install unknown apps/)).toBeInTheDocument();

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(plugin.installPending).toHaveBeenCalled();
    expect(screen.getByText('Update available · 1.6.0')).toBeInTheDocument();
  });

  it('shows the native error when the download fails', async () => {
    plugin.checkLatest.mockResolvedValue(release);
    plugin.downloadAndInstall.mockRejectedValue(
      new Error('The update is not signed with the Second Brain key, so it was not installed.'),
    );

    await act(() => initializeAppUpdates());
    render(<AppUpdateBanner />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('not signed with the Second Brain key');
  });
});
