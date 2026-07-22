import { EmptyState } from '@/pages/users/components/ui';
import { formatDisplayDate, formatPercent, type CaseFileTabProps } from '../data';

export default function AttendanceTab({ data }: CaseFileTabProps) {
  const attendance = data.attendance;

  if (!attendance || !attendance.hasAttendance) {
    return (
      <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-6">
        <EmptyState text="Live attendance detail is not available for this learner yet." />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon="ri-calendar-check-line" label="Attendance Rate" value={formatPercent(attendance.attendance)} tone={attendanceTone(attendance.attendance)} />
        <StatCard icon="ri-list-check-3" label="Tracked Sessions" value={String(attendance.sessions ?? '--')} tone="primary" />
        <StatCard icon="ri-check-double-line" label="Present" value={String(attendance.present ?? '--')} tone="emerald" />
        <StatCard icon="ri-close-circle-line" label="Absent" value={String(attendance.absent ?? '--')} tone={attendance.absent ? 'red' : 'primary'} />
      </section>

      <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
        <div className="p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
              <i className="ri-radar-line text-emerald-500"></i> Attendance Snapshot
            </h2>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${riskBadge(attendance.risk)}`}>
              {riskLabel(attendance.risk)}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DetailCard
              title="Trend"
              value={trendLabel(attendance.trend)}
              detail="Based on the most recent attendance records in the coach dashboard."
              icon={attendance.trend === 'up' ? 'ri-arrow-up-line' : attendance.trend === 'down' ? 'ri-arrow-down-line' : 'ri-subtract-line'}
            />
            <DetailCard
              title="Last Session"
              value={attendance.lastSession || '--'}
              detail={attendance.lastSessionDate ? `Recorded ${formatDisplayDate(attendance.lastSessionDate)}` : '--'}
              icon="ri-calendar-event-line"
            />
            <DetailCard
              title="Consecutive Missed"
              value={String(attendance.consecutiveMissed ?? 0)}
              detail="Helpful for spotting early disengagement."
              icon="ri-alarm-warning-line"
            />
            <DetailCard
              title="Programme Cohort"
              value={attendance.cohort || '--'}
              detail={attendance.group ? `Group ${attendance.group}` : '--'}
              icon="ri-group-line"
            />
          </div>
        </div>
      </section>

      <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
        <div className="p-5 md:p-6">
          <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2 mb-3">
            <i className="ri-information-line text-primary-500"></i> Attendance Notes
          </h2>
          <div className="space-y-2 text-[12px] text-foreground-600">
            <p>
              This tab is now using the live coach attendance endpoint for learner-level metrics such as attendance percentage,
              present versus absent counts, last session date, and trend direction.
            </p>
            <p>
              Session-by-session logs and heatmaps are not exposed by the current backend yet, so the old static mock timeline
              was removed to avoid showing invented attendance history.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: string;
  label: string;
  value: string;
  tone: 'primary' | 'emerald' | 'amber' | 'red';
}) {
  const toneMap = {
    primary: 'bg-primary-100 text-primary-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    amber: 'bg-amber-100 text-amber-600',
    red: 'bg-red-100 text-red-600',
  } as const;

  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${toneMap[tone]}`}>
        <i className={`${icon} text-base`}></i>
      </div>
      <p className="text-xl font-heading font-bold text-foreground-900">{value}</p>
      <p className="text-[11px] text-foreground-400">{label}</p>
    </div>
  );
}

function DetailCard({
  title,
  value,
  detail,
  icon,
}: {
  title: string;
  value: string;
  detail: string;
  icon: string;
}) {
  return (
    <div className="rounded-xl border border-background-200/70 bg-background-100/50 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-8 h-8 rounded-lg bg-background-50 border border-background-200 flex items-center justify-center">
          <i className={`${icon} text-sm text-foreground-600`}></i>
        </span>
        <p className="text-[12px] font-semibold text-foreground-900">{title}</p>
      </div>
      <p className="text-lg font-heading font-bold text-foreground-900">{value}</p>
      <p className="text-[11px] text-foreground-400 mt-1">{detail}</p>
    </div>
  );
}

function attendanceTone(value: number | null): 'primary' | 'emerald' | 'amber' | 'red' {
  if (value === null) return 'primary';
  if (value >= 90) return 'emerald';
  if (value >= 80) return 'amber';
  return 'red';
}

function riskLabel(risk: 'red' | 'amber' | 'green' | null) {
  if (risk === 'green') return 'On Track';
  if (risk === 'amber') return 'Needs Attention';
  if (risk === 'red') return 'At Risk';
  return 'Not Rated';
}

function riskBadge(risk: 'red' | 'amber' | 'green' | null) {
  if (risk === 'green') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (risk === 'amber') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (risk === 'red') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-background-100 text-foreground-500 border-background-200';
}

function trendLabel(trend: 'up' | 'down' | 'stable') {
  if (trend === 'up') return 'Improving';
  if (trend === 'down') return 'Declining';
  return 'Stable';
}
