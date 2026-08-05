import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CommunityClub } from '../data';

const activityColorMap: Record<string, string> = {
  'Very Active': 'bg-emerald-100 text-emerald-700',
  Active: 'bg-primary-100 text-primary-700',
  Moderate: 'bg-amber-100 text-amber-700',
};

interface ClubCardProps {
  club: CommunityClub;
  joined: boolean;
  onJoin?: (club: CommunityClub) => void;
}

const joinQuestions = [
  {
    id: 'q1',
    question: 'Why do you want to join this club?',
    placeholder: 'Tell us about your interest and what you hope to learn...',
    required: true,
  },
  {
    id: 'q2',
    question: 'What skills or experience can you contribute?',
    placeholder: 'Share your background, expertise, or what you can bring...',
    required: true,
  },
  {
    id: 'q3',
    question: 'How did you hear about this club?',
    placeholder: 'e.g., Coach recommendation, fellow apprentice, etc.',
    required: false,
  },
  {
    id: 'q4',
    question: 'Are you committed to attending club events and contributing to discussions?',
    placeholder: 'Yes, I am committed to active participation...',
    required: true,
  },
];

export function ClubCard({ club, joined, onJoin }: ClubCardProps) {
  const navigate = useNavigate();
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>();
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');

  const handleAnswerChange = (questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const handleJoinSubmit = () => {
    const missing = joinQuestions.filter((q) => q.required && !answers[q.id]?.trim());
    if (missing.length > 0) {
      setSubmitStatus('error');
      setTimeout(() => setSubmitStatus('idle'), 2000);
      return;
    }
    setSubmitStatus('submitting');
    // Simulate submission delay
    setTimeout(() => {
      setSubmitStatus('success');
      setTimeout(() => {
        setShowJoinModal(false);
        setAnswers({});
        setSubmitStatus('idle');
        onJoin?.(club);
      }, 2000);
    }, 1200);
  };

  return (
    <>
      <div className="bg-background-50 rounded-xl border border-background-200/50 p-5 card-premium hover:border-primary-200/50 transition-smooth">
        {/* Header */}
        <div className="flex items-start gap-4 mb-4">
          <span className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${joined ? 'bg-primary-100 text-primary-600' : 'bg-background-100 text-foreground-400'}`}>
            <AppIcon className={`${club.icon} text-lg`}></AppIcon>
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-semibold text-foreground-900">{club.title}</h4>
              {club.badge && (
                <span className="text-[9px] font-bold bg-accent-100 text-accent-700 px-1.5 py-0.5 rounded-full uppercase">{club.badge}</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${activityColorMap[club.activity] || 'bg-background-100 text-foreground-500'}`}>{club.activity}</span>
              <span className="text-xs text-foreground-400"><AppIcon className="ri-user-line mr-0.5"></AppIcon>{club.members} members</span>
              <span className="text-xs text-foreground-400"><AppIcon className="ri-calendar-line mr-0.5"></AppIcon>Est. {club.foundedDate}</span>
            </div>
          </div>
        </div>

        {/* Description */}
        <p className="text-sm text-foreground-500 mb-4 leading-relaxed line-clamp-2">{club.desc}</p>

        {/* Category + Ambassador */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-xs font-medium text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">{club.category}</span>
          <span className="text-xs text-foreground-400"><AppIcon className="ri-shield-star-line mr-0.5"></AppIcon>Ambassador: {club.ambassador}</span>
        </div>

        {/* Joined-specific info */}
        {joined && (
          <div className="space-y-2 mb-3">
            {club.joinDate && (
              <div className="flex items-center gap-2 text-xs text-foreground-400">
                <AppIcon className="ri-calendar-check-line text-primary-500"></AppIcon>
                <span>Joined {club.joinDate}</span>
              </div>
            )}
            {club.pointsEarned !== undefined && (
              <div className="flex items-center gap-2 text-xs text-foreground-400">
                <AppIcon className="ri-coins-line text-accent-500"></AppIcon>
                <span><strong className="text-foreground-600">{club.pointsEarned}</strong> Club Points Earned</span>
              </div>
            )}
            {club.latestDiscussion && (
              <div className="flex items-center gap-2 text-xs text-foreground-400">
                <AppIcon className="ri-chat-1-line text-secondary-500"></AppIcon>
                <span>{club.latestDiscussion}</span>
              </div>
            )}
          </div>
        )}

        {/* Next event */}
        <div className="flex items-center gap-2 mb-3 text-xs text-foreground-400 bg-background-100/50 rounded-lg px-3 py-2">
          <AppIcon className="ri-calendar-event-line text-primary-500"></AppIcon>
          <span><strong>{club.nextEvent}</strong> — {club.nextEventDate}</span>
        </div>

        {/* Recent activity (joined only) */}
        {joined && club.recentActivity && (
          <div className="flex items-center gap-2 mb-3 text-xs text-foreground-400 bg-background-100/50 rounded-lg px-3 py-2">
            <AppIcon className="ri-flashlight-line text-accent-500"></AppIcon>
            <span>Recent Activity: {club.recentActivity}</span>
          </div>
        )}

        {/* Benefits (available clubs only) */}
        {!joined && club.benefits.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-semibold text-foreground-500 mb-1.5">Benefits of joining:</p>
            <div className="flex flex-wrap gap-1">
              {club.benefits.map((benefit) => (
                <span key={benefit} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-secondary-100/70 text-secondary-700">{benefit}</span>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2">
          {joined ? (
            <button
              onClick={() => navigate(`/learner/clubs/${club.id}`)}
              className="px-4 py-2 bg-primary-500 text-white rounded-lg text-xs font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"
            >
              <AppIcon className="ri-folder-open-line mr-1"></AppIcon> Open Club
            </button>
          ) : (
            <button
              onClick={() => setShowJoinModal(true)}
              className="px-4 py-2 bg-accent-500 text-foreground-950 rounded-lg text-xs font-semibold hover:bg-accent-400 transition-smooth cursor-pointer whitespace-nowrap shadow-sm shadow-accent-500/15"
            >
              <AppIcon className="ri-add-line mr-1"></AppIcon> Join Club
            </button>
          )}
        </div>
      </div>

      {/* Join Club Modal — Facebook-style membership questions */}
      {showJoinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => { if (submitStatus !== 'submitting') { setShowJoinModal(false); setAnswers({}); setSubmitStatus('idle'); } }}>
          <div className="bg-background-50 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-xl animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="sticky top-0 bg-background-50 rounded-t-2xl border-b border-background-200/50 px-6 py-4 flex items-center justify-between z-10">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-accent-100 text-accent-600 flex items-center justify-center shrink-0">
                  <AppIcon className={`${club.icon} text-lg`}></AppIcon>
                </span>
                <div>
                  <h3 className="text-sm font-heading font-bold text-foreground-900">Join {club.title}</h3>
                  <p className="text-xs text-foreground-400">Answer a few questions to join this club</p>
                </div>
              </div>
              <button
                onClick={() => { setShowJoinModal(false); setAnswers({}); setSubmitStatus('idle'); }}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-foreground-400 hover:bg-background-100 transition-smooth cursor-pointer"
                disabled={submitStatus === 'submitting'}
              >
                <AppIcon className="ri-close-line"></AppIcon>
              </button>
            </div>

            {/* Club Info Banner */}
            <div className="px-6 py-3 bg-accent-50/50 border-y border-accent-100/50">
              <div className="flex items-center gap-3">
                <AppIcon className="ri-information-line text-accent-600 text-sm"></AppIcon>
                <p className="text-xs text-accent-700">
                  <strong>{club.members} members</strong> · <strong>{club.category}</strong> · Ambassador: <strong>{club.ambassador}</strong>
                </p>
              </div>
            </div>

            {/* Form */}
            <form
              action="https://readdy.ai/api/form/d8mik68jb57qogjbhan0"
              method="POST"
              data-readdy-form="club-join-request"
              className="px-6 py-4 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                handleJoinSubmit();
              }}
            >
              <input type="hidden" name="club_name" value={club.title} />
              <input type="hidden" name="club_id" value={club.id} />
              <input type="hidden" name="submitted_by" value="Sophie Williams" />
              <input type="hidden" name="submitted_date" value="13 Jun 2026" />

              {joinQuestions.map((q, idx) => (
                <div key={q.id} className="space-y-1.5">
                  <div className="flex items-center gap-1">
                    <span className="w-5 h-5 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center text-[10px] font-bold shrink-0">
                      {idx + 1}
                    </span>
                    <label className="text-xs font-semibold text-foreground-700">
                      {q.question}
                      {q.required && <span className="text-rose-500 ml-0.5">*</span>}
                    </label>
                  </div>
                  <textarea
                    name={q.id}
                    value={answers[q.id] || ''}
                    onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                    placeholder={q.placeholder}
                    maxLength={500}
                    rows={3}
                    required={q.required}
                    className="w-full bg-background-100 border border-background-200/50 rounded-lg px-3 py-2 text-sm text-foreground-800 placeholder:text-foreground-400 focus:outline-none focus:ring-1 focus:ring-accent-400/40 focus:border-accent-300/50 transition-all resize-none"
                  />
                  <span className="text-[10px] text-foreground-400 block">{(answers[q.id] || '').length}/500</span>
                </div>
              ))}

              {/* Error state */}
              {submitStatus === 'error' && (
                <div className="bg-rose-50 border border-rose-200/50 rounded-xl p-3 flex items-center gap-2">
                  <AppIcon className="ri-error-warning-line text-rose-500 text-sm"></AppIcon>
                  <p className="text-xs text-rose-700">Please answer all required questions before submitting.</p>
                </div>
              )}

              {/* Success state */}
              {submitStatus === 'success' && (
                <div className="bg-emerald-50 border border-emerald-200/50 rounded-xl p-4 text-center">
                  <span className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-2">
                    <AppIcon className="ri-check-line text-xl"></AppIcon>
                  </span>
                  <p className="text-sm font-semibold text-emerald-700">Request Submitted!</p>
                  <p className="text-xs text-emerald-600 mt-1">Your answers have been sent to the club ambassador for review. You will be notified once approved.</p>
                </div>
              )}

              {/* Submitting state */}
              {submitStatus === 'submitting' && (
                <div className="text-center py-3">
                  <div className="inline-flex items-center gap-2">
                    <AppIcon className="ri-loader-4-line animate-spin text-accent-600 text-sm"></AppIcon>
                    <span className="text-xs font-semibold text-foreground-600">Submitting your request...</span>
                  </div>
                </div>
              )}

              {/* Actions */}
              {submitStatus !== 'success' && submitStatus !== 'submitting' && (
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => { setShowJoinModal(false); setAnswers({}); setSubmitStatus('idle'); }}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-background-200 text-sm font-semibold text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2.5 rounded-xl bg-accent-500 text-foreground-950 text-sm font-semibold hover:bg-accent-400 transition-smooth cursor-pointer whitespace-nowrap"
                  >
                    <AppIcon className="ri-send-plane-line mr-1"></AppIcon> Submit Request
                  </button>
                </div>
              )}
            </form>
          </div>
        </div>
      )}
    </>
  );
}