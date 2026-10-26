import type { QualityForm, QualityTemplate } from '@/api/coachingQualityReviews';

export function blankQualityForm(template: QualityTemplate, activityDate: string): QualityForm {
  return { header: { employer: '', programme: '', activityDate, startDate: '', endDate: '' }, criteria: Object.fromEntries(template.sections.flatMap(section => section.criteria.filter(item => !item.type || item.type === 'rating').map(item => [item.id, { rating: '', evidence: '' }]))), answers: {}, images: {}, actions: [], sources: [] };
}

export function qualityCompletionIssue(template: QualityTemplate, form: QualityForm): string {
  for (const section of template.sections) for (const item of section.criteria) {
    const kind = item.type || 'rating', required = item.required !== false;
    if (kind === 'rating') {
      const row = form.criteria[item.id];
      if ((required && !row?.rating) || (row?.rating && row.rating !== 'na' && !row.evidence.trim())) return 'Choose a rating and explain the evidence for every required criterion before completing the review.';
    } else if (kind === 'image') {
      if (required && !form.images[item.id]?.length) return `Attach an image: ${item.text}`;
    } else {
      const value = form.answers?.[item.id];
      if (required && (value == null || value === '' || (Array.isArray(value) && !value.length))) return `Answer the required question: ${item.text}`;
    }
  }
  return '';
}

