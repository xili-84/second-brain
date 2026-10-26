import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

type EmptyStateProps = {
  action?: ReactNode;
  children?: ReactNode;
  headingLevel?: 'h1' | 'h2';
  icon?: LucideIcon | undefined;
  title: string;
};

export function EmptyState({
  action,
  children,
  headingLevel: Heading = 'h2',
  icon: Icon,
  title,
}: EmptyStateProps) {
  return (
    <div className="empty">
      {Icon && (
        <span className="empty__icon">
          <Icon aria-hidden="true" className="icon" />
        </span>
      )}
      <Heading className="empty__title">{title}</Heading>
      {children && <p className="empty__text">{children}</p>}
      {action}
    </div>
  );
}
