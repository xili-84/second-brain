import { Plus, RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { sections } from '../../app/navigation';
import { EmptyState } from '../../components/EmptyState';
import { Notice } from '../../components/Notice';
import { PageHeader } from '../../components/PageHeader';
import { SkeletonRows } from '../../components/Skeleton';
import { useAuth } from '../auth/authContext';
import { captureStatusDetails, type CaptureStatus } from '../capture/captureLifecycle';
import { CaptureSearchResults } from '../search/CaptureSearchResults';
import { parseSearchTerms, SEARCH_RESULT_LIMIT } from '../search/searchCaptures';
import { SearchField } from '../search/SearchField';
import { useCaptureSearch } from '../search/useCaptureSearch';
import { CaptureRiver } from './CaptureRiver';
import { useCaptureList } from './useCaptureList';
import { useThumbnails } from './useThumbnails';

export const SEARCH_DEBOUNCE_MS = 250;

function isTypingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))
  );
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** Keeps the search box text and the committed ?q= query in sync, with a debounce. */
function useSearchQuery() {
  // The committed search lives in ?q= so it survives reloads and can be shared or bookmarked.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = (searchParams.get('q') ?? '').trim();
  const [draft, setDraft] = useState(urlQuery);
  const lastCommitted = useRef(urlQuery);

  const commit = useCallback(
    (value: string) => {
      const next = value.trim();
      lastCommitted.current = next;
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          if (next) {
            params.set('q', next);
          } else {
            params.delete('q');
          }
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Debounce typing before it reaches the URL (and therefore the database).
  useEffect(() => {
    if (draft.trim() === urlQuery) {
      return;
    }
    const timer = window.setTimeout(() => commit(draft), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [commit, draft, urlQuery]);

  // Follow ?q= changes that did not come from typing here, such as Back/Forward.
  useEffect(() => {
    if (urlQuery !== lastCommitted.current) {
      lastCommitted.current = urlQuery;
      setDraft(urlQuery);
    }
  }, [urlQuery]);

  const clear = useCallback(() => {
    setDraft('');
    commit('');
  }, [commit]);

  return { clear, commit, draft, setDraft, urlQuery };
}

export function CaptureListPage({ status }: { status: CaptureStatus }) {
  const { client, session } = useAuth();
  const userId = session?.user.id;
  const details = captureStatusDetails[status];
  const list = useCaptureList(client, status, userId);

  const { clear, commit, draft, setDraft, urlQuery } = useSearchQuery();
  const searchInput = useRef<HTMLInputElement>(null);
  const resultsList = useRef<HTMLOListElement>(null);
  const { retry: retrySearch, state: search } = useCaptureSearch(client, urlQuery, Boolean(userId));
  const isSearching = urlQuery !== '';
  const terms = parseSearchTerms(urlQuery);
  const thumbnails = useThumbnails(client, list.captures, !isSearching);

  // "/" jumps to the search box from anywhere on the page.
  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (
        event.key === '/' &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !isTypingTarget(event.target)
      ) {
        event.preventDefault();
        searchInput.current?.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (draft) {
        clear();
      } else {
        event.currentTarget.blur();
      }
    } else if (event.key === 'ArrowDown') {
      const firstResult = resultsList.current?.querySelector<HTMLAnchorElement>('a');
      if (firstResult) {
        event.preventDefault();
        firstResult.focus();
      }
    }
  }

  function clearAndRefocus() {
    clear();
    searchInput.current?.focus();
  }

  const subtitle = isSearching
    ? search.status === 'ready'
      ? `${search.results.length === SEARCH_RESULT_LIMIT ? 'First ' : ''}${plural(search.results.length, 'result')} across all captures`
      : search.status === 'error'
        ? 'Search failed'
        : 'Searching…'
    : list.isLoading
      ? 'Loading…'
      : plural(list.captures.length, 'item');

  return (
    <section aria-labelledby="capture-list-heading" className="page">
      <PageHeader
        actions={
          isSearching ? (
            <button className="btn btn--ghost" onClick={clearAndRefocus} type="button">
              Clear search
            </button>
          ) : (
            <button
              className="icon-btn"
              disabled={list.isLoading}
              onClick={() => void list.reload()}
              title="Refresh"
              type="button"
            >
              <RefreshCw aria-hidden="true" className="icon" />
              <span className="visually-hidden">Refresh</span>
            </button>
          )
        }
        id="capture-list-heading"
        subtitle={subtitle}
        title={details.label}
      />

      <SearchField
        inputRef={searchInput}
        onChange={setDraft}
        onClear={clearAndRefocus}
        onKeyDown={handleSearchKeyDown}
        onSubmit={() => commit(draft)}
        value={draft}
      />

      {isSearching ? (
        <>
          {search.status === 'error' && (
            <Notice tone="error">
              <span>Search failed. Check your connection and try again.</span>
              <button className="btn btn--ghost" onClick={() => void retrySearch()} type="button">
                Try again
              </button>
            </Notice>
          )}

          {search.status === 'ready' && search.results.length === 0 && (
            <EmptyState icon={Search} title={`No captures match “${urlQuery}”.`}>
              Search looks at titles, notes and links in Inbox, Reviewed and Archived.
            </EmptyState>
          )}

          <CaptureSearchResults
            isBusy={search.status === 'loading'}
            onExitToInput={() => searchInput.current?.focus()}
            ref={resultsList}
            results={search.status === 'ready' ? search.results : []}
            terms={terms}
          />
          {search.status === 'loading' && <SkeletonRows count={3} />}
        </>
      ) : (
        <>
          {list.error && (
            <Notice tone="error">
              <span>
                Your {details.label.toLowerCase()} could not be loaded. Check your connection and
                try again.
              </span>
              <button className="btn btn--ghost" onClick={() => void list.reload()} type="button">
                Try again
              </button>
            </Notice>
          )}

          {list.isLoading && list.captures.length === 0 && <SkeletonRows />}

          {!list.isLoading && list.captures.length === 0 && !list.error && (
            <EmptyState
              action={
                status === 'inbox' ? (
                  <Link className="btn btn--primary" to="/capture">
                    <Plus aria-hidden="true" className="icon" />
                    New capture
                  </Link>
                ) : undefined
              }
              icon={sections.find((section) => section.status === status)?.icon}
              title={details.emptyMessage}
            >
              {status === 'inbox'
                ? 'Share a link or photo to Second Brain, or capture a thought now.'
                : 'Captures you move here will show up in this list.'}
            </EmptyState>
          )}

          <CaptureRiver
            captures={list.captures}
            isBusy={list.isLoading}
            status={status}
            thumbnails={thumbnails}
          />
        </>
      )}
    </section>
  );
}

export function InboxPage() {
  return <CaptureListPage status="inbox" />;
}
