import type { ReactNode } from 'react';

import { FileIcon } from './FileIcon';
import { fileCategory, fileTypeLabel, formatBytes } from './fileInfo';

type FileCardProps = {
  /** Buttons or status shown at the end of the card (download, remove, upload state…). */
  actions?: ReactNode;
  className?: string;
  mimeType: string;
  name: string;
  size: number;
  /** An upload or download state class suffix, e.g. "uploading", "done", "failed". */
  state?: string | undefined;
};

/**
 * One attached file as a card: an icon for its type, the file name, and "TYPE · size". Used in the
 * composer, the editor, the capture page and the inbox, so a file looks the same everywhere.
 */
export function FileCard({ actions, className, mimeType, name, size, state }: FileCardProps) {
  const category = fileCategory(name, mimeType);
  const classes = ['file-card', `file-card--${category}`, state && `file-card--${state}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <li className={classes}>
      <span aria-hidden="true" className="file-card__icon">
        <FileIcon category={category} />
      </span>
      <span className="file-card__body">
        <span className="file-card__name">{name}</span>
        <span className="file-card__meta">
          <span className="file-card__type">{fileTypeLabel(name, mimeType)}</span>
          <span aria-hidden="true" className="dot-sep" />
          <span>{formatBytes(size)}</span>
        </span>
      </span>
      {actions && <span className="file-card__actions">{actions}</span>}
    </li>
  );
}
