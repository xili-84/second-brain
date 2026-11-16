import { describe, expect, it } from 'vitest';

import {
  extensionOf,
  fileCategory,
  fileStoragePath,
  fileTypeLabel,
  formatBytes,
  MAX_FILE_BYTES,
  resolveMimeType,
  storedFileName,
  validateAttachmentFile,
} from './fileInfo';

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [812, '812 B'],
    [1024, '1 KB'],
    [43_008, '42 KB'],
    [1_572_864, '1.5 MB'],
    [3_565_158, '3.4 MB'],
    [52_428_800, '50 MB'],
    [1_073_741_824, '1 GB'],
  ])('%i bytes reads %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });

  it('gives nothing for a size that makes no sense', () => {
    expect(formatBytes(-1)).toBe('');
    expect(formatBytes(Number.NaN)).toBe('');
  });
});

describe('file types', () => {
  it('reads the extension in lower case, ignoring folders and dotfiles', () => {
    expect(extensionOf('Report.FINAL.PDF')).toBe('pdf');
    expect(extensionOf('C:\\temp\\notes.txt')).toBe('txt');
    expect(extensionOf('.bashrc')).toBe('');
    expect(extensionOf('README')).toBe('');
    expect(extensionOf('trailing.')).toBe('');
  });

  it('files an APK by its type or its name', () => {
    expect(fileCategory('app.apk', '')).toBe('apk');
    expect(fileCategory('download', 'application/vnd.android.package-archive')).toBe('apk');
  });

  it.each([
    ['notes.txt', 'text/plain', 'text'],
    ['paper.pdf', 'application/pdf', 'pdf'],
    ['backup.zip', 'application/zip', 'archive'],
    ['budget.xlsx', '', 'sheet'],
    ['deck.pptx', '', 'slides'],
    ['song.mp3', 'audio/mpeg', 'audio'],
    ['clip.mp4', 'video/mp4', 'video'],
    ['photo.heic', '', 'image'],
    ['main.py', 'text/x-python', 'code'],
    ['mystery', 'application/octet-stream', 'other'],
    ['x.bin', 'application/x-tar', 'archive'],
  ])('%s (%s) is %s', (name, mime, category) => {
    expect(fileCategory(name, mime)).toBe(category);
  });

  it('labels a card with the extension, or the family when there is none', () => {
    expect(fileTypeLabel('app-release.apk')).toBe('APK');
    expect(fileTypeLabel('paper.pdf')).toBe('PDF');
    expect(fileTypeLabel('README', 'text/plain')).toBe('Text');
    expect(fileTypeLabel('archive.verylongext', 'application/zip')).toBe('Archive');
  });

  it('keeps a declared MIME type and guesses one only when it is missing', () => {
    expect(resolveMimeType({ name: 'a.bin', type: 'Application/X-Thing' })).toBe(
      'application/x-thing',
    );
    expect(resolveMimeType({ name: 'app.apk', type: '' })).toBe(
      'application/vnd.android.package-archive',
    );
    expect(resolveMimeType({ name: 'mystery', type: '' })).toBe('application/octet-stream');
  });
});

describe('validateAttachmentFile', () => {
  it('accepts anything up to 50 MB', () => {
    expect(validateAttachmentFile({ name: 'a.txt', size: 1 })).toBeNull();
    expect(validateAttachmentFile({ name: 'big.apk', size: MAX_FILE_BYTES })).toBeNull();
  });

  it('explains an empty file', () => {
    expect(validateAttachmentFile({ name: 'a.txt', size: 0 })).toBe('a.txt is empty.');
  });

  it('explains a file over the limit in plain words', () => {
    expect(validateAttachmentFile({ name: 'movie.mkv', size: MAX_FILE_BYTES + 1 })).not.toBeNull();
    expect(validateAttachmentFile({ name: 'movie.mkv', size: 120 * 1024 * 1024 })).toBe(
      'movie.mkv is 120 MB. Files can be up to 50 MB.',
    );
  });
});

describe('storage names', () => {
  const ids = ['user', 'capture', 'attachment'] as const;

  it('keeps a short ASCII extension and nothing else from the name', () => {
    expect(fileStoragePath(...ids, 'Quarterly report (final).PDF')).toBe(
      'user/capture/attachment.pdf',
    );
    expect(fileStoragePath(...ids, 'тест.док')).toBe('user/capture/attachment');
    expect(fileStoragePath(...ids, 'noextension')).toBe('user/capture/attachment');
    expect(fileStoragePath(...ids, 'evil.p/../hp')).toBe('user/capture/attachment');
  });

  it('stores the leaf name, at most 255 characters, from the end', () => {
    expect(storedFileName('  folder/sub/report.pdf ', 'file-1')).toBe('report.pdf');
    expect(storedFileName('   ', 'file-1')).toBe('file-1');
    const long = `${'a'.repeat(300)}.pdf`;
    const stored = storedFileName(long, 'x');
    expect(stored).toHaveLength(255);
    expect(stored.endsWith('.pdf')).toBe(true);
  });
});
