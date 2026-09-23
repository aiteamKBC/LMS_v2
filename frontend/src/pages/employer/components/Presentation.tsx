/* Shared Employer-only visual primitives also export formatters and class names.
 * These are intentionally colocated with the Readdy presentation components. */
/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from 'react';
import { formatSystemTimestamp } from '@/lib/format';

export function textValue(value: string | number | null | undefined) { return value == null || value === '' ? 'Unavailable' : String(value); }
export function percent(value: number | null | undefined) { return value == null ? 'Unavailable' : `${value}%`; }
// Hours are stored to four decimal places; an employer reads them as a
// quantity, not a precise measurement, so show at most one decimal and drop a
// trailing ".0". Rounding is display-only — the underlying value is untouched.
export function hours(value: number | null | undefined) { return value == null ? 'Unavailable' : `${Number(value.toFixed(1))}h`; }
export function date(value: string | null | undefined) { return value ? formatSystemTimestamp(value, { day: '2-digit', month: 'short', year: 'numeric' }) || 'Unavailable' : 'Unavailable'; }
export function initials(value: string) { return value.split(/\s+/).filter(Boolean).map(p => p[0]).slice(0, 2).join('').toUpperCase(); }
export const secondaryButton = 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-background-300 px-3 py-1.5 text-sm font-medium text-foreground-700 transition-colors hover:bg-background-100';
export const primaryButton = 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary-500 px-4 py-2 text-sm font-semibold text-background-50 transition-colors hover:bg-primary-600';

// Presentation from Readdy OverviewTab.InfoPanel and AttendanceOtjTab.Stat.
export function Panel({ title, icon = 'ri-book-open-line', children }: { title: string; icon?: string; children: ReactNode }) {
  return <section aria-label={title} className="rounded-lg border border-background-200 bg-background-50 p-4 md:p-5">
    <div className="flex items-center gap-2 border-b border-background-200 pb-3"><span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-100 text-primary-700"><i className={`${icon} text-base`} aria-hidden="true" /></span><h2 className="text-sm font-semibold text-foreground-950">{title}</h2></div>
    <div className="mt-3 space-y-3">{children}</div>
  </section>;
}
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex items-start justify-between gap-4 border-b border-background-100 py-2"><dt className="text-sm text-foreground-600">{label}</dt><dd className="text-right text-sm font-medium text-foreground-900">{children}</dd></div>;
}
// `tone` matches Readdy's EmployerStats.StatCard: 'attention' rings the card
// amber (used for KPIs the employer should act on), 'critical' rings it rose
// (used only when the value itself is a confirmed, real problem count).
// Defaults to 'neutral' so every other Metric usage is unaffected.
export function Metric({ label, value, detail, icon, tone = 'neutral', iconClassName }: { label: string; value: ReactNode; detail?: ReactNode; icon?: string; tone?: 'neutral' | 'attention' | 'critical'; iconClassName?: string }) {
  const ring = tone === 'critical' ? 'border-rose-200' : tone === 'attention' ? 'border-accent-300' : 'border-background-200';
  const valueClass = tone === 'critical' ? 'text-rose-700' : tone === 'attention' ? 'text-accent-700' : 'text-foreground-950';
  // Match Readdy's PerformanceCards: numerical values are 2xl, while
  // state messages stay compact so they do not dominate a card or wrap into
  // oversized multi-line headings.
  const isStateMessage = typeof value === 'string' && !/^[-+]?\d[\d,.]*[%h]?(\s*\/\s*\d[\d,.]*)?$/.test(value);
  const size = isStateMessage ? 'text-base font-semibold leading-6' : 'text-2xl font-bold';
  return <section aria-label={label} className={`rounded-lg border ${ring} bg-background-50 p-4 md:p-5`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-medium text-foreground-600">{label}</p><div className={`mt-2 ${size} ${valueClass}`}>{value}</div></div>{icon && <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconClassName || 'bg-primary-100 text-primary-700'}`}><i className={`${icon} text-lg`} aria-hidden="true" /></span>}</div>{detail && <div className="mt-2 text-xs text-foreground-600">{detail}</div>}</section>;
}
export function Badge({ children }: { children: ReactNode }) { return <span className="inline-flex items-center gap-1.5 rounded-full border border-background-300 bg-background-100 px-2.5 py-1 text-xs font-medium text-foreground-700">{children}</span>; }
export function ProgressBar({ value }: { value: number | null | undefined }) { return value == null ? null : <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-background-200"><div className="h-full rounded-full bg-primary-500" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>; }
export function ErrorState({ message, retry, label = 'Retry' }: { message: string; retry: () => void; label?: string }) { return <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-center"><i className="ri-error-warning-line text-2xl text-rose-600" aria-hidden="true" /><p className="mt-2 text-sm text-foreground-600">{message}</p><button type="button" className={`mt-4 ${primaryButton}`} onClick={retry}>{label}</button></div>; }
export function Tabs({ labels, selected, onSelect, label }: { labels: readonly string[]; selected: string; onSelect: (label: string) => void; label: string }) {
  return <nav aria-label={label} className="overflow-x-auto"><div className="inline-flex items-center rounded-full border border-background-200 bg-background-50 p-1">{labels.map(name => <button type="button" key={name} aria-current={selected === name ? 'page' : undefined} className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${selected === name ? 'bg-primary-500 text-background-50' : 'text-foreground-600 hover:text-foreground-950'}`} onClick={() => onSelect(name)}>{name}</button>)}</div></nav>;
}
