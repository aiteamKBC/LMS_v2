import { useState } from 'react';
import { PREPARATION_FORMS_DATA, formatSubmissionTime } from '@/mocks/preparation-forms';

interface FormData {
  id: string;
  learnerName: string;
  learnerInitials: string;
  programme: string;
  reviewTitle: string;
  reviewDate: string;
  submittedAt: string;
  status: 'new' | 'reviewed' | 'done';
  coachComment: string | null;
  responses: { question: string; answer: string }[];
}

export default function FormHistoryPanel() {
  const [expandedForm, setExpandedForm] = useState<string | null>(null);

  const myForms: FormData[] = PREPARATION_FORMS_DATA.filter(
    (f) => f.learnerName === 'Sophie Williams'
  );

  const toggleExpand = (id: string) => {
    setExpandedForm((prev) => (prev === id ? null : id));
  };

  const statusBadgeClass = (status: FormData['status']) => {
    switch (status) {
      case 'new':
        return 'bg-amber-100 text-amber-700';
      case 'reviewed':
        return 'bg-primary-100 text-primary-700';
      case 'done':
        return 'bg-emerald-100 text-emerald-700';
      default:
        return 'bg-background-100 text-foreground-500';
    }
  };

  const statusLabel = (status: FormData['status']) => {
    switch (status) {
      case 'new':
        return 'Pending Review';
      case 'reviewed':
        return 'Reviewed';
      case 'done':
        return 'Completed';
      default:
        return status;
    }
  };

  if (myForms.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-14 h-14 mx-auto rounded-full bg-background-100 flex items-center justify-center mb-4">
          <i className="ri-draft-line text-foreground-400 text-2xl" />
        </div>
        <h3 className="text-base font-heading font-semibold text-foreground-900 mb-1">
          No Form History
        </h3>
        <p className="text-sm text-foreground-500 max-w-sm mx-auto">
          You have not submitted any preparation forms yet. Complete your review preparation
          to see your history here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-8 h-8 rounded-lg bg-accent-100 flex items-center justify-center">
          <i className="ri-file-list-3-line text-accent-600 text-sm" />
        </div>
        <div>
          <h3 className="text-sm font-heading font-semibold text-foreground-900">
            My Form History
          </h3>
          <p className="text-xs text-foreground-500">
            {myForms.length} submission{myForms.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {myForms.map((form) => {
        const isExpanded = expandedForm === form.id;
        const time = formatSubmissionTime(form.submittedAt);

        return (
          <div
            key={form.id}
            className={`bg-background-50 rounded-xl border transition-all ${
              isExpanded
                ? 'border-primary-300 ring-1 ring-primary-200/50'
                : 'border-background-200/50'
            }`}
          >
            {/* Header Row */}
            <div className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-primary-700">
                      {form.learnerInitials}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground-900">
                      {form.reviewTitle}
                    </p>
                    <p className="text-xs text-foreground-400 mt-0.5">
                      {form.reviewDate} · {form.programme}
                    </p>
                    <p className="text-xs text-foreground-400 mt-0.5">
                      <i className="ri-time-line mr-0.5 text-xs" />
                      Submitted {time.date} at {time.time}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusBadgeClass(form.status)}`}
                  >
                    {statusLabel(form.status)}
                  </span>
                  <button
                    onClick={() => toggleExpand(form.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-background-100 text-foreground-600 rounded-lg text-[11px] font-semibold border border-background-200/50 hover:bg-background-200 transition-all cursor-pointer whitespace-nowrap"
                  >
                    <i className={isExpanded ? 'ri-eye-off-line' : 'ri-eye-line'} />
                    {isExpanded ? 'Hide' : 'View'}
                  </button>
                </div>
              </div>

              {/* Coach Comment */}
              {form.coachComment && (
                <div className="mt-3 bg-primary-50/50 rounded-lg p-3 border border-primary-200/30">
                  <div className="flex items-start gap-2">
                    <i className="ri-chat-1-line text-primary-500 mt-0.5 shrink-0 text-sm" />
                    <div>
                      <p className="text-xs font-semibold text-primary-700 mb-0.5">
                        Coach Comment
                      </p>
                      <p className="text-sm text-foreground-600 leading-relaxed">
                        {form.coachComment}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* No comment yet state */}
              {form.status === 'new' && !form.coachComment && (
                <div className="mt-3 bg-amber-50/50 rounded-lg p-3 border border-amber-200/30">
                  <div className="flex items-center gap-2">
                    <i className="ri-time-line text-amber-500 text-sm" />
                    <p className="text-sm text-amber-700">
                      Awaiting coach review — no comment yet
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Expanded Responses */}
            {isExpanded && (
              <div className="px-4 pb-4 border-t border-background-200/30 pt-3 space-y-4">
                <p className="text-xs font-medium text-foreground-400 uppercase tracking-wide">
                  Your Responses
                </p>
                {form.responses.map((resp, idx) => (
                  <div key={idx} className="bg-background-100/50 rounded-lg p-3">
                    <p className="text-xs font-semibold text-foreground-800 mb-1">
                      <span className="text-primary-500 mr-1">{idx + 1}.</span>
                      {resp.question}
                    </p>
                    <p className="text-sm text-foreground-600 leading-relaxed">
                      {resp.answer}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}