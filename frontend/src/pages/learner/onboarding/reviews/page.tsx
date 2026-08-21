import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { useMyLearner } from '@/hooks/useMyLearner';
import { ONBOARDING_NAV_ITEMS } from '@/hooks/useOnboardingRedirect';
import {
  bookLearnerCalendarSession,
  cancelLearnerCalendarSession,
  fetchOnboardingReviews,
  type OnboardingReview,
  type OnboardingReviewsResponse,
  type OnboardingReviewType,
} from '@/api/learnerCalendar';
import { fetchReviewForm, type ReviewFormResponse } from '@/api/reviewForm';
import { btnPrimary, btnSecondary } from '@/pages/users/components/ui';
import SignReviewModal from './SignReviewModal';
import { RowsSkeleton } from '@/components/feature/Skeletons';

const learnerNav = roleNavMap.learner;

// Labels come from the backend (ONBOARDING_REVIEW_LABELS); only the icon is
// presentational, so that is all this map carries.
const REVIEW_ICONS: Record<OnboardingReviewType, string> = {
  'eligibility-review': 'ri-shield-check-line',
  workspace: 'ri-file-list-3-line',
  'training-plan': 'ri-heart-pulse-line',
};

const todayIso = () => new Date().toISOString().slice(0, 10);

/** One review: either its booked slot, or the form to book it. */
function ReviewCard({
  review,
  coachName,
  disabled,
  onBooked,
}: {
  review: OnboardingReview;
  coachName: string;
  disabled: boolean;
  onBooked: () => void;
}) {
  const { kind, id } = useMyLearner();
  const navigate = useNavigate();
  const icon = REVIEW_ICONS[review.type];
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayIso());
  const [time, setTime] = useState('10:00');
  const [duration, setDuration] = useState('60');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // A booking can save locally while the Microsoft Graph sync fails (e.g. the
  // case owner has no tenant mailbox). That means no invite email was sent, so
  // it has to be shown rather than silently swallowed.
  const [warning, setWarning] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  // The list payload carries only whether each side has signed, so the full
  // signature (needed to show/replace it) is fetched when the dialog opens.
  const [signing, setSigning] = useState(false);
  const [signData, setSignData] = useState<ReviewFormResponse | null>(null);

  useEffect(() => {
    if (!signing || signData || !review.event) return;
    let cancelled = false;
    fetchReviewForm(kind, id, review.event.eventKey)
      .then((res) => !cancelled && setSignData(res))
      .catch((e: Error) => { if (!cancelled) { setErr(e.message); setSigning(false); } });
    return () => { cancelled = true; };
  }, [signing, signData, kind, id, review.event]);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setErr(null);
    setWarning(null);
    try {
      const res = await bookLearnerCalendarSession(kind, id, {
        sessionType: review.type,
        scheduledDate: date,
        scheduledTime: time,
        durationMinutes: parseInt(duration, 10),
        notes: notes.trim() || undefined,
      });
      setOpen(false);
      if (res.warning) setWarning(res.warning);
      onBooked();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not book this review.');
    } finally {
      setSaving(false);
    }
  };

  const cancel = async () => {
    if (saving || !review.event) return;
    setSaving(true);
    setErr(null);
    setWarning(null);
    try {
      const res = await cancelLearnerCalendarSession(kind, id, review.event.eventKey);
      setConfirmCancel(false);
      if (res.warning) setWarning(res.warning);
      onBooked();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not cancel this review.');
    } finally {
      setSaving(false);
    }
  };

  // Booked, but the invite never reached Microsoft -- treat it as needing
  // attention rather than done, so it isn't mistaken for a confirmed meeting.
  const notInvited = review.booked && review.event?.invited === false;

  return (
    <div className={`rounded-2xl border p-4 md:p-5 transition-smooth ${
      notInvited ? 'border-amber-200 bg-amber-50/40'
        : review.booked ? 'border-emerald-200 bg-emerald-50/40' : 'border-foreground-200/70 bg-background-50'
    }`}>
      <div className="flex items-start gap-3">
        <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
          notInvited ? 'bg-amber-500 text-white'
            : review.booked ? 'bg-emerald-500 text-white' : 'bg-primary-50 text-primary-600'
        }`}>
          <i className={`${notInvited ? 'ri-alert-line' : review.booked ? 'ri-check-line' : icon} text-[18px]`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14px] font-heading font-semibold text-foreground-900">{review.label}</h3>
            {review.booked && (
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                notInvited ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'
              }`}>{notInvited ? 'Invite not sent' : 'Booked'}</span>
            )}
          </div>

          {review.booked && review.event ? (
            <div className="mt-2.5">
              <p className="text-[12px] text-foreground-700 inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                <span><i className={`ri-calendar-line mr-1 ${notInvited ? 'text-amber-600' : 'text-emerald-600'}`} />{review.event.scheduledDate}</span>
                <span><i className={`ri-time-line mr-1 ${notInvited ? 'text-amber-600' : 'text-emerald-600'}`} />{review.event.scheduledTime || 'Time TBC'}</span>
                {review.event.coachName && <span><i className={`ri-user-line mr-1 ${notInvited ? 'text-amber-600' : 'text-emerald-600'}`} />{review.event.coachName}</span>}
                {review.event.meetingLink && (
                  <a href={review.event.meetingLink} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">
                    <i className="ri-video-chat-line mr-1" />Join Teams meeting
                  </a>
                )}
              </p>
              {notInvited && (
                <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 mt-2.5">
                  <i className="ri-error-warning-line mr-1" />
                  This slot is saved, but the calendar invite and email could not be sent. Please tell your
                  programme team, or cancel and book again.
                </p>
              )}
              {confirmCancel ? (
                <div className="mt-3 rounded-xl border border-red-200 bg-red-50/60 p-3">
                  <p className="text-[12px] text-foreground-700">
                    Cancel this review? It will be removed from both calendars and
                    {review.event.coachName ? ` ${review.event.coachName}` : ' your enrolment officer'} will be emailed. You can book a new time afterwards.
                  </p>
                  {err && <p className="text-[11px] text-red-600 mt-2"><i className="ri-error-warning-line mr-1" />{err}</p>}
                  <div className="flex items-center gap-2 mt-3">
                    <button onClick={cancel} disabled={saving}
                      className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60">
                      {saving ? <><i className="ri-loader-4-line animate-spin" />Cancelling…</> : <><i className="ri-close-circle-line" />Yes, cancel booking</>}
                    </button>
                    <button onClick={() => { setConfirmCancel(false); setErr(null); }} disabled={saving} className={btnSecondary}>Keep it</button>
                  </div>
                </div>
              ) : (
                <div className="mt-2.5 flex flex-wrap items-center gap-3">
                  {/* Once booked, the review's form is what's left to do — so the
                      primary action becomes Start / Continue / View. */}
                  {review.hasForm && (
                    <button onClick={() => navigate(`/learner/onboarding/reviews/${encodeURIComponent(review.event!.eventKey)}`)}
                      className={btnPrimary}>
                      {review.formCompleted
                        ? <><i className="ri-eye-line" />View review</>
                        : review.formStarted
                          ? <><i className="ri-play-circle-line" />Continue review</>
                          : <><i className="ri-play-circle-line" />Start</>}
                    </button>
                  )}
                  {/* Signing opens only once the review is finished. */}
                  {review.formCompleted && (
                    <button onClick={() => setSigning(true)} className={btnSecondary}>
                      {review.learnerSigned
                        ? <><i className="ri-check-line text-emerald-600" />Signed</>
                        : <><i className="ri-pen-nib-line" />Sign review</>}
                    </button>
                  )}
                  <button onClick={() => setConfirmCancel(true)}
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-red-600 hover:text-red-700 hover:underline">
                    <i className="ri-close-circle-line" />Cancel booking
                  </button>
                </div>
              )}
            </div>
          ) : open ? (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <label className="block">
                  <span className="text-[10px] font-semibold text-foreground-500 block mb-1">Date</span>
                  <input type="date" value={date} min={todayIso()} onChange={(e) => setDate(e.target.value)}
                    className="w-full bg-background-100 border border-foreground-200 rounded-lg px-2 py-1.5 text-[12px] text-foreground-800 focus:outline-none focus:ring-1 focus:ring-primary-400/40" />
                </label>
                <label className="block">
                  <span className="text-[10px] font-semibold text-foreground-500 block mb-1">Time</span>
                  <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
                    className="w-full bg-background-100 border border-foreground-200 rounded-lg px-2 py-1.5 text-[12px] text-foreground-800 focus:outline-none focus:ring-1 focus:ring-primary-400/40" />
                </label>
                <label className="block">
                  <span className="text-[10px] font-semibold text-foreground-500 block mb-1">Duration</span>
                  <select value={duration} onChange={(e) => setDuration(e.target.value)}
                    className="w-full bg-background-100 border border-foreground-200 rounded-lg px-2 py-1.5 text-[12px] text-foreground-800 cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary-400/40">
                    <option value="30">30 minutes</option>
                    <option value="45">45 minutes</option>
                    <option value="60">1 hour</option>
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="text-[10px] font-semibold text-foreground-500 block mb-1">Notes (optional)</span>
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything you'd like to cover?"
                  className="w-full bg-background-100 border border-foreground-200 rounded-lg px-2 py-1.5 text-[12px] text-foreground-800 resize-none focus:outline-none focus:ring-1 focus:ring-primary-400/40" />
              </label>
              {err && <p className="text-[11px] text-red-600"><i className="ri-error-warning-line mr-1" />{err}</p>}
              <div className="flex items-center gap-2">
                <button onClick={submit} disabled={saving} className={btnPrimary}>
                  {saving ? <><i className="ri-loader-4-line animate-spin" />Booking…</> : <><i className="ri-calendar-check-line" />Confirm booking</>}
                </button>
                <button onClick={() => { setOpen(false); setErr(null); }} disabled={saving} className={btnSecondary}>Cancel</button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setOpen(true)}
              disabled={disabled}
              title={disabled ? 'A case owner must be assigned before you can book' : undefined}
              className={`${btnPrimary} mt-3 ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              {/* Label kept verbatim -- lowercasing would mangle "FS" and "RPL". */}
              <i className="ri-add-line" />Book {review.label}
            </button>
          )}
          {!review.booked && !open && coachName && (
            <p className="text-[11px] text-foreground-400 mt-2">Booked with {coachName}, added to both calendars, and emailed to them.</p>
          )}
          {warning && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 mt-2.5">
              <i className="ri-error-warning-line mr-1" />
              Saved, but the calendar invite could not be sent: {warning}
            </p>
          )}
        </div>
      </div>

      {signing && signData && review.event && (
        <SignReviewModal
          kind={kind}
          learnerId={id}
          eventKey={review.event.eventKey}
          party="learner"
          defaultName={signData.learnerInformation.name}
          signatures={signData.signatures}
          onClose={() => setSigning(false)}
          onSigned={(signatures) => {
            setSignData((prev) => (prev ? { ...prev, signatures } : prev));
            // Refresh the list so the button flips to "Signed".
            onBooked();
          }}
        />
      )}
    </div>
  );
}

/**
 * The learner's three enrolment reviews.
 *
 * Shown once the enrolment form has been submitted: all three must be booked
 * before the enrolment team finishes the enrolment. They are booked with the
 * learner's case owner rather than a coach — an onboarding learner has no coach
 * assigned yet, which is exactly what these meetings lead to.
 */
export default function OnboardingReviewsPage() {
  const { kind, id } = useMyLearner();
  const isCommercial = kind === 'commercial';
  const [data, setData] = useState<OnboardingReviewsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    if (isCommercial) {
      setLoading(false);
      return;
    }
    fetchOnboardingReviews(kind, id)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [kind, id, isCommercial]);

  useEffect(load, [load]);

  const bookedCount = data?.reviews.filter((r) => r.booked).length ?? 0;
  const total = data?.reviews.length ?? 3;
  // Bookings whose invite never sent aren't really done -- surface them so the
  // learner isn't left thinking all three meetings are confirmed.
  const notInvitedCount = data?.reviews.filter((r) => r.booked && r.event?.invited === false).length ?? 0;

  if (isCommercial) {
    return (
      <WorkspaceShell
        role="learner"
        roleLabel={learnerNav.label}
        navItems={learnerNav.items}
        workspaceLabel={learnerNav.workspaceLabel}
        pageTitle="Reviews"
        pageSubtitle="Not required for commercial delivery"
        userName="Learner"
        userRole="Learner"
      >
        <main className="p-4 md:p-6">
          <div className="mx-auto max-w-2xl rounded-2xl border border-primary-200 bg-primary-50/40 p-8 text-center">
            <i className="ri-information-line text-3xl text-primary-600" />
            <h2 className="mt-3 text-lg font-heading font-semibold text-foreground-900">No onboarding reviews are required</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-foreground-600">Commercial learners go straight to programme delivery without apprenticeship onboarding reviews.</p>
          </div>
        </main>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={ONBOARDING_NAV_ITEMS}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Reviews"
      pageSubtitle="Book your three enrolment reviews"
      userName="Learner"
      userRole="Learner"
    >
      <main className="w-full p-4 md:p-6 space-y-4">
        <div className="rounded-2xl border border-foreground-200/60 bg-background-50 p-4 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[15px] font-heading font-semibold text-foreground-900">Your enrolment reviews</h2>
              <p className="text-[12px] text-foreground-500 mt-1 max-w-2xl leading-relaxed">
                Thank you for submitting your enrolment. To complete it, please book all three reviews below with your
                enrolment officer. Each one appears in your calendar and theirs.
              </p>
            </div>
            <span className={`text-[12px] font-semibold px-3 py-1.5 rounded-full shrink-0 ${
              notInvitedCount > 0 ? 'bg-amber-100 text-amber-800'
                : bookedCount === total ? 'bg-emerald-100 text-emerald-700' : 'bg-primary-50 text-primary-700'
            }`}>
              {bookedCount} of {total} booked
            </span>
          </div>
          <div className="mt-3 h-1.5 rounded-full bg-background-200 overflow-hidden">
            <div className="h-full rounded-full bg-primary-500 transition-all duration-500" style={{ width: `${(bookedCount / total) * 100}%` }} />
          </div>
        </div>

        {loading && (
          <div className="rounded-2xl border border-foreground-200/60 bg-background-50 p-5">
            <RowsSkeleton rows={4} />
          </div>
        )}

        {!loading && error && (
          <div className="py-16 text-center text-[13px]">
            <p className="text-red-600 mb-3"><i className="ri-error-warning-line mr-1.5" />{error}</p>
            <button className={btnSecondary} onClick={load}><i className="ri-refresh-line" />Retry</button>
          </div>
        )}

        {!loading && !error && data && !data.caseOwner && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-[12px] text-amber-800">
            <i className="ri-error-warning-line mr-1.5" />
            No case owner has been assigned to you yet, so these reviews can’t be booked. Please contact your programme team.
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-3">
            {data.reviews.map((review) => (
              <ReviewCard
                key={review.type}
                review={review}
                coachName={data.caseOwner?.name ?? ''}
                disabled={!data.caseOwner}
                onBooked={load}
              />
            ))}
          </div>
        )}

        {!loading && !error && data?.allBooked && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 flex items-start gap-3">
            <span className="w-9 h-9 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0">
              <i className="ri-check-double-line" />
            </span>
            <div>
              <p className="text-[13px] font-semibold text-emerald-800">All three reviews are booked</p>
              <p className="text-[12px] text-emerald-700/90 mt-0.5">
                Your enrolment officer will confirm your place once the reviews have taken place.
              </p>
            </div>
          </div>
        )}
      </main>
    </WorkspaceShell>
  );
}
