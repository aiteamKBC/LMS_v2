import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { useToast } from '@/hooks/useToast';
import { useMyLearner } from '@/hooks/useMyLearner';
import { fetchEnrolmentBoard, updateEnrolmentUser } from '@/api/enrolmentUsers';
import { fetchCommercialBoard, updateCommercialBoard } from '@/api/commercialUsers';
import { WIZARD_STEPS, type EnrolmentBoard } from '@/pages/users/types';
import { btnSecondary } from '@/pages/users/components/ui';
import { WizardProvider, useWizard } from '@/pages/users/wizard/WizardContext';
import { WizardShell } from '@/pages/users/wizard/WizardShell';
import { ONBOARDING_NAV_ITEMS, ONBOARDING_REVIEWS_ROUTE, isOnboardingStatus } from '@/hooks/useOnboardingRedirect';

const learnerNav = roleNavMap.learner;

/**
 * The learner's own enrolment form.
 *
 * Deliberately the SAME wizard the enrolment team uses (same step components,
 * same WizardContext, same enrolment."Extended_ILR" row) rather than a parallel
 * form — a second implementation would drift, and staff need to review exactly
 * what the learner submitted. Only the chrome differs: no "you are viewing"
 * banner, no admin quick actions, and Finish marks the enrolment submitted
 * instead of complete (staff still verify evidence and countersign).
 */
function LearnerWizard({ currentIndex, onDone }: { currentIndex: number; onDone: () => void }) {
  const { userId, isCommercial, board, draft, saveIlr } = useWizard();
  const navigate = useNavigate();
  const { success, error } = useToast();

  const goTo = (i: number) => navigate(`/learner/onboarding/${WIZARD_STEPS[i].slug}`);

  const finish = async () => {
    const pd = draft.personalDetails;
    const name = `${pd.firstName} ${pd.lastName}`.trim();
    try {
      // The ILR lives in its own table — save it before touching the learner row
      // so a learner who never pressed Save on that step doesn't lose it.
      await saveIlr();

      if (isCommercial) {
        await updateCommercialBoard(userId, {
          username: name || board.user.name,
          email: pd.email,
          phone: pd.phone,
        });
      } else {
        // 'Submitted' — not 'Completed'. Completion is the provider's call once
        // identity/eligibility evidence has been verified and countersigned.
        await updateEnrolmentUser(userId, {
          username: name || board.user.name,
          email: pd.email,
          phone: pd.phone,
          dob: pd.dob,
          onboardingStatus: 'Submitted',
        });
      }
      success('Enrolment submitted', 'Thank you — your enrolment has been sent to the team for review.');
      onDone();
    } catch (err) {
      error('Could not submit your enrolment', err instanceof Error ? err.message : 'Unexpected error');
    }
  };

  return (
    <WizardShell
      currentIndex={currentIndex}
      mode="learner"
      onNavigateStep={goTo}
      onFinish={finish}
      finishLabel="Submit enrolment"
      header={
        <div className="mb-4 rounded-2xl border border-foreground-200/60 bg-background-50 p-4 shadow-sm sm:p-5">
          <p className="text-sm leading-relaxed text-foreground-700">
            Please complete every step and sign where asked. Your answers save as you go, and the enrolment team will
            review them once you submit.
          </p>
        </div>
      }
    />
  );
}

export default function LearnerOnboardingPage() {
  const { stepSlug } = useParams();
  const navigate = useNavigate();
  const myLearner = useMyLearner();
  const isCommercial = myLearner.kind === 'commercial';

  const [board, setBoard] = useState<EnrolmentBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Keyed on the learner, not the step — switching tabs must not refetch. The
  // board is only reloaded when the learner actually changes (or on Retry).
  const learnerId = myLearner.id;
  const [reloadToken, setReloadToken] = useState(0);
  const reload = () => setReloadToken((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (isCommercial ? fetchCommercialBoard(learnerId) : fetchEnrolmentBoard(learnerId))
      .then((b) => { if (!cancelled) setBoard(b); })
      .catch((e: Error) => { if (!cancelled) setLoadError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [learnerId, isCommercial, reloadToken]);

  const idx = WIZARD_STEPS.findIndex((s) => s.slug === stepSlug);
  const currentIndex = idx === -1 ? 0 : idx;

  // Hide the rest of the learner workspace while they are onboarding — a learner
  // revisiting this page after enrolment keeps their full nav.
  //
  // Assume onboarding until the board proves otherwise: deriving this from a
  // still-null board would start false and flip true on load, flashing the full
  // sidebar and then collapsing it. Being on this page at all means onboarding in
  // almost every case, so the minimal nav is the better guess while loading.
  const onboardingOnly = loading || !board ? true : isOnboardingStatus(board.programme.status);

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      // Onboarding learners see only this page in the sidebar — the rest of the
      // learner workspace needs an enrolled learner with a training plan. Once
      // staff move them off 'Onboarding' the full nav returns.
      navItems={onboardingOnly ? ONBOARDING_NAV_ITEMS : learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="My Enrolment"
      pageSubtitle="Complete your onboarding"
      userName={board?.user.name || 'Learner'}
      userRole="Learner"
      showBackButton={false}
    >
      {/* w-full, matching the other learner pages — the shell already offsets for
          the collapsed sidebar rail, so an extra centred max-width fought it. */}
      <main className="w-full p-3 sm:p-4 md:p-6">
        {loading && <div className="py-20 text-center text-[13px] text-foreground-400"><AppIcon className="ri-loader-4-line animate-spin mr-2" />Loading your enrolment…</div>}
        {!loading && loadError && (
          <div className="py-20 text-center text-[13px]">
            <p className="text-red-600 mb-3"><AppIcon className="ri-error-warning-line mr-1.5" />{loadError}</p>
            <button className={btnSecondary} onClick={reload}><AppIcon className="ri-refresh-line" />Retry</button>
          </div>
        )}
        {!loading && !loadError && board && (
          <WizardProvider userId={myLearner.id} isCommercial={isCommercial} board={board}>
            {/* Straight to the reviews they now need to book, not the profile —
                booking all three is what completes their enrolment. */}
            <LearnerWizard currentIndex={currentIndex} onDone={() => navigate(ONBOARDING_REVIEWS_ROUTE)} />
          </WizardProvider>
        )}
      </main>
    </WorkspaceShell>
  );
}
