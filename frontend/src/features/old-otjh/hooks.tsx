import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { PageSkeleton } from '@/components/feature/Skeletons';
import { useRecordSummary } from './useRecordSummary';

export function OldOtjhProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: {
    retry: false, staleTime: 2000, refetchOnWindowFocus: true, gcTime: 120000,
  } } }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function OldOtjhGate({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  const location = useLocation();
  if (auth.account?.role !== 'learner' || !auth.account.hasLegacyRecord
      || location.pathname.startsWith('/old-otjh') || location.pathname.startsWith('/profile')
      || location.pathname.startsWith('/learner/onboarding') || location.pathname.startsWith('/messages')) {
    return <>{children}</>;
  }
  return <LegacyLearningGate>{children}</LegacyLearningGate>;
}

function LegacyLearningGate({ children }: { children: ReactNode }) {
  const query = useRecordSummary();
  if (query.isPending) return <PageSkeleton />;
  if (query.error || !query.data?.can_access_lms) return <Navigate to="/old-otjh" replace state={{ contactCoach: true }} />;
  return <>{children}</>;
}
