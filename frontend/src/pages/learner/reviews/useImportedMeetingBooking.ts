import { useEffect, useState } from 'react';
import type { LearnerKind } from '@/api/learnerDetail';
import { fetchReviewHistory, type ImportedReview } from '@/api/reviewHistory';
import { fetchMeetingAttendance } from '@/api/meetingAttendance';

type Target = { review: ImportedReview; source: 'mcr' | 'progress-review'; eventKey: string | null };

/** Resolve the owned review's durable booking, never another meeting on its date. */
export function useImportedMeetingBooking(learner: { kind: LearnerKind; id: string }, search: string): { target?: Target; error?: string } {
  const [result, setResult] = useState<{ search: string; target?: Target; error?: string }>({ search: '' });
  useEffect(() => {
    const params = new URLSearchParams(search);
    const reviewId = params.get('reviewId');
    const source = params.get('source');
    if (!reviewId) return;
    if (source !== 'mcr' && source !== 'progress-review') {
      setResult({ search, error: 'Choose a Monthly Coaching Meeting or Progress Review to schedule.' });
      return;
    }
    let active = true;
    Promise.all([
      fetchReviewHistory(learner.kind, learner.id, source === 'mcr' ? 'monthly-coaching' : 'progress-review'),
      fetchMeetingAttendance(learner.kind, learner.id),
    ]).then(([history, attendance]) => {
      const review = history.reviews.find(item => item.id === reviewId);
      const allowed = source === 'mcr' ? ['monthly coaching meeting', 'monthly coaching', 'mcm'] : ['progress review', 'progress review (+ skills radar)'];
      if (!review || !allowed.includes(review.type.trim().toLowerCase())) throw new Error('This meeting is no longer available for scheduling. Return to your meetings and refresh the list.');
      const meeting = attendance.sessions.find(item => item.id === `imported-review:${reviewId}`);
      if (active) setResult({ search, target: { review, source, eventKey: meeting?.calendarEventKey || null } });
    }).catch(reason => {
      if (active) setResult({ search, error: reason instanceof Error ? reason.message : 'Could not load this meeting. Please try again.' });
    });
    return () => { active = false; };
  }, [learner.kind, learner.id, search]);
  return result.search === search ? result : {};
}
