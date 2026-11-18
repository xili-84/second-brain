import { describe, expect, it } from 'vitest';

import { saveErrorMessage } from './saveError';

describe('saveErrorMessage', () => {
  it('shows the reason the phone gave', () => {
    expect(saveErrorMessage(new Error('This file is no longer in storage (HTTP 404).'), true)).toBe(
      'Couldn’t save the file to your phone: This file is no longer in storage (HTTP 404).',
    );
  });

  it('falls back to a plain retry message without a reason', () => {
    expect(saveErrorMessage(new Error(''), true)).toBe(
      'Couldn’t save the file to your phone. Please try again.',
    );
    expect(saveErrorMessage('nope', false)).toBe('Couldn’t download the file. Please try again.');
  });
});
