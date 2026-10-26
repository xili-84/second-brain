import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { Notice } from '../../components/Notice';
import { Wordmark } from '../../components/Wordmark';
import { useAuth } from './authContext';

type RedirectState = {
  from?: string;
};

export function SignInPage() {
  const { client, error: restorationError, isRestoring, session } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (isRestoring) {
    return <LoadingPanel />;
  }

  if (session) {
    return <Navigate replace to="/inbox" />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    let signInError: unknown = null;

    try {
      ({ error: signInError } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      }));
    } catch (caught) {
      signInError = caught;
    }

    if (signInError) {
      setError(
        navigator.onLine
          ? 'Sign-in failed. Check your email and password, then try again.'
          : 'You appear to be offline. Connect to the internet and try again.',
      );
      setIsSubmitting(false);
      return;
    }

    const requestedPath = (location.state as RedirectState | null)?.from;
    navigate(requestedPath?.startsWith('/') ? requestedPath : '/inbox', { replace: true });
  }

  return (
    <div className="auth">
      <section aria-labelledby="sign-in-heading" className="auth__card">
        <Wordmark large />
        <hr className="auth__rule" />
        <h1 className="page-title" id="sign-in-heading">
          Sign in
        </h1>
        <p className="page-sub">Your private notebook for notes, links and images.</p>

        {(error || restorationError) && <Notice tone="error">{error ?? restorationError}</Notice>}

        <form className="auth__form" onSubmit={(event) => void handleSubmit(event)}>
          <label className="field">
            <span className="field__label">Email</span>
            <input
              autoComplete="email"
              className="input"
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>

          <label className="field">
            <span className="field__label">Password</span>
            <input
              autoComplete="current-password"
              className="input"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>

          <button
            aria-busy={isSubmitting}
            className="btn btn--primary btn--lg btn--block"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="auth__foot">Private access · accounts are created by the owner.</p>
      </section>
    </div>
  );
}

/** Shown while the stored session is restored. */
export function LoadingPanel() {
  return (
    <div aria-live="polite" className="center-state">
      <Wordmark />
      <p>Restoring session…</p>
    </div>
  );
}
