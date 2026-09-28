import type { MarkingKind } from '@/lib/markingKind';

export type MarkingQueueFilter = 'all' | 'pending' | 'overdue' | 'accepted' | 'referred';
export type MarkingScope = 'official' | 'personal';

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

