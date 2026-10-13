import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Download, X } from 'lucide-react';
import { advancedAdminInclusionReportPdf, type AdvancedAdminInclusionReport, type AdvancedAdminLearner } from '@/api/advancedAdmin';

type Tab = 'overview' | 'findings' | 'support' | 'actions' | 'brief';

const sectionKeys: Record<string, string> = {
  technology_anxiety_digital_access: 'Technology',
  visual_hearing_accessibility: 'Visual and hearing',
  dyslexia: 'Dyslexia',
  adhd: 'ADHD',
  social_anxiety: 'Social anxiety',
  mood_learning_capacity: 'Mood and learning',
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function entries(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function savedText(value: unknown, fallback = 'Not recorded'): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function savedNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function dateLabel(value: unknown): string {
  if (typeof value !== 'string' || !value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(date);
}

function riskTone(value: unknown): { badge: string; card: string; bar: string } {
  const risk = String(value || '').trim().toLowerCase();
  if (['high', 'very high', 'critical', 'red'].includes(risk)) return {
    badge: 'bg-red-50 text-red-800', card: 'border-red-200 bg-red-50/60', bar: 'bg-red-500',
  };
  if (['moderate', 'medium', 'amber'].includes(risk)) return {
    badge: 'bg-amber-50 text-amber-800', card: 'border-amber-200 bg-amber-50/60', bar: 'bg-amber-500',
  };
  if (['low', 'green'].includes(risk)) return {
    badge: 'bg-emerald-50 text-emerald-800', card: 'border-emerald-200 bg-emerald-50/60', bar: 'bg-emerald-500',
  };
  return { badge: 'bg-slate-100 text-slate-700', card: 'border-slate-200 bg-slate-50', bar: 'bg-slate-400' };
}

function percentage(value: unknown): number | null {
  const number = savedNumber(value);
  return number === null ? null : Math.max(0, Math.min(100, number));
}

function DetailList({ title, value }: { title: string; value: unknown }) {
  const items = entries(value).filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));
  if (!items.length) return null;
  return <section className="rounded-2xl border border-primary-100 bg-white p-4">
    <h4 className="font-semibold text-primary-950">{title}</h4>
    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-foreground-700">{items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
  </section>;
}

function ActionsTable({ actions }: { actions: unknown[] }) {
  if (!actions.length) return <p className="rounded-2xl bg-white p-5 text-sm text-foreground-600">No actions recorded in this report.</p>;
  return <div className="overflow-x-auto rounded-2xl border border-primary-100 bg-white">
    <table className="w-full min-w-[620px] text-left text-sm">
      <thead className="bg-primary-50 text-xs uppercase text-primary-700"><tr>
        <th scope="col" className="px-4 py-3">Priority</th><th scope="col" className="px-4 py-3">Action</th>
        <th scope="col" className="px-4 py-3">Owner</th><th scope="col" className="px-4 py-3">Due</th>
      </tr></thead>
      <tbody className="divide-y divide-primary-100">{actions.map((entry, index) => {
        const action = object(entry);
        return <tr key={index}><td className="px-4 py-3 font-semibold text-primary-800">{savedText(action.priority, '—')}</td>
          <td className="px-4 py-3 text-primary-950">{savedText(action.action)}</td>
          <td className="px-4 py-3">{savedText(action.owner)}</td><td className="px-4 py-3">{savedText(action.due)}</td></tr>;
      })}</tbody>
    </table>
  </div>;
}

function SectionReport({ title, value }: { title: string; value: unknown }) {
  const report = object(value);
  const score = object(report.score);
  const summaries = object(report.summaries);
  const findings = object(report.findings);
  const answers = entries(report.answers);
  const adjusted = percentage(score.adjustedPercentage ?? score.percentage);
  return <div className="space-y-4">
    <section className="rounded-2xl bg-white p-5">
      <h4 className="text-lg font-bold text-primary-950">{title}</h4>
      <p className="mt-2 text-sm text-foreground-700">Saved score: {savedNumber(score.total) ?? '—'} / {savedNumber(score.max) ?? '—'} · {savedText(score.riskLevel)} risk{adjusted !== null ? ` · ${adjusted}% adjusted` : ''}</p>
      {typeof summaries.coach === 'string' && summaries.coach && <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-foreground-700">{summaries.coach}</p>}
      {typeof summaries.screeningOnlyNote === 'string' && summaries.screeningOnlyNote && <p className="mt-3 text-xs text-foreground-500">{summaries.screeningOnlyNote}</p>}
    </section>
    <div className="grid gap-3 md:grid-cols-2">
      <DetailList title="Main indicators" value={findings.mainIndicators} />
      <DetailList title="Recommended adjustments" value={findings.recommendedAdjustments} />
    </div>
    {entries(findings.recommendedActions).length > 0 && <section><h4 className="mb-3 font-semibold text-primary-950">Recommended actions</h4><ActionsTable actions={entries(findings.recommendedActions)} /></section>}
    {answers.length > 0 && <details className="rounded-2xl border border-primary-100 bg-white p-4"><summary className="cursor-pointer font-semibold text-primary-950">Screening responses ({answers.length})</summary>
      <div className="mt-4 space-y-2">{answers.map((entry, index) => {
        const answer = object(entry);
        return <div key={index} className="rounded-xl bg-primary-50 p-3 text-sm"><p className="font-medium text-primary-950">{savedText(answer.questionText, `Question ${index + 1}`)}</p><p className="mt-1 text-foreground-700">{savedText(answer.selectedLabel, savedText(answer.selectedValue))}</p></div>;
      })}</div>
    </details>}
  </div>;
}

function ReportNotes({ report }: { report: AdvancedAdminInclusionReport }) {
  if (!report.notes.length && !report.evidence.length) return null;
  return <section className="rounded-2xl bg-white p-5"><h4 className="font-semibold text-primary-950">Notes and evidence</h4>
    <div className="mt-3 grid gap-4 md:grid-cols-2"><div><h5 className="text-sm font-semibold">Notes</h5>
      {report.notes.length ? <ul className="mt-2 space-y-2">{report.notes.map(note => <li key={note.id} className="rounded-xl bg-primary-50 p-3 text-sm"><p className="whitespace-pre-wrap">{note.note}</p><p className="mt-2 text-xs text-foreground-500">{note.createdBy} · {dateLabel(note.createdAt)}</p></li>)}</ul> : <p className="mt-2 text-sm text-foreground-500">None recorded.</p>}
    </div><div><h5 className="text-sm font-semibold">Evidence</h5>
      {report.evidence.length ? <ul className="mt-2 space-y-2">{report.evidence.map(file => <li key={file.id} className="text-sm">{file.url ? <a className="text-primary-700 underline" href={file.url} target="_blank" rel="noopener noreferrer">{file.fileName}</a> : file.fileName}</li>)}</ul> : <p className="mt-2 text-sm text-foreground-500">None recorded.</p>}
    </div></div>
  </section>;
}

function Overview({ report, learner, onOpenSection }: { report: AdvancedAdminInclusionReport; learner: AdvancedAdminLearner; onOpenSection: (id: string) => void }) {
  const overview = object(report.overview);
  const header = object(report.reportHeader);
  const contacts = object(header.contacts);
  const roadmap = entries(report.riskRoadmap).map(object);
  const timeline = object(report.reviewTimeline);
  const raw = percentage(overview.rawPercentage);
  const score = savedNumber(overview.overallScore);
  const maxScore = savedNumber(overview.overallMaxScore);
  const risk = savedText(report.riskLevel ?? overview.overallRiskLevel);
  const supportFlags = [
    ['digitalSupportNeeded', 'Digital support'], ['assignmentSupportNeeded', 'Assignment support'],
    ['communicationSupportNeeded', 'Communication support'], ['accessibilityAdjustmentsNeeded', 'Accessibility adjustments'],
    ['wellbeingReviewNeeded', 'Wellbeing review'], ['specialistScreeningNeeded', 'Specialist screening'],
    ['urgentReviewNeeded', 'Urgent review'],
  ].filter(([key]) => overview[key] === true).map(([, label]) => label);
  const summary = savedText(report.executiveSummary, 'No executive summary recorded.');
  const info: Array<[string, string]> = [
    ['Programme', report.programme || learner.programme], ['Organisation', report.organisation],
    ['Coach', report.coach || learner.coach], ['Manager', savedText(contacts.managerName)],
    ['Sections completed', `${savedNumber(overview.completedReportsCount) ?? '—'} / ${savedNumber(overview.expectedReportsCount) ?? '—'}`],
    ['Generated', dateLabel(header.generatedAt ?? report.createdAt)],
  ];
  return <div className="space-y-4">
    <div className="grid gap-4 md:grid-cols-[245px_1fr]">
      <section className="flex flex-col items-center justify-center rounded-2xl bg-white p-5 text-center">
        <div className="flex h-28 w-28 items-center justify-center rounded-full p-2" style={{ background: `conic-gradient(#5aaa7b ${raw ?? 0}%, #e8e3f1 0)` }}>
          <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-white"><span className="text-xl font-bold text-primary-950">{score ?? '—'}</span><span className="text-xs text-primary-600">/ {maxScore ?? '—'}</span><span className="mt-1 text-xs font-semibold text-emerald-700">{raw === null ? '—' : `${raw}%`}</span></div>
        </div>
        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-primary-700">Overall score</p>
        <p className="mt-1 text-sm font-semibold text-primary-950">{risk} Risk Profile</p>
      </section>
      <section className="rounded-2xl bg-white p-5"><div className="grid gap-3 sm:grid-cols-3">{info.map(([label, value]) => <div key={label} className="rounded-xl bg-primary-50 p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-primary-700">{label}</p><p className="mt-1 text-xs font-semibold text-primary-950">{value || 'Not recorded'}</p></div>)}</div>
        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-primary-700">Support required</p>
        <div className="mt-2 flex flex-wrap gap-2">{supportFlags.length ? supportFlags.map(label => <span key={label} className="rounded-full bg-primary-950 px-3 py-1 text-xs font-semibold text-white">{label}</span>) : <span className="text-sm text-foreground-600">No support requirement flagged.</span>}</div>
      </section>
    </div>

    <section className="rounded-2xl bg-white p-5"><h4 className="font-semibold text-primary-950">Risk Roadmap</h4>
      {roadmap.length ? <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{roadmap.map((item, index) => {
        const sectionId = savedText(item.sectionId, '');
        const source = report.sections[sectionKeys[sectionId]];
        const adjusted = percentage(item.adjustedPercentage);
        const tone = riskTone(item.riskLevel);
        return <article key={`${sectionId}-${index}`} className={`rounded-xl border p-3 ${tone.card}`}>
          <div className="flex items-start justify-between gap-2"><div><h5 className="text-xs font-bold text-primary-950">{savedText(item.label, 'Screening area')}</h5><p className="mt-1 text-xs text-emerald-700">{savedText(item.riskLevel)} risk</p></div>
            {source && <button type="button" onClick={() => onOpenSection(sectionId)} className="shrink-0 rounded-full border border-primary-200 bg-white px-2 py-1 text-[10px] font-semibold text-primary-800 hover:bg-primary-50">View Report</button>}
          </div>
          <div className="mt-5 flex items-end justify-between text-xs"><span className="font-bold text-primary-950">{savedNumber(item.score) ?? '—'}</span><span className="text-primary-600">/ {savedNumber(item.maxScore) ?? '—'}</span></div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white"><div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${adjusted ?? 0}%` }} /></div>
          <p className="mt-1 text-right text-[10px] text-primary-700">{adjusted === null ? 'Not recorded' : `${adjusted}%`}</p>
        </article>;
      })}</div> : <p className="mt-3 text-sm text-foreground-600">No risk roadmap recorded.</p>}
    </section>
    <section className="rounded-2xl bg-white p-5"><h4 className="font-semibold text-primary-950">Executive Summary</h4><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-primary-900">{summary}</p></section>
    {Object.keys(timeline).length > 0 && <section className="rounded-2xl bg-white p-5"><h4 className="font-semibold text-primary-950">Review Timeline</h4><div className="mt-3 grid gap-3 sm:grid-cols-3">{([
      ['Initial review', timeline.initialReview], ['Follow-up review', timeline.followUpReview], ['Next formal review', timeline.nextFormalReview],
    ] as const).map(([label, value]) => <div key={label} className="rounded-xl bg-primary-50 p-3"><p className="text-xs font-semibold text-primary-700">{label}</p><p className="mt-2 text-sm text-primary-950">{savedText(value)}</p></div>)}</div></section>}
    <ReportNotes report={report} />
  </div>;
}

export default function InclusionReportDialog({ learnerId, learner, report, onClose }: {
  learnerId: number; learner: AdvancedAdminLearner; report: AdvancedAdminInclusionReport; onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const [sectionId, setSectionId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); return; }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'))
      .filter(element => element.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function selectTab(value: Tab) { setTab(value); setSectionId(null); bodyRef.current?.scrollTo?.(0, 0); }
  const findings = entries(report.keyFindings);
  const actions = entries(report.priorityActions);
  const risk = savedText(report.riskLevel ?? object(report.overview).overallRiskLevel);
  const header = object(report.reportHeader);
  const roadmap = entries(report.riskRoadmap).map(object);
  const selectedArea = roadmap.find(item => item.sectionId === sectionId);
  const sectionTitle = savedText(selectedArea?.label, 'Screening report');
  const sectionData = sectionId ? report.sections[sectionKeys[sectionId]] : null;
  const tabs: Array<[Tab, string]> = [
    ['overview', 'Overview'], ['findings', `Findings (${findings.length})`], ['support', 'Support Plan'],
    ['actions', `Actions (${actions.length})`], ['brief', 'Manager Brief'],
  ];

  return createPortal(<div className="fixed inset-0 z-[1000] flex items-center justify-center bg-[#100a22]/65 p-2 backdrop-blur-[2px] sm:p-5" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="inclusion-report-title" onKeyDown={handleKeyDown} className="flex max-h-[min(94vh,1100px)] w-full max-w-[820px] flex-col overflow-hidden rounded-[22px] bg-[#f8f6fc] shadow-2xl">
      <header className="flex flex-wrap items-start justify-between gap-3 bg-[#251557] px-5 py-4 text-white">
        <div><div className="flex flex-wrap items-center gap-2"><h3 id="inclusion-report-title" className="text-lg font-bold">{learner.name}</h3><span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${riskTone(risk).badge}`}>{risk} Risk</span></div>
          <p className="mt-1 text-xs text-[#d7cdf2]">{learner.email || 'Email not recorded'}</p>
          <p className="mt-2 text-[11px] text-[#d7cdf2]">{report.programme || learner.programme} · {report.organisation || 'Organisation not recorded'} · Generated {dateLabel(header.generatedAt ?? report.createdAt)}</p>
        </div>
        <div className="flex items-center gap-2"><a href={advancedAdminInclusionReportPdf(learnerId, report.id)} className="inline-flex items-center gap-2 rounded-lg border border-white/25 bg-white/15 px-3 py-2 text-xs font-semibold text-white hover:bg-white/25"><Download size={14} />Download PDF</a>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close report" className="rounded-lg p-2 text-white hover:bg-white/15"><X size={18} /></button>
        </div>
      </header>
      <nav role="tablist" aria-label="Inclusion report sections" className="flex shrink-0 gap-1 overflow-x-auto border-b border-primary-100 bg-white px-4 py-2">{tabs.map(([value, label]) => <button key={value} type="button" role="tab" id={`inclusion-tab-${value}`} aria-selected={tab === value} aria-controls="inclusion-report-panel" onClick={() => selectTab(value)} className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold ${tab === value ? 'bg-[#251557] text-white' : 'text-primary-700 hover:bg-primary-50'}`}>{label}</button>)}</nav>
      <div ref={bodyRef} id="inclusion-report-panel" role="tabpanel" aria-labelledby={`inclusion-tab-${tab}`} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
        {sectionId && sectionData ? <><button type="button" onClick={() => { setSectionId(null); bodyRef.current?.scrollTo?.(0, 0); }} className="inline-flex items-center gap-2 text-sm font-semibold text-primary-800 hover:underline"><ArrowLeft size={15} />Back to Overview</button><SectionReport title={sectionTitle} value={sectionData} /></>
          : tab === 'overview' ? <Overview report={report} learner={learner} onOpenSection={id => { setSectionId(id); bodyRef.current?.scrollTo?.(0, 0); }} />
            : tab === 'findings' ? <div className="space-y-3">{findings.length ? findings.map((entry, index) => { const item = object(entry); const tone = riskTone(item.riskLevel); return <article key={index} className={`rounded-2xl border p-5 ${tone.card}`}><div className="flex flex-wrap items-center gap-2"><h4 className="font-bold text-primary-950">{savedText(item.area, `Finding ${index + 1}`)}</h4><span className={`rounded-full px-2 py-1 text-xs font-semibold ${tone.badge}`}>{savedText(item.riskLevel)} risk</span></div><p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground-700">{savedText(item.finding)}</p><p className="mt-3 text-sm font-semibold text-primary-900">Recommended response</p><p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground-700">{savedText(item.recommendedResponse)}</p></article>; }) : <p className="rounded-2xl bg-white p-5 text-sm">No findings recorded.</p>}</div>
              : tab === 'support' ? <div className="grid gap-3 md:grid-cols-2">{([
                ['Digital support', 'digitalSupport'], ['Learning support', 'learningSupport'], ['Wellbeing support', 'wellbeingSupport'],
                ['Assignment support', 'assignmentSupport'], ['Communication support', 'communicationSupport'], ['Accessibility adjustments', 'accessibilityAdjustments'],
              ] as const).map(([title, key]) => <DetailList key={key} title={title} value={object(report.supportPlan)[key]} />)}
                {!Object.values(object(report.supportPlan)).some(value => entries(value).length) && <p className="rounded-2xl bg-white p-5 text-sm">No support plan recorded.</p>}
              </div>
                : tab === 'actions' ? <ActionsTable actions={actions} />
                  : <div className="space-y-3">{(() => { const brief = object(report.managerBrief); return <>
                    {typeof brief.oneLineStatus === 'string' && brief.oneLineStatus && <section className="rounded-2xl bg-white p-5"><h4 className="font-semibold text-primary-950">Status</h4><p className="mt-2 text-sm leading-relaxed">{brief.oneLineStatus}</p></section>}
                    <div className="grid gap-3 md:grid-cols-2"><DetailList title="What needs attention" value={brief.whatNeedsAttention} /><DetailList title="What is already in place" value={brief.whatIsAlreadyInPlace} /></div>
                    {typeof brief.recommendedNextStep === 'string' && brief.recommendedNextStep && <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><h4 className="font-semibold text-primary-950">Recommended next step</h4><p className="mt-2 text-sm leading-relaxed">{brief.recommendedNextStep}</p></section>}
                    {typeof report.professionalNote === 'string' && report.professionalNote && <p className="text-xs text-foreground-500">{report.professionalNote}</p>}
                    {!Object.keys(brief).length && <p className="rounded-2xl bg-white p-5 text-sm">No manager brief recorded.</p>}
                  </>; })()}</div>}
      </div>
    </div>
  </div>, document.body);
}
