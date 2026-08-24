// ============================================================================
// Monthly Cycle — tone mapping onto the shared statusTone table.
//
// This page used to carry its own independent `statusConfig` / `toneConfig`
// pair alongside the shared one. It is retired in favour of the workspace's
// `@/lib/statusTone`; the two small maps below translate this page's own
// vocabulary (a learner status, a coaching-delivery status, an activity tone)
// onto the shared `StatusTone` so `StatusBadge`, `MetricCard` and friends can
// resolve colour the same way every other coach page does.
// ============================================================================
import type { StatusTone } from '@/lib/statusTone';
import type { ActivityTone, CoachingDeliveryStatus } from '../types';

/**
 * The four activity tones the API emits map onto the four risk/brand tones:
 * `primary` (brand-purple accents, e.g. Progress Reviews) onto `brand`,
 * `emerald` onto `positive`, `amber` onto `caution`, `red` onto `critical`.
 */
const ACTIVITY_TONE: Record<ActivityTone, StatusTone> = {
  primary: 'brand',
  emerald: 'positive',
  amber: 'caution',
  red: 'critical',
};

export function activityStatusTone(tone: ActivityTone): StatusTone {
  return ACTIVITY_TONE[tone] || 'brand';
}

/**
 * Coaching-delivery status is a fact about scheduling, not a risk grade, so
 * "booked" reads as `info` (a neutral fact about time) rather than a colour
 * that implies something is wrong.
 */
const COACHING_DELIVERY_TONE: Record<CoachingDeliveryStatus, StatusTone> = {
  booked: 'info',
  completed: 'positive',
  cancelled: 'critical',
  'needs-schedule': 'caution',
};

export function coachingDeliveryStatusTone(status: CoachingDeliveryStatus): StatusTone {
  return COACHING_DELIVERY_TONE[status] || 'neutral';
}
