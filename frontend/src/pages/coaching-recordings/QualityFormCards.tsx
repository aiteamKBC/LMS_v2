import { useEffect, useState } from 'react';
import { ClipboardCheck, Search } from 'lucide-react';
import { qualityForms, type QualityFormCard } from '@/api/coachingQualityReviews';
import { qualityControl } from './QualityQuestions';

export default function QualityFormCards({ value, onChange, disabled = false, editing = false }: {
  value: string; onChange: (value: string) => void; disabled?: boolean; editing?: boolean;
}) {
  const [forms, setForms] = useState<QualityFormCard[]>([]), [search, setSearch] = useState('');
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    void qualityForms(controller.signal, editing).then(data => { if (!controller.signal.aborted) setForms(data.forms); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The form library could not be loaded.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [editing, retry]);
  const visible = forms.filter(row => row.title.toLowerCase().includes(search.trim().toLowerCase()));
  return <fieldset disabled={disabled} className="min-w-0 space-y-3"><legend className="mb-3 text-sm font-bold">Choose a quality form</legend>
    <label className="relative block max-w-lg"><Search size={16} className="absolute left-3 top-3 text-foreground-400" /><span className="sr-only">Search quality forms</span><input type="search" className={`${qualityControl} pl-9`} placeholder="Search forms, e.g. Safeguarding or Gateway" value={search} onChange={event => setSearch(event.target.value)} /></label>
    {loading && <p role="status" className="text-xs text-foreground-500">Loading form library…</p>}
    {error && <p role="alert" className="text-sm text-rose-800">{error} <button type="button" className="underline" onClick={() => setRetry(n => n + 1)}>Retry form library</button></p>}
    {[...new Set(visible.map(row => row.group))].map(group => <section key={group} aria-label={group} className="space-y-2"><h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-500">{group}</h3>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{visible.filter(row => row.group === group).map(row => <label key={row.reviewType} className={`flex min-w-0 cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary-500 ${value === row.reviewType ? 'border-primary-500 bg-primary-50 text-primary-900' : 'border-background-200 bg-white hover:border-primary-300'}`}>
        <input type="radio" name="quality-form-card" aria-label={row.title} checked={value === row.reviewType} onChange={() => onChange(row.reviewType)} className="mt-1 accent-primary-600" />
        <span className="min-w-0"><ClipboardCheck size={19} className="mb-2 text-primary-600" /><span className="block break-words text-sm font-semibold">{row.title}</span><span className="mt-1 block text-xs text-foreground-500">{row.published ? 'Open form' : 'Draft · publish before use'}</span></span>
      </label>)}</div>
    </section>)}
    {!loading && !error && !visible.length && <p className="text-sm text-foreground-500">No forms match this search.</p>}
  </fieldset>;
}
