import { useEffect, useState } from 'react';
import { caseFileTabs, type CaseFileTabId } from '@/pages/coach/learner-case-file/components/caseFileTabs.config';

export function resolveLearnerProfileTab(tab?: string | null): CaseFileTabId {
  const normalized = tab === 'learning-plan' ? 'support' : tab;
  return caseFileTabs.some(candidate => candidate.id === normalized) ? normalized as CaseFileTabId : 'overview';
}

export function useLearnerProfileTabs(requestedTab?: string | null) {
  const [activeTab, setActiveTab] = useState<CaseFileTabId>(() => resolveLearnerProfileTab(requestedTab));
  useEffect(() => {
    if (requestedTab === 'learning-plan' || caseFileTabs.some(tab => tab.id === requestedTab)) {
      setActiveTab(resolveLearnerProfileTab(requestedTab));
    }
  }, [requestedTab]);
  return { activeTab, setActiveTab };
}

