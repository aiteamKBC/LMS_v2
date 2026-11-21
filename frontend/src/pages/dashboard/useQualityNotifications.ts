import { useCallback, useEffect, useState } from 'react';
import { feedbackApi } from '@/api/feedback';
import type { HeaderNotification } from '@/components/feature/Header';
import { FEEDBACK_TYPE_LABELS } from '@/features/feedback/feedbackDashboardData';
import { useRefreshOnReturn } from '@/hooks/useRefreshOnReturn';

interface NotificationState {
  accountId: number;
  notifications: HeaderNotification[];
  loading: boolean;
  error: string;
}

export function useQualityNotifications(accountId: number | null) {
  const [state, setState] = useState<NotificationState | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);

  useRefreshOnReturn(refresh, { enabled: accountId !== null });

  useEffect(() => {
    if (accountId === null) return;
    let active = true;
    setState({ accountId, notifications: [], loading: true, error: '' });
    void feedbackApi.insightsDashboard({ classification: 'negative' })
      .then(({ analytics }) => {
        const responses = analytics?.insights?.classification?.responses;
        if (!Array.isArray(responses)) throw new Error('Feedback score classifications are unavailable.');
        const notifications: HeaderNotification[] = responses
          .filter(response => response.classification === 'negative')
          .map(response => ({
            id: String(response.responseId),
            title: `${response.respondent || `Response #${response.responseId}`} · Red feedback`,
            description: response.contextTitle || response.formTitle,
            meta: [FEEDBACK_TYPE_LABELS[response.formType], response.score == null ? '' : `${Math.round(response.score)}%`, response.groupName].filter(Boolean).join(' · '),
            tone: 'red',
          }));
        if (active) setState({ accountId, notifications, loading: false, error: '' });
      })
      .catch(reason => {
        if (active) setState({ accountId, notifications: [], loading: false,
          error: reason instanceof Error ? reason.message : 'Could not load quality alerts.' });
      });
    return () => { active = false; };
  }, [accountId, revision]);

  const current = state?.accountId === accountId ? state : null;
  return {
    notifications: current?.notifications ?? [],
    loading: accountId !== null && (!current || current.loading),
    error: accountId === null ? 'Sign in to load quality alerts.' : current?.error ?? '',
    refresh,
  };
}
