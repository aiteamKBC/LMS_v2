import type { RefObject } from 'react';
import { Modal } from '@/pages/users/components/Modal';
import { AppIcon } from '@/components/feature/AppIcon';
import type { Summary } from './api';
import { coachContact, contentUrl, monthLabel, monthStatus } from './report';
import styles from './report.module.css';
import design from './design.module.css';
import { RecordBadge, RecordProgress } from './RecordDesign';

export function TransitionDialog({ summary, error, checking, onClose, onReview, onRetry, returnFocusRef }: {
  summary?: Summary; error?: string; checking: boolean; onClose: () => void; onReview: () => void; onRetry: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const total = summary?.total_months ?? 0;
  const completed = summary?.completed_months ?? 0;
  const contact = coachContact(summary);
  const booking = contentUrl(summary?.learner?.coach_booking_url);
  const outstanding = summary?.months.filter(month => month.status !== 'complete') ?? [];
  return <Modal size="max-w-xl" className={`${design.scope} ${design.dialog}`} returnFocusRef={returnFocusRef} title={error ? 'We couldn’t check your record' : 'Your next chapter is nearly ready'} onClose={onClose} footer={<>
    <button className={design.secondaryButton} onClick={onClose}>Not now</button>
    <button className={design.primaryButton} disabled={checking} onClick={error ? onRetry : onReview}>
      {checking ? 'Checking…' : error ? 'Try again' : 'Review outstanding months'}<AppIcon className="ri-arrow-right-line" /></button>
  </>}><div className={`${styles.modalIntro} space-y-5`}>
    <div className={design.dialogIntro}><span className={`${design.iconTile} ${design.iconSolid}`}><AppIcon className="ri-graduation-cap-line" /></span>
      <RecordBadge>{error ? 'Check unavailable' : 'Your learning transition'}</RecordBadge></div>
    {error ? <p role="alert" className="text-sm text-foreground-600">{error} Please try again to check your LMS access.</p> : <>
      <p className="text-sm leading-relaxed text-foreground-600">Review and sign each month in your previous learning record. Draw your signature for the first month, then import it into each remaining month.</p>
      <div className={`${design.fact} space-y-3`}><p className="text-[13px] font-semibold">{completed} of {total} months complete <span className="font-normal text-foreground-500">· {Math.max(0, total - completed)} remaining</span></p>
        <RecordProgress completed={completed} total={total} /></div>
      {outstanding.length > 0 && <div><h3 className="mb-3 text-[13px] font-semibold">Outstanding months</h3><ul className={design.outstanding}>
        {outstanding.slice(0, 4).map(month => <li key={month.month}><AppIcon className={month.can_complete ? 'ri-checkbox-circle-line' : 'ri-radio-button-line'} />
          <div><p className="font-medium">{monthLabel(month.month)}</p><p className="mt-0.5 text-xs text-foreground-500">{monthStatus(month)}</p></div></li>)}
      </ul>{outstanding.length > 4 && <p className="mt-3 text-xs text-foreground-500">And {outstanding.length - 4} more months to review.</p>}</div>}
      {(summary?.learner?.coach_name || contact || booking) && <div className={design.coachContact}><span className={design.iconTile}><AppIcon className="ri-user-heart-line" /></span>
        <div><p className={design.eyebrow}>Your assigned coach</p><p className="mt-1 text-sm font-semibold">{summary?.learner?.coach_name || 'Your coach'}</p>
          <div className={design.coachActions}>
            {booking && <a className={design.coachBooking} href={booking} target="_blank" rel="noopener noreferrer"
              aria-label={`Book a session with ${summary?.learner?.coach_name || 'your coach'} (opens in a new tab)`}>
              <AppIcon className="ri-calendar-check-line" />Book a session<AppIcon className="ri-external-link-line" /></a>}
            {contact && <a href={contact}><AppIcon className="ri-mail-line" />{booking ? 'Email your coach' : 'Contact your coach'}</a>}
          </div>
          {!booking && !contact && <p className="mt-1 text-xs text-foreground-500">Contact your programme team for your coach’s details.</p>}
        </div></div>}
    </>}
  </div></Modal>;
}
