import type { KeyboardEvent, Ref } from 'react';

import { captureStatusDetails } from '../capture/captureLifecycle';
import { CaptureRow } from '../inbox/CaptureRow';
import { captureTitle, displayUrl, domainOf, isUntitledLink } from '../inbox/listFormat';
import { TagList } from '../tags/TagList';
import { HighlightedText } from './HighlightedText';
import { makeSnippet, splitHighlights } from './highlight';
import type { CaptureSearchResult } from './searchCaptures';

function hasMatch(text: string | null, terms: string[]) {
  return Boolean(text && splitHighlights(text, terms).some((part) => part.match));
}

function SearchResultRow({ result, terms }: { result: CaptureSearchResult; terms: string[] }) {
  // An untitled file capture is named by the file that matched.
  const fileTitle = result.kind === 'file' && !result.title?.trim() ? result.file_name : null;
  const title = fileTitle ?? captureTitle(result);
  const untitledLink = isUntitledLink(result);
  const details = captureStatusDetails[result.status];
  const statusLabel = details?.label ?? result.status;
  // Image notes stay private in lists, so only say that the match is there.
  const contentSnippet = result.kind === 'image' ? '' : makeSnippet(result.content, terms);
  const descriptionSnippet =
    result.kind === 'link' ? makeSnippet(result.link_description, terms) : '';
  const imageNoteMatch =
    result.kind === 'image' && !hasMatch(result.title, terms) && hasMatch(result.content, terms);
  // A titled link shows its URL under the title when the URL is what matched.
  const urlMatch =
    result.kind === 'link' && !untitledLink && result.source_url
      ? hasMatch(result.source_url, terms)
      : false;

  // Show whichever text explains the match: the note, the page description, then the URL.
  const excerpt =
    result.file_name && !fileTitle ? (
      <>
        File: <HighlightedText terms={terms} text={result.file_name} />
      </>
    ) : contentSnippet && hasMatch(result.content, terms) ? (
      <HighlightedText terms={terms} text={contentSnippet} />
    ) : descriptionSnippet && hasMatch(result.link_description, terms) ? (
      <HighlightedText terms={terms} text={descriptionSnippet} />
    ) : imageNoteMatch ? (
      'Matches the image note.'
    ) : urlMatch && result.source_url ? (
      <HighlightedText terms={terms} text={displayUrl(result.source_url)} />
    ) : contentSnippet || descriptionSnippet ? (
      <HighlightedText terms={terms} text={contentSnippet || descriptionSnippet} />
    ) : null;

  return (
    <CaptureRow
      accessibleName={`Open ${title} (${statusLabel})`}
      createdAt={result.created_at}
      domain={result.kind === 'link' ? domainOf(result.source_url) : null}
      excerpt={excerpt}
      favorite={{ isFavorite: result.is_favorite }}
      href={`/captures/${result.id}`}
      kind={result.kind}
      section={details?.path ?? '/inbox'}
      status={statusLabel}
      tags={
        <TagList
          render={(name) => <HighlightedText terms={terms} text={name} />}
          tags={result.tags}
        />
      }
      title={<HighlightedText terms={terms} text={untitledLink ? displayUrl(title) : title} />}
      titleIsUrl={untitledLink}
    />
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
      event.currentTarget.querySelectorAll<HTMLAnchorElement>('a.row__link'),
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
      className="river river--results"
      onKeyDown={handleKeyDown}
      ref={ref}
    >
      {results.map((result) => (
        <SearchResultRow key={result.id} result={result} terms={terms} />
      ))}
    </ol>
  );
}
