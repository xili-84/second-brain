import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

type TopBarProps = {
  actions?: ReactNode;
  back?: { label: string; name: string; to: string };
  children?: ReactNode;
};

/** Top bar of a focused screen: a back link or close button, a title, and icon actions. */
export function TopBar({ actions, back, children }: TopBarProps) {
  return (
    <div className="top-bar glass">
      {back && (
        <Link aria-label={back.name} className="top-bar__back" to={back.to}>
          <ArrowLeft aria-hidden="true" className="icon" />
          {back.label}
        </Link>
      )}
      {children}
      <span className="top-bar__spacer" />
      {actions}
    </div>
  );
}
