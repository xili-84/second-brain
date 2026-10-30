import { describe, expect, it } from 'vitest';

import { aspectHint, aspectLabel } from './aspect';

describe('aspect labels', () => {
  it('names common social formats and marks 9:16 as a story', () => {
    expect(aspectLabel(1080, 1920)).toBe('9:16');
    expect(aspectHint(1080, 1920)).toBe('Story');
    expect(aspectLabel(1080, 1080)).toBe('1:1');
    expect(aspectLabel(1080, 1350)).toBe('4:5');
    expect(aspectLabel(1200, 628)).toBe('1.91:1');
    expect(aspectHint(1080, 1080)).toBeNull();
  });

  it('returns null for unknown or odd sizes', () => {
    expect(aspectLabel(undefined, 100)).toBeNull();
    expect(aspectLabel(1000, 137)).toBeNull();
  });
});
