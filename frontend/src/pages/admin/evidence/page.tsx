import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { SelectMenu } from '@/components/feature/SelectField';
import { Modal } from '@/pages/users/components/Modal';
import {
  fetchClassifiedLearners,
  fetchLearnerAssignments,
  setAssignmentSelection,
  updateAssignmentKsbCodes,
  type AssignmentClassification,
  type ClassifiedLearner,
  type ClassifiedLearnerQuery,
} from '@/api/adminEvidence';
import { AdminPage, DataPanel, Pager, StatusBadge } from '../_shared/AdminPage';
import { useAdminData } from '../_shared/useAdminData';
import { DocumentPreviewModal } from './DocumentPreviewModal';
import { LearnerNameInput } from './LearnerNameInput';
import { ReportFormModal } from './ReportFormModal';

const PAGE_SIZE = 25;
const ASSIGNMENT_PAGE_SIZE = 20;
const EMPTY_FILTERS = { q: '', programme: '', portfolioReadiness: '' };

function label(value: string): string {
  if (!value) return '—';
  return value.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function dateLabel(value: string | null, withTime = false): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

function readinessTone(value: string): 'ok' | 'bad' | 'warn' | 'neutral' {
  if (value === 'ready') return 'ok';
  if (value === 'ready_with_checks') return 'warn';
  if (value === 'not_ready') return 'bad';
  return 'neutral';
}

export default function AdminEvidencePage() {
  const { learnerId: learnerParam } = useParams();
  const learnerId = learnerParam ? Number(learnerParam) : null;
  return Number.isInteger(learnerId) && learnerId! > 0
    ? <LearnerEvidenceDetail learnerId={learnerId!} />
    : <ClassifiedLearnerList />;
}

function ClassifiedLearnerList() {
  const navigate = useNavigate();
  const [summaryLearner, setSummaryLearner] = useState<ClassifiedLearner | null>(null);
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [filters, setFilters] = useState<ClassifiedLearnerQuery>({});
  const [page, setPage] = useState(1);

  const { data, loading, error, reload } = useAdminData(
    useCallback(() => fetchClassifiedLearners({
      ...filters,
      page, pageSize: PAGE_SIZE,
    }), [filters, page]),
    [filters, page],
  );
  const learners = data?.results ?? [];

  useEffect(() => {
    if (draft.q.trim() === (filters.q || '')) return;
    const timer = window.setTimeout(() => {
      setFilters(previous => ({ ...previous, q: draft.q.trim() }));
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft.q, filters.q]);

  const changeFilter = (key: 'programme' | 'portfolioReadiness', value: string) => {
    setDraft(previous => ({ ...previous, [key]: value }));
    setFilters(previous => ({ ...previous, [key]: value }));
    setPage(1);
  };

  return (
    <AdminPage
      title="Evidence"
      subtitle="Assignment classification across every active learner"
      icon="ri-folder-shield-2-line"
      heroTitle="Assignment Classification"
      heroBlurb="Review each active learner’s independently classified assignments, recommended portfolio and human-verification requirements."
      stats={[{ label: 'Matching learners', value: loading && !data ? '—' : (data?.count ?? 0) }]}
    >
      <div className="rounded-2xl border border-[var(--kbc-border)] bg-[var(--kbc-surface)] p-3 md:p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <LearnerNameInput value={draft.q} learners={learners} error={error}
            loading={loading || draft.q.trim() !== (filters.q || '')}
            onChange={q => setDraft(previous => ({ ...previous, q }))}
            onSelect={q => {
              setDraft(previous => ({ ...previous, q }));
              setFilters(previous => ({ ...previous, q }));
              setPage(1);
            }} />
          <div className="space-y-1 text-xs font-medium text-foreground-600">
            <label htmlFor="evidence-programme">Programme</label>
            <SelectMenu id="evidence-programme" ariaLabel="Programme" size="sm" triggerClassName="rounded-xl"
              value={draft.programme} onChange={programme => changeFilter('programme', programme)}
              disabled={loading && !data} searchable searchPlaceholder="Search programmes..."
              options={[{ value: '', label: 'All programmes' }, ...(data?.programmes ?? []).map(programme => ({ value: programme, label: programme }))]} />
          </div>
          <div className="space-y-1 text-xs font-medium text-foreground-600">
            <label htmlFor="evidence-readiness">Readiness</label>
            <SelectMenu id="evidence-readiness" ariaLabel="Readiness" size="sm" triggerClassName="rounded-xl"
              value={draft.portfolioReadiness} onChange={portfolioReadiness => changeFilter('portfolioReadiness', portfolioReadiness)}
              searchable={false} options={[
                { value: '', label: 'All readiness' },
                { value: 'ready', label: 'Ready' },
                { value: 'ready_with_checks', label: 'Ready with checks' },
                { value: 'not_ready', label: 'Not ready' },
                { value: 'not_classified', label: 'Not classified' },
              ]} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => { setDraft(EMPTY_FILTERS); setFilters({}); setPage(1); }} className="rounded-lg border border-foreground-200 px-4 py-2 text-xs font-semibold text-foreground-600 hover:bg-background-100">Clear filters</button>
        </div>
      </div>

      <DataPanel loading={loading && !data} error={error} empty={learners.length === 0} emptyMessage="No active learners match these filters." onRetry={reload}>
        <div className="overflow-hidden rounded-2xl border border-[var(--kbc-border)] bg-[var(--kbc-surface)]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-[12px]">
              <thead>
                <tr className="border-b border-foreground-300/60 bg-background-100/40">
                  {['Learner', 'Programme', 'Found', 'Evaluated', 'Selected', 'Readiness', 'Portfolio summary'].map(column => (
                    <th key={column} className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-foreground-400">{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {learners.map(learner => (
                  <LearnerRow key={learner.learnerId} learner={learner} onOpen={() => navigate(`/admin/evidence/${learner.learnerId}`)} onSummary={() => setSummaryLearner(learner)} />
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pageSize={PAGE_SIZE} count={data?.count ?? 0} onPage={setPage} />
        </div>
      </DataPanel>
      {summaryLearner && (
        <Modal title="Portfolio summary" size="max-w-2xl" onClose={() => setSummaryLearner(null)}>
          <div className="mb-5 flex items-start gap-3 rounded-xl bg-primary-50 p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700">
              <AppIcon className="ri-file-text-line text-xl" />
            </span>
            <div className="min-w-0">
              <h3 className="break-words text-sm font-semibold text-foreground-900">{summaryLearner.fullName}</h3>
              <p className="mt-1 break-words text-xs text-foreground-600">{summaryLearner.programme}</p>
            </div>
          </div>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground-700">{summaryLearner.portfolioSummary}</p>
        </Modal>
      )}
    </AdminPage>
  );
}

function LearnerRow({ learner, onOpen, onSummary }: { learner: ClassifiedLearner; onOpen: () => void; onSummary: () => void }) {
  const hasSummary = Boolean(learner.portfolioSummary?.trim());
  return (
    <tr className="border-b border-background-100/70">
      <td className="px-3 py-3">
        <button type="button" onClick={onOpen} className="text-left font-semibold text-primary-700 hover:underline">
          {learner.fullName}
        </button>
      </td>
      <td className="max-w-[260px] px-3 py-3 text-foreground-600"><span className="line-clamp-2">{learner.programme}</span></td>
      <td className="px-3 py-3 tabular-nums text-foreground-700">{learner.assignmentsFound}</td>
      <td className="px-3 py-3 tabular-nums text-foreground-700">{learner.uniqueAssignmentsEvaluated}</td>
      <td className="px-3 py-3 tabular-nums font-semibold text-foreground-800">{learner.assignmentsSelected}</td>
      <td className="px-3 py-3"><StatusBadge status={label(learner.portfolioReadiness)} tone={readinessTone(learner.portfolioReadiness)} /></td>
      <td className="px-3 py-3 text-center">
        <button type="button" onClick={onSummary} disabled={!hasSummary} aria-haspopup="dialog"
          aria-label={hasSummary ? `View portfolio summary for ${learner.fullName}` : `No portfolio summary available for ${learner.fullName}`}
          title={hasSummary ? 'View portfolio summary' : 'No portfolio summary available'}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-primary-100 bg-primary-50 text-primary-700 shadow-sm hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40">
          <AppIcon className="ri-file-text-line text-lg" />
        </button>
      </td>
    </tr>
  );
}

function LearnerEvidenceDetail({ learnerId }: { learnerId: number }) {
  const navigate = useNavigate();
  const [view, setView] = useState<'recommended' | 'all'>('recommended');
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState<{ path: string; title: string; evidenceId: number } | null>(null);
  const [buildingReport, setBuildingReport] = useState<number | null>(null);
  const [saving, setSaving] = useState<number | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  const { data, loading, error, reload } = useAdminData(
    useCallback(() => fetchLearnerAssignments(learnerId, {
      view, page, pageSize: ASSIGNMENT_PAGE_SIZE,
    }), [learnerId, view, page]),
    [learnerId, view, page],
  );
  const learner = data?.learner;
  const assignments = data?.results ?? [];

  const changeSelection = async (assignment: AssignmentClassification) => {
    if (!learner?.runId || saving !== null) return;
    setSaving(assignment.evidenceId);
    setSelectionError(null);
    try {
      await setAssignmentSelection(learnerId, assignment.evidenceId, learner.runId, assignment.componentId, !assignment.selected);
      if (view === 'recommended' && assignment.selected && assignments.length === 1 && page > 1) setPage(page - 1);
      else reload();
    } catch (caught) {
      setSelectionError(caught instanceof Error ? caught.message : 'Could not save the selection.');
    } finally {
      setSaving(null);
    }
  };

  return (
    <AdminPage
      title="Evidence"
      subtitle={learner ? `${learner.fullName} · ${learner.programme}` : 'Learner assignment classification'}
      icon="ri-folder-shield-2-line"
      heroTitle={learner?.fullName || 'Learner evidence'}
      heroBlurb={learner?.programme || 'Review assignments and build the learner’s evidence portfolio.'}
      stats={learner ? [
        { label: 'Assignments', value: data?.count ?? 0 },
      ] : undefined}
      actions={<button type="button" onClick={() => navigate('/admin/evidence')} className="rounded-xl border border-primary-200/60 bg-primary-50/60 px-4 py-2 text-xs font-semibold text-primary-700 shadow-sm hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"><AppIcon className="ri-arrow-left-line mr-1" />All learners</button>}
    >
      {learner?.portfolioSummary && learner.runId !== null && (
        <section className="rounded-2xl border border-[var(--kbc-border)] bg-[var(--kbc-surface)] p-5 !shadow-none sm:p-6">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h3 className="text-sm font-semibold text-foreground-900">Portfolio overview</h3>
            <StatusBadge status={label(learner.portfolioReadiness)} tone={readinessTone(learner.portfolioReadiness)} />
          </div>
          <p className="max-w-6xl whitespace-pre-wrap break-words text-sm leading-7 text-foreground-600">{learner.portfolioSummary}</p>
        </section>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 rounded-xl bg-background-100 p-1" role="tablist" aria-label="Assignment views">
          {(['recommended', 'all'] as const).map(tab => (
            <button key={tab} type="button" role="tab" aria-selected={view === tab} onClick={() => { setView(tab); setPage(1); }} className={`rounded-lg px-4 py-2 text-xs font-semibold ${view === tab ? 'bg-white text-primary-700 shadow-sm' : 'text-foreground-500 hover:text-foreground-800'}`}>
              {tab === 'recommended' ? 'Recommended' : 'All Assignments'}
            </button>
          ))}
        </div>
        <p className="text-xs text-foreground-500">{data?.count ?? 0} {view === 'recommended' ? 'recommended assignments' : 'evaluated assignments'}</p>
      </div>

      {selectionError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{selectionError}</p>}
      <DataPanel
        loading={loading && !data}
        error={error}
        empty={assignments.length === 0}
        emptyMessage={learner?.runId === null
          ? learner.portfolioSummary || 'No eligible accepted assignment was available for classification.'
          : view === 'recommended'
            ? 'No assignments are currently selected.'
            : 'No assignments were evaluated in this classification run.'}
        onRetry={reload}
      >
        <div className="space-y-4">
          {assignments.map(assignment => (
            <AssignmentCard key={`${assignment.componentId}-${assignment.evidenceId}`} assignment={assignment} learnerId={learnerId} runId={learner?.runId ?? null} onPreview={(path, title) => setPreview({ path, title, evidenceId: assignment.evidenceId })} onBuildReport={() => setBuildingReport(assignment.evidenceId)} onSelection={() => void changeSelection(assignment)} onKsbSaved={reload} selectionDisabled={loading || saving !== null} saving={saving === assignment.evidenceId} />
          ))}
          <div className="overflow-hidden rounded-2xl border border-[var(--kbc-border)] bg-[var(--kbc-surface)]">
            <Pager page={page} pageSize={ASSIGNMENT_PAGE_SIZE} count={data?.count ?? 0} onPage={setPage} />
          </div>
        </div>
      </DataPanel>

      {preview && <DocumentPreviewModal path={preview.path} title={preview.title} learnerId={learnerId} evidenceId={preview.evidenceId} onClose={() => setPreview(null)} onReportBuilt={reload} />}
      {buildingReport !== null && <ReportFormModal learnerId={learnerId} evidenceId={buildingReport} onClose={() => setBuildingReport(null)} onSaved={reload} />}
    </AdminPage>
  );
}

function AssignmentCard({ assignment, learnerId, runId, onPreview, onBuildReport, onSelection, onKsbSaved, selectionDisabled, saving }: {
  assignment: AssignmentClassification;
  learnerId: number;
  runId: number | null;
  onPreview: (path: string, title: string) => void;
  onBuildReport: () => void;
  onSelection: () => void;
  onKsbSaved: () => void;
  selectionDisabled: boolean;
  saving: boolean;
}) {
  const [editingKsbs, setEditingKsbs] = useState(false);
  const [ksbSaving, setKsbSaving] = useState(false);
  const [ksbError, setKsbError] = useState<string | null>(null);
  const [ksbInput, setKsbInput] = useState(assignment.verifiedKsbCodes.join(', '));
  const [displayKsbCodes, setDisplayKsbCodes] = useState(assignment.verifiedKsbCodes);

  useEffect(() => {
    setDisplayKsbCodes(assignment.verifiedKsbCodes);
  }, [assignment.verifiedKsbCodes]);

  const startKsbEdit = () => {
    setKsbInput(displayKsbCodes.join(', '));
    setKsbError(null);
    setEditingKsbs(true);
  };

  const saveKsbCodes = async () => {
    if (runId === null || ksbSaving) return;
    const verifiedKsbCodes = [...new Set(ksbInput.split(/[\s,]+/).map(code => code.trim().toUpperCase()).filter(Boolean))];
    setKsbSaving(true);
    setKsbError(null);
    try {
      const updated = await updateAssignmentKsbCodes(
        learnerId,
        assignment.evidenceId,
        runId,
        assignment.componentId,
        verifiedKsbCodes,
      );
      setDisplayKsbCodes(updated.verifiedKsbCodes);
      setEditingKsbs(false);
      onKsbSaved();
    } catch (caught) {
      setKsbError(caught instanceof Error ? caught.message : 'Could not save the KSB codes.');
    } finally {
      setKsbSaving(false);
    }
  };

  return (
    <article className="overflow-hidden rounded-2xl border border-[var(--kbc-border)] bg-[var(--kbc-surface)] !shadow-none">
      <header className="flex flex-col gap-5 border-b border-foreground-200/50 px-5 py-5 xl:flex-row xl:items-center xl:justify-between sm:px-6">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {assignment.rank !== null && <StatusBadge status={`Rank ${assignment.rank}`} tone="ok" />}
            <StatusBadge status={assignment.selected ? 'Selected' : 'Not selected'} tone={assignment.selected ? 'ok' : 'neutral'} />
            {assignment.manuallySelected && <StatusBadge status="Manually selected" tone="neutral" />}
          </div>
          <h3 className="break-words text-base font-semibold leading-6 text-foreground-900">{assignment.evidenceName}</h3>
          <p className="mt-1.5 text-xs leading-5 text-foreground-500">{assignment.componentName} · {dateLabel(assignment.assignmentDate)}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2.5">
          <div className="mr-2 min-w-[88px] border-r border-foreground-200/60 pr-5 text-left">
            <p className="text-[10px] uppercase tracking-wide text-foreground-400">Final score</p>
            <p className={`mt-1 text-3xl font-bold tabular-nums ${assignment.finalScore >= 80 ? 'text-green-600' : 'text-primary-700'}`}>{assignment.finalScore}%</p>
          </div>
          <DocumentButton disabled={!assignment.filePreviewPath} onClick={() => assignment.filePreviewPath && onPreview(assignment.filePreviewPath, `${assignment.evidenceName} assignment`)} icon="ri-file-text-line">Assignment file</DocumentButton>
          <DocumentButton disabled={!assignment.reportPreviewPath} onClick={() => assignment.reportPreviewPath && onPreview(assignment.reportPreviewPath, `${assignment.evidenceName} assessment report`)} icon="ri-file-chart-line">Assessment report</DocumentButton>
          {!assignment.reportPreviewPath && <button type="button" onClick={onBuildReport} className="inline-flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2.5 text-xs font-semibold text-primary-700 !shadow-none hover:bg-primary-100"><AppIcon className="ri-file-add-line" />Build report</button>}
          <button type="button" onClick={onSelection} disabled={selectionDisabled}
            className={`rounded-lg border px-3 py-2.5 text-xs font-semibold !shadow-none disabled:cursor-not-allowed disabled:opacity-50 ${assignment.selected ? 'border-rose-200 text-rose-700 hover:bg-rose-50' : 'border-primary-600 bg-primary-600 text-white hover:bg-primary-700'}`}>
            {saving ? 'Saving...' : assignment.selected ? 'Unselect' : 'Select assignment'}
          </button>
        </div>
      </header>

      <div className="grid gap-7 p-5 sm:p-6 lg:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)]">
        <InfoSection title="Classification">
          <Field name="Classification" value={label(assignment.classification)} />
          <Field name="Audit readiness" value={label(assignment.auditReadiness)} />
          {editingKsbs ? (
            <div className="space-y-3">
              <label className="block space-y-1.5 text-xs font-semibold text-foreground-500">
                <span>Verified KSB codes</span>
                <textarea value={ksbInput} onChange={event => setKsbInput(event.target.value)} rows={4} autoFocus
                  placeholder="K1, K2, S1, B1"
                  className="w-full resize-y rounded-xl border border-foreground-200 bg-white px-3 py-2.5 text-sm font-normal leading-6 text-foreground-800 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100" />
              </label>
              <p className="text-[11px] leading-5 text-foreground-400">Separate codes with commas or spaces.</p>
              {ksbError && <p role="alert" className="text-xs text-rose-700">{ksbError}</p>}
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => { setEditingKsbs(false); setKsbError(null); }} disabled={ksbSaving} className="rounded-lg border border-foreground-200 px-3 py-2 text-xs font-semibold text-foreground-600 hover:bg-background-100 disabled:opacity-50">Cancel</button>
                <button type="button" onClick={() => void saveKsbCodes()} disabled={ksbSaving} className="rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50">{ksbSaving ? 'Saving...' : 'Save changes'}</button>
              </div>
            </div>
          ) : (
            <TagField name="Verified KSB codes" values={displayKsbCodes} chips action={
              <button type="button" onClick={startKsbEdit} disabled={runId === null} className="inline-flex items-center gap-1 rounded-lg border border-primary-200 px-2.5 py-1.5 text-[11px] font-semibold text-primary-700 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-50">
                <AppIcon className="ri-edit-line" />Edit
              </button>
            } />
          )}
        </InfoSection>
        <InfoSection title="Selection decision">
          {!assignment.selected && <Field name="Reason not selected" value={assignment.reasonNotSelected || 'No reason supplied.'} />}
          <TagField name="Key strengths" values={assignment.keyStrengths} tone="positive" />
          <TagField name="Weaknesses" values={assignment.weaknesses} tone="warning" />
          <TagField name="Risks" values={assignment.risks} tone="risk" />
        </InfoSection>
        <InfoSection title="Quality Marking" className="lg:col-start-2 xl:col-start-auto">
          <Field name="Workplace evidence summary" value={assignment.workplaceEvidenceSummary || 'Not supplied.'} />
          <Field name="Feedback quality summary" value={assignment.feedbackQualitySummary || 'Not supplied.'} />
        </InfoSection>
      </div>
    </article>
  );
}

function DocumentButton({ disabled, onClick, icon, children }: {
  disabled: boolean; onClick: () => void; icon: string; children: React.ReactNode;
}) {
  return <button type="button" disabled={disabled} onClick={onClick} className="inline-flex items-center gap-2 rounded-lg border border-foreground-200/70 px-3 py-2.5 text-xs font-semibold text-foreground-700 !shadow-none hover:bg-background-100 disabled:cursor-not-allowed disabled:opacity-40"><AppIcon className={icon} />{children}</button>;
}

function InfoSection({ title, children, action, className = '' }: { title: string; children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return <section className={`min-w-0 space-y-5 ${className}`}><div className="flex min-h-9 items-center justify-between gap-3 border-b border-foreground-200/60 pb-3"><h4 className="text-xs font-semibold uppercase tracking-wide text-foreground-500">{title}</h4>{action}</div>{children}</section>;
}

function Field({ name, value }: { name: string; value: string }) {
  return <div><p className="mb-1.5 text-xs font-semibold text-foreground-500">{name}</p><p className="whitespace-pre-wrap break-words text-sm leading-7 text-foreground-700">{value}</p></div>;
}

function TagField({ name, values, chips = false, tone = 'neutral', action }: { name: string; values: string[]; chips?: boolean; tone?: 'positive' | 'warning' | 'risk' | 'neutral'; action?: React.ReactNode }) {
  const tones = { positive: 'text-emerald-700', warning: 'text-amber-700', risk: 'text-rose-700', neutral: 'text-foreground-500' };
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2"><p className={`text-xs font-semibold ${tones[tone]}`}>{name}</p>{action}</div>
      {!values.length ? <p className="text-sm text-foreground-400">None</p> : chips ? (
        <div className="flex flex-wrap gap-1.5">{values.map((value, index) => <span key={`${value}-${index}`} className="rounded-md border border-primary-100 bg-primary-50 px-2 py-1 text-xs font-medium text-primary-800">{value}</span>)}</div>
      ) : (
        <ul className="list-disc space-y-2 pl-4 text-sm leading-6 text-foreground-700 marker:text-foreground-300">{values.map((value, index) => <li key={`${value}-${index}`} className="break-words pl-1">{value}</li>)}</ul>
      )}
    </div>
  );
}
