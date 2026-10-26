import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export type PendingSharedImage = {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  name: string;
  size: number;
  uri: string;
};

export type PendingShare = {
  error?: string;
  id: string;
  image?: PendingSharedImage;
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
  readPendingImageChunk(options: { id: string; offset: number }): Promise<PendingImageChunk>;
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

export async function loadPendingSharedImage(
  shareId: string,
  image: PendingSharedImage,
  readChunk: (options: { id: string; offset: number }) => Promise<PendingImageChunk> = (options) =>
    ShareReceiver.readPendingImageChunk(options),
) {
  const parts: Uint8Array[] = [];
  let offset = 0;

  while (offset < image.size) {
    const chunk = await readChunk({ id: shareId, offset });
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
