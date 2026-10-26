import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useAuth } from '../auth/authContext';
import {
  captureStatusDetails,
  getCaptureStatusUpdate,
  type CaptureStatus,
} from './captureLifecycle';
import { validateCaptureDraft, type CaptureDraft, type CaptureKind } from './captureDraft';
import { validateImageFile } from './imageCapture';
import { replaceImageAttachment, type StoredImageAttachment } from './imageReplacement';
import { isNativeImageSaveAvailable, saveImageToPhone } from './nativeImageSaver';

type CaptureRecord = {
  attachments: StoredImageAttachment[];
  content: string | null;
  created_at: string;
  id: string;
  kind: string;
  source_url: string | null;
  status: string;
  title: string | null;
  updated_at: string;
};

function isSupportedKind(kind: string): kind is CaptureKind {
  return kind === 'note' || kind === 'link' || kind === 'image';
}

function isSupportedStatus(status: string): status is CaptureStatus {
  return status === 'inbox' || status === 'reviewed' || status === 'archived';
}

function toDraft(capture: CaptureRecord): CaptureDraft {
  return {
    content: capture.content ?? '',
    id: capture.id,
    kind: capture.kind as CaptureKind,
    sourceUrl: capture.source_url ?? '',
    title: capture.title ?? '',
  };
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Some Android WebViews expose the Clipboard API but reject writes. Fall through to the
      // synchronous command while the user-initiated copy action is still being handled.
    }
  }

  const copySource = document.createElement('textarea');
  copySource.value = text;
  copySource.readOnly = true;
  copySource.style.position = 'fixed';
  copySource.style.inset = '0 auto auto -9999px';
  copySource.style.opacity = '0';
  document.body.append(copySource);
  copySource.focus({ preventScroll: true });
  copySource.select();

  try {
    return document.execCommand?.('copy') === true;
  } catch {
    return false;
  } finally {
    copySource.remove();
  }
}

