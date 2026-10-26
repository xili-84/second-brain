import { FileText, Image, Link2 } from 'lucide-react';

import { SegmentedControl, type SegmentedOption } from '../../../components/SegmentedControl';
import type { CaptureKind } from '../captureDraft';

const kinds: readonly SegmentedOption<CaptureKind>[] = [
  { icon: FileText, label: 'Note', value: 'note' },
  { icon: Link2, label: 'Link', value: 'link' },
  { icon: Image, label: 'Image', value: 'image' },
];

type KindSwitchProps = {
  disabled?: boolean;
  onChange: (kind: CaptureKind) => void;
  value: CaptureKind;
};

export function KindSwitch({ disabled = false, onChange, value }: KindSwitchProps) {
  return (
    <SegmentedControl
      disabled={disabled}
      legend="Capture type"
      onChange={onChange}
      options={kinds}
      value={value}
    />
  );
}
