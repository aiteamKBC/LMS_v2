import { useEffect, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { AppIcon } from '@/components/feature/AppIcon';
import { roleNavMap } from '@/mocks/navigation';
import { feedbackApi, type FeedbackResponse } from '@/api/feedback';
import { qaFindingsApi, type FeedbackFinding, type FeedbackFindingPatch } from '@/api/qaFindings';
import { FormRenderer } from '@/features/feedback/FormRenderer';
import { TIME_ZONE_LABEL } from '@/pages/curriculum/recordings/utils';

const qaNav = roleNavMap.qa;

const severityConfig: Record<string, { bg: string; text: string; border: string }> = {
  Critical: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300' },
  Major: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-300' },
  Minor: { bg: 'bg-primary-100', text: 'text-primary-700', border: 'border-primary-300' },
  Observation: { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-300' },
};

const statusConfig: Record<string, { bg: string; text: string }> = {
  Open: { bg: 'bg-red-100', text: 'text-red-700' },
  'In Progress': { bg: 'bg-primary-100', text: 'text-primary-700' },
  Resolved: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  Closed: { bg: 'bg-foreground-100', text: 'text-foreground-500' },
};

const displayDate = (value: string | null) => value
  ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TIME_ZONE_LABEL }).format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value))
  : 'Not set';

function daysToDue(value: string | null) {
  if (!value) return null;
  const today = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TIME_ZONE_LABEL,
  }).formatToParts(new Date()).map(part => [part.type, Number(part.value)]));
  const [year, month, day] = value.split('-').map(Number);
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(today.year, today.month - 1, today.day)) / 86400000);
}

