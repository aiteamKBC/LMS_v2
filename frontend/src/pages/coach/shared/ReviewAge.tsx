import dashboardStyles from '@/pages/workspace/coach/dashboard.module.css';
import { parseLocalDate } from './calendarEvents';

type ReviewAgeLabel = 'PR' | 'MCM';
type ReviewAgeTone = 'warning' | 'critical';

const REVIEW_AGE_THRESHOLDS: Record<ReviewAgeLabel, { warning: number; critical: number }> = {
  PR: { warning: 70, critical: 84 },
  MCM: { warning: 21, critical: 28 },
};

function completedDateLabel(value?: string | null) {
  const date = parseLocalDate(value);
  return date
    ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
    : '--';
}

function daysSince(value?: string | null, today = new Date()) {
  const date = parseLocalDate(value);
  if (!date) return null;
  const dateDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(0, Math.floor((todayDay - dateDay) / 86_400_000));
}

function reviewAgeTone(label: ReviewAgeLabel, days: number | null): ReviewAgeTone | null {
  if (days === null) return null;
  const thresholds = REVIEW_AGE_THRESHOLDS[label];
  if (days >= thresholds.critical) return 'critical';
  if (days >= thresholds.warning) return 'warning';
  return null;
}

export function ReviewAge({ value, label }: { value?: string | null; label: ReviewAgeLabel }) {
  const days = daysSince(value);
  const tone = reviewAgeTone(label, days);
  const dateLabel = completedDateLabel(value);
  const relativeLabel = days === null ? `No ${label} yet` : `${days} days ago`;

  return (
    <div
      className={dashboardStyles.reviewAge}
      data-tone={tone || undefined}
      aria-label={`Last ${label}: ${dateLabel}; ${relativeLabel}`}
    >
      <strong>{dateLabel}</strong>
      <small>{relativeLabel}</small>
    </div>
  );
}
