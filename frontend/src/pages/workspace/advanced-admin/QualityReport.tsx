import { Fragment, type ReactNode } from 'react';
import type { AdvancedAdminQuality } from '@/api/advancedAdmin';

type Detail = { key: string; title: string; evidence: string | null; clips: number; type: string | null };

function reportDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

function details(value: unknown): Detail[] {
  if (value == null || value === '') return [];
  const entries = Array.isArray(value) ? value.map((item, index) => [String(index + 1), item] as const)
    : typeof value === 'object' ? Object.entries(value) : [['1', value]];
  return entries.map(([key, item]) => {
    const record = item && typeof item === 'object' && !Array.isArray(item)
      ? item as Record<string, unknown> : null;
    return {
      key, title: String(record?.title || (typeof item === 'string' ? item : key.replace(/_/g, ' '))),
      evidence: typeof record?.evidence === 'string' ? record.evidence : null,
      clips: Array.isArray(record?.evidence_clips) ? record.evidence_clips.length : 0,
      type: typeof record?.type === 'string' ? record.type : null,
    };
  });
}

function statusTone(status: string) {
  const value = status.toLowerCase();
  if (value === 'met') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (value.includes('partial')) return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-rose-200 bg-rose-50 text-rose-800';
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
    <h4 className="mb-3 text-sm font-semibold text-slate-900">{title}</h4>{children}
  </section>;
}

