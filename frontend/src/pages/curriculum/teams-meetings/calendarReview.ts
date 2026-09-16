import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';
import './calendarReview.css';
import type { TeamsMeetingInput } from '../module-builder/moduleAuthoringData';
import { reviewDateLabel } from './calendarTime';

export type ReviewedCalendar = Pick<TeamsMeetingInput, 'title' | 'organizerEmail' | 'scheduledOccurrences'> &
  Partial<TeamsMeetingInput> & { joinUrl?: string; peopleOnly?: boolean; summaryEmail?: boolean;
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

const icons = {
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2m4 0h2m-8 3h2"/>',
  people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  link: '<path d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
  settings: '<path d="M4 7h7m4 0h5M4 17h3m4 0h9"/><circle cx="13" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
};
const icon = (name: keyof typeof icons) => `<svg class="teams-review-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
const displaySetting = (value: string | undefined, labels: Record<string, string>) => escapeHtml(value ? labels[value] || value : 'Keep existing settings');

function displayDate(value: string, zone: string) {
  const full = reviewDateLabel(value, zone);
  const separator = full.lastIndexOf(', ');
  return { full, date: full.slice(0, separator), clock: full.slice(separator + 2) };
}

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
  const separateLinks = (input.calendarSeries?.length || 0) > 1 || input.seriesMode === 'per_day';
  const rows = ordered.map(session => {
    const series = input.calendarSeries?.find(item => item.sessionNumbers.includes(session.sessionNumber));
    const previous = input.previousOccurrences?.find(item => item.session_number === session.sessionNumber)?.scheduled_start;
    const start = displayDate(session.startDateTimeUtc, zone);
    const endIso = new Date(Date.parse(session.startDateTimeUtc) + session.durationMinutes * 60000).toISOString();
    const end = displayDate(endIso, zone);
    const day = series?.day || new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'long' }).format(new Date(session.startDateTimeUtc));
    return `<tr>
      <td class="teams-review-number"><span>${session.sessionNumber}</span></td>
      <td class="teams-review-date">${escapeHtml(start.date)}${previous && Date.parse(previous) !== Date.parse(session.startDateTimeUtc) ? `<small class="teams-review-previous">Previously saved: ${escapeHtml(reviewDateLabel(previous, zone))}</small>` : ''}</td>
      <td class="teams-review-time"><time datetime="${escapeHtml(session.startDateTimeUtc)}" aria-label="${escapeHtml(start.full)}">${escapeHtml(start.clock)}</time><span class="teams-review-time-arrow" aria-hidden="true">–</span><time datetime="${endIso}" aria-label="${escapeHtml(end.full)}">${escapeHtml(end.clock)}</time>${start.date !== end.date ? `<small>Ends ${escapeHtml(end.date)}</small>` : ''}</td>
      <td class="teams-review-duration">${session.durationMinutes} min</td>
      ${separateLinks ? `<td class="teams-review-day">${escapeHtml(day)} series</td>` : ''}
    </tr>`;
  }).join('');
  const unique = (values: string[] = []) => [...new Set(values.map(value => value.trim().toLowerCase()))];
  const coOrganizers = unique(input.coOrganizers);
  const presenters = unique(input.presenters).filter(value => !coOrganizers.includes(value));
  const attendees = unique(input.attendees).filter(value => !coOrganizers.includes(value) && !presenters.includes(value));
  const list = (name: string, values: string[]) => `<div class="teams-review-role"><div class="teams-review-role-heading"><strong>${name}</strong><span>${values.length}</span></div>${values.length ? `<ul aria-label="${name}" class="teams-review-emails"${values.length > 4 ? ' tabindex="0"' : ''}>${values.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul>` : '<p class="teams-review-empty">None</p>'}</div>`;
  const links = input.calendarSeries?.length
    ? input.calendarSeries.map(series => `<div class="teams-review-link-item"><strong>${escapeHtml(series.day)} series</strong><code>${escapeHtml(series.joinUrl || 'Generated after creation')}</code></div>`).join('')
    : input.joinUrl ? `<code>${escapeHtml(input.joinUrl)}</code>` : '<p class="teams-review-pending">Created after you confirm</p><p>Microsoft will generate the join link. It must pass verification before invitations are sent.</p>';
  return `<div class="teams-review-content">
    <header class="teams-review-summary"><div><span class="teams-review-eyebrow">${input.peopleOnly ? 'Update invitations' : 'Your calendar'}</span><h3>${escapeHtml(input.title)}</h3></div><div class="teams-review-zone"><span>Time zone</span><strong>${escapeHtml(zone)}</strong></div></header>
    <div class="teams-review-layout"><div class="teams-review-main">
      <section class="teams-review-card" aria-labelledby="teams-review-schedule-heading">
        <div class="teams-review-card-heading">${icon('calendar')}<h3 id="teams-review-schedule-heading">Session schedule</h3><span class="teams-review-count">${sessions.length} session${sessions.length === 1 ? '' : 's'}</span></div>
        <p class="teams-review-time-help">All times in ${escapeHtml(zone)} · <strong>12 AM</strong> is midnight; <strong>12 PM</strong> is noon.</p>
        <div class="teams-review-schedule-scroll" role="region" aria-label="All session dates" tabindex="0"><table class="teams-review-table" role="table"><caption class="teams-review-sr-only">${sessions.length} reviewed session${sessions.length === 1 ? '' : 's'}</caption><thead><tr><th scope="col">Session</th><th scope="col">Date</th><th scope="col">Time</th><th scope="col">Duration</th>${separateLinks ? '<th scope="col">Meeting</th>' : ''}</tr></thead><tbody>${rows}</tbody></table></div>
      </section>
      <section class="teams-review-card teams-review-links" aria-labelledby="teams-review-link-heading"><div class="teams-review-card-heading">${icon('link')}<h3 id="teams-review-link-heading">Meeting link${separateLinks ? 's' : ''}</h3></div><div class="teams-review-card-content"><p class="teams-review-series">${escapeHtml(input.seriesMode === 'per_day' ? 'Separate series and link for each delivery day' : input.seriesMode === 'shared' ? 'One shared series and join link' : 'One shared link when all days have the same time and duration; otherwise a series per day')}</p>${links}</div></section>
      ${input.details ? `<section class="teams-review-card teams-review-description"><h3>Description</h3><p>${escapeHtml(input.details)}</p></section>` : ''}
    </div><aside class="teams-review-sidebar">
      <section class="teams-review-card" aria-labelledby="teams-review-people-heading"><div class="teams-review-card-heading">${icon('people')}<h3 id="teams-review-people-heading">People &amp; roles</h3></div><div class="teams-review-people">${list('Organizer', [input.organizerEmail])}${list('Co-organizers', coOrganizers)}${list('Presenters', presenters)}${list('Attendees', attendees)}</div><div class="teams-review-privacy">${icon('shield')}<div><strong>Attendee list hidden</strong><p>Invitees cannot see other invitees in their invitation. The organizer can see the full list.</p></div></div></section>
      <section class="teams-review-card" aria-labelledby="teams-review-settings-heading"><div class="teams-review-card-heading">${icon('settings')}<h3 id="teams-review-settings-heading">Meeting settings</h3></div><dl class="teams-review-settings">
        <div><dt>Recording</dt><dd>${displaySetting(input.recording, { none: 'Do not start automatically', record: 'Record automatically', 'record-transcribe': 'Record and transcribe' })}</dd></div>
        <div><dt>Lobby bypass</dt><dd>${displaySetting(input.lobbyBypass, { invited: 'People invited to this meeting', organization: 'People in my organization', 'organization-excluding-guests': 'Organization, excluding guests', everyone: 'Everyone', organizer: 'Only organizers' })}</dd></div>
        <div><dt>Language</dt><dd>${displaySetting(input.spokenLanguage, { 'en-GB': 'English (UK)', 'en-US': 'English (US)', 'ar-EG': 'Arabic (Egypt)', 'fr-FR': 'French' })}</dd></div>
      </dl></section>
    </aside></div>
    <p class="teams-review-send-note">${input.peopleOnly ? 'Only the invitation list and participant roles will be updated.' : 'These are the dates that will be sent to Microsoft.'} Save and send applies this calendar now and may send meeting invitations or updates.${input.summaryEmail ? ' One separate schedule email will also be submitted for each attendee, with the complete timetable and verified Teams links.' : ''} Checking the box alone does not save or send anything.</p>
  </div>`;
}

export async function reviewCalendar(input: ReviewedCalendar, zone: string): Promise<void> {
  const html = calendarReviewHtml(input, zone);
  const result = await Swal.fire({
    title: 'Review Teams calendar', html, width: 1120, input: 'checkbox',
    inputPlaceholder: 'I checked the dates, AM/PM, time zone and invitation list.',
    inputValidator: value => value ? undefined : 'Confirm that you have reviewed this calendar.',
    showCancelButton: true, cancelButtonText: 'Back to editing', confirmButtonText: 'Save and send',
    focusCancel: true, reverseButtons: true, buttonsStyling: false,
    showCloseButton: true, closeButtonAriaLabel: 'Close review',
    customClass: { popup: 'kbc-standard-swal-popup teams-calendar-review', title: 'teams-calendar-review-title',
      htmlContainer: 'teams-calendar-review-body', input: 'teams-calendar-review-consent',
      actions: 'teams-calendar-review-actions', validationMessage: 'teams-calendar-review-validation',
      closeButton: 'teams-calendar-review-close',
      confirmButton: 'teams-calendar-review-confirm', cancelButton: 'teams-calendar-review-cancel' },
  });
  if (!result.isConfirmed) throw new TeamsReviewCancelled();
}
