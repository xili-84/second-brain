import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link2, X } from 'lucide-react';
import { Link } from 'react-router-dom';

import { ActionBar } from '../../components/ActionBar';
import { Notice } from '../../components/Notice';
import { TopBar } from '../../components/TopBar';

import { useAuth } from '../auth/authContext';
import { loadPendingSharedImage, pendingSharedImages } from '../share-target/nativeShare';
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
  createUploadItems,
  discardPendingImage,
  IMAGE_BUCKET,
  markerFor,
  saveImageCapture,
  type ImageCaptureOperation,
} from './imageCapture';
import { ImageTray } from './images/ImageTray';
import { useImageDrafts } from './images/useImageDrafts';
import { requestLinkPreview } from '../linkPreview/linkPreview';

export function QuickCapturePage() {
  const { client, session } = useAuth();
  const { clearPendingShare, error: shareError, pendingShare } = usePendingShare();
  const [draft, setDraft] = useState<CaptureDraft>(() => createEmptyDraft());
  const loadedShareId = useRef<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const drafts = useImageDrafts();
  /**
   * The save operation for the current images. It survives a failed attempt, so a retry reuses
   * the IDs (and skips the uploads) of images that are already stored.
   */
  const [imageOperation, setImageOperation] = useState<ImageCaptureOperation | null>(null);
  const [uploadedKeys, setUploadedKeys] = useState<ReadonlySet<string>>(new Set());
  const [isLoadingShare, setIsLoadingShare] = useState(false);
  // Tags are saved right after the capture itself; a tag failure never undoes the capture.
  const [tagNames, setTagNames] = useState<string[]>([]);
  const tagLibrary = useTagLibrary(client, Boolean(session));
  const { addFiles, reset: resetImages } = drafts;

  useEffect(() => {
    if (!pendingShare || pendingShare.id === loadedShareId.current) {
      return;
    }

    let isActive = true;
    loadedShareId.current = pendingShare.id;
    setMessage(null);
    setError(null);
    setWarning(null);
    setHasSaved(false);
    resetImages([]);
    setImageOperation(null);
    setUploadedKeys(new Set());

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

    const sharedImages = pendingSharedImages(pendingShare);

    if (sharedImages.length === 0) {
      setError(pendingShare.error ?? 'The shared image could not be prepared.');
      return;
    }

    if (pendingShare.error) {
      setWarning(pendingShare.error);
    }

    if (!session?.user.id) {
      setError('Sign in before preparing the shared image.');
      return;
    }

    setIsLoadingShare(true);

    void (async () => {
      const files: File[] = [];
      let unreadable = 0;
      // One at a time: each image crosses the native bridge in chunks.
      for (const image of sharedImages) {
        try {
          files.push((await loadPendingSharedImage(pendingShare.id, image)).file);
        } catch {
          unreadable += 1;
        }
      }
      if (!isActive) {
        return;
      }
      // Android already checked the type, size and file signature of each shared image.
      const { rejected } = await addFiles(files, { trusted: true });
      if (!isActive) {
        return;
      }
      setIsLoadingShare(false);
      const problems = [
        ...(unreadable
          ? [
              unreadable === sharedImages.length
                ? 'The temporary shared image could not be opened. Please share it again.'
                : `${unreadable} shared ${unreadable === 1 ? 'image' : 'images'} could not be opened.`,
            ]
          : []),
        ...rejected,
      ];
      if (problems.length) {
        setError(problems.join(' '));
      }
    })();

    return () => {
      isActive = false;
      setIsLoadingShare(false);
    };
  }, [addFiles, pendingShare, resetImages, session?.user.id]);

  function updateDraft(update: Partial<CaptureDraft>) {
    setDraft((current) => ({ ...current, ...update }));
    setMessage(null);
    setError(null);
  }

  function chooseKind(kind: CaptureKind) {
    updateDraft({ kind });
  }

  async function chooseImages(files: File[]) {
    setMessage(null);
    setError(null);
    if (!session) {
      setError('The image could not be prepared.');
      return;
    }
    const { rejected } = await drafts.addFiles(files);
    if (rejected.length) {
      setError(rejected.join(' '));
    }
  }

  function removeImage(key: string) {
    const stored = imageOperation?.items.find((item) => item.key === key);
    // An image already uploaded in a failed attempt is removed from Storage right away.
    if (stored && uploadedKeys.has(key)) {
      void client.storage.from(IMAGE_BUCKET).remove([stored.storagePath]);
      setUploadedKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
    drafts.remove(key);
    setError(null);
  }

  function resetImageState() {
    resetImages([]);
    setImageOperation(null);
    setUploadedKeys(new Set());
  }

  async function handleDiscard() {
    setError(null);

    try {
      const marker =
        imageOperation &&
        markerFor(imageOperation.userId, imageOperation.captureId, imageOperation.items);

      if (marker && uploadedKeys.size > 0) {
        const cleanupError = await discardPendingImage(client, marker);

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
      setWarning(null);
      resetImageState();
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
    setWarning(null);
    resetImageState();
  }

  /** The operation for the images on screen, reusing upload slots from an earlier attempt. */
  function operationForImages(userId: string): ImageCaptureOperation {
    const previous = imageOperation?.userId === userId ? imageOperation : null;
    const captureId = previous?.captureId ?? crypto.randomUUID();
    const reused = new Map(previous?.items.map((item) => [item.key, item]));
    const items = drafts.images.flatMap((image) => {
      if (!image.file) {
        return [];
      }
      return [
        reused.get(image.key) ??
          createUploadItems(userId, captureId, [{ file: image.file, key: image.key }])[0]!,
      ];
    });
    return {
      captureId,
      createdAt: previous?.createdAt ?? new Date().toISOString(),
      items,
      userId,
    };
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

    if (draft.kind === 'image' && drafts.images.length === 0) {
      setError('Choose a JPEG, PNG, or WebP image before saving.');
      return;
    }

    setError(null);
    setMessage(null);
    setWarning(null);
    setIsSubmitting(true);

    let savedCaptureId = draft.id;

    if (draft.kind === 'image') {
      const operation = operationForImages(session.user.id);
      setImageOperation(operation);
      savedCaptureId = operation.captureId;
      drafts.setStatuses(
        Object.fromEntries(
          operation.items.map((item) => [
            item.key,
            uploadedKeys.has(item.key) ? 'done' : undefined,
          ]),
        ),
      );
      const result = await saveImageCapture(client, operation, draft, {
        onItem: drafts.setStatus,
        uploadedKeys,
      });

      setUploadedKeys(new Set(result.uploadedKeys));

      if (!result.saved) {
        setError(result.error);
        setIsSubmitting(false);
        return;
      }

      setWarning(result.warning);
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

    if (draft.kind === 'link') {
      // Fetched in the background; the inbox row picks the preview up when it arrives.
      void requestLinkPreview(client, draft.id);
    }

    let tagWarning: string | null = null;
    // Image captures get their id from the upload operation; notes and links use the draft id.
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

  const isValidatingImage = drafts.isValidating || isLoadingShare;
  const isBusy = isSubmitting || isValidatingImage;
  const uploading = drafts.images.filter((image) => image.status);
  const uploadLabel =
    isSubmitting && uploading.length
      ? uploading.every((image) => image.status === 'done')
        ? 'Saving…'
        : `Uploading ${uploading.filter((image) => image.status === 'done').length} of ${uploading.length}…`
      : null;
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
      {warning && <Notice tone="info">{warning}</Notice>}

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
              <ImageTray
                disabled={isSubmitting}
                images={drafts.images}
                isValidating={isValidatingImage}
                onAdd={(files) => void chooseImages(files)}
                onMove={drafts.move}
                onRemove={removeImage}
              />
              <textarea
                aria-label="Note"
                className="composer__body composer__body--short"
                disabled={isSubmitting}
                onChange={(event) => updateDraft({ content: event.target.value })}
                placeholder={
                  drafts.images.length > 1
                    ? 'Why keep these images? (optional)'
                    : 'Why keep this image? (optional)'
                }
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
              {isValidatingImage
                ? 'Checking images…'
                : isSubmitting
                  ? (uploadLabel ?? 'Saving…')
                  : 'Save to inbox'}
            </button>
          </ActionBar>
        </form>
      )}
    </section>
  );
}
