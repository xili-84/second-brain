import { Star, X } from 'lucide-react';

import { tagKey } from './tagNames';

export type ListFilter = { favorites: boolean; tag: string | null };

type FilterBarProps = {
  filter: ListFilter;
  onChange: (filter: ListFilter) => void;
  /** Tags used in the current list, with how many captures carry each. */
  tagCounts: readonly { count: number; name: string }[];
};

/** One scrollable row of toggles: Favorites plus one chip per tag (one tag at a time). */
export function FilterBar({ filter, onChange, tagCounts }: FilterBarProps) {
  const isFiltered = filter.favorites || filter.tag !== null;

  return (
    <div aria-label="Filter captures" className="filter-bar" role="group">
      {/* First, so it stays visible on phones where the row scrolls sideways. */}
      {isFiltered && (
        <button
          className="filter-chip filter-chip--clear"
          onClick={() => onChange({ favorites: false, tag: null })}
          type="button"
        >
          <X aria-hidden="true" className="icon" />
          Clear
        </button>
      )}
      <button
        aria-pressed={filter.favorites}
        className={filter.favorites ? 'filter-chip filter-chip--on' : 'filter-chip'}
        onClick={() => onChange({ ...filter, favorites: !filter.favorites })}
        type="button"
      >
        <Star aria-hidden="true" className="icon" />
        Favorites
      </button>
      {tagCounts.map(({ count, name }) => {
        const isOn = filter.tag !== null && tagKey(filter.tag) === tagKey(name);
        return (
          <button
            aria-label={`Tag ${name}, ${count}`}
            aria-pressed={isOn}
            className={isOn ? 'filter-chip filter-chip--on' : 'filter-chip'}
            key={tagKey(name)}
            onClick={() => onChange({ ...filter, tag: isOn ? null : name })}
            type="button"
          >
            #{name}
            <span aria-hidden="true" className="filter-chip__count">
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
