import { useEffect, useState } from 'react';
import { WorkspaceMetricContent } from '@/components/ui/WorkspaceMetricContent';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { formatHoursMinutes } from '@/lib/format';
import { roleNavMap } from '@/mocks/navigation';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
import { LearnerLoadError } from '@/components/feature/LearnerLoadError';
import { fetchLearnerAttendance, type LearnerAttendance } from '@/api/learnerAttendance';
import { useMyLearner } from '@/hooks/useMyLearner';
import { useOnboardingRedirect } from '@/hooks/useOnboardingRedirect';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { LearnerProfilePhoto } from '@/components/feature/LearnerProfilePhoto';

const learnerNav = roleNavMap.learner;

function numberValue(value?: string) {
  const parsed = Number.parseFloat(value || '0');
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function LearnerProfilePage() {
  const navigate = useNavigate();
  const myLearner = useMyLearner();
  const { real: learner, loading, loadError: error, refresh } = useLearnerDetailParam(myLearner.kind, myLearner.id);
  const [attendance, setAttendance] = useState<LearnerAttendance | null>(null);
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [attendanceError, setAttendanceError] = useState(false);

  // Still enrolling? The wizard is the only thing this learner can act on. The
  // profile body is held back while the redirect is in flight, so an onboarding
  // learner never sees a frame of the delivery profile before the wizard opens.
  const redirectingToOnboarding = useOnboardingRedirect(learner?.programmeStatus, !loading);

  useEffect(() => {
    let cancelled = false;
    setAttendance(null); setAttendanceLoading(true); setAttendanceError(false);
    fetchLearnerAttendance(myLearner.kind, myLearner.id)
      .then(record => { if (!cancelled) setAttendance(record); })
      .catch(() => { if (!cancelled) setAttendanceError(true); })
      .finally(() => { if (!cancelled) setAttendanceLoading(false); });
    return () => { cancelled = true; };
  }, [myLearner.id, myLearner.kind]);

  const completedHours = numberValue(learner?.completedHours);
  const plannedHours = numberValue(learner?.plannedHours) || learner?.totalExpectedOtjh || 0;
  const otjProgress = plannedHours ? Math.min(Math.round((completedHours / plannedHours) * 100), 100) : 0;
  const completedActivities = (learner?.activityFeed || []).length;

  if (redirectingToOnboarding) {
    return (
      <div className="min-h-screen flex items-center justify-center text-[13px] text-foreground-400">
        <AppIcon className="ri-loader-4-line animate-spin mr-2"></AppIcon>Opening your enrolment…
      </div>
    );
  }

  return (
    <WorkspaceShell role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel} pageTitle={learner?.name || 'Profile'} pageSubtitle="Learner profile" userName={learner?.name || 'Learner'} userRole={learner?.programme ? `${learner.programme} Apprentice` : 'Apprentice'}>
      <main className="page-container min-w-0 w-full space-y-3 p-3 md:space-y-4 md:p-6">
        <button type="button" onClick={() => navigate(`/workspace/learner/${myLearner.kind}/${myLearner.id}`)} className="inline-flex items-center gap-2 text-xs font-semibold text-foreground-500 transition hover:text-primary-700"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white shadow-sm"><AppIcon className="ri-arrow-left-line"></AppIcon></span>Back to Dashboard</button>

        {loading ? <Loading /> : error ? <LearnerLoadError error={error} onRetry={refresh} /> : learner && <>
        <section className="learner-super-admin-hero relative overflow-hidden rounded-3xl p-6 text-primary-800 md:p-6 workspace-page-hero">
            <div className="pointer-events-none absolute -right-20 -top-32 h-80 w-80 rounded-full bg-secondary-300/15 blur-3xl hidden"></div>
            <div className="relative flex flex-col gap-5 md:flex-row md:items-center">
              <LearnerProfilePhoto kind={myLearner.kind} learnerId={myLearner.id} name={learner.name} />
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold text-primary-800">{learner.name}</h1><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ring-inset ${learner.isActive ? 'bg-emerald-400/15 text-emerald-700 ring-emerald-300/20' : 'bg-primary-100/60 text-foreground-500 ring-primary-200/60'}`}>{learner.isActive ? 'Active learner' : learner.programmeStatus || 'Inactive'}</span></div><p className="mt-2 text-sm text-foreground-500">{learner.programme || 'Programme not set'}{learner.employer ? ` · ${learner.employer}` : ''}</p><div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-foreground-500"><span><AppIcon className="ri-mail-line mr-1.5"></AppIcon>{learner.email || 'Email not set'}</span><span><AppIcon className="ri-phone-line mr-1.5"></AppIcon>{learner.phone || 'Phone not set'}</span><span><AppIcon className="ri-id-card-line mr-1.5"></AppIcon>{myLearner.kind} #{learner.id}</span></div></div>
              <button onClick={() => window.print()} className="inline-flex h-10 items-center gap-2 rounded-xl border border-primary-200/60 bg-primary-100/60 px-4 text-xs font-semibold text-primary-800 transition hover:bg-primary-100"><AppIcon className="ri-printer-line"></AppIcon>Print profile</button>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-3">
            <StatCard icon="ri-calendar-check-line" label="Attendance" value={attendance ? `${attendance.attendanceRate}%` : '–'} detail={attendance ? `${attendance.present} of ${attendance.sessions} sessions` : 'No record'} progress={attendance?.attendanceRate || 0} bar="bg-amber-500" />
            <StatCard icon="ri-time-line" label="OTJ hours" value={`${formatHoursMinutes(completedHours)} / ${formatHoursMinutes(plannedHours)}`} detail={`${otjProgress}% of plan`} progress={otjProgress} bar="bg-primary-600" />
            <StatCard icon="ri-stack-line" label="Modules" value={String(learner.modules.length)} detail="Assigned modules" />
            <StatCard icon="ri-calendar-todo-line" label="Weeks" value={String(learner.week.length)} detail="Planned weeks" />
            <StatCard icon="ri-checkbox-multiple-line" label="Activities" value={String(completedActivities)} detail="Recorded completions" />
            <StatCard icon="ri-bar-chart-box-line" label="KSBs" value={String(learner.ksbs.length)} detail="Programme KSBs" />
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <ProfileSection icon="ri-user-line" title="Personal details">
              <DetailRow label="Full name" value={learner.name} />
              <DetailRow label="Email" value={learner.email} />
              <DetailRow label="Phone" value={learner.phone} />
              <DetailRow label="Learner source" value={`${myLearner.kind} · ID ${learner.id}`} />
            </ProfileSection>
            <ProfileSection icon="ri-graduation-cap-line" title="Programme details">
              <DetailRow label="Programme" value={learner.programme} />
              <DetailRow label="Status" value={learner.programmeStatus} />
              <DetailRow label="Cohort" value={learner.cohort} />
              <DetailRow label="Group" value={learner.group} />
            </ProfileSection>
            <ProfileSection icon="ri-building-line" title="Workplace & support">
              <DetailRow label="Employer" value={learner.employer} />
              <DetailRow label="Line manager" value={learner.lineManager} />
              <DetailRow label="Attendance risk" value={attendanceLoading ? 'Loading attendance…' : attendanceError ? 'Temporarily unavailable' : attendance?.risk ? attendance.risk[0].toUpperCase() + attendance.risk.slice(1) : 'No record'} />
              <DetailRow label="Last attendance session" value={attendanceLoading ? 'Loading attendance…' : attendanceError ? 'Temporarily unavailable' : attendance?.lastSessionDate ? new Date(attendance.lastSessionDate).toLocaleDateString('en-GB') : 'Not recorded'} />
            </ProfileSection>
            <ProfileSection icon="ri-route-line" title="Learning plan">
              <DetailRow label="Assigned modules" value={String(learner.modules.length)} />
              <DetailRow label="Assigned components" value={String(learner.components.length)} />
              <DetailRow label="Planned OTJ hours" value={formatHoursMinutes(plannedHours)} />
              <DetailRow label="Completed OTJ hours" value={formatHoursMinutes(completedHours)} />
            </ProfileSection>
          </div>
        </>}
      </main>
    </WorkspaceShell>
  );
}

