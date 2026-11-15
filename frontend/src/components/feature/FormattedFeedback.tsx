import { forwardRef } from 'react';
import { normalizeFeedbackHtml } from '@/lib/feedbackHtml';

export const FormattedFeedback = forwardRef<HTMLDivElement, { value: string | null | undefined; className?: string; id?: string }>(function FormattedFeedback({ value, className, id }, ref) {
  const html = normalizeFeedbackHtml(value);
  if (!html) return null;
  return <div ref={ref} id={id} className={className} dangerouslySetInnerHTML={{ __html: html }} />;
});
