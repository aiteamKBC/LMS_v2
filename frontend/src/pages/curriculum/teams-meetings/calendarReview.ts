import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';
import type { TeamsMeetingInput } from '../module-builder/moduleAuthoringData';
import { reviewDateLabel } from './calendarTime';

export type ReviewedCalendar = Pick<TeamsMeetingInput, 'title' | 'organizerEmail' | 'scheduledOccurrences'> &
  Partial<TeamsMeetingInput> & { joinUrl?: string; peopleOnly?: boolean;
    calendarSeries?: Array<{ day: string; joinUrl: string; sessionNumbers: number[] }>;
    previousOccurrences?: Array<{ session_number: number; scheduled_start: string }>;
  };

export class TeamsReviewCancelled extends Error {
  constructor() { super('Calendar review cancelled.'); }
}

export const isTeamsReviewCancelled = (error: unknown) => error instanceof TeamsReviewCancelled;

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]!));

export function calendarReviewHtml(input: ReviewedCalendar, zone: string): string {
  const sessions = input.scheduledOccurrences || [];
  if (!sessions.length || sessions.length > 52) throw new Error('Review between 1 and 52 session dates before sending.');
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const people = [input.organizerEmail, ...(input.attendees || []), ...(input.presenters || []), ...(input.coOrganizers || [])];
  if (people.some(value => !email.test(value))) throw new Error('Check the organizer and invitation email addresses.');
  const numbers = new Set<number>();
  const ordered = [...sessions].sort((a, b) => Date.parse(a.startDateTimeUtc) - Date.parse(b.startDateTimeUtc));
  let previousEnd = -Infinity;
  for (const session of ordered) {
    const start = Date.parse(session.startDateTimeUtc);
    if (!Number.isFinite(start) || !/(Z|[+-]\d{2}:\d{2})$/i.test(session.startDateTimeUtc)
      || !Number.isInteger(session.sessionNumber) || session.sessionNumber < 1 || numbers.has(session.sessionNumber)
      || !Number.isFinite(session.durationMinutes) || session.durationMinutes < 15 || session.durationMinutes > 1440
      || start < previousEnd) throw new Error('Check session numbers, dates and durations. Sessions must not overlap.');
    numbers.add(session.sessionNumber);
    previousEnd = start + session.durationMinutes * 60000;
  }
  const rows = ordered.map(session => {
    const link = input.calendarSeries?.find(series => series.sessionNumbers.includes(session.sessionNumber))?.joinUrl || input.joinUrl;
    const previous = input.previousOccurrences?.find(item => item.session_number === session.sessionNumber)?.scheduled_start;
    return `<tr><td>${session.sessionNumber}</td><td>${escapeHtml(reviewDateLabel(session.startDateTimeUtc, zone))}${previous && Date.parse(previous) !== Date.parse(session.startDateTimeUtc) ? `<br><small>Previously saved: ${escapeHtml(reviewDateLabel(previous, zone))}</small>` : ''}</td><td>${escapeHtml(reviewDateLabel(new Date(Date.parse(session.startDateTimeUtc) + session.durationMinutes * 60000).toISOString(), zone))}</td><td>${session.durationMinutes} min</td><td>${escapeHtml(link || 'Generated after creation')}</td></tr>`;
  }).join('');
  const unique = (values: string[] = []) => [...new Set(values.map(value => value.trim().toLowerCase()))];
  const coOrganizers = unique(input.coOrganizers);
  const presenters = unique(input.presenters).filter(value => !coOrganizers.includes(value));
  const attendees = unique(input.attendees).filter(value => !coOrganizers.includes(value) && !presenters.includes(value));
  const list = (name: string, values: string[] = []) => `<p><strong>${name} (${values.length}):</strong> ${values.map(escapeHtml).join(', ') || 'None'}</p>`;
  const link = input.joinUrl ? escapeHtml(input.joinUrl) : 'Microsoft will generate the join link. It must pass verification before invitations are sent.';
  return `<div style="text-align:left;font-size:14px;overflow-wrap:anywhere">
    <p><strong>${escapeHtml(input.title)}</strong></p><p>Time zone: <strong>${escapeHtml(zone)}</strong>. 12 AM is midnight; 12 PM is noon.</p>
    <div style="max-height:280px;overflow:auto"><table style="width:100%;text-align:left"><caption>${sessions.length} reviewed sessions</caption><thead><tr><th>Session</th><th>Starts</th><th>Ends</th><th>Duration</th><th>Join link</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${list('Organizer', [input.organizerEmail])}${list('Co-organizers', coOrganizers)}${list('Presenters', presenters)}${list('Attendees', attendees)}
    <p><strong>Privacy:</strong> Attendees cannot see the other invitees in their invitation. The organizer can manage the full list.</p>
    <p><strong>Join link:</strong> ${link}</p>
    <p><strong>Series:</strong> ${escapeHtml(input.seriesMode === 'per_day' ? 'Separate series and link for each delivery day' : input.seriesMode === 'shared' ? 'One shared series and join link' : 'One shared link when all days have the same time and duration; otherwise a series per day')}</p>
    <p><strong>Recording:</strong> ${escapeHtml(input.recording || 'Keep existing settings')}. <strong>Lobby:</strong> ${escapeHtml(input.lobbyBypass || 'Keep existing settings')}. <strong>Language:</strong> ${escapeHtml(input.spokenLanguage || 'Keep existing settings')}.</p>
    ${input.details ? `<p><strong>Description:</strong> ${escapeHtml(input.details)}</p>` : ''}
    <p>${input.peopleOnly ? 'Only the invitation list and participant roles will be updated.' : 'These are the dates that will be sent to Microsoft.'} Confirming may send meeting invitations or updates.</p>
  </div>`;
}

export async function reviewCalendar(input: ReviewedCalendar, zone: string): Promise<void> {
  const html = calendarReviewHtml(input, zone);
  const result = await Swal.fire({
    title: 'Review Teams calendar', html, width: 900, input: 'checkbox',
    inputPlaceholder: 'I checked the dates, AM/PM, time zone and invitation list.',
    inputValidator: value => value ? undefined : 'Confirm that you have reviewed this calendar.',
    showCancelButton: true, cancelButtonText: 'Back to editing', confirmButtonText: 'Confirm and send',
    focusCancel: true, reverseButtons: true, buttonsStyling: false,
    customClass: { popup: 'kbc-standard-swal-popup', title: 'kbc-standard-swal-title',
      confirmButton: 'kbc-standard-swal-confirm', cancelButton: 'kbc-standard-swal-cancel' },
  });
  if (!result.isConfirmed) throw new TeamsReviewCancelled();
}
