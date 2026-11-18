import type { CaptureStatus } from '../capture/captureLifecycle';
import { captureStatusDetails } from '../capture/captureLifecycle';
import { TagList } from '../tags/TagList';
import { tagsFromEmbed } from '../tags/tagNames';
import { sortAttachments } from '../capture/imageStorage';
import { FileIcon } from '../files/FileIcon';
import { fileCategory, fileTypeLabel, formatBytes } from '../files/fileInfo';
import { safeFavicon } from '../linkPreview/linkPreview';
import { CaptureRow } from './CaptureRow';
import { captureTitle, displayUrl, domainOf, groupByDay, isUntitledLink } from './listFormat';
import type { CaptureSummary } from './useCaptureList';
import { imageCount, thumbnailKey, thumbnailSource } from './useThumbnails';

type CaptureRiverProps = {
  captures: CaptureSummary[];
  isBusy: boolean;
  /** Undoable delete from the list (swipe on touch, trash button with a mouse). */
  onDelete?: ((capture: CaptureSummary, label: string) => void) | undefined;
  /** Long-press a row to start selecting with it. */
  onLongPress?: ((capture: CaptureSummary) => void) | undefined;
  onToggleFavorite: (capture: CaptureSummary) => void;
  /** Present in select mode: which rows are ticked, and how to toggle one. */
  selection?:
    { onToggle: (capture: CaptureSummary) => void; selectedIds: ReadonlySet<string> } | undefined;
  status: CaptureStatus;
  thumbnails: Record<string, string>;
};

/** A status list as an editorial "river": day groups with hairline-separated rows. */
export function CaptureRiver({
  captures,
  isBusy,
  onDelete,
  onLongPress,
  onToggleFavorite,
  selection,
  status,
  thumbnails,
}: CaptureRiverProps) {
  const details = captureStatusDetails[status];

  return (
    <div
      aria-busy={isBusy}
      className={selection ? 'river-groups river-groups--selecting' : 'river-groups'}
    >
      {groupByDay(captures).map((group) => (
        <section aria-labelledby={`group-${group.label}`} className="river-group" key={group.label}>
          <h2 className="river-group__label" id={`group-${group.label}`}>
            {group.label}
          </h2>
          <ol aria-label={`${details.label}, ${group.label}`} className="river">
            {group.items.map((capture) => {
              const firstLine = capture.content?.trim().split('\n')[0]?.trim();
              // An untitled note leads with its first line instead of "Untitled note".
              const files = capture.kind === 'file' ? sortAttachments(capture.attachments) : [];
              const firstFile = files[0];
              const fileName = firstFile?.original_name ?? '';
              const title =
                capture.kind === 'note' && !capture.title?.trim() && firstLine
                  ? firstLine
                  : capture.kind === 'file' && !capture.title?.trim() && fileName
                    ? fileName
                    : captureTitle(capture);
              const untitledLink = isUntitledLink(capture);
              const isImage = capture.kind === 'image';
              const isLink = capture.kind === 'link';
              const thumbnail = thumbnailSource(capture);
              // Note text is a helpful preview; image notes stay private in lists. Links show
              // their page description when a preview was fetched.
              const fileSummary = firstFile
                ? [
                    capture.title?.trim()
                      ? `${fileName}${files.length > 1 ? ` +${files.length - 1} more` : ''}`
                      : files.length > 1
                        ? `+${files.length - 1} more`
                        : fileTypeLabel(fileName, firstFile.mime_type),
                    formatBytes(files.reduce((total, file) => total + (file.size_bytes ?? 0), 0)),
                  ].join(' · ')
                : null;
              const excerpt =
                capture.kind === 'note' && capture.title?.trim()
                  ? capture.content?.trim()
                  : isLink
                    ? capture.link_description
                    : capture.kind === 'file'
                      ? fileSummary
                      : null;

              return (
                <CaptureRow
                  accessibleName={`Open ${title}`}
                  createdAt={capture.created_at}
                  domain={isLink ? capture.link_site_name || domainOf(capture.source_url) : null}
                  excerpt={excerpt}
                  favicon={isLink ? safeFavicon(capture.link_favicon) : null}
                  fileIcon={
                    firstFile && (
                      <FileIcon category={fileCategory(fileName, firstFile.mime_type ?? '')} />
                    )
                  }
                  favorite={{
                    isFavorite: Boolean(capture.is_favorite),
                    onToggle: () => onToggleFavorite(capture),
                  }}
                  href={`/captures/${capture.id}`}
                  imageCount={imageCount(capture)}
                  key={capture.id}
                  kind={capture.kind}
                  onDelete={onDelete && (() => onDelete(capture, title))}
                  onLongPress={onLongPress && (() => onLongPress(capture))}
                  section={details.path}
                  selection={
                    selection && {
                      isSelected: selection.selectedIds.has(capture.id),
                      onToggle: () => selection.onToggle(capture),
                    }
                  }
                  showThumbnail={isImage || Boolean(isLink && thumbnail)}
                  tags={
                    <TagList tags={tagsFromEmbed(capture.capture_tags).map((tag) => tag.name)} />
                  }
                  thumbnailUrl={thumbnail ? thumbnails[thumbnailKey(thumbnail)] : undefined}
                  title={untitledLink ? displayUrl(title) : title}
                  titleIsUrl={untitledLink}
                />
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
