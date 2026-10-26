import { useEffect, useState } from 'react';
import {
  BrowserRouter,
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';

import { AuthProvider } from '../features/auth/AuthProvider';
import { useAuth } from '../features/auth/authContext';
import { ProtectedRoute } from '../features/auth/ProtectedRoute';
import { SignInPage } from '../features/auth/SignInPage';
import { CaptureDetailPage } from '../features/capture/CaptureDetailPage';
import { reconcileImageStorage } from '../features/capture/imageCapture';
import { QuickCapturePage } from '../features/capture/QuickCapturePage';
import { CaptureListPage, InboxPage } from '../features/inbox/InboxPage';
import { PendingShareProvider } from '../features/share-target/PendingShareProvider';
import { ShareDiagnostic } from '../features/share-target/ShareDiagnostic';
import type { SecondBrainClient } from '../lib/supabase/client';
import { applyPwaUpdate, subscribeToPwaUpdates } from './pwaUpdate';

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

function Shell() {
  const { client, isRestoring, session } = useAuth();
  const userId = session?.user.id;
  const isOnline = useOnlineStatus();
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [isPwaUpdateAvailable, setIsPwaUpdateAvailable] = useState(false);
  const [isUpdatingPwa, setIsUpdatingPwa] = useState(false);

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

  return (
    <div className="app-shell">
      {!isOnline && (
        <div className="network-banner" role="alert">
          You are offline. Saving and loading captures requires an internet connection.
        </div>
      )}

      {signOutError && (
        <div className="network-banner" role="alert">
          {signOutError}
        </div>
      )}

      {isPwaUpdateAvailable && (
        <div className="update-banner" role="status">
          <span>A new version is ready. Save any edits before updating.</span>
          <div className="update-banner-actions">
            <button disabled={isUpdatingPwa} onClick={() => void handlePwaUpdate()} type="button">
              {isUpdatingPwa ? 'Updating…' : 'Update now'}
            </button>
            <button
              disabled={isUpdatingPwa}
              onClick={() => setIsPwaUpdateAvailable(false)}
              type="button"
            >
              Later
            </button>
          </div>
        </div>
      )}

      <header className="site-header">
        <Link className="brand" to={session ? '/capture' : '/login'} aria-label="Second Brain home">
          <img src="/icons/icon-192.png" alt="" width="40" height="40" />
          <span>Second Brain</span>
        </Link>

        {!isRestoring && session && <PrimaryNavigation onSignOut={() => void handleSignOut()} />}
      </header>

      <main>
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
          <Route path="/share" element={<ShareDiagnostic />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}

export function PrimaryNavigation({ onSignOut }: { onSignOut: () => void }) {
  const location = useLocation();
  const isLibrarySection =
    location.pathname === '/inbox' ||
    location.pathname === '/reviewed' ||
    location.pathname === '/archived' ||
    location.pathname.startsWith('/captures/');

  return (
    <nav className="site-nav" aria-label="Primary navigation">
      <NavLink
        className={({ isActive }) =>
          isActive ? 'nav-icon-action nav-icon-action--active' : 'nav-icon-action'
        }
        title="Capture"
        to="/capture"
      >
        <NavigationIcon name="capture" />
        <span className="visually-hidden">Capture</span>
      </NavLink>
      <Link
        aria-current={isLibrarySection ? 'page' : undefined}
        className={isLibrarySection ? 'nav-icon-action nav-icon-action--active' : 'nav-icon-action'}
        title="Library"
        to="/inbox"
      >
        <NavigationIcon name="library" />
        <span className="visually-hidden">Library</span>
      </Link>
      <button
        className="nav-icon-action nav-icon-action--sign-out"
        onClick={onSignOut}
        title="Sign out"
        type="button"
      >
        <NavigationIcon name="sign-out" />
        <span className="visually-hidden">Sign out</span>
      </button>
    </nav>
  );
}

function NavigationIcon({ name }: { name: 'capture' | 'library' | 'sign-out' }) {
  return (
    <svg aria-hidden="true" className="nav-icon" fill="none" viewBox="0 0 24 24">
      {name === 'capture' && <path d="M12 5v14M5 12h14" />}
      {name === 'library' && <path d="M4 7h6l2 2h8v9H4V7Z" />}
      {name === 'sign-out' && (
        <>
          <path d="M10 5H5v14h5" />
          <path d="m14 8 4 4-4 4m4-4H9" />
        </>
      )}
    </svg>
  );
}

function HomeRedirect() {
  const { isRestoring, session } = useAuth();

  if (isRestoring) {
    return (
      <section className="message-panel" aria-live="polite">
        <p className="eyebrow">Private knowledge capture</p>
        <h1>Opening Second Brain…</h1>
      </section>
    );
  }

  return <Navigate replace to={session ? '/capture' : '/login'} />;
}

function NotFound() {
  return (
    <section className="message-panel">
      <p className="eyebrow">Not found</p>
      <h1>This page does not exist.</h1>
      <Link className="text-link" to="/">
        Return home
      </Link>
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
