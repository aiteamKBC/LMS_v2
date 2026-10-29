import { useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

/** Monitoring stays read-only even when this person also holds Coach access. */
export function useRecordMonitoring() {
  const { auth } = useAuth();
  const { pathname, search } = useLocation();
  const grants = [auth.account?.access, ...(auth.account?.accessWorkspaces ?? []).map(workspace => workspace.access)];
  return (pathname === '/old-otjh/monitor' && grants.includes('record-monitor'))
    || new URLSearchParams(search).get('workspace') === 'monitor'
    || (grants.includes('record-monitor') && !grants.some(grant => grant === 'coach' || grant === 'super-admin'));
}

/** Keep learner previews and read-only monitoring while changing months. */
export function useRecordHref() {
  const { search } = useLocation();
  const workspace = new URLSearchParams(search).get('workspace');
  return (path: string) => ['learner', 'monitor'].includes(workspace ?? '') && path.startsWith('/old-otjh/coach/')
    ? `${path}?workspace=${workspace}` : path;
}
