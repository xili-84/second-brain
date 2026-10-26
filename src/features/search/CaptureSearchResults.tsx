import type { KeyboardEvent, Ref } from 'react';
import { Link } from 'react-router-dom';

import { captureStatusDetails } from '../capture/captureLifecycle';
import { HighlightedText } from './HighlightedText';
import { makeSnippet, splitHighlights } from './highlight';
import type { CaptureSearchResult } from './searchCaptures';

function hasMatch(text: string | null, terms: string[]) {
  return Boolean(text && splitHighlights(text, terms).some((part) => part.match));
}

function SearchResultCard({ result, terms }: { result: CaptureSearchResult; terms: string[] }) {
  const cardTitle =
    result.title?.trim() ||
    (result.kind === 'link' && result.source_url ? result.source_url : `Untitled ${result.kind}`);
  const showUrl = result.kind === 'link' && result.source_url && cardTitle !== result.source_url;
  // Image notes stay private in lists, so only say that the match is there.
  const snippet = result.kind === 'image' ? '' : makeSnippet(result.content, terms);
  const imageNoteMatch =
    result.kind === 'image' && !hasMatch(result.title, terms) && hasMatch(result.content, terms);
  const statusLabel = captureStatusDetails[result.status]?.label ?? result.status;

  return (
    <li className="capture-card">
      <Link
        aria-label={`Open ${cardTitle} (${statusLabel})`}
        className="capture-card-link"
        to={`/captures/${result.id}`}
      >
        <div className="capture-meta">
          <span>
            {result.kind} · <span className="status-pill">{statusLabel}</span>
          </span>
          <time dateTime={result.created_at}>
            {new Intl.DateTimeFormat(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(new Date(result.created_at))}
          </time>
        </div>
        <h2>
          <HighlightedText terms={terms} text={cardTitle} />
        </h2>
        {showUrl && (
          <p>
            <HighlightedText terms={terms} text={result.source_url ?? ''} />
          </p>
        )}
        {snippet && (
          <p className="search-snippet">
            <HighlightedText terms={terms} text={snippet} />
          </p>
        )}
        {imageNoteMatch && <p className="search-snippet">Matches the image note.</p>}
      </Link>
    </li>
  );
}

type CaptureSearchResultsProps = {
  isBusy: boolean;
  onExitToInput: () => void;
  ref?: Ref<HTMLOListElement>;
  results: CaptureSearchResult[];
  terms: string[];
};

/** Result list; ArrowUp/ArrowDown move between results, Escape goes back to the search box. */
export function CaptureSearchResults({
  isBusy,
  onExitToInput,
  ref,
  results,
  terms,
}: CaptureSearchResultsProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLOListElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Escape'].includes(event.key)) {
      return;
    }
    const links = Array.from(
      event.currentTarget.querySelectorAll<HTMLAnchorElement>('a.capture-card-link'),
    );
    const index = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (index === -1) {
      return;
    }

    event.preventDefault();
    if (event.key === 'Escape' || (event.key === 'ArrowUp' && index === 0)) {
      onExitToInput();
    } else if (event.key === 'ArrowUp') {
      links[index - 1]?.focus();
    } else {
      links[Math.min(index + 1, links.length - 1)]?.focus();
    }
  }

  return (
    <ol
      aria-busy={isBusy}
      aria-label="Search results"
      className="capture-list"
      onKeyDown={handleKeyDown}
      ref={ref}
    >
      {results.map((result) => (
        <SearchResultCard key={result.id} result={result} terms={terms} />
      ))}
    </ol>
  );
}
