import Swal from 'sweetalert2';
import type { TeamsMeetingInput, TeamsMeetingResult } from '../module-builder/moduleAuthoringData';
import { sendScheduleEmailBatch, submitAddedPeopleEmails, submitChangeEmails, type ScheduleEmailStatus } from './scheduleEmail';
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

/** What was sent to the calendar, as the update result dialog reads it. */
export type UpdatedCalendar = Pick<TeamsMeetingInput, 'title' | 'scheduledOccurrences'> & {
  scheduleTimeZone?: string;
  liveSessionId?: string;
  /** People this update invited who were not invited before: the learners among them are sent the full schedule. */
  addedPeople?: string[];
};

// Only learners are emailed, so a calendar that invites none has nothing to send.
const mailLine = (email: ScheduleEmailStatus) => email.total
  ? `${email.accepted} of ${email.total} submitted to Microsoft${email.failed ? ` · ${email.failed} failed` : ''}${email.uncertain ? ` · ${email.uncertain} awaiting verification` : ''}`
  : 'None to send — nobody is invited';

/** The dates the update put on the calendar, as one readable span. */
function sessionSpan(input: UpdatedCalendar): string {
  const starts = (input.scheduledOccurrences || []).map(item => Date.parse(item.startDateTimeUtc)).filter(Number.isFinite).sort((left, right) => left - right);
  if (!starts.length) return '';
  const format = (value: number) => new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: input.scheduleTimeZone || 'UTC',
  }).format(new Date(value));
  const first = format(starts[0]);
  const last = format(starts[starts.length - 1]);
  return first === last ? first : `${first} – ${last}`;
}

/** What an update returns that its result dialog needs. */
export interface TeamsUpdateOutcome {
  updated?: boolean;
  meeting: Partial<TeamsMeetingResult['meeting']>;
  warnings?: Array<{ message: string }>;
  /** The server-signed before/after record; empty when no session date moved. */
  changeNotice?: string;
  /**
   * Whether this save is announced. A moved calendar is: Microsoft tells
   * everyone invited and the LMS change email follows. A save that only
   * changed who is invited, or how the meeting runs, is not.
   */
  notifyAttendees?: boolean;
}

/**
 * What an update did, once Microsoft has confirmed it.
 *
 * Separate from `finishTeamsCreation` because the two finish differently. A
 * create always submits one schedule email per invited participant. An update emails
 * about the change only when the calendar actually moved, and then sends the
 * change email -- each invited participant their own copy with what their
 * dates were and are now; Microsoft mails its own change notice to everyone
 * invited alongside it. The organiser, co-organisers and presenters are never
 * emailed by the LMS. A save that only changed who is invited announces
 * nothing to the people already on the meeting, in Teams or here: the people it
 * added are forwarded the meeting, the learners among them are sent the full
 * schedule, and they are the only ones who hear about it.
 *
 * Until this existed, a successful update closed the dialog and said nothing at
 * all, which read exactly like an update that had not happened.
 */
