import { StepHeading } from './fields';

const sectionHeading = 'font-heading text-[15px] font-semibold text-primary-600 sm:text-base';

export default function Introduction() {
  return (
    <div>
      <StepHeading title="Welcome" />
      <div className="max-w-3xl space-y-6 text-sm leading-relaxed text-foreground-700 sm:text-[14px]">
        <section className="space-y-2">
          <h3 className={sectionHeading}>Shaping Tomorrow&rsquo;s Business Leaders</h3>
          <p>
            Kent Business College offers world-class education in Project Management, Marketing, and Leadership to
            prepare you for success in today&rsquo;s competitive business landscape.
          </p>
        </section>
        <section className="space-y-4">
          <h3 className={sectionHeading}>What is an Apprenticeship?</h3>
          <p className="italic">
            The term &lsquo;apprenticeship&rsquo; simply means learning while working, gaining practical skills and
            knowledge on the job, regardless of your age, background, or current job title. It is meant to support
            upskilling within the British workforce employed by British organisations. Apprenticeship does not mean being
            young, in a junior role, or earning a low income. In the UK, anyone working legitimately can take part in an
            apprenticeship.
          </p>
          <div className="space-y-2">
            <p className="font-semibold text-foreground-800">
              The programme is structured to support your development each week with:
            </p>
            <ul className="list-disc space-y-1 pl-6">
              <li>Interactive online sessions</li>
              <li>Programme materials and quizzes (focused on knowledge)</li>
              <li>Coach-guided assignments to strengthen your practice and writing.</li>
            </ul>
          </div>
          <div className="space-y-2">
            <p className="font-semibold text-foreground-800">
              We call this developing the &ldquo;habits of success&rdquo;. That means:
            </p>
            <ul className="list-disc space-y-1 pl-6">
              <li>Attending one online class a week</li>
              <li>Reading 5&ndash;10 pages a week</li>
              <li>Reflecting on your work and assignments</li>
            </ul>
          </div>
          <p>
            Doing this consistently builds not only your skills and understanding, but the mindset and momentum to
            succeed both in the apprenticeship and beyond.
          </p>
        </section>
      </div>
    </div>
  );
}
