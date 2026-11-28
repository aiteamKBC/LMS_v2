import { Notice } from '@/components/ui/Notice';
import type { CurriculumHolidayInvitationNotice } from '@/lib/curriculumApi';

// These are date-only values already computed in the saved calendar's zone.
// Format the date without interpreting it in the viewer's computer time zone.
const invitationDate = (day: string) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric',
}).format(new Date(`${day}T00:00:00Z`));

/** Guidance only. Opening the notice never calls an API or changes a booking. */
export function HolidayInvitationsNotice({ notice, unavailable }: {
  notice?: CurriculumHolidayInvitationNotice;
  unavailable?: boolean;
}) {
  if (unavailable) return (
    <Notice title="Holiday invitation guidance unavailable" tone="attention" className="mb-4">
      Reload the calendar before changing holiday invitations. The saved bookings have not been changed.
    </Notice>
  );
  if (!notice?.invitations.length) return null;
  return (
    <Notice title="Existing holiday invitations retained" className="mb-4"
      detailsLabel={`View affected invitations (${notice.invitationCount})`}
      details={<>
        <ul className="space-y-2" aria-label="Invitations in holiday weeks">
          {notice.invitations.map(invitation => (
            <li key={invitation.occurrenceId} className="rounded-lg border border-background-200 bg-white px-3 py-2">
              <p className="font-semibold text-foreground-900">{invitationDate(invitation.localDate)}</p>
              <p>{invitation.holidayLabels.join(', ') || 'Cohort holiday'} · Week of {invitationDate(invitation.weekStart)} to {invitationDate(invitation.weekEnd)}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-foreground-500">Dates use the saved calendar time zone: {notice.timeZone}.</p>
        <p className="mt-2">An invitation does not confirm that teaching is scheduled. Follow the published timetable for approved teaching exceptions. New live sessions continue to follow the cohort’s holiday rules.</p>
      </>}>
      Keep the holiday arrangements already communicated to learners. These existing invitations are being left in place to avoid unnecessary cancellation emails. Review with Curriculum before changing their dates or cancelling them.
    </Notice>
  );
}
