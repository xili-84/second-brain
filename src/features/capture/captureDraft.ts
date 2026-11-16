export type CaptureKind = 'file' | 'image' | 'link' | 'note';

export type CaptureDraft = {
  content: string;
  id: string;
  kind: CaptureKind;
  sourceUrl: string;
  title: string;
};

export function isStandaloneHttpUrl(value: string) {
  const trimmed = value.trim();

  if (!trimmed || /\s/.test(trimmed)) {
    return false;
  }

  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function createEmptyDraft(): CaptureDraft {
  return {
    content: '',
    id: crypto.randomUUID(),
    kind: 'note',
    sourceUrl: '',
    title: '',
  };
}

export function createDraftFromShare(title: string, text: string): CaptureDraft {
  const trimmedText = text.trim();

  if (isStandaloneHttpUrl(trimmedText)) {
    return {
      content: '',
      id: crypto.randomUUID(),
      kind: 'link',
      sourceUrl: trimmedText,
      title: title.trim(),
    };
  }

  return {
    content: trimmedText,
    id: crypto.randomUUID(),
    kind: 'note',
    sourceUrl: '',
    title: title.trim(),
  };
}

export function validateCaptureDraft(draft: CaptureDraft) {
  if (draft.title.trim().length > 500) {
    return 'Title must be 500 characters or fewer.';
  }

  if (draft.kind === 'note') {
    return draft.title.trim() || draft.content.trim()
      ? null
      : 'Enter a title or some note text before saving.';
  }

  if (draft.kind === 'image' || draft.kind === 'file') {
    return null;
  }

  if (draft.sourceUrl.trim().length > 8192) {
    return 'URL must be 8,192 characters or fewer.';
  }

  return isStandaloneHttpUrl(draft.sourceUrl)
    ? null
    : 'Enter a complete HTTP or HTTPS URL before saving.';
}
