import type { MarkingKind } from '@/lib/markingKind';

export type MarkingQueueFilter = 'all' | 'pending' | 'overdue' | 'accepted' | 'referred';
export type MarkingScope = 'official' | 'personal';
/** Which half of a monthly report a queue item marks. Absent for every other submission. */
export type MarkingPart = 'assignment' | 'reflection';

/** One answer within a step. ``text`` is always present; list formats also carry ``items``. */
export interface MarkingSectionEntry {
  label: string;
  text: string;
  format?: 'text' | 'value' | 'checks' | 'time' | 'ksbs' | 'evidence' | 'slides';
  items?: Array<{
    label?: string; passed?: boolean;
    date?: string; topic?: string; hours?: string;
    code?: string; explanation?: string;
    name?: string; url?: string; points?: string;
    title?: string; body?: string;
  }>;
}

export interface MarkingSection {
  step: number;
  title: string;
  entries: MarkingSectionEntry[];
}

export interface MarkingSubmission {
  version?: number;
  id: string;
  learner: string;
  programme: string;
  activityType: string;
  activityTitle: string;
  module: string;
  week: string;
  status: string;
  learningReflection: string;
  ksbCodes: string[];
  applicationText: string;
  benefitExplanation: string;
  qualityScore: number;
  coachFeedback: string | null;
  reviewedBy: string | null;
  submittedDisplay: string;
  elapsedDays: number;
  isOverdue: boolean;
  markingPart?: MarkingPart;
  markingPartLabel?: string;
  markingSections?: MarkingSection[];
  contentPreview?: string;
}

export interface MarkingQueueSummary {
  totalItems: number;
  activeLearners: number;
  pendingItems: number;
  acceptedItems: number;
  referredItems: number;
  overdueItems: number;
  assignmentItems: number;
  reflectionItems: number;
}

export interface MarkingQueuePagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface MarkingQueueRequest {
  scope: MarkingScope;
  status: MarkingQueueFilter;
  kind: MarkingKind;
  page: number;
  pageSize?: number;
}

export interface MarkingQueueResponse {
  items?: MarkingSubmission[];
  summary?: MarkingQueueSummary;
  pagination?: MarkingQueuePagination;
  detail?: string;
}

