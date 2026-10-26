import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { captureStatusDetails, type CaptureStatus } from '../capture/captureLifecycle';
import { useAuth } from '../auth/authContext';
import { CaptureSearchResults } from '../search/CaptureSearchResults';
import { parseSearchTerms, SEARCH_RESULT_LIMIT } from '../search/searchCaptures';
import { useCaptureSearch } from '../search/useCaptureSearch';

export const SEARCH_DEBOUNCE_MS = 250;

function isTypingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))
  );
}

type CaptureSummary = {
  created_at: string;
  id: string;
  kind: string;
  source_url: string | null;
  title: string | null;
};

export function CaptureListPage({ status }: { status: CaptureStatus }) {
  const { client, session } = useAuth();
  const userId = session?.user.id;
  const [captures, setCaptures] = useState<CaptureSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const details = captureStatusDetails[status];

  // The committed search lives in ?q= so it survives reloads and can be shared or bookmarked.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = (searchParams.get('q') ?? '').trim();
  const [draft, setDraft] = useState(urlQuery);
  const lastCommitted = useRef(urlQuery);
  const searchInput = useRef<HTMLInputElement>(null);
  const resultsList = useRef<HTMLOListElement>(null);
  const { retry: retrySearch, state: search } = useCaptureSearch(client, urlQuery, Boolean(userId));
  const isSearching = urlQuery !== '';
  const terms = parseSearchTerms(urlQuery);

  const commitSearch = useCallback(
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
    const timer = window.setTimeout(() => commitSearch(draft), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [commitSearch, draft, urlQuery]);

  // Follow ?q= changes that did not come from typing here, such as Back/Forward.
  useEffect(() => {
    if (urlQuery !== lastCommitted.current) {
      lastCommitted.current = urlQuery;
      setDraft(urlQuery);
    }
  }, [urlQuery]);

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
        setDraft('');
        commitSearch('');
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

  const loadCaptures = useCallback(async () => {
    if (!userId) {
      return;
    }

    setIsLoading(true);
    setError(null);

    const { data, error: loadError } = await client
      .from('captures')
      .select('id, kind, title, source_url, created_at')
      .eq('status', status)
      .order('created_at', { ascending: false });

    if (loadError) {
      setError(
        `Your ${details.label.toLowerCase()} could not be loaded. Check your connection and try again.`,
      );
    } else {
      setCaptures(data);
    }

    setIsLoading(false);
  }, [client, details.label, status, userId]);

  useEffect(() => {
    void loadCaptures();
  }, [loadCaptures]);

  return (
    <section className="workspace-panel" aria-labelledby="capture-list-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{details.eyebrow}</p>
          <h1 id="capture-list-heading">{details.label}</h1>
        </div>
      </div>

      <nav className="status-tabs" aria-label="Capture status">
        {(Object.keys(captureStatusDetails) as CaptureStatus[]).map((tabStatus) => {
          const tab = captureStatusDetails[tabStatus];
          return (
            <Link
              aria-current={tabStatus === status ? 'page' : undefined}
              className={tabStatus === status ? 'status-tab status-tab--active' : 'status-tab'}
              key={tabStatus}
              to={tab.path}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <form
        className="capture-search"
        onSubmit={(event) => {
          event.preventDefault();
          commitSearch(draft);
        }}
        role="search"
      >
        <label className="visually-hidden" htmlFor="capture-search-input">
          Search all captures
        </label>
        <input
          aria-describedby="capture-search-help"
          aria-keyshortcuts="/"
          autoComplete="off"
          enterKeyHint="search"
          id="capture-search-input"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder="Search Inbox, Reviewed and Archived"
          ref={searchInput}
          type="search"
          value={draft}
        />
        <span className="visually-hidden" id="capture-search-help">
          Searches titles, notes and links in every status. Press slash to focus, Escape to clear,
          and the down arrow to move into the results.
        </span>
      </form>

      {isSearching ? (
        <>
          {search.status === 'error' && (
            <div className="form-message form-message--error" role="alert">
              <span>Search failed. Check your connection and try again.</span>{' '}
              <button className="text-button" onClick={() => void retrySearch()} type="button">
                Try again
              </button>
            </div>
          )}

          <div className="inbox-toolbar">
            <span aria-live="polite">
              {search.status === 'ready'
                ? `${search.results.length === SEARCH_RESULT_LIMIT ? 'First ' : ''}${search.results.length} result${search.results.length === 1 ? '' : 's'} across all captures`
                : search.status === 'error'
                  ? 'Search failed'
                  : 'Searching…'}
            </span>
            <button
              className="text-button"
              onClick={() => {
                setDraft('');
                commitSearch('');
                searchInput.current?.focus();
              }}
              type="button"
            >
              Clear search
            </button>
          </div>

          {search.status === 'ready' && search.results.length === 0 && (
            <div className="empty-state">
              <h2>No captures match “{urlQuery}”.</h2>
              <p>Search looks at titles, notes and links in Inbox, Reviewed and Archived.</p>
            </div>
          )}

          <CaptureSearchResults
            isBusy={search.status === 'loading'}
            onExitToInput={() => searchInput.current?.focus()}
            ref={resultsList}
            results={search.status === 'ready' ? search.results : []}
            terms={terms}
          />
        </>
      ) : (
        <>
          {error && (
            <div className="form-message form-message--error" role="alert">
              <span>{error}</span>{' '}
              <button className="text-button" onClick={() => void loadCaptures()} type="button">
                Try again
              </button>
            </div>
          )}

          <div className="inbox-toolbar">
            <span aria-live="polite">
              {isLoading
                ? 'Loading…'
                : `${captures.length} capture${captures.length === 1 ? '' : 's'}`}
            </span>
            <button
              className="text-button"
              disabled={isLoading}
              onClick={() => void loadCaptures()}
              type="button"
            >
              Refresh
            </button>
          </div>

          {!isLoading && captures.length === 0 && !error && (
            <div className="empty-state">
              <h2>{details.emptyMessage}</h2>
              <p>
                {status === 'inbox'
                  ? 'Save a note or link and it will appear here.'
                  : 'Captures moved to this stage will appear here.'}
              </p>
            </div>
          )}

          <ol aria-busy={isLoading} aria-label={details.label} className="capture-list">
            {captures.map((capture) => {
              const cardTitle =
                capture.title?.trim() ||
                (capture.kind === 'link' && capture.source_url
                  ? capture.source_url
                  : `Untitled ${capture.kind}`);

              return (
                <li className="capture-card" key={capture.id}>
                  <Link
                    aria-label={`Open ${cardTitle}`}
                    className="capture-card-link"
                    to={`/captures/${capture.id}`}
                  >
                    <div className="capture-meta">
                      <span>{capture.kind}</span>
                      <time dateTime={capture.created_at}>
                        {new Intl.DateTimeFormat(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }).format(new Date(capture.created_at))}
                      </time>
                    </div>
                    <h2>{cardTitle}</h2>
                    {capture.kind === 'link' && <p>{capture.source_url}</p>}
                  </Link>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}

export function InboxPage() {
  return <CaptureListPage status="inbox" />;
}
