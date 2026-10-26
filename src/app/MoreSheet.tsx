import { LogOut, X } from 'lucide-react';

import { Sheet } from '../components/Sheet';
import { ThemeSwitch } from './ThemeSwitch';

type MoreSheetProps = {
  email: string | undefined;
  onClose: () => void;
  onSignOut: () => void;
};

/** Account and settings: appearance, who is signed in, sign out. Phones and desktop share it. */
export function MoreSheet({ email, onClose, onSignOut }: MoreSheetProps) {
  return (
    <Sheet labelledBy="more-sheet-title" onClose={onClose}>
      <h2 className="sheet__title" id="more-sheet-title">
        Account
      </h2>
      {email && <p className="sheet__text">Signed in as {email}</p>}
      <div className="sheet__section">
        <ThemeSwitch />
      </div>
      <button className="sheet__item sheet__item--danger" onClick={onSignOut} type="button">
        <LogOut aria-hidden="true" className="icon" />
        Sign out
      </button>
      <button className="sheet__item" onClick={onClose} type="button">
        <X aria-hidden="true" className="icon" />
        Close
      </button>
    </Sheet>
  );
}
