import { ImagePlus } from 'lucide-react';
import { useId, type ChangeEvent } from 'react';

type ImagePickerProps = {
  disabled?: boolean;
  hint: string;
  label: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
};

export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';

/** A large tap target over a native file input (the input stays focusable and labelled). */
export function ImagePicker({ disabled = false, hint, label, onChange }: ImagePickerProps) {
  const labelId = useId();
  const hintId = useId();

  return (
    <label className={disabled ? 'picker picker--disabled' : 'picker'}>
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
        onChange={onChange}
        type="file"
      />
    </label>
  );
}
