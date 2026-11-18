import { useEffect, useState } from 'react';
import { feedbackApi, type FeedbackResponse } from '@/api/feedback';
import { FormRenderer } from '@/features/feedback/FormRenderer';
import QualityModal from '@/pages/coaching-recordings/QualityModal';

export default function FeedbackResponseDialog({ responseId, onClose }: { responseId: number; onClose: () => void }) {
  const [response, setResponse] = useState<FeedbackResponse | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setResponse(null);
    setError('');
    void feedbackApi.response(responseId)
      .then(result => {
        if (result.response?.id !== responseId) throw new Error('The requested feedback response is unavailable.');
        if (active) setResponse(result.response);
      })
      .catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load feedback response.');
      });
    return () => { active = false; };
  }, [responseId, retry]);

  const current = response?.id === responseId ? response : null;
  return (
    <QualityModal title="Feedback response" onClose={onClose}>
      {error ? (
        <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">
          <p>{error}</p>
          <button type="button" className="mt-3 rounded-md border border-red-200 px-3 py-2 font-semibold" onClick={() => setRetry(value => value + 1)}>Retry feedback response</button>
        </div>
      ) : !current ? <p role="status" className="text-sm text-foreground-600">Loading feedback response…</p> : (
        <div className="space-y-4">
          <dl className="grid gap-3 rounded-lg bg-background-100 p-4 text-xs sm:grid-cols-3">
            <div><dt className="text-foreground-500">{current.formType === 'post_progress_review_employer' ? 'Employer' : 'Respondent'}</dt><dd className="mt-1 font-semibold">{current.learnerName || 'Anonymous respondent'}</dd></div>
            <div><dt className="text-foreground-500">Form</dt><dd className="mt-1 font-semibold">{current.formTitle}</dd></div>
            <div><dt className="text-foreground-500">Submitted (UK)</dt><dd className="mt-1 font-semibold">{current.submittedAt ? new Date(current.submittedAt).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' }) : 'Not recorded'}</dd></div>
          </dl>
          {current.sections?.length ? (
            <FormRenderer sections={current.sections} answers={Object.fromEntries(current.sections.flatMap(section => section.questions.map(question => [String(question.id), question.answer ?? null])))} readOnly />
          ) : <p className="text-sm text-foreground-600">No answers are available for this response.</p>}
        </div>
      )}
    </QualityModal>
  );
}
