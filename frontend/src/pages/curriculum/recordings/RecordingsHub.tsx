import { Link } from 'react-router-dom';
import { ArrowRight, CalendarCheck, CalendarDays, CloudDownload, FileBarChart, Folder, Link2, ShieldCheck, Users } from 'lucide-react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { curriculumNavItems } from '@/mocks/navigation';
import styles from './RecordingsHub.module.css';
import { RecordingsPageHelp } from './help/RecordingsPageHelp';

export default function RecordingsHub() {
  return <WorkspaceShell role="curriculum" roleLabel="Curriculum Designer" navItems={curriculumNavItems}
    workspaceLabel="Curriculum Studio" pageTitle="Coach & Tutor Recordings"
    pageSubtitle="Choose a recording workspace to review sessions and quality checks.">
    <main className={styles.page}>
      <div className={styles.introduction}>
        <h1>Coach & Tutor Recordings</h1>
        <p>Choose the sessions you want to review.</p>
      </div>
      <div className={styles.cards}>
          {[
            {
              title: 'Tutor Session Recordings', heading: 'Tutor session recordings', href: '/curriculum/recordings',
              eyebrow: 'Teaching delivery', image: 'tutor',
              description: 'Every teaching session captured from Microsoft Teams, organised by day or by LMS module. Open a session to review its recordings, transcript, attendance and teaching quality check.',
              features: [
                { icon: CalendarDays, label: 'Day, week and month calendar' },
                { icon: Folder, label: 'All LMS modules hierarchy' },
                { icon: CloudDownload, label: 'Download ready files' },
                { icon: ShieldCheck, label: 'Teaching quality checks' },
              ],
              meta: 'Sessions with recording status, transcript and attendance', action: 'Open tutor recordings',
            },
            {
              title: 'Coach Meetings & Recordings', heading: 'Coach meetings & recordings', href: '/curriculum/coaching-recordings',
              eyebrow: 'Coaching operations', image: 'coach',
              description: 'Coaching meetings for the selected coach, with meeting type classification, LMS matching status, SharePoint recordings and quality reviews in one place.',
              features: [
                { icon: Users, label: 'Coach, learner and type filters' },
                { icon: CalendarCheck, label: 'Meetings calendar by category' },
                { icon: Link2, label: 'LMS matching and sync status' },
                { icon: FileBarChart, label: 'Quality checks and PDF export' },
              ],
              meta: 'Coach selected first, then the meeting calendar is shown', action: 'Open coaching recordings',
            },
          ].map(card => <Link key={card.href} to={card.href} aria-label={card.title} className={styles.card}>
            <span className={styles.hoverFill} aria-hidden="true" />
            <span className={styles.illustration} aria-hidden="true">
              <img src={`${import.meta.env.BASE_URL}recordings-hub/${card.image}.jpg`} alt="" width={480} height={480} />
            </span>
            <div className={styles.content}>
              <p className={styles.eyebrow}>{card.eyebrow}</p>
              <h2 className={styles.title}>{card.heading}</h2>
              <p className={styles.description}>{card.description}</p>
              <ul className={styles.features}>
                {card.features.map(feature => <li key={feature.label}>
                  <span className={styles.featureIcon}><feature.icon size={14} aria-hidden="true" /></span><span>{feature.label}</span>
                </li>)}
              </ul>
            </div>
            <div className={styles.footer}>
              <p className={styles.meta}><span className={styles.dot} aria-hidden="true" /><span>{card.meta}</span></p>
              <span className={styles.action}>{card.action}<ArrowRight size={16} aria-hidden="true" /></span>
            </div>
          </Link>)}
      </div>
    </main>
    <RecordingsPageHelp guideId="recordings-hub" />
  </WorkspaceShell>;
}
