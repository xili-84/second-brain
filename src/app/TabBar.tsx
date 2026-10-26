import { Menu, Plus } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

import { activeSectionPath, sections, type Section } from './navigation';

/** Phone navigation in the thumb zone: three sections, New capture in the middle, and More. */
export function TabBar({ onMore }: { onMore: () => void }) {
  const { pathname, state } = useLocation();
  const activePath = activeSectionPath(pathname, state);
  const [inbox, reviewed, archived] = sections as [Section, Section, Section];

  function tab(section: Section) {
    return (
      <Link
        aria-current={section.path === activePath ? 'page' : undefined}
        className="tab"
        key={section.path}
        to={section.path}
      >
        <section.icon aria-hidden="true" className="icon" />
        <span>{section.label}</span>
      </Link>
    );
  }

  return (
    <nav aria-label="Sections" className="tabbar glass">
      {tab(inbox)}
      {tab(reviewed)}
      <Link className="tab tab--new" to="/capture">
        <span className="tab__new-button">
          <Plus aria-hidden="true" className="icon" />
        </span>
        <span className="visually-hidden">New capture</span>
      </Link>
      {tab(archived)}
      <button aria-haspopup="dialog" className="tab" onClick={onMore} type="button">
        <Menu aria-hidden="true" className="icon" />
        <span>More</span>
      </button>
    </nav>
  );
}
