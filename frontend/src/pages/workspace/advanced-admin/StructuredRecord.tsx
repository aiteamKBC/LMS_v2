function label(value: string) {
  return value.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')
    .replace(/^./, first => first.toUpperCase());
}

/** Read-only presentation for imported review fields with varying source schemas. */
export default function StructuredRecord({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value == null || value === '') return <span className="text-foreground-500">Not recorded</span>;
  if (depth > 6) return <span className="text-foreground-500">More details are available in the original report.</span>;
  if (typeof value !== 'object') return <span className="whitespace-pre-wrap break-words">{String(value)}</span>;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-foreground-500">No entries recorded</span>;
    return <ul className="space-y-2">{value.map((item, index) => <li key={index} className="rounded-lg border border-foreground-100 bg-white p-3">
      <StructuredRecord value={item} depth={depth + 1} />
    </li>)}</ul>;
  }
  const entries = Object.entries(value).filter(([, item]) => item != null && item !== '');
  if (!entries.length) return <span className="text-foreground-500">No details recorded</span>;
  return <dl className="space-y-2">{entries.map(([key, item]) => <div key={key} className="border-b border-foreground-100 pb-2 last:border-b-0">
    <dt className="text-xs font-semibold uppercase tracking-wide text-foreground-500">{label(key)}</dt>
    <dd className="mt-1 text-sm text-foreground-800"><StructuredRecord value={item} depth={depth + 1} /></dd>
  </div>)}</dl>;
}
