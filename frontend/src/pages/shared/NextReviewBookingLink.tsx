import type { ReactNode } from 'react';
import { type ReviewBookingFamily } from './nextReviewBooking';

export function NextReviewBookingLink({ family, onBook, busy = false, feedback }: {
  family: ReviewBookingFamily;
  onBook: () => void;
  busy?: boolean;
  feedback?: ReactNode;
}) {
  const name = family === 'mcm' ? 'Monthly Coaching Meeting' : 'Progress Review';
  return <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
    <p className="mb-2">The next {name} has not been confirmed as booked.</p>
    <button type="button" onClick={onBook} disabled={busy}
      className="inline-flex min-h-10 items-center rounded-lg bg-primary-700 px-4 py-2 font-semibold text-white hover:bg-primary-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-700 disabled:opacity-60">
      {busy ? 'Finding next meeting...' : `Book next ${name}`}
    </button>
    {typeof feedback === 'string' && feedback ? <p role="status" className="mt-2 font-semibold">{feedback}</p> : feedback}
  </div>;
}
