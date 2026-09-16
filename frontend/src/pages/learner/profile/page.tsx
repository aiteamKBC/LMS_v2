import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { formatHoursMinutes } from '@/lib/format';
import { roleNavMap } from '@/mocks/navigation';
import { useLearnerDetailParam } from '@/hooks/useLearnerDetailParam';
import { LearnerLoadError } from '@/components/feature/LearnerLoadError';
import { fetchLearnerAttendance, type LearnerAttendance } from '@/api/learnerAttendance';
import { useMyLearner } from '@/hooks/useMyLearner';
import { useOnboardingRedirect } from '@/hooks/useOnboardingRedirect';
import { useAuth } from '@/hooks/useAuth';
import { RowsSkeleton } from '@/components/feature/Skeletons';
import { LearnerProfilePhoto } from '@/components/feature/LearnerProfilePhoto';

const learnerNav = roleNavMap.learner;

function numberValue(value?: string) {
  const parsed = Number.parseFloat(value || '0');
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function LearnerProfilePage() {
  const { auth } = useAuth();
  const navigate = useNavigate();
  const myLearner = useMyLearner();
  const { real: learner, loading, loadError: error, refresh } = useLearnerDetailParam(myLearner.kind, myLearner.id);
  const [attendance, setAttendance] = useState<LearnerAttendance | null>(null);
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [attendanceError, setAttendanceError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setAttendance(null);
    setAttendanceLoading(true);
    setAttendanceError(false);
    fetchLearnerAttendance(myLearner.kind, myLearner.id)
      .then(record => { if (!cancelled) setAttendance(record); })
      .catch(() => { if (!cancelled) setAttendanceError(true); })
      .finally(() => { if (!cancelled) setAttendanceLoading(false); });
    return () => { cancelled = true; };
  }, [myLearner.id, myLearner.kind]);

  const redirectingToOnboarding = useOnboardingRedirect(
    learner?.programmeStatus,
    !loading && auth.account?.role !== 'admin',
    myLearner.kind,
  );
  const completedHours = numberValue(learner?.completedHours);
  const plannedHours = numberValue(learner?.plannedHours) || learner?.totalExpectedOtjh || 0;
  const otjProgress = plannedHours ? Math.min(Math.round((completedHours / plannedHours) * 100), 100) : 0;
  const completedActivities = (learner?.activityFeed || []).length;

  if (redirectingToOnboarding) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[13px] text-foreground-400">
        <AppIcon className="ri-loader-4-line mr-2 animate-spin"></AppIcon>Opening your enrolment…
      </div>
    );
  }

  return (
    <WorkspaceShell role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel} pageTitle={learner?.name || 'Profile'} pageSubtitle="Learner profile" userName={learner?.name || 'Learner'} userRole={learner?.programme ? `${learner.programme} Apprentice` : 'Apprentice'}>
      <main className="page-container mx-auto min-w-0 w-full max-w-[1480px] space-y-5 px-4 py-5 md:px-7 md:py-7">
        <button type="button" onClick={() => navigate(`/workspace/learner/${myLearner.kind}/${myLearner.id}/dashboard`)} className="group inline-flex items-center gap-2 text-[13px] font-semibold text-foreground-500 transition hover:text-primary-800 print:hidden">
          <AppIcon className="ri-arrow-left-line text-base transition-transform group-hover:-translate-x-0.5"></AppIcon>
          Back to dashboard
        </button>

        {loading ? <Loading /> : error ? <LearnerLoadError error={error} onRetry={refresh} /> : learner && <>
          <section className="relative overflow-hidden rounded-2xl border border-background-200 bg-white shadow-[0_12px_35px_rgba(18,38,63,0.06)]">
            <div className="h-1.5 bg-primary-900" />
            <div className="flex flex-col gap-6 px-5 py-6 md:flex-row md:items-center md:px-7 md:py-7">
              <LearnerProfilePhoto kind={myLearner.kind} learnerId={myLearner.id} name={learner.name} className="!h-20 !w-20 !bg-primary-900 !text-white !shadow-[0_0_0_5px_rgba(226,232,240,0.8)]" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-2xl font-bold tracking-tight text-foreground-950 md:text-[28px]">{learner.name}</h1>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset ${learner.isActive ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-background-100 text-foreground-600 ring-background-300'}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${learner.isActive ? 'bg-emerald-500' : 'bg-foreground-400'}`} />
                    {learner.isActive ? 'Active learner' : learner.programmeStatus || 'Inactive'}
                  </span>
                </div>
                <p className="mt-1.5 text-[15px] font-medium text-foreground-600">{learner.programme || 'Programme not set'}</p>
                <p className="mt-1 text-sm text-foreground-400">{learner.employer || 'Employer not set'}{learner.cohort ? ` · ${learner.cohort}` : ''}</p>
                <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2.5 text-[13px] text-foreground-600">
                  <span className="inline-flex min-w-0 items-center gap-2"><AppIcon className="ri-mail-line shrink-0 text-foreground-400"></AppIcon><span className="truncate">{learner.email || 'Email not set'}</span></span>
                  <span className="inline-flex items-center gap-2"><AppIcon className="ri-phone-line text-foreground-400"></AppIcon>{learner.phone || 'Phone not set'}</span>
                  <span className="inline-flex items-center gap-2"><AppIcon className="ri-id-card-line text-foreground-400"></AppIcon>Learner ID {learner.id}</span>
                </div>
              </div>
              <button onClick={() => window.print()} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 self-start rounded-lg border border-background-300 bg-white px-4 text-[13px] font-semibold text-foreground-700 shadow-sm transition hover:border-primary-300 hover:bg-primary-50 hover:text-primary-800 md:self-center print:hidden">
                <AppIcon className="ri-printer-line"></AppIcon>Print profile
              </button>
            </div>
          </section>

          <section aria-labelledby="progress-overview-title" className="overflow-hidden rounded-2xl border border-background-200 bg-white shadow-[0_8px_28px_rgba(18,38,63,0.045)]">
            <div className="flex flex-col gap-1 border-b border-background-200 px-5 py-4 md:px-6">
              <h2 id="progress-overview-title" className="text-base font-bold text-foreground-950">Progress overview</h2>
              <p className="text-xs text-foreground-500">A concise view of your current apprenticeship progress.</p>
            </div>
            <div className="grid divide-y divide-background-200 md:grid-cols-3 md:divide-x md:divide-y-0">
              <ProgressStat icon="ri-calendar-check-line" label="Attendance" value={attendance ? `${attendance.attendanceRate}%` : '—'} detail={attendance ? `${attendance.present} of ${attendance.sessions} sessions attended` : 'No attendance record'} progress={attendance?.attendanceRate || 0} tone="emerald" />
              <ProgressStat icon="ri-time-line" label="Off-the-job training" value={formatHoursMinutes(completedHours)} detail={`${formatHoursMinutes(plannedHours)} planned · ${otjProgress}% complete`} progress={otjProgress} tone="primary" />
              <div className="px-5 py-5 md:px-6">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground-400">Learning plan</p>
                <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
                  <CompactStat label="Modules" value={learner.modules.length} />
                  <CompactStat label="Weeks" value={learner.week.length} />
                  <CompactStat label="Activities" value={completedActivities} />
                  <CompactStat label="KSBs" value={learner.ksbs.length} />
                </div>
              </div>
            </div>
          </section>

          <div className="grid items-start gap-5 lg:grid-cols-2">
            <ProfileSection icon="ri-user-line" title="Personal details" description="Contact and workplace information">
              <DetailGroup title="Contact">
                <DetailRow label="Full name" value={learner.name} />
                <DetailRow label="Email" value={learner.email} />
                <DetailRow label="Phone" value={learner.phone} />
                <DetailRow label="Learner reference" value={`${myLearner.kind} · ID ${learner.id}`} />
              </DetailGroup>
              <DetailGroup title="Workplace & support">
                <DetailRow label="Employer" value={learner.employer} />
                <DetailRow label="Line manager" value={learner.lineManager} />
                <DetailRow label="Attendance risk" value={attendanceLoading ? 'Loading attendance…' : attendanceError ? 'Temporarily unavailable' : attendance?.risk ? attendance.risk[0].toUpperCase() + attendance.risk.slice(1) : 'No record'} />
                <DetailRow label="Last attendance" value={attendanceLoading ? 'Loading attendance…' : attendanceError ? 'Temporarily unavailable' : attendance?.lastSessionDate ? new Date(attendance.lastSessionDate).toLocaleDateString('en-GB') : 'Not recorded'} />
              </DetailGroup>
            </ProfileSection>

            <ProfileSection icon="ri-graduation-cap-line" title="Apprenticeship" description="Programme placement and learning plan">
              <DetailGroup title="Programme">
                <DetailRow label="Programme" value={learner.programme} />
                <DetailRow label="Status" value={learner.programmeStatus} />
                <DetailRow label="Cohort" value={learner.cohort} />
                <DetailRow label="Group" value={learner.group} />
              </DetailGroup>
              <DetailGroup title="Plan totals">
                <DetailRow label="Assigned modules" value={String(learner.modules.length)} />
                <DetailRow label="Assigned components" value={String(learner.components.length)} />
                <DetailRow label="Planned OTJ hours" value={formatHoursMinutes(plannedHours)} />
                <DetailRow label="Completed OTJ hours" value={formatHoursMinutes(completedHours)} />
              </DetailGroup>
            </ProfileSection>
          </div>
        </>}
      </main>
    </WorkspaceShell>
  );
}

