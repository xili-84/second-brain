import type { ReactNode } from 'react';

type PageHeaderProps = {
  actions?: ReactNode;
  id: string;
  subtitle?: ReactNode;
  title: string;
};

/** Page title with the heavy editorial rule underneath. */
export function PageHeader({ actions, id, subtitle, title }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header__text">
        <h1 className="page-title" id={id}>
          {title}
        </h1>
        {subtitle !== undefined && (
          <p aria-live="polite" className="page-sub">
            {subtitle}
          </p>
        )}
      </div>
      {actions}
    </header>
  );
}
