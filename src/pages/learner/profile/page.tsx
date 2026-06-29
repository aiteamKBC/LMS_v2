import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_FULL_PROFILE } from '@/mocks/learner-profile';
import { ProfileTabs } from './components/ProfileTabs';

const learnerNav = roleNavMap.learner;

/* ── Circular Progress ── */
function CircularProgress({ value, size = 56, stroke = 5, color }: { value: number; size?: number; stroke?: number; color: 'primary' | 'accent' | 'secondary' | 'emerald' | 'amber' | 'red' }) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (Math.min(value, 100) / 100) * circumference;
  const colorMap = {
    primary: 'stroke-primary-500',
    accent: 'stroke-accent-500',
    secondary: 'stroke-secondary-500',
    emerald: 'stroke-emerald-500',
    amber: 'stroke-amber-500',
    red: 'stroke-red-500',
  };
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-background-200" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" className={colorMap[color]} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} style={{ transition: 'stroke-dashoffset 0.7s ease-out' }} />
    </svg>
  );
}

/* ── Summary Card (for modal) ── */
function SummaryCard({ icon, label, value, detail, status, progress, color }: {
  icon: string; label: string; value: string; detail: string;
  status: 'green' | 'amber' | 'red'; progress: number; color: 'emerald' | 'amber' | 'red';
}) {
  const statusBg = status === 'green' ? 'bg-emerald-50 text-emerald-700' : status === 'amber' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700';
  const statusLabel = status === 'green' ? 'On Track' : status === 'amber' ? 'Needs Attention' : 'Action Required';
  const iconBg = status === 'green' ? 'bg-emerald-100 text-emerald-600' : status === 'amber' ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-600';
  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconBg}`}><i className={`${icon} text-sm`}></i></span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusBg}`}>{statusLabel}</span>
      </div>
      <div className="flex items-center gap-3">
        <CircularProgress value={progress} color={color} size={42} stroke={4.5} />
        <div className="min-w-0">
          <p className="text-xs text-foreground-400 mb-0.5">{label}</p>
          <p className="text-lg font-heading font-semibold text-foreground-900 leading-tight">{value}</p>
        </div>
      </div>
      <p className="text-xs text-foreground-400 mt-2">{detail}</p>
    </div>
  );
}

