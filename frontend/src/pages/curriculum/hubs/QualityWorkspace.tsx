import { AlertsContext, useQualityAlerts } from './qualityAlertsContext';
import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { LoadingSkeleton } from '@/components/feature/LoadingSkeleton';
import type { HeaderNotification } from '@/components/feature/Header';
import { useQualityNotifications } from '@/pages/dashboard/useQualityNotifications';
import NeedsAttentionCard from '@/pages/dashboard/components/NeedsAttentionCard';
import FeedbackResponseDialog from '@/pages/dashboard/components/FeedbackResponseDialog';

const Feedbacks = lazy(() => import('./QualityFeedbacks'));
const DeepDive = lazy(() => import('@/pages/dashboard/components/DeepDivePage'));
const Overview = lazy(() => import('@/pages/executive/page'));

export function QualityNavigation() {
  return <nav aria-label="Quality workspaces" className="flex flex-wrap gap-3 py-3">
    {[[null, 'Quality checks'], ['overview', 'Quality overview'], ['feedbacks', 'Feedback'], ['deep-dive', 'Deep Dive']].map(([view, label]) =>
      <Link key={label} className="rounded-lg border border-primary-200 bg-white px-4 py-2 text-sm font-semibold text-primary-700"
        to={view ? `/curriculum/quality?view=${view}` : '/curriculum/quality'}>{label}</Link>)}
  </nav>;
}

export function QualityProvider({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  const accountId = auth.account?.id ?? null;
  const alerts = useQualityNotifications(accountId);
  const [selected, setSelected] = useState<{ accountId: number; id: number } | null>(null);
  const select = (notification: HeaderNotification) => {
    if (accountId !== null) setSelected({ accountId, id: Number(notification.id) });
  };
  return <AlertsContext.Provider value={{ ...alerts, select }}>
    {children}
    {selected && selected.accountId === accountId && <FeedbackResponseDialog key={`${accountId}:${selected.id}`}
      responseId={selected.id} onClose={() => setSelected(null)} />}
  </AlertsContext.Provider>;
}

export function QualityAlerts() {
  const alerts = useQualityAlerts();
  return alerts ? <NeedsAttentionCard {...alerts} onNotificationClick={alerts.select} onRefresh={alerts.refresh} /> : null;
}

export default function QualityWorkspace() {
  const [params] = useSearchParams();
  const view = params.get('view');
  if (view === 'checks') {
    const filters = new URLSearchParams(params);
    filters.delete('view');
    return <Navigate to={{ pathname: '/curriculum/coaching-recordings/reviews', search: filters.toString() }} replace />;
  }
  return <main className="space-y-4 p-4 sm:p-6">
    <QualityNavigation />
    <Suspense fallback={<LoadingSkeleton label="Loading quality workspace" variant="rows" />}>
      {view === 'deep-dive' ? <DeepDive /> : view === 'feedbacks' ? <><QualityAlerts /><Feedbacks /></>
        : <Overview attentionPanel={<QualityAlerts />} />}
    </Suspense>
  </main>;
}
