const savedFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeStyle: 'short' });

type ArticleHeaderProps = {
  createdAt: string;
  kind: string;
  statusLabel: string;
  title: string;
};

/** Kicker (kind and status), headline and saved date. */
export function ArticleHeader({ createdAt, kind, statusLabel, title }: ArticleHeaderProps) {
  return (
    <header className="article-head">
      <p className="article-head__meta">
        <span className="kicker">{kind}</span>
        <span className="chip">{statusLabel}</span>
      </p>
      <h1 className="article-head__title" id="capture-detail-heading">
        {title}
      </h1>
      <p className="article-head__meta">
        <time dateTime={createdAt}>Saved {savedFormat.format(new Date(createdAt))}</time>
      </p>
    </header>
  );
}
