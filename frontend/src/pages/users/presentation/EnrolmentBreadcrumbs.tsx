import { ArrowLeft, ChevronRight } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import styles from './EnrolmentWorkspace.module.css';

export function EnrolmentBreadcrumbs({ current, people = false }: { current: string; people?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  return <nav className={styles.heroBreadcrumbs} aria-label="Breadcrumb">
    <button type="button" aria-label="Back to previous page" onClick={() => {
      if (typeof window.history.state?.idx === 'number' && window.history.state.idx > 0) navigate(-1);
      else navigate(location.pathname === '/users' ? '/' : '/users', { replace: true });
    }}><ArrowLeft size={13} aria-hidden="true" /></button>
    <Link to="/users">Enrolment</Link><ChevronRight size={13} aria-hidden="true" />
    {people && <><Link to="/users">Users</Link><ChevronRight size={13} aria-hidden="true" /></>}
    <span>{current}</span>
  </nav>;
}
