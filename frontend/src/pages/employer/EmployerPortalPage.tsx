import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, LoaderCircle } from 'lucide-react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { fetchEmployerPortal, type EmployerPortal } from '@/api/employerPortal';
import { EmployerDashboard, type EmployerPortalView } from './EmployerDashboard';
import { useEmployerDashboard } from './useEmployerDashboard';
import { useEmployerPortalChrome } from './employerPortalNav';
import styles from './EmployerPortalPage.module.css';

/** The sidebar section this path addresses; anything else is the home overview. */
function viewFromPath(pathname: string): EmployerPortalView {
  const section = pathname.replace(/\/+$/, '').split('/').pop();
  return section === 'learners' || section === 'reviews' ? section : 'home';
}

export default function EmployerPortalPage() {
  const { employerId = '' } = useParams();
  const navigate = useNavigate();
  const view = viewFromPath(useLocation().pathname);
  const [state, setState] = useState<{ employerId: string; data?: EmployerPortal; error?: string }>({ employerId });
  const [refresh, setRefresh] = useState(0);
  const [detailsRefresh, setDetailsRefresh] = useState(0);
  const data = state.employerId === employerId ? state.data : undefined;
  const error = state.employerId === employerId ? state.error : undefined;
  useEffect(() => {
    let active = true;
    setState({ employerId });
    void fetchEmployerPortal(employerId)
      .then(value => { if (active) setState({ employerId, data: value }); })
      .catch((cause: Error) => { if (active) setState({ employerId, error: cause.message }); });
    return () => { active = false; };
  }, [employerId, refresh]);
  const { metrics, programmeMetrics, attendance, reviews } = useEmployerDashboard(employerId, data?.learners, detailsRefresh, view === 'home');
  const { isEmployerViewer, shell } = useEmployerPortalChrome(employerId, data?.employer.name);

  return <WorkspaceShell {...shell} pageTitle="Employer" pageSubtitle={data?.employer.name || 'Employer portal'} hideBreadcrumbs>
    {!data && !error && <div role="status" aria-label="Loading learners" aria-live="polite" className={styles.loading}><LoaderCircle data-testid="learners-loading-spinner" aria-hidden="true" className="animate-spin" size={30} /><strong>Loading learners...</strong><p>Preparing your learner dashboard</p></div>}
    {error && <div className={styles.errorState} role="alert"><p>{error}</p><button type="button" className={styles.clearButton} onClick={() => setRefresh(value => value + 1)}>Retry</button></div>}
    {data && <EmployerDashboard key={employerId} view={view} data={data} metrics={metrics} programmeMetrics={programmeMetrics} attendance={attendance} reviews={reviews} onRetry={() => setDetailsRefresh(value => value + 1)}
      backAction={!isEmployerViewer ? <button type="button" className={styles.backButton} onClick={() => navigate(-1)}><ArrowLeft size={14} />Back to users</button> : undefined} />}
  </WorkspaceShell>;
}
