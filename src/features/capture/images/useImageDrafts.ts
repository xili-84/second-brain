import { useCallback, useEffect, useRef, useState } from 'react';

import {
  isSupportedImageMime,
  MAX_IMAGES_PER_CAPTURE,
  validateImageFile,
  validateImageMetadata,
  type UploadState,
} from '../imageCapture';
import type { StoredImageAttachment } from '../imageStorage';

/** One image in a composer or editor tray: a newly picked file or an already stored attachment. */
export type DraftImage = {
  attachment?: StoredImageAttachment;
  file?: File;
  key: string;
  name: string;
  previewUrl: string | null;
  size: number;
  status?: UploadState | undefined;
};

function createPreviewUrl(file: File) {
  return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null;
}

function revoke(url: string | null) {
  if (url?.startsWith('blob:') && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(url);
  }
}

let keySeed = 0;
const newKey = () => `new-${Date.now().toString(36)}-${(keySeed += 1)}`;

export type AddImagesResult = { added: number; rejected: string[] };

/**
 * The ordered images of a draft. New files are validated (type, size, signature, decode) before
 * they are added, the count is capped, and local preview URLs are released when an image leaves.
 */
export function useImageDrafts(max = MAX_IMAGES_PER_CAPTURE) {
  const [images, setImages] = useState<DraftImage[]>([]);
  const [isValidating, setIsValidating] = useState(false);
  const imagesRef = useRef(images);
  imagesRef.current = images;

  // Release every local preview when the composer goes away.
  useEffect(
    () => () => {
      imagesRef.current.forEach((image) => image.file && revoke(image.previewUrl));
    },
    [],
  );

  /** Adds files after validation. `trusted` skips the decode step for files the app already checked. */
  const addFiles = useCallback(
    async (
      files: File[],
      { trusted = false }: { trusted?: boolean } = {},
    ): Promise<AddImagesResult> => {
      const rejected: string[] = [];
      const accepted: DraftImage[] = [];
      const room = Math.max(0, max - imagesRef.current.length);

      setIsValidating(true);
      for (const file of files) {
        if (accepted.length >= room) {
          rejected.push(`${file.name}: a capture holds up to ${max} images.`);
          continue;
        }
        const error = trusted ? validateImageMetadata(file) : await validateImageFile(file);
        if (error || !isSupportedImageMime(file.type)) {
          rejected.push(`${file.name}: ${error ?? 'unsupported image.'}`);
          continue;
        }
        accepted.push({
          file,
          key: newKey(),
          name: file.name,
          previewUrl: createPreviewUrl(file),
          size: file.size,
        });
      }
      setIsValidating(false);

      if (accepted.length) {
        setImages((current) => [...current, ...accepted].slice(0, max));
      }
      return { added: accepted.length, rejected };
    },
    [max],
  );

  const remove = useCallback((key: string) => {
    setImages((current) => {
      const leaving = current.find((image) => image.key === key);
      if (leaving?.file) {
        revoke(leaving.previewUrl);
      }
      return current.filter((image) => image.key !== key);
    });
  }, []);

  const move = useCallback((key: string, delta: number) => {
    setImages((current) => {
      const from = current.findIndex((image) => image.key === key);
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
    setImages((current) =>
      current.map((image) => (image.key === key ? { ...image, status } : image)),
    );
  }, []);

  const setStatuses = useCallback((statuses: Record<string, UploadState | undefined>) => {
    setImages((current) =>
      current.map((image) =>
        image.key in statuses ? { ...image, status: statuses[image.key] } : image,
      ),
    );
  }, []);

  /** Replaces the whole list, e.g. with a capture's stored images when editing starts. */
  const reset = useCallback((next: DraftImage[] = []) => {
    imagesRef.current.forEach((image) => image.file && revoke(image.previewUrl));
    setImages(next);
  }, []);

  return { addFiles, images, isValidating, move, remove, reset, setStatus, setStatuses };
}

/** Tray entries for a capture's stored images, previewed through their signed URLs. */
export function storedDrafts(
  attachments: StoredImageAttachment[],
  urls: Record<string, string | null | undefined>,
): DraftImage[] {
  return attachments.map((attachment) => ({
    attachment,
    key: `stored-${attachment.id}`,
    name: attachment.original_name,
    previewUrl: urls[attachment.id] ?? null,
    size: attachment.size_bytes,
  }));
}
