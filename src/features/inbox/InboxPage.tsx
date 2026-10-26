import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { captureStatusDetails, type CaptureStatus } from '../capture/captureLifecycle';
import { useAuth } from '../auth/authContext';

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

      {error && (
        <div className="form-message form-message--error" role="alert">
          {error}
        </div>
      )}

      <div className="inbox-toolbar">
        <span>
          {isLoading ? 'Loading…' : `${captures.length} capture${captures.length === 1 ? '' : 's'}`}
        </span>
        <button className="text-button" disabled={isLoading} onClick={() => void loadCaptures()}>
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

      <ol className="capture-list">
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
    </section>
  );
}

export function InboxPage() {
  return <CaptureListPage status="inbox" />;
}
