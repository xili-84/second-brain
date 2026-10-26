import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Archive,
  Check,
  Copy,
  Download,
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
import { validateImageFile } from './imageCapture';
import { replaceImageAttachment, type StoredImageAttachment } from './imageReplacement';
import { createImageSignedUrl, DOWNLOAD_URL_TTL_SECONDS } from './imageStorage';
import { deleteCapture } from './deleteCapture';
import { ArticleHeader } from './detail/ArticleHeader';
import { CaptureBody } from './detail/CaptureBody';
import { CaptureEditForm } from './detail/CaptureEditForm';
import { CaptureImage } from './detail/CaptureImage';
import { DeleteSheet } from './detail/DeleteSheet';
import { ImageReplacement } from './detail/ImageReplacement';
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
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isReplacingImage, setIsReplacingImage] = useState(false);
  const [replacementImage, setReplacementImage] = useState<File | null>(null);
  const [isValidatingReplacement, setIsValidatingReplacement] = useState(false);
  const [isSavingToPhone, setIsSavingToPhone] = useState(false);
  const [hasSavedToPhone, setHasSavedToPhone] = useState(false);
  const isSavingToPhoneRef = useRef(false);
  const imageRefreshAttempted = useRef(false);

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
    imageRefreshAttempted.current = false;
    setError(null);

    const { data: loaded, error: loadError } = await selectWithPreview((previewColumns) =>
      client
        .from('captures')
        .select(
          `id, kind, status, title, content, source_url, created_at, updated_at, is_favorite, attachments(id, storage_path, original_name, mime_type, size_bytes), capture_tags(tags(id, name))${previewColumns}`,
        )
        .eq('id', captureId)
        .eq('user_id', userId)
        .single(),
    );
    const data = loaded as CaptureRecord | null;

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
          const signedUrl = await createImageSignedUrl(client, imagePath);

          if (!signedUrl) {
            setImageError(
              'The private image could not be loaded. Check your connection and retry.',
            );
          } else {
            setImageUrl(signedUrl);
          }
        }
      }
    }

    setIsLoading(false);
  }, [captureId, client, userId]);

  useEffect(() => {
    void loadCapture();
  }, [loadCapture]);

  /** Signed links expire; re-sign once when the browser reports the image failed to load. */
  const refreshImageUrl = useCallback(
    async (isManualRetry = false) => {
      const imagePath = capture?.kind === 'image' ? capture.attachments[0]?.storage_path : null;

      if (!imagePath || (!isManualRetry && imageRefreshAttempted.current)) {
        if (!isManualRetry) {
          setImageUrl(null);
          setImageError('The private image could not be loaded. Check your connection and retry.');
        }

        return;
      }

      imageRefreshAttempted.current = true;
      setImageError(null);
      const signedUrl = await createImageSignedUrl(client, imagePath);

      if (signedUrl) {
        setImageUrl(signedUrl);
      } else {
        setImageUrl(null);
        setImageError('The private image could not be loaded. Check your connection and retry.');
      }
    },
    [capture, client],
  );

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
        const signedUrl = await createImageSignedUrl(
          client,
          replacementResult.attachment.storage_path,
        );

        imageRefreshAttempted.current = false;
        setCapture(savedCapture);
        setDraft(toDraft(savedCapture));
        setImageUrl(signedUrl);
        setImageError(
          signedUrl
            ? null
            : 'The replacement was saved, but its private preview could not be loaded. Retry later.',
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
  const isBusy = pendingAction !== null || isValidatingReplacement;
  const isNativeApp = isNativeImageSaveAvailable();
  const attachment = capture.attachments[0];
  const hasCopyableText = (capture.kind === 'note' || capture.kind === 'image') && capture.content;
  const displayTitle =
    capture.title?.trim() ||
    (capture.kind === 'link' ? linkPreview.fields.link_title?.trim() : null) ||
    `Untitled ${capture.kind}`;

  const topActions = !isEditing && (
    <>
      <FavoriteButton isFavorite={meta.isFavorite} onToggle={() => void meta.toggleFavorite()} />
      {capture.kind === 'image' && isNativeApp && attachment && imageUrl && (
        <IconButton
          disabled={isSavingToPhone || hasSavedToPhone}
          icon={hasSavedToPhone ? Check : Download}
          label={
            isSavingToPhone
              ? 'Saving to phone…'
              : hasSavedToPhone
                ? 'Saved to phone'
                : 'Save to phone'
          }
          onClick={() => void saveImageToDevice()}
        />
      )}
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

      {capture.kind === 'image' && !isReplacingImage && (
        <CaptureImage
          alt={capture.title || 'Saved image'}
          attachment={attachment}
          error={imageError}
          onError={() => void refreshImageUrl()}
          onRetry={() => void refreshImageUrl(true)}
          url={imageUrl}
        />
      )}

      {isEditing && capture.kind === 'image' && attachment && (
        <ImageReplacement
          isBusy={isBusy}
          isReplacing={isReplacingImage}
          isValidating={isValidatingReplacement}
          onBegin={beginImageReplacement}
          onChoose={(file) => void chooseReplacementImage(file)}
          onUndo={undoImageReplacement}
          replacement={replacementImage}
        />
      )}

      {isEditing ? (
        <CaptureEditForm
          draft={draft}
          isBusy={isBusy}
          isSaving={pendingAction === 'save'}
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