export function CaptureDetailPage() {
  const { captureId } = useParams();
  const navigate = useNavigate();
  const { client, session } = useAuth();
  const userId = session?.user.id;
  const [capture, setCapture] = useState<CaptureRecord | null>(null);
  const [draft, setDraft] = useState<CaptureDraft | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isReplacingImage, setIsReplacingImage] = useState(false);
  const [replacementImage, setReplacementImage] = useState<File | null>(null);
  const [isValidatingReplacement, setIsValidatingReplacement] = useState(false);
  const [isSavingToPhone, setIsSavingToPhone] = useState(false);
  const [hasSavedToPhone, setHasSavedToPhone] = useState(false);
  const isSavingToPhoneRef = useRef(false);

  const loadCapture = useCallback(async () => {
    if (!captureId || !userId) {
      return;
    }

    setIsLoading(true);
    setHasSavedToPhone(false);
    setIsSavingToPhone(false);
    setIsReplacingImage(false);
    setReplacementImage(null);
    setIsValidatingReplacement(false);
    isSavingToPhoneRef.current = false;
    setError(null);

    const { data, error: loadError } = await client
      .from('captures')
      .select(
        'id, kind, status, title, content, source_url, created_at, updated_at, attachments(id, storage_path, original_name, mime_type, size_bytes)',
      )
      .eq('id', captureId)
      .eq('user_id', userId)
      .single();

    if (loadError || !data || !isSupportedKind(data.kind) || !isSupportedStatus(data.status)) {
      setCapture(null);
      setDraft(null);
      setImageUrl(null);
      setImageError(null);
      setIsEditing(false);
      setError('This capture could not be loaded. It may have been deleted.');
    } else {
      setCapture(data);
      setDraft(toDraft(data));
      setIsEditing(false);
      setImageUrl(null);
      setImageError(null);

      if (data.kind === 'image') {
        const imagePath = data.attachments[0]?.storage_path;

        if (!imagePath) {
          setImageError('This image capture is incomplete. You can delete it and try again.');
        } else {
          const { data: signedImage, error: signedImageError } = await client.storage
            .from('capture-images')
            .createSignedUrl(imagePath, 3600);

          if (signedImageError) {
            setImageError(
              'The private image could not be loaded. Check your connection and retry.',
            );
          } else {
            setImageUrl(signedImage.signedUrl);
          }
        }
      }
    }

    setIsLoading(false);
  }, [captureId, client, userId]);

  useEffect(() => {
    void loadCapture();
  }, [loadCapture]);

  function updateDraft(update: Partial<CaptureDraft>) {
    setDraft((current) => (current ? { ...current, ...update } : current));
    setError(null);
    setMessage(null);
  }

  function startEditing() {
    if (!capture) {
      return;
    }

    setDraft(toDraft(capture));
    setError(null);
    setMessage(null);
    setIsReplacingImage(false);
    setReplacementImage(null);
    setIsEditing(true);
  }

  function cancelEditing() {
    if (capture) {
      setDraft(toDraft(capture));
    }

    setError(null);
    setMessage(null);
    setIsReplacingImage(false);
    setReplacementImage(null);
    setIsValidatingReplacement(false);
    setIsEditing(false);
  }

  function beginImageReplacement() {
    setError(null);
    setMessage(null);
    setIsReplacingImage(true);
    setReplacementImage(null);
  }

  function undoImageReplacement() {
    setError(null);
    setMessage(null);
    setIsReplacingImage(false);
    setReplacementImage(null);
  }

  async function chooseReplacementImage(file: File | null) {
    setError(null);
    setMessage(null);
    setReplacementImage(null);

    if (!file) {
      return;
    }

    setIsValidatingReplacement(true);
    const validationError = await validateImageFile(file);
    setIsValidatingReplacement(false);

    if (validationError) {
      setError(validationError);
      return;
    }

    setReplacementImage(file);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!capture || !draft || !session || pendingAction || isValidatingReplacement || !isEditing) {
      return;
    }

    const validationError = validateCaptureDraft(draft);

    if (validationError) {
      setError(validationError);
      return;
    }

    const currentAttachment = capture.kind === 'image' ? capture.attachments[0] : undefined;

    if (isReplacingImage && (!currentAttachment || !replacementImage)) {
      setError('Choose a replacement image before saving, or undo the removal.');
      return;
    }

    if (isReplacingImage && replacementImage) {
      setIsValidatingReplacement(true);
      const replacementValidationError = await validateImageFile(replacementImage);
      setIsValidatingReplacement(false);

      if (replacementValidationError) {
        setError(replacementValidationError);
        return;
      }
    }

    setError(null);
    setMessage(null);
    setPendingAction('save');

    const update = {
      content:
        draft.kind === 'note' || draft.kind === 'image' ? draft.content.trim() || null : null,
      source_url: draft.kind === 'link' ? draft.sourceUrl.trim() : null,
      title: draft.title.trim() || null,
    };
    const { data, error: updateError } = await client
      .from('captures')
      .update(update)
      .eq('id', capture.id)
      .eq('user_id', session.user.id)
      .select(
        'id, kind, status, title, content, source_url, created_at, updated_at, attachments(id, storage_path, original_name, mime_type, size_bytes)',
      )
      .single();

    if (updateError || !data) {
      setError(
        'Changes were not saved. Your edits are still here—check your connection and retry.',
      );
    } else if (isReplacingImage && currentAttachment && replacementImage) {
      const replacementResult = await replaceImageAttachment(
        client,
        session.user.id,
        capture.id,
        currentAttachment,
        replacementImage,
      );

      if (!replacementResult.replaced || !replacementResult.attachment) {
        setCapture(data);
        setDraft(toDraft(data));
        setError(
          `Text changes were saved, but ${replacementResult.error ?? 'the image was not replaced. The original image is unchanged.'}`,
        );
      } else {
        const savedCapture = { ...data, attachments: [replacementResult.attachment] };
        const { data: signedImage, error: signedImageError } = await client.storage
          .from('capture-images')
          .createSignedUrl(replacementResult.attachment.storage_path, 3600);

        setCapture(savedCapture);
        setDraft(toDraft(savedCapture));
        setImageUrl(signedImageError ? null : signedImage.signedUrl);
        setImageError(
          signedImageError
            ? 'The replacement was saved, but its private preview could not be loaded. Retry later.'
            : null,
        );
        setMessage(replacementResult.warning ?? 'Changes saved. Image replaced.');
        setIsReplacingImage(false);
        setReplacementImage(null);
        setIsEditing(false);
      }
    } else {
      setCapture(data);
      setDraft(toDraft(data));
      setMessage('Changes saved.');
      setIsEditing(false);
    }

    setPendingAction(null);
  }

  async function changeStatus(status: CaptureStatus) {
    if (!capture || !session || pendingAction) {
      return;
    }

    setError(null);
    setMessage(null);
    setPendingAction(status);

    const { data, error: updateError } = await client
      .from('captures')
      .update(getCaptureStatusUpdate(status))
      .eq('id', capture.id)
      .eq('user_id', session.user.id)
      .select('status')
      .single();

    if (updateError || !data || !isSupportedStatus(data.status)) {
      setError('The capture status could not be changed. Please retry.');
    } else {
      setCapture((current) => (current ? { ...current, status: data.status } : current));
      setMessage(`Moved to ${captureStatusDetails[data.status].label.toLowerCase()}.`);
      setIsConfirmingDelete(false);
    }

    setPendingAction(null);
  }

  async function copyCaptureContent() {
    if (!capture || (capture.kind !== 'note' && capture.kind !== 'image') || !capture.content) {
      return;
    }

    setError(null);
    setMessage(null);

    try {
      if (!(await copyTextToClipboard(capture.content))) {
        throw new Error('Clipboard access is unavailable.');
      }

      setMessage('Content copied to clipboard.');
    } catch {
      setError('The content could not be copied. Select the text and try again.');
    }
  }

  async function deleteCapture() {
    if (!capture || !session || pendingAction || !isConfirmingDelete) {
      return;
    }

    setError(null);
    setMessage(null);
    setPendingAction('delete');

    let deleted = false;

    if (capture.kind === 'image') {
      const paths = capture.attachments.map((attachment) => attachment.storage_path);

      if (paths.length > 0) {
        const { error: storageError } = await client.storage.from('capture-images').remove(paths);

        if (storageError) {
          setError('The private image was not removed. Nothing else was deleted; please retry.');
          setPendingAction(null);
          return;
        }
      }

      const { data, error: deleteError } = await client.rpc('delete_image_capture_after_storage', {
        p_capture_id: capture.id,
      });
      deleted = !deleteError && data === true;
    } else {
      const { data, error: deleteError } = await client
        .from('captures')
        .delete()
        .eq('id', capture.id)
        .eq('user_id', session.user.id)
        .select('id')
        .single();
      deleted = !deleteError && Boolean(data);
    }

    if (!deleted) {
      setError(
        capture.kind === 'image'
          ? 'The image was removed, but its capture records still need cleanup. Please retry.'
          : 'The capture was not deleted. Please retry.',
      );
      setPendingAction(null);
      return;
    }

    navigate(captureStatusDetails[capture.status as CaptureStatus].path, {
      replace: true,
    });
  }

  async function saveImageToDevice() {
    const attachment = capture?.attachments[0];

    if (
      !capture ||
      capture.kind !== 'image' ||
      !attachment ||
      !imageUrl ||
      isSavingToPhoneRef.current ||
      hasSavedToPhone
    ) {
      return;
    }

    isSavingToPhoneRef.current = true;
    setError(null);
    setMessage(null);
    setIsSavingToPhone(true);

    try {
      const result = await saveImageToPhone({
        expectedSize: attachment.size_bytes,
        fileName: attachment.original_name,
        mimeType: attachment.mime_type,
        url: imageUrl,
      });
      setHasSavedToPhone(true);
      setMessage(`Image saved to ${result.location}.`);
    } catch {
      setError(
        'The image could not be saved to your phone. Please check your connection and retry.',
      );
    } finally {
      isSavingToPhoneRef.current = false;
      setIsSavingToPhone(false);
    }
  }

  if (isLoading) {
    return (
      <section className="workspace-panel" aria-live="polite">
        <p className="eyebrow">Capture detail</p>
        <h1>Loading…</h1>
      </section>
    );
  }

  if (!capture || !draft || !isSupportedStatus(capture.status)) {
    return (
      <section className="message-panel">
        <p className="eyebrow">Capture unavailable</p>
        <h1>Nothing to review here.</h1>
        {error && (
          <div className="form-message form-message--error" role="alert">
            {error}
          </div>
        )}
        <Link className="text-link" to="/inbox">
          Return to inbox
        </Link>
      </section>
    );
  }

  const statusDetails = captureStatusDetails[capture.status];
  const isBusy = pendingAction !== null || isValidatingReplacement;
  const isNativeApp = isNativeImageSaveAvailable();
  const displayTitle = capture.title?.trim() || `Untitled ${capture.kind}`;

  return (
    <section
      className="workspace-panel capture-detail-page"
      aria-labelledby="capture-detail-heading"
    >
      <header className="capture-detail-header">
        <Link
          aria-label={'Back to ' + statusDetails.label.toLowerCase()}
          className={isNativeApp ? 'capture-back-link capture-icon-button' : 'capture-back-link'}
          title={isNativeApp ? 'Back to ' + statusDetails.label.toLowerCase() : undefined}
          to={statusDetails.path}
        >
          <CaptureActionIcon name="back" />
          {!isNativeApp && <span>{statusDetails.label}</span>}
        </Link>

        <p className="eyebrow">Review and organize</p>
        <h1 id="capture-detail-heading">{isEditing ? 'Edit capture' : displayTitle}</h1>

        <div className="capture-detail-meta">
          <span className="status-pill">{statusDetails.label}</span>
          <span>{capture.kind}</span>
          <time dateTime={capture.created_at}>
            Created{' '}
            {new Intl.DateTimeFormat(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(new Date(capture.created_at))}
          </time>
        </div>
        {!isEditing && (
          <div className="capture-header-actions" aria-label="Capture actions">
            <button
              aria-label="Edit"
              className={
                isNativeApp
                  ? 'secondary-button capture-action-button capture-icon-button'
                  : 'secondary-button capture-action-button'
              }
              onClick={startEditing}
              title={isNativeApp ? 'Edit' : undefined}
              type="button"
            >
              <CaptureActionIcon name="edit" />
              {!isNativeApp && <span>Edit</span>}
            </button>
            {(capture.kind === 'note' || capture.kind === 'image') && capture.content && (
              <button
                aria-label="Copy content"
                className={
                  isNativeApp
                    ? 'secondary-button capture-action-button capture-icon-button'
                    : 'secondary-button capture-action-button'
                }
                onClick={() => void copyCaptureContent()}
                title={isNativeApp ? 'Copy content' : undefined}
                type="button"
              >
                <CaptureActionIcon name="copy" />
                {!isNativeApp && (
                  <span>{message?.startsWith('Content copied') ? 'Copied' : 'Copy'}</span>
                )}
              </button>
            )}
          </div>
        )}
      </header>
      {error && (
        <div className="form-message form-message--error" role="alert">
          {error}
        </div>
      )}

      {message && (
        <div className="form-message form-message--success" role="status">
          {message}
        </div>
      )}

      {capture.kind === 'image' && (
        <>
          {!isReplacingImage &&
            (imageUrl ? (
              <>
                <figure className="capture-image">
                  <img alt={capture.title || 'Saved image'} src={imageUrl} />
                  {capture.attachments[0] && (
                    <figcaption>
                      {capture.attachments[0].original_name} ·{' '}
                      {(capture.attachments[0].size_bytes / (1024 * 1024)).toFixed(2)} MiB
                    </figcaption>
                  )}
                </figure>
                {!isEditing && isNativeApp && capture.attachments[0] && (
                  <div className="form-actions">
                    <button
                      className="secondary-button"
                      disabled={isSavingToPhone || hasSavedToPhone}
                      onClick={() => void saveImageToDevice()}
                      type="button"
                    >
                      {isSavingToPhone
                        ? 'Saving to phone…'
                        : hasSavedToPhone
                          ? 'Saved to phone'
                          : 'Save to phone'}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="image-placeholder" role={imageError ? 'alert' : undefined}>
                {imageError ?? 'Loading private image…'}
              </div>
            ))}

          {isEditing && capture.attachments[0] && !isReplacingImage && (
            <div className="image-edit-actions">
              <button
                className="secondary-button"
                disabled={isBusy}
                onClick={beginImageReplacement}
                type="button"
              >
                Remove image
              </button>
              <p>The current image stays published until you save a replacement.</p>
            </div>
          )}

          {isEditing && isReplacingImage && (
            <section className="image-replacement-panel" aria-labelledby="replacement-heading">
              <p className="section-kicker">Image replacement</p>
              <h2 id="replacement-heading">Choose a new image</h2>
              <p>The published image is unchanged until Save changes succeeds.</p>
              <label>
                Replacement image
                <input
                  accept="image/jpeg,image/png,image/webp"
                  disabled={isBusy}
                  onChange={(event) => void chooseReplacementImage(event.target.files?.[0] ?? null)}
                  type="file"
                />
              </label>
              {isValidatingReplacement && <p role="status">Checking image…</p>}
              {replacementImage && (
                <p className="selected-image-name">
                  Selected: {replacementImage.name} ·{' '}
                  {(replacementImage.size / (1024 * 1024)).toFixed(2)} MiB
                </p>
              )}
              <button
                className="secondary-button"
                disabled={isBusy}
                onClick={undoImageReplacement}
                type="button"
              >
                Keep current image
              </button>
            </section>
          )}
        </>
      )}

      {isEditing ? (
        <form className="form-stack" onSubmit={(event) => void handleSave(event)}>
          <label>
            Title <span className="optional-label">Optional</span>
            <input
              disabled={isBusy}
              maxLength={500}
              onChange={(event) => updateDraft({ title: event.target.value })}
              value={draft.title}
            />
          </label>

          {draft.kind === 'note' || draft.kind === 'image' ? (
            <label>
              Note
              {draft.kind === 'image' && <span className="optional-label">Optional</span>}
              <textarea
                disabled={isBusy}
                onChange={(event) => updateDraft({ content: event.target.value })}
                rows={12}
                value={draft.content}
              />
            </label>
          ) : (
            <label>
              URL
              <input
                disabled={isBusy}
                inputMode="url"
                onChange={(event) => updateDraft({ sourceUrl: event.target.value })}
                required
                type="url"
                value={draft.sourceUrl}
              />
            </label>
          )}

          <div className="form-actions">
            <button className="primary-button" disabled={isBusy} type="submit">
              {pendingAction === 'save' ? 'Saving…' : 'Save changes'}
            </button>
            <button
              className="secondary-button"
              disabled={isBusy}
              onClick={cancelEditing}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="capture-reading-surface">
          <article className="capture-reader" aria-label={capture.kind + ' content'}>
            {(capture.kind === 'note' || capture.kind === 'image') &&
              (capture.content ? (
                <div className="capture-reader-content">{capture.content}</div>
              ) : (
                <p className="capture-reader-empty">No note text.</p>
              ))}
            {capture.kind === 'link' && capture.source_url && (
              <a
                className="capture-reader-link"
                href={capture.source_url}
                rel="noreferrer"
                target="_blank"
              >
                {capture.source_url}
              </a>
            )}
          </article>
        </div>
      )}

      <div hidden={isEditing}>
        <section className="lifecycle-panel" aria-labelledby="lifecycle-heading">
          <div className="lifecycle-heading">
            <div>
              <p className="section-kicker">Next step</p>
              <h2 id="lifecycle-heading">Organize</h2>
            </div>
            <div className="form-actions">
              {capture.status === 'inbox' && (
                <button
                  className="secondary-button lifecycle-action"
                  disabled={isBusy}
                  onClick={() => void changeStatus('reviewed')}
                  type="button"
                >
                  <CaptureActionIcon name="review" />
                  Mark reviewed
                </button>
              )}
              {capture.status !== 'inbox' && (
                <button
                  className="secondary-button lifecycle-action"
                  disabled={isBusy}
                  onClick={() => void changeStatus('inbox')}
                  type="button"
                >
                  <CaptureActionIcon name="restore" />
                  Restore to inbox
                </button>
              )}
              {capture.status !== 'archived' && (
                <button
                  className="secondary-button lifecycle-action"
                  disabled={isBusy}
                  onClick={() => void changeStatus('archived')}
                  type="button"
                >
                  <CaptureActionIcon name="archive" />
                  Archive
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="danger-zone" aria-labelledby="delete-heading">
          <h2 id="delete-heading">Delete capture</h2>
          <p>This permanently removes this capture. This action cannot be undone.</p>
          {isConfirmingDelete ? (
            <div className="confirmation-panel">
              <strong>Are you sure?</strong>
              <div className="form-actions">
                <button
                  className="danger-button"
                  disabled={isBusy}
                  onClick={() => void deleteCapture()}
                  type="button"
                >
                  {pendingAction === 'delete' ? 'Deleting…' : 'Delete permanently'}
                </button>
                <button
                  className="secondary-button"
                  disabled={isBusy}
                  onClick={() => setIsConfirmingDelete(false)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="danger-button"
              disabled={isBusy}
              onClick={() => setIsConfirmingDelete(true)}
              type="button"
            >
              Delete…
            </button>
          )}
        </section>
      </div>
    </section>
  );
}

function CaptureActionIcon({
  name,
}: {
  name: 'archive' | 'back' | 'copy' | 'edit' | 'restore' | 'review';
}) {
  return (
    <svg aria-hidden="true" className="capture-action-icon" fill="none" viewBox="0 0 24 24">
      {name === 'edit' && <path d="m5 19 3.8-.8L18 9l-3-3-9.2 9.2L5 19Zm8.5-11.5 3 3" />}
      {name === 'copy' && (
        <>
          <rect height="11" rx="1.5" width="9" x="9" y="8" />
          <path d="M15 8V6.5A1.5 1.5 0 0 0 13.5 5h-7A1.5 1.5 0 0 0 5 6.5v9A1.5 1.5 0 0 0 6.5 17H9" />
        </>
      )}
      {name === 'back' && <path d="m10 6-6 6 6 6m-6-6h16" />}
      {name === 'review' && <path d="m5 12 4 4L19 6" />}
      {name === 'restore' && (
        <>
          <path d="M4 7v5h5" />
          <path d="M5.5 11a7 7 0 1 1 2 6" />
        </>
      )}
      {name === 'archive' && (
        <>
          <path d="M5 8h14v11H5V8Z" />
          <path d="M4 5h16v3H4V5Zm6 7h4" />
        </>
      )}
    </svg>
  );
}