function ProgressStat({ icon, label, value, detail, progress, tone }: { icon: string; label: string; value: string; detail: string; progress: number; tone: 'primary' | 'emerald' }) {
  const bar = tone === 'emerald' ? 'bg-emerald-600' : 'bg-primary-800';
  const iconTone = tone === 'emerald' ? 'bg-emerald-50 text-emerald-700' : 'bg-primary-50 text-primary-800';
  return <article className="px-5 py-5 md:px-6">
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground-400">{label}</p>
        <p className="mt-2 text-2xl font-bold tracking-tight text-foreground-950">{value}</p>
      </div>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconTone}`}><AppIcon className={icon}></AppIcon></span>
    </div>
    <p className="mt-1 text-xs text-foreground-500">{detail}</p>
    <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-background-200"><div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.max(0, Math.min(progress, 100))}%` }} /></div>
  </article>;
}

function CompactStat({ label, value }: { label: string; value: number }) {
  return <div><p className="text-xl font-bold text-foreground-900">{value}</p><p className="mt-0.5 text-xs text-foreground-500">{label}</p></div>;
}

function ProfileSection({ icon, title, description, children }: { icon: string; title: string; description: string; children: React.ReactNode }) {
  return <section className="overflow-hidden rounded-2xl border border-background-200 bg-white shadow-[0_8px_28px_rgba(18,38,63,0.045)]">
    <div className="flex items-center gap-3 border-b border-background-200 px-5 py-4 md:px-6">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-background-100 text-primary-900"><AppIcon className={icon}></AppIcon></span>
      <div><h2 className="text-[15px] font-bold text-foreground-950">{title}</h2><p className="mt-0.5 text-[11px] text-foreground-400">{description}</p></div>
    </div>
    <div className="px-5 py-1 md:px-6">{children}</div>
  </section>;
}

function DetailGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="border-b border-background-200 py-4 last:border-b-0"><h3 className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-foreground-400">{title}</h3><div>{children}</div></div>;
}

function DetailRow({ label, value }: { label: string; value?: string }) {
  return <div className="grid gap-1 py-2.5 sm:grid-cols-[145px_minmax(0,1fr)] sm:gap-4"><p className="text-xs text-foreground-500">{label}</p><p className="break-words text-[13px] font-semibold text-foreground-800">{value || 'Not set'}</p></div>;
}

function Loading() {
  return <div className="rounded-2xl border border-background-200 bg-white p-5"><RowsSkeleton rows={5} /></div>;
}
