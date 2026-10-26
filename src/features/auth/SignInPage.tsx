import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

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
    return <Navigate replace to="/capture" />;
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
    navigate(requestedPath?.startsWith('/') ? requestedPath : '/capture', { replace: true });
  }

  return (
    <section className="auth-panel" aria-labelledby="sign-in-heading">
      <p className="eyebrow">Private access</p>
      <h1 id="sign-in-heading">Sign in</h1>
      <p>Use the private account created in Supabase.</p>

      {(error || restorationError) && (
        <div className="form-message form-message--error" role="alert">
          {error ?? restorationError}
        </div>
      )}

      <form className="form-stack" onSubmit={(event) => void handleSubmit(event)}>
        <label>
          Email
          <input
            autoComplete="email"
            inputMode="email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </label>

        <label>
          Password
          <input
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>

        <button
          aria-busy={isSubmitting}
          className="primary-button"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </section>
  );
}

export function LoadingPanel() {
  return (
    <section className="message-panel" aria-live="polite">
      <p className="eyebrow">Private access</p>
      <h1>Restoring session…</h1>
    </section>
  );
}
