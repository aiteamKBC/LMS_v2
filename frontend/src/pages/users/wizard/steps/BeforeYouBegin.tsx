import { StepHeading } from './fields';

const sectionHeading = 'font-heading text-[15px] font-semibold text-primary-600 sm:text-base';

export default function BeforeYouBegin() {
  return (
    <div>
      <StepHeading title="Before You Begin" />
      <div className="max-w-3xl space-y-6 text-sm leading-relaxed text-foreground-700 sm:text-[14px]">
        <section className="space-y-2">
          <h3 className={sectionHeading}>The Onboarding Stage</h3>
          <p>
            During this stage, you will be required to provide personal details and information regarding your
            qualifications. The purpose of this application is to help us confirm your eligibility for the apprenticeship
            funding.
          </p>
        </section>
        <section className="space-y-2">
          <h3 className={sectionHeading}>Eligibility for Apprenticeship Funding</h3>
          <p>
            Eligibility is determined by strict guidelines set forth by the UK Government&rsquo;s Department for Education
            (DfE). Therefore, every step of the application process must be completed accurately and thoroughly to be
            considered for funding and successful enrolment in the programme.
          </p>
        </section>
        <section className="space-y-2">
          <h3 className={sectionHeading}>Supporting Evidence</h3>
          <p className="font-semibold text-foreground-800">Documents you may need to include:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>Valid proof of identification and residency status</li>
            <li>Evidence of your right to work in the UK (England only) for the full duration of the apprenticeship</li>
            <li>GCSE English certificate or an approved equivalent <strong>(if applicable)</strong></li>
            <li>GCSE Maths certificate or an approved equivalent <strong>(if applicable)</strong></li>
            <li>Professional qualification certificates <strong>(if applicable)</strong></li>
            <li>Degree certificates and transcripts <strong>(if applicable)</strong></li>
          </ul>
          <p>Instructions on how to upload these documents will be provided within the application form.</p>
        </section>
        <section className="space-y-2">
          <h3 className={sectionHeading}>Application Guidance</h3>
          <p>If you exit the application before completing and submitting it, your progress will be saved.</p>
          <p className="font-semibold text-foreground-800">
            Please note: You will not be able to submit the form or proceed with your application unless all required
            fields are completed and all supporting documents are uploaded.{' '}
            <em className="underline">Incomplete applications or missing documentation may result in delays in processing
            your request.</em>
          </p>
        </section>
        <section className="space-y-2">
          <h3 className={sectionHeading}>Application Review</h3>
          <p>
            Once submitted, the compliance team will review your application.
            <br />
            If you have any questions, feel free to email us at:{' '}
            <a href="mailto:office@kentbusinesscollege.org" className="break-all text-primary-600 hover:underline">
              office@kentbusinesscollege.org
            </a>
          </p>
        </section>
        <p className="font-semibold text-foreground-800">Good luck with your application!</p>
      </div>
    </div>
  );
}
