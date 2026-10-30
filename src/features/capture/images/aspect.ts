const KNOWN_RATIOS: { label: string; value: number }[] = [
  { label: '9:16', value: 9 / 16 },
  { label: '2:3', value: 2 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '4:5', value: 4 / 5 },
  { label: '1:1', value: 1 },
  { label: '5:4', value: 5 / 4 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:2', value: 3 / 2 },
  { label: '1.91:1', value: 1.91 },
  { label: '16:9', value: 16 / 9 },
];

/**
 * A short, human label for an image's shape ("9:16", "1:1", "4:5"), within 2 % of a common
 * social format, or null for other or unknown sizes.
 */
export function aspectLabel(width: number | undefined, height: number | undefined) {
  if (!width || !height || width <= 0 || height <= 0) {
    return null;
  }
  const ratio = width / height;
  const match = KNOWN_RATIOS.find((known) => Math.abs(ratio - known.value) / known.value <= 0.02);
  return match?.label ?? null;
}

/** "Story" for tall 9:16 images, the way they are usually posted. */
export function aspectHint(width: number | undefined, height: number | undefined) {
  return aspectLabel(width, height) === '9:16' ? 'Story' : null;
}

export function megabytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Alt text for one image of a capture: the title, plus its position when there are several. */
export function imageAlt(alt: string, index: number, total: number) {
  return total > 1 ? `${alt}, image ${index + 1} of ${total}` : alt;
}
