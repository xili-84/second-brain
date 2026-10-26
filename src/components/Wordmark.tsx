export function Wordmark({ large = false }: { large?: boolean }) {
  return (
    <span className={large ? 'wordmark wordmark--lg' : 'wordmark'}>
      Second Brain
      <span aria-hidden="true" className="wordmark__dot" />
    </span>
  );
}
