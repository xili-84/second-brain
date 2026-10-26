const titleWidths = ['skeleton--w-90', 'skeleton--w-60', 'skeleton--w-75', 'skeleton--w-40'];

/** Placeholder list rows shown while captures load. Hidden from assistive technology. */
export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div aria-hidden="true" className="skeleton-rows">
      {Array.from({ length: count }, (_, index) => (
        <div className="skeleton-stack" key={index}>
          <span className={`skeleton skeleton--title ${titleWidths[index % titleWidths.length]}`} />
          <span className="skeleton skeleton--meta" />
        </div>
      ))}
    </div>
  );
}

/** Placeholder for a capture page: kicker, two headline lines and a few lines of text. */
export function SkeletonArticle() {
  return (
    <div aria-hidden="true" className="skeleton-article">
      <div className="skeleton-stack">
        <span className="skeleton skeleton--kicker" />
        <span className="skeleton skeleton--headline skeleton--w-90" />
        <span className="skeleton skeleton--headline skeleton--w-60" />
        <span className="skeleton skeleton--meta" />
      </div>
      <div className="skeleton-stack">
        <span className="skeleton skeleton--w-100" />
        <span className="skeleton skeleton--w-90" />
        <span className="skeleton skeleton--w-75" />
        <span className="skeleton skeleton--w-40" />
      </div>
    </div>
  );
}
