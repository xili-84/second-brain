import { Filter, ListChecks, Plus, RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
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
import { BulkDeleteSheet } from '../selection/BulkDeleteSheet';
import { SelectionBar } from '../selection/SelectionBar';
import { useBulkSelection } from '../selection/useBulkSelection';
import { useCaptureSearch } from '../search/useCaptureSearch';
import { FilterBar, type ListFilter } from '../tags/FilterBar';
import { setFavorite } from '../tags/tagsApi';
import { tagKey, tagsFromEmbed } from '../tags/tagNames';
import { CaptureRiver } from './CaptureRiver';
import { useCaptureList, type CaptureSummary } from './useCaptureList';
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

/** ?fav=1 and ?tag=name keep the list filter in the address, like the search query. */
function useListFilter() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filter: ListFilter = {
    favorites: searchParams.get('fav') === '1',
    tag: searchParams.get('tag')?.trim() || null,
  };

  const setFilter = useCallback(
    (next: ListFilter) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          if (next.favorites) {
            params.set('fav', '1');
          } else {
            params.delete('fav');
          }
          if (next.tag) {
            params.set('tag', next.tag);
          } else {
            params.delete('tag');
          }
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return { filter, setFilter };
}

function tagCountsOf(captures: CaptureSummary[]) {
  const counts = new Map<string, { count: number; name: string }>();
  for (const capture of captures) {
    for (const tag of tagsFromEmbed(capture.capture_tags)) {
      const entry = counts.get(tagKey(tag.name));
      if (entry) {
        entry.count += 1;
      } else {
        counts.set(tagKey(tag.name), { count: 1, name: tag.name });
      }
    }
  }
  // Most used first, then alphabetical.
  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
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
  const { filter, setFilter } = useListFilter();
  const isFiltered = filter.favorites || filter.tag !== null;
  const tagCounts = useMemo(() => tagCountsOf(list.captures), [list.captures]);
  const visibleCaptures = useMemo(
    () =>
      list.captures.filter(
        (capture) =>
          (!filter.favorites || capture.is_favorite) &&
          (!filter.tag ||
            tagsFromEmbed(capture.capture_tags).some(
              (tag) => tagKey(tag.name) === tagKey(filter.tag ?? ''),
            )),
      ),
    [filter.favorites, filter.tag, list.captures],
  );
  // Only the rows on screen get thumbnails, in one batched request.
  const thumbnails = useThumbnails(client, visibleCaptures, !isSearching);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const selection = useBulkSelection({
    client,
    onDeleted: list.remove,
    userId,
    visible: visibleCaptures,
  });
  const isSelecting = selection.isSelecting && !isSearching;
  const stopSelecting = selection.stop;

  // Searching (or emptying the list) leaves select mode.
  useEffect(() => {
    if (selection.isSelecting && (isSearching || (!list.isLoading && list.captures.length === 0))) {
      stopSelecting();
    }
  }, [isSearching, list.captures.length, list.isLoading, selection.isSelecting, stopSelecting]);

  async function toggleFavorite(capture: CaptureSummary) {
    const next = !capture.is_favorite;
    setFavoriteError(null);
    list.patch(capture.id, { is_favorite: next });
    try {
      await setFavorite(client, capture.id, next);
    } catch {
      list.patch(capture.id, { is_favorite: !next });
      setFavoriteError('The favorite could not be saved. Check your connection and try again.');
    }
  }

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
      : isFiltered
        ? `${visibleCaptures.length} of ${plural(list.captures.length, 'item')}`
        : plural(list.captures.length, 'item');

  return (
    <section
      aria-labelledby="capture-list-heading"
      className={isSelecting ? 'page page--selecting' : 'page'}
    >
      <PageHeader
        actions={
          isSearching ? (
            <button className="btn btn--ghost" onClick={clearAndRefocus} type="button">
              Clear search
            </button>
          ) : isSelecting ? (
            <button
              className="btn btn--ghost"
              disabled={selection.progress !== null}
              onClick={selection.stop}
              type="button"
            >
              Done
            </button>
          ) : (
            <div className="page-header__actions">
              {list.captures.length > 0 && (
                <button
                  className="btn btn--ghost page-header__select"
                  disabled={list.isLoading}
                  onClick={selection.start}
                  type="button"
                >
                  <ListChecks aria-hidden="true" className="icon" />
                  Select
                </button>
              )}
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
            </div>
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
              Search looks at titles, notes, links, page titles and tags in Inbox, Reviewed and
              Archived.
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

          {(list.captures.length > 0 || isFiltered) && (
            <FilterBar filter={filter} onChange={setFilter} tagCounts={tagCounts} />
          )}

          {favoriteError && <Notice tone="error">{favoriteError}</Notice>}

          {selection.notice && (
            <Notice tone={selection.notice.tone}>
              <span>{selection.notice.text}</span>
              <button className="btn btn--ghost" onClick={selection.dismissNotice} type="button">
                Dismiss
              </button>
            </Notice>
          )}

          {list.isLoading && list.captures.length === 0 && <SkeletonRows />}

          {!list.isLoading && list.captures.length > 0 && visibleCaptures.length === 0 && (
            <EmptyState
              action={
                <button
                  className="btn btn--secondary"
                  onClick={() => setFilter({ favorites: false, tag: null })}
                  type="button"
                >
                  Clear filters
                </button>
              }
              icon={Filter}
              title="Nothing matches these filters"
            >
              {filter.tag
                ? `No ${filter.favorites ? 'favorite ' : ''}captures here are tagged #${filter.tag}.`
                : 'Star a capture to keep it in Favorites.'}
            </EmptyState>
          )}

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
            captures={visibleCaptures}
            isBusy={list.isLoading}
            onToggleFavorite={(capture) => void toggleFavorite(capture)}
            selection={
              isSelecting
                ? {
                    onToggle: (capture) => selection.toggle(capture.id),
                    selectedIds: selection.selectedIds,
                  }
                : undefined
            }
            status={status}
            thumbnails={thumbnails}
          />

          {isSelecting && (
            <SelectionBar
              isDeleting={selection.progress !== null}
              onDelete={selection.requestDelete}
              onToggleAll={selection.toggleAll}
              selectedCount={selection.selected.length}
              visibleCount={visibleCaptures.length}
            />
          )}

          {isSelecting && selection.isConfirming && (
            <BulkDeleteSheet
              count={selection.selected.length}
              imageCount={selection.selected.filter((capture) => capture.kind === 'image').length}
              onCancel={selection.cancelDelete}
              onConfirm={() => void selection.confirmDelete()}
              progress={selection.progress}
            />
          )}
        </>
      )}
    </section>
  );
}

export function InboxPage() {
  return <CaptureListPage status="inbox" />;
}