export default function QAFindingsPage() {
  const [filterSeverity, setFilterSeverity] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [findings, setFindings] = useState<FeedbackFinding[] | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [response, setResponse] = useState<FeedbackResponse | null>(null);
  const [detailError, setDetailError] = useState('');
  const [draft, setDraft] = useState({ actionPlan: '', owner: '', dueDate: '' });
  const [busyId, setBusyId] = useState<number | null>(null);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    let active = true;
    qaFindingsApi.list().then(({ findings: rows }) => {
      if (active) { setFindings(rows); setError(''); }
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'QA findings could not be loaded.');
    });
    return () => { active = false; };
  }, [retry]);

  useEffect(() => {
    if (selectedId === null) { setResponse(null); setDetailError(''); return; }
    let active = true;
    setResponse(null);
    setDetailError('');
    feedbackApi.response(selectedId).then(({ response: saved }) => {
      if (active) setResponse(saved);
    }).catch(reason => {
      if (active) setDetailError(reason instanceof Error ? reason.message : 'Original response could not be loaded.');
    });
    return () => { active = false; };
  }, [selectedId]);

  function openDetails(finding: FeedbackFinding) {
    if (selectedId === finding.id) { setSelectedId(null); return; }
    setDraft({ actionPlan: finding.actionPlan, owner: finding.owner, dueDate: finding.dueDate ?? '' });
    setSaveError('');
    setSelectedId(finding.id);
  }

  async function saveFinding(finding: FeedbackFinding, patch: Omit<FeedbackFindingPatch, 'expectedVersion'>) {
    setBusyId(finding.id);
    setSaveError('');
    try {
      const saved = await qaFindingsApi.update(finding.id, { expectedVersion: finding.version, ...patch });
      setFindings(current => current?.map(item => item.id === finding.id ? saved : item) ?? null);
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : 'Finding could not be saved.');
    } finally {
      setBusyId(null);
    }
  }

  const rows = findings ?? [];
  const filtered = rows.filter(f => {
    const sevMatch = filterSeverity === 'All' || f.severity === filterSeverity;
    const statusMatch = filterStatus === 'All' || f.status === filterStatus;
    return sevMatch && statusMatch;
  });

  const stats = {
    open: rows.filter(f => f.status === 'Open').length,
    inProgress: rows.filter(f => f.status === 'In Progress').length,
    resolved: rows.filter(f => f.status === 'Resolved').length,
    closed: 0,
  };

  return (
    <WorkspaceShell
      role="qa" roleLabel={qaNav.label} navItems={qaNav.items} workspaceLabel={qaNav.workspaceLabel}
      pageTitle="QA Findings" pageSubtitle="Track Neutral and Negative feedback with action plans and resolution tracking"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="QA Findings"
          description={findings ? `${stats.open} open. ${stats.inProgress} in progress. ${stats.resolved} resolved. ${stats.closed} closed.` : 'Loading current feedback findings.'}
          icon="ri-search-eye-line"
          imageUrl="https://readdy.ai/api/search-image?query=Professional%20quality%20audit%20findings%20magnifying%20glass%20inspection%20checklist%20purple%20gold%20accent%20clean%20modern%20minimalist%20editorial%20photography&width=400&height=160&seq=qa-findings-hero&orientation=landscape"
          imageAlt="QA Findings"
          stats={[
            { label: 'Open', value: findings ? String(stats.open) : '—', variant: 'danger' },
            { label: 'In Progress', value: findings ? String(stats.inProgress) : '—' },
            { label: 'Resolved', value: findings ? String(stats.resolved) : '—' },
          ]}
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Open', value: stats.open, icon: 'ri-alert-line', color: 'red' },
            { label: 'In Progress', value: stats.inProgress, icon: 'ri-loader-4-line', color: 'primary' },
            { label: 'Resolved', value: stats.resolved, icon: 'ri-check-line', color: 'emerald' },
            { label: 'Closed', value: stats.closed, icon: 'ri-folder-close-line', color: 'foreground' },
          ].map(s => (
            <div key={s.label} className="coach-metric-card">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.color === 'red' ? 'bg-red-100 text-red-700' : s.color === 'primary' ? 'bg-primary-100 text-primary-700' : s.color === 'emerald' ? 'bg-emerald-100 text-emerald-700' : 'bg-foreground-100 text-foreground-500'}`}>
                <AppIcon className={`${s.icon} text-sm`}></AppIcon>
              </div>
              <p className="text-[10px] text-foreground-400 uppercase tracking-wide font-medium">{s.label}</p>
              <p className="text-xl font-heading font-semibold text-foreground-900">{findings ? s.value : '—'}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-foreground-400">Severity:</span>
          {['All', 'Critical', 'Major', 'Minor', 'Observation'].map(s => (
            <button type="button" key={s} aria-pressed={filterSeverity === s} onClick={() => setFilterSeverity(s)} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${filterSeverity === s ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:text-foreground-700'}`}>{s}</button>
          ))}
          <span className="text-[12px] text-foreground-400 ml-2">Status:</span>
          {['All', 'Open', 'In Progress', 'Resolved', 'Closed'].map(s => (
            <button type="button" key={s} aria-pressed={filterStatus === s} onClick={() => setFilterStatus(s)} className={`px-3 py-1 rounded-full text-[11px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${filterStatus === s ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-500 hover:text-foreground-700'}`}>{s}</button>
          ))}
        </div>

        {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error} <button type="button" className="underline" onClick={() => { setError(''); setFindings(null); setRetry(value => value + 1); }}>Retry</button></div> : null}
        {!findings && !error ? <p role="status" className="p-6 text-sm text-foreground-600">Loading QA findings…</p> : null}
        {findings && !filtered.length ? <p className="rounded-xl border border-background-200 p-6 text-sm text-foreground-600">No findings match these filters.</p> : null}
        {saveError ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{saveError}</p> : null}

        <div className="space-y-3">
          {filtered.map(finding => (
            <div key={finding.id} className={`bg-background-50 rounded-xl border border-foreground-200/60 p-5 card-premium border-l-2 ${severityConfig[finding.severity].border}`}>
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${severityConfig[finding.severity].bg} ${severityConfig[finding.severity].text}`}>{finding.severity}</span>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${statusConfig[finding.status].bg} ${statusConfig[finding.status].text}`}>{finding.status}</span>
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-500">{finding.category}</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-foreground-400">{displayDate(finding.submittedAt)}</span>
                  {finding.status !== 'Resolved' && daysToDue(finding.dueDate) !== null ? <span className={`text-[10px] font-medium ml-2 ${(daysToDue(finding.dueDate) ?? 0) <= 5 ? 'text-red-600' : 'text-emerald-600'}`}>{(daysToDue(finding.dueDate) ?? 0) < 0 ? `${Math.abs(daysToDue(finding.dueDate) ?? 0)}d overdue` : `${daysToDue(finding.dueDate)}d left`}</span> : null}
                </div>
              </div>
              <h4 className="text-sm font-semibold text-foreground-900 mb-1">{finding.title}</h4>
              <p className="text-[11px] text-foreground-400 mb-1">Raised by: {finding.raisedBy} &middot; Owner: {finding.owner || 'Unassigned'} &middot; Due: {displayDate(finding.dueDate)}</p>
              <p className="text-[12px] text-foreground-600 leading-relaxed mb-3">{finding.classification === 'negative' ? 'Negative' : 'Neutral'} feedback response &middot; {finding.respondent}{finding.groupName ? ` · ${finding.groupName}` : ''}{finding.score === null ? '' : ` · ${Math.round(finding.score)}%`}. Review the original answers to decide what action is needed.</p>
              <div className="bg-primary-50/50 rounded-lg p-3 mb-3">
                <p className="text-[11px] text-primary-700 leading-relaxed">
                  <strong>Action Plan:</strong> {finding.actionPlan || 'No action plan recorded.'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {finding.status === 'Open' && (
                  <button type="button" disabled={busyId === finding.id} onClick={() => void saveFinding(finding, { status: 'In Progress' })} className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-50">Start Action</button>
                )}
                {finding.status === 'In Progress' && (
                  <button type="button" disabled={busyId === finding.id} onClick={() => void saveFinding(finding, { status: 'Resolved' })} className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-[10px] font-semibold hover:bg-emerald-600 transition-smooth cursor-pointer whitespace-nowrap disabled:opacity-50">Mark Resolved</button>
                )}
                <button type="button" aria-expanded={selectedId === finding.id} onClick={() => openDetails(finding)} className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[10px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">{selectedId === finding.id ? 'Hide Details' : 'View Details'}</button>
              </div>
              {selectedId === finding.id ? <div className="mt-4 border-t border-background-200 pt-4 space-y-3" aria-label={`Finding details: ${finding.title}`}>
                <h5 className="text-sm font-semibold">Original feedback response</h5>
                {detailError ? <p role="alert" className="text-xs text-red-700">{detailError}</p> : null}
                {!response && !detailError ? <p role="status" className="text-xs">Loading answers…</p> : null}
                {response ? <FormRenderer sections={response.sections || []} answers={Object.fromEntries((response.sections || []).flatMap(section => section.questions.map(question => [String(question.id), question.answer ?? null])))} readOnly /> : null}
                <label className="block text-xs font-medium">Action Plan<textarea aria-label="Action Plan" value={draft.actionPlan} maxLength={10000} onChange={event => setDraft(current => ({ ...current, actionPlan: event.target.value }))} className="mt-1 block w-full rounded-lg border border-background-300 p-2" rows={3} /></label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-xs font-medium">Owner<input aria-label="Owner" value={draft.owner} maxLength={255} onChange={event => setDraft(current => ({ ...current, owner: event.target.value }))} className="mt-1 block w-full rounded-lg border border-background-300 p-2" /></label>
                  <label className="block text-xs font-medium">Due date<input aria-label="Due date" type="date" value={draft.dueDate} onChange={event => setDraft(current => ({ ...current, dueDate: event.target.value }))} className="mt-1 block w-full rounded-lg border border-background-300 p-2" /></label>
                </div>
                <button type="button" disabled={busyId === finding.id} onClick={() => void saveFinding(finding, { actionPlan: draft.actionPlan, owner: draft.owner, dueDate: draft.dueDate || null })} className="rounded-lg bg-primary-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Save details</button>
                {finding.updatedAt ? <p className="text-[11px] text-foreground-400">Last updated {displayDate(finding.updatedAt)} by {finding.updatedBy}</p> : null}
              </div> : null}
            </div>
          ))}
        </div>
      </div>
    </WorkspaceShell>
  );
}
