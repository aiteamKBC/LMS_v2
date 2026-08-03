import { useRef, useState, type ReactNode } from 'react';
import { useToast } from '@/hooks/useToast';
import { WIZARD_STEPS } from '../types';
import { btnDestructive, btnPrimary, btnSuccess, btnSecondary } from '../components/ui';
import { useWizard } from './WizardContext';
import Introduction from './steps/Introduction';
import PersonalDetails from './steps/PersonalDetails';
import SkillsRadar from './steps/SkillsRadar';
import Ilr from './steps/Ilr';
import Plr from './steps/Plr';
import CvJob from './steps/CvJob';
import Policies from './steps/Policies';
import NextSteps from './steps/NextSteps';

/**
 * The step bodies are mode-agnostic — every one reads and writes only through
 * useWizard(), so the same components serve the staff wizard and the learner's
 * own onboarding form. Only the chrome around them differs (see WizardShell).
 */
export const STEP_BODIES = [Introduction, PersonalDetails, SkillsRadar, Ilr, Plr, CvJob, Policies, NextSteps];

/**
 * Shared wizard chrome: step tabs, progress, body, prev/next and finish.
 *
 * `mode` only affects presentation and the finish action:
 *   'staff'   — "You are viewing: <learner>", Close-wizard, quick actions.
 *   'learner' — the learner filling in their own enrolment; no admin affordances.
 *
 * Both modes drive the same WizardContext, so both write the same Extended ILR
 * row — the learner's answers are what staff later review and countersign.
 */
export function WizardShell({
  currentIndex,
  mode,
  onNavigateStep,
  onFinish,
  finishLabel = 'Finish',
  header,
  sidebar,
}: {
  currentIndex: number;
  mode: 'staff' | 'learner';
  onNavigateStep: (index: number) => void;
  onFinish: () => Promise<void>;
  finishLabel?: string;
  header?: ReactNode;
  sidebar?: ReactNode;
}) {
  const { completed, saveIlr, ilrSaving } = useWizard();
  const { success, error } = useToast();
  const tabScrollRef = useRef<HTMLDivElement>(null);
  const [submitting, setSubmitting] = useState(false);

  const save = async () => {
    try {
      await saveIlr();
      success('Progress saved', 'Every step of this wizard is stored against the learner.');
    } catch (e) {
      error('Could not save', e instanceof Error ? e.message : 'Unexpected error');
    }
  };

  const Body = STEP_BODIES[currentIndex];
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === WIZARD_STEPS.length - 1;

  const scrollTabs = (dir: number) => tabScrollRef.current?.scrollBy({ left: dir * 220, behavior: 'smooth' });

  const finish = async () => {
    setSubmitting(true);
    try {
      await onFinish();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={mode === 'staff' ? 'min-h-screen bg-background-200' : ''}>
      <div className={mode === 'staff' ? 'max-w-6xl mx-auto px-6 py-6' : ''}>
        {header}

        <div className="flex flex-col lg:flex-row gap-4">
          {/* Main panel */}
          <div className="flex-1 min-w-0 bg-background-50 rounded-2xl border border-foreground-200/60 overflow-hidden">
            {/* Tab bar */}
            <div className="border-b border-foreground-100 px-3 py-3">
              <div className="flex items-center gap-2">
                <button onClick={() => scrollTabs(-1)} aria-label="Scroll tabs left" className="w-8 h-8 rounded-lg border border-foreground-200 flex items-center justify-center text-foreground-500 hover:bg-background-100 shrink-0 cursor-pointer">
                  <i className="ri-arrow-left-s-line" />
                </button>
                <div ref={tabScrollRef} className="flex-1 overflow-x-auto scrollbar-thin" role="tablist" aria-label="Enrolment steps">
                  <div className="flex items-center gap-1.5 min-w-max">
                    {WIZARD_STEPS.map((step, i) => {
                      const active = i === currentIndex;
                      return (
                        <button
                          key={step.slug}
                          role="tab"
                          aria-selected={active}
                          title={step.label}
                          onClick={() => onNavigateStep(i)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium whitespace-nowrap transition-smooth cursor-pointer max-w-[160px] ${
                            active ? 'bg-primary-50 text-primary-700 border border-primary-300/60' : 'text-foreground-500 hover:bg-background-100 border border-transparent'
                          }`}
                        >
                          <i className={`text-[13px] ${active ? 'ri-checkbox-blank-circle-line text-primary-500' : completed[i] ? 'ri-checkbox-circle-fill text-emerald-500' : 'ri-checkbox-blank-circle-fill text-foreground-300'}`} />
                          <span className="truncate">{step.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <button onClick={() => scrollTabs(1)} aria-label="Scroll tabs right" className="w-8 h-8 rounded-lg border border-foreground-200 flex items-center justify-center text-foreground-500 hover:bg-background-100 shrink-0 cursor-pointer">
                  <i className="ri-arrow-right-s-line" />
                </button>
                <span className="text-[12px] text-foreground-500 shrink-0 ml-1 whitespace-nowrap">{currentIndex + 1} of {WIZARD_STEPS.length}</span>
                <button onClick={() => !isLast && onNavigateStep(currentIndex + 1)} disabled={isLast} aria-label="Next step" className="w-8 h-8 rounded-full bg-primary-500 text-white flex items-center justify-center hover:bg-primary-600 shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                  <i className="ri-arrow-right-line" />
                </button>
              </div>
              {/* Progress bar */}
              <div className="mt-2.5 h-1 bg-background-200 rounded-full overflow-hidden">
                <div className="h-full bg-primary-500 rounded-full transition-all duration-300" style={{ width: `${((currentIndex + 1) / WIZARD_STEPS.length) * 100}%` }} />
              </div>
            </div>

            {/* Step body */}
            <div key={currentIndex} className="p-5 md:p-6 animate-fade-in-up">
              <Body />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-foreground-100">
              <button onClick={() => onNavigateStep(currentIndex - 1)} className={btnDestructive} style={{ visibility: isFirst ? 'hidden' : 'visible' }}>
                <i className="ri-arrow-left-line" />Back
              </button>
              {/* Save is available on every step, not just the ILR — otherwise a
                  learner on (say) Policies has no way to keep their progress. */}
              <button onClick={save} disabled={ilrSaving} className={`${btnSecondary} ml-auto mr-1`}>
                {ilrSaving ? <><i className="ri-loader-4-line animate-spin" />Saving…</> : <><i className="ri-save-line" />Save progress</>}
              </button>
              {isLast ? (
                <button onClick={finish} disabled={submitting} className={btnSuccess}>
                  {submitting ? <><i className="ri-loader-4-line animate-spin" />Submitting…</> : <><i className="ri-check-double-line" />{finishLabel}</>}
                </button>
              ) : (
                <button onClick={() => onNavigateStep(currentIndex + 1)} className={btnPrimary}>Next<i className="ri-arrow-right-line" /></button>
              )}
            </div>
          </div>

          {/* Right sidebar */}
          {sidebar && <aside className="lg:w-56 shrink-0">{sidebar}</aside>}
        </div>
      </div>
    </div>
  );
}
