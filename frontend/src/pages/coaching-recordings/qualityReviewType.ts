import type { QualityReviewType } from '@/api/coachingQualityReviews';

export const qualityTypeLabels: Record<QualityReviewType, string> = { MCM: 'Monthly Coaching Meeting', PR: 'Progress Review' };
export function suggestQualityType(title = ''): QualityReviewType | '' {
  if (/\bprogress[\s_-]+review\b|\b(?:pr|br)\b/i.test(title)) return 'PR';
  if (/\bmonthly[\s_-]+coaching[\s_-]+(?:meeting|review)\b|\b(?:mcm|mcr)\b/i.test(title)) return 'MCM';
  return '';
}
