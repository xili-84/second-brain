import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Archive,
  Check,
  Copy,
  Download,
  LoaderCircle,
  Pencil,
  RotateCcw,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

import { sections, type SectionState } from '../../app/navigation';
import { ActionBar } from '../../components/ActionBar';
import { EmptyState } from '../../components/EmptyState';
import { Notice } from '../../components/Notice';
import { SkeletonArticle } from '../../components/Skeleton';
import { TopBar } from '../../components/TopBar';

import { useAuth } from '../auth/authContext';
import {
  captureStatusDetails,
  getCaptureStatusUpdate,
  type CaptureStatus,
} from './captureLifecycle';
import { validateCaptureDraft, type CaptureDraft, type CaptureKind } from './captureDraft';
import { applyImageEdits, hasImageChanges, type EditedImage } from './imageEdits';
import {
  ATTACHMENT_COLUMNS,
  createImageDownloadUrl,
  createImageSignedUrl,
  DOWNLOAD_URL_TTL_SECONDS,
  sortAttachments,
  type StoredImageAttachment,
} from './imageStorage';
import { deleteCapture } from './deleteCapture';
import { ArticleHeader } from './detail/ArticleHeader';
import { CaptureBody } from './detail/CaptureBody';
import { CaptureEditForm } from './detail/CaptureEditForm';
import { DeleteSheet } from './detail/DeleteSheet';
import { ImageGallery, type GalleryImage, type ImageSize } from './images/ImageGallery';
import { ImageTray } from './images/ImageTray';
import { ImageViewer } from './images/ImageViewer';
import { storedDrafts, useImageDrafts } from './images/useImageDrafts';
import { isNativeImageSaveAvailable, saveImageToPhone } from './nativeImageSaver';
import { FavoriteButton } from '../tags/FavoriteButton';
import { TagEditor } from '../tags/TagEditor';
import type { EmbeddedCaptureTags } from '../tags/tagNames';
import { useCaptureMeta } from '../tags/useCaptureMeta';
import { selectWithPreview, type LinkPreviewFields } from '../linkPreview/linkPreview';
import { useLinkPreview } from '../linkPreview/useLinkPreview';

type CaptureRecord = LinkPreviewFields & {
  attachments: StoredImageAttachment[];
  capture_tags?: EmbeddedCaptureTags;
  content: string | null;
  created_at: string;
  id: string;
  is_favorite?: boolean;
  kind: string;
  source_url: string | null;
  status: string;
  title: string | null;
  updated_at: string;
};

const IMAGE_LOAD_ERROR = 'The private image could not be loaded. Check your connection and retry.';

function withSortedAttachments<T extends { attachments?: StoredImageAttachment[] | null }>(
  record: T,
): T & { attachments: StoredImageAttachment[] } {
  return { ...record, attachments: sortAttachments(record.attachments) };
}

