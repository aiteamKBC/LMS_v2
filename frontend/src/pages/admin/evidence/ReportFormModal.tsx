import { useEffect, useState } from 'react';
import {
  fetchAssessmentReportForm,
  saveAssessmentReportForm,
  type AssessmentReportForm,
  type AssessmentReportPrefill,
} from '@/api/adminEvidence';

const fieldClass = 'w-full rounded-lg border border-foreground-300 bg-white px-2.5 py-2 text-[13px] font-normal text-foreground-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100';

export function ReportFormModal({ learnerId, evidenceId, onClose, onSaved }: {
  learnerId: number;
  evidenceId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [prefill, setPrefill] = useState<AssessmentReportPrefill | null>(null);
  const [form, setForm] = useState<AssessmentReportForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingAnalysis, setConfirmingAnalysis] = useState(false);

  useEffect(() => {
    let active = true;
    setError(null);
    fetchAssessmentReportForm(learnerId, evidenceId).then(value => {
      if (!active) return;
      setPrefill(value);
      setForm({
        learner_name: value.learner_name,
        activity_name: value.activity_name,
        evidence_name: value.evidence_name,
        time_spent: '',
        result: value.result,
        assessor: value.assessor,
        date: value.date,
        criteria: '',
        comments: '',
      });
    }).catch(caught => {
      if (active) setError(caught instanceof Error ? caught.message : 'Could not load the assessment report form.');
    });
    return () => { active = false; };
  }, [learnerId, evidenceId]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || saving) return;
      if (confirmingAnalysis) setConfirmingAnalysis(false);
      else onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [confirmingAnalysis, onClose, saving]);

  const set = (key: keyof AssessmentReportForm, value: string) => {
    setForm(current => current ? { ...current, [key]: value } : current);
  };

  const submit = async (reanalyze: boolean) => {
    if (!form || saving) return;
    setConfirmingAnalysis(false);
    setSaving(true);
    setError(null);
    try {
      await saveAssessmentReportForm(learnerId, evidenceId, form, reanalyze);
      onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not build the report PDF.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-[#0e1524]/35 p-3" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section className="flex max-h-[90vh] w-[min(680px,96vw)] flex-col overflow-hidden rounded-2xl bg-[var(--kbc-surface)] shadow-[0_24px_64px_rgba(14,21,36,0.30)]" role="dialog" aria-modal="true" aria-labelledby="report-form-title">
        <header className="relative border-b border-foreground-200 px-[22px] py-[18px]">
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close report form" className="absolute right-[18px] top-4 border-0 bg-transparent text-[22px] leading-none text-foreground-400 hover:text-foreground-800 disabled:opacity-50">×</button>
          <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-foreground-400">Assessment report</p>
          <h3 id="report-form-title" className="mt-1.5 pr-7 text-[17px] font-semibold leading-[1.3] text-foreground-900">{prefill?.has_report ? 'Rebuild assessment report' : 'Build assessment report'}</h3>
          <p className="mt-1 text-[12.5px] text-foreground-600">Fill the form like Aptem — it renders to a matching PDF, then lets you refresh or keep the current analysis.</p>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-[22px] py-5 pb-4">
          {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-medium text-red-800">{error}</div>}
          {!prefill || !form ? (
            !error && <p className="px-3 py-3 text-[12.5px] text-foreground-400" role="status">Loading…</p>
          ) : (
            <>
              <ReportField label="Learner name"><input className={fieldClass} value={form.learner_name} onChange={event => set('learner_name', event.target.value)} /></ReportField>
              <ReportField label="Activity name"><input className={fieldClass} value={form.activity_name} onChange={event => set('activity_name', event.target.value)} placeholder="Component / activity" /></ReportField>
              <ReportField label="Evidence name"><input className={fieldClass} value={form.evidence_name} onChange={event => set('evidence_name', event.target.value)} /></ReportField>

              <div className="flex flex-col gap-3 sm:flex-row sm:gap-3">
                <ReportField label="Time spent (minutes)" className="flex-1"><input className={fieldClass} type="number" min="0" value={form.time_spent} onChange={event => set('time_spent', event.target.value)} /></ReportField>
                <ReportField label="Assessment result" className="flex-1">
                  <select className={fieldClass} value={form.result} onChange={event => set('result', event.target.value)}>
                    {prefill.result_options.map(option => <option key={option} value={option}>{option}</option>)}
                  </select>
                </ReportField>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:gap-3">
                <ReportField label="Assessed by" className="flex-1"><input className={fieldClass} value={form.assessor} onChange={event => set('assessor', event.target.value)} placeholder="Assessor name" /></ReportField>
                <ReportField label="Assessment date" className="flex-1"><input className={fieldClass} value={form.date} onChange={event => set('date', event.target.value)} placeholder="DD/MM/YYYY" /></ReportField>
              </div>

              <ReportField label="Criteria">
                <textarea className={`${fieldClass} resize-y`} rows={6} value={form.criteria} onChange={event => set('criteria', event.target.value)} placeholder={'Type the apprenticeship standard and the KSBs covered, e.g.\nKnowledge: K01, K04\nSkills: S01\nBehaviours: B1'} />
              </ReportField>
              <ReportField label="Comments">
                <textarea className={`${fieldClass} resize-y`} rows={8} value={form.comments} onChange={event => set('comments', event.target.value)} placeholder="Assessor feedback…" />
              </ReportField>
            </>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-foreground-200 bg-background-100 px-[22px] py-3.5">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-foreground-300 bg-white px-3 py-2 text-xs font-semibold text-foreground-700 hover:bg-background-100 disabled:opacity-50">Cancel</button>
          <button type="button" onClick={() => setConfirmingAnalysis(true)} disabled={saving || !form} className="rounded-lg border border-primary-600 bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50">{saving ? 'Building PDF…' : 'Build report PDF'}</button>
        </footer>
      </section>

      {confirmingAnalysis && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-[#0e1524]/45 p-4" onMouseDown={event => { if (event.target === event.currentTarget) setConfirmingAnalysis(false); }}>
          <section className="w-full max-w-md overflow-hidden rounded-2xl bg-[var(--kbc-surface)] shadow-[0_24px_64px_rgba(14,21,36,0.35)]" role="alertdialog" aria-modal="true" aria-labelledby="analysis-choice-title">
            <div className="border-b border-foreground-200 px-5 py-4">
              <h4 id="analysis-choice-title" className="text-base font-semibold text-foreground-900">How should the current analysis be handled?</h4>
              <p className="mt-1.5 text-xs leading-5 text-foreground-500">Choose whether the new report should require a fresh audit or keep the existing analysed result.</p>
            </div>
            <div className="flex flex-col gap-3 p-5">
              <button type="button" onClick={() => void submit(true)} className="w-full rounded-xl border border-primary-200 bg-primary-50 p-3.5 text-left hover:bg-primary-100">
                <span className="block text-sm font-semibold text-primary-800">Save &amp; reanalyse</span>
                <span className="mt-1 block text-xs leading-5 text-primary-700">Save the PDF and start a fresh audit immediately. The status moves through queued and processing, then the new result replaces the old one.</span>
              </button>
              <button type="button" onClick={() => void submit(false)} className="w-full rounded-xl border border-foreground-200 p-3.5 text-left hover:bg-background-100">
                <span className="block text-sm font-semibold text-foreground-800">Save &amp; keep analysis</span>
                <span className="mt-1 block text-xs leading-5 text-foreground-500">Save the PDF while preserving the current audit result and analysed status.</span>
              </button>
              <button type="button" onClick={() => setConfirmingAnalysis(false)} className="self-end rounded-lg border border-foreground-200 px-3 py-2 text-xs font-semibold text-foreground-600 hover:bg-background-100">Cancel</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function ReportField({ label, className = '', children }: { label: string; className?: string; children: React.ReactNode }) {
  return <label className={`flex flex-col gap-[5px] text-xs font-semibold text-foreground-600 ${className}`}><span>{label}</span>{children}</label>;
}
