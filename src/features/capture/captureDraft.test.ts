import { describe, expect, it } from 'vitest';

import {
  createDraftFromShare,
  createEmptyDraft,
  isStandaloneHttpUrl,
  validateCaptureDraft,
} from './captureDraft';

describe('Android share classification', () => {
  it('classifies one standalone HTTP or HTTPS URL as a link', () => {
    expect(isStandaloneHttpUrl('https://example.com/article')).toBe(true);
    expect(createDraftFromShare('Useful page', 'https://example.com/article')).toMatchObject({
      kind: 'link',
      sourceUrl: 'https://example.com/article',
      title: 'Useful page',
    });
  });

  it('classifies ordinary or mixed text as a note', () => {
    expect(isStandaloneHttpUrl('Read https://example.com later')).toBe(false);
    expect(createDraftFromShare('', 'A thought to remember')).toMatchObject({
      content: 'A thought to remember',
      kind: 'note',
      sourceUrl: '',
    });
  });
});

describe('capture validation', () => {
  it('requires note content or a title', () => {
    expect(validateCaptureDraft(createEmptyDraft())).toBe(
      'Enter a title or some note text before saving.',
    );
  });

  it('rejects non-HTTP link schemes', () => {
    const draft = createEmptyDraft();
    draft.kind = 'link';
    draft.sourceUrl = 'javascript:alert(1)';

    expect(validateCaptureDraft(draft)).toBe('Enter a complete HTTP or HTTPS URL before saving.');
  });
});
