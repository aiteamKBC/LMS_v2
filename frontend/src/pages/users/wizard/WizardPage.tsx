import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useToast } from '@/hooks/useToast';
import { fetchEnrolmentBoard, updateEnrolmentUser } from '@/api/enrolmentUsers';
import { WIZARD_STEPS, type EnrolmentBoard } from '../types';
import { btnDestructive, btnPrimary, btnSuccess, btnSecondary } from '../components/ui';
import { WizardProvider, useWizard } from './WizardContext';
import Introduction from './steps/Introduction';
import PersonalDetails from './steps/PersonalDetails';
import SkillsRadar from './steps/SkillsRadar';
import Ilr from './steps/Ilr';
import ContactPreferences from './steps/ContactPreferences';
import Plr from './steps/Plr';
import CvJob from './steps/CvJob';
import Policies from './steps/Policies';
import NextSteps from './steps/NextSteps';

const STEP_BODIES = [Introduction, PersonalDetails, SkillsRadar, Ilr, ContactPreferences, Plr, CvJob, Policies, NextSteps];

function WizardInner({ currentIndex }: { currentIndex: number }) {
  const { userId, board, draft, completed } = useWizard();
  const navigate = useNavigate();
  const { success, error } = useToast();
  const tabScrollRef = useRef<HTMLDivElement>(null);
  const [submitting, setSubmitting] = useState(false);

  const Body = STEP_BODIES[currentIndex];
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === WIZARD_STEPS.length - 1;

  const goTo = (i: number) => navigate(`/users/${userId}/wizard/${WIZARD_STEPS[i].slug}`);
  const scrollTabs = (dir: number) => tabScrollRef.current?.scrollBy({ left: dir * 220, behavior: 'smooth' });
  const finish = async () => {
    const pd = draft.personalDetails;
    const name = `${pd.firstName} ${pd.lastName}`.trim();
    setSubmitting(true);
    try {
      // Persist the fields this table can hold, and mark onboarding complete.
      await updateEnrolmentUser(userId, {
        username: name || board.user.name,
        email: pd.email,
        phone: pd.phone,
        dob: pd.dob,
        onboardingStatus: 'Completed',
        onboardingCompleted: new Date().toLocaleString('en-GB'),
      });
      success('Enrolment submitted', 'Onboarding marked complete. Redirecting to the profile.');
      navigate(`/users/${userId}`);
    } catch (err) {
      error('Could not submit enrolment', err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background-200">
      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* Header */}
        <div className="relative rounded-2xl overflow-hidden mb-4 animate-fade-in-up" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="relative px-6 py-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-11 h-11 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><i className="ri-magic-line text-white text-xl" /></span>
              <div className="min-w-0">
                <p className="text-[11px] text-white/60 uppercase tracking-wide">Enrolment Wizard</p>
                <p className="text-[15px] font-heading font-semibold text-white truncate">You are viewing: {board.user.name}{board.user.reference ? <span className="text-white/60 font-normal"> ({board.user.reference})</span> : null}</p>
              </div>
            </div>
            <button onClick={() => navigate(`/users/${userId}`)} className="inline-flex items-center gap-1.5 px-3 py-2 bg-white/15 backdrop-blur-sm text-white rounded-lg text-[12px] font-medium hover:bg-white/25 transition-smooth cursor-pointer shrink-0"><i className="ri-close-line" />Close wizard</button>
          </div>
        </div>

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
                          onClick={() => goTo(i)}
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
                <button onClick={() => !isLast && goTo(currentIndex + 1)} disabled={isLast} aria-label="Next step" className="w-8 h-8 rounded-full bg-primary-500 text-white flex items-center justify-center hover:bg-primary-600 shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
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
              <button onClick={() => goTo(currentIndex - 1)} className={btnDestructive} style={{ visibility: isFirst ? 'hidden' : 'visible' }}>
                <i className="ri-arrow-left-line" />Back
              </button>
              {isLast ? (
                <button onClick={finish} disabled={submitting} className={btnSuccess}>{submitting ? <><i className="ri-loader-4-line animate-spin" />Submitting…</> : <><i className="ri-check-double-line" />Finish</>}</button>
              ) : (
                <button onClick={() => goTo(currentIndex + 1)} className={btnPrimary}>Next<i className="ri-arrow-right-line" /></button>
              )}
            </div>
          </div>

          {/* Right sidebar */}
          <aside className="lg:w-56 shrink-0">
            <div className="bg-background-50 rounded-2xl border border-foreground-200/60 p-3 card-premium space-y-2">
              <p className="text-[10px] font-semibold text-foreground-400 uppercase tracking-widest px-1 mb-1">Quick actions</p>
              <button className={`${btnSecondary} w-full justify-center`}><i className="ri-task-line" />Create a task</button>
              <button className={`${btnSecondary} w-full justify-center`}><i className="ri-calendar-todo-line" />Create a follow up</button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

export default function WizardPage() {
  const { userId = '', stepSlug } = useParams();
  const navigate = useNavigate();
  const [board, setBoard] = useState<EnrolmentBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    fetchEnrolmentBoard(userId)
      .then(setBoard)
      .catch((e: Error) => setLoadError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [userId]);

  if (!stepSlug) return <Navigate to={`/users/${userId}/wizard/introduction`} replace />;
  const idx = WIZARD_STEPS.findIndex((s) => s.slug === stepSlug);
  const currentIndex = idx === -1 ? 0 : idx;

  if (loading || loadError || !board) {
    return (
      <div className="min-h-screen bg-background-200 flex items-center justify-center p-6">
        <div className="text-center">
          {loading && <p className="text-[13px] text-foreground-400"><i className="ri-loader-4-line animate-spin mr-2" />Loading enrolment…</p>}
          {!loading && loadError && (
            <>
              <p className="text-red-600 text-[13px] mb-3"><i className="ri-error-warning-line mr-1.5" />{loadError}</p>
              <div className="flex items-center justify-center gap-3">
                <button className={btnSecondary} onClick={load}><i className="ri-refresh-line" />Retry</button>
                <button className={btnSecondary} onClick={() => navigate(`/users/${userId}`)}><i className="ri-close-line" />Back to profile</button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <WizardProvider userId={userId} board={board}>
      <WizardInner currentIndex={currentIndex} />
    </WizardProvider>
  );
}
