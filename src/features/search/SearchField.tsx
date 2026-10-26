import { Search, X } from 'lucide-react';
import type { KeyboardEvent, Ref } from 'react';

type SearchFieldProps = {
  inputRef: Ref<HTMLInputElement>;
  onChange: (value: string) => void;
  onClear: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onSubmit: () => void;
  value: string;
};

/** The search box above every list: magnifier, field and a 44px clear button. */
export function SearchField({
  inputRef,
  onChange,
  onClear,
  onKeyDown,
  onSubmit,
  value,
}: SearchFieldProps) {
  return (
    <form
      className="search-field"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      role="search"
    >
      <Search aria-hidden="true" className="icon search-field__icon" />
      <label className="visually-hidden" htmlFor="capture-search-input">
        Search all captures
      </label>
      <input
        aria-describedby="capture-search-help"
        aria-keyshortcuts="/"
        autoComplete="off"
        className="search-field__input"
        enterKeyHint="search"
        id="capture-search-input"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Search all captures"
        ref={inputRef}
        type="search"
        value={value}
      />
      {value && (
        <button className="icon-btn search-field__clear" onClick={onClear} type="button">
          <X aria-hidden="true" className="icon" />
          <span className="visually-hidden">Clear search text</span>
        </button>
      )}
      <span className="visually-hidden" id="capture-search-help">
        Searches titles, notes and links in Inbox, Reviewed and Archived. Press slash to focus,
        Escape to clear, and the down arrow to move into the results.
      </span>
    </form>
  );
}
