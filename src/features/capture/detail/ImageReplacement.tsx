import { ImagePlus } from 'lucide-react';

import { ImagePicker } from '../../../components/ImagePicker';

type ImageReplacementProps = {
  isBusy: boolean;
  isReplacing: boolean;
  isValidating: boolean;
  onBegin: () => void;
  onChoose: (file: File | null) => void;
  onUndo: () => void;
  replacement: File | null;
};

/** Edit-mode controls for swapping the image. The stored image is untouched until Save. */
export function ImageReplacement({
  isBusy,
  isReplacing,
  isValidating,
  onBegin,
  onChoose,
  onUndo,
  replacement,
}: ImageReplacementProps) {
  if (!isReplacing) {
    return (
      <div className="image-replace">
        <button className="btn btn--secondary" disabled={isBusy} onClick={onBegin} type="button">
          <ImagePlus aria-hidden="true" className="icon" />
          Replace image
        </button>
        <p className="image-replace__hint">
          The current image stays published until you save a replacement.
        </p>
      </div>
    );
  }

  return (
    <section aria-labelledby="replacement-heading" className="image-replace">
      <h2 className="visually-hidden" id="replacement-heading">
        Choose a new image
      </h2>
      <ImagePicker
        disabled={isBusy}
        hint="JPEG, PNG or WebP · up to 10 MB"
        label="Replacement image"
        onChange={(event) => onChoose(event.target.files?.[0] ?? null)}
      />
      <p className="image-replace__hint">
        The published image is unchanged until Save changes succeeds.
      </p>
      {isValidating && <p role="status">Checking image…</p>}
      {replacement && (
        <p className="image-replace__selected">
          Selected: {replacement.name} · {(replacement.size / (1024 * 1024)).toFixed(1)} MB
        </p>
      )}
      <button className="btn btn--ghost" disabled={isBusy} onClick={onUndo} type="button">
        Keep current image
      </button>
    </section>
  );
}