export async function finishTeamsUpdate(
  result: TeamsUpdateOutcome,
  input: UpdatedCalendar,
  extraWarning = '',
): Promise<void> {
  const sessionCount = input.scheduledOccurrences?.length || 0;
  const warnings = [...(result.warnings || []).map(item => item.message), extraWarning].filter(Boolean);
  const liveSessionId = String(result.meeting?.liveSessionId || input.liveSessionId || '');
  const notice = String(result.changeNotice || '');
  const notify = Boolean(result.notifyAttendees);
  const canSend = notify && Boolean(notice && liveSessionId);
  const added = input.addedPeople || [];
  const canWelcome = Boolean(added.length && liveSessionId);
  const span = sessionSpan(input);
  let email: ScheduleEmailStatus | undefined;
  let welcome: ScheduleEmailStatus | undefined;
  let error = '';
  let welcomeError = '';
  let retryFailed = false;
  // Decided in the review, before anything was sent: the dialog only carries it out.
  let shouldSend = canSend;
  let shouldWelcome = canWelcome;
  const progressText = (status: ScheduleEmailStatus) => {
    const progress = document.getElementById('teams-email-progress');
    if (progress) progress.textContent = `${status.accepted} of ${status.total} submitted to Microsoft`;
  };
  const sending = (title: string, text: string) => void Swal.fire({
    title,
    html: `<p class="teams-calendar-result-module">${htmlText(input.title)}</p><p>${htmlText(text)}</p><p role="status" id="teams-email-progress">Preparing emails…</p>`,
    showConfirmButton: false, allowOutsideClick: false, allowEscapeKey: false,
    customClass: { ...classes, popup: 'teams-calendar-result teams-calendar-sending' },
    didOpen: popup => { if (Swal.getPopup() === popup) Swal.showLoading(); },
  });
  while (true) {
    if (shouldSend) {
      sending('Sending change emails', 'The calendar is already updated. Submitting one individual email per invited participant.');
      try {
        email = await submitChangeEmails(liveSessionId, notice, { retryFailed, onProgress: progressText });
        error = '';
      } catch (caught) {
        error = caught instanceof Error ? caught.message : 'Change emails could not be confirmed.';
      }
      Swal.close();
    }
    if (shouldWelcome) {
      sending('Emailing the people you added', 'The calendar is already updated. Each person added to it gets the full schedule, once.');
      try {
        welcome = await submitAddedPeopleEmails(liveSessionId, added, { retryFailed, onProgress: progressText });
        welcomeError = '';
      } catch (caught) {
        welcomeError = caught instanceof Error ? caught.message : 'Schedule emails for the people you added could not be confirmed.';
      }
      Swal.close();
    }
    shouldSend = false;
    shouldWelcome = false;
    const incomplete = Boolean(error || welcomeError || email?.failed || email?.uncertain || email?.queued
      || welcome?.failed || welcome?.uncertain || welcome?.queued || warnings.length);
    const mailSummary = email
      ? mailLine(email)
      : !notify ? 'Not sent — nothing changed that everyone invited has to be told'
        : !notice ? 'Not sent — no session date changed'
          : 'Not sent';
    // A total of 0 means nobody added is a learner: presenters and co-organisers
    // get Microsoft's invitation and no schedule email.
    const welcomeSummary = welcome ? (welcome.total ? mailLine(welcome) : 'None to send — no people were added') : 'Not sent';
    const retryable = (canSend && Boolean(error || email?.failed || email?.queued))
      || (canWelcome && Boolean(welcomeError || welcome?.failed || welcome?.queued));
    const choice = await Swal.fire({
      title: incomplete ? 'Calendar updated · attention needed' : 'Calendar updated',
      html: `<div class="teams-calendar-result-mark${incomplete ? ' teams-calendar-result-warning' : ''}" aria-hidden="true">${incomplete ? '!' : '✓'}</div>
        <p class="teams-calendar-result-module">${htmlText(input.title)}</p>
        <div class="teams-calendar-result-facts"><div><span>Teams calendar</span><strong>${sessionCount} session${sessionCount === 1 ? '' : 's'} updated</strong></div>${span ? `<div><span>Dates</span><strong>${htmlText(span)}</strong></div>` : ''}<div><span>Change emails</span><strong>${htmlText(mailSummary)}</strong></div>${canWelcome ? `<div><span>Schedule emails to ${added.length} added ${added.length === 1 ? 'person' : 'people'}</span><strong>${htmlText(welcomeSummary)}</strong></div>` : ''}</div>
        ${error ? `<p class="teams-calendar-result-note" role="alert">${htmlText(error)}</p>` : ''}
        ${welcomeError ? `<p class="teams-calendar-result-note" role="alert">${htmlText(welcomeError)}</p>` : ''}
        ${warnings.map(warning => `<p class="teams-calendar-result-note" role="alert">${htmlText(warning)}</p>`).join('')}
        ${email?.uncertain || welcome?.uncertain ? '<p class="teams-calendar-result-note">Emails with an uncertain result will not be sent again automatically. An administrator can check their status.</p>' : ''}
        <p class="teams-calendar-result-help">${notify ? 'Microsoft notifies everyone already invited when a meeting moves. The change email is a separate message: every invited participant receives their own copy with their previous and new dates only.' : 'No session moved, so Microsoft was asked not to announce this save: nobody already invited was emailed, by Teams or by the LMS.'}</p>
        ${canWelcome ? '<p class="teams-calendar-result-help">Everyone you added is sent the meeting invitation by Microsoft and the full schedule email from the LMS. Nobody already on the calendar is emailed again.</p>' : ''}
        <p class="teams-calendar-result-help">Done closes this message. It does not save or send anything else.</p>`,
      width: 560, buttonsStyling: false, customClass: classes,
      showCloseButton: true, closeButtonAriaLabel: 'Close result',
      confirmButtonText: 'Done',
      showDenyButton: retryable,
      denyButtonText: 'Retry pending emails',
      reverseButtons: true, allowOutsideClick: false, focusConfirm: true,
    });
    if (!choice.isDenied) return;
    retryFailed = true;
    shouldSend = canSend && Boolean(error || email?.failed || email?.queued);
    shouldWelcome = canWelcome && Boolean(welcomeError || welcome?.failed || welcome?.queued);
  }
}

