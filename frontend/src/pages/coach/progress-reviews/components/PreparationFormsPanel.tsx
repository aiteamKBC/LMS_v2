import { useState, useEffect } from 'react';
import { PREPARATION_FORMS_DATA, formatSubmissionTime } from '@/mocks/preparation-forms';
import type { PREPARATION_FORMS_DATA as PrepFormsType } from '@/mocks/preparation-forms';
import { useToast } from '@/hooks/useToast';

type PrepForm = (typeof PREPARATION_FORMS_DATA)[0];

export default function PreparationFormsPanel() {
  const { info } = useToast();
  const [forms, setForms] = useState<PrepForm[]>(PREPARATION_FORMS_DATA);
  const [expandedForm, setExpandedForm] = useState<string | null>(null);
  const [commentingForm, setCommentingForm] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [lastPollCount, setLastPollCount] = useState(PREPARATION_FORMS_DATA.length);
  const [isLive, setIsLive] = useState(true);

  const newCount = forms.filter((f) => f.status === 'new').length;
  const reviewedCount = forms.filter((f) => f.status === 'reviewed').length;
  const doneCount = forms.filter((f) => f.status === 'done').length;

  // Real-time polling — simulates checking for new forms every 5 seconds
  useEffect(() => {
    if (!isLive) return;
    const poll = setInterval(() => {
      // In production, this would fetch from Supabase:
      // const { data } = await supabase.from('preparation_forms').select('*');
      // setForms(data);
      // For demo, we simulate checking for new forms by comparing counts
      const currentCount = forms.length;
      if (currentCount > lastPollCount) {
        const newForms = currentCount - lastPollCount;
        info(`${newForms} new preparation form${newForms !== 1 ? 's' : ''} arrived`, 'Auto-refresh is active');
        setLastPollCount(currentCount);
      }
    }, 5000);
    return () => clearInterval(poll);
  }, [forms.length, lastPollCount, isLive, info]);

  const toggleExpand = (id: string) => {
    setExpandedForm((prev) => (prev === id ? null : id));
  };

  const markAsDone = (id: string) => {
    setForms((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status: 'done' as const } : f))
    );
  };

  const markAsReviewed = (id: string) => {
    setForms((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status: 'reviewed' as const } : f))
    );
  };

  const startComment = (id: string) => {
    const form = forms.find((f) => f.id === id);
    setCommentingForm(id);
    setCommentText(form?.coachComment || '');
  };

  const saveComment = (id: string) => {
    setForms((prev) =>
      prev.map((f) =>
        f.id === id ? { ...f, coachComment: commentText.trim() || null, status: f.status === 'new' ? ('reviewed' as const) : f.status } : f
      )
    );
    setCommentingForm(null);
    setCommentText('');
  };

  const statusBadgeClass = (status: PrepForm['status']) => {
    switch (status) {
      case 'new':
        return 'bg-amber-100 text-amber-700';
      case 'reviewed':
        return 'bg-primary-100 text-primary-700';
      case 'done':
        return 'bg-emerald-100 text-emerald-700';
    }
  };

  const statusLabel = (status: PrepForm['status']) => {
    switch (status) {
      case 'new':
        return 'New';
      case 'reviewed':
        return 'Reviewed';
      case 'done':
        return 'Done';
    }
  };

  if (forms.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-14 h-14 mx-auto rounded-full bg-background-100 flex items-center justify-center mb-4">
          <AppIcon className="ri-draft-line text-foreground-400 text-2xl" />
        </div>
        <h3 className="text-base font-heading font-semibold text-foreground-900 mb-1">No Preparation Forms Yet</h3>
        <p className="text-sm text-foreground-500 max-w-sm mx-auto">
          When learners submit their pre-review preparation forms, they will appear here for you to review, comment on, and mark as done.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
            <span className="text-xs font-semibold text-foreground-700">{newCount} New</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-primary-400"></span>
            <span className="text-xs font-semibold text-foreground-700">{reviewedCount} Reviewed</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
            <span className="text-xs font-semibold text-foreground-700">{doneCount} Done</span>
          </div>
          <span className="text-xs text-foreground-400">{forms.length} total</span>
        </div>
        {/* Live indicator */}
        <button
          onClick={() => setIsLive(!isLive)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold cursor-pointer whitespace-nowrap border border-foreground-200/60 hover:bg-background-100 transition-all"
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-emerald-400 animate-pulse' : 'bg-foreground-300'}`} />
          <span className={isLive ? 'text-emerald-600' : 'text-foreground-400'}>
            {isLive ? 'Live Updates' : 'Paused'}
          </span>
        </button>
      </div>

      {/* Forms List */}
      <div className="space-y-3">
        {forms.map((form) => {
          const isExpanded = expandedForm === form.id;
          const isCommenting = commentingForm === form.id;
          const time = formatSubmissionTime(form.submittedAt);

          return (
            <div
              key={form.id}
              className={`bg-background-50 rounded-xl border transition-all ${
                isExpanded ? 'border-primary-300 ring-1 ring-primary-200/50' : 'border-foreground-200/60'
              }`}
            >
              {/* Header Row */}
              <div className="p-4">
                <div className="flex items-start gap-4">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ring-2 ${
                      form.status === 'new'
                        ? 'bg-amber-100 text-amber-700 ring-amber-200'
                        : form.status === 'reviewed'
                        ? 'bg-primary-100 text-primary-700 ring-primary-200'
                        : 'bg-emerald-100 text-emerald-700 ring-emerald-200'
                    }`}
                  >
                    <span className="text-sm font-bold">{form.learnerInitials}</span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-foreground-900">{form.learnerName}</p>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${statusBadgeClass(form.status)}`}>
                        {statusLabel(form.status)}
                      </span>
                      <span className="text-xs text-foreground-400">
                        <AppIcon className="ri-time-line mr-0.5" />
                        {time.relative}
                      </span>
                    </div>
                    <p className="text-[11px] text-foreground-400 mt-0.5">
                      {form.programme} · {form.reviewTitle} · {form.reviewDate}
                    </p>
                    <p className="text-[11px] text-foreground-400 mt-0.5">
                      <AppIcon className="ri-calendar-check-line mr-0.5" />
                      Submitted {time.date} at {time.time}
                    </p>
                    {form.coachComment && (
                      <div className="mt-2 bg-background-100 rounded-lg px-3 py-2 text-xs text-foreground-600 flex items-start gap-2">
                        <AppIcon className="ri-chat-1-line text-foreground-400 mt-0.5 shrink-0" />
                        <span>{form.coachComment}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {form.status !== 'done' && (
                      <button
                        onClick={() => markAsDone(form.id)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-[11px] font-semibold hover:bg-emerald-600 transition-all cursor-pointer whitespace-nowrap"
                      >
                        <AppIcon className="ri-check-line" /> Done
                      </button>
                    )}
                    {form.status === 'done' && (
                      <button
                        onClick={() => markAsReviewed(form.id)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary-100 text-primary-700 rounded-lg text-[11px] font-semibold hover:bg-primary-200 transition-all cursor-pointer whitespace-nowrap"
                      >
                        <AppIcon className="ri-arrow-go-back-line" /> Reopen
                      </button>
                    )}
                    <button
                      onClick={() => startComment(form.id)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-background-100 text-foreground-600 rounded-lg text-[11px] font-semibold border border-foreground-200/60 hover:bg-background-200 transition-all cursor-pointer whitespace-nowrap"
                    >
                      <AppIcon className="ri-chat-1-line" /> Comment
                    </button>
                    <button
                      onClick={() => toggleExpand(form.id)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-background-100 text-foreground-600 rounded-lg text-[11px] font-semibold border border-foreground-200/60 hover:bg-background-200 transition-all cursor-pointer whitespace-nowrap"
                    >
                      <AppIcon className={isExpanded ? 'ri-eye-off-line' : 'ri-eye-line'} />
                      {isExpanded ? 'Hide' : 'View'}
                    </button>
                  </div>
                </div>

                {/* Comment Input */}
                {isCommenting && (
                  <div className="mt-3 ml-14 p-3 bg-background-100 rounded-lg border border-foreground-200/60">
                    <textarea
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      placeholder="Add a comment for this preparation form..."
                      rows={2}
                      maxLength={500}
                      className="w-full text-sm text-foreground-700 bg-background-50 border border-foreground-200/60 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary-400/50 placeholder:text-foreground-300"
                    />
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[10px] text-foreground-400">{commentText.length}/500</span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setCommentingForm(null); setCommentText(''); }}
                          className="px-3 py-1.5 text-[11px] font-medium text-foreground-500 hover:text-foreground-700 cursor-pointer whitespace-nowrap"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => saveComment(form.id)}
                          className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 cursor-pointer whitespace-nowrap"
                        >
                          Save Comment
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Expanded Responses */}
              {isExpanded && (
                <div className="px-4 pb-4 ml-14 border-t border-background-200/30 pt-3 space-y-4">
                  {form.responses.map((resp, idx) => (
                    <div key={idx}>
                      <p className="text-xs font-semibold text-foreground-800 mb-1">
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary-100 text-primary-700 text-[10px] font-bold mr-1.5">
                          {idx + 1}
                        </span>
                        {resp.question}
                      </p>
                      <p className="text-sm text-foreground-600 leading-relaxed pl-7">{resp.answer}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}