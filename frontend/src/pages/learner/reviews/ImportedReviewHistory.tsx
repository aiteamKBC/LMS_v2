import { useEffect, useMemo, useState } from 'react';
import type { LearnerKind } from '@/api/learnerDetail';
import {
  fetchReviewHistory,
  type ImportedReview,
  type ImportedReviewField,
  type ImportedReviewSection,
  type ReviewHistoryCategory,
} from '@/api/reviewHistory';
import { RowsSkeleton } from '@/components/feature/Skeletons';

interface ImportedReviewHistoryProps {
  kind: LearnerKind;
  learnerId: string;
  category: ReviewHistoryCategory;
}

const monthOptions = [
  ['01', 'January'], ['02', 'February'], ['03', 'March'], ['04', 'April'],
  ['05', 'May'], ['06', 'June'], ['07', 'July'], ['08', 'August'],
  ['09', 'September'], ['10', 'October'], ['11', 'November'], ['12', 'December'],
];

function reviewDate(review: ImportedReview): string | null {
  return review.completedDate || review.plannedDate;
}

function formatDate(value?: string | null): string {
  if (!value) return 'Date not available';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusLabel(value: string): string {
  return value.split('-').filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ') || 'Unknown';
}

function statusStyle(value: string): string {
  if (value === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (value === 'scheduled') return 'border-blue-200 bg-blue-50 text-blue-700';
  if (value === 'in-progress') return 'border-violet-200 bg-violet-50 text-violet-700';
  if (value === 'cancelled') return 'border-rose-200 bg-rose-50 text-rose-700';
  return 'border-amber-200 bg-amber-50 text-amber-700';
}

function printableValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(printableValue).join(', ');
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function safeLink(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function Field({ field }: { field: ImportedReviewField }) {
  const links = Array.isArray(field.links) ? field.links : [];
  return (
    <div className="rounded-xl border border-background-200 bg-background-100/45 p-3.5">
      {field.label && <p className="text-[10px] font-bold uppercase tracking-wide text-foreground-400">{field.label}</p>}
      <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 text-foreground-800">{printableValue(field.value)}</p>
      {field.description && <p className="mt-1 text-xs leading-5 text-foreground-500">{field.description}</p>}
      {links.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {links.map((link, index) => {
            const href = safeLink(link.href || link.url || link.azure_url);
            if (!href) return null;
            return <a key={`${href}:${index}`} href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-primary-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-50"><AppIcon className="ri-attachment-2" />{link.text || link.title || 'Open attachment'}</a>;
          })}
        </div>
      )}
    </div>
  );
}

function ReviewSection({ section, open, onToggle }: { section: ImportedReviewSection; open: boolean; onToggle: () => void }) {
  return (
    <section className="overflow-hidden rounded-xl border border-background-200 bg-white">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-primary-50/40">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700"><AppIcon className="ri-file-list-3-line" /></span>
        <span className="min-w-0 flex-1 text-sm font-bold text-foreground-900">{section.name}</span>
        <span className="text-[10px] text-foreground-400">{section.fields.length} fields</span>
        <AppIcon className={`ri-arrow-down-s-line text-lg text-foreground-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-background-200 p-3.5 sm:p-4">
          {section.fields.map((field, index) => <Field key={`${field.label || 'field'}:${index}`} field={field} />)}
          {section.tables.map((table, tableIndex) => {
            const rows = Array.isArray(table.rows) ? table.rows : [];
            if (!rows.length) return null;
            return (
              <div key={tableIndex} className="overflow-x-auto rounded-xl border border-background-200">
                <table className="min-w-full text-left text-xs">
                  <tbody className="divide-y divide-background-200">
                    {rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className={rowIndex === 0 ? 'bg-primary-50/55 font-bold text-primary-900' : 'text-foreground-700'}>
                        {(Array.isArray(row) ? row : [row]).map((cell, cellIndex) => <td key={cellIndex} className="max-w-[420px] whitespace-pre-wrap break-words px-3 py-2.5 align-top">{printableValue(cell)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
          {section.rawText && <div className="rounded-xl border border-background-200 bg-background-100/45 p-3.5"><p className="text-[10px] font-bold uppercase tracking-wide text-foreground-400">Imported text</p><p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 text-foreground-700">{section.rawText}</p></div>}
          {!section.fields.length && !section.tables.length && !section.rawText && <p className="text-sm text-foreground-400">No section details were imported.</p>}
        </div>
      )}
    </section>
  );
}

export function ImportedReviewHistory({ kind, learnerId, category }: ImportedReviewHistoryProps) {
  const [reviews, setReviews] = useState<ImportedReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [year, setYear] = useState('all');
  const [month, setMonth] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const [openSections, setOpenSections] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetchReviewHistory(kind, learnerId, category, controller.signal)
      .then((data) => setReviews(data.reviews))
      .catch((reason: unknown) => {
        if ((reason as { name?: string })?.name !== 'AbortError') setError(reason instanceof Error ? reason.message : 'Could not load imported reviews.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [category, kind, learnerId]);

  const statuses = useMemo(() => Array.from(new Set(reviews.map((review) => review.status))).sort(), [reviews]);
  const years = useMemo(() => Array.from(new Set(reviews.map(reviewDate).filter(Boolean).map((value) => value!.slice(0, 4)))).sort().reverse(), [reviews]);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return reviews.filter((review) => {
      const date = reviewDate(review);
      return (!query || [review.name, review.type, review.reviewerName].some((value) => value.toLocaleLowerCase().includes(query)))
        && (status === 'all' || review.status === status)
        && (year === 'all' || date?.slice(0, 4) === year)
        && (month === 'all' || date?.slice(5, 7) === month);
    });
  }, [month, reviews, search, status, year]);
  const selected = filtered.find((review) => review.id === selectedId) || null;
  const title = category === 'monthly-coaching' ? 'Imported coaching history' : 'Imported progress review history';

  useEffect(() => {
    if (selectedId && !filtered.some((review) => review.id === selectedId)) {
      setSelectedId('');
      setOpenSections([]);
    }
  }, [filtered, selectedId]);

  function selectReview(review: ImportedReview) {
    if (selectedId === review.id) {
      setSelectedId('');
      setOpenSections([]);
      return;
    }
    setSelectedId(review.id);
    setOpenSections(review.sections[0] ? [String(review.sections[0].id)] : []);
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-foreground-200/70 bg-background-50 shadow-[0_8px_30px_rgba(27,12,52,0.06)]">
      <div className="flex flex-col gap-3 border-b border-background-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary-50 text-secondary-700"><AppIcon className="ri-history-line" /></span>
          <div><h2 className="text-base font-bold text-foreground-900">{title}</h2><p className="mt-0.5 text-xs text-foreground-500">Previous Aptem records. Select a review to see every imported section here.</p></div>
        </div>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-background-300 bg-background-100 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-foreground-500"><AppIcon className="ri-lock-line" />Read only</span>
      </div>

      {loading ? <div className="p-5"><RowsSkeleton rows={4} /></div> : error ? (
        <div className="m-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AppIcon className="ri-error-warning-line mr-2" />{error}</div>
      ) : reviews.length === 0 ? (
        <div className="p-5 text-center text-sm text-foreground-500">No imported {category === 'monthly-coaching' ? 'coaching meetings' : 'progress reviews'} were found for this learner.</div>
      ) : (
        <>
          <div className="grid gap-2 border-b border-background-200 bg-background-100/45 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="relative sm:col-span-2 lg:col-span-1"><span className="sr-only">Search reviews</span><AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search reviews" className="h-10 w-full rounded-xl border border-background-300 bg-white pl-9 pr-3 text-xs outline-none focus:border-primary-400" /></label>
            <label><span className="sr-only">Filter by status</span><select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 w-full rounded-xl border border-background-300 bg-white px-3 text-xs font-semibold text-foreground-700 outline-none focus:border-primary-400"><option value="all">All statuses</option>{statuses.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>
            <label><span className="sr-only">Filter by year</span><select value={year} onChange={(event) => setYear(event.target.value)} className="h-10 w-full rounded-xl border border-background-300 bg-white px-3 text-xs font-semibold text-foreground-700 outline-none focus:border-primary-400"><option value="all">All years</option>{years.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label><span className="sr-only">Filter by month</span><select value={month} onChange={(event) => setMonth(event.target.value)} className="h-10 w-full rounded-xl border border-background-300 bg-white px-3 text-xs font-semibold text-foreground-700 outline-none focus:border-primary-400"><option value="all">All months</option>{monthOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </div>

          <div className="grid min-h-[280px] lg:grid-cols-[minmax(300px,390px)_minmax(0,1fr)]">
            <div className="max-h-[680px] overflow-y-auto border-b border-background-200 lg:border-b-0 lg:border-r">
              <div className="flex items-center justify-between border-b border-background-200 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wide text-foreground-400"><span>Records</span><span>{filtered.length} of {reviews.length}</span></div>
              {filtered.length === 0 ? <p className="p-6 text-center text-sm text-foreground-500">No reviews match these filters.</p> : filtered.map((review) => {
                const date = reviewDate(review);
                const active = selectedId === review.id;
                return (
                  <button key={review.id} type="button" onClick={() => selectReview(review)} className={`flex w-full items-start gap-3 border-b border-background-200 p-4 text-left transition ${active ? 'bg-primary-50 ring-1 ring-inset ring-primary-200' : 'hover:bg-background-100'}`}>
                    <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${active ? 'bg-primary-600 text-white' : 'bg-primary-50 text-primary-700'}`}><AppIcon className={category === 'monthly-coaching' ? 'ri-user-voice-line' : 'ri-file-chart-line'} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-bold text-foreground-900">{review.name}</span>
                      <span className="mt-1 block truncate text-[10px] text-foreground-500">{review.type}{review.reviewerName ? ` · ${review.reviewerName}` : ''}</span>
                      <span className="mt-2 flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${statusStyle(review.status)}`}>{statusLabel(review.status)}</span><span className="text-[10px] text-foreground-400">{formatDate(date)}{review.plannedTime ? ` · ${review.plannedTime}` : ''}</span></span>
                    </span>
                    <AppIcon className={`ri-arrow-right-s-line mt-2 text-foreground-400 transition-transform ${active ? 'rotate-90 text-primary-700' : ''}`} />
                  </button>
                );
              })}
            </div>

            <div className="min-w-0 bg-background-100/25 p-4 sm:p-5">
              {!selected ? (
                <div className="flex h-full min-h-56 flex-col items-center justify-center text-center"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-xl text-primary-700"><AppIcon className="ri-cursor-line" /></span><p className="mt-3 text-sm font-bold text-foreground-800">Select a review</p><p className="mt-1 max-w-sm text-xs leading-5 text-foreground-500">Its imported fields, answers and tables will open in this panel without leaving the page.</p></div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-primary-100 bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-[10px] font-bold uppercase tracking-wide text-primary-600">Imported review</p><h3 className="mt-1 text-lg font-bold text-foreground-900">{selected.name}</h3><p className="mt-1 text-xs text-foreground-500">{selected.type}</p></div><span className={`w-fit rounded-full border px-3 py-1 text-[10px] font-bold ${statusStyle(selected.status)}`}>{statusLabel(selected.status)}</span></div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-3"><div className="rounded-xl bg-background-100 p-3"><p className="text-[9px] uppercase text-foreground-400">Reviewer</p><p className="mt-1 text-xs font-bold text-foreground-800">{selected.reviewerName || '-'}</p></div><div className="rounded-xl bg-background-100 p-3"><p className="text-[9px] uppercase text-foreground-400">Planned</p><p className="mt-1 text-xs font-bold text-foreground-800">{formatDate(selected.plannedDate)}{selected.plannedTime ? ` at ${selected.plannedTime}` : ''}</p></div><div className="rounded-xl bg-background-100 p-3"><p className="text-[9px] uppercase text-foreground-400">Completed</p><p className="mt-1 text-xs font-bold text-foreground-800">{formatDate(selected.completedDate)}</p></div></div>
                    {!['success', 'complete'].includes(selected.extractionStatus.toLowerCase()) && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800"><AppIcon className="ri-information-line mr-1" />Some details may not have been available in the imported Aptem record.</p>}
                  </div>
                  {selected.sections.length > 0 ? selected.sections.map((section) => {
                    const sectionId = String(section.id);
                    return <ReviewSection key={section.id} section={section} open={openSections.includes(sectionId)} onToggle={() => setOpenSections((current) => current.includes(sectionId) ? current.filter((value) => value !== sectionId) : [...current, sectionId])} />;
                  }) : <div className="rounded-xl border border-dashed border-background-300 bg-white p-6 text-center text-sm text-foreground-500">This review has a summary only; no section details were imported.</div>}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
