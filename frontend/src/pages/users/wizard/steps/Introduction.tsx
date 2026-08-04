import { StepHeading } from './fields';

export default function Introduction() {
  return (
    <div>
      <StepHeading title="Introduction" subtitle="Your Enrolment" />
      <div className="max-w-3xl space-y-4 text-sm leading-relaxed text-foreground-700 sm:text-[14px]">
        <p>Welcome to your apprenticeship with IBIS.</p>
        <p>
          You will now be guided through the enrolment process, you will be asked to provide information about yourself
          and your participation on the course, complete your Individual Learning Record (ILR) and confirm details
          surrounding your eligibility and suitability for the programme.
        </p>
        <p>
          This information is very important as it allows for your place on the course to be confirmed, please ensure all
          details are accurate, completed in full, and the required documentation is signed with your digital signature.
        </p>
        <p>
          If you have any questions or concerns about this, please contact{' '}
          <a href="mailto:meadmissions@ibisconsultancy.com" className="break-all text-primary-600 hover:underline">meadmissions@ibisconsultancy.com</a>
        </p>
      </div>
    </div>
  );
}
