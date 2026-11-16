import type { FormEvent } from 'react';

import { ActionBar } from '../../../components/ActionBar';
import type { CaptureDraft } from '../captureDraft';

type CaptureEditFormProps = {
  draft: CaptureDraft;
  isBusy: boolean;
  isSaving: boolean;
  onCancel: () => void;
  onChange: (update: Partial<CaptureDraft>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** Shown on the save button while images upload, e.g. "Uploading 1 of 2…". */
  savingLabel?: string | null;
};

/** Editing in place uses the composer styles: headline field, writing area, pinned actions. */
export function CaptureEditForm({
  draft,
  isBusy,
  isSaving,
  onCancel,
  onChange,
  onSubmit,
  savingLabel = null,
}: CaptureEditFormProps) {
  const hasText = draft.kind === 'note' || draft.kind === 'image' || draft.kind === 'file';

  return (
    <form className="composer" onSubmit={onSubmit}>
      <input
        aria-label="Title"
        className="composer__title"
        disabled={isBusy}
        maxLength={500}
        onChange={(event) => onChange({ title: event.target.value })}
        placeholder="Headline (optional)"
        value={draft.title}
      />

      {hasText ? (
        <textarea
          aria-label="Note"
          className="composer__body"
          disabled={isBusy}
          onChange={(event) => onChange({ content: event.target.value })}
          placeholder={draft.kind === 'image' || draft.kind === 'file' ? 'Note (optional)' : 'Note'}
          rows={10}
          value={draft.content}
        />
      ) : (
        <label className="field">
          <span className="field__label">URL</span>
          <input
            className="input"
            disabled={isBusy}
            inputMode="url"
            onChange={(event) => onChange({ sourceUrl: event.target.value })}
            required
            type="url"
            value={draft.sourceUrl}
          />
        </label>
      )}

      <ActionBar label="Edit actions">
        <button
          className="btn btn--ghost btn--lg"
          disabled={isBusy}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="btn btn--primary btn--lg action-bar__main"
          disabled={isBusy}
          type="submit"
        >
          {isSaving ? (savingLabel ?? 'Saving…') : 'Save changes'}
        </button>
      </ActionBar>
    </form>
  );
}
