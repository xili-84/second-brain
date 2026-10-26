import { splitHighlights } from './highlight';

export function HighlightedText({ terms, text }: { terms: string[]; text: string }) {
  return (
    <>
      {splitHighlights(text, terms).map((part, index) =>
        part.match ? (
          <mark className="search-highlight" key={index}>
            {part.text}
          </mark>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
