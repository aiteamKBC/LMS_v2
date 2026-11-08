import { Link } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { AppIcon } from '@/components/feature/AppIcon';
import { curriculumNavItems } from '@/mocks/navigation';

export default function RecordingsHub() {
  return <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems}
    workspaceLabel="Curriculum Studio" pageTitle="Coach & Tutor Recordings"
    pageSubtitle="Choose a recording workspace to review sessions and quality checks.">
    <main className="min-h-full bg-background-100 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="font-heading text-2xl font-extrabold text-foreground-950">Coach & Tutor Recordings</h1>
        <p className="mt-2 text-sm text-foreground-600">Choose the sessions you want to review.</p>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {[
            { title: 'Coach Meetings & Recordings', href: '/curriculum/coaching-recordings', icon: 'ri-user-voice-line', description: 'Review coach meetings, recordings, attendance and existing quality checks.' },
            { title: 'Tutor Session Recordings', href: '/curriculum/recordings', icon: 'ri-presentation-line', description: 'Review lecture recordings and assess teaching with the Teaching Session Feedback Form.' },
          ].map(card => <Link key={card.href} to={card.href} className="group rounded-2xl border border-background-200 bg-white p-6 shadow-sm transition-colors hover:border-primary-300 hover:bg-primary-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500">
            <span className="inline-flex text-primary-600"><AppIcon className={card.icon} size={30} /></span>
            <h2 className="mt-4 font-heading text-lg font-bold text-foreground-950">{card.title}</h2>
            <p className="mt-2 text-sm leading-6 text-foreground-600">{card.description}</p>
            <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary-700">Open workspace <AppIcon className="ri-arrow-right-line" /></span>
          </Link>)}
        </div>
      </div>
    </main>
  </WorkspaceShell>;
}
