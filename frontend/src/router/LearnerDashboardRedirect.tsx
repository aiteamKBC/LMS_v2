import { Navigate, useLocation, useParams } from 'react-router-dom';

export function LearnerDashboardRedirect() {
  const { kind, id } = useParams<{ kind?: string; id?: string }>();
  const { search, hash } = useLocation();
  const pathname = kind && id
    ? `/workspace/learner/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`
    : '/workspace/learner';

  return <Navigate to={{ pathname, search, hash }} replace />;
}
