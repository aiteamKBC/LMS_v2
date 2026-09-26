import type { ReactNode } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { cn } from '@/lib/cn';
import styles from '../learnerCaseFile.module.css';

export function ReferencePanel({ title, subtitle, icon, tone, actions, children, className }: {
  title: string; subtitle?: string; icon: string; tone: 'primary' | 'emerald' | 'red' | 'muted';
  actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return <section className={cn(styles.panel, className)}>
    <header className={styles.panelHeader}>
      <div className={styles.panelHeading}>
        <span className={styles.panelIcon} data-tone={tone}><AppIcon className={icon} /></span>
        <div><h3 className={styles.panelTitle}>{title}</h3>{subtitle && <p className={styles.panelSubtitle}>{subtitle}</p>}</div>
      </div>
      {actions}
    </header>
    <div className={styles.panelBody}>{children}</div>
  </section>;
}

export function BigMetric({ value, label, tone }: { value: string; label: string; tone: 'primary' | 'emerald' | 'red' | 'amber' | 'muted' }) {
  const color = { primary: 'text-primary-700', emerald: 'text-emerald-600', red: 'text-red-600', amber: 'text-amber-600', muted: 'text-foreground-700' }[tone];
  return <div className={styles.bigMetric}><p className={cn(styles.bigMetricValue, color)}>{value}</p><p className={styles.bigMetricLabel}>{label}</p></div>;
}

export function ProfileEmpty({ text }: { text: string }) {
  return <div className={styles.empty}><span>{text}</span></div>;
}
