import { CircleUser, Plus } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

import { Wordmark } from '../components/Wordmark';
import { activeSectionPath, isFocusedScreen, sections } from './navigation';

const todayFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'long',
  weekday: 'long',
});

/** Top bar: wordmark and date on phones; wordmark, sections and actions on wide screens. */
export function Masthead({ onAccount }: { onAccount: () => void }) {
  const { pathname, state } = useLocation();
  const activePath = activeSectionPath(pathname, state);

  return (
    <header
      className={
        isFocusedScreen(pathname) ? 'masthead glass masthead--wide-only' : 'masthead glass'
      }
    >
      <div className="masthead__inner">
        <Link aria-label="Second Brain, Inbox" className="masthead__brand" to="/inbox">
          <Wordmark />
        </Link>
        <span className="masthead__date">{todayFormat.format(new Date())}</span>

        <nav aria-label="Sections" className="masthead__nav">
          {sections.map((section) => (
            <Link
              aria-current={section.path === activePath ? 'page' : undefined}
              className="masthead__link"
              key={section.path}
              to={section.path}
            >
              {section.label}
            </Link>
          ))}
        </nav>

        <div className="masthead__actions">
          <Link className="btn btn--primary" to="/capture">
            <Plus aria-hidden="true" className="icon" />
            New capture
          </Link>
          <button
            aria-haspopup="dialog"
            className="icon-btn"
            onClick={onAccount}
            title="Account and appearance"
            type="button"
          >
            <CircleUser aria-hidden="true" className="icon" />
            <span className="visually-hidden">Account and appearance</span>
          </button>
        </div>
      </div>
    </header>
  );
}