function EvidenceDetails({ value, tone }: { value: unknown; tone: 'green' | 'amber' | 'violet' }) {
  const items = details(value);
  if (!items.length) return <span className="text-slate-500">Not recorded</span>;
  const palette = {
    green: 'border-emerald-200 bg-emerald-50/60',
    amber: 'border-amber-200 bg-amber-50/60',
    violet: 'border-violet-200 bg-violet-50/60',
  }[tone];
  return <div className="space-y-2">{items.map((item, index) => <div key={`${item.key}-${index}`}
    className={`rounded-lg border p-3 ${palette}`}>
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">{item.type || `${tone === 'green' ? 'Strength' : tone === 'amber' ? 'Area' : 'KSB'} ${index + 1}`}</p>
    <p className="mt-1 font-semibold text-slate-900">{item.title}</p>
    {item.evidence && <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-slate-700">{item.evidence}</p>}
    {item.clips > 0 && <p className="mt-2 text-xs font-semibold text-primary-700">Evidence clips: {item.clips}</p>}
  </div>)}</div>;
}

function KsbCoverage({ value }: { value: unknown }) {
  const items = details(value);
  if (!items.length) return <span className="text-slate-500">Not recorded</span>;
  return <div className="overflow-x-auto rounded-lg border border-violet-100">
    <table className="w-full min-w-[390px] border-collapse text-left text-xs">
      <thead className="bg-violet-50 text-primary-700"><tr><th scope="col" className="w-[40%] p-2">Title</th>
        <th scope="col" className="p-2">Evidence</th></tr></thead>
      <tbody>{items.map((item, index) => <Fragment key={`${item.key}-${index}`}>
        {item.type && item.type !== items[index - 1]?.type && <tr className="bg-slate-50">
          <th colSpan={2} scope="rowgroup" className="border-t border-violet-100 p-2 font-semibold">{item.type}</th></tr>}
        <tr className="align-top"><th scope="row" className="border-t border-violet-100 p-2 font-normal">{item.title}</th>
          <td className="whitespace-pre-wrap break-words border-t border-violet-100 p-2">
            {item.evidence || 'Not recorded'}
            {item.clips > 0 && <span className="mt-2 block font-semibold text-primary-700">Clips: {item.clips}</span>}
          </td></tr>
      </Fragment>)}</tbody>
    </table>
  </div>;
}

function ChecklistCounts({ report }: { report: AdvancedAdminQuality }) {
  const counts = [
    ['Pass', report.metCount, 'bg-emerald-100 text-emerald-800'],
    ['Partial', report.partialCount, 'bg-amber-100 text-amber-800'],
    ['Not Met', report.notMetCount, 'bg-rose-100 text-rose-800'],
  ] as const;
  return <div className="flex flex-wrap gap-2">{counts.map(([label, count, tone]) => count != null &&
    <span key={label} className={`rounded-md px-2 py-1 text-xs font-semibold ${tone}`}>{label}: {count}</span>)}</div>;
}

function ChecklistItems({ report }: { report: AdvancedAdminQuality }) {
  return <div className="space-y-2">
    {(['Met', 'Partially Met', 'Not Met'] as const).map(status => {
      const items = report.checklist?.filter(item => item.status?.toLowerCase() === status.toLowerCase()) || [];
      if (!items.length) return null;
      return <div key={status} className={`rounded-lg border p-2 text-xs ${statusTone(status)}`}>
        <p className="font-semibold">{status === 'Met' ? 'Pass' : status} Items</p>
        <ul className="mt-1 space-y-1">{items.map(item => <li key={`${item.order}-${item.item}`}>{item.item}</li>)}</ul>
      </div>;
    })}
  </div>;
}

export default function QualityReport({ report }: { report: AdvancedAdminQuality }) {
  const categories: { label: string; evaluation: ReactNode; comments: ReactNode }[] = [
    { label: 'Duration Score', evaluation: report.durationScore ?? '–', comments: '–' },
    { label: 'KSBs Covered', evaluation: `${details(report.ksbCoverage).length} KSB items`,
      comments: <KsbCoverage value={report.ksbCoverage} /> },
    { label: 'Quality of Teaching', evaluation: report.rating ?? '–', comments: report.comments || '–' },
    { label: 'Learner Engagement', evaluation: report.engagementScore ?? '–', comments: '–' },
    { label: 'QA Checklist', evaluation: <ChecklistCounts report={report} />,
      comments: <ChecklistItems report={report} /> },
    { label: 'Strengths', evaluation: '–', comments: <EvidenceDetails value={report.strengths} tone="green" /> },
  ];
  return <article className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-900 sm:p-6">
    <header className="mb-5 flex items-center gap-3">
      <img src="/assets/kbc-logo.png" alt="Kent Business College" className="h-9 w-auto object-contain" />
      <h3 className="text-base font-semibold">QA Observation Report</h3>
      <span className="ml-auto rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-primary-800">
        {report.source === 'tutor' ? 'Tutor quality' : 'Lecture quality'}
      </span>
    </header>
    <div className="space-y-5 rounded-xl border border-slate-200 p-4 sm:p-5">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 leading-7">
        <p><strong>Session:</strong> {report.subject || 'Not recorded'}{report.date && ` - ${reportDate(report.date)}`}</p>
        <p><strong>Trainer:</strong> {report.trainer || 'Not recorded'}</p>
        <p><strong>Duration:</strong> {report.duration || 'Not recorded'}</p>
        {(report.learnersEnrolled != null || report.learnersAttended != null) &&
          <p><strong>Learners:</strong> {report.learnersEnrolled ?? '–'} enrolled | {report.learnersAttended ?? '–'} attendance</p>}
        {report.module && <p><strong>Module:</strong> {report.module}</p>}
      </div>
      {report.observationState && <div className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 font-semibold text-primary-800">
        Observation State: <span className={report.observationState === 'Observed' ? 'text-emerald-700' : 'text-amber-700'}>{report.observationState}</span>
      </div>}
      <Card title="QA Observation">
        {report.rating != null && <div className="mb-3 rounded-lg border border-violet-200 bg-violet-50 p-3 text-primary-800">
          <p className="text-[11px] uppercase tracking-wide">Teaching Quality Rating</p>
          <strong className="mt-1 block text-2xl">{report.rating}</strong>
        </div>}
        {report.judgement && <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Overall Judgement</p>
          <p className="whitespace-pre-wrap leading-6">{report.judgement}</p>
        </div>}
        {report.comments && <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Teaching Quality Comment</p>
          <p className="whitespace-pre-wrap leading-6">{report.comments}</p>
        </div>}
        <h5 className="mb-2 font-semibold">Areas for Development</h5>
        <EvidenceDetails value={report.areasForDevelopment} tone="amber" />
      </Card>
      <Card title="Observation Categories">
        <div className="overflow-x-auto"><table className="w-full min-w-[620px] border-collapse text-left text-xs sm:text-sm">
          <thead className="bg-slate-50 text-slate-700"><tr><th scope="col" className="w-[18%] border border-slate-200 p-2">Category</th>
            <th scope="col" className="w-[16%] border border-slate-200 p-2">Evaluation</th>
            <th scope="col" className="border border-slate-200 p-2">Comments</th></tr></thead>
          <tbody>{categories.map(category => <tr key={category.label} className="align-top">
            <th scope="row" className="border border-slate-200 p-2 font-medium">{category.label}</th>
            <td className="border border-slate-200 p-2">{category.evaluation}</td>
            <td className="whitespace-pre-wrap break-words border border-slate-200 p-2 leading-6">{category.comments}</td>
          </tr>)}</tbody>
        </table></div>
      </Card>
      <Card title="Evidence by Checklist Item">
        {report.checklist?.length ? <div className="space-y-3">{report.checklist.map(item =>
          <section key={`${item.order}-${item.item}`} className={`rounded-xl border p-4 ${statusTone(item.status)}`}>
            <div className="flex items-start justify-between gap-3"><h5 className="font-semibold">{item.item}</h5>
              <span className="shrink-0 rounded-md border border-current px-2 py-0.5 text-xs font-semibold">{item.status}</span></div>
            <p className="mt-3 text-[11px] uppercase tracking-wide">Evidence</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-6">{item.evidence || 'Not recorded'}</p>
          </section>)}</div> : <p className="text-slate-500">No checklist evidence recorded.</p>}
      </Card>
    </div>
  </article>;
}
