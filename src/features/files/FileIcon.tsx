import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Presentation,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';

import type { FileCategory } from './fileInfo';

const ICONS: Record<FileCategory, LucideIcon> = {
  apk: Smartphone,
  archive: FileArchive,
  audio: FileAudio,
  code: FileCode,
  document: FileText,
  image: FileImage,
  other: File,
  pdf: FileText,
  sheet: FileSpreadsheet,
  slides: Presentation,
  text: FileText,
  video: FileVideo,
};

/** The glyph for a file family. Decorative: the type is also written out next to it. */
export function FileIcon({ category }: { category: FileCategory }) {
  const Icon = ICONS[category];
  return <Icon aria-hidden="true" className="icon" />;
}
