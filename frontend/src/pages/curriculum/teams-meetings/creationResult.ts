import Swal from 'sweetalert2';
import type { TeamsMeetingInput, TeamsMeetingResult } from '../module-builder/moduleAuthoringData';
import { sendScheduleEmailBatch, type ScheduleEmailStatus } from './scheduleEmail';
import './calendarReview.css';

const htmlText = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]!));

const classes = {
  popup: 'teams-calendar-result', title: 'teams-calendar-result-title',
  htmlContainer: 'teams-calendar-result-body', actions: 'teams-calendar-result-actions',
  confirmButton: 'teams-calendar-result-done', denyButton: 'teams-calendar-result-retry',
  closeButton: 'teams-calendar-result-close',
};

/** The calendar is already saved. Mail failures must never restart its creation. */
export async function finishTeamsCreation(result: TeamsMeetingResult, input: TeamsMeetingInput, extraWarning = ''): Promise<void> {
  const sessionCount = input.scheduledOccurrences?.length || 0;
  const warnings = [...result.warnings, extraWarning].filter(Boolean);
  const verified = result.meeting.settingsApplied && result.warnings.length === 0 && Boolean(result.meeting.liveSessionId);
  let email: ScheduleEmailStatus | undefined;
  let error = verified ? '' : 'Schedule emails were not sent because calendar verification is incomplete.';
  let retryFailed = false;
  let shouldSend = verified;
  while (true) {
    if (shouldSend) {
      void Swal.fire({
        title: 'Sending schedule emails',
        html: `<p class="teams-calendar-result-module">${htmlText(input.title)}</p><p>Your Teams calendar is saved. Submitting one individual schedule email per attendee.</p><p role="status" id="teams-email-progress">Preparing emails…</p>`,
        showConfirmButton: false, allowOutsideClick: false, allowEscapeKey: false,
        customClass: { ...classes, popup: 'teams-calendar-result teams-calendar-sending' },
        didOpen: popup => { if (Swal.getPopup() === popup) Swal.showLoading(); },
      });
      try {
        let previousQueued: number | undefined;
        do {
          email = await sendScheduleEmailBatch(result.meeting.liveSessionId, retryFailed);
          retryFailed = false;
          const progress = document.getElementById('teams-email-progress');
          if (progress) progress.textContent = `${email.accepted} of ${email.total} submitted to Microsoft`;
          if (email.queued > 0 && previousQueued !== undefined && email.queued >= previousQueued) {
            throw new Error('Some emails are still pending. Retry to continue without recreating the calendar.');
          }
          previousQueued = email.queued;
        } while (email.queued > 0);
        error = '';
      } catch (caught) {
        error = caught instanceof Error ? caught.message : 'Schedule emails could not be confirmed.';
      }
      Swal.close();
    }
    const incomplete = Boolean(error || email?.failed || email?.uncertain || email?.queued || warnings.length);
    const mailSummary = email
      ? `${email.accepted} of ${email.total} submitted to Microsoft${email.failed ? ` · ${email.failed} failed` : ''}${email.uncertain ? ` · ${email.uncertain} awaiting verification` : ''}`
      : 'Not submitted';
    const choice = await Swal.fire({
      title: incomplete ? 'Calendar saved · attention needed' : 'Calendar saved',
      html: `<div class="teams-calendar-result-mark${incomplete ? ' teams-calendar-result-warning' : ''}" aria-hidden="true">${incomplete ? '!' : '✓'}</div>
        <p class="teams-calendar-result-module">${htmlText(input.title)}</p>
        <div class="teams-calendar-result-facts"><div><span>Teams calendar</span><strong>${sessionCount} session${sessionCount === 1 ? '' : 's'} saved</strong></div><div><span>Schedule emails</span><strong>${htmlText(mailSummary)}</strong></div></div>
        ${error ? `<p class="teams-calendar-result-note" role="alert">${htmlText(error)}</p>` : ''}
        ${warnings.map(warning => `<p class="teams-calendar-result-note" role="alert">${htmlText(warning)}</p>`).join('')}
        ${email?.uncertain ? '<p class="teams-calendar-result-note">Emails with an uncertain result will not be sent again automatically. An administrator can check their status.</p>' : ''}
        <p class="teams-calendar-result-help">Each schedule email is addressed to one attendee. Microsoft acceptance does not confirm arrival in the Inbox.</p>
        <p class="teams-calendar-result-help">Done closes this message. It does not save or send anything else.</p>`,
      width: 560, buttonsStyling: false, customClass: classes,
      showCloseButton: true, closeButtonAriaLabel: 'Close result',
      confirmButtonText: 'Done', showDenyButton: verified && Boolean(error || email?.failed || email?.queued),
      denyButtonText: 'Retry pending emails', reverseButtons: true,
      allowOutsideClick: false, focusConfirm: true,
    });
    if (!choice.isDenied) return;
    retryFailed = true;
    shouldSend = true;
  }
}