/** A server-reported email outcome, when it is a complete, consistent count. */
function readServerEmail(value: TeamsMeetingResult['scheduleEmail']): ScheduleEmailStatus | undefined {
  if (!value || value.error) return undefined;
  const counts = [value.total, value.accepted, value.queued, value.failed, value.uncertain];
  if (!counts.every(count => Number.isInteger(count) && Number(count) >= 0)) return undefined;
  const [total, accepted, queued, failed, uncertain] = counts as number[];
  if (total !== accepted + queued + failed + uncertain) return undefined;
  return { total, accepted, queued, failed, uncertain, status: accepted === total ? 'complete' : 'pending' };
}

/**
 * The calendar is already saved. Mail failures must never restart its creation.
 *
 * The server sends the schedule emails itself as soon as Microsoft has verified
 * the calendar and accepted its invitations, and reports them on the result;
 * this dialog then only shows what was sent. It submits from the browser only
 * when the server did not finish the job -- a recovered create, a batch left
 * queued, or an error -- and the delivery ledger means that can never email
 * anyone a second time.
 */
export async function finishTeamsCreation(result: TeamsMeetingResult, input: TeamsMeetingInput, extraWarning = ''): Promise<void> {
  const sessionCount = input.scheduledOccurrences?.length || 0;
  const warnings = [...result.warnings, extraWarning].filter(Boolean);
  const verified = result.meeting.settingsApplied && result.warnings.length === 0 && Boolean(result.meeting.liveSessionId);
  const serverEmail = verified ? readServerEmail(result.scheduleEmail) : undefined;
  let email: ScheduleEmailStatus | undefined = serverEmail;
  let error = !verified
    ? 'Schedule emails were not sent because calendar verification is incomplete.'
    : result.scheduleEmail?.error ? String(result.scheduleEmail.error) : '';
  let retryFailed = false;
  // Sent already, apart from any the server left queued: nothing to do here.
  let shouldSend = verified && !error && (!serverEmail || serverEmail.queued > 0);
  while (true) {
    if (shouldSend) {
      void Swal.fire({
        title: 'Sending schedule emails',
        html: `<p class="teams-calendar-result-module">${htmlText(input.title)}</p><p>Your Teams calendar is saved. Submitting one individual schedule email per invited participant.</p><p role="status" id="teams-email-progress">Preparing emails…</p>`,
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
    const mailSummary = email ? mailLine(email) : 'Not submitted';
    const choice = await Swal.fire({
      title: incomplete ? 'Calendar saved · attention needed' : email?.total ? 'Teams calendar created · emails sent' : 'Teams calendar created',
      html: `<div class="teams-calendar-result-mark${incomplete ? ' teams-calendar-result-warning' : ''}" aria-hidden="true">${incomplete ? '!' : '✓'}</div>
        <p class="teams-calendar-result-module">${htmlText(input.title)}</p>
        <div class="teams-calendar-result-facts"><div><span>Teams calendar</span><strong>${sessionCount} session${sessionCount === 1 ? '' : 's'} saved</strong></div>${verified ? '<div><span>Teams invitations</span><strong>Sent by Microsoft</strong></div>' : ''}<div><span>Schedule emails</span><strong>${htmlText(mailSummary)}</strong></div></div>
        ${error ? `<p class="teams-calendar-result-note" role="alert">${htmlText(error)}</p>` : ''}
        ${warnings.map(warning => `<p class="teams-calendar-result-note" role="alert">${htmlText(warning)}</p>`).join('')}
        ${email?.uncertain ? '<p class="teams-calendar-result-note">Emails with an uncertain result will not be sent again automatically. An administrator can check their status.</p>' : ''}
        <p class="teams-calendar-result-help">Each schedule email is addressed to one invited participant and carries their own schedule only. Microsoft acceptance does not confirm arrival in the Inbox.</p>
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
