import { EmptyState } from '@/components/ui/EmptyState';
import { MetricCard } from '@/components/ui/MetricCard';
import { Panel } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ATTENDANCE_EXPECTED_RATE, ATTENDANCE_MINIMUM_RATE } from '@/lib/format';
import { statusTone, type StatusTone } from '@/lib/statusTone';
import { formatDisplayDate, formatPercent, type CaseFileTabProps } from '../data';

export default function AttendanceTab({ data }: CaseFileTabProps) {
  const attendance = data.attendance;

  if (!attendance || !attendance.hasAttendance) {
    return (
      <Panel padding="lg">
        <EmptyState
          variant="empty"
          size="md"
          title="Attendance data unavailable"
          description="Live attendance detail is not available for this learner yet."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard icon="ri-calendar-check-line" label="Attendance Rate" value={formatPercent(attendance.attendance)} tone={attendanceTone(attendance.attendance)} />
        <MetricCard icon="ri-list-check-3" label="Tracked Sessions" value={attendance.sessions ?? '--'} tone="brand" />
        <MetricCard icon="ri-check-double-line" label="Present" value={attendance.present ?? '--'} tone="positive" />
        <MetricCard icon="ri-close-circle-line" label="Absent" value={attendance.absent ?? '--'} tone={attendance.absent ? 'critical' : 'brand'} />
      </section>

      <section className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
        <div className="p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-heading font-semibold text-foreground-900 flex items-center gap-2">
              <AppIcon className="ri-radar-line text-emerald-500"></AppIcon> Attendance Snapshot
            </h2>
            <StatusBadge tone={statusTone(attendance.risk)} label={riskLabel(attendance.risk)} />
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
            <AppIcon className="ri-information-line text-primary-500"></AppIcon> Attendance Notes
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
    <Panel padding="md">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-8 h-8 rounded-lg bg-background-100 border border-foreground-200/60 flex items-center justify-center">
          <AppIcon className={`${icon} text-sm text-foreground-600`}></AppIcon>
        </span>
        <p className="text-[12px] font-semibold text-foreground-900">{title}</p>
      </div>
      <p className="text-lg font-heading font-bold text-foreground-900">{value}</p>
      <p className="text-[12px] text-foreground-400 mt-1">{detail}</p>
    </Panel>
  );
}

function attendanceTone(value: number | null): StatusTone {
  if (value === null) return 'neutral';
  if (value >= ATTENDANCE_EXPECTED_RATE) return 'positive';
  if (value >= ATTENDANCE_MINIMUM_RATE) return 'caution';
  return 'critical';
}

function riskLabel(risk: 'red' | 'amber' | 'green' | null) {
  if (risk === 'green') return 'On Track';
  if (risk === 'amber') return 'Needs Attention';
  if (risk === 'red') return 'At Risk';
  return 'Not Rated';
}

function trendLabel(trend: 'up' | 'down' | 'stable') {
  if (trend === 'up') return 'Improving';
  if (trend === 'down') return 'Declining';
  return 'Stable';
}
