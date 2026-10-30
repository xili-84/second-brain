import { AlertCircle, ArrowLeft, ArrowRight, Check, LoaderCircle, X } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';

import { ImagePicker } from '../../../components/ImagePicker';
import { MAX_IMAGES_PER_CAPTURE } from '../imageCapture';
import { aspectHint, aspectLabel, megabytes } from './aspect';
import type { DraftImage } from './useImageDrafts';

type ImageTrayProps = {
  disabled?: boolean;
  images: DraftImage[];
  isValidating?: boolean;
  max?: number;
  /** The fewest images allowed (1 when editing a saved image capture). */
  min?: number;
  onAdd: (files: File[]) => void;
  onMove: (key: string, delta: number) => void;
  onRemove: (key: string) => void;
};

const HINT = 'JPEG, PNG or WebP · up to 10 MB each';

function filesFrom(event: ChangeEvent<HTMLInputElement>) {
  const files = Array.from(event.target.files ?? []);
  // Clear the input so picking the same file again still fires a change.
  event.target.value = '';
  return files;
}

/**
 * The images of a draft as a contact sheet: each one shown whole (no cropping, so a 9:16 story
 * reads as a story), numbered in posting order, with remove and move controls, upload state, and
 * a tile to add more until the cap.
 */
export function ImageTray({
  disabled = false,
  images,
  isValidating = false,
  max = MAX_IMAGES_PER_CAPTURE,
  min = 0,
  onAdd,
  onMove,
  onRemove,
}: ImageTrayProps) {
  if (images.length === 0) {
    return (
      <div className="tray tray--empty">
        <ImagePicker
          disabled={disabled || isValidating}
          hint={`Up to ${max} · ${HINT}`}
          label={isValidating ? 'Checking images…' : 'Choose images'}
          multiple
          onChange={(event) => onAdd(filesFrom(event))}
        />
      </div>
    );
  }

  const canAdd = images.length < max;

  return (
    <section aria-label="Images" className="tray">
      <header className="tray__head">
        <span className="kicker">Images</span>
        <span className="tray__count" aria-live="polite">
          {images.length} of {max}
        </span>
      </header>
      <ol className="tray__grid">
        {images.map((image, index) => (
          <TrayTile
            canRemove={!disabled && images.length > min}
            disabled={disabled}
            image={image}
            index={index}
            isFirst={index === 0}
            isLast={index === images.length - 1}
            key={image.key}
            onMove={(delta) => onMove(image.key, delta)}
            onRemove={() => onRemove(image.key)}
            total={images.length}
          />
        ))}
        {canAdd && (
          <li className="tray__tile tray__tile--add">
            <ImagePicker
              className="picker--tile"
              disabled={disabled || isValidating}
              hint={`${max - images.length} more`}
              label={isValidating ? 'Checking…' : 'Add images'}
              multiple
              onChange={(event) => onAdd(filesFrom(event))}
            />
          </li>
        )}
      </ol>
    </section>
  );
}

function TrayTile({
  canRemove,
  disabled,
  image,
  index,
  isFirst,
  isLast,
  onMove,
  onRemove,
  total,
}: {
  canRemove: boolean;
  disabled: boolean;
  image: DraftImage;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onMove: (delta: number) => void;
  onRemove: () => void;
  total: number;
}) {
  const [size, setSize] = useState<{ height: number; width: number } | null>(null);
  const position = `image ${index + 1} of ${total}`;
  const ratio = aspectLabel(size?.width, size?.height);
  const hint = aspectHint(size?.width, size?.height);
  const status = image.status;

  return (
    <li
      className={`tray__tile${status ? ` tray__tile--${status}` : ''}`}
      aria-label={`${image.name}, ${position}`}
    >
      <div className="tray__frame">
        {image.previewUrl ? (
          <img
            alt={`Preview of ${image.name}`}
            onLoad={(event) =>
              setSize({
                height: event.currentTarget.naturalHeight,
                width: event.currentTarget.naturalWidth,
              })
            }
            src={image.previewUrl}
          />
        ) : (
          <span className="tray__placeholder">Preview unavailable</span>
        )}
        <span className="tray__index" aria-hidden="true">
          {index + 1}
        </span>
        {status && (
          <span className="tray__status">
            {status === 'uploading' && (
              <LoaderCircle aria-hidden="true" className="icon icon--spin" />
            )}
            {status === 'done' && <Check aria-hidden="true" className="icon" />}
            {status === 'failed' && <AlertCircle aria-hidden="true" className="icon" />}
            <span className="visually-hidden">
              {status === 'uploading'
                ? `Uploading ${image.name}`
                : status === 'done'
                  ? `${image.name} uploaded`
                  : `${image.name} failed to upload`}
            </span>
          </span>
        )}
        {canRemove && (
          <button
            aria-label={`Remove ${position}`}
            className="tray__remove"
            onClick={onRemove}
            title="Remove"
            type="button"
          >
            <X aria-hidden="true" className="icon" />
          </button>
        )}
      </div>
      <div className="tray__meta">
        <span className="tray__ratio">
          {[ratio, hint].filter(Boolean).join(' · ') || megabytes(image.size)}
        </span>
        {total > 1 && (
          <span className="tray__moves">
            <button
              aria-label={`Move ${position} earlier`}
              className="tray__move"
              disabled={disabled || isFirst}
              onClick={() => onMove(-1)}
              title="Move earlier"
              type="button"
            >
              <ArrowLeft aria-hidden="true" className="icon" />
            </button>
            <button
              aria-label={`Move ${position} later`}
              className="tray__move"
              disabled={disabled || isLast}
              onClick={() => onMove(1)}
              title="Move later"
              type="button"
            >
              <ArrowRight aria-hidden="true" className="icon" />
            </button>
          </span>
        )}
      </div>
    </li>
  );
}
