import type { CaptureStatus } from '../capture/captureLifecycle';
import { captureStatusDetails } from '../capture/captureLifecycle';
import { CaptureRow } from './CaptureRow';
import { captureTitle, displayUrl, domainOf, groupByDay, isUntitledLink } from './listFormat';
import type { CaptureSummary } from './useCaptureList';

type CaptureRiverProps = {
  captures: CaptureSummary[];
  isBusy: boolean;
  status: CaptureStatus;
  thumbnails: Record<string, string>;
};

/** A status list as an editorial "river": day groups with hairline-separated rows. */
export function CaptureRiver({ captures, isBusy, status, thumbnails }: CaptureRiverProps) {
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
              const thumbnailPath = isImage ? capture.attachments?.[0]?.storage_path : undefined;
              // Note text is a helpful preview; image notes stay private in lists.
              const excerpt =
                capture.kind === 'note' && capture.title?.trim() ? capture.content?.trim() : null;

              return (
                <CaptureRow
                  accessibleName={`Open ${title}`}
                  createdAt={capture.created_at}
                  domain={capture.kind === 'link' ? domainOf(capture.source_url) : null}
                  excerpt={excerpt}
                  href={`/captures/${capture.id}`}
                  key={capture.id}
                  kind={capture.kind}
                  section={details.path}
                  showThumbnail={isImage}
                  thumbnailUrl={thumbnailPath ? thumbnails[thumbnailPath] : undefined}
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
