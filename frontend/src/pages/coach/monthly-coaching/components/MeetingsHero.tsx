import type { ReactNode } from 'react';
import styles from './meetingsHero.module.css';

/** Meetings page header; `monthLabel` comes from the page's selected month. */
export function MeetingsHero({ monthLabel, title = 'Meetings', subject = 'coaching meetings', actions }: {
  monthLabel: string;
  title?: string;
  /** What is being tracked, e.g. "progress reviews". */
  subject?: string;
  /** Optional controls shown beside the calendar card, e.g. a month picker. */
  actions?: ReactNode;
}) {
  return (
    <section className={`${styles.hero} px-5 py-6 md:px-7`}>
      <span aria-hidden="true" className={styles.dots} />
      <svg aria-hidden="true" className={styles.waves} viewBox="0 0 800 200" preserveAspectRatio="none">
        <defs>
          <linearGradient id="meetings-wave-a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--hero-wave-a)" stopOpacity="0" /><stop offset="1" stopColor="var(--hero-wave-a)" stopOpacity=".28" /></linearGradient>
          <linearGradient id="meetings-wave-b" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="var(--hero-wave-b)" stopOpacity="0" /><stop offset="1" stopColor="var(--hero-wave-b)" stopOpacity=".24" /></linearGradient>
          <linearGradient id="meetings-wave-c" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="var(--hero-wave-c)" stopOpacity="0" /><stop offset="1" stopColor="var(--hero-wave-c)" stopOpacity=".22" /></linearGradient>
        </defs>
        <path d="M0 200 C 180 200 260 60 430 70 S 650 170 800 120 L 800 200 Z" fill="url(#meetings-wave-a)" />
        <path d="M120 200 C 300 190 380 20 560 30 S 720 110 800 60 L 800 200 Z" fill="url(#meetings-wave-b)" />
        <path d="M340 200 C 470 170 560 110 680 130 S 770 170 800 150 L 800 200 Z" fill="url(#meetings-wave-c)" />
        <path d="M60 170 C 240 160 330 40 500 50 S 700 140 800 95" fill="none" stroke="var(--hero-wave-line)" strokeWidth="1.5" />
      </svg>
      <span aria-hidden="true" className={styles.glow} />
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className={`${styles.title} text-[28px] font-extrabold tracking-tight`}>{title}</h2>
          <p className={`${styles.text} mt-1 text-[13px]`}>Manage and track your {subject} for <strong className="font-bold">{monthLabel}</strong>.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {actions}
          <div className={`${styles.card} flex items-center gap-4 rounded-[20px] py-3 pl-3 pr-6`}>
            <img src="/coach-meetings-calendar.webp" alt="" aria-hidden="true" width={72} height={72} className="h-[72px] w-[72px] shrink-0 object-contain drop-shadow-[0_10px_14px_rgb(91_33_182/0.25)]" />
            <p className={`${styles.cardText} text-[13px] leading-snug`}><strong className={`${styles.cardTitle} block text-[14px] font-bold`}>Build stronger learners</strong>through meaningful conversations.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