function StatCard({ icon, label, value, detail, progress, bar }: { icon: string; label: string; value: string; detail: string; progress?: number; bar?: string }) {
  return <article className="ui-metric-card coach-metric-card p-3">
    <WorkspaceMetricContent icon={icon} label={label} value={value} note={detail} valuePosition="stacked" />
    {progress !== undefined && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-background-200"><div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.max(0, Math.min(progress, 100))}%` }} /></div>}
  </article>;
}
function ProfileSection({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) { return <section className="overflow-hidden rounded-3xl border border-background-200 bg-white shadow-[0_5px_24px_rgba(28,10,55,0.05)]"><div className="flex items-center gap-3 border-b border-background-200 px-5 py-4"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50 text-primary-600"><AppIcon className={icon}></AppIcon></span><h2 className="text-sm font-bold text-foreground-900">{title}</h2></div><div className="divide-y divide-background-200 px-5">{children}</div></section>; }
function DetailRow({ label, value }: { label: string; value?: string }) { return <div className="grid gap-1 py-3.5 sm:grid-cols-[150px_1fr]"><p className="text-xs text-foreground-400">{label}</p><p className="break-words text-sm font-semibold text-foreground-700">{value || 'Not set'}</p></div>; }
function Loading() {
  // Skeleton rather than a spinner: this stands in for the page's own
  // content, so it should hold that shape while it loads.
  return (
    <div className="rounded-3xl border border-background-200 bg-white p-5">
      <RowsSkeleton rows={5} />
    </div>
  );
}
