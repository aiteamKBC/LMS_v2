import { readLearnerJson } from './learnerRead';
import type { LearnerKind } from '@/api/learnerDetail';

export type ReviewHistoryCategory = 'monthly-coaching' | 'progress-review';

export interface ImportedReviewLink {
  text?: string;
  title?: string;
  href?: string;
  url?: string;
  azure_url?: string;
}

export interface ImportedReviewField {
  label?: string;
  value?: unknown;
  description?: string;
  links?: ImportedReviewLink[];
  [key: string]: unknown;
}

export interface ImportedReviewTable {
  rows?: unknown[][];
  [key: string]: unknown;
}

export interface ImportedReviewSection {
  id: number;
  name: string;
  order: number | null;
  fields: ImportedReviewField[];
  tables: ImportedReviewTable[];
  rawText: string;
}

export interface ImportedReview {
  id: string;
  aptemReviewId: string;
  name: string;
  type: string;
  reviewerName: string;
  plannedDate: string | null;
  plannedTime: string | null;
  completedDate: string | null;
  status: string;
  extractionStatus: string;
  detailsAvailable: boolean;
  sections: ImportedReviewSection[];
}

export interface ReviewHistoryResponse {
  learnerId: number | null;
  category: ReviewHistoryCategory;
  reviews: ImportedReview[];
}

export async function fetchReviewHistory(
  kind: LearnerKind,
  learnerId: string,
  category: ReviewHistoryCategory,
  signal?: AbortSignal,
): Promise<ReviewHistoryResponse> {
  const params = new URLSearchParams({ category });
  return readLearnerJson<ReviewHistoryResponse>(
    `/learner_api/review-history/${kind}/${encodeURIComponent(learnerId)}/?${params}`,
    { signal, ttlMs: 30_000 },
  );
}
