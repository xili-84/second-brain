import { Monitor, Moon, Sun } from 'lucide-react';

import { SegmentedControl, type SegmentedOption } from '../components/SegmentedControl';
import { useThemePreference, type ThemePreference } from './theme';

const options: readonly SegmentedOption<ThemePreference>[] = [
  { icon: Monitor, label: 'System', value: 'system' },
  { icon: Sun, label: 'Light', value: 'light' },
  { icon: Moon, label: 'Dark', value: 'dark' },
];

/** Appearance picker for the account sheet. Applies immediately and is remembered. */
export function ThemeSwitch() {
  const { preference, setPreference } = useThemePreference();
  return (
    <>
      {/* Visual label; the fieldset legend carries the same name for assistive technology. */}
      <p aria-hidden="true" className="sheet__label">
        Appearance
      </p>
      <SegmentedControl
        legend="Appearance"
        onChange={setPreference}
        options={options}
        value={preference}
      />
    </>
  );
}
