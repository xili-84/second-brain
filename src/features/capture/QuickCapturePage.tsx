import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../auth/authContext';
import { loadPendingSharedImage } from '../share-target/nativeShare';
import { usePendingShare } from '../share-target/pendingShareContext';
import {
  createDraftFromShare,
  createEmptyDraft,
  validateCaptureDraft,
  type CaptureDraft,
  type CaptureKind,
} from './captureDraft';
import {
  createImageOperation,
  discardPendingImage,
  isSupportedImageMime,
  saveImageCapture,
  validateImageFile,
  validateImageMetadata,
  type ImageOperation,
} from './imageCapture';

export function QuickCapturePage() {
  const { client, session } = useAuth();
  const { clearPendingShare, error: shareError, pendingShare } = usePendingShare();
  const [draft, setDraft] = useState<CaptureDraft>(() => createEmptyDraft());
  const loadedShareId = useRef<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imageOperation, setImageOperation] = useState<ImageOperation | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [sharedImagePreviewUrl, setSharedImagePreviewUrl] = useState<string | null>(null);
  const [isValidatingImage, setIsValidatingImage] = useState(false);

  useEffect(() => {
    if (!pendingShare || pendingShare.id === loadedShareId.current) {
      return;
    }

    let isActive = true;
    loadedShareId.current = pendingShare.id;
    setMessage(null);
    setError(null);
    setHasSaved(false);
    setSelectedImage(null);
    setImageOperation(null);
    setSharedImagePreviewUrl(null);
    setIsValidatingImage(false);

    if (pendingShare.kind === 'text') {
      setDraft(createDraftFromShare(pendingShare.title, pendingShare.text));
      return;
    }

    setDraft({
      ...createEmptyDraft(),
      content: pendingShare.text,
      kind: 'image',
      title: pendingShare.title,
    });

    if (pendingShare.error || !pendingShare.image) {
      setError(pendingShare.error ?? 'The shared image could not be prepared.');
      return;
    }

    const userId = session?.user.id;

    if (!userId) {
      setError('Sign in before preparing the shared image.');
      return;
    }

    setIsValidatingImage(true);

    void loadPendingSharedImage(pendingShare.id, pendingShare.image)
      .then(({ file, previewUrl }) => {
        if (!isActive) {
          return;
        }

        const validationError = validateImageMetadata(file);
        setIsValidatingImage(false);

        if (validationError || !isSupportedImageMime(file.type)) {
          setError(validationError ?? 'The shared image format is not supported.');
          return;
        }

        setSharedImagePreviewUrl(previewUrl);
        setSelectedImage(file);
        setImageOperation(createImageOperation(userId, file.type));
      })
      .catch(() => {
        if (isActive) {
          setIsValidatingImage(false);
          setError('The temporary shared image could not be opened. Please share it again.');
        }
      });

    return () => {
      isActive = false;
    };
  }, [pendingShare, session?.user.id]);

  useEffect(() => {
    if (!selectedImage) {
      setImagePreviewUrl(null);
      return;
    }

    if (sharedImagePreviewUrl) {
      setImagePreviewUrl(sharedImagePreviewUrl);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImagePreviewUrl(reader.result);
      }
    };
    reader.onerror = () => {
      setImagePreviewUrl(null);
      setError('The image preview could not be displayed.');
    };
    reader.readAsDataURL(selectedImage);

    return () => {
      if (reader.readyState === FileReader.LOADING) {
        reader.abort();
      }
    };
  }, [selectedImage, sharedImagePreviewUrl]);

  function updateDraft(update: Partial<CaptureDraft>) {
    setDraft((current) => ({ ...current, ...update }));
    setMessage(null);
    setError(null);
  }

  function chooseKind(kind: CaptureKind) {
    updateDraft({ kind });

    if (kind !== 'image') {
      setSelectedImage(null);
      setImageOperation(null);
      setSharedImagePreviewUrl(null);
    }
  }

  async function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setMessage(null);
    setError(null);
    setSharedImagePreviewUrl(null);

    if (!file) {
      setSelectedImage(null);
      setImageOperation(null);
      setSharedImagePreviewUrl(null);
      return;
    }

    setIsValidatingImage(true);
    const validationError = await validateImageFile(file);
    setIsValidatingImage(false);

    if (validationError || !session || !isSupportedImageMime(file.type)) {
      setSelectedImage(null);
      setImageOperation(null);
      setSharedImagePreviewUrl(null);
      event.target.value = '';
      setError(validationError ?? 'The image could not be prepared.');
      return;
    }

    setSelectedImage(file);
    setImageOperation(createImageOperation(session.user.id, file.type));
  }

  async function handleDiscard() {
    setError(null);

    try {
      if (imageOperation) {
        const cleanupError = await discardPendingImage(client, imageOperation);

        if (cleanupError) {
          setError('The pending image could not be discarded. Please try again.');
          return;
        }
      }

      await clearPendingShare();
      setDraft(createEmptyDraft());
      loadedShareId.current = null;
      setHasSaved(false);
      setSelectedImage(null);
      setImageOperation(null);
      setSharedImagePreviewUrl(null);
      setMessage('Draft discarded. Nothing was saved.');
    } catch {
      setError('The Android share could not be discarded. Please try again.');
    }
  }

  function startAnotherCapture() {
    setDraft(createEmptyDraft());
    loadedShareId.current = null;
    setHasSaved(false);
    setMessage(null);
    setError(null);
    setSelectedImage(null);
    setImageOperation(null);
    setSharedImagePreviewUrl(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session || isSubmitting || hasSaved) {
      return;
    }

    const validationError = validateCaptureDraft(draft);

    if (validationError) {
      setError(validationError);
      return;
    }

    if (draft.kind === 'image' && (!selectedImage || !imageOperation)) {
      setError('Choose a JPEG, PNG, or WebP image before saving.');
      return;
    }

    setError(null);
    setMessage(null);
    setIsSubmitting(true);

    if (draft.kind === 'image' && selectedImage && imageOperation) {
      const result = await saveImageCapture(client, imageOperation, draft, selectedImage);

      if (!result.saved) {
        setError(result.error);
        setIsSubmitting(false);
        return;
      }
    } else {
      const { error: insertError } = await client
        .from('captures')
        .insert({
          content: draft.kind === 'note' ? draft.content.trim() || null : null,
          id: draft.id,
          kind: draft.kind,
          source_url: draft.kind === 'link' ? draft.sourceUrl.trim() : null,
          status: 'inbox',
          title: draft.title.trim() || null,
          user_id: session.user.id,
        })
        .select('id')
        .single();

      if (insertError) {
        setError('Saving failed. Your draft is still here—check your connection and try again.');
        setIsSubmitting(false);
        return;
      }
    }

    setHasSaved(true);

    try {
      await clearPendingShare();
      loadedShareId.current = null;
      setMessage('Capture saved to your inbox.');
    } catch {
      setError(
        'The capture was saved, but Android could not clear the pending share. Do not save it again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="workspace-panel" aria-labelledby="capture-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{pendingShare ? 'Android share received' : 'Quick capture'}</p>
          <h1 id="capture-heading">Capture</h1>
        </div>
      </div>

      {pendingShare && !hasSaved && (
        <p className="diagnostic-note">
          Review this shared content before saving. Nothing has been saved yet.
        </p>
      )}

      {(error || shareError) && (
        <div className="form-message form-message--error" role="alert">
          {error ?? shareError}
        </div>
      )}

      {message && (
        <div className="form-message form-message--success" role="status">
          {message}
        </div>
      )}

      {hasSaved ? (
        <div className="saved-actions">
          <button className="primary-button" onClick={startAnotherCapture} type="button">
            Capture another
          </button>
          <Link className="secondary-button" to="/inbox">
            Open inbox
          </Link>
        </div>
      ) : (
        <form className="form-stack" onSubmit={(event) => void handleSubmit(event)}>
          <fieldset className="kind-picker">
            <legend>Capture type</legend>
            <label>
              <input
                checked={draft.kind === 'note'}
                name="kind"
                onChange={() => chooseKind('note')}
                type="radio"
              />
              Note
            </label>
            <label>
              <input
                checked={draft.kind === 'link'}
                name="kind"
                onChange={() => chooseKind('link')}
                type="radio"
              />
              Link
            </label>
            <label>
              <input
                checked={draft.kind === 'image'}
                name="kind"
                onChange={() => chooseKind('image')}
                type="radio"
              />
              Image
            </label>
          </fieldset>

          <label>
            Title <span className="optional-label">Optional</span>
            <input
              maxLength={500}
              onChange={(event) => updateDraft({ title: event.target.value })}
              placeholder={draft.kind === 'link' ? 'A useful reference' : 'Short heading'}
              value={draft.title}
            />
          </label>

          {draft.kind === 'note' ? (
            <label>
              Note
              <textarea
                autoFocus={!pendingShare}
                onChange={(event) => updateDraft({ content: event.target.value })}
                placeholder="What do you want to remember?"
                rows={8}
                value={draft.content}
              />
            </label>
          ) : draft.kind === 'link' ? (
            <label>
              URL
              <input
                inputMode="url"
                onChange={(event) => updateDraft({ sourceUrl: event.target.value })}
                placeholder="https://example.com"
                required
                type="url"
                value={draft.sourceUrl}
              />
            </label>
          ) : (
            <>
              <label>
                Image
                <input
                  accept="image/jpeg,image/png,image/webp"
                  disabled={isSubmitting || isValidatingImage}
                  onChange={(event) => void chooseImage(event)}
                  type="file"
                />
                <span className="field-help">JPEG, PNG, or WebP. Maximum size 10 MiB.</span>
              </label>

              {imagePreviewUrl && selectedImage && (
                <figure className="image-selection">
                  <img
                    alt="Selected upload preview"
                    onError={() => setError('The shared image preview could not be displayed.')}
                    src={imagePreviewUrl}
                  />
                  <figcaption>
                    {selectedImage.name} · {(selectedImage.size / (1024 * 1024)).toFixed(2)} MiB
                  </figcaption>
                </figure>
              )}

              <label>
                Note <span className="optional-label">Optional</span>
                <textarea
                  disabled={isSubmitting}
                  onChange={(event) => updateDraft({ content: event.target.value })}
                  placeholder="Why do you want to keep this image?"
                  rows={5}
                  value={draft.content}
                />
              </label>
            </>
          )}

          <div className="form-actions">
            <button
              className="primary-button"
              disabled={isSubmitting || isValidatingImage}
              type="submit"
            >
              {isValidatingImage ? 'Checking image…' : isSubmitting ? 'Saving…' : 'Save to inbox'}
            </button>
            <button
              className="secondary-button"
              disabled={isSubmitting}
              onClick={() => void handleDiscard()}
              type="button"
            >
              Discard
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