/* ── Summary Report Modal ── */
function SummaryReportModal({ open, onClose, summaries }: { open: boolean; onClose: () => void; summaries: any[] }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-foreground-950/40 backdrop-blur-sm" />
      <div
        className="relative bg-background-50 rounded-2xl border border-foreground-200 w-full max-w-4xl max-h-[80vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-background-50 border-b border-foreground-200 px-5 md:px-7 py-4 flex items-center justify-between rounded-t-2xl z-10">
          <div>
            <h2 className="text-base font-heading font-semibold text-foreground-900">Personal Learning Summary</h2>
            <p className="text-sm text-foreground-500 mt-0.5">Sophie Williams · Marketing Executive Level 4</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-background-100 hover:bg-background-200 flex items-center justify-center transition-smooth cursor-pointer"
          >
            <i className="ri-close-line text-foreground-500"></i>
          </button>
        </div>
        <div className="p-5 md:p-7 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          {summaries.map((s, i) => (
            <SummaryCard key={i} {...s} />
          ))}
        </div>
        <div className="border-t border-foreground-200 px-5 md:px-7 py-4 flex items-center justify-between">
          <span className="text-xs text-foreground-400">Data as at 12/06/2026</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-full bg-primary-500 text-background-50 dark:text-foreground-950 text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
          >
            Close Report
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Stat Card ── */
function StatCard({ icon, iconColor, label, value, sublabel, progress, color }: {
  icon: string; iconColor: string; label: string; value: string; sublabel: string;
  progress?: number; color?: 'primary' | 'accent' | 'secondary' | 'emerald' | 'amber' | 'red';
}) {
  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 flex items-center gap-3 hover:scale-[1.02] hover:shadow-sm transition-all duration-200">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconColor}`}>
        <i className={`${icon} text-base`}></i>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-foreground-400 mb-0.5">{label}</p>
        <p className="text-sm font-semibold text-foreground-900">{value}</p>
        {progress !== undefined && color && (
          <div className="mt-1.5">
            <div className="h-1.5 rounded-full bg-background-200 overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${progress}%`, backgroundColor: `oklch(var(--${color}-500))` }} />
            </div>
          </div>
        )}
        <p className="text-[10px] text-foreground-400 mt-1">{sublabel}</p>
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   PAGE
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
export default function LearnerProfilePage() {
  const p = LEARNER_FULL_PROFILE;

  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showSummary, setShowSummary] = useState(false);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhotoUrl(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleRemovePhoto = () => {
    setPhotoUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePrint = () => {
    window.print();
  };

  const acceptedFormats = '.jpg,.jpeg,.png,.webp';

  const summaries = [
    { icon: 'ri-pie-chart-line', label: 'Programme Progress', value: `${p.programmeProgress}%`, detail: `Week ${Math.round(p.programmeProgress / 1.2)} of 72`, status: 'green' as const, progress: p.programmeProgress, color: 'emerald' as const },
    { icon: 'ri-calendar-check-line', label: 'Attendance', value: `${p.attendanceRate}%`, detail: `${p.sessionsAttended}/${p.sessionsAttended + p.sessionsMissed} sessions`, status: p.attendanceRate >= 90 ? 'green' as const : p.attendanceRate >= 80 ? 'amber' as const : 'red' as const, progress: p.attendanceRate, color: p.attendanceRate >= 90 ? 'emerald' as const : p.attendanceRate >= 80 ? 'amber' as const : 'red' as const },
    { icon: 'ri-time-line', label: 'OTJ Hours', value: `${p.otjhCompleted} / ${p.otjhTarget}`, detail: `${Math.round((p.otjhCompleted / p.otjhTarget) * 100)}% of target`, status: p.otjhCompleted / p.otjhTarget >= 0.7 ? 'green' as const : p.otjhCompleted / p.otjhTarget >= 0.5 ? 'amber' as const : 'red' as const, progress: (p.otjhCompleted / p.otjhTarget) * 100, color: p.otjhCompleted / p.otjhTarget >= 0.7 ? 'emerald' as const : p.otjhCompleted / p.otjhTarget >= 0.5 ? 'amber' as const : 'red' as const },
    { icon: 'ri-folder-upload-line', label: 'Evidence Submitted', value: `${p.evidenceSubmitted}`, detail: `${p.evidenceApproved} approved`, status: 'green' as const, progress: (p.evidenceApproved / Math.max(p.evidenceSubmitted, 1)) * 100, color: 'emerald' as const },
    { icon: 'ri-check-double-line', label: 'Evidence Approved', value: `${p.evidenceApproved}`, detail: `${p.evidenceSubmitted - p.evidenceApproved} pending review`, status: 'green' as const, progress: (p.evidenceApproved / 12) * 100, color: 'emerald' as const },
    { icon: 'ri-bar-chart-2-line', label: 'KSB Progress', value: `${p.ksbProgress}%`, detail: `${p.ksbValidated} of ${p.ksbTotal} validated`, status: p.ksbProgress >= 50 ? 'green' as const : p.ksbProgress >= 30 ? 'amber' as const : 'red' as const, progress: p.ksbProgress, color: p.ksbProgress >= 50 ? 'emerald' as const : p.ksbProgress >= 30 ? 'amber' as const : 'red' as const },
    { icon: 'ri-chat-smile-2-line', label: 'Coaching Attendance', value: `${p.coachingAttendance}/${p.coachingScheduled}`, detail: `${Math.round((p.coachingAttendance / p.coachingScheduled) * 100)}% attended`, status: p.coachingAttendance / p.coachingScheduled >= 0.8 ? 'green' as const : 'amber' as const, progress: (p.coachingAttendance / p.coachingScheduled) * 100, color: p.coachingAttendance / p.coachingScheduled >= 0.8 ? 'emerald' as const : 'amber' as const },
    { icon: 'ri-briefcase-line', label: 'Portfolio Completion', value: `${p.portfolioCompletion}%`, detail: 'In progress', status: p.portfolioCompletion >= 50 ? 'green' as const : p.portfolioCompletion >= 25 ? 'amber' as const : 'red' as const, progress: p.portfolioCompletion, color: p.portfolioCompletion >= 50 ? 'emerald' as const : p.portfolioCompletion >= 25 ? 'amber' as const : 'red' as const },
    { icon: 'ri-task-line', label: 'Checkpoint Progress', value: `${p.checkpointProgress}%`, detail: `${p.checkpointsCompleted}/${p.checkpointsTotal} completed`, status: p.checkpointProgress >= 50 ? 'green' as const : 'amber' as const, progress: p.checkpointProgress, color: p.checkpointProgress >= 50 ? 'emerald' as const : 'amber' as const },
    { icon: 'ri-chat-smile-2-line', label: 'Latest Coaching Session', value: p.latestCoachingDate, detail: p.latestCoachingTopic, status: 'green' as const, progress: 100, color: 'emerald' as const },
    { icon: 'ri-file-chart-line', label: 'Next Progress Review', value: p.nextReviewDate, detail: p.nextReviewFocus, status: 'green' as const, progress: 100, color: 'emerald' as const },
  ];

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle={p.fullName}
      pageSubtitle="Learner Profile"
      userName={p.fullName}
      userRole={`${p.programme} Apprentice`}
    >
      <div className="p-3 md:p-6 space-y-5 md:space-y-6">

        {/* Back to Overview */}
        <Link
          to="/workspace/learner"
          className="inline-flex items-center gap-2 text-sm text-foreground-500 hover:text-primary-600 transition-smooth cursor-pointer group"
        >
          <span className="w-7 h-7 rounded-lg bg-background-100 group-hover:bg-primary-100 flex items-center justify-center transition-smooth">
            <i className="ri-arrow-left-line text-sm"></i>
          </span>
          <span className="font-medium">Back to Overview</span>
        </Link>

        {/* ═══════════════════════════════════════════════════════════
            HERO — Professional Profile Card
            ═══════════════════════════════════════════════════════════ */}
        <section className="relative rounded-2xl overflow-hidden print:hidden" style={{ background: 'linear-gradient(135deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 40%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute animate-liquid-blob-1 opacity-25" style={{ width: '60%', height: '30%', left: '-10%', top: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, transparent 70%)', filter: 'blur(60px)' }} />
            <div className="absolute animate-liquid-blob-2 opacity-15" style={{ width: '70%', height: '35%', right: '-15%', top: '15%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, transparent 70%)', filter: 'blur(55px)' }} />
          </div>
          
          <div className="relative flex flex-col md:flex-row items-start md:items-center gap-5 px-6 py-6 md:px-8 md:py-7">
            {/* Avatar */}
            <div className="relative group cursor-pointer shrink-0" onClick={() => fileInputRef.current?.click()}>
              {photoUrl ? (
                <img src={photoUrl} alt={p.fullName} className="w-20 h-20 rounded-2xl object-cover ring-2 ring-accent-300/50" />
              ) : (
                <div className="w-20 h-20 rounded-2xl bg-accent-400 flex items-center justify-center">
                  <span className="text-2xl font-bold text-foreground-950">SW</span>
                </div>
              )}
              <div className="absolute inset-0 rounded-2xl bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
                <i className="ri-camera-line text-white text-sm opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              {photoUrl && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleRemovePhoto(); }}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                  title="Remove photo"
                >
                  <i className="ri-close-line text-[10px]" />
                </button>
              )}
              <input ref={fileInputRef} type="file" accept={acceptedFormats} onChange={handlePhotoUpload} className="hidden" />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3 mb-2">
                <h1 className="text-xl md:text-2xl font-heading font-bold text-white tracking-tight">{p.fullName}</h1>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-400/15 text-emerald-300 border border-emerald-400/20 text-xs font-semibold w-fit">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  {p.status}
                </span>
              </div>

              <p className="text-sm text-white/50 mb-3">
                {p.programme} · {p.programmeLevel} · {p.employer}
              </p>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-white/40">
                <span className="inline-flex items-center gap-1">
                  <i className="ri-user-line text-foreground-300" />
                  {p.lineManager.name}
                  <span className="text-foreground-300">Manager</span>
                </span>
                <span className="text-foreground-200">·</span>
                <span className="inline-flex items-center gap-1">
                  <i className="ri-user-star-line text-foreground-300" />
                  {p.coach.name}
                  <span className="text-foreground-300">Coach</span>
                </span>
                <span className="text-foreground-200">·</span>
                <span className="inline-flex items-center gap-1">
                  <i className="ri-calendar-line text-foreground-300" />
                  {p.startDate} — {p.plannedEndDate}
                </span>
                <span className="text-foreground-200">·</span>
                <span className="inline-flex items-center gap-1">
                  <i className="ri-id-card-line text-foreground-300" />
                  {p.uln}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowSummary(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-500 text-background-50 dark:text-foreground-950 text-sm font-semibold hover:bg-primary-600 transition-all cursor-pointer whitespace-nowrap"
              >
                <i className="ri-file-chart-line text-sm" />
                View Summary
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 text-white text-sm font-medium hover:bg-white/20 transition-all cursor-pointer whitespace-nowrap"
              >
                <i className="ri-download-line text-sm" />
                Print
              </button>
            </div>
          </div>
        </section>

        {/* Print-only header */}
        <div className="hidden print:block p-6 border border-foreground-200 rounded-xl mb-6">
          <h1 className="text-xl font-bold text-foreground-950">{p.fullName}</h1>
          <p className="text-sm text-foreground-500">{p.programme} · {p.programmeLevel}</p>
          <p className="text-sm text-foreground-500">{p.employer} · {p.lineManager.name} · ULN {p.uln}</p>
        </div>

        {/* ═══════════════════════════════════════════════════════════
            STATS ROW — Quick Progress Overview
            ═══════════════════════════════════════════════════════════ */}
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard
            icon="ri-pie-chart-line"
            iconColor="bg-primary-100 text-primary-600"
            label="Progress"
            value={`${p.programmeProgress}%`}
            sublabel={`Week ${Math.round(p.programmeProgress / 1.2)} of 72`}
            progress={p.programmeProgress}
            color="primary"
          />
          <StatCard
            icon="ri-calendar-check-line"
            iconColor="bg-accent-100 text-accent-600"
            label="Attendance"
            value={`${p.attendanceRate}%`}
            sublabel={`${p.sessionsAttended} of ${p.sessionsAttended + p.sessionsMissed} sessions`}
            progress={p.attendanceRate}
            color="accent"
          />
          <StatCard
            icon="ri-time-line"
            iconColor="bg-secondary-100 text-secondary-600"
            label="OTJ Hours"
            value={`${p.otjhCompleted} / ${p.otjhTarget}`}
            sublabel={`${Math.round((p.otjhCompleted / p.otjhTarget) * 100)}% of target`}
            progress={(p.otjhCompleted / p.otjhTarget) * 100}
            color="secondary"
          />
          <StatCard
            icon="ri-bar-chart-2-line"
            iconColor="bg-emerald-100 text-emerald-600"
            label="KSB Progress"
            value={`${p.ksbProgress}%`}
            sublabel={`${p.ksbValidated} of ${p.ksbTotal} validated`}
            progress={p.ksbProgress}
            color="emerald"
          />
          <StatCard
            icon="ri-folder-upload-line"
            iconColor="bg-amber-100 text-amber-600"
            label="Evidence"
            value={`${p.evidenceSubmitted}`}
            sublabel={`${p.evidenceApproved} approved`}
            progress={(p.evidenceApproved / Math.max(p.evidenceSubmitted, 1)) * 100}
            color="amber"
          />
          <StatCard
            icon="ri-check-double-line"
            iconColor="bg-primary-100 text-primary-600"
            label="Onboarding"
            value={`${p.onboardingProgress}%`}
            sublabel={`${p.onboardingSteps.filter(s => s.status === 'completed').length} of ${p.onboardingSteps.length} steps`}
            progress={p.onboardingProgress}
            color="primary"
          />
        </section>

        {/* ═══════════════════════════════════════════════════════════
            PROFILE TABS
            ═══════════════════════════════════════════════════════════ */}
        <ProfileTabs profile={p} />

        {/* ═══════════════════════════════════════════════════════════
            SUMMARY MODAL
            ═══════════════════════════════════════════════════════════ */}
        <SummaryReportModal open={showSummary} onClose={() => setShowSummary(false)} summaries={summaries} />

      </div>
    </WorkspaceShell>
  );
}