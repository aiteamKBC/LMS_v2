import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { addDays, formatFullDate } from '@/pages/curriculum/recordings/utils';
import { periodBounds, type Period } from '@/pages/curriculum/recordings/filters';
import { FINDINGS_DATA, INITIAL_SAMPLING_DATA } from '@/pages/qa/qaCalendarSources';

type QAWorkType = 'Sampling' | 'Finding';
interface QAWorkItem {
  id: string;
  type: QAWorkType;
  title: string;
  date: string;
  owner: string;
  status: string;
  summary: string;
  details: string[];
  href: string;
  tone: string;
}

const demoDate = (value: string) => {
  const match = value.match(/^(\d{1,2})\s+([A-Za-z]{3})/);
  if (!match) return '';
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(match[2]);
  return month < 0 ? '' : `2026-${String(month + 1).padStart(2, '0')}-${String(Number(match[1])).padStart(2, '0')}`;
};

const items: QAWorkItem[] = [
  ...INITIAL_SAMPLING_DATA.map(sample => ({
    id: `sampling:${sample.id}`, type: 'Sampling' as const, title: `${sample.type} sampling`, date: demoDate(sample.startDate),
    owner: sample.officer === '—' ? 'QA Team' : sample.officer, status: sample.status,
    summary: `${sample.sampled} of ${sample.total} items · ${sample.scope}`,
    details: [`Scope: ${sample.scope}`, `Coverage: ${sample.sampled} of ${sample.total} items (${sample.percentage}%)`, `Period: ${sample.startDate} – ${sample.endDate}`, `Methodology: ${sample.methodology}`, `Status: ${sample.status}`],
    href: '/qa/sampling', tone: 'border-l-primary-500 bg-primary-50',
  })),
  ...FINDINGS_DATA.map(finding => ({
    id: `finding:${finding.id}`, type: 'Finding' as const, title: finding.title, date: demoDate(finding.date),
    owner: finding.owner, status: `${finding.severity} · ${finding.status}`,
    summary: `${finding.category} · Due ${finding.dueDate}`,
    details: [`Category: ${finding.category}`, `Severity: ${finding.severity}`, `Status: ${finding.status}`, `Raised by: ${finding.raisedBy}`, `Description: ${finding.description}`, `Action plan: ${finding.actionPlan}`, `Due: ${finding.dueDate}`],
    href: '/qa/findings', tone: 'border-l-red-500 bg-red-50',
  })),
];

function WorkDetails({ item, onClose }: { item: QAWorkItem; onClose: () => void }) {
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-foreground-950/35 p-4" role="dialog" aria-modal="true" aria-label={`${item.type} details`} onMouseDown={onClose}>
    <div className="w-full max-w-lg rounded-2xl border border-background-200 bg-background-50 p-5 shadow-2xl" onMouseDown={event => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-wider text-primary-600">{item.type}</p><h2 className="mt-1 text-lg font-heading font-semibold text-foreground-900">{item.title}</h2></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-foreground-500 hover:bg-background-100" aria-label="Close details"><AppIcon className="ri-close-line" /></button></div>
      <div className="mt-4 grid gap-2 rounded-xl bg-background-100 p-3 text-xs text-foreground-700 sm:grid-cols-2"><p><span className="font-semibold">Date:</span> {formatFullDate(item.date)}</p><p><span className="font-semibold">Owner:</span> {item.owner}</p><p><span className="font-semibold">Status:</span> {item.status}</p><p><span className="font-semibold">Summary:</span> {item.summary}</p></div>
      <ul className="mt-4 space-y-2 text-sm text-foreground-700">{item.details.map(detail => <li key={detail} className="rounded-lg border border-background-200 bg-white px-3 py-2">{detail}</li>)}</ul>
      <Link to={item.href} onClick={onClose} className="mt-5 inline-flex rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-700">Open source page</Link>
    </div>
  </div>;
}

function WorkButton({ item, onClick }: { item: QAWorkItem; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`w-full rounded-lg border-l-4 p-3 text-left text-xs transition hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 ${item.tone}`}>
    <span className="block font-semibold">{item.type}</span><span className="mt-1 block font-bold">{item.title}</span><span className="mt-1 block">{item.owner} · {item.status}</span><span className="mt-1 block text-foreground-600">{item.summary}</span><span className="mt-2 block font-semibold text-primary-700">View details</span>
  </button>;
}

export default function QAWorkCalendar({ date, period }: { date: string; period: Period }) {
  const [selected, setSelected] = useState<QAWorkItem | null>(null);
  const bounds = periodBounds(date, period);
  const visible = useMemo(() => items.filter(item => item.date && item.date >= bounds.start && item.date <= bounds.end), [bounds.end, bounds.start]);
  if (!visible.length) return null;

  const days = period === 'day' ? [date] : period === 'month' ? visible.map(item => item.date).filter((value, index, all) => all.indexOf(value) === index).sort() : Array.from({ length: period === 'workWeek' ? 5 : 7 }, (_, index) => addDays(bounds.start, index));
  return <section aria-label="Sampling and findings calendar" className="mt-4 rounded-xl border border-background-200 bg-white p-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="text-base font-bold">Sampling &amp; Findings</h2><p className="mt-1 text-xs text-foreground-600">QA work items for the selected {period === 'day' ? 'day' : 'period'}.</p></div><span className="rounded-full bg-background-100 px-3 py-1 text-xs font-semibold text-foreground-600">{visible.length} item{visible.length === 1 ? '' : 's'}</span></div>
    <div className={`mt-4 grid gap-3 ${period === 'day' ? 'grid-cols-1' : 'md:grid-cols-2 lg:grid-cols-3'}`}>{days.map(day => { const dayItems = visible.filter(item => item.date === day); return <div key={day} className="rounded-lg border border-background-200 p-3"><p className="mb-3 text-xs font-bold text-foreground-700">{formatFullDate(day)}</p>{dayItems.length ? <div className="space-y-2">{dayItems.map(item => <WorkButton key={item.id} item={item} onClick={() => setSelected(item)} />)}</div> : <p className="text-xs text-foreground-400">No sampling or findings.</p>}</div>; })}</div>
    {selected && <WorkDetails item={selected} onClose={() => setSelected(null)} />}
  </section>;
}
