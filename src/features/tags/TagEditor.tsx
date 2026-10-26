import { Plus, X } from 'lucide-react';
import { useId, useState, type KeyboardEvent } from 'react';

import { MAX_TAGS_PER_CAPTURE, normalizeTagName, suggestTags, tagKey, type Tag } from './tagNames';

type TagEditorProps = {
  /** Tags currently applied (saved or pending). */
  applied: readonly { name: string }[];
  disabled?: boolean;
  /** The user's existing tags, for autocomplete. */
  library: readonly Tag[];
  onAdd: (name: string) => void;
  onRemove: (name: string) => void;
};

/**
 * Tag chips with an inline combobox. Enter or comma adds the typed tag, Backspace in an empty
 * field removes the last one, and ArrowUp/ArrowDown pick from existing tags.
 */
export function TagEditor({ applied, disabled = false, library, onAdd, onRemove }: TagEditorProps) {
  const [text, setText] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputId = useId();
  const listId = useId();
  const hintId = useId();

  const suggestions = isOpen ? suggestTags(library, applied, text) : [];
  const isFull = applied.length >= MAX_TAGS_PER_CAPTURE;
  const activeSuggestion = active >= 0 ? suggestions[active] : undefined;

  function add(raw: string) {
    const name = normalizeTagName(raw);
    setText('');
    setActive(-1);
    if (!name || isFull || applied.some((tag) => tagKey(tag.name) === tagKey(name))) {
      return;
    }
    // Reuse the stored spelling of an existing tag ("march" -> "March").
    const existing = library.find((tag) => tagKey(tag.name) === tagKey(name));
    onAdd(existing?.name ?? name);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      if (activeSuggestion || text.trim()) {
        event.preventDefault();
        add(activeSuggestion?.name ?? text);
      } else if (event.key === ',') {
        event.preventDefault();
      }
    } else if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault();
      setActive((index) => (index + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp' && suggestions.length) {
      event.preventDefault();
      setActive((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      setIsOpen(false);
      setActive(-1);
    } else if (event.key === 'Backspace' && !text) {
      const last = applied[applied.length - 1];
      if (last) {
        onRemove(last.name);
      }
    }
  }

  return (
    <div className="tag-editor">
      <label className="visually-hidden" htmlFor={inputId}>
        Add tag
      </label>
      {applied.length > 0 && (
        <ul aria-label="Tags" className="tag-editor__chips">
          {applied.map((tag) => (
            <li className="tag-chip" key={tagKey(tag.name)}>
              <span className="tag-chip__name">#{tag.name}</span>
              <button
                aria-label={`Remove tag ${tag.name}`}
                className="tag-chip__remove"
                disabled={disabled}
                onClick={() => onRemove(tag.name)}
                type="button"
              >
                <X aria-hidden="true" className="icon" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="tag-editor__field">
        <Plus aria-hidden="true" className="icon tag-editor__icon" />
        <input
          aria-activedescendant={activeSuggestion ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-describedby={hintId}
          aria-expanded={suggestions.length > 0}
          autoCapitalize="none"
          autoComplete="off"
          className="tag-editor__input"
          disabled={disabled || isFull}
          enterKeyHint="done"
          id={inputId}
          maxLength={60}
          onBlur={() => {
            // Typed but not confirmed text still counts, so tags are not lost on mobile keyboards.
            if (text.trim()) {
              add(text);
            }
            setIsOpen(false);
            setActive(-1);
          }}
          onChange={(event) => {
            setText(event.target.value);
            setIsOpen(true);
            setActive(-1);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={isFull ? 'Tag limit reached' : 'Add tag'}
          role="combobox"
          value={text}
        />
        <span className="visually-hidden" id={hintId}>
          Press Enter or comma to add. Existing tags are suggested as you type.
        </span>
        <ul className="tag-editor__list" hidden={!suggestions.length} id={listId} role="listbox">
          {suggestions.map((tag, index) => (
            <li
              aria-selected={index === active}
              className={
                index === active
                  ? 'tag-editor__option tag-editor__option--active'
                  : 'tag-editor__option'
              }
              id={`${listId}-${index}`}
              key={tag.id}
              // mousedown keeps focus in the field, so blur does not add the half-typed text.
              onMouseDown={(event) => {
                event.preventDefault();
                add(tag.name);
              }}
              role="option"
            >
              #{tag.name}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
