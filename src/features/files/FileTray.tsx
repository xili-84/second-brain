import { AlertCircle, ArrowDown, ArrowUp, Check, LoaderCircle, X } from 'lucide-react';

import { FileCard } from './FileCard';
import { FilePicker } from './FilePicker';
import { formatBytes, MAX_FILE_BYTES, MAX_FILES_PER_CAPTURE } from './fileInfo';
import type { DraftFile } from './useFileDrafts';

type FileTrayProps = {
  disabled?: boolean;
  files: DraftFile[];
  max?: number;
  /** The fewest files allowed (1 when editing a saved file capture). */
  min?: number;
  onAdd: (files: File[]) => void;
  onMove: (key: string, delta: number) => void;
  onRemove: (key: string) => void;
};

const HINT = `Any type · up to ${formatBytes(MAX_FILE_BYTES)} each`;

/**
 * The files of a draft as a list of cards, each with its upload state and remove / move controls,
 * and a picker to add more until the cap.
 */
export function FileTray({
  disabled = false,
  files,
  max = MAX_FILES_PER_CAPTURE,
  min = 0,
  onAdd,
  onMove,
  onRemove,
}: FileTrayProps) {
  if (files.length === 0) {
    return (
      <div className="tray tray--empty">
        <FilePicker
          disabled={disabled}
          hint={`Up to ${max} · ${HINT}`}
          label="Choose files"
          onPick={onAdd}
        />
      </div>
    );
  }

  return (
    <section aria-label="Files" className="tray">
      <header className="tray__head">
        <span className="kicker">Files</span>
        <span aria-live="polite" className="tray__count">
          {files.length} of {max}
        </span>
      </header>
      <ol className="file-list">
        {files.map((file, index) => {
          const status = file.status;
          return (
            <FileCard
              actions={
                <>
                  {status && (
                    <span className="file-card__status">
                      {status === 'uploading' && (
                        <LoaderCircle aria-hidden="true" className="icon icon--spin" />
                      )}
                      {status === 'done' && <Check aria-hidden="true" className="icon" />}
                      {status === 'failed' && <AlertCircle aria-hidden="true" className="icon" />}
                      <span className="visually-hidden">
                        {status === 'uploading'
                          ? `Uploading ${file.name}`
                          : status === 'done'
                            ? `${file.name} uploaded`
                            : `${file.name} failed to upload`}
                      </span>
                    </span>
                  )}
                  {files.length > 1 && (
                    <>
                      <button
                        aria-label={`Move ${file.name} up`}
                        className="icon-btn file-card__btn"
                        disabled={disabled || index === 0}
                        onClick={() => onMove(file.key, -1)}
                        title="Move up"
                        type="button"
                      >
                        <ArrowUp aria-hidden="true" className="icon" />
                      </button>
                      <button
                        aria-label={`Move ${file.name} down`}
                        className="icon-btn file-card__btn"
                        disabled={disabled || index === files.length - 1}
                        onClick={() => onMove(file.key, 1)}
                        title="Move down"
                        type="button"
                      >
                        <ArrowDown aria-hidden="true" className="icon" />
                      </button>
                    </>
                  )}
                  {!disabled && files.length > min && (
                    <button
                      aria-label={`Remove ${file.name}`}
                      className="icon-btn file-card__btn"
                      onClick={() => onRemove(file.key)}
                      title="Remove"
                      type="button"
                    >
                      <X aria-hidden="true" className="icon" />
                    </button>
                  )}
                </>
              }
              key={file.key}
              mimeType={file.mimeType}
              name={file.name}
              size={file.size}
              state={status}
            />
          );
        })}
      </ol>
      {files.length < max && (
        <FilePicker
          className="picker--row"
          disabled={disabled}
          hint={`${max - files.length} more`}
          label="Add files"
          onPick={onAdd}
        />
      )}
    </section>
  );
}
