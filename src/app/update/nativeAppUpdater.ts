import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export type InstalledVersion = { versionCode: number; versionName: string };

export type LatestRelease = {
  apkName?: string;
  apkSize?: number;
  apkUrl?: string;
  htmlUrl: string;
  name: string;
  publishedAt: string;
  tag: string;
};

export type InstallResult = { status: 'installer-opened' | 'permission-required' };

type AppUpdaterPlugin = {
  addListener(
    eventName: 'downloadProgress',
    listener: (event: { percent: number }) => void,
  ): Promise<PluginListenerHandle>;
  canInstall(): Promise<{ allowed: boolean; pending: boolean }>;
  checkLatest(): Promise<LatestRelease>;
  downloadAndInstall(options: { size: number; url: string }): Promise<InstallResult>;
  getInfo(): Promise<InstalledVersion>;
  installPending(): Promise<InstallResult>;
};

let plugin: AppUpdaterPlugin | null = null;

/** Registered on first use, so the web build and tests never touch the native bridge. */
export function appUpdater() {
  plugin ??= registerPlugin<AppUpdaterPlugin>('AppUpdater');
  return plugin;
}

/** In-app updates exist only in the Android app; the PWA updates through its service worker. */
export function isAppUpdateSupported() {
  return Capacitor.getPlatform() === 'android';
}
