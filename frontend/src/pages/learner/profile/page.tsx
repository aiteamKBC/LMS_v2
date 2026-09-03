import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { formatHoursMinutes } from '@/lib/format';
import { roleNavMap } from '@/mocks/navigation';
import { fetchLearnerDetail, type LearnerDetail } from '@/api/learnerDetail';
import { fetchLearnerAttendance, type LearnerAttendance } from '@/api/learnerAttendance';
import { useMyLearner } from '@/hooks/useMyLearner';
import { useOnboardingRedirect } from '@/hooks/useOnboardingRedirect';
import { RowsSkeleton } from '@/components/feature/Skeletons';

const learnerNav = roleNavMap.learner;

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '–';
}

function numberValue(value?: string) {
  const parsed = Number.parseFloat(value || '0');
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function LearnerProfilePage() {
  const navigate = useNavigate();
  const myLearner = useMyLearner();
  const [learner, setLearner] = useState<LearnerDetail | null>(null);
  const [attendance, setAttendance] = useState<LearnerAttendance | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Still enrolling? The wizard is the only thing this learner can act on. The
  // profile body is held back while the redirect is in flight, so an onboarding
  // learner never sees a frame of the delivery profile before the wizard opens.
  const redirectingToOnboarding = useOnboardingRedirect(learner?.programmeStatus, !loading);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    Promise.all([fetchLearnerDetail(myLearner.kind, myLearner.id), fetchLearnerAttendance(myLearner.kind, myLearner.id)])
      .then(([detail, attendanceRecord]) => { if (!cancelled) { setLearner(detail); setAttendance(attendanceRecord); } })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load this learner.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [myLearner.id, myLearner.kind]);

  const completedHours = numberValue(learner?.completedHours);
  const plannedHours = numberValue(learner?.plannedHours) || learner?.totalExpectedOtjh || 0;
  const otjProgress = plannedHours ? Math.min(Math.round((completedHours / plannedHours) * 100), 100) : 0;
  const completedActivities = (learner?.activityFeed || []).length;

  function uploadPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhotoUrl(String(reader.result));
    reader.readAsDataURL(file);
  }

  if (redirectingToOnboarding) {
    return (
      <div className="min-h-screen flex items-center justify-center text-[13px] text-foreground-400">
        <AppIcon className="ri-loader-4-line animate-spin mr-2"></AppIcon>Opening your enrolment…
      </div>
    );
  }

  return (
    <WorkspaceShell role="learner" roleLabel={learnerNav.label} navItems={learnerNav.items} workspaceLabel={learnerNav.workspaceLabel} pageTitle={learner?.name || 'Profile'} pageSubtitle="Learner profile" userName={learner?.name || 'Learner'} userRole={learner?.programme ? `${learner.programme} Apprentice` : 'Apprentice'}>
      <main className="w-full space-y-5 p-4 md:p-6">
        <button type="button" onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-xs font-semibold text-foreground-500 transition hover:text-primary-700"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white shadow-sm"><AppIcon className="ri-arrow-left-line"></AppIcon></span>Back to overview</button>

        {loading ? <Loading /> : error ? <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700"><AppIcon className="ri-error-warning-line mr-2"></AppIcon>{error}</div> : learner && <>
        <section className="learner-super-admin-hero relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#17032d] via-[#33105e] to-[#6a2ca0] p-6 text-white shadow-[0_18px_50px_rgba(39,12,73,0.18)] md:p-7">
            <div className="pointer-events-none absolute -right-20 -top-32 h-80 w-80 rounded-full bg-secondary-300/15 blur-3xl"></div>
            <div className="relative flex flex-col gap-5 md:flex-row md:items-center">
              <button type="button" onClick={() => fileInputRef.current?.click()} className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-amber-400 text-2xl font-bold text-primary-950 ring-2 ring-white/15">
                {photoUrl ? <img src={photoUrl} alt="" className="h-full w-full object-cover" /> : initials(learner.name)}
                <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100"><AppIcon className="ri-camera-line text-base text-white"></AppIcon></span>
              </button>
              <input ref={fileInputRef} type="file" accept=".jpg,.jpeg,.png,.webp" onChange={uploadPhoto} className="hidden" />
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold text-white">{learner.name}</h1><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ring-inset ${learner.isActive ? 'bg-emerald-400/15 text-emerald-200 ring-emerald-300/20' : 'bg-white/10 text-white/60 ring-white/10'}`}>{learner.isActive ? 'Active learner' : learner.programmeStatus || 'Inactive'}</span></div><p className="mt-2 text-sm text-white/60">{learner.programme || 'Programme not set'}{learner.employer ? ` · ${learner.employer}` : ''}</p><div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-white/45"><span><AppIcon className="ri-mail-line mr-1.5"></AppIcon>{learner.email || 'Email not set'}</span><span><AppIcon className="ri-phone-line mr-1.5"></AppIcon>{learner.phone || 'Phone not set'}</span><span><AppIcon className="ri-id-card-line mr-1.5"></AppIcon>{myLearner.kind} #{learner.id}</span></div></div>
              <button onClick={() => window.print()} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-xs font-semibold text-white transition hover:bg-white/15"><AppIcon className="ri-printer-line"></AppIcon>Print profile</button>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard icon="ri-calendar-check-line" label="Attendance" value={attendance ? `${attendance.attendanceRate}%` : '–'} detail={attendance ? `${attendance.present} of ${attendance.sessions} sessions` : 'No record'} progress={attendance?.attendanceRate || 0} colour="bg-amber-50 text-amber-600" bar="bg-amber-500" />
            <StatCard icon="ri-time-line" label="OTJ hours" value={`${formatHoursMinutes(completedHours)} / ${formatHoursMinutes(plannedHours)}`} detail={`${otjProgress}% of plan`} progress={otjProgress} colour="bg-primary-50 text-primary-600" bar="bg-primary-600" />
            <StatCard icon="ri-stack-line" label="Modules" value={String(learner.modules.length)} detail="Assigned modules" colour="bg-secondary-50 text-secondary-600" />
            <StatCard icon="ri-calendar-todo-line" label="Weeks" value={String(learner.week.length)} detail="Planned weeks" colour="bg-blue-50 text-blue-600" />
            <StatCard icon="ri-checkbox-multiple-line" label="Activities" value={String(completedActivities)} detail="Recorded completions" colour="bg-emerald-50 text-emerald-600" />
            <StatCard icon="ri-bar-chart-box-line" label="KSBs" value={String(learner.ksbs.length)} detail="Programme KSBs" colour="bg-violet-50 text-violet-600" />
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
              <DetailRow label="Attendance risk" value={attendance?.risk ? attendance.risk[0].toUpperCase() + attendance.risk.slice(1) : 'No record'} />
              <DetailRow label="Last attendance session" value={attendance?.lastSessionDate ? new Date(attendance.lastSessionDate).toLocaleDateString('en-GB') : 'Not recorded'} />
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

function StatCard({ icon, label, value, detail, progress, colour, bar }: { icon: string; label: string; value: string; detail: string; progress?: number; colour: string; bar?: string }) { return <article className="coach-metric-card"><div className="flex items-start gap-3"><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${colour}`}><AppIcon className={icon}></AppIcon></span><div className="min-w-0"><p className="truncate text-[11px] font-medium text-foreground-500">{label}</p><p className="mt-1 text-[25px] font-semibold leading-none tabular-nums text-foreground-900">{value}</p></div></div>{progress !== undefined && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-background-200"><div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.min(progress, 100)}%` }}></div></div>}<p className="mt-1.5 truncate text-[11px] leading-snug text-foreground-500">{detail}</p></article>; }
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
