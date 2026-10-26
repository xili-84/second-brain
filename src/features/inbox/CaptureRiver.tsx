import type { CaptureStatus } from '../capture/captureLifecycle';
import { captureStatusDetails } from '../capture/captureLifecycle';
import { TagList } from '../tags/TagList';
import { tagsFromEmbed } from '../tags/tagNames';
import { safeFavicon } from '../linkPreview/linkPreview';
import { CaptureRow } from './CaptureRow';
import { captureTitle, displayUrl, domainOf, groupByDay, isUntitledLink } from './listFormat';
import type { CaptureSummary } from './useCaptureList';
import { thumbnailKey, thumbnailSource } from './useThumbnails';

type CaptureRiverProps = {
  captures: CaptureSummary[];
  isBusy: boolean;
  onToggleFavorite: (capture: CaptureSummary) => void;
  status: CaptureStatus;
  thumbnails: Record<string, string>;
};

/** A status list as an editorial "river": day groups with hairline-separated rows. */
export function CaptureRiver({
  captures,
  isBusy,
  onToggleFavorite,
  status,
  thumbnails,
}: CaptureRiverProps) {
  const details = captureStatusDetails[status];

  return (
    <div aria-busy={isBusy} className="river-groups">
      {groupByDay(captures).map((group) => (
        <section aria-labelledby={`group-${group.label}`} className="river-group" key={group.label}>
          <h2 className="river-group__label" id={`group-${group.label}`}>
            {group.label}
          </h2>
          <ol aria-label={`${details.label}, ${group.label}`} className="river">
            {group.items.map((capture) => {
              const firstLine = capture.content?.trim().split('\n')[0]?.trim();
              // An untitled note leads with its first line instead of "Untitled note".
              const title =
                capture.kind === 'note' && !capture.title?.trim() && firstLine
                  ? firstLine
                  : captureTitle(capture);
              const untitledLink = isUntitledLink(capture);
              const isImage = capture.kind === 'image';
              const isLink = capture.kind === 'link';
              const thumbnail = thumbnailSource(capture);
              // Note text is a helpful preview; image notes stay private in lists. Links show
              // their page description when a preview was fetched.
              const excerpt =
                capture.kind === 'note' && capture.title?.trim()
                  ? capture.content?.trim()
                  : isLink
                    ? capture.link_description
                    : null;

              return (
                <CaptureRow
                  accessibleName={`Open ${title}`}
                  createdAt={capture.created_at}
                  domain={isLink ? capture.link_site_name || domainOf(capture.source_url) : null}
                  excerpt={excerpt}
                  favicon={isLink ? safeFavicon(capture.link_favicon) : null}
                  favorite={{
                    isFavorite: Boolean(capture.is_favorite),
                    onToggle: () => onToggleFavorite(capture),
                  }}
                  href={`/captures/${capture.id}`}
                  key={capture.id}
                  kind={capture.kind}
                  section={details.path}
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
