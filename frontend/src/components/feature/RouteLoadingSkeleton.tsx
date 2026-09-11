import { useLocation } from 'react-router-dom';
import { RecordPageSkeleton } from '@/features/old-otjh/RecordSkeletons';
import { PageSkeleton } from './Skeletons';

/** Keep the learner record shell visible during both session and route loading. */
export function RouteLoadingSkeleton() {
  const { pathname } = useLocation();
  if (pathname === '/old-otjh/months' || pathname.startsWith('/old-otjh/months/')) {
    return <RecordPageSkeleton reportPage={pathname.replace(/\/$/, '') !== '/old-otjh/months'} />;
  }
  return <PageSkeleton />;
}
