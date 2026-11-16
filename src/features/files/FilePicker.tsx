import { Paperclip } from 'lucide-react';
import { useId, type ChangeEvent } from 'react';

type FilePickerProps = {
  className?: string;
  disabled?: boolean;
  hint: string;
  label: string;
  onPick: (files: File[]) => void;
};

/** A large tap target over a native file input that accepts any file type, several at once. */
export function FilePicker({ className, disabled = false, hint, label, onPick }: FilePickerProps) {
  const labelId = useId();
  const hintId = useId();
  const classes = ['picker', disabled && 'picker--disabled', className].filter(Boolean).join(' ');

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    // Clear the input so picking the same file again still fires a change.
    event.target.value = '';
    if (files.length) {
      onPick(files);
    }
  }

  return (
    <label className={classes}>
      <span aria-hidden="true" className="picker__icon">
        <Paperclip className="icon" />
      </span>
      <strong className="picker__label" id={labelId}>
        {label}
      </strong>
      <small className="picker__hint" id={hintId}>
        {hint}
      </small>
      <input
        aria-describedby={hintId}
        aria-labelledby={labelId}
        className="picker__input"
        disabled={disabled}
        multiple
        onChange={handleChange}
        type="file"
      />
    </label>
  );
}
