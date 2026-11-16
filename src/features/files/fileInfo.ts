/** What the app knows about a file attachment: limits, size and type labels, and storage paths. */

/** Supabase's free plan caps every object at 50 MB, so the app enforces the same limit up front. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** How many files one file capture may hold. */
export const MAX_FILES_PER_CAPTURE = 10;

/** A short, human-readable size: "812 B", "42 KB", "3.4 MB". Binary units, one decimal when useful. */
export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '';
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  const units = ['KB', 'MB', 'GB'] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = value >= 100 || unit === 0 ? Math.round(value).toString() : value.toFixed(1);
  return `${text.replace(/\.0$/u, '')} ${units[unit]}`;
}

export type FileCategory =
  | 'apk'
  | 'archive'
  | 'audio'
  | 'code'
  | 'document'
  | 'image'
  | 'other'
  | 'pdf'
  | 'sheet'
  | 'slides'
  | 'text'
  | 'video';

const BY_EXTENSION: Record<string, FileCategory> = {
  '7z': 'archive',
  aab: 'apk',
  apk: 'apk',
  apks: 'apk',
  bz2: 'archive',
  c: 'code',
  cpp: 'code',
  cs: 'code',
  css: 'code',
  csv: 'sheet',
  doc: 'document',
  docx: 'document',
  flac: 'audio',
  gif: 'image',
  go: 'code',
  gz: 'archive',
  heic: 'image',
  html: 'code',
  java: 'code',
  jpeg: 'image',
  jpg: 'image',
  js: 'code',
  json: 'code',
  key: 'slides',
  log: 'text',
  m4a: 'audio',
  md: 'text',
  mkv: 'video',
  mov: 'video',
  mp3: 'audio',
  mp4: 'video',
  odp: 'slides',
  ods: 'sheet',
  odt: 'document',
  ogg: 'audio',
  pdf: 'pdf',
  php: 'code',
  png: 'image',
  ppt: 'slides',
  pptx: 'slides',
  py: 'code',
  rar: 'archive',
  rtf: 'document',
  sql: 'code',
  svg: 'image',
  tar: 'archive',
  tgz: 'archive',
  ts: 'code',
  tsx: 'code',
  txt: 'text',
  wav: 'audio',
  webm: 'video',
  webp: 'image',
  xls: 'sheet',
  xlsx: 'sheet',
  xml: 'code',
  xz: 'archive',
  yaml: 'code',
  yml: 'code',
  zip: 'archive',
};

const MIME_BY_EXTENSION: Record<string, string> = {
  apk: 'application/vnd.android.package-archive',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  gif: 'image/gif',
  heic: 'image/heic',
  html: 'text/html',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  json: 'application/json',
  md: 'text/markdown',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
  png: 'image/png',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  rar: 'application/vnd.rar',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  webp: 'image/webp',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xml: 'application/xml',
  zip: 'application/zip',
};

/** The lower-case extension of a file name without the dot ("" when there is none). */
export function extensionOf(name: string) {
  const leaf = name.trim().split(/[\\/]/u).pop() ?? '';
  const dot = leaf.lastIndexOf('.');
  return dot > 0 && dot < leaf.length - 1 ? leaf.slice(dot + 1).toLowerCase() : '';
}

/** Which family a file belongs to, judged by its MIME type first and its extension second. */
export function fileCategory(name: string, mimeType = ''): FileCategory {
  const mime = mimeType.toLowerCase();
  const extension = extensionOf(name);

  if (mime === 'application/vnd.android.package-archive') {
    return 'apk';
  }
  if (extension && BY_EXTENSION[extension]) {
    return BY_EXTENSION[extension];
  }
  if (mime === 'application/pdf') {
    return 'pdf';
  }
  if (mime.startsWith('image/')) {
    return 'image';
  }
  if (mime.startsWith('audio/')) {
    return 'audio';
  }
  if (mime.startsWith('video/')) {
    return 'video';
  }
  if (mime.startsWith('text/')) {
    return 'text';
  }
  if (/zip|tar|rar|7z|compressed/u.test(mime)) {
    return 'archive';
  }
  return 'other';
}

const CATEGORY_LABEL: Record<FileCategory, string> = {
  apk: 'Android app',
  archive: 'Archive',
  audio: 'Audio',
  code: 'Code',
  document: 'Document',
  image: 'Image',
  other: 'File',
  pdf: 'PDF',
  sheet: 'Spreadsheet',
  slides: 'Slides',
  text: 'Text',
  video: 'Video',
};

/** A short type label for the card: the extension in capitals ("PDF", "APK") or a family name. */
export function fileTypeLabel(name: string, mimeType = '') {
  const extension = extensionOf(name);
  if (extension && extension.length <= 5) {
    return extension.toUpperCase();
  }
  return CATEGORY_LABEL[fileCategory(name, mimeType)];
}

/** The MIME type to store and upload with: the browser's, else a guess from the extension. */
export function resolveMimeType(file: Pick<File, 'name' | 'type'>) {
  const declared = file.type.trim().toLowerCase();
  if (declared && declared.length <= 255) {
    return declared;
  }
  return MIME_BY_EXTENSION[extensionOf(file.name)] ?? 'application/octet-stream';
}

/**
 * A friendly reason this file cannot be attached, or null when it is fine. Checked before any
 * upload starts, so nothing is sent for a file that would be refused anyway.
 */
export function validateAttachmentFile(file: Pick<File, 'name' | 'size'>) {
  if (file.size <= 0) {
    return `${file.name} is empty.`;
  }
  if (file.size > MAX_FILE_BYTES) {
    return `${file.name} is ${formatBytes(file.size)}. Files can be up to ${formatBytes(MAX_FILE_BYTES)}.`;
  }
  return null;
}

/** A Storage-safe suffix from the file name: a short ASCII extension, or nothing. */
function storageSuffix(name: string) {
  const extension = extensionOf(name);
  return /^[a-z0-9]{1,10}$/u.test(extension) ? `.${extension}` : '';
}

/** Owner-scoped object path for a file attachment (the original name is kept in the database). */
export function fileStoragePath(
  userId: string,
  captureId: string,
  attachmentId: string,
  fileName: string,
) {
  return `${userId}/${captureId}/${attachmentId}${storageSuffix(fileName)}`;
}

/** A name for the database column: trimmed, at most 255 characters (keeping the end/extension). */
export function storedFileName(name: string, fallback: string) {
  const leaf = (name.trim().split(/[\\/]/u).pop() ?? '').trim();
  return leaf.slice(-255) || fallback;
}
