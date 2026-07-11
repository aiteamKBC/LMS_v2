import { useState } from 'react';
import { useWizard } from '../WizardContext';
import { PCP_KSBS, PCP_STANDARD, RAG_LEVELS } from '@/mocks/enrolment-console';
import type { KsbAssessment, RagLevel } from '../../types';
import { Modal } from '../../components/Modal';
import { FileList, inputClass, btnPrimary, btnDestructive, btnSecondary } from '../../components/ui';
import { StepHeading } from './fields';

const ACTION_OPTIONS = ['Attend training', 'Shadow colleague', 'Complete e-learning', 'Work-based project'];
const GOAL_OPTIONS = ['Achieve competence', 'Build confidence', 'Gather evidence'];

interface WorkingAssessment {
  level: RagLevel | null;
  evidenceFiles: string[];
  planText: string;
  action: string;
  enterAction: string;
  goal: string;
  dueDate: string;
  note: string;
}

function emptyWorking(existing?: KsbAssessment): WorkingAssessment {
  return {
    level: existing?.level ?? null,
    evidenceFiles: existing?.evidenceFiles ?? [],
    planText: existing?.actionPlan?.text ?? '',
    action: existing?.actionPlan?.action ?? '',
    enterAction: '',
    goal: existing?.actionPlan?.goal ?? '',
    dueDate: existing?.actionPlan?.dueDate ?? '',
    note: existing?.note ?? '',
  };
}