async function signAll(
  client: Parameters<typeof createImageSignedUrl>[0],
  attachments: StoredImageAttachment[],
) {
  const entries = await Promise.all(
    attachments.map(
      async (attachment) =>
        [attachment.id, await createImageSignedUrl(client, attachment.storage_path)] as const,
    ),
  );
  return Object.fromEntries(entries) as Record<string, string | null>;
}

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
  const location = useLocation();
  const { client, session } = useAuth();
  const userId = session?.user.id;
  const [capture, setCapture] = useState<CaptureRecord | null>(null);
  const meta = useCaptureMeta(client, session?.user.id, capture);
  const linkPreview = useLinkPreview(client, capture);
  const [draft, setDraft] = useState<CaptureDraft | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string | null>>({});
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageSizes, setImageSizes] = useState<Record<string, ImageSize>>({});
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const drafts = useImageDrafts();
  const [savingImageId, setSavingImageId] = useState<string | null>(null);
  const [savedImageIds, setSavedImageIds] = useState<ReadonlySet<string>>(new Set());
  const isSavingToPhoneRef = useRef(false);
  /** Attachment IDs whose link was already re-signed once after a load error. */
  const imageRefreshAttempted = useRef(new Set<string>());

  const loadCapture = useCallback(async () => {
    if (!captureId || !userId) {
      return;
    }

    setIsLoading(true);
    setSavedImageIds(new Set());
    setSavingImageId(null);
    isSavingToPhoneRef.current = false;
    imageRefreshAttempted.current = new Set();
    setGalleryIndex(0);
    setViewerIndex(null);
    setError(null);

    const { data: loaded, error: loadError } = await selectWithPreview((previewColumns) =>
      client
        .from('captures')
        .select(
          `id, kind, status, title, content, source_url, created_at, updated_at, is_favorite, attachments(${ATTACHMENT_COLUMNS}), capture_tags(tags(id, name))${previewColumns}`,
        )
        .eq('id', captureId)
        .eq('user_id', userId)
        .single(),
    );
    const data = loaded as CaptureRecord | null;

    if (loadError || !data || !isSupportedKind(data.kind) || !isSupportedStatus(data.status)) {
      setCapture(null);
      setDraft(null);
      setImageUrls({});
      setImageError(null);
      setIsEditing(false);
      setError('This capture could not be loaded. It may have been deleted.');
    } else {
      const record = withSortedAttachments(data);
      setCapture(record);
      setDraft(toDraft(record));
      setIsEditing(false);
      setImageUrls({});
      setImageError(null);

      if (record.kind === 'image') {
        if (record.attachments.length === 0) {
          setImageError('This image capture is incomplete. You can delete it and try again.');
        } else {
          const urls = await signAll(client, record.attachments);
          setImageUrls(urls);
          setImageError(Object.values(urls).some((url) => !url) ? IMAGE_LOAD_ERROR : null);
        }
      }
    }

    setIsLoading(false);
  }, [captureId, client, userId]);

  useEffect(() => {
    void loadCapture();
  }, [loadCapture]);

  /** Signed links expire; re-sign an image once when the browser reports it failed to load. */
  const refreshImageUrl = useCallback(
    async (attachmentId: string) => {
      const attachment = capture?.attachments.find((item) => item.id === attachmentId);

      if (!attachment || imageRefreshAttempted.current.has(attachmentId)) {
        setImageUrls((current) => ({ ...current, [attachmentId]: null }));
        setImageError(IMAGE_LOAD_ERROR);
        return;
      }

      imageRefreshAttempted.current.add(attachmentId);
      const signedUrl = await createImageSignedUrl(client, attachment.storage_path);
      setImageUrls((current) => ({ ...current, [attachmentId]: signedUrl }));
      if (!signedUrl) {
        setImageError(IMAGE_LOAD_ERROR);
      }
    },
    [capture, client],
  );

  /** Manual Retry: re-sign every image that is not showing. */
  const retryImages = useCallback(async () => {
    if (!capture) {
      return;
    }
    const missing = capture.attachments.filter((attachment) => !imageUrls[attachment.id]);
    setImageError(null);
    const urls = await signAll(client, missing);
    missing.forEach((attachment) => imageRefreshAttempted.current.delete(attachment.id));
    setImageUrls((current) => ({ ...current, ...urls }));
    if (Object.values(urls).some((url) => !url)) {
      setImageError(IMAGE_LOAD_ERROR);
    }
  }, [capture, client, imageUrls]);

  const recordSize = useCallback((attachmentId: string, size: ImageSize) => {
    setImageSizes((current) =>
      current[attachmentId]?.width === size.width && current[attachmentId]?.height === size.height
        ? current
        : { ...current, [attachmentId]: size },
    );
  }, []);

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
    drafts.reset(capture.kind === 'image' ? storedDrafts(capture.attachments, imageUrls) : []);
    setIsEditing(true);
  }

  function cancelEditing() {
    if (capture) {
      setDraft(toDraft(capture));
    }

    setError(null);
    setMessage(null);
    drafts.reset([]);
    setIsEditing(false);
  }

  async function addImages(files: File[]) {
    setError(null);
    setMessage(null);
    const { rejected } = await drafts.addFiles(files);
    if (rejected.length) {
      setError(rejected.join(' '));
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!capture || !draft || !session || pendingAction || drafts.isValidating || !isEditing) {
      return;
    }

    const validationError = validateCaptureDraft(draft);

    if (validationError) {
      setError(validationError);
      return;
    }

    const editedImages: EditedImage[] = drafts.images.flatMap((image): EditedImage[] =>
      image.attachment
        ? [{ attachment: image.attachment, key: image.key, kind: 'stored' }]
        : image.file
          ? [{ file: image.file, key: image.key, kind: 'new' }]
          : [],
    );
    const imagesChanged =
      capture.kind === 'image' && hasImageChanges(capture.attachments, editedImages);

    if (capture.kind === 'image' && editedImages.length === 0) {
      setError('Keep at least one image, or delete the capture instead.');
      return;
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
        `id, kind, status, title, content, source_url, created_at, updated_at, attachments(${ATTACHMENT_COLUMNS})`,
      )
      .single();

    if (updateError || !data) {
      setError(
        'Changes were not saved. Your edits are still here—check your connection and retry.',
      );
    } else if (imagesChanged) {
      const textSaved = withSortedAttachments({ ...capture, ...data });
      drafts.setStatuses(
        Object.fromEntries(
          editedImages
            .filter((image) => image.kind === 'new')
            .map((image) => [image.key, undefined]),
        ),
      );
      const result = await applyImageEdits(
        client,
        session.user.id,
        capture.id,
        capture.attachments,
        editedImages,
        { onItem: drafts.setStatus },
      );

      if (!result.saved || !result.attachments) {
        setCapture(textSaved);
        setError(`Text changes were saved, but ${result.error ?? 'the images were not changed.'}`);
      } else {
        const savedCapture = { ...textSaved, attachments: result.attachments };
        const known = Object.fromEntries(
          result.attachments
            .filter((attachment) => imageUrls[attachment.id])
            .map((attachment) => [attachment.id, imageUrls[attachment.id] ?? null]),
        );
        const fresh = await signAll(
          client,
          result.attachments.filter((attachment) => !known[attachment.id]),
        );
        const urls = { ...known, ...fresh };

        imageRefreshAttempted.current = new Set();
        setCapture(savedCapture);
        setDraft(toDraft(savedCapture));
        setImageUrls(urls);
        setImageError(
          Object.values(urls).some((url) => !url)
            ? 'The images were saved, but a private preview could not be loaded. Retry later.'
            : null,
        );
        setGalleryIndex(0);
        setMessage(result.warning ?? 'Changes saved. Images updated.');
        drafts.reset([]);
        setIsEditing(false);
      }
    } else {
      const savedCapture = withSortedAttachments({ ...capture, ...data });
      setCapture(savedCapture);
      setDraft(toDraft(savedCapture));
      setMessage('Changes saved.');
      drafts.reset([]);
      setIsEditing(false);
      // A new address deserves a new preview.
      if (data.kind === 'link' && data.source_url !== capture.source_url) {
        void linkPreview.refresh();
      }
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

  async function confirmDelete() {
    if (!capture || !session || pendingAction || !isConfirmingDelete) {
      return;
    }

    setError(null);
    setMessage(null);
    setPendingAction('delete');

    const result = await deleteCapture(client, session.user.id, {
      attachments: capture.attachments,
      id: capture.id,
      kind: capture.kind,
      link_image_path: linkPreview.fields.link_image_path,
    });

    if (!result.ok && result.reason === 'storage') {
      // Close the sheet so the error is visible on the page; Delete can simply be tried again.
      setIsConfirmingDelete(false);
      setError('The private image was not removed. Nothing else was deleted; please retry.');
      setPendingAction(null);
      return;
    }

    if (!result.ok) {
      setIsConfirmingDelete(false);
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

  async function saveImageToDevice(attachment: StoredImageAttachment) {
    if (
      !capture ||
      capture.kind !== 'image' ||
      isSavingToPhoneRef.current ||
      savedImageIds.has(attachment.id)
    ) {
      return;
    }

    isSavingToPhoneRef.current = true;
    setError(null);
    setMessage(null);
    setSavingImageId(attachment.id);

    try {
      // The displayed link may be close to expiry; sign a short-lived one just for this download.
      const downloadUrl = await createImageSignedUrl(
        client,
        attachment.storage_path,
        DOWNLOAD_URL_TTL_SECONDS,
      );

      if (!downloadUrl) {
        throw new Error('A download link could not be created.');
      }

      const result = await saveImageToPhone({
        expectedSize: attachment.size_bytes,
        fileName: attachment.original_name,
        mimeType: attachment.mime_type,
        url: downloadUrl,
      });
      setSavedImageIds((current) => new Set(current).add(attachment.id));
      setMessage(`Image saved to ${result.location}.`);
    } catch {
      setError(
        'The image could not be saved to your phone. Please check your connection and retry.',
      );
    } finally {
      isSavingToPhoneRef.current = false;
      setSavingImageId(null);
    }
  }

  /** In a browser, download the original file through a short-lived signed link. */
  async function downloadImage(attachment: StoredImageAttachment) {
    setError(null);
    const url = await createImageDownloadUrl(
      client,
      attachment.storage_path,
      attachment.original_name,
    );

    if (!url) {
      setError('The download link could not be created. Please retry.');
      return;
    }

    const link = document.createElement('a');
    link.href = url;
    link.rel = 'noopener';
    link.download = attachment.original_name;
    document.body.append(link);
    link.click();
    link.remove();
  }

  const backSection = (location.state as SectionState | null)?.section;
  const statusPath =
    capture && isSupportedStatus(capture.status)
      ? captureStatusDetails[capture.status].path
      : '/inbox';
  const back = sections.find((section) => section.path === (backSection ?? statusPath)) ??
    sections[0] ?? { label: 'Inbox', path: '/inbox' };
  const backLink = {
    label: back.label,
    name: `Back to ${back.label.toLowerCase()}`,
    to: back.path,
  };

  if (isLoading) {
    return (
      <section aria-busy="true" aria-label="Loading capture" className="page">
        <TopBar back={backLink} />
        <SkeletonArticle />
      </section>
    );
  }

  if (!capture || !draft || !isSupportedStatus(capture.status)) {
    return (
      <section className="page">
        <TopBar back={backLink} />
        <EmptyState
          action={
            <Link className="btn btn--secondary" to="/inbox">
              Return to inbox
            </Link>
          }
          headingLevel="h1"
          title="Nothing to review here"
        >
          {error ?? undefined}
        </EmptyState>
      </section>
    );
  }

  const statusDetails = captureStatusDetails[capture.status];
  const isBusy = pendingAction !== null || drafts.isValidating;
  const isNativeApp = isNativeImageSaveAvailable();
  const hasCopyableText = (capture.kind === 'note' || capture.kind === 'image') && capture.content;
  const displayTitle =
    capture.title?.trim() ||
    (capture.kind === 'link' ? linkPreview.fields.link_title?.trim() : null) ||
    `Untitled ${capture.kind}`;
  const galleryImages: GalleryImage[] = capture.attachments.map((attachment) => ({
    attachment,
    url: imageUrls[attachment.id] ?? null,
  }));
  const imageAltText = capture.title || 'Saved image';
  const uploading = drafts.images.filter((image) => image.status);
  const uploadProgress =
    pendingAction === 'save' && uploading.length
      ? `Uploading ${uploading.filter((image) => image.status === 'done').length} of ${uploading.length}…`
      : null;

  const imageActions = (image: GalleryImage, _index: number, tone: 'page' | 'viewer' = 'page') => {
    const { attachment } = image;
    const className = tone === 'viewer' ? 'viewer__btn' : 'icon-btn';
    if (!image.url) {
      return null;
    }
    if (isNativeApp) {
      const isSaving = savingImageId === attachment.id;
      const isSaved = savedImageIds.has(attachment.id);
      const label = isSaving ? 'Saving to phone…' : isSaved ? 'Saved to phone' : 'Save to phone';
      const Icon = isSaving ? LoaderCircle : isSaved ? Check : Download;
      return (
        <button
          aria-label={label}
          className={className}
          disabled={savingImageId !== null || isSaved}
          onClick={() => void saveImageToDevice(attachment)}
          title={label}
          type="button"
        >
          <Icon aria-hidden="true" className={isSaving ? 'icon icon--spin' : 'icon'} />
        </button>
      );
    }
    return (
      <button
        aria-label="Download image"
        className={className}
        onClick={() => void downloadImage(attachment)}
        title="Download image"
        type="button"
      >
        <Download aria-hidden="true" className="icon" />
      </button>
    );
  };

  const topActions = !isEditing && (
    <>
      <FavoriteButton isFavorite={meta.isFavorite} onToggle={() => void meta.toggleFavorite()} />
      {hasCopyableText && (
        <IconButton icon={Copy} label="Copy content" onClick={() => void copyCaptureContent()} />
      )}
      <IconButton icon={Pencil} label="Edit" onClick={startEditing} />
      <IconButton
        disabled={isBusy}
        icon={Trash2}
        label="Delete"
        onClick={() => setIsConfirmingDelete(true)}
      />
    </>
  );

  return (
    <section aria-labelledby="capture-detail-heading" className="page page--actions">
      <TopBar actions={topActions} back={backLink} />

      <ArticleHeader
        createdAt={capture.created_at}
        kind={capture.kind}
        statusLabel={statusDetails.label}
        title={isEditing ? 'Edit capture' : displayTitle}
      />

      {error && <Notice tone="error">{error}</Notice>}
      {meta.error && <Notice tone="error">{meta.error}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}

      {!isEditing && (
        <div className="article-tags">
          <TagEditor
            applied={meta.tags}
            library={meta.library}
            onAdd={(name) => void meta.addTag(name)}
            onRemove={(name) => void meta.removeTag(name)}
          />
        </div>
      )}

      {capture.kind === 'image' && !isEditing && (
        <ImageGallery
          actions={(image, index) => imageActions(image, index)}
          alt={imageAltText}
          error={imageError}
          images={galleryImages}
          index={Math.min(galleryIndex, Math.max(0, galleryImages.length - 1))}
          onImageError={(attachmentId) => void refreshImageUrl(attachmentId)}
          onIndexChange={setGalleryIndex}
          onOpen={setViewerIndex}
          onRetry={() => void retryImages()}
          onSize={recordSize}
          sizes={imageSizes}
        />
      )}

      {isEditing && capture.kind === 'image' && (
        <div className="edit-images">
          <ImageTray
            disabled={isBusy}
            images={drafts.images}
            isValidating={drafts.isValidating}
            min={1}
            onAdd={(files) => void addImages(files)}
            onMove={drafts.move}
            onRemove={drafts.remove}
          />
          <p className="edit-images__hint">
            The first image is the cover. Saved images stay published until Save changes succeeds.
          </p>
        </div>
      )}

      {isEditing ? (
        <CaptureEditForm
          draft={draft}
          isBusy={isBusy}
          isSaving={pendingAction === 'save'}
          savingLabel={uploadProgress}
          onCancel={cancelEditing}
          onChange={updateDraft}
          onSubmit={(event) => void handleSave(event)}
        />
      ) : (
        <>
          <CaptureBody
            content={capture.content}
            kind={capture.kind}
            linkPreview={{
              fields: linkPreview.fields,
              hasPreview: linkPreview.hasPreview,
              headline: displayTitle,
              imageUrl: linkPreview.imageUrl,
              onImageError: linkPreview.dropImage,
              onRefresh: () => void linkPreview.refresh(),
              refreshState: linkPreview.refreshState,
            }}
            sourceUrl={capture.source_url}
          />

          <ActionBar label="Organize">
            {capture.status !== 'archived' && (
              <button
                className="btn btn--secondary btn--lg"
                disabled={isBusy}
                onClick={() => void changeStatus('archived')}
                type="button"
              >
                <Archive aria-hidden="true" className="icon" />
                {pendingAction === 'archived' ? 'Archiving…' : 'Archive'}
              </button>
            )}
            {capture.status === 'inbox' ? (
              <button
                className="btn btn--primary btn--lg action-bar__main"
                disabled={isBusy}
                onClick={() => void changeStatus('reviewed')}
                type="button"
              >
                <Check aria-hidden="true" className="icon" />
                {pendingAction === 'reviewed' ? 'Saving…' : 'Mark reviewed'}
              </button>
            ) : (
              <button
                className="btn btn--primary btn--lg action-bar__main"
                disabled={isBusy}
                onClick={() => void changeStatus('inbox')}
                type="button"
              >
                <RotateCcw aria-hidden="true" className="icon" />
                {pendingAction === 'inbox' ? 'Saving…' : 'Restore to inbox'}
              </button>
            )}
          </ActionBar>
        </>
      )}

      {viewerIndex !== null && galleryImages.length > 0 && (
        <ImageViewer
          actions={(image, index) => imageActions(image, index, 'viewer')}
          alt={imageAltText}
          images={galleryImages}
          index={Math.min(viewerIndex, galleryImages.length - 1)}
          onClose={() => {
            setGalleryIndex(viewerIndex);
            setViewerIndex(null);
          }}
          onIndexChange={setViewerIndex}
        />
      )}

      {isConfirmingDelete && (
        <DeleteSheet
          isDeleting={pendingAction === 'delete'}
          isImage={capture.kind === 'image'}
          onCancel={() => setIsConfirmingDelete(false)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </section>
  );
}

function IconButton({
  disabled = false,
  icon: Icon,
  label,
  onClick,
}: {
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="icon-btn"
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon aria-hidden="true" className="icon" />
    </button>
  );
}
