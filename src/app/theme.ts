import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { useCallback, useEffect, useState } from 'react';

/**
 * Appearance: follow the system, or force light or dark.
 *
 * public/theme-init.js applies a saved choice before the first paint (same key and colours);
 * this module applies changes at runtime and keeps the browser chrome and Android system bars in
 * step. Keep both files in sync.
 */
export type ThemePreference = 'dark' | 'light' | 'system';

export const THEME_STORAGE_KEY = 'second-brain.theme';
export const THEME_COLORS = { dark: '#0f0f10', light: '#ffffff' } as const;

export function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function systemIsDark() {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

/** The theme actually on screen. */
export function resolveTheme(preference: ThemePreference): 'dark' | 'light' {
  return preference === 'system' ? (systemIsDark() ? 'dark' : 'light') : preference;
}

function applyMeta(preference: ThemePreference) {
  // Each theme-color meta keeps its media query; forcing a theme gives both the same colour.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const isDarkMeta = (meta.getAttribute('media') ?? '').includes('dark');
    meta.content =
      preference === 'system'
        ? isDarkMeta
          ? THEME_COLORS.dark
          : THEME_COLORS.light
        : THEME_COLORS[preference];
  }
  const scheme = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (scheme) {
    scheme.content = preference === 'system' ? 'light dark' : preference;
  }
}

/** Android status and navigation bar icons: light icons on dark, dark icons on light. */
export async function applySystemBars(preference: ThemePreference) {
  if (!Capacitor.isNativePlatform()) {
    return;
  }
  const style =
    preference === 'system'
      ? SystemBarsStyle.Default
      : preference === 'dark'
        ? SystemBarsStyle.Dark
        : SystemBarsStyle.Light;
  try {
    await SystemBars.setStyle({ style });
  } catch {
    // Older shells without the plugin keep the default style.
  }
}

export function applyTheme(preference: ThemePreference) {
  const root = document.documentElement;
  if (preference === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', preference);
  }
  applyMeta(preference);
  void applySystemBars(preference);
}

export function saveThemePreference(preference: ThemePreference) {
  try {
    if (preference === 'system') {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    }
  } catch {
    // Private mode or storage disabled: the choice still applies for this session.
  }
  applyTheme(preference);
}

/** Current preference plus a setter; other tabs follow through the storage event. */
export function useThemePreference() {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === THEME_STORAGE_KEY || event.key === null) {
        const next = readThemePreference();
        setPreference(next);
        applyTheme(next);
      }
    }
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const choose = useCallback((next: ThemePreference) => {
    setPreference(next);
    saveThemePreference(next);
  }, []);

  return { preference, setPreference: choose };
}
