import { Link, useSearchParams } from 'react-router-dom';

type SharedFieldProps = {
  label: string;
  value: string;
};

function SharedField({ label, value }: SharedFieldProps) {
  return (
    <div className="shared-field">
      <dt>{label}</dt>
      <dd>{value || 'Not provided'}</dd>
    </div>
  );
}

export function ShareDiagnostic() {
  const [searchParams] = useSearchParams();
  const title = searchParams.get('title')?.trim() ?? '';
  const text = searchParams.get('text')?.trim() ?? '';
  const url = searchParams.get('url')?.trim() ?? '';
  const hasSharedContent = Boolean(title || text || url);

  if (!hasSharedContent) {
    return (
      <section className="message-panel" aria-labelledby="share-heading">
        <p className="eyebrow">Android sharing diagnostic</p>
        <h1 id="share-heading">No shared content received</h1>
        <p>
          This route is only for the early Android Share Target proof. Open it through the phone’s
          Share menu with harmless test content.
        </p>
        <Link className="text-link" to="/">
          Return home
        </Link>
      </section>
    );
  }

  return (
    <section className="message-panel" aria-labelledby="share-heading">
      <p className="eyebrow">Android sharing diagnostic</p>
      <h1 id="share-heading">Share received</h1>
      <p className="diagnostic-note">
        This proof only confirms that text reached the installed PWA. Nothing was stored.
      </p>

      <dl className="shared-fields">
        <SharedField label="Title" value={title} />
        <SharedField label="Text" value={text} />
        <SharedField label="URL" value={url} />
      </dl>

      <Link className="text-link" to="/">
        Finish diagnostic
      </Link>
    </section>
  );
}
