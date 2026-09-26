import { AppIcon } from '@/components/feature/AppIcon';
import { cn } from '@/lib/cn';
import styles from '../learnerCaseFile.module.css';
import { caseFileTabs, type CaseFileTabId } from './caseFileTabs.config';

export function CaseFileTabs({ activeTab, onChange }: { activeTab: CaseFileTabId; onChange: (tab: CaseFileTabId) => void }) {
  return <nav className={styles.tabs} aria-label="Case file sections" role="tablist">
    {caseFileTabs.filter(tab => !('hidden' in tab && tab.hidden)).map(tab => {
      const active = activeTab === tab.id;
      return <button key={tab.id} type="button" role="tab" aria-selected={active}
        className={cn(styles.tab, active && styles.tabActive)} onClick={() => onChange(tab.id)}>
        <AppIcon className={tab.icon} />{tab.label}
      </button>;
    })}
  </nav>;
}
