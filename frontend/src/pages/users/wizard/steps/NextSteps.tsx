import { StepHeading } from './fields';

export default function NextSteps() {
  return (
    <div>
      <StepHeading title="Next Steps" subtitle="Welcome to Your Apprenticeship" />
      <div className="space-y-4 text-[14px] text-foreground-700 leading-relaxed max-w-3xl">
        <p>Thank you for completing your enrolment process.</p>
        <p>
          Once you click 'Finish' you will be directed to read and sign your compliance documents which will summarise
          all the information captured as part of your enrolment, these documents include your Training Plan,
          Apprenticeship Agreement, and Individual Learning Record (ILR).
        </p>
        <p>
          Once signatures are completed, you will be directed to your Aptem e-portfolio learning plan where you will need
          to open and complete your first piece of learning… When you have finished these activities and submitted your
          answers your enrolment will be complete.
        </p>
        <p>Your tutor will provide further guidance on the next steps of your learning journey.</p>
        <p>
          If you have any questions or queries, please contact{' '}
          <a href="mailto:meadmissions@ibisconsultancy.com" className="text-primary-600 hover:underline">meadmissions@ibisconsultancy.com</a>
        </p>
      </div>
    </div>
  );
}
