// ============================================================================
// Monthly Cycle — constants.
// ============================================================================
import type {
  CoachingDeliveryKind,
  CoachingDeliveryStatus,
  InlineActivityFilter,
  MonthlyLearnerActivity,
  MonthlyStatus,
  MonthlySummary,
} from '../types';

export const EMPTY_SUMMARY: MonthlySummary = {
  activeLearners: 0,
  timelineItems: 0,
  learningActivities: 0,
  quizzes: 0,
  videos: 0,
  components: 0,
  coachingSessions: 0,
  bookedSessions: 0,
  needsSchedule: 0,
  evidence: 0,
  ksbTouched: 0,
  otjhHours: 0,
  needsAction: 0,
  onTrack: 0,
  needAttention: 0,
  atRisk: 0,
};

export const EMPTY_LEARNERS: MonthlyLearnerActivity[] = [];
export const LEARNERS_PER_PAGE = 10;

/** Labels for the three learner statuses. "Priority" rather than "At Risk" is
 * this page's own wording, kept as-is — only the colour now comes from the
 * shared tone table. */
export const MONTHLY_STATUS_LABEL: Record<MonthlyStatus, string> = {
  'on-track': 'On Track',
  'need-attention': 'Need Attention',
  'at-risk': 'Priority',
};

export const INLINE_FILTERS: { key: InlineActivityFilter; label: string; icon: string }[] = [
  { key: 'all', label: 'All', icon: 'ri-pulse-line' },
  { key: 'assignment', label: 'Assignment', icon: 'ri-file-list-3-line' },
  { key: 'attendance', label: 'Attendance', icon: 'ri-calendar-check-line' },
  { key: 'quiz', label: 'Quizzes', icon: 'ri-question-answer-line' },
  { key: 'video', label: 'Videos', icon: 'ri-play-circle-line' },
  { key: 'audio', label: 'Audio', icon: 'ri-headphone-line' },
  { key: 'reading', label: 'Reading', icon: 'ri-book-open-line' },
  { key: 'meeting', label: 'Meetings', icon: 'ri-user-voice-line' },
];

export const COACHING_DELIVERY_CONFIG: Record<CoachingDeliveryKind, { label: string; shortLabel: string; icon: string; tone: 'primary' | 'emerald' | 'amber' | 'red' }> = {
  mcr: { label: 'MCR / MCM', shortLabel: 'MCR', icon: 'ri-user-voice-line', tone: 'emerald' },
  pr: { label: 'Progress Reviews', shortLabel: 'PR', icon: 'ri-file-list-3-line', tone: 'primary' },
  'catch-up': { label: 'Catch-ups', shortLabel: 'Catch-up', icon: 'ri-chat-check-line', tone: 'amber' },
  support: { label: 'Support', shortLabel: 'Support', icon: 'ri-hand-heart-line', tone: 'red' },
};
export const COACHING_DELIVERY_ORDER: CoachingDeliveryKind[] = ['mcr', 'pr', 'catch-up', 'support'];

export const COACHING_DELIVERY_STATUS_LABEL: Record<CoachingDeliveryStatus, string> = {
  booked: 'Booked',
  completed: 'Completed',
  cancelled: 'Cancelled',
  'needs-schedule': 'Needs schedule',
};
export const COACHING_DELIVERY_STATUS_ORDER: CoachingDeliveryStatus[] = ['booked', 'completed', 'cancelled', 'needs-schedule'];
