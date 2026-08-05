import { useState } from 'react';
import { PROGRESS_REVIEWS_DATA } from '@/mocks/progress-reviews';
import { statusBadge } from '../utils';

interface Props {
  onOpenPrepForm: () => void;
  hasPrepResponses: boolean;
  coachNotified: boolean;
  submittedAt: string | null;
}

export default function PrepareAndActions({ onOpenPrepForm, hasPrepResponses, coachNotified, submittedAt }: Props) {
  const d = PROGRESS_REVIEWS_DATA;
  const [showAllActions, setShowAllActions] = useState(false);

  const completedActions = d.previousActions.filter(a => a.status === 'complete').length;
  const totalActions = d.previousActions.length;
  const completionPct = Math.round((completedActions / totalActions) * 100);
  const overdueCount = d.previousActions.filter(a => a.status === 'overdue').length;

  const formatSubmittedAt = (): string => {
    if (!submittedAt) return '';
    const date = new Date(submittedAt);
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ' at ' + date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="space-y-6">
      {/* ── SECTION 6: PREPARE FOR REVIEW ── */}
      <section className="bg-background-50 rounded-xl border border-background-200/70 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0 mt-0.5">
              <AppIcon className="ri-draft-line text-primary-600 text-lg" />
            </div>
            <div>
              <h3 className="text-sm font-heading font-semibold text-foreground-900">Prepare For My Review</h3>
              <p className="text-xs text-foreground-500 mt-0.5">
                Complete your pre-review reflection to help your coach understand your progress, challenges, and goals before the meeting.
              </p>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-xs text-foreground-500">
                  <strong className="text-foreground-800">{d.prepQuestions.length}</strong> questions
                </span>
                {hasPrepResponses ? (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                    <AppIcon className="ri-check-double-line text-xs" /> Responses Saved
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                    <AppIcon className="ri-error-warning-line text-xs" /> Not Yet Completed
                  </span>
                )}
                {coachNotified && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 bg-primary-100 px-2 py-0.5 rounded-full">
                    <AppIcon className="ri-mail-send-line text-xs" /> Coach Notified
                  </span>
                )}
                {submittedAt && (
                  <span className="inline-flex items-center gap-1 text-xs text-foreground-500">
                    <AppIcon className="ri-time-line text-xs" /> {formatSubmittedAt()}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onOpenPrepForm}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-500 text-white rounded-lg text-sm font-semibold hover:bg-primary-600 transition-all cursor-pointer whitespace-nowrap shrink-0"
          >
            <AppIcon className={hasPrepResponses ? 'ri-edit-line' : 'ri-draft-line'} />
            {hasPrepResponses ? 'Edit Responses' : 'Start Review Preparation'}
          </button>
        </div>

        {/* Question preview */}
        <div className="mt-4 pt-4 border-t border-background-200/50">
          <p className="text-xs font-medium text-foreground-400 mb-2 uppercase tracking-wide">Questions you will answer</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
            {d.prepQuestions.map((q, idx) => (
              <div key={q.id} className="flex items-start gap-2">
                <span className="text-xs font-bold text-primary-500 w-5 flex-shrink-0">{idx + 1}.</span>
                <span className="text-xs text-foreground-600 leading-relaxed">{q.question}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 8: PREVIOUS ACTION TRACKER ── */}
      <section className="bg-background-50 rounded-xl border border-background-200/70 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-heading font-semibold text-foreground-900">Previous Action Tracker</h3>
          <div className="flex items-center gap-3">
            <span className="text-xs text-foreground-500">{completionPct}% Complete</span>
            {overdueCount > 0 && (
              <span className="text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">{overdueCount} Overdue</span>
            )}
          </div>
        </div>
        <div className="space-y-2">
          {(showAllActions ? d.previousActions : d.previousActions.slice(0, 4)).map((act) => (
            <div key={act.id} className="flex items-center gap-3 rounded-lg border border-background-200/50 bg-background-100 px-4 py-3">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${act.status === 'complete' ? 'bg-emerald-400' : act.status === 'in-progress' ? 'bg-primary-400' : act.status === 'overdue' ? 'bg-red-400' : 'bg-foreground-300'}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground-900 truncate">{act.title}</p>
                <p className="text-xs text-foreground-400">Due: {act.dueDate}{act.completedDate ? ` · Completed: ${act.completedDate}` : ''}</p>
              </div>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${statusBadge(act.status.replace('-', ' '))}`}>
                {act.status.replace('-', ' ')}
              </span>
            </div>
          ))}
        </div>
        {d.previousActions.length > 4 && (
          <button onClick={() => setShowAllActions(!showAllActions)} className="mt-3 text-xs font-medium text-primary-600 hover:text-primary-700 cursor-pointer whitespace-nowrap">
            {showAllActions ? 'Show Less' : `Show All ${d.previousActions.length} Actions`}
          </button>
        )}
      </section>
    </div>
  );
}