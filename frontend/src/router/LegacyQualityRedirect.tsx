import { Navigate, useLocation } from 'react-router-dom';

/** Preserve bookmarked filters while retiring the old mock dashboard route. */
export function LegacyQualityRedirect() {
  const location = useLocation();
  return <Navigate to={{ pathname: '/curriculum/quality', search: location.search, hash: location.hash }} replace />;
}