export default function SkillsRadar() {
  const { draft, setSection } = useWizard();
  const sr = draft.skillsRadar;
  const [assessingId, setAssessingId] = useState<string | null>(null);
  const [work, setWork] = useState<WorkingAssessment>(emptyWorking());

  const ksbs = PCP_KSBS; // single standard shipped
  const assessedLevel = (ksbId: string) => sr.assessments[ksbId]?.level ?? null;

  const openAssess = (ksbId: string) => {
    setWork(emptyWorking(sr.assessments[ksbId]));
    setAssessingId(ksbId);
  };
  const closeAssess = () => setAssessingId(null);

  const confirm = () => {
    if (!assessingId) return;
    const next: KsbAssessment = {
      ksbId: assessingId,
      level: work.level,
      evidenceFiles: work.evidenceFiles,
      actionPlan: work.planText || work.action || work.goal || work.dueDate
        ? { text: work.planText, action: work.action || work.enterAction, goal: work.goal, dueDate: work.dueDate }
        : null,
      note: work.note,
    };
    setSection('skillsRadar', { ...sr, assessments: { ...sr.assessments, [assessingId]: next } });
    setAssessingId(null);
  };

  const addToPlan = () => {
    const act = work.enterAction || work.action;
    if (!act && !work.goal && !work.dueDate) return;
    const line = `• ${act || 'Action'}${work.goal ? ` — goal: ${work.goal}` : ''}${work.dueDate ? ` (due ${work.dueDate})` : ''}`;
    setWork((w) => ({ ...w, planText: w.planText ? `${w.planText}\n${line}` : line, action: '', enterAction: '', goal: '', dueDate: '' }));
  };

  const assessingKsb = ksbs.find((k) => k.id === assessingId) ?? null;
  const assessingTitle = assessingKsb
    ? `${assessingKsb.theme} (${assessingKsb.kind}) - ${assessingKsb.codes.join(', ')}: ${assessingKsb.title}`
    : '';

  return (
    <div>
      <StepHeading title="Skills Radar" />

      {/* Standard selector */}
      <div className="mb-5 max-w-sm">
        <label className="block text-[11px] uppercase tracking-wider font-medium text-foreground-500 mb-1">Standard</label>
        <select value={sr.standardId} onChange={(e) => setSection('skillsRadar', { ...sr, standardId: e.target.value })} className={`${inputClass} cursor-pointer`}>
          <option value={PCP_STANDARD.id}>{PCP_STANDARD.label}</option>
        </select>
      </div>

      {/* KSB grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {ksbs.map((ksb) => {
          const level = assessedLevel(ksb.id);
          return (
            <div key={ksb.id} className="flex flex-col">
              {/* Radar bar (Always -> Never, top to bottom) */}
              <div className="border border-foreground-200/70 rounded-t-lg overflow-hidden">
                {RAG_LEVELS.map((lvl) => {
                  const filled = level === lvl.level;
                  return (
                    <div
                      key={lvl.level}
                      title={lvl.label}
                      aria-label={filled ? `${lvl.label} (selected)` : lvl.label}
                      className={`relative h-6 border-b border-foreground-100 last:border-0 ${filled ? lvl.cellFill : 'bg-background-50'}`}
                    >
                      <span className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${lvl.dot}`} />
                      {filled && <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[9px] font-semibold text-white">{lvl.label}</span>}
                    </div>
                  );
                })}
              </div>
              {/* KSB card */}
              <div className="border border-t-0 border-foreground-200/70 rounded-b-lg p-3 flex-1 flex flex-col">
                <p className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wider mb-1">{ksb.codes.join(', ')} · {ksb.kind}</p>
                <p className="text-[12px] text-foreground-700 leading-snug flex-1">{ksb.title}</p>
                <button onClick={() => openAssess(ksb.id)} className={`${level ? btnSecondary : btnPrimary} w-full justify-center mt-3 !py-1.5`}>
                  <i className={level ? 'ri-edit-line' : 'ri-focus-3-line'} />{level ? 'Reassess' : 'Assess'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Assess modal */}
      {assessingId && (
        <Modal
          title={assessingTitle}
          onClose={closeAssess}
          size="max-w-4xl"
          footer={
            <>
              <button className={btnDestructive} onClick={closeAssess}><i className="ri-close-line" />Cancel</button>
              <button className={btnPrimary} onClick={confirm}><i className="ri-check-line" />Confirm</button>
            </>
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Left — rating options */}
            <div>
              <p className="text-[12px] font-semibold text-foreground-700 mb-2">How competent are you?</p>
              <div className="space-y-2">
                {RAG_LEVELS.map((lvl) => {
                  const selected = work.level === lvl.level;
                  return (
                    <label
                      key={lvl.level}
                      className={`flex items-start gap-2 p-3 rounded-lg border cursor-pointer transition-smooth ${selected ? `${lvl.tintBg} ${lvl.tintBorder}` : 'bg-background-50 border-foreground-200/70 hover:border-foreground-300'}`}
                    >
                      <input type="radio" name="rag" checked={selected} onChange={() => setWork((w) => ({ ...w, level: lvl.level }))} className="accent-primary-500 mt-0.5" />
                      <span className="flex-1">
                        <span className={`text-[13px] font-semibold ${selected ? lvl.tintText : 'text-foreground-800'}`}>{lvl.label}</span>
                        <span className="block text-[11px] text-foreground-500 mt-0.5">{lvl.help}</span>
                      </span>
                      <span title={lvl.help} className="text-foreground-300 shrink-0"><i className="ri-question-line" /></span>
                    </label>
                  );
                })}
              </div>
              <div className="mt-4">
                <p className="text-[12px] font-medium text-foreground-700 mb-1">Evidence discussed</p>
                <label className="inline-flex items-center gap-2 px-3 py-2 text-[12px] bg-background-100 text-foreground-600 rounded-lg border border-background-200 hover:bg-background-200 transition-smooth cursor-pointer">
                  <i className="ri-folder-open-line" />Browse
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const names = Array.from(e.target.files ?? []).map((f) => f.name);
                      setWork((w) => ({ ...w, evidenceFiles: [...w.evidenceFiles, ...names] }));
                    }}
                  />
                </label>
                <div className="mt-2">
                  <FileList
                    files={work.evidenceFiles.map((n, i) => ({ id: `${n}-${i}`, name: n }))}
                    onDelete={(id) => setWork((w) => ({ ...w, evidenceFiles: w.evidenceFiles.filter((_, i) => `${w.evidenceFiles[i]}-${i}` !== id) }))}
                    emptyText="No evidence attached"
                  />
                </div>
              </div>
            </div>

            {/* Right — action plan */}
            <div>
              <p className="text-[12px] font-semibold text-foreground-700 mb-2">Action plan</p>
              <textarea rows={5} value={work.planText} onChange={(e) => setWork((w) => ({ ...w, planText: e.target.value }))} className={inputClass} placeholder="Describe the plan…" />
              <div className="grid grid-cols-1 gap-2 mt-3">
                <div>
                  <label className="block text-[11px] uppercase tracking-wider font-medium text-foreground-500 mb-1">Select action</label>
                  <select value={work.action} onChange={(e) => setWork((w) => ({ ...w, action: e.target.value }))} className={`${inputClass} cursor-pointer`}>
                    <option value="">-none-</option>
                    {ACTION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wider font-medium text-foreground-500 mb-1">Enter action</label>
                  <input value={work.enterAction} onChange={(e) => setWork((w) => ({ ...w, enterAction: e.target.value }))} className={inputClass} placeholder="Free-text action" />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wider font-medium text-foreground-500 mb-1">Select goal</label>
                  <select value={work.goal} onChange={(e) => setWork((w) => ({ ...w, goal: e.target.value }))} className={`${inputClass} cursor-pointer`}>
                    <option value="">-none-</option>
                    {GOAL_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wider font-medium text-foreground-500 mb-1">Date to complete</label>
                  <input type="date" value={work.dueDate} onChange={(e) => setWork((w) => ({ ...w, dueDate: e.target.value }))} className={inputClass} />
                </div>
                <div><button onClick={addToPlan} className={`${btnSecondary} w-full justify-center`}><i className="ri-add-line" />Add</button></div>
              </div>
            </div>
          </div>

          {/* Note (full width) */}
          <div className="mt-5 pt-4 border-t border-foreground-100">
            <label className="block text-[11px] uppercase tracking-wider font-medium text-foreground-500 mb-1">Note</label>
            <input value={work.note} onChange={(e) => setWork((w) => ({ ...w, note: e.target.value }))} className={inputClass} />
          </div>
        </Modal>
      )}
    </div>
  );
}
