import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useToast } from '@/hooks/useToast';
import { useResetWorkspaceScroll } from '@/hooks/useResetWorkspaceScroll';
import { EnrolmentWorkspaceShell as WorkspaceShell } from '../presentation/EnrolmentWorkspaceShell';
import design from '../presentation/EnrolmentWorkspace.module.css';
import styles from '../presentation/EnrolmentForms.module.css';
import motion from '../presentation/EnrolmentMotion.module.css';
import { EnrolmentBreadcrumbs } from '../presentation/EnrolmentBreadcrumbs';
import { roleNavMap } from '@/mocks/navigation';
import { fetchEnrolmentBoard, updateEnrolmentUser } from '@/api/enrolmentUsers';
import { fetchCommercialBoard, updateCommercialBoard } from '@/api/commercialUsers';
import type { EnrolmentBoard } from '../types';
import { btnSecondary } from '../components/ui';
import { WizardProvider, useWizard } from './WizardContext';
import { WizardShell } from './WizardShell';
import { DEFAULT_LAYOUT, visibleSteps } from './layout/resolve';

const DEFAULT_STEPS = visibleSteps(DEFAULT_LAYOUT);

function WizardInner({ stepSlug }: { stepSlug: string }) {
  const { userId, isCommercial, board, draft, saveIlr, steps = DEFAULT_STEPS } = useWizard();
  // Resolved against the published layout's steps, so a step added in the
  // wizard builder has an address and a removed one falls back to the first.
  const idx = steps.findIndex((s) => s.slug === stepSlug);
  const currentIndex = idx === -1 ? 0 : idx;
  const navigate = useNavigate();
  const { success, error } = useToast();

  // Keep the source in the URL so step navigation and the profile link stay
  // pointed at the right table.
  const suffix = isCommercial ? '?source=commercial' : '';
  const profileHref = `/users/${userId}${suffix}`;

  const goTo = (i: number) => navigate(`/users/${userId}/wizard/${steps[i].slug}${suffix}`);

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
        // Keep the purple fallback and scope the banner image to staff mode.
        // The close action needs the same contrast when the image is unavailable.
        <div data-testid="staff-wizard-banner" className={`${design.wizardHero} bg-primary-800`}>
          <EnrolmentBreadcrumbs current={board.user.name} people />
          <div className={design.wizardHeadline}>
            <div className="min-w-0">
              <h1>{board.user.name}</h1>
              <p>{[board.contact.email, board.programme.name].filter(Boolean).join(' · ')}</p>
              <p className={design.wizardReference}>{board.user.reference}{board.user.reference ? ' · ' : ''}Enrolment Wizard</p>
            </div>
            <button onClick={() => navigate(profileHref)} className="inline-flex items-center gap-1.5 px-3 py-2 border border-white/70 bg-transparent text-white rounded-lg text-[12px] font-medium hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white transition-smooth cursor-pointer shrink-0"><AppIcon className="ri-close-line" />Close wizard</button>
          </div>
        </div>
      }
    />
  );
}

function WizardPageContent() {
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
  // Neither ILR step applies to commercial delivery.
  const resolvedStepSlug = isCommercial && (stepSlug === 'ilr' || stepSlug === 'ilr-details') ? 'plr' : stepSlug;

  if (loading || loadError || !board) {
    return (
      <div className="min-h-full bg-background-200 flex items-center justify-center p-6">
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
      <WizardInner stepSlug={resolvedStepSlug} />
    </WizardProvider>
  );
}

export default function WizardPage() {
  const config = roleNavMap.compliance;
  const { stepSlug } = useParams();
  // Each step opens at its top rather than at the previous step's position.
  // The Enrollment wrapper also scopes the wizard's presentation.
  const topRef = useResetWorkspaceScroll<HTMLDivElement>(stepSlug);
  return (
    <WorkspaceShell role="compliance" roleLabel={config.label} navItems={config.items}
      workspaceLabel="Enrolment" pageTitle="Enrolment Wizard" hideBreadcrumbs showBackButton={false} directoryLayout>
      <div ref={topRef} className={`${design.wizard} ${styles.page} ${styles.staffWizard} ${motion.page}`}>
        <WizardPageContent />
      </div>
    </WorkspaceShell>
  );
}
