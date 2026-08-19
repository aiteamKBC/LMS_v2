import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useToast } from '@/hooks/useToast';
import { fetchEnrolmentBoard, updateEnrolmentUser } from '@/api/enrolmentUsers';
import { fetchCommercialBoard, updateCommercialBoard } from '@/api/commercialUsers';
import { WIZARD_STEPS, type EnrolmentBoard } from '../types';
import { btnSecondary } from '../components/ui';
import { WizardProvider, useWizard } from './WizardContext';
import { WizardShell } from './WizardShell';

function WizardInner({ currentIndex }: { currentIndex: number }) {
  const { userId, isCommercial, board, draft, saveIlr } = useWizard();
  const navigate = useNavigate();
  const { success, error } = useToast();

  // Keep the source in the URL so step navigation and the profile link stay
  // pointed at the right table.
  const suffix = isCommercial ? '?source=commercial' : '';
  const profileHref = `/users/${userId}${suffix}`;

  const goTo = (i: number) => navigate(`/users/${userId}/wizard/${WIZARD_STEPS[i].slug}${suffix}`);

  const finish = async () => {
    const pd = draft.personalDetails;
    const name = `${pd.firstName} ${pd.lastName}`.trim();
    try {
      // Persist the Extended ILR first: it lives in its own table, so a learner
      // who filled it in but never pressed Save would otherwise lose it here.
      if (!isCommercial) await saveIlr();

      // Persist the fields this table can hold, and mark onboarding complete.
      // The commercial table has no dob/onboarding columns, so its board
      // endpoint takes only the fields it can actually store.
      if (isCommercial) {
        await updateCommercialBoard(userId, {
          username: name || board.user.name,
          email: pd.email,
          phone: pd.phone,
        });
      } else {
        await updateEnrolmentUser(userId, {
          username: name || board.user.name,
          email: pd.email,
          phone: pd.phone,
          dob: pd.dob,
          onboardingStatus: 'Completed',
          onboardingCompleted: new Date().toLocaleString('en-GB'),
        });
      }
      success('Enrolment submitted', 'Onboarding marked complete. Redirecting to the profile.');
      navigate(profileHref);
    } catch (err) {
      error('Could not submit enrolment', err instanceof Error ? err.message : 'Unexpected error');
    }
  };

  return (
    <WizardShell
      currentIndex={currentIndex}
      mode="staff"
      onNavigateStep={goTo}
      onFinish={finish}
      header={
        <div className="relative rounded-2xl overflow-hidden mb-4 animate-fade-in-up" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="relative px-6 py-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-11 h-11 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><AppIcon className="ri-magic-line text-white text-xl" /></span>
              <div className="min-w-0">
                <p className="text-[11px] text-white/60 uppercase tracking-wide">Enrolment Wizard</p>
                <p className="text-[15px] font-heading font-semibold text-white truncate">You are viewing: {board.user.name}{board.user.reference ? <span className="text-white/60 font-normal"> ({board.user.reference})</span> : null}</p>
              </div>
            </div>
            <button onClick={() => navigate(profileHref)} className="inline-flex items-center gap-1.5 px-3 py-2 bg-white/15 backdrop-blur-sm text-white rounded-lg text-[12px] font-medium hover:bg-white/25 transition-smooth cursor-pointer shrink-0"><AppIcon className="ri-close-line" />Close wizard</button>
          </div>
        </div>
      }
    />
  );
}

export default function WizardPage() {
  const { userId = '', stepSlug } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  // The directory lists two tables whose ids overlap, so the row's source is
  // carried in the URL — without it a commercial id would read the wrong record.
  const isCommercial = search.get('source') === 'commercial';
  const suffix = isCommercial ? '?source=commercial' : '';
  const [board, setBoard] = useState<EnrolmentBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Keyed on the learner, not the step — switching tabs must not refetch.
  const [reloadToken, setReloadToken] = useState(0);
  const reload = () => setReloadToken((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (isCommercial ? fetchCommercialBoard(userId) : fetchEnrolmentBoard(userId))
      .then((b) => { if (!cancelled) setBoard(b); })
      .catch((e: Error) => { if (!cancelled) setLoadError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, isCommercial, reloadToken]);

  if (!stepSlug) return <Navigate to={`/users/${userId}/wizard/introduction${suffix}`} replace />;
  // Commercial delivery has no funded ILR trail. If an old bookmark or a
  // generic next-step link reaches the ILR route, land on the next real step.
  const resolvedStepSlug = isCommercial && stepSlug === 'ilr' ? 'plr' : stepSlug;
  const idx = WIZARD_STEPS.findIndex((s) => s.slug === resolvedStepSlug);
  const currentIndex = idx === -1 ? 0 : idx;

  if (loading || loadError || !board) {
    return (
      <div className="min-h-screen bg-background-200 flex items-center justify-center p-6">
        <div className="text-center">
          {loading && <p className="text-[13px] text-foreground-400"><AppIcon className="ri-loader-4-line animate-spin mr-2" />Loading enrolment…</p>}
          {!loading && loadError && (
            <>
              <p className="text-red-600 text-[13px] mb-3"><AppIcon className="ri-error-warning-line mr-1.5" />{loadError}</p>
              <div className="flex items-center justify-center gap-3">
                <button className={btnSecondary} onClick={reload}><AppIcon className="ri-refresh-line" />Retry</button>
                <button className={btnSecondary} onClick={() => navigate(`/users/${userId}${suffix}`)}><AppIcon className="ri-close-line" />Back to profile</button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    /* readOnlyLearnerSteps: the Skills Radar is the learner's own self-assessment,
       so staff review it here rather than edit it. */
    <WizardProvider userId={userId} isCommercial={isCommercial} board={board} readOnlyLearnerSteps>
      <WizardInner currentIndex={currentIndex} />
    </WizardProvider>
  );
}
