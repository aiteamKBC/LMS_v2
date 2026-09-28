import { StepHeading } from './fields';

/** Student Support's Microsoft Bookings page, where the compliance meeting is booked. */
const COMPLIANCE_MEETING_BOOKING_URL =
  'https://outlook.office.com/book/StudentSupport1@kentbusinesscollege.com/s/EmOovIV5H0GGd131KDuFJQ2';

const SUPPORT_EMAIL = 'office@kentbusinesscollege.com';

function SectionHeading({ children }: { children: string }) {
  return <h3 className="font-heading text-[16px] font-semibold text-primary-700">{children}</h3>;
}

export default function NextSteps() {
  return (
    <div>
      <StepHeading title="What Happens Now?" />
      <div className="max-w-3xl space-y-6 text-[14px] leading-relaxed text-foreground-700">
        <section className="space-y-2">
          <SectionHeading>Next Step: Book Your Compliance Meeting</SectionHeading>
          <p>
            The next step in your apprenticeship application process is to <strong>book a compliance meeting as soon as
            possible</strong>. This meeting is a key part of your onboarding and must be <strong>attended by both you and
            your line manager</strong>. Book a meeting using the following link:
          </p>
          <p>
            <a
              href={COMPLIANCE_MEETING_BOOKING_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary-600 hover:underline"
            >
              Book Compliance Meeting
            </a>{' '}
            (select “Compliance Meeting”)
          </p>
        </section>

        <section className="space-y-2">
          <SectionHeading>What Needs to Be Completed Before the Meeting?</SectionHeading>
          <p className="font-semibold text-foreground-800">Before attending your compliance meeting, please ensure you have:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Ensured your employer has signed the apprenticeship agreement</li>
            <li>Asked your employer to add Kent Business College to the Digital Apprenticeship Service (DAS)</li>
            <li>
              Completed the initial Maths and English assessments at least 24 hours before the compliance meeting
              appointment (this is essential)
            </li>
          </ul>
        </section>

        <p>
          <strong>Thank you!</strong> Please don’t hesitate to reach out if you have any questions:{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary-600 hover:underline">{SUPPORT_EMAIL}</a>
        </p>
      </div>
    </div>
  );
}
