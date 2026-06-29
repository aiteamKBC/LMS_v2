import { useState, useRef } from 'react';
import { PROGRESS_REVIEWS_DATA } from '@/mocks/progress-reviews';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';
import { useToast } from '@/hooks/useToast';

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmitted: (submittedAt: string) => void;
}

export default function PrepareReviewModal({ open, onClose, onSubmitted }: Props) {
  const d = PROGRESS_REVIEWS_DATA;
  const p = LEARNER_PROFILE;
  const { success } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [charCounts, setCharCounts] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    d.prepQuestions.forEach((q) => { init[q.id] = 0; });
    return init;
  });

  const triggerBrowserNotification = () => {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      new Notification('Coach Notified — Progress Review Prep', {
        body: `${d.nextReview.coach} has been sent your preparation responses for the ${d.nextReview.title} on ${d.nextReview.date}.`,
        icon: '/favicon.ico',
        tag: 'prep-form-submitted',
      });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then((perm) => {
        if (perm === 'granted') {
          new Notification('Coach Notified — Progress Review Prep', {
            body: `${d.nextReview.coach} has been sent your preparation responses for the ${d.nextReview.title} on ${d.nextReview.date}.`,
            icon: '/favicon.ico',
            tag: 'prep-form-submitted',
          });
        }
      });
    }
  };

  const handleTextChange = (id: string, val: string) => {
    if (val.length <= 500) {
      setCharCounts((prev) => ({ ...prev, [id]: val.length }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formRef.current) return;

    const formData = new FormData(formRef.current);

    const allEmpty = d.prepQuestions.every((q) => {
      const val = formData.get(q.id) as string;
      return !val || val.trim() === '';
    });
    if (allEmpty) return;

    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      formData.append('submitted_at', now);

      await fetch('https://readdy.ai/api/form/d8p8tcm7ga8frnon0uu0', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(formData as unknown as Record<string, string>).toString(),
      });

      setSubmittedAt(now);
      setSubmitted(true);
      onSubmitted(now);

      triggerBrowserNotification();

      success(
        'Coach notified by email',
        `${d.nextReview.coach} has been sent an email with your preparation responses for the ${d.nextReview.title} on ${d.nextReview.date}.`
      );
    } catch {
      // silently handle
    } finally {
      setSubmitting(false);
    }
  };

  const formatSubmittedTime = (): string => {
    if (!submittedAt) return '';
    const date = new Date(submittedAt);
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ' at ' + date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  };

  const handleClose = () => {
    if (!submitted) {
      const hasContent = d.prepQuestions.some((q) => charCounts[q.id] > 0);
      if (hasContent) {
        const ok = window.confirm('You have unsaved responses. Are you sure you want to close?');
        if (!ok) return;
      }
    }
    setSubmitted(false);
    setSubmittedAt(null);
    setCharCounts(() => {
      const init: Record<string, number> = {};
      d.prepQuestions.forEach((q) => { init[q.id] = 0; });
      return init;
    });
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-background-50 rounded-2xl border border-background-200/70 shadow-xl">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background-50 rounded-t-2xl border-b border-background-200/50 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-heading font-bold text-foreground-950">Prepare For Your Progress Review</h2>
            <p className="text-xs text-foreground-500 mt-0.5">
              {d.nextReview.title} — {d.nextReview.date} · Coach: {d.nextReview.coach} · Manager: {d.nextReview.lineManager}
            </p>
          </div>
          <button onClick={handleClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-background-100 transition-colors cursor-pointer">
            <i className="ri-close-line text-foreground-600 text-lg" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {submitted ? (
            /* Success State */
            <div className="text-center py-10">
              <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 flex items-center justify-center mb-4">
                <i className="ri-check-line text-emerald-600 text-3xl" />
              </div>
              <h3 className="text-lg font-heading font-bold text-foreground-950 mb-2">Responses Submitted!</h3>
              <p className="text-sm text-foreground-500 max-w-sm mx-auto">
                Your coach <strong className="text-foreground-800">{d.nextReview.coach}</strong> will review your responses before the progress review on {d.nextReview.date}.
              </p>
              <p className="text-xs text-foreground-400 mt-1">Learner: {p.fullName} · Programme: {p.programme}</p>
              <div className="mt-3 space-y-1.5">
                <div className="inline-flex items-center gap-2 text-xs text-emerald-700 bg-emerald-100 px-3 py-1.5 rounded-full">
                  <i className="ri-mail-send-line" />
                  Email notification sent to {d.nextReview.coach}
                </div>
                {submittedAt && (
                  <>
                    <br />
                    <div className="inline-flex items-center gap-2 text-xs text-foreground-500 bg-background-100 px-3 py-1.5 rounded-full mt-1.5">
                      <i className="ri-time-line" />
                      Submitted: {formatSubmittedTime()}
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={handleClose}
                className="mt-6 inline-flex items-center gap-2 px-6 py-2.5 bg-primary-500 text-white rounded-lg text-sm font-semibold hover:bg-primary-600 transition-all cursor-pointer whitespace-nowrap"
              >
                <i className="ri-arrow-left-line" /> Back to Progress Reviews
              </button>
            </div>
          ) : (
            /* Form */
            <form ref={formRef} onSubmit={handleSubmit} data-readdy-form>
              <input type="hidden" name="learner_name" value={p.fullName} />
              <input type="hidden" name="programme" value={p.programme} />
              <input type="hidden" name="coach_name" value={d.nextReview.coach} />
              <input type="hidden" name="review_date" value={d.nextReview.date} />
              <input type="hidden" name="review_title" value={d.nextReview.title} />

              <div className="text-xs text-foreground-400 bg-background-100 rounded-lg px-4 py-2.5 mb-5 flex items-start gap-2">
                <i className="ri-information-line mt-0.5" />
                <span>Your responses will be shared with your coach <strong className="text-foreground-700">{d.nextReview.coach}</strong> before the review. Take time to reflect honestly — this helps make your review more productive.</span>
              </div>

              <div className="space-y-5">
                {d.prepQuestions.map((q, idx) => (
                  <div key={q.id}>
                    <label htmlFor={`field-${q.id}`} className="block text-sm font-semibold text-foreground-900 mb-1.5">
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary-100 text-primary-700 text-xs font-bold mr-2">{idx + 1}</span>
                      {q.question}
                    </label>
                    <textarea
                      id={`field-${q.id}`}
                      name={q.id}
                      rows={3}
                      maxLength={500}
                      onChange={(e) => handleTextChange(q.id, e.target.value)}
                      className="w-full text-sm text-foreground-700 bg-background-100 border border-background-200/50 rounded-lg px-3.5 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary-400/50 placeholder:text-foreground-300"
                      placeholder="Write your response here..."
                    />
                    <p className={`text-xs mt-1 text-right ${charCounts[q.id] >= 450 ? 'text-red-500 font-semibold' : charCounts[q.id] > 350 ? 'text-amber-500' : 'text-foreground-400'}`}>
                      {charCounts[q.id]}/500
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-6 pt-4 border-t border-background-200/50 flex items-center justify-between">
                <button
                  type="button"
                  onClick={handleClose}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-foreground-600 hover:text-foreground-800 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <i className="ri-arrow-left-line" /> Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary-500 text-white rounded-lg text-sm font-semibold hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer whitespace-nowrap"
                >
                  {submitting ? (
                    <>
                      <i className="ri-loader-4-line animate-spin" /> Submitting...
                    </>
                  ) : (
                    <>
                      <i className="ri-send-plane-line" /> Submit Responses
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}