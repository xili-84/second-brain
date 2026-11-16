import { useCallback, useRef, useState } from 'react';

import type { UploadState } from '../capture/imageCapture';
import type { StoredImageAttachment } from '../capture/imageStorage';
import { MAX_FILES_PER_CAPTURE, resolveMimeType, validateAttachmentFile } from './fileInfo';

/** One file in a composer or editor tray: a newly picked file or an already stored attachment. */
export type DraftFile = {
  attachment?: StoredImageAttachment;
  file?: File;
  key: string;
  mimeType: string;
  name: string;
  size: number;
  status?: UploadState | undefined;
};

let keySeed = 0;
const newKey = () => `file-${Date.now().toString(36)}-${(keySeed += 1)}`;

export type AddFilesResult = { added: number; rejected: string[] };

/**
 * The ordered files of a draft. Picked files are checked (not empty, at most 50 MB) and the count
 * is capped before they are added; anything refused comes back as a friendly message. A file with
 * no MIME type is given one from its extension so the upload and the database always agree.
 */
export function useFileDrafts(max = MAX_FILES_PER_CAPTURE) {
  const [files, setFiles] = useState<DraftFile[]>([]);
  const filesRef = useRef(files);
  filesRef.current = files;

  const addFiles = useCallback(
    (picked: File[]): AddFilesResult => {
      const rejected: string[] = [];
      const accepted: DraftFile[] = [];
      const room = Math.max(0, max - filesRef.current.length);

      for (const original of picked) {
        if (accepted.length >= room) {
          rejected.push(`${original.name}: a capture holds up to ${max} files.`);
          continue;
        }
        const problem = validateAttachmentFile(original);
        if (problem) {
          rejected.push(problem);
          continue;
        }
        const mimeType = resolveMimeType(original);
        // Wrapping keeps the same bytes (no copy) but fixes an empty or odd type.
        const file =
          original.type === mimeType
            ? original
            : new File([original], original.name, {
                lastModified: original.lastModified,
                type: mimeType,
              });
        accepted.push({ file, key: newKey(), mimeType, name: original.name, size: original.size });
      }

      if (accepted.length) {
        const next = [...filesRef.current, ...accepted].slice(0, max);
        filesRef.current = next;
        setFiles(next);
      }
      return { added: accepted.length, rejected };
    },
    [max],
  );

  const remove = useCallback((key: string) => {
    setFiles((current) => current.filter((file) => file.key !== key));
  }, []);

  const move = useCallback((key: string, delta: number) => {
    setFiles((current) => {
      const from = current.findIndex((file) => file.key === key);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= current.length) {
        return current;
      }
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
  }, []);

  const setStatus = useCallback((key: string, status: UploadState | undefined) => {
    setFiles((current) => current.map((file) => (file.key === key ? { ...file, status } : file)));
  }, []);

  const setStatuses = useCallback((statuses: Record<string, UploadState | undefined>) => {
    setFiles((current) =>
      current.map((file) =>
        file.key in statuses ? { ...file, status: statuses[file.key] } : file,
      ),
    );
  }, []);

  /** Replaces the whole list, e.g. with a capture's stored files when editing starts. */
  const reset = useCallback((next: DraftFile[] = []) => {
    filesRef.current = next;
    setFiles(next);
  }, []);

  return { addFiles, files, move, remove, reset, setStatus, setStatuses };
}

/** Tray entries for a capture's stored files. */
export function storedFileDrafts(attachments: StoredImageAttachment[]): DraftFile[] {
  return attachments.map((attachment) => ({
    attachment,
    key: `stored-${attachment.id}`,
    mimeType: attachment.mime_type,
    name: attachment.original_name,
    size: attachment.size_bytes,
  }));
}
