/** Compact placeholder for content that previously displayed a loading message. */
export function LoadingSkeleton({ label = 'Loading', className = '' }: {
  label?: string;
  className?: string;
}) {
  return (
    <span role="status" aria-label={label} aria-busy="true"
      className={`inline-flex w-40 min-w-0 max-w-full flex-col gap-1.5 align-middle ${className}`}>
      <span aria-hidden="true" className="kbc-skeleton block h-3 w-full animate-pulse rounded bg-background-200" />
      <span aria-hidden="true" className="kbc-skeleton block h-2.5 w-2/3 animate-pulse rounded bg-background-200" />
    </span>
  );
}
