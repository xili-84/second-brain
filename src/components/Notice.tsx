import type { ReactNode } from 'react';

type NoticeProps = {
  children: ReactNode;
  tone: 'error' | 'info' | 'success';
};

/** Inline message. Errors are announced immediately; other tones politely. */
export function Notice({ children, tone }: NoticeProps) {
  return (
    <div className={`notice notice--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
