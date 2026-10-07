import type { LearnerMetrics } from '@/api/learnerMetrics';
import type { LearnerAttendance } from '@/api/learnerAttendance';
import type { CoachCalendarEvent } from '@/pages/coach/shared/calendarEvents';
import type { LearnerKind } from '@/api/learnerDetail';

export type CaseFileProfile = {
  learner: {
    id: string;
    name: string | null;
    email: string | null;
    programme: string | null;
    group: string | null;
    employer: string | null;
    status: string | null;
    startDate: string | null;
    plannedEndDate: string | null;
    enrolmentId: string | null;
    aptemId: string | null;
    learnerType: LearnerKind;
  };
};

export type CaseFileHeaderSummary = {
  metrics: LearnerMetrics | null;
  attendance: LearnerAttendance | null;
  nextSession: CoachCalendarEvent | null;
  reviews: CoachCalendarEvent[] | null;
  errors: Partial<Record<'metrics' | 'attendance' | 'nextSession' | 'reviews', string>>;
};

export type CaseFileOtjhKsb = {
  errors?: { otjh?: string };
  otjh: {
    actualHours: number | null;
    targetToDateHours: number | null;
    plannedHours: number | null;
    remainingHours: number | null;
    progressPercent: number | null;
    months: Array<{ month: string; targetHours: number | null; submittedHours: number | null; completedHours: number | null }>;
  };
  ksb: {
    summary: { total: number; achieved: number; remaining: number };
    categories: Array<{ category: string; achieved: number; total: number; percent: number }>;
    rows: Array<{ code: string; description: string; category: string; status: 'Achieved' | 'Not Achieved'; evidenceCount: number; completed: number; pointsAchieved: number; totalPoints: number; progressPercent: number | null }>;
  };
};
