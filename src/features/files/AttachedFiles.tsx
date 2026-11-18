import { Check, Download, FolderOpen, LoaderCircle } from 'lucide-react';
import { useRef, useState } from 'react';

import type { SecondBrainClient } from '../../lib/supabase/client';
import {
  createImageDownloadUrl,
  createImageSignedUrl,
  DOWNLOAD_URL_TTL_SECONDS,
} from '../capture/imageStorage';
import type { StoredImageAttachment } from '../capture/imageStorage';
import { FileCard } from './FileCard';
import { fileCategory } from './fileInfo';
import { isNativeFileSaveAvailable, openSavedFile, saveFileToPhone } from './nativeFileSaver';
import { saveErrorMessage } from './saveError';

type AttachedFilesProps = {
  attachments: StoredImageAttachment[];
  client: SecondBrainClient;
  onError: (message: string | null) => void;
  onMessage: (message: string | null) => void;
};

/**
 * The files of a saved capture as cards. In a browser the download button fetches the original
 * through a short-lived signed link; in the Android app it saves into Downloads/Second Brain and
 * then offers to open the copy (an Android app package is left for the Files app to install).
 */
export function AttachedFiles({ attachments, client, onError, onMessage }: AttachedFilesProps) {
  const isNative = isNativeFileSaveAvailable();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const busy = useRef(false);

  async function download(attachment: StoredImageAttachment) {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setBusyId(attachment.id);
    onError(null);
    onMessage(null);

    try {
      if (isNative) {
        // A fresh, short-lived link just for this download.
        const url = await createImageSignedUrl(
          client,
          attachment.storage_path,
          DOWNLOAD_URL_TTL_SECONDS,
        );
        if (!url) {
          throw new Error('A download link could not be created.');
        }
        const result = await saveFileToPhone({
          expectedSize: attachment.size_bytes,
          fileName: attachment.original_name,
          mimeType: attachment.mime_type,
          url,
        });
        setSaved((current) => ({ ...current, [attachment.id]: result.uri }));
        onMessage(
          fileCategory(attachment.original_name, attachment.mime_type) === 'apk'
            ? `Saved to ${result.location}. Open it from your Files app to install.`
            : `Saved to ${result.location}.`,
        );
      } else {
        const url = await createImageDownloadUrl(
          client,
          attachment.storage_path,
          attachment.original_name,
        );
        if (!url) {
          throw new Error('A download link could not be created.');
        }
        const link = document.createElement('a');
        link.href = url;
        link.rel = 'noopener';
        link.download = attachment.original_name;
        document.body.append(link);
        link.click();
        link.remove();
      }
    } catch (error) {
      onError(saveErrorMessage(error, isNative));
    } finally {
      busy.current = false;
      setBusyId(null);
    }
  }

  async function open(attachment: StoredImageAttachment) {
    const uri = saved[attachment.id];
    if (!uri) {
      return;
    }
    onError(null);
    onMessage(null);
    try {
      await openSavedFile({ mimeType: attachment.mime_type, uri });
    } catch (error) {
      onError(
        error instanceof Error && error.message
          ? error.message
          : 'No app on this phone could open this file.',
      );
    }
  }

  return (
    <ol aria-label="Attached files" className="file-list">
      {attachments.map((attachment) => {
        const isBusy = busyId === attachment.id;
        const isSaved = Boolean(saved[attachment.id]);
        const canOpen =
          isNative &&
          isSaved &&
          fileCategory(attachment.original_name, attachment.mime_type) !== 'apk';
        const label = isBusy
          ? `Saving ${attachment.original_name}…`
          : isNative
            ? isSaved
              ? `Save ${attachment.original_name} again`
              : `Save ${attachment.original_name} to phone`
            : `Download ${attachment.original_name}`;
        const Icon = isBusy ? LoaderCircle : isSaved ? Check : Download;

        return (
          <FileCard
            actions={
              <>
                {canOpen && (
                  <button
                    aria-label={`Open ${attachment.original_name}`}
                    className="icon-btn file-card__btn"
                    onClick={() => void open(attachment)}
                    title="Open"
                    type="button"
                  >
                    <FolderOpen aria-hidden="true" className="icon" />
                  </button>
                )}
                <button
                  aria-label={label}
                  className="icon-btn file-card__btn"
                  disabled={busyId !== null}
                  onClick={() => void download(attachment)}
                  title={isNative ? 'Save to phone' : 'Download'}
                  type="button"
                >
                  <Icon aria-hidden="true" className={isBusy ? 'icon icon--spin' : 'icon'} />
                </button>
              </>
            }
            key={attachment.id}
            mimeType={attachment.mime_type}
            name={attachment.original_name}
            size={attachment.size_bytes}
          />
        );
      })}
    </ol>
  );
}
