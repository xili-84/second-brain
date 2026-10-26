import { useEffect, useState } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { EmptyState } from '../components/EmptyState';
import { Wordmark } from '../components/Wordmark';

import { AuthProvider } from '../features/auth/AuthProvider';
import { useAuth } from '../features/auth/authContext';
import { ProtectedRoute } from '../features/auth/ProtectedRoute';
import { SignInPage } from '../features/auth/SignInPage';
import { CaptureDetailPage } from '../features/capture/CaptureDetailPage';
import { reconcileImageStorage } from '../features/capture/imageReconciliation';
import { QuickCapturePage } from '../features/capture/QuickCapturePage';
import { CaptureListPage, InboxPage } from '../features/inbox/InboxPage';
import { PendingShareProvider } from '../features/share-target/PendingShareProvider';
import type { SecondBrainClient } from '../lib/supabase/client';
import { Masthead } from './Masthead';
import { MoreSheet } from './MoreSheet';
import { isFocusedScreen } from './navigation';
import { applyPwaUpdate, subscribeToPwaUpdates } from './pwaUpdate';
import { TabBar } from './TabBar';

function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const markOnline = () => setIsOnline(true);
    const markOffline = () => setIsOnline(false);

    window.addEventListener('online', markOnline);
    window.addEventListener('offline', markOffline);

    return () => {
      window.removeEventListener('online', markOnline);
      window.removeEventListener('offline', markOffline);
    };
  }, []);

  return isOnline;
}

const routeTitles: Record<string, string> = {
  '/archived': 'Archived',
  '/capture': 'Capture',
  '/inbox': 'Inbox',
  '/login': 'Sign in',
  '/reviewed': 'Reviewed',
};

function useDocumentTitle() {
  const { pathname } = useLocation();

  useEffect(() => {
    const section = pathname.startsWith('/captures/') ? 'Capture detail' : routeTitles[pathname];
    document.title = section ? `${section} · Second Brain` : 'Second Brain';
  }, [pathname]);
}

function Shell() {
  const { client, isRestoring, session } = useAuth();
  const userId = session?.user.id;
  const isOnline = useOnlineStatus();
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [isPwaUpdateAvailable, setIsPwaUpdateAvailable] = useState(false);
  const [isUpdatingPwa, setIsUpdatingPwa] = useState(false);

  useDocumentTitle();

  useEffect(() => subscribeToPwaUpdates(setIsPwaUpdateAvailable), []);

  useEffect(() => {
    if (!userId) {
      return;
    }

    // Reconciliation is best-effort background maintenance. Its failures are retried on a later
    // launch and do not block capture access, so they should not become a persistent user alert.
    void reconcileImageStorage(client, userId).catch(() => undefined);
  }, [client, userId]);

  async function handleSignOut() {
    setSignOutError(null);
    const { error } = await client.auth.signOut();

    if (error) {
      setSignOutError('Sign-out failed. Please try again.');
    }
  }

  async function handlePwaUpdate() {
    setIsUpdatingPwa(true);

    try {
      await applyPwaUpdate();
    } catch {
      setIsUpdatingPwa(false);
    }
  }

  const { pathname } = useLocation();
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const showChrome = !isRestoring && Boolean(session) && pathname !== '/login';
  const showTabBar = showChrome && !isFocusedScreen(pathname);

  // Close the More sheet whenever the screen changes (for example after signing out).
  useEffect(() => setIsMoreOpen(false), [pathname, session]);

  return (
    <div className={showTabBar ? 'app-shell app-shell--tabbed' : 'app-shell'}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {!isOnline && (
        <div className="banner" role="alert">
          You’re offline. Saving and loading captures needs an internet connection.
        </div>
      )}

      {signOutError && (
        <div className="banner" role="alert">
          {signOutError}
        </div>
      )}

      {isPwaUpdateAvailable && (
        <div className="banner" role="status">
          <span>A new version is ready. Save any edits before updating.</span>
          <span className="banner__actions">
            <button
              className="banner__button"
              disabled={isUpdatingPwa}
              onClick={() => void handlePwaUpdate()}
              type="button"
            >
              {isUpdatingPwa ? 'Updating…' : 'Update now'}
            </button>
            <button
              className="banner__button"
              disabled={isUpdatingPwa}
              onClick={() => setIsPwaUpdateAvailable(false)}
              type="button"
            >
              Later
            </button>
          </span>
        </div>
      )}

      {showChrome && <Masthead onSignOut={() => void handleSignOut()} />}

      <main id="main-content" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/login" element={<SignInPage />} />
          <Route
            path="/capture"
            element={
              <ProtectedRoute>
                <QuickCapturePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/inbox"
            element={
              <ProtectedRoute>
                <InboxPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reviewed"
            element={
              <ProtectedRoute>
                <CaptureListPage status="reviewed" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/archived"
            element={
              <ProtectedRoute>
                <CaptureListPage status="archived" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/captures/:captureId"
            element={
              <ProtectedRoute>
                <CaptureDetailPage />
              </ProtectedRoute>
            }
          />
          {/* Retired PWA share-target URL: older installs may still open it, so send them home
              and drop any shared values from the address bar. */}
          <Route path="/share" element={<Navigate replace to="/" />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>

      {showTabBar && <TabBar onMore={() => setIsMoreOpen(true)} />}

      {isMoreOpen && (
        <MoreSheet
          email={session?.user.email}
          onClose={() => setIsMoreOpen(false)}
          onSignOut={() => void handleSignOut()}
        />
      )}
    </div>
  );
}

function HomeRedirect() {
  const { isRestoring, session } = useAuth();

  if (isRestoring) {
    return (
      <section aria-live="polite" className="center-state">
        <Wordmark large />
        <p>Opening Second Brain…</p>
      </section>
    );
  }

  return <Navigate replace to={session ? '/inbox' : '/login'} />;
}

function NotFound() {
  return (
    <section className="page">
      <EmptyState
        action={
          <Link className="btn btn--secondary" to="/">
            Go to Inbox
          </Link>
        }
        headingLevel="h1"
        title="This page doesn’t exist"
      />
    </section>
  );
}

export function App({ client }: { client: SecondBrainClient }) {
  return (
    <BrowserRouter>
      <AuthProvider client={client}>
        <PendingShareProvider>
          <Shell />
        </PendingShareProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
