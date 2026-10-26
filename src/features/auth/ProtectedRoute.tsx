import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useAuth } from './authContext';
import { LoadingPanel } from './SignInPage';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isRestoring, session } = useAuth();
  const location = useLocation();

  if (isRestoring) {
    return <LoadingPanel />;
  }

  if (!session) {
    return <Navigate replace state={{ from: location.pathname }} to="/login" />;
  }

  return children;
}
