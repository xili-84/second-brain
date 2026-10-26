import { FileText, Image, Link2, type LucideIcon } from 'lucide-react';
import { useState } from 'react';

import type { CaptureKind } from '../captureDraft';

const kinds: readonly { icon: LucideIcon; kind: CaptureKind; label: string }[] = [
  { icon: FileText, kind: 'note', label: 'Note' },
  { icon: Link2, kind: 'link', label: 'Link' },
  { icon: Image, kind: 'image', label: 'Image' },
];

type KindSwitchProps = {
  disabled?: boolean;
  onChange: (kind: CaptureKind) => void;
  value: CaptureKind;
};

/**
 * Segmented control built from native radios, so arrow keys and screen readers work as usual.
 * Checked and focus styles come from classes rather than :has() to support older WebViews.
 */
export function KindSwitch({ disabled = false, onChange, value }: KindSwitchProps) {
  const [focused, setFocused] = useState<CaptureKind | null>(null);

  return (
    <fieldset className="segmented" disabled={disabled}>
      <legend className="visually-hidden">Capture type</legend>
      {kinds.map(({ icon: Icon, kind, label }) => {
        const classes = ['segmented__option'];
        if (kind === value) classes.push('segmented__option--checked');
        if (kind === focused) classes.push('segmented__option--focus');

        return (
          <label className={classes.join(' ')} key={kind}>
            <input
              checked={kind === value}
              className="segmented__input"
              name="kind"
              onBlur={() => setFocused(null)}
              onChange={() => onChange(kind)}
              onFocus={(event) => setFocused(isKeyboardFocus(event.target) ? kind : null)}
              type="radio"
            />
            <Icon aria-hidden="true" className="icon" />
            {label}
          </label>
        );
      })}
    </fieldset>
  );
}

/** Show the ring for keyboard focus only; older engines without :focus-visible always show it. */
function isKeyboardFocus(element: HTMLElement) {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
}
