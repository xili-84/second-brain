import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link2, X } from 'lucide-react';
import { Link } from 'react-router-dom';

import { ActionBar } from '../../components/ActionBar';
import { ImagePicker } from '../../components/ImagePicker';
import { Notice } from '../../components/Notice';
import { TopBar } from '../../components/TopBar';

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
import { TagEditor } from '../tags/TagEditor';
import { applyTags } from '../tags/tagsApi';
import { tagKey } from '../tags/tagNames';
import { useTagLibrary } from '../tags/useTagLibrary';
import { KindSwitch } from './composer/KindSwitch';
import {
  createImageOperation,
  discardPendingImage,
  isSupportedImageMime,
  saveImageCapture,
  validateImageFile,
  validateImageMetadata,
  type ImageOperation,
} from './imageCapture';

function createPreviewUrl(file: File) {
  return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null;
}

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
  const [isValidatingImage, setIsValidatingImage] = useState(false);
  // Tags are saved right after the capture itself; a tag failure never undoes the capture.
  const [tagNames, setTagNames] = useState<string[]>([]);
  const tagLibrary = useTagLibrary(client, Boolean(session));

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
      .then(({ file }) => {
        if (!isActive) {
          return;
        }

        const validationError = validateImageMetadata(file);
        setIsValidatingImage(false);

        if (validationError || !isSupportedImageMime(file.type)) {
          setError(validationError ?? 'The shared image format is not supported.');
          return;
        }

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
    // An object URL references the File directly instead of copying it into a large data: string.
    const previewUrl = selectedImage ? createPreviewUrl(selectedImage) : null;
    setImagePreviewUrl(previewUrl);

    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [selectedImage]);

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
    }
  }

  async function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setMessage(null);
    setError(null);

    if (!file) {
      setSelectedImage(null);
      setImageOperation(null);
      return;
    }

    setIsValidatingImage(true);
    const validationError = await validateImageFile(file);
    setIsValidatingImage(false);

    if (validationError || !session || !isSupportedImageMime(file.type)) {
      setSelectedImage(null);
      setImageOperation(null);
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
      setTagNames([]);
      setDraft(createEmptyDraft());
      loadedShareId.current = null;
      setHasSaved(false);
      setSelectedImage(null);
      setImageOperation(null);
      setMessage('Draft discarded. Nothing was saved.');
    } catch {
      setError('The Android share could not be discarded. Please try again.');
    }
  }

  function startAnotherCapture() {
    setTagNames([]);
    setDraft(createEmptyDraft());
    loadedShareId.current = null;
    setHasSaved(false);
    setMessage(null);
    setError(null);
    setSelectedImage(null);
    setImageOperation(null);
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

    let tagWarning: string | null = null;
    // Image captures get their id from the upload operation; notes and links use the draft id.
    const savedCaptureId =
      draft.kind === 'image' && imageOperation ? imageOperation.captureId : draft.id;
    if (tagNames.length) {
      try {
        tagLibrary.remember(
          await applyTags(client, session.user.id, savedCaptureId, tagNames, tagLibrary.tags),
        );
      } catch {
        tagWarning = ' Some tags could not be added; add them from the capture page.';
      }
    }

    try {
      await clearPendingShare();
      loadedShareId.current = null;
      setMessage(`Capture saved to your inbox.${tagWarning ?? ''}`);
    } catch {
      setError(
        'The capture was saved, but Android could not clear the pending share. Do not save it again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const isBusy = isSubmitting || isValidatingImage;
  const heading = pendingShare ? 'Shared to Second Brain' : 'New capture';

  return (
    <section aria-labelledby="capture-heading" className="page page--actions">
      <TopBar>
        <Link aria-label="Close" className="icon-btn" title="Close" to="/inbox">
          <X aria-hidden="true" className="icon" />
        </Link>
        <h1 className="top-bar__title" id="capture-heading">
          {heading}
        </h1>
      </TopBar>

      {pendingShare && !hasSaved && (
        <Notice tone="info">
          Review this shared content before saving. Nothing has been saved yet.
        </Notice>
      )}
      {(error || shareError) && <Notice tone="error">{error ?? shareError}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}

      {hasSaved ? (
        <div className="saved">
          <div className="saved__actions">
            <button
              className="btn btn--primary btn--lg"
              onClick={startAnotherCapture}
              type="button"
            >
              Capture another
            </button>
            <Link className="btn btn--secondary btn--lg" to="/inbox">
              Open inbox
            </Link>
          </div>
        </div>
      ) : (
        <form className="composer" onSubmit={(event) => void handleSubmit(event)}>
          <KindSwitch disabled={isSubmitting} onChange={chooseKind} value={draft.kind} />

          <input
            aria-label="Title"
            className="composer__title"
            disabled={isSubmitting}
            maxLength={500}
            onChange={(event) => updateDraft({ title: event.target.value })}
            placeholder={draft.kind === 'link' ? 'Headline (optional)' : 'Title (optional)'}
            value={draft.title}
          />

          {draft.kind === 'note' && (
            <textarea
              aria-label="Note"
              autoFocus={!pendingShare}
              className="composer__body"
              disabled={isSubmitting}
              onChange={(event) => updateDraft({ content: event.target.value })}
              placeholder="What do you want to remember?"
              rows={8}
              value={draft.content}
            />
          )}

          {draft.kind === 'link' && (
            <label className="field">
              <span className="field__label">URL</span>
              <span className="input-icon">
                <Link2 aria-hidden="true" className="icon" />
                <input
                  className="input"
                  disabled={isSubmitting}
                  inputMode="url"
                  onChange={(event) => updateDraft({ sourceUrl: event.target.value })}
                  placeholder="https://example.com"
                  required
                  type="url"
                  value={draft.sourceUrl}
                />
              </span>
            </label>
          )}

          {draft.kind === 'image' && (
            <>
              {imagePreviewUrl && selectedImage ? (
                <figure className="preview">
                  <img
                    alt="Selected upload preview"
                    onError={() => setError('The shared image preview could not be displayed.')}
                    src={imagePreviewUrl}
                  />
                  <figcaption>
                    {selectedImage.name} · {(selectedImage.size / (1024 * 1024)).toFixed(2)} MiB
                  </figcaption>
                </figure>
              ) : null}
              <ImagePicker
                disabled={isBusy}
                hint="JPEG, PNG or WebP · up to 10 MiB"
                label={selectedImage ? 'Choose a different image' : 'Choose an image'}
                onChange={(event) => void chooseImage(event)}
              />
              <textarea
                aria-label="Note"
                className="composer__body composer__body--short"
                disabled={isSubmitting}
                onChange={(event) => updateDraft({ content: event.target.value })}
                placeholder="Why keep this image? (optional)"
                rows={4}
                value={draft.content}
              />
            </>
          )}

          <div className="composer__tags">
            <TagEditor
              applied={tagNames.map((name) => ({ name }))}
              disabled={isSubmitting}
              library={tagLibrary.tags}
              onAdd={(name) => setTagNames((current) => [...current, name])}
              onRemove={(name) =>
                setTagNames((current) => current.filter((item) => tagKey(item) !== tagKey(name)))
              }
            />
          </div>

          <ActionBar label="Capture actions">
            <button
              className="btn btn--ghost btn--lg"
              disabled={isSubmitting}
              onClick={() => void handleDiscard()}
              type="button"
            >
              Discard
            </button>
            <button
              className="btn btn--primary btn--lg action-bar__main"
              disabled={isBusy}
              type="submit"
            >
              {isValidatingImage ? 'Checking image…' : isSubmitting ? 'Saving…' : 'Save to inbox'}
            </button>
          </ActionBar>
        </form>
      )}
    </section>
  );
}
