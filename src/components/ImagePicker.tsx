import { ImagePlus } from 'lucide-react';
import { useId, type ChangeEvent } from 'react';

type ImagePickerProps = {
  className?: string;
  disabled?: boolean;
  hint: string;
  label: string;
  /** Allow picking several files at once. */
  multiple?: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
};

export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';

/** A large tap target over a native file input (the input stays focusable and labelled). */
export function ImagePicker({
  className,
  disabled = false,
  hint,
  label,
  multiple = false,
  onChange,
}: ImagePickerProps) {
  const labelId = useId();
  const hintId = useId();
  const classes = ['picker', disabled && 'picker--disabled', className].filter(Boolean).join(' ');

  return (
    <label className={classes}>
      <span aria-hidden="true" className="picker__icon">
        <ImagePlus className="icon" />
      </span>
      <strong className="picker__label" id={labelId}>
        {label}
      </strong>
      <small className="picker__hint" id={hintId}>
        {hint}
      </small>
      <input
        accept={IMAGE_ACCEPT}
        aria-describedby={hintId}
        aria-labelledby={labelId}
        className="picker__input"
        disabled={disabled}
        multiple={multiple}
        onChange={onChange}
        type="file"
      />
    </label>
  );
}
