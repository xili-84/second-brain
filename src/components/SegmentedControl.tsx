import type { LucideIcon } from 'lucide-react';
import { useId, useState } from 'react';

export type SegmentedOption<T extends string> = { icon?: LucideIcon; label: string; value: T };

type SegmentedControlProps<T extends string> = {
  disabled?: boolean;
  /** Group name for screen readers (visually hidden). */
  legend: string;
  onChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  value: T;
};

/** Show the ring for keyboard focus only; older engines without :focus-visible always show it. */
function isKeyboardFocus(element: HTMLElement) {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
}

/**
 * Segmented control built from native radios, so arrow keys and screen readers work as usual.
 * Checked and focus styles come from classes rather than :has() to support older WebViews.
 */
export function SegmentedControl<T extends string>({
  disabled = false,
  legend,
  onChange,
  options,
  value,
}: SegmentedControlProps<T>) {
  const [focused, setFocused] = useState<T | null>(null);
  const name = useId();

  return (
    <fieldset className="segmented" disabled={disabled}>
      <legend className="visually-hidden">{legend}</legend>
      {options.map(({ icon: Icon, label, value: optionValue }) => {
        const classes = ['segmented__option'];
        if (optionValue === value) classes.push('segmented__option--checked');
        if (optionValue === focused) classes.push('segmented__option--focus');

        return (
          <label className={classes.join(' ')} key={optionValue}>
            <input
              checked={optionValue === value}
              className="segmented__input"
              name={name}
              onBlur={() => setFocused(null)}
              onChange={() => onChange(optionValue)}
              onFocus={(event) => setFocused(isKeyboardFocus(event.target) ? optionValue : null)}
              type="radio"
            />
            {Icon && <Icon aria-hidden="true" className="icon" />}
            {label}
          </label>
        );
      })}
    </fieldset>
  );
}
