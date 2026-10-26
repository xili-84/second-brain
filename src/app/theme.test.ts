import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { native, setStyle } = vi.hoisted(() => ({
  native: { value: false },
  setStyle: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.value },
  SystemBars: { setStyle },
  SystemBarsStyle: { Dark: 'DARK', Default: 'DEFAULT', Light: 'LIGHT' },
}));

import indexHtml from '../../index.html?raw';
import themeInitScript from '../../public/theme-init.js?raw';
import tokensCss from '../styles/tokens.css?raw';
import { MoreSheet } from './MoreSheet';
import {
  applyTheme,
  readThemePreference,
  resolveTheme,
  saveThemePreference,
  THEME_STORAGE_KEY,
} from './theme';

function themeMetas() {
  return [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
}

function installHead() {
  document.head.innerHTML = `
    <meta name="color-scheme" content="light dark" />
    <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#0f0f10" media="(prefers-color-scheme: dark)" />`;
}

function mockSystemDark(dark: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    addEventListener: vi.fn(),
    matches: dark && query.includes('dark'),
    media: query,
    removeEventListener: vi.fn(),
  }));
}

beforeEach(() => {
  installHead();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  native.value = false;
  setStyle.mockClear();
  mockSystemDark(false);
});

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('theme preference', () => {
  it('defaults to System and ignores unknown stored values', () => {
    expect(readThemePreference()).toBe('system');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    expect(readThemePreference()).toBe('system');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(readThemePreference()).toBe('dark');
  });

  it('forces a theme on the root, the theme-color metas and color-scheme, and remembers it', () => {
    saveThemePreference('light');

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(themeMetas().map((meta) => meta.content)).toEqual(['#ffffff', '#ffffff']);
    expect(document.querySelector('meta[name="color-scheme"]')).toHaveAttribute('content', 'light');

    saveThemePreference('dark');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(themeMetas().map((meta) => meta.content)).toEqual(['#0f0f10', '#0f0f10']);
  });

  it('returns to the system setting and restores the per-scheme colours', () => {
    saveThemePreference('dark');
    saveThemePreference('system');

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement).not.toHaveAttribute('data-theme');
    expect(themeMetas().map((meta) => meta.content)).toEqual(['#ffffff', '#0f0f10']);
    expect(document.querySelector('meta[name="color-scheme"]')).toHaveAttribute(
      'content',
      'light dark',
    );
  });

  it('resolves System from the device setting', () => {
    expect(resolveTheme('system')).toBe('light');
    mockSystemDark(true);
    expect(resolveTheme('system')).toBe('dark');
    expect(resolveTheme('light')).toBe('light');
  });

  it('sets Android system bar icon contrast only in the native app', () => {
    applyTheme('dark');
    expect(setStyle).not.toHaveBeenCalled();

    native.value = true;
    applyTheme('dark');
    applyTheme('light');
    applyTheme('system');
    expect(setStyle.mock.calls).toEqual([
      [{ style: 'DARK' }],
      [{ style: 'LIGHT' }],
      [{ style: 'DEFAULT' }],
    ]);
  });
});

describe('theme-init.js (runs before first paint)', () => {
  const run = () => new Function(themeInitScript)() as void;

  it('does nothing for System', () => {
    run();
    expect(document.documentElement).not.toHaveAttribute('data-theme');
    expect(themeMetas().map((meta) => meta.content)).toEqual(['#ffffff', '#0f0f10']);
  });

  it('applies a saved theme with the same key and colours as the app', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    run();
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(themeMetas().map((meta) => meta.content)).toEqual(['#ffffff', '#ffffff']);
    expect(document.querySelector('meta[name="color-scheme"]')).toHaveAttribute('content', 'light');
  });

  it('is loaded from the same origin in the head, never inline', () => {
    const html = indexHtml;
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).toContain('<script src="/theme-init.js"></script>');
    expect(html).not.toMatch(/<script>(?!<\/script>)/);
  });
});

describe('dark palette', () => {
  it('is identical for an explicit Dark choice and for System in dark mode', () => {
    const css = tokensCss;
    const block = (selector: string) => {
      const start = css.indexOf(`${selector} {`);
      const body = css.slice(start + selector.length + 2, css.indexOf('}', start));
      return body
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    };

    const explicit = block(":root[data-theme='dark']");
    const system = block(":root:not([data-theme='light'])");
    expect(explicit.length).toBeGreaterThan(10);
    expect(system).toEqual(explicit);
  });
});

describe('appearance switch', () => {
  it('focuses the saved choice when the sheet opens', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    render(createElement(MoreSheet, { email: undefined, onClose: vi.fn(), onSignOut: vi.fn() }));
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveFocus();
  });

  it('lives in the account sheet and applies the choice at once', () => {
    render(
      createElement(MoreSheet, { email: 'awa@example.com', onClose: vi.fn(), onSignOut: vi.fn() }),
    );

    const group = screen.getByRole('group', { name: 'Appearance' });
    expect(group).toBeVisible();
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
    // Opening the sheet focuses the checked option, as Tab into a radio group would.
    expect(screen.getByRole('radio', { name: 'System' })).toHaveFocus();

    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked();
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

    fireEvent.click(screen.getByRole('radio', { name: 'System' }));
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });
});
