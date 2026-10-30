import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export type PendingSharedImage = {
  /** Position in a multi-image share; chunks are read by index. Absent on older app builds. */
  index?: number;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  name: string;
  size: number;
  uri: string;
};

export type PendingShare = {
  /** A fatal problem, or (when images are present) a note about shared items that were skipped. */
  error?: string;
  id: string;
  /** The first shared image (kept for older app builds). */
  image?: PendingSharedImage;
  /** Every shared image, in the order the sharing app sent them. */
  images?: PendingSharedImage[];
  kind: 'image' | 'text';
  receivedAt: string;
  text: string;
  title: string;
};

type PendingShareResult = {
  pendingShare?: PendingShare;
};

type PendingImageChunk = {
  complete: boolean;
  data: string;
  nextOffset: number;
};

type ShareReceiverPlugin = {
  addListener(
    eventName: 'shareReceived',
    listener: (share: PendingShare) => void,
  ): Promise<PluginListenerHandle>;
  clearPendingShare(options: { id: string }): Promise<void>;
  getPendingShare(): Promise<PendingShareResult>;
  readPendingImageChunk(options: {
    id: string;
    index?: number;
    offset: number;
  }): Promise<PendingImageChunk>;
};

const ShareReceiver = registerPlugin<ShareReceiverPlugin>('ShareReceiver');

export function isNativeShareAvailable() {
  return Capacitor.isNativePlatform();
}

export async function getPendingNativeShare() {
  if (!isNativeShareAvailable()) {
    return null;
  }

  const result = await ShareReceiver.getPendingShare();
  return result.pendingShare ?? null;
}

export async function clearPendingNativeShare(id: string) {
  if (!isNativeShareAvailable()) {
    return;
  }

  await ShareReceiver.clearPendingShare({ id });
}

export async function listenForNativeShares(listener: (share: PendingShare) => void) {
  if (!isNativeShareAvailable()) {
    return null;
  }

  return ShareReceiver.addListener('shareReceived', listener);
}

/** The images of a share: the full list from current builds, or the single image from older ones. */
export function pendingSharedImages(share: PendingShare): PendingSharedImage[] {
  if (Array.isArray(share.images) && share.images.length > 0) {
    return share.images;
  }
  return share.image ? [share.image] : [];
}

export async function loadPendingSharedImage(
  shareId: string,
  image: PendingSharedImage,
  readChunk: (options: {
    id: string;
    index?: number;
    offset: number;
  }) => Promise<PendingImageChunk> = (options) => ShareReceiver.readPendingImageChunk(options),
) {
  const parts: Uint8Array[] = [];
  let offset = 0;

  while (offset < image.size) {
    const chunk = await readChunk(
      typeof image.index === 'number'
        ? { id: shareId, index: image.index, offset }
        : { id: shareId, offset },
    );
    const decoded = atob(chunk.data);
    const bytes = new Uint8Array(decoded.length);

    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index);
    }

    parts.push(bytes);

    if (chunk.nextOffset <= offset || (chunk.complete && chunk.nextOffset !== image.size)) {
      throw new Error('The temporary shared image is incomplete.');
    }

    offset = chunk.nextOffset;
  }

  if (offset !== image.size) {
    throw new Error('The temporary shared image is incomplete.');
  }

  return {
    file: new File(parts, image.name, {
      lastModified: Date.now(),
      type: image.mimeType,
    }),
  };
}
