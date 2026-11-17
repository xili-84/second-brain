import { describe, expect, it } from 'vitest';

import { displayVersion, isNewerVersion, parseVersion } from './version';

describe('release versions', () => {
  it('parses tags with or without a leading v', () => {
    expect(parseVersion('v1.6.0')).toEqual([1, 6, 0]);
    expect(parseVersion('1.10.2')).toEqual([1, 10, 2]);
    expect(parseVersion('v1.6.0-beta')).toBeNull();
    expect(parseVersion('')).toBeNull();
  });

  it('compares numerically, not as text', () => {
    expect(isNewerVersion('v1.10.0', '1.9.9')).toBe(true);
    expect(isNewerVersion('v1.6.0', '1.5.0')).toBe(true);
    expect(isNewerVersion('v2.0.0', '1.99.99')).toBe(true);
    expect(isNewerVersion('v1.6.0', '1.6.0')).toBe(false);
    expect(isNewerVersion('v1.5.9', '1.6.0')).toBe(false);
    expect(isNewerVersion('nightly', '1.6.0')).toBe(false);
  });

  it('shows the tag without the v', () => {
    expect(displayVersion('v1.6.0')).toBe('1.6.0');
  });
});
